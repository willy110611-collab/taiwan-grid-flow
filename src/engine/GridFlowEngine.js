import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, IconLayer, PathLayer, TextLayer } from '@deck.gl/layers';

import { PLANTS, LOADS, TAIWAN_BOUNDS } from '../config/geo.js';
import { FUELS, FUEL_KEYS, FILTERS, EVIDENCE } from '../config/energy.js';
import { createBaseStyle } from '../map/baseStyle.js';
import { solveFlows } from './flowModel.js';
import { ParticleSystem } from './ParticleSystem.js';
import { createGlowSprite } from './glowSprite.js';
import { Cruise } from './cruise.js';
import { daylightState, daylightPalette, applyDaylight } from './daylight.js';

/** 加法混合：光疊光會更亮，是「發光感」的關鍵 */
const ADDITIVE = {
  depthCompare: 'always',
  depthWriteEnabled: false,
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha'
};
const NO_DEPTH = { depthCompare: 'always', depthWriteEnabled: false };
const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const BREATH_PERIOD = 7.5; // 秒；約每分鐘 8 次，接近人放鬆時的呼吸

/**
 * GridFlowEngine — 地圖 + deck.gl + 粒子系統的協調者
 * ─────────────────────────────────────────────────────────────
 * 動畫迴圈完全在 React 之外跑（requestAnimationFrame → overlay.setProps），
 * React 只負責 HUD。這樣高幀率更新不會觸發任何 React re-render。
 *
 * 選項
 *  mode     'app'（可互動）| 'wallpaper'（桌布：不可互動、自動巡航）
 *  fps      幀率上限；手機與桌布預設 30（省電，仿軌島手機預設省電模式）
 *  onStats  每次資料更新後回報推估統計（南電北送量等）
 *  onShot   放空巡航切換場景時回報場景名稱
 *  onDaylight 日夜狀態改變時回報（給 HUD 調整天空色）
 */
