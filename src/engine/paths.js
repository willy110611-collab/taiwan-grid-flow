import { SPINE } from '../config/geo.js';

/**
 * 流線幾何：電廠 → 負載點
 * ─────────────────────────────────────────────────────────────
 * A. 長程輸送（例如興達 → 台北）：匯入「西部骨幹」→ 沿骨幹前進 → 在終點附近離開，
 *    再以 Chaikin 演算法磨圓 → 多條路徑共用主幹，自然形成神經束般的「能量動脈」
 * B. 短程 / 遠離骨幹（例如和平 → 台北）：三次貝茲曲線
 * 1. 在起終點連線的 1/3、2/3 處取兩個控制點
 * 2. 控制點被「西部骨幹 SPINE」吸引（離骨幹越近吸力越強）→ 粒子沿西海岸走
 * 3. 再加一點垂直方向的弧度（依 pair 雜湊決定左右），讓線條像光纖一樣微彎
 * 4. 以「等弧長」重新取樣，粒子可以用固定速度前進，不會在彎道忽快忽慢
 */
const SAMPLES = 160;
const LAT_SCALE = Math.cos((23.7 * Math.PI) / 180); // 經度在台灣緯度的縮放

const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

export function buildPath(from, to, seed = 0) {
  const dense = routeViaSpine(from, to, seed) || bezierRoute(from, to, seed);

  // 累積弧長
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    const [ax, ay] = dense[i - 1];
    const [bx, by] = dense[i];
    cum.push(cum[i - 1] + Math.hypot((bx - ax) * LAT_SCALE, by - ay));
  }
  const length = cum[cum.length - 1];

  // 等弧長重取樣 → 平面 Float32Array [x0,y0,x1,y1,...] 與法線
  const pts = new Float32Array((SAMPLES + 1) * 2);
  const nrm = new Float32Array((SAMPLES + 1) * 2);
  let k = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const target = (i / SAMPLES) * length;
    while (k < cum.length - 2 && cum[k + 1] < target) k++;
    const seg = cum[k + 1] - cum[k] || 1;
    const t = (target - cum[k]) / seg;
    const p = lerp(dense[k], dense[k + 1], t);
    pts[i * 2] = p[0];
    pts[i * 2 + 1] = p[1];
  }
  for (let i = 0; i <= SAMPLES; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(SAMPLES, i + 1);
    const dx = (pts[b * 2] - pts[a * 2]) * LAT_SCALE;
    const dy = pts[b * 2 + 1] - pts[a * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    nrm[i * 2] = -dy / l / LAT_SCALE;
    nrm[i * 2 + 1] = dx / l;
  }

  return { pts, nrm, length, samples: SAMPLES, coords: Array.from({ length: SAMPLES + 1 }, (_, i) => [pts[i * 2], pts[i * 2 + 1]]) };
}

/** 依弧長比例 u∈[0,1] 取得位置；lane 為垂直偏移（度），兩端收斂為 0 → 粒子束在起訖點匯聚 */
export function samplePath(path, u, lane, out, o) {
  const f = Math.min(0.99999, Math.max(0, u)) * path.samples;
  const i = f | 0;
  const t = f - i;
  const { pts, nrm } = path;
  const x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t;
  const y = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t;
  const taper = Math.sin(Math.PI * u);
  out[o] = x + nrm[i * 2] * lane * taper;
  out[o + 1] = y + nrm[i * 2 + 1] * lane * taper;
}

