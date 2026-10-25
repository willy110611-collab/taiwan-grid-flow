/**
 * 台電「今日電力資訊」公開資料（https://www.taipower.com.tw/d006/loadGraph/loadGraph/）
 * ─────────────────────────────────────────────────────────────
 * 以下格式皆於 2026-10 從台電網頁實際讀取確認，單位「萬瓩」(×10 = MW)：
 *
 *  genloadareaperc.csv  各區即時發電 / 用電（一行）
 *    2026-10-21 23:50,北發電,北用電,中發電,中用電,南發電,南用電,東發電,東用電
 *  loadareas.csv        今日各區用電曲線（每 10 分鐘一行）
 *    00:10,東部用電,南部用電,中部用電,北部用電
 *  loadfueltype.csv     今日依燃料別發電曲線（每 10 分鐘一行）
 *    00:10,燃氣,民營燃氣,燃煤,民營燃煤,汽電共生,燃料油,太陽能,風力,水力,儲能,其它再生,儲能負載
 *    （核三停機後已無核能欄；若出現 13 欄，視為最前面多了核能）
 *  loadpara.json        供電狀況：目前用電、今日尖峰預估備轉容量率與燈號
 *
 * 每個解析器都做合理性檢查，不合理就回傳 null，畫面改用「推估」而不是顯示錯誤的「即時」。
 */
