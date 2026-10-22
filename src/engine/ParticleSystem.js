import { buildPath, samplePath } from './paths.js';
import { FUELS, FUEL_KEYS } from '../config/energy.js';

/**
 * 能量粒子引擎
 * ─────────────────────────────────────────────────────────────
 * - 物件池 + TypedArray（Structure of Arrays）：每幀不產生垃圾，GC 不會造成卡頓
 * - 生成率 Spawn Rate：每 100 MW → 每秒 1 顆（× density）
 * - 每顆粒子帶「拖尾」：沿曲線往回取 TRAIL 個點，亮度遞減 → 光纖流動感
 * - 抵達終點時呼叫 onArrive，讓負載點化為光暈消散
 *
 * 輸出：getBuffers() 直接給 deck.gl 的 binary attributes，零拷貝上傳 GPU
 */
const CAPACITY = 14000;
const TRAIL = 7;
const TRAIL_GAP = 0.0105;      // 拖尾每段的弧長間隔（度）
const BASE_SPEED = 0.2;        // 度 / 秒（約 22 km/s 的「視覺速度」）
const LANE_WIDTH = 0.03;       // 粒子束的寬度（度）

export class ParticleSystem {
  constructor({ density = 1, onArrive } = {}) {
    this.density = density;
    this.onArrive = onArrive;

    this.paths = [];             // 穩定索引的路徑快取
    this.pathIndex = new Map();  // key → index
    this.emitters = [];          // { path, rate, acc, source, target, palette }

    this.count = 0;
    this.pathOf = new Int16Array(CAPACITY);
    this.u = new Float32Array(CAPACITY);
    this.speed = new Float32Array(CAPACITY);
    this.lane = new Float32Array(CAPACITY);
    this.rgb = new Uint8Array(CAPACITY * 3);
    this.bright = new Float32Array(CAPACITY);
    this.fuel = new Uint8Array(CAPACITY);
    /** 各燃料的可見度 0..1（能源篩選時由引擎平滑調整） */
    this.fuelVis = new Float32Array(FUEL_KEYS.length).fill(1);

    const n = CAPACITY * TRAIL;
    this.outPos = new Float32Array(n * 2);
    this.outCol = new Uint8Array(n * 4);
    this.outRad = new Float32Array(n);
    this.outCount = 0;
  }

  /**
   * 依最新的流量矩陣重設發射器。幾何快取不重建，只更新生成率 → 資料刷新時畫面不會跳。
   * @param flows   solveFlows() 的輸出
   * @param sources [{ pos, mix }] 用來決定粒子顏色（依燃料比例抽樣）
   * @param targets [{ pos }]
   */
  setFlows(flows, sources, targets) {
    this.emitters = flows.map((f) => {
      const key = `${f.source}>${f.target}`;
      let idx = this.pathIndex.get(key);
      if (idx === undefined) {
        idx = this.paths.length;
        this.paths.push(buildPath(sources[f.source].pos, targets[f.target].pos, f.source * 31 + f.target * 7 + 1));
        this.pathIndex.set(key, idx);
      }
      const prev = this.emitters?.find((e) => e.pathIdx === idx);
      return {
        pathIdx: idx,
        source: f.source,
        target: f.target,
        mw: f.mw,
        rate: Math.max((f.mw / 100) * this.density, f.island ? 1.4 * this.density : 0), // 離島電量小，給最低粒子量才看得見
        acc: prev ? prev.acc : Math.random(),
        palette: buildPalette(sources[f.source].mix)
      };
    });
  }

  update(dt, time) {
    // 大自然節律：整體流速隨一個 ~9 秒的「潮汐」緩慢起伏
    const tide = 1 + 0.14 * Math.sin((time * 2 * Math.PI) / 9.3);

    // ── 生成 ──
    for (const e of this.emitters) {
      e.acc += e.rate * dt;
      while (e.acc >= 1 && this.count < CAPACITY) {
        e.acc -= 1;
        this.spawn(e);
      }
      if (this.count >= CAPACITY) e.acc = Math.min(e.acc, 1);
    }

    // ── 前進 / 抵達 ──
    for (let i = 0; i < this.count; i++) {
      this.u[i] += this.speed[i] * dt * tide;
      if (this.u[i] >= 1) {
        const p = this.paths[this.pathOf[i]];
        this.onArrive?.(p.targetIdx ?? null, this.pathOf[i], this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]);
        this.kill(i);
        i--;
      }
    }