export class GridFlowEngine {
  constructor(container, { density = 1, mode = 'app', fps = 60, onStats, onShot, onDaylight } = {}) {
    this.mode = mode;
    this.frameMs = 1000 / fps;
    this.onStats = onStats;
    this.onDaylight = onDaylight;
    this.sprite = createGlowSprite();
    this.time = 0;
    this.source = 'simulated';
    this.hover = { id: null, alpha: 0, shownId: null };
    this.fuelVisTarget = new Float32Array(FUEL_KEYS.length).fill(1);

    // 節點狀態（顯示值會 tween 到目標值，資料刷新時平滑過渡）
    this.plants = PLANTS.map((p, i) => ({
      ...p, idx: i, mw: 0, targetMw: 0, liveMw: 0, mix: {}, color: [255, 255, 255], vis: 1,
      phase: Math.random() * Math.PI * 2, sparkles: makeSparkles(p.pos, 260)
    }));
    this.loads = LOADS.map((l, i) => ({ ...l, idx: i, energy: 0, pulse: 0 }));
    this.puffs = [];

    this.particles = new ParticleSystem({
      density,
      onArrive: (targetIdx, _p, r, g, b) => {
        const L = this.loads[targetIdx];
        if (!L) return;
        L.pulse += 1;
        if (this.puffs.length < 420 && Math.random() < 0.35) {
          const j = 0.012;
          this.puffs.push({
            pos: [L.pos[0] + (Math.random() - 0.5) * j, L.pos[1] + (Math.random() - 0.5) * j],
            age: 0, color: [r, g, b]
          });
        }
      }
    });

    const wallpaper = mode === 'wallpaper';
    this.map = new maplibregl.Map({
      container,
      style: createBaseStyle(),
      bounds: TAIWAN_BOUNDS,
      fitBoundsOptions: { padding: fitPadding() },
      pitch: 28,
      bearing: -8,
      maxPitch: 65,
      minZoom: 5.5,
      maxZoom: 12,
      maxBounds: [[117.5, 20.2], [124.5, 27.0]],
      attributionControl: false,
      interactive: !wallpaper,
      fadeDuration: 0
    });
    if (!wallpaper) this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // 地形圖磚載不到（離線）時只會少了山影，其餘照常；這裡吞掉錯誤避免洗版
    this.map.on('error', (e) => {
      if (e?.sourceId !== 'dem') console.warn('[map]', e?.error?.message || e);
    });
    this.map.on('load', () => this.updateDaylight(true));

    this.overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      onHover: (info) => this.setHover(info.layer?.id === 'pick' ? info.object?.id : null),
      onClick: (info) => this.setHover(info.layer?.id === 'pick' ? info.object?.id : null),
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab')
    });
    this.map.addControl(this.overlay);

    // 放空巡航：桌布模式場景停留 3–5 分鐘；App 模式 60–90 秒
    this.cruise = new Cruise(this.map, { dwell: wallpaper ? [180, 300] : [60, 90], onShot });
    if (wallpaper) this.map.once('load', () => setTimeout(() => this.cruise.start(), 4000));
    else {
      // 使用者一碰地圖就停止巡航，把鏡頭還給使用者
      const userStop = (e) => { if (e.originalEvent) this.cruise.stop(); };
      ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((ev) => this.map.on(ev, userStop));
    }

    this.lastDraw = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 新的電網快照進來：更新節點目標值、重算流向矩陣 */
  setSnapshot(snapshot) {
    this.source = snapshot.source;
    const byId = Object.fromEntries(snapshot.plants.map((p) => [p.id, p]));
    for (const p of this.plants) {
      const s = byId[p.id];
      p.targetMw = s?.mw || 0;
      p.liveMw = s?.liveMw || 0;
      p.mix = s?.mix || {};
      p.dominant = Object.entries(p.mix).sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    const sources = this.plants.map((p) => ({ pos: p.pos, mw: p.targetMw, mix: p.mix }));
    const flows = solveFlows(sources, this.loads);
    this.particles.setFlows(flows, sources, this.loads);

    const top = [...this.plants].sort((a, b) => b.targetMw - a.targetMw)[0];
    this.onStats?.({
      southToNorthMw: this.particles.southToNorth(sources, this.loads),
      topPlant: top ? { name: top.name, mw: top.targetMw } : null
    });
  }

  /** 能源篩選：'all' | 'green' | 'thermal' | 'nuclear' */
  setFilter(id) {
    const f = FILTERS.find((x) => x.id === id) || FILTERS[0];
    FUEL_KEYS.forEach((k, i) => {
      this.fuelVisTarget[i] = !f.fuels || f.fuels.includes(k) ? 1 : 0;
    });
  }

  toggleCruise() {
    return this.cruise.toggle();
  }

  updateDaylight(force = false) {
    const st = daylightState(new Date());
    if (!force && this.lastDay && Math.abs(st.elev - this.lastDay.elev) < 0.4) return;
    this.lastDay = st;
    const pal = daylightPalette(st);
    applyDaylight(this.map, pal);
    this.onDaylight?.({ ...st, sky: pal.sky });
  }

  frame = (now) => {
    this.raf = requestAnimationFrame(this.frame);
    // 幀率上限（省電模式）
    if (now - this.lastDraw < this.frameMs - 2) return;
    const dt = Math.min(0.05, (now - this.lastDraw) / 1000);
    this.lastDraw = now;
    this.time += dt;

    // 每 30 秒檢查一次日夜色調
    if (Math.floor(this.time / 30) !== Math.floor((this.time - dt) / 30)) this.updateDaylight();

    // 能源篩選：各燃料可見度平滑淡入淡出（約 0.6 秒）
    const kv = 1 - Math.exp(-dt / 0.22);
    const vis = this.particles.fuelVis;
    for (let i = 0; i < vis.length; i++) vis[i] += (this.fuelVisTarget[i] - vis[i]) * kv;

    // tween 節點出力（約 2.5 秒到位）＋ 依篩選計算節點可見比例與顏色
    const k = 1 - Math.exp(-dt / 0.8);
    for (const p of this.plants) {
      p.mw += (p.targetMw - p.mw) * k;
      let tot = 0, shown = 0;
      const c = [0, 0, 0];
      for (const [f, mw] of Object.entries(p.mix)) {
        const fi = FUEL_KEYS.indexOf(f);
        if (fi < 0 || mw <= 0) continue;
        const w = mw * vis[fi];
        tot += mw;
        shown += w;
        for (let j = 0; j < 3; j++) c[j] += FUELS[f].color[j] * w;
      }
      p.vis = tot > 0 ? shown / tot : 0;
      if (shown > 0) p.color = c.map((v) => v / shown);
    }
    for (const L of this.loads) {
      L.energy += (L.pulse - L.energy) * (1 - Math.exp(-dt / 0.35));
      L.pulse *= Math.exp(-dt / 0.6);
    }
    for (const f of this.puffs) f.age += dt;
    this.puffs = this.puffs.filter((f) => f.age < 1.6);

    // hover 標籤淡入淡出
    const h = this.hover;
    if (h.id) h.shownId = h.id;
    h.alpha += ((h.id ? 1 : 0) - h.alpha) * (1 - Math.exp(-dt / 0.18));

    this.particles.update(dt, this.time);
    this.overlay.setProps({ layers: this.buildLayers() });
  };

  buildLayers() {
    const t = this.time;
    const breath = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / BREATH_PERIOD);
    const frame = Math.floor(t * 60);

    const glowAlpha = (p) => {
      let a = 0.9;
      if (p.dominant === 'wind') {
        // 風力：冷色調的呼吸閃爍（兩個不相關頻率疊加 → 不規則但柔和）
        a *= 0.62 + 0.24 * Math.sin(t * 1.9 + p.phase) + 0.14 * Math.sin(t * 4.7 + p.phase * 2);
      }
      return a * (0.85 + 0.15 * breath);
    };
    const glowSize = (p) => {
      const mw = p.mw * p.vis;
      return mw > 1 ? 2 * (2600 + Math.sqrt(mw) * 620) * (0.96 + 0.08 * breath) : 0;
    };
    const solarVis = this.particles.fuelVis[FUEL_KEYS.indexOf('solar')];

    const layers = [];

    // ① 光纖：極淡的流線骨架，粗細對應流量
    {
      layers.push(new PathLayer({
        id: 'fibers',
        data: this.particles.fibers(),
        getPath: (d) => d.path,
        getColor: (d) => [...d.color, 255],
        getWidth: (d) => (d.mw > 1 ? 0.4 + Math.sqrt(d.mw) * 0.035 : 0),
        widthUnits: 'pixels',
        widthMinPixels: 0.4,
        capRounded: true,
        jointRounded: true,
        opacity: 0.07 + 0.05 * breath,
        parameters: ADDITIVE
      }));
    }

    // ② 太陽能星光：出力越大，點亮越多顆，各自閃爍
    const stars = [];
    for (const p of this.plants) {
      const solar = (p.mix.solar || 0) * (p.targetMw ? p.mw / p.targetMw : 0);
      if (solar < 10) continue;
      const n = Math.min(p.sparkles.length, Math.floor(Math.sqrt(solar) * 4.2));
      for (let i = 0; i < n; i++) stars.push(p.sparkles[i]);
    }
    layers.push(new ScatterplotLayer({
      id: 'solar-stars',
      data: stars,
      getPosition: (d) => d.pos,
      getRadius: (d) => d.r,
      getFillColor: (d) => {
        const tw = 0.5 + 0.5 * Math.sin(t * d.speed + d.phase);
        return [255, 206, 110, (40 + 170 * tw * tw) * solarVis];
      },
      radiusUnits: 'pixels',
      updateTriggers: { getFillColor: frame },
      parameters: ADDITIVE
    }));

    // ③ 電廠光暈（外層霧 + 內層核心）
    const lit = this.plants.filter((p) => (p.mw > 1 || p.targetMw > 1) && p.vis > 0.01);
    layers.push(new IconLayer({
      id: 'plant-haze',
      data: lit,
      iconAtlas: this.sprite.atlas,
      iconMapping: this.sprite.mapping,
      getIcon: () => 'glow',
      getPosition: (d) => d.pos,
      getSize: (d) => glowSize(d) * 1.9,
      sizeUnits: 'meters',
      sizeMinPixels: 8,
      getColor: (d) => [...d.color, 70 * glowAlpha(d)],
      updateTriggers: { getSize: frame, getColor: frame },
      parameters: ADDITIVE
    }));
    layers.push(new IconLayer({
      id: 'plant-glow',
      data: lit,
      iconAtlas: this.sprite.atlas,
      iconMapping: this.sprite.mapping,
      getIcon: () => 'glow',
      getPosition: (d) => d.pos,
      getSize: (d) => glowSize(d),
      sizeUnits: 'meters',
      sizeMinPixels: 6,
      getColor: (d) => [...d.color, 255 * glowAlpha(d)],
      updateTriggers: { getSize: frame, getColor: frame },
      parameters: ADDITIVE
    }));

    // ④ 能量粒子（binary attributes，每幀直接上傳 TypedArray）
    layers.push(new ScatterplotLayer({
      id: 'particles',
      data: this.particles.getBuffers(),
      radiusUnits: 'pixels',
      radiusScale: 1,
      parameters: ADDITIVE
    }));

    // ⑤ 抵達光暈：粒子在都市化為一圈漸散的微光
    layers.push(new ScatterplotLayer({
      id: 'puffs',
      data: this.puffs,
      getPosition: (d) => d.pos,
      getRadius: (d) => 2 + d.age * 9,
      getFillColor: (d) => [...d.color, 70 * (1 - d.age / 1.6) ** 2],
      radiusUnits: 'pixels',
      updateTriggers: { getRadius: frame, getFillColor: frame },
      parameters: ADDITIVE
    }));

    // ⑥ 都市負載點：白色暖光，接收越多能量越亮
    layers.push(new IconLayer({
      id: 'load-glow',
      data: this.loads,
      iconAtlas: this.sprite.atlas,
      iconMapping: this.sprite.mapping,
      getIcon: () => 'glow',
      getPosition: (d) => d.pos,
      getSize: (d) => 9000 + Math.sqrt(d.energy) * 5200 + breath * 1500,
      sizeUnits: 'meters',
      sizeMinPixels: 10,
      getColor: (d) => [235, 242, 255, Math.min(255, 70 + Math.sqrt(d.energy) * 60)],
      updateTriggers: { getSize: frame, getColor: frame },
      parameters: ADDITIVE
    }));

    // ⑦ 互動拾取層（透明圓，專門負責 hover / tap）
    layers.push(new ScatterplotLayer({
      id: 'pick',
      data: this.plants,
      getPosition: (d) => d.pos,
      getRadius: (d) => 14 + Math.min(18, Math.sqrt(d.mw) * 0.25),
      radiusUnits: 'pixels',
      getFillColor: [0, 0, 0, 1],
      pickable: true,
      parameters: NO_DEPTH
    }));

    // ⑧ 融入地圖的文字：負載點名稱（極淡） + hover 電廠標籤（淡入）
    layers.push(new TextLayer({
      id: 'load-names',
      data: this.loads,
      getPosition: (d) => d.pos,
      getText: (d) => d.name,
      getColor: [190, 205, 235, 70],
      getSize: 11,
      getPixelOffset: [0, 16],
      fontFamily: FONT,
      fontWeight: 300,
      characterSet: 'auto',
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
      parameters: NO_DEPTH
    }));

    const hp = this.hover.shownId && this.plants.find((p) => p.id === this.hover.shownId);
    if (hp && this.hover.alpha > 0.01) {
      const a = this.hover.alpha;
      const fuelText = Object.entries(hp.mix)
        .filter(([, mw]) => mw > 0.5)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([f, mw]) => `${FUELS[f]?.label ?? f} ${Math.round((mw / (hp.targetMw || 1)) * 100)}%`)
        .join(' · ');
      const label = [
        { pos: hp.pos, text: hp.name, size: 15, off: [22, -10], font: FONT, color: [240, 244, 255], weight: 400 },
        { pos: hp.pos, text: hp.en.toUpperCase(), size: 9, off: [22, 7], font: MONO, color: [150, 165, 195], weight: 300 },
        {
          pos: hp.pos,
          text: hp.targetMw > 1 ? `${Math.round(hp.mw).toLocaleString()} MW${fuelText ? '   ' + fuelText : ''}` : '— 停機 · 0 MW',
          size: 12, off: [22, 23], font: MONO, color: hp.color, weight: 400
        },
        { pos: hp.pos, text: evidenceText(hp, this.source), size: 9.5, off: [22, 39], font: FONT, color: [150, 165, 195], weight: 300 }
      ];
      layers.push(new TextLayer({
        id: 'hover-label',
        data: label,
        getPosition: (d) => d.pos,
        getText: (d) => d.text,
        getSize: (d) => d.size,
        getPixelOffset: (d) => [d.off[0] + (1 - a) * -6, d.off[1]],
        getColor: (d) => [...d.color, 255 * a],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: FONT,
        characterSet: 'auto',
        fontSettings: { sdf: true, fontSize: 64, buffer: 8 },
        outlineWidth: 4,
        outlineColor: [3, 5, 10, 200 * a],
        updateTriggers: { getColor: a, getPixelOffset: a, getText: Math.round(hp.mw) },
        parameters: NO_DEPTH
      }));
    }

    return layers;
  }

  setHover(id) {
    if (this.mode === 'wallpaper') return;
    this.hover.id = id;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cruise.stop();
    this.map.removeControl(this.overlay);
    this.overlay.finalize();
    this.map.remove();
  }
}

