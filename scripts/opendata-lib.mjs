/**
 * 台電開放資料 → 網頁用的精簡 JSON（建置時執行，見 scripts/opendata.mjs）
 * 這個檔案只有純函式（沒有 Node 專用 API），瀏覽器也能跑，方便測試。
 *
 *  D1 計畫性工作停電   d077004/001.zip  → outages.json
 *  D3 各鄉鎮市區用電   d007025/dist_kwh_YYY.csv → towns-kwh.json
 *  D4 過去電力供需     d006005/001.csv  → supply-history.json
 *  D6 縣市再生能源躉購 d007011/001.csv  → renew.json
 */

export const norm = (s) => String(s ?? '').trim().replace(/臺/g, '台').replace(/\s+/g, '');
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[",\s]/g, '')); return Number.isFinite(n) ? n : null; };

/** 簡單 CSV（支援雙引號欄位） */
export function csvRows(text) {
  const out = [];
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    out.push(cells);
  }
  return out;
}

/* ───────── ZIP（只支援 deflate / store，台電的檔案就是這兩種） ───────── */
export async function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是 ZIP 檔');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 目錄損壞');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const fl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + fl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + size);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`ZIP 壓縮方式 ${method} 不支援`);
    files[name] = data;
    p += 46 + fl + el + cl;
  }
  return files;
}

/** UTF-8 為主，解不出來改 Big5 */
export function decode(u8) {
  const t = new TextDecoder('utf-8').decode(u8);
  if (!/�/.test(t)) return t;
  try { const b = new TextDecoder('big5').decode(u8); if ((b.match(/�/g) || []).length < (t.match(/�/g) || []).length) return b; } catch { /* 保持 utf-8 */ }
  return t;
}

/* ───────── 鄉鎮對照 ───────── */
/** 郵遞區號（前三碼）→ 縣市 */
const ZIP_COUNTY = [
  [100, 116, '台北市'], [200, 206, '基隆市'], [207, 208, '新北市'], [209, 212, '連江縣'], [220, 253, '新北市'],
  [260, 272, '宜蘭縣'], [300, 300, '新竹市'], [302, 315, '新竹縣'], [320, 338, '桃園市'], [350, 369, '苗栗縣'],
  [400, 439, '台中市'], [500, 530, '彰化縣'], [540, 558, '南投縣'], [600, 600, '嘉義市'], [602, 625, '嘉義縣'],
  [630, 655, '雲林縣'], [700, 745, '台南市'], [800, 852, '高雄市'], [880, 885, '澎湖縣'], [890, 896, '金門縣'],
  [900, 947, '屏東縣'], [950, 966, '台東縣'], [970, 983, '花蓮縣']
];
export const zipCounty = (zip) => { const z = parseInt(zip, 10); return ZIP_COUNTY.find(([a, b]) => z >= a && z <= b)?.[2] || null; };

/** 「北斗」「北斗鎮」「彰化縣北斗鎮」都對到 TOWNS 的同一筆；找不到回 null */
const stem = (s) => (s.length > 2 ? s.replace(/[鄉鎮市區]$/, '') : s);
export function matchTown(towns, county, name) {
  const c = norm(county), n = norm(name).replace(new RegExp(`^${c}`), '');
  if (!n) return null;
  const list = towns.filter((t) => norm(t[0]) === c);
  return list.find((t) => norm(t[1]) === n) || list.find((t) => stem(norm(t[1])) === n || stem(norm(t[1])) === stem(n)) || null;
}

/** 舊縣名（停電資料偶爾還會出現）→ 現在的縣市 */
const OLD_COUNTY = { 台北縣: '新北市', 桃園縣: '桃園市', 台中縣: '台中市', 台南縣: '台南市', 高雄縣: '高雄市' };
const centroid = (list) => [list.reduce((a, t) => a + t[2], 0) / list.length, list.reduce((a, t) => a + t[3], 0) / list.length].map((v) => Math.round(v * 1000) / 1000);

/** 停電範圍文字「彰化縣北斗鎮光復路」→ { county, town, road, pos } */
export function splitPlace(towns, text) {
  const s = norm(text);
  const m = s.match(/^(..[縣市])/);
  if (!m) return null;
  const county = OLD_COUNTY[m[1]] || m[1];
  const rest = s.slice(m[1].length);
  const cand = towns.filter((t) => norm(t[0]) === county).sort((a, b) => b[1].length - a[1].length);
  if (!cand.length) return null;
  let hit = cand.find((t) => rest.startsWith(norm(t[1])));
  let used = hit ? norm(hit[1]).length : 0;
  if (!hit && OLD_COUNTY[m[1]]) { // 舊制「大里市」「岡山鎮」→ 大里區、岡山區
    hit = cand.find((t) => { const st = stem(norm(t[1])); return rest.startsWith(st) && /[鄉鎮市]/.test(rest[st.length] || ''); });
    used = hit ? stem(norm(hit[1])).length + 1 : 0;
  }
  if (hit) return { county, town: hit[1], road: rest.slice(used), pos: [hit[2], hit[3]] };
  // 新竹市、嘉義市常常沒寫區 → 用整個市的中心
  return { county, town: '', road: rest, pos: centroid(cand) };
}

