/**
 * 水模式地圖圖層（MapLibre 原生圖層，和電力的 deck.gl 圖層分開）
 * ─────────────────────────────────────────────────────────────
 *  ・淨水場：台水「淨水場位置及供水轄區」（data.gov.tw 36602）真實座標
 *  ・水庫：水利署「水庫基本資料」（32726）＋ OSM 水庫範圍中心；蓄水率來自「水庫水情資料」（45501，建置時抓）
 *      水利署要求不要用綠黃橙紅表示蓄水率（避免和水情燈號混淆）→ 全部用同一個藍色，只用填滿程度表示
 *  ・管線：臺北市工務局公共管線圖資（真實位置，僅供參考）；管徑 ≥ 300 mm 一開始就載入，小管放大到 14 級以上才依畫面範圍分格載入
 *  資料檔都在 public/water/（scripts/water/build-static.py 產生）與 public/data/water-live.json（scripts/water-live.mjs）
 */
const BASE = './water/';
const SMALL_ZOOM = 14;
const MAX_TILES = 48;
const BLUE = '#5fd4ff';

const fc = (features) => ({ type: 'FeatureCollection', features });
const lineFeatures = (arr) => arr.map(([d, c]) => {
  const coords = [];
  for (let i = 0; i + 1 < c.length; i += 2) coords.push([c[i], c[i + 1]]);
  return { type: 'Feature', properties: { d }, geometry: { type: 'LineString', coordinates: coords } };
});
// 樣式本身載入完就能加圖層（isStyleLoaded() 會等圖磚，地形圖磚載入中時一直是 false）
const styleReady = (m) => new Promise((resolve) => {
  const ok = () => m.style?._loaded;
  if (ok()) return resolve();
  const chk = () => { if (ok()) { m.off('styledata', chk); m.off('idle', chk); resolve(); } };
  m.on('styledata', chk);
  m.on('idle', chk);
});
const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export async function loadWaterData() {
  const [plants, reservoirs, trunk, live] = await Promise.all([
    getJson(`${BASE}plants.json`), getJson(`${BASE}reservoirs.json`), getJson(`${BASE}taipei-trunk.json`), getJson('./data/water-live.json')
  ]);
  const res = (reservoirs?.reservoirs || []).map((r) => {
    const l = live?.reservoirs?.[r.id];
    const pct = l && r.cap > 0 ? Math.max(0, Math.min(100, (l.eff / r.cap) * 100)) : null;
    return { ...r, eff: l?.eff ?? null, t: l?.t || null, pct };
  });
  const withPct = res.filter((r) => r.pct != null && r.cap > 0);
  const capSum = withPct.reduce((a, r) => a + r.cap, 0);
  return {
    plants: plants?.plants || [],
    reservoirs: res,
    trunk,
    drought: live?.drought || [],
    liveT: live?.t || null,
    total: capSum > 0 ? { pct: (withPct.reduce((a, r) => a + r.eff, 0) / capSum) * 100, n: withPct.length, eff: withPct.reduce((a, r) => a + r.eff, 0), cap: capSum } : null,
    sources: [plants?.source, reservoirs?.source, trunk?.source].filter(Boolean)
  };
}

export class WaterLayers {
  constructor(map, { onSelect } = {}) {
    this.map = map;
    this.onSelect = onSelect;
    this.visible = false;
    this.layers = { res: true, plants: true, pipes: true };
    this.tiles = new Map(); // 'x_y' → features
    this.tileSet = null;
  }

