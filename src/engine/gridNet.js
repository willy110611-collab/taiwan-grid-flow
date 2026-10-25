/**
 * 真實輸電路網（OpenStreetMap 345kV／161kV 線路與超高壓變電所，ODbL）
 * ─────────────────────────────────────────────────────────────
 * 線路頂點 → 圖的節點，相鄰頂點 → 邊；線路端點與附近其他線路、變電所（約 2 公里內）接起來，
 * 讓分段畫的線連成一張網。電廠 → 負載點的粒子路線＝路網上的最短路徑（345kV 打折，偏好走主幹）。
 * 起訖點離路網太遠（例如離島）就回傳 null，改用原本的示意路線。
 */
const LAT_SCALE = Math.cos((23.7 * Math.PI) / 180);
const JOIN = 0.02;      // 端點接合距離（度，約 2 公里）
const SNAP = 0.25;      // 城市接上路網的最大距離（度，約 25 公里）
const SNAP_SRC = 0.6;   // 電廠：離岸風場經海底電纜上岸，可以遠一點
const DETOUR = 2.5;     // 路網路線比直線長超過 2.5 倍（＋0.1° 寬容）→ 多半是 OSM 少了一段線，改用示意路線
const dist = (a, b) => Math.hypot((a[0] - b[0]) * LAT_SCALE, a[1] - b[1]);

let net = null;
const cache = new Map(); // 起點節點 → { d, prev }

export const gridNet = () => net;

export function setGridNet(data) {
  const nodes = [];      // [lng, lat]
  const index = new Map();
  const adj = [];
  const id = (p) => {
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    let i = index.get(k);
    if (i === undefined) { i = nodes.push(p) - 1; index.set(k, i); adj.push([]); }
    return i;
  };
  const link = (a, b, w) => { if (a !== b) { adj[a].push([b, w]); adj[b].push([a, w]); } };
  const ends = [];
  for (const l of data.lines || []) {
    const ids = l.c.map(id);
    const f = l.kv >= 345 ? 0.7 : 1; // 345kV 主幹打折
    for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i], dist(l.c[i - 1], l.c[i]) * f);
    ends.push(ids[0], ids[ids.length - 1]);
  }
  // 端點與附近任何節點接起來（線路常在變電所前斷開）；變電所也接上附近節點
  for (const s of data.subs || []) id(s.pos);
  const cell = (x) => Math.floor(x / JOIN);
  const grid = new Map(); // 格網索引：只比對相鄰格子，不用每個端點掃全部節點
  nodes.forEach((p, i) => { const k = `${cell(p[0])},${cell(p[1])}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  const joinNear = (self) => {
    const p = nodes[self], cx = cell(p[0]), cy = cell(p[1]);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
        if (j === self) continue;
        const d = dist(p, nodes[j]);
        if (d < JOIN) link(self, j, d + 0.002);
      }
    }
  };
  for (const e of ends) joinNear(e);
  for (const s of data.subs || []) joinNear(id(s.pos));

  // 只在最大的連通網路上找路（OSM 有幾段孤立的線或變電所，接上去會走不通）
  const comp = new Int32Array(nodes.length).fill(-1);
  let best = -1, bestSize = 0;
  for (let i = 0, c = 0; i < nodes.length; i++, c++) {
    if (comp[i] >= 0) { c--; continue; }
    const stack = [i];
    comp[i] = c;
    let size = 0;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const [v] of adj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v); }
    }
    if (size > bestSize) { bestSize = size; best = c; }
  }
  const main = [];
  for (let i = 0; i < nodes.length; i++) if (comp[i] === best) main.push(i);

  net = { nodes, adj, main, lines: data.lines || [], subs: data.subs || [], source: data.source, fetched: data.fetched };
  cache.clear();
  return net;
}

function nearest(p, max) {
  let best = -1, bd = Infinity;
  for (const i of net.main) {
    const d = dist(p, net.nodes[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return bd <= max ? best : -1;
}

/** Dijkstra（節點約 3 千個，二元堆積） */
function shortest(src) {
  if (cache.has(src)) return cache.get(src);
  const n = net.nodes.length;
  const d = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = [[0, src]];
  d[src] = 0;
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [du, u] = pop();
    if (du > d[u]) continue;
    for (const [v, w] of net.adj[u]) {
      const nd = du + w;
      if (nd < d[v]) { d[v] = nd; prev[v] = u; push([nd, v]); }
    }
  }
  const res = { d, prev };
  cache.set(src, res);
  return res;
}

/** 電廠 from → 負載點 to 沿真實線路的折線；接不上路網或走不通回傳 null */
export function gridRoute(from, to) {
  if (!net) return null;
  const a = nearest(from, SNAP_SRC), b = nearest(to, SNAP);
  if (a < 0 || b < 0 || a === b) return null;
  const { d, prev } = shortest(a);
  if (!Number.isFinite(d[b])) return null;
  const chain = [];
  for (let v = b; v !== -1; v = prev[v]) chain.push(net.nodes[v]);
  chain.reverse();
  const route = [from, ...chain, to];
  let len = 0;
  for (let i = 1; i < route.length; i++) len += dist(route[i - 1], route[i]);
  return len > dist(from, to) * DETOUR + 0.1 ? null : route;
}