    this.writeBuffers(time);
  }

  spawn(e) {
    const i = this.count++;
    const path = this.paths[e.pathIdx];
    path.targetIdx = e.target;
    this.pathOf[i] = e.pathIdx;
    this.u[i] = 0;
    this.speed[i] = (BASE_SPEED * (0.82 + Math.random() * 0.36)) / path.length;
    // 高斯分佈的車道 → 中心密、邊緣疏，像神經束
    this.lane[i] = gauss() * LANE_WIDTH * Math.min(1.4, 0.5 + path.length);
    const entry = pick(e.palette);
    const c = entry.color;
    this.fuel[i] = entry.fuelIdx;
    this.rgb[i * 3] = c[0];
    this.rgb[i * 3 + 1] = c[1];
    this.rgb[i * 3 + 2] = c[2];
    this.bright[i] = 0.55 + Math.random() * 0.45;
  }

  kill(i) {
    const last = --this.count;
    if (i === last) return;
    this.pathOf[i] = this.pathOf[last];
    this.u[i] = this.u[last];
    this.speed[i] = this.speed[last];
    this.lane[i] = this.lane[last];
    this.bright[i] = this.bright[last];
    this.fuel[i] = this.fuel[last];
    this.rgb[i * 3] = this.rgb[last * 3];
    this.rgb[i * 3 + 1] = this.rgb[last * 3 + 1];
    this.rgb[i * 3 + 2] = this.rgb[last * 3 + 2];
  }

  writeBuffers(time) {
    const { outPos, outCol, outRad } = this;
    let o = 0;
    for (let i = 0; i < this.count; i++) {
      const vis = this.fuelVis[this.fuel[i]];
      if (vis < 0.01) continue;
      const path = this.paths[this.pathOf[i]];
      const u = this.u[i];
      const du = TRAIL_GAP / path.length;
      // 進場淡入、離場淡出
      const life = Math.min(1, u / 0.06) * Math.min(1, (1 - u) / 0.12);
      const twinkle = 0.85 + 0.15 * Math.sin(time * 6 + i);
      const r = this.rgb[i * 3], g = this.rgb[i * 3 + 1], b = this.rgb[i * 3 + 2];

      for (let k = 0; k < TRAIL; k++) {
        const uk = u - k * du;
        if (uk < 0) break;
        samplePath(path, uk, this.lane[i], outPos, o * 2);
        const fall = 1 - k / TRAIL;
        const a = life * this.bright[i] * twinkle * fall * fall * vis;
        // 頭部偏白（高溫），尾部回到燃料色
        const w = k === 0 ? 0.18 : 0;
        outCol[o * 4] = r + (255 - r) * w;
        outCol[o * 4 + 1] = g + (255 - g) * w;
        outCol[o * 4 + 2] = b + (255 - b) * w;
        outCol[o * 4 + 3] = Math.min(255, a * 135);
        outRad[o] = k === 0 ? 1.5 : 1.2 * fall + 0.3;
        o++;
      }
    }
    this.outCount = o;
  }

  /** deck.gl binary data：每幀用新的 subarray view，觸發 GPU 重新上傳 */
  getBuffers() {
    const n = this.outCount;
    return {
      length: n,
      attributes: {
        getPosition: { value: this.outPos.subarray(0, n * 2), size: 2 },
        getFillColor: { value: this.outCol.subarray(0, n * 4), size: 4, normalized: true },
        getRadius: { value: this.outRad.subarray(0, n), size: 1 }
      }
    };
  }

  /** 給背景「光纖」層用：目前有流量的路徑（依燃料可見度加權） */
  fibers() {
    return this.emitters.map((e) => {
      let visW = 0;
      const c = [0, 0, 0];
      for (const p of e.palette) {
        const w = p.w * this.fuelVis[p.fuelIdx];
        visW += w;
        for (let k = 0; k < 3; k++) c[k] += p.color[k] * w;
      }
      const color = visW > 0 ? c.map((v) => v / visW) : [0, 0, 0];
      return { path: this.paths[e.pathIdx].coords, mw: e.mw * visW, color };
    });
  }

  /** 推估的「南電北送」量：中南部電源（緯度 < 24.0）送往北部負載（緯度 > 24.5） */
  southToNorth(sources, targets) {
    let mw = 0;
    for (const e of this.emitters) {
      if (sources[e.source].pos[1] < 24.0 && targets[e.target].pos[1] > 24.5) mw += e.mw;
    }
    return mw;
  }
}

function buildPalette(mix) {
  const entries = Object.entries(mix || {}).filter(([f, mw]) => mw > 0 && FUELS[f]);
  const total = entries.reduce((a, [, mw]) => a + mw, 0) || 1;
  let acc = 0;
  return entries.map(([f, mw]) => {
    acc += mw / total;
    return { cum: acc, w: mw / total, color: FUELS[f].color, fuelIdx: FUEL_KEYS.indexOf(f) };
  });
}

function pick(palette) {
  const r = Math.random();
  for (const p of palette) if (r <= p.cum) return p;
  return palette[palette.length - 1] || { color: [255, 255, 255], fuelIdx: 0 };
}

export function mixColor(palette) {
  const c = [0, 0, 0];
  for (const p of palette) for (let k = 0; k < 3; k++) c[k] += p.color[k] * p.w;
  return c;
}

function gauss() {
  // Box–Muller，截斷在 ±2.2σ
  const g = Math.sqrt(-2 * Math.log(Math.random() || 1e-6)) * Math.cos(2 * Math.PI * Math.random());
  return Math.max(-2.2, Math.min(2.2, g)) / 2.2;
}