const W = 10; // 萬瓩 → MW
const num = (v) => parseFloat(String(v ?? '').replace(/[",\s]/g, ''));
const lines = (text) => String(text || '').replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim()));

/** 各區即時發電與用電 */
export function parseGenLoadAreas(text) {
  const row = lines(text).filter((r) => r.length >= 9).pop();
  if (!row) return null;
  const v = row.slice(1, 9).map((x) => num(x) * W);
  if (v.some((x) => !Number.isFinite(x))) return null;
  const gen = { N: v[0], C: v[2], S: v[4], E: v[6] };
  const load = { N: v[1], C: v[3], S: v[5], E: v[7] };
  const total = Object.values(load).reduce((a, b) => a + b, 0);
  if (total < 10000 || total > 60000) return null;
  return { time: row[0], gen, load };
}

/** 今日各區用電曲線 → [{ hm, load: {N,C,S,E} }] */
export function parseLoadAreasCurve(text) {
  const out = [];
  for (const r of lines(text)) {
    if (r.length < 5) continue;
    const v = r.slice(1, 5).map(num);
    if (v.some((x) => !Number.isFinite(x))) continue;
    out.push({ hm: normHM(r[0]), load: { E: v[0] * W, S: v[1] * W, C: v[2] * W, N: v[3] * W } });
  }
  return out.length ? out : null;
}

const FUEL_COLS = ['gas', 'gas', 'coal', 'coal', 'cogen', 'oil', 'solar', 'wind', 'hydro', 'storage', 'otherRe', null];

/** 今日依燃料別發電曲線 → [{ hm, totals: {gas, coal, ...} }] */
export function parseFuelCurve(text) {
  const out = [];
  for (const r of lines(text)) {
    const vals = r.slice(1).map(num);
    if (vals.length < 12 || vals.slice(0, 8).some((x) => !Number.isFinite(x))) continue;
    const cols = vals.length >= 13 ? ['nuclear', ...FUEL_COLS] : FUEL_COLS;
    const totals = {};
    cols.forEach((f, i) => {
      if (!f || !Number.isFinite(vals[i])) return;
      totals[f] = (totals[f] || 0) + Math.max(0, vals[i] * W);
    });
    const sum = Object.entries(totals).reduce((a, [, v]) => a + v, 0);
    if (sum < 10000 || sum > 60000) continue;
    out.push({ hm: normHM(r[0]), totals });
  }
  return out.length ? out : null;
}

/** "00" → "00:00"、"7:10" → "07:10" */
function normHM(s) {
  const m = String(s).match(/(\d{1,2})(?::(\d{2}))?/);
  return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : String(s);
}

/* ───────── 供電狀況（loadpara.json）：備轉容量率與燈號 ───────── */
export function parseLoadPara(text) {
  let json;
  try { json = typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) : text; } catch { return null; }
  const found = {};
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') { walk(v); continue; }
      const n = num(String(v).replace('%', ''));
      if (/resv.*rate|備轉容量率/i.test(k) && Number.isFinite(n)) found.rate ??= n;
      else if (/resv.*cap|備轉容量(?!率)/i.test(k) && Number.isFinite(n)) found.cap ??= n;
      else if (/curr_load|目前用電/i.test(k) && Number.isFinite(n)) found.load ??= n * W;
      else if (/peak_dema_load/i.test(k) && Number.isFinite(n)) found.peakLoad ??= n * W;
      else if (/peak_hour_range/i.test(k)) found.peakHours ??= String(v).trim();
      else if (/indicator|燈號/i.test(k) && typeof v === 'string') found.indicator ??= v.trim();
      else if (/publish|時間/i.test(k) && typeof v === 'string') found.time ??= v.trim();
    }
  };
  walk(json);
  if (!Number.isFinite(found.rate) || found.rate < 0 || found.rate > 80) return null;
  // 發布日期（民國 "115.10.26(一)01:20" 或西元）→ YYYY-MM-DD，用來判斷是不是今天的預估
  const dm = /(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})/.exec(found.time || '');
  if (dm) {
    const y = +dm[1] < 1000 ? +dm[1] + 1911 : +dm[1];
    found.date = `${y}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
  }
  return { ...found, ...supplyLevel(found.rate, found.cap, found.indicator) };
}

/**
 * 台電供電燈號
 *  綠 備轉容量率 ≥ 10%｜黃 6–10%｜橘 < 6%｜紅 備轉容量 ≤ 90 萬瓩｜黑 ≤ 50 萬瓩
 */
export const SUPPLY_LEVELS = [
  { level: 0, key: 'G', label: '供電充裕', color: [110, 240, 160] },
  { level: 1, key: 'Y', label: '供電吃緊', color: [255, 214, 92] },
  { level: 2, key: 'O', label: '供電警戒', color: [255, 150, 60] },
  { level: 3, key: 'R', label: '限電警戒', color: [255, 80, 80] },
  { level: 4, key: 'B', label: '限電準備', color: [160, 160, 170] }
];
export function supplyLevel(rate, cap, indicator) {
  const byKey = indicator && SUPPLY_LEVELS.find((s) => s.key === String(indicator).toUpperCase()[0]);
  if (byKey) return byKey;
  const capWan = Number.isFinite(cap) ? (cap > 2000 ? cap / 10 : cap) : null;
  if (capWan != null && capWan <= 50) return SUPPLY_LEVELS[4];
  if (capWan != null && capWan <= 90) return SUPPLY_LEVELS[3];
  if (rate < 6) return SUPPLY_LEVELS[2];
  if (rate < 10) return SUPPLY_LEVELS[1];
  return SUPPLY_LEVELS[0];
}

/* ───────── 台電「未來二個月電力供需預測」forecast.csv ───────── */
/**
 * 欄位：日期、預估淨尖峰供電能力(萬瓩)、預估瞬時尖峰負載(萬瓩)、預估尖峰備轉容量(萬瓩)、預估尖峰備轉容量率(%)
 * 日期可能是 2026/10/22、2026-10-22、115/10/22 或 1151022，統一轉成 YYYY-MM-DD
 */
export function parseForecast(text) {
  const out = [];
  for (const r of lines(text)) {
    const d = normDate(r[0]);
    if (!d) continue;
    const v = r.slice(1).map(num);
    if (v.length < 4 || v.slice(0, 4).some((x) => !Number.isFinite(x))) continue;
    const [cap, peak, resv, rate] = v;
    if (rate < 0 || rate > 80) continue;
    out.push({ date: d, cap: cap * W, peak: peak * W, resv: resv * W, rate, ...supplyLevel(rate, resv) });
  }
  return out.length ? out : null;
}

function normDate(s) {
  const t = String(s || '').replace(/["\s]/g, '');
  let m = t.match(/^(\d{3,4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) {
    const c = t.match(/^(\d{3})(\d{2})(\d{2})$/) || t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (c) m = c;
  }
  if (!m) return null;
  let y = Number(m[1]);
  if (y < 1911) y += 1911; // 民國年
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}