/** 路線 A：沿骨幹。條件不符時回傳 null */
function routeViaSpine(from, to, seed) {
  const a = projectOnSpine(from);
  const b = projectOnSpine(to);
  if (a.d > 0.7 || b.d > 0.7 || Math.abs(b.s - a.s) < 0.45) return null;

  const dir = Math.sign(b.s - a.s);
  const sIn = a.s + dir * 0.12;   // 往前一點才匯入 → 斜切進主幹，不會出現直角
  const sOut = b.s - dir * 0.12;
  const offset = (hash(seed) - 0.5) * 0.13; // 每條路徑在主幹內的橫向位置（形成平行光纖）

  const ctrl = [from];
  const step = 0.12;
  for (let s = sIn; dir > 0 ? s < sOut : s > sOut; s += dir * step) ctrl.push(spineAt(s, offset));
  ctrl.push(spineAt(sOut, offset), to);

  // Chaikin 角切 4 次 → 平滑流線
  let pts = ctrl;
  for (let k = 0; k < 4; k++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/** 路線 B：三次貝茲 */
function bezierRoute(from, to, seed) {
  const dist = Math.hypot((to[0] - from[0]) * LAT_SCALE, to[1] - from[1]);
  const pull = (p) => {
    const [nearest, d] = nearestOnSpine(p);
    const w = 0.62 * Math.exp(-d / 0.45) * Math.min(1, dist / 0.6);
    return lerp(p, nearest, w);
  };
  let c1 = pull(lerp(from, to, 0.33));
  let c2 = pull(lerp(from, to, 0.67));
  const nx = -(to[1] - from[1]);
  const ny = to[0] - from[0];
  const nLen = Math.hypot(nx, ny) || 1;
  const bow = (hash(seed) - 0.5) * 0.22 * dist;
  c1 = [c1[0] + (nx / nLen) * bow, c1[1] + (ny / nLen) * bow];
  c2 = [c2[0] + (nx / nLen) * bow * 0.6, c2[1] + (ny / nLen) * bow * 0.6];
  const dense = [];
  for (let i = 0; i <= 240; i++) dense.push(cubic(from, c1, c2, to, i / 240));
  return dense;
}

// ── 骨幹參數化：s = 沿骨幹的累積距離（度） ──
const SPINE_CUM = SPINE.reduce((acc, p, i) => {
  if (i === 0) return [0];
  const q = SPINE[i - 1];
  acc.push(acc[i - 1] + Math.hypot((p[0] - q[0]) * LAT_SCALE, p[1] - q[1]));
  return acc;
}, []);
const SPINE_LEN = SPINE_CUM[SPINE_CUM.length - 1];

function projectOnSpine(p) {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < SPINE.length - 1; i++) {
    const a = SPINE[i], b = SPINE[i + 1];
    const abx = (b[0] - a[0]) * LAT_SCALE, aby = b[1] - a[1];
    const apx = (p[0] - a[0]) * LAT_SCALE, apy = p[1] - a[1];
    const L2 = abx * abx + aby * aby;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / L2));
    const d = Math.hypot(apx - abx * t, apy - aby * t);
    if (d < best.d) best = { s: SPINE_CUM[i] + t * Math.sqrt(L2), d };
  }
  return best;
}

function spineAt(s, offset = 0) {
  s = Math.max(0, Math.min(SPINE_LEN, s));
  let i = 0;
  while (i < SPINE_CUM.length - 2 && SPINE_CUM[i + 1] < s) i++;
  const a = SPINE[i], b = SPINE[i + 1];
  const t = (s - SPINE_CUM[i]) / (SPINE_CUM[i + 1] - SPINE_CUM[i] || 1);
  const dx = (b[0] - a[0]) * LAT_SCALE, dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [a[0] + (b[0] - a[0]) * t + (-dy / l) * offset / LAT_SCALE, a[1] + (b[1] - a[1]) * t + (dx / l) * offset];
}

function cubic(p0, p1, p2, p3, t) {
  const m = 1 - t;
  const a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function nearestOnSpine(p) {
  let best = SPINE[0];
  let bestD = Infinity;
  for (let i = 0; i < SPINE.length - 1; i++) {
    const a = SPINE[i], b = SPINE[i + 1];
    const abx = (b[0] - a[0]) * LAT_SCALE, aby = b[1] - a[1];
    const apx = (p[0] - a[0]) * LAT_SCALE, apy = p[1] - a[1];
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = Math.hypot((p[0] - q[0]) * LAT_SCALE, p[1] - q[1]);
    if (d < bestD) { bestD = d; best = q; }
  }
  return [best, bestD];
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
