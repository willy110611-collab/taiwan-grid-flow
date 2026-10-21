/**
 * 日夜節律 — 依台灣當下的太陽高度角，讓底圖在「夜 → 晨昏 → 白晝」之間緩慢過渡
 * （仿軌島放空模式的日夜天色，但維持整體暗色調，讓能量光點始終是主角）
 */
const RAD = Math.PI / 180;
const TW = { lat: 23.7, lon: 120.9 };

/** 太陽高度角（度）。NOAA 簡化公式，誤差約 ±0.5°，對視覺用途綽綽有餘 */
export function sunElevation(date = new Date(), lat = TW.lat, lon = TW.lon) {
  const d = date.getTime() / 86400000 - 10957.5; // 距 J2000.0 的日數
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const h = (gmst * 15 + lon) * RAD - ra;
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(h)) / RAD;
}

/** 今天（台灣日期）的日出、日落時間 "HH:MM" */
export function sunTimes(date = new Date()) {
  const tw = new Date(date.getTime() + 8 * 3600e3);
  const midnightUtc = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600e3;
  let rise = null, set = null;
  let prev = sunElevation(new Date(midnightUtc));
  for (let m = 2; m <= 1440; m += 2) {
    const cur = sunElevation(new Date(midnightUtc + m * 60000));
    if (prev < -0.833 && cur >= -0.833 && rise === null) rise = m;
    if (prev >= -0.833 && cur < -0.833) set = m;
    prev = cur;
  }
  const fmt = (m) => (m == null ? '--:--' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return { sunrise: fmt(rise), sunset: fmt(set) };
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 = 深夜、1 = 白晝；twilight = 晨昏霞光強度 */
export function daylightState(date = new Date()) {
  const elev = sunElevation(date);
  const day = smooth(-6, 10, elev);
  const twilight = Math.exp(-(((elev + 1.5) / 5.5) ** 2));
  const phase = elev > 6 ? 'day' : elev > -6 ? 'twilight' : 'night';
  return { elev, day, twilight, phase };
}

// ── 三組色票：夜（預設）、白晝、晨昏霞光 ──
const NIGHT = { sea: '#02040a', land: '#0b1222', county: '#23324d', coastGlow: '#2b5d8f', coast: '#6f9fd6', hl: '#22324f', sky: '#0a1430' };
const DAY   = { sea: '#071322', land: '#16253b', county: '#36537d', coastGlow: '#3f80bb', coast: '#a9cdf2', hl: '#3c577d', sky: '#1d4a7a' };
const DUSK  = { sea: '#120a1d', land: '#24182e', county: '#53395a', coastGlow: '#a35c86', coast: '#f0b08a', hl: '#5c4058', sky: '#a8507a' };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));

export function daylightPalette(state) {
  const out = {};
  for (const k of Object.keys(NIGHT)) {
    out[k] = mix(mix(NIGHT[k], DAY[k], state.day * 0.85), DUSK[k], state.twilight * 0.6);
  }
  return out;
}

/** 套用到 MapLibre 底圖圖層 */
export function applyDaylight(map, palette) {
  const set = (layer, prop, v) => {
    try { if (map.getLayer(layer)) map.setPaintProperty(layer, prop, v); } catch { /* 樣式尚未載入 */ }
  };
  set('sea', 'background-color', palette.sea);
  set('sea-mask', 'fill-color', palette.sea);
  set('land', 'fill-color', palette.land);
  set('counties', 'line-color', palette.county);
  set('coast-glow', 'line-color', palette.coastGlow);
  set('coast', 'line-color', palette.coast);
  set('hillshade', 'hillshade-highlight-color', palette.hl);
}