/* ───────── D1 計畫性工作停電 ───────── */
/** 「2026/10/27 09:00~15:00」→ { date:'2026-10-27', from:'09:00', to:'15:00' } */
export function parseSlot(s) {
  const m = String(s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})\s*[~～-]\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  const p2 = (x) => String(x).padStart(2, '0');
  return { date: `${m[1]}-${p2(m[2])}-${p2(m[3])}`, from: m[4].padStart(5, '0'), to: m[5].padStart(5, '0') };
}

/**
 * 同一個請求號數、同一時段、同一鄉鎮 → 一筆，路段合併
 * today：'YYYY-MM-DD'（台灣日期），只留今天起 days 天內
 */
export function parseOutages(files, towns, today, days = 10) {
  const end = new Date(Date.parse(today) + days * 864e5).toISOString().slice(0, 10);
  const groups = new Map();
  let rows = 0, bad = 0;
  for (const [name, u8] of Object.entries(files)) {
    if (!/^\d+\.csv$/i.test(name)) continue;
    const table = csvRows(decode(u8));
    const head = table.shift() || [];
    const col = (re) => head.findIndex((h) => re.test(h));
    const ci = { office: col(/區處/), id: col(/請求號/), work: col(/工作/), t1: col(/第一次/), t2: col(/第二次/), range: col(/範圍/) };
    if (ci.t1 < 0 || ci.range < 0) { bad++; continue; }
    for (const c of table) {
      rows++;
      const s1 = parseSlot(c[ci.t1]);
      if (!s1 || s1.date < today || s1.date > end) continue;
      const s2 = parseSlot(c[ci.t2]);
      const place = splitPlace(towns, c[ci.range]);
      if (!place) continue;
      const key = [c[ci.id], s1.date, s1.from, place.county, place.town].join('|');
      let g = groups.get(key);
      if (!g) {
        g = { id: c[ci.id] || '', date: s1.date, from: s1.from, to: s1.to, county: place.county, town: place.town, pos: place.pos, roads: [], work: norm(c[ci.work]), office: norm(c[ci.office]).replace(/^台電/, '') };
        if (s2) g.second = s2;
        groups.set(key, g);
      }
      if (place.road && !g.roads.includes(place.road)) g.roads.push(place.road);
    }
  }
  const list = [...groups.values()].sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from) || a.county.localeCompare(b.county));
  return { list, rows, bad };
}

/* ───────── D3 各鄉鎮市區住宅用電 ───────── */
/**
 * 只取「1表燈非營業用」（住宅為主）：每月 售電度數 ÷ 用戶數 → 每戶平均度數
 * texts：{ 114: csvText, 115: csvText }（民國年）
 * 回傳 { months:['2025-10',…], towns:{ '彰化縣北斗鎮': { zip, users, avg:[…] } }, counties:{ '彰化縣': { avg:[…] } } }
 */