  async init() {
    if (this.ready) return this.data;
    const m = this.map;
    const [data] = await Promise.all([loadWaterData(), styleReady(m)]);
    if (this.ready) return this.data; // 同時呼叫兩次
    this.data = data;
        m.addSource('w-trunk', { type: 'geojson', data: fc(this.data.trunk ? lineFeatures(this.data.trunk.lines) : []) });
    m.addSource('w-small', { type: 'geojson', data: fc([]) });
    m.addSource('w-plants', { type: 'geojson', data: fc(this.data.plants.map((p, i) => ({ type: 'Feature', id: i, properties: { i }, geometry: { type: 'Point', coordinates: p.p } }))) });
    m.addSource('w-res', { type: 'geojson', data: fc(this.data.reservoirs.map((r, i) => ({ type: 'Feature', id: i, properties: { i, cap: r.cap || 0, pct: r.pct ?? -1 }, geometry: { type: 'Point', coordinates: r.p } }))) });
    m.addSource('w-sel', { type: 'geojson', data: fc([]) });
    // 水庫半徑：容量（萬 m³）開根號，曾文約 25 px、翡翠約 22 px、小水庫約 6 px；放大時跟著變大
    // （MapLibre 規定 zoom 只能放在最外層的 interpolate）
    const base = ['+', 4, ['*', 0.12, ['sqrt', ['get', 'cap']]]];
    const R = (k = 1, extra = 1) => ['interpolate', ['linear'], ['zoom'], 6, ['*', base, 0.8 * k, extra], 9, ['*', base, 1.4 * k, extra], 12, ['*', base, 2.4 * k, extra]];
    const pctK = ['sqrt', ['/', ['max', ['get', 'pct'], 0], 100]];
    const w = (b) => ['interpolate', ['linear'], ['zoom'], 7, b * 0.25, 12, b, 16, b * 2.4];
    const add = (layer) => m.addLayer({ ...layer, layout: { ...(layer.layout || {}), visibility: 'none' } });
    add({ id: 'w-small', type: 'line', source: 'w-small', minzoom: SMALL_ZOOM - 0.5, paint: { 'line-color': '#5c6f99', 'line-width': w(0.5), 'line-opacity': 0.55 } });
    add({ id: 'w-trunk-s', type: 'line', source: 'w-trunk', filter: ['<', ['get', 'd'], 600], paint: { 'line-color': '#6f86b8', 'line-width': w(0.6), 'line-opacity': 0.6 } });
    add({ id: 'w-trunk-m', type: 'line', source: 'w-trunk', filter: ['all', ['>=', ['get', 'd'], 600], ['<', ['get', 'd'], 1000]], paint: { 'line-color': '#7fb8ff', 'line-width': w(1.2), 'line-opacity': 0.8 } });
    add({ id: 'w-trunk-l-glow', type: 'line', source: 'w-trunk', filter: ['>=', ['get', 'd'], 1000], paint: { 'line-color': BLUE, 'line-width': w(6), 'line-opacity': 0.16, 'line-blur': 3 } });
    add({ id: 'w-trunk-l', type: 'line', source: 'w-trunk', filter: ['>=', ['get', 'd'], 1000], paint: { 'line-color': BLUE, 'line-width': w(2), 'line-opacity': 0.95 } });
    add({ id: 'w-res-halo', type: 'circle', source: 'w-res', paint: { 'circle-radius': R(1.5), 'circle-color': BLUE, 'circle-opacity': 0.1, 'circle-blur': 0.6 } });
    // 蓄水率：內圈半徑跟著百分比（同一個藍色）；讀不到的只畫外框
    add({ id: 'w-res-fill', type: 'circle', source: 'w-res', filter: ['>=', ['get', 'pct'], 0], paint: { 'circle-radius': R(1, pctK), 'circle-color': BLUE, 'circle-opacity': 0.5 } });
    add({ id: 'w-res-ring', type: 'circle', source: 'w-res', paint: { 'circle-radius': R(), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': BLUE, 'circle-stroke-width': 1.3, 'circle-stroke-opacity': 0.9 } });
    add({ id: 'w-plants-glow', type: 'circle', source: 'w-plants', paint: { 'circle-radius': w(5), 'circle-color': BLUE, 'circle-opacity': 0.12, 'circle-blur': 1 } });
    add({ id: 'w-plants', type: 'circle', source: 'w-plants', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 3, 14, 5], 'circle-color': '#c6f6ff' } });
    add({ id: 'w-sel', type: 'circle', source: 'w-sel', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.6 } });
    add({ id: 'w-sel-line', type: 'line', source: 'w-sel', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.9 } });
    this.tileSet = new Set(this.data.trunk?.tiles || []);
    m.on('moveend', this.onMove);
    m.on('click', this.onClick);
    this.ready = true;
    return this.data;
  }

  ids() { return ['w-small', 'w-trunk-s', 'w-trunk-m', 'w-trunk-l-glow', 'w-trunk-l', 'w-res-halo', 'w-res-fill', 'w-res-ring', 'w-plants-glow', 'w-plants', 'w-sel', 'w-sel-line']; }
  group(id) { return id.startsWith('w-res') ? 'res' : id.startsWith('w-plants') ? 'plants' : id.startsWith('w-sel') ? 'sel' : 'pipes'; }

  apply() {
    for (const id of this.ids()) {
      if (!this.map.getLayer(id)) continue;
      const g = this.group(id);
      const on = this.visible && (g === 'sel' || this.layers[g]);
      this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }

  async show() { await this.init(); this.visible = true; this.apply(); this.onMove(); return this.data; }
  hide() { this.visible = false; if (this.ready) { this.apply(); this.select(null); } }
  setLayers(next) { this.layers = { ...this.layers, ...next }; this.apply(); }

  /** 小管：放大到 14 級以上，只載入畫面範圍內有資料的格子 */
  onMove = async () => {
    if (!this.visible || !this.layers.pipes || this.map.getZoom() < SMALL_ZOOM - 0.5 || !this.tileSet?.size) return;
    const T = this.data.trunk.tile;
    const b = this.map.getBounds();
    const want = [];
    for (let x = Math.floor(b.getWest() / T); x <= Math.floor(b.getEast() / T); x++)
      for (let y = Math.floor(b.getSouth() / T); y <= Math.floor(b.getNorth() / T); y++) if (this.tileSet.has(`${x}_${y}`)) want.push(`${x}_${y}`);
    if (want.length > 24) return; // 範圍太大（不該發生在 14 級）就不載
    const miss = want.filter((k) => !this.tiles.has(k));
    if (miss.length) {
      const got = await Promise.all(miss.map((k) => getJson(`${BASE}taipei/${k}.json`)));
      miss.forEach((k, i) => this.tiles.set(k, got[i] ? lineFeatures(got[i]) : []));
      while (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value);
    }
    this.map.getSource('w-small')?.setData(fc(want.flatMap((k) => this.tiles.get(k) || [])));
  };

  onClick = (e) => {
    if (!this.visible) return;
    const pad = matchMedia('(pointer: coarse)').matches ? 12 : 5;
    const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
    const layers = ['w-plants', 'w-res-ring', 'w-res-fill', 'w-trunk-l', 'w-trunk-m', 'w-trunk-s', 'w-small'].filter((id) => this.map.getLayer(id) && this.map.getLayoutProperty(id, 'visibility') === 'visible');
    const hits = this.map.queryRenderedFeatures(box, { layers });
    // 點：選離手指最近的（水庫圈裡常有淨水場）；沒有點才選管線
    const near = (f) => { const q = this.map.project(f.geometry.coordinates); return Math.hypot(q.x - e.point.x, q.y - e.point.y); };
    const score = (f) => near(f) - (f.layer.id.startsWith('w-res') ? 10 : 0); // 水庫中心附近優先選水庫
    const pts = hits.filter((f) => f.geometry.type === 'Point').sort((a, b) => score(a) - score(b));
    const hit = pts[0] || hits[0];
    if (!hit) { this.select(null); this.onSelect?.(null); return; }
    let sel;
    if (hit.layer.id === 'w-plants') sel = { kind: 'plant', ...this.data.plants[hit.properties.i], pos: this.data.plants[hit.properties.i].p };
    else if (hit.layer.id.startsWith('w-res')) sel = { kind: 'res', ...this.data.reservoirs[hit.properties.i], pos: this.data.reservoirs[hit.properties.i].p };
    else {
      const c = hit.geometry.type === 'LineString' ? hit.geometry.coordinates : hit.geometry.coordinates[0];
      let len = 0;
      for (let i = 1; i < c.length; i++) len += Math.hypot((c[i][0] - c[i - 1][0]) * 101000, (c[i][1] - c[i - 1][1]) * 111000);
      sel = { kind: 'pipe', d: hit.properties.d, len, coords: c, pos: [e.lngLat.lng, e.lngLat.lat] };
    }
    this.select(sel);
    this.onSelect?.(sel);
  };

  select(sel) {
    const src = this.map.getSource('w-sel');
    if (!src) return;
    if (!sel) return src.setData(fc([]));
    src.setData(fc([sel.kind === 'pipe'
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: sel.coords } }
      : { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: sel.pos } }]));
  }

  destroy() { this.map.off('moveend', this.onMove); this.map.off('click', this.onClick); }
}