/** hover 標籤第 4 行：這個數字的可信度（仿軌島「即時 / 推估」標示） */
function evidenceText(p, source) {
  if (source !== 'live') return `● ${EVIDENCE.simulated.label}資料`;
  if (p.targetMw < 1) return `● ${EVIDENCE.live.label} · 停機`;
  const liveShare = p.liveMw / p.targetMw;
  if (liveShare > 0.95) return `● ${EVIDENCE.live.label}`;
  if (liveShare < 0.05) return `◐ ${EVIDENCE.allocated.label}`;
  return `● 即時 ${Math.round(liveShare * 100)}% ＋ ◐ 推估分配 ${Math.round((1 - liveShare) * 100)}%`;
}

function makeSparkles(center, n) {
  // 以黃金角螺旋散佈，靠近中心較密 → 像一片光電板陣列的星海
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = 0.075 * Math.sqrt((i + 0.5) / n) * (0.75 + Math.random() * 0.5);
    const th = i * 2.39996 + Math.random() * 0.3;
    out.push({
      pos: [center[0] + (r * Math.cos(th)) / Math.cos((23.7 * Math.PI) / 180), center[1] + r * Math.sin(th) * 0.9],
      r: 0.6 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 2.2
    });
  }
  return out;
}

function fitPadding() {
  const w = window.innerWidth;
  return w < 700 ? { top: 165, bottom: 150, left: 20, right: 20 } : { top: 20, bottom: 20, left: 40, right: 40 };
}