export function parseTownKwh(texts, towns, keepMonths = 12) {
  const raw = new Map(); // key → { county, town, zip, byMonth: {ym: {kwh, users}} }
  const allMonths = new Set();
  for (const text of Object.values(texts)) {
    const table = csvRows(text);
    const head = table.shift() || [];
    const col = (re) => head.findIndex((h) => re.test(h));
    const ci = { y: col(/年度/), m: col(/月份/), zip: col(/郵遞/), name: col(/行政區/), item: col(/項目/), users: col(/用戶數/), kwh: col(/售電度數/) };
    for (const c of table) {
      if (!/^1表燈非營業用$/.test(norm(c[ci.item]))) continue;
      const users = num(c[ci.users]), kwh = num(c[ci.kwh]);
      const y = parseInt(c[ci.y], 10) + 1911, m = parseInt(c[ci.m], 10);
      if (!users || users < 6 || kwh == null || !(y > 2000) || !(m >= 1 && m <= 12)) continue;
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const county = zipCounty(c[ci.zip]);
      if (!county) continue;
      const t = matchTown(towns, county, c[ci.name]);
      const town = t ? t[1] : '';
      const key = county + town;
      const r = raw.get(key) || raw.set(key, { county, town, zip: String(c[ci.zip]).trim(), byMonth: {} }).get(key);
      const b = r.byMonth[ym] || (r.byMonth[ym] = { kwh: 0, users: 0 });
      b.kwh += kwh; b.users += users;
      allMonths.add(ym);
    }
  }
  // 台電住宅大多兩個月抄表一次，同一鄉鎮的單月度數會一高一低（抄表月才計入）。
  // 所以每個月都用「這個月＋上個月」合計再除以 2，代表最近兩個月的平均每月用電。
  const sorted = [...allMonths].sort();
  const months = sorted.slice(-keepMonths);
  const prevOf = (ym) => sorted[sorted.indexOf(ym) - 1];
  const avg2 = (byMonth, ym) => {
    const a = byMonth[ym], b = byMonth[prevOf(ym)];
    if (!a || !b || !a.users || !b.users) return null;
    return Math.round((a.kwh + b.kwh) / ((a.users + b.users) / 2) / 2);
  };
  const yearAvg = (byMonth) => {
    const ms = months.filter((ym) => byMonth[ym]?.users);
    if (ms.length < 12) return null;
    const kwh = ms.reduce((s, ym) => s + byMonth[ym].kwh, 0), users = ms.reduce((s, ym) => s + byMonth[ym].users, 0) / ms.length;
    return Math.round(kwh / users / 12);
  };
  const out = { months, towns: {}, counties: {} };
  const cAgg = {}, nat = {};
  for (const [key, r] of raw) {
    const series = months.map((ym) => avg2(r.byMonth, ym));
    if (series.every((v) => v == null)) continue;
    const last = r.byMonth[months[months.length - 1]];
    out.towns[key] = { county: r.county, town: r.town, zip: r.zip, users: last?.users || null, year: yearAvg(r.byMonth), avg: series };
    const ca = cAgg[r.county] || (cAgg[r.county] = {});
    for (const [ym, b] of Object.entries(r.byMonth)) {
      for (const agg of [ca, nat]) { const x = agg[ym] || (agg[ym] = { kwh: 0, users: 0 }); x.kwh += b.kwh; x.users += b.users; }
    }
  }
  for (const [county, ca] of Object.entries(cAgg)) out.counties[county] = { year: yearAvg(ca), avg: months.map((ym) => avg2(ca, ym)) };
  out.national = { year: yearAvg(nat), avg: months.map((ym) => avg2(nat, ym)) };
  return out;
}

/* ───────── D4 過去電力供需（每日）───────── */
export function parseSupplyHistory(text) {
  const table = csvRows(text);
  const head = table.shift() || [];
  const col = (re) => head.findIndex((h) => re.test(h));
  const ci = { d: col(/日期/), cap: col(/淨尖峰供電能力/), peak: col(/尖峰負載/), resv: col(/^備轉容量\(萬瓩\)/), rate: col(/備轉容量率/), ind: col(/工業用電/), res: col(/民生用電/) };
  if (ci.d < 0 || ci.peak < 0 || ci.rate < 0) throw new Error('過去電力供需欄位不符');
  const days = [];
  for (const c of table) {
    const d = String(c[ci.d]).trim();
    if (!/^\d{8}$/.test(d)) continue;
    const peak = num(c[ci.peak]), rate = num(c[ci.rate]);
    if (peak == null || rate == null) continue;
    days.push([`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, Math.round(peak * 10), Math.round(rate * 100) / 100, Math.round((num(c[ci.cap]) || 0) * 10)]);
  }
  days.sort((a, b) => a[0].localeCompare(b[0]));
  return { cols: ['date', 'peakMw', 'reservePct', 'capMw'], days };
}

/* ───────── D6 縣市再生能源躉購 ───────── */
export function parseRenew(text) {
  const table = csvRows(text);
  const head = table.shift() || [];
  const col = (re) => head.findIndex((h) => re.test(h));
  const ci = {
    y: col(/年度/), c: col(/縣市/),
    windN: col(/^風力件數/), windKw: col(/^風力躉購容量/), windKwh: col(/^風力本年累計購電度數/),
    pvN: col(/^太陽光電件數/), pvKw: col(/^太陽光電躉購容量/), pvKwh: col(/^太陽光電本年累計購電度數/),
    otN: col(/^其他.*件數/), otKw: col(/^其他.*躉購容量/), otKwh: col(/^其他.*購電度數/)
  };
  if (ci.y < 0 || ci.c < 0 || ci.pvKwh < 0) throw new Error('再生能源躉購欄位不符');
  const byYear = {};
  for (const c of table) {
    const y = parseInt(c[ci.y], 10);
    const county = norm(c[ci.c]).replace(/\(.*\)$/, '');
    if (!(y > 90) || !/[縣市]$/.test(county)) continue;
    const g = (i) => (i < 0 ? 0 : num(c[i]) || 0);
    (byYear[y] ||= []).push({ county, wind: { n: g(ci.windN), kw: g(ci.windKw), kwh: g(ci.windKwh) }, pv: { n: g(ci.pvN), kw: g(ci.pvKw), kwh: g(ci.pvKwh) }, other: { n: g(ci.otN), kw: g(ci.otKw), kwh: g(ci.otKwh) } });
  }
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
  const latest = years[0];
  return { year: latest ? latest + 1911 : null, prevYear: years[1] ? years[1] + 1911 : null, counties: byYear[latest] || [], prev: byYear[years[1]] || [] };
}
