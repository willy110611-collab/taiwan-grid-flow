import { HOLIDAYS } from './advice.js';

/**
 * 店家用電分析（智慧電表 AMI 每 15 分鐘用電 → 每月尖峰／半尖峰／離峰 + 三種電價試算）
 * ─────────────────────────────────────────────────────────────
 * 電價：台電「表燈」電價（114/10/1 公告；115/4/1 凍漲沿用）。已於 2026-10-24 對照台電官方《簡要電價表》逐項核對
 *  ・營業用非時間電價：依每月度數累進
 *  ・簡易型時間電價二段式／三段式：住宅、營業用相同；基本費每戶每月 75 元；每月超過 2000 度部分每度加 1.04 元
 * 時段（週一至週五；週六、週日及離峰日全日離峰）：
 *  二段式  夏月（6/1–9/30）09–24 尖峰；非夏月 06–11、14–24 尖峰
 *  三段式  夏月 16–22 尖峰、09–16 及 22–24 半尖峰；非夏月 06–11、14–24 半尖峰（無尖峰）
 * 低壓電力（參考）：同一份《簡要電價表》第 6–7 頁，基本電費依「經常契約」容量（瓩）計收
 *  非時間  經常契約 236.20／173.20 元/瓩/月；流動 4.08／3.87 元/度
 *  二段式  按戶 262.50 元/月＋經常契約；尖峰 5.54／5.39、週六半尖峰 2.76／2.65、離峰 2.27／2.15
 *  三段式  按戶 262.50 元/月＋經常契約；尖峰 8.12（夏月）、半尖峰 5.02／4.86、週六半尖峰 2.50／2.40、離峰 2.23／2.12
 *  週六：二段式尖峰時段、三段式半尖峰時段改按「週六半尖峰」；週日與國定假日全日離峰
 * 帳單兩個月一期：營業用累進級距加倍、每期超過 4,000 度才加價（依台電電價表附註）
 * 資料只存在這台裝置（localStorage），不會上傳。
 */
export const RATES = {
  version: '115/4/1',
  biz: [[330, 2.71, 2.28], [700, 3.76, 3.10], [1500, 4.46, 3.61], [3000, 7.08, 5.56], [Infinity, 7.43, 5.83]],
  two: { base: 75, peak: [5.16, 4.93], off: [2.06, 1.99] },
  three: { base: 75, peak: [7.13, null], half: [4.69, 4.48], off: [2.06, 1.99] },
  over2000: 1.04,
  lv: {
    flat: { contract: [236.2, 173.2], kwh: [4.08, 3.87] },
    two: { base: 262.5, contract: [236.2, 173.2], peak: [5.54, 5.39], sat: [2.76, 2.65], off: [2.27, 2.15] },
    three: { base: 262.5, contract: [236.2, 173.2], peak: [8.12, null], half: [5.02, 4.86], sat: [2.5, 2.4], off: [2.23, 2.12] }
  }
};
export const LV_NAMES = { lv1: '低壓電力（非時間）', lv2: '低壓電力時間電價（二段式）', lv3: '低壓電力時間電價（三段式）' };
export const PLAN_NAMES = { biz: '營業用一般電價', two: '簡易型時間電價（二段式）', three: '簡易型時間電價（三段式）' };

const pad = (n) => String(n).padStart(2, '0');

/* ───────── 時段判斷（以「台灣當地時間」的年月日時分計算） ───────── */
function dayInfo(y, m, d) {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const holiday = HOLIDAYS.has(`${y}-${pad(m)}-${pad(d)}`);
  const off = dow === 0 || dow === 6 || holiday;
  return { summer: m >= 6 && m <= 9, off, sat: dow === 6 && !holiday };
}
export function periodOf(y, m, d, h) {
  const { summer, off, sat } = dayInfo(y, m, d);
  const two = summer ? (h >= 9 ? 'peak' : 'off') : ((h >= 6 && h < 11) || h >= 14 ? 'peak' : 'off');
  const three = summer
    ? (h >= 16 && h < 22 ? 'peak' : h >= 9 ? 'half' : 'off')
    : ((h >= 6 && h < 11) || h >= 14 ? 'half' : 'off');
  // 低壓電力：週六的尖峰／半尖峰時段改算「週六半尖峰」
  const lvSat = sat && two === 'peak' ? 'sat' : 'off';
  if (off) return { two: 'off', three: 'off', lv2: lvSat, lv3: lvSat, summer, dayOff: true };
  return { two, three, lv2: two, lv3: three, summer, dayOff: false };
}

/* ───────── CSV 解析（盡量寬鬆：直式「時間,度數」或橫式「日期,96 個時段」都可以） ───────── */
const DATE_RE = /(\d{2,4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?(?:[\sT]*(\d{1,2}):(\d{2})(?::\d{2})?)?/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
const num = (s) => { const v = parseFloat(String(s).replace(/[,\s"]/g, '')); return Number.isFinite(v) ? v : null; };

function splitLine(line, delim) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function parseDate(cell) {
  const m = String(cell).match(DATE_RE);
  if (!m) return null;
  let y = +m[1]; if (y < 1911) y += 1911; // 民國年
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d, h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
}
/** 台灣當地時間 → 「假 UTC」毫秒（只拿來排序、算間隔、取年月日時，不做時區換算） */
const ms = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

export function parseMeterCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) throw new Error('檔案內容太少');
  const sample = lines.slice(0, 20).join('\n');
  const delim = [',', '\t', ';'].map((c) => [c, sample.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = lines.map((l) => splitLine(l, delim));

  // 表頭：第一個「沒有日期」的列（取最後一個，略過說明文字）
  const firstData = rows.findIndex((r) => r.some((c) => parseDate(c)));
  if (firstData < 0) throw new Error('找不到日期欄位（需要像 2026/10/01 00:15 的時間）');
  const header = firstData > 0 ? rows[firstData - 1].map((h) => h.toLowerCase()) : [];
  const data = rows.slice(firstData);

  // 橫式：一列 = 一天，後面接 24／48／96 個數字
  const r0 = data[0];
  const dIdx = r0.findIndex((c) => parseDate(c));
  const nums0 = r0.slice(dIdx + 1).map(num).filter((v) => v != null);
  const d0 = parseDate(r0[dIdx]);
  let points = [];
  let interval;
  if (d0.h == null && !r0.slice(dIdx + 1).some((c) => TIME_RE.test(c)) && [24, 48, 96, 92, 100].includes(nums0.length) || nums0.length >= 24 && d0.h == null && !r0.some((c) => TIME_RE.test(c))) {
    const n = nums0.length >= 90 ? 96 : nums0.length >= 46 ? 48 : 24;
    interval = 1440 / n;
    for (const r of data) {
      const di = r.findIndex((c) => parseDate(c));
      if (di < 0) continue;
      const dt = parseDate(r[di]);
      const vals = r.slice(di + 1).map(num).filter((v) => v != null).slice(0, n);
      vals.forEach((v, i) => points.push({ t: ms(dt.y, dt.mo, dt.d) + i * interval * 60e3, v }));
    }
  } else {
    // 直式：日期(+時間) 一欄或兩欄，再來是度數
    const pick = (re) => header.findIndex((h) => re.test(h));
    let vIdx = pick(/kwh|度數|用電量|用電度|電量|使用量|有效/);
    const cumIdx = pick(/累計|指針|讀值|讀數/);
    const kwIdx = pick(/(^|[^a-z])kw($|[^h])|需量/);
    let unit = 'kwh';
    if (vIdx < 0 && cumIdx >= 0) { vIdx = cumIdx; unit = 'cum'; }
    if (vIdx < 0 && kwIdx >= 0) { vIdx = kwIdx; unit = 'kw'; }
    for (const r of data) {
      const di = r.findIndex((c) => parseDate(c));
      if (di < 0) continue;
      const dt = parseDate(r[di]);
      let h = dt.h, mi = dt.mi, used = [di];
      if (h == null) {
        const ti = r.findIndex((c, i) => i !== di && TIME_RE.test(c));
        if (ti < 0) continue;
        const tm = r[ti].match(TIME_RE); h = +tm[1]; mi = +tm[2]; used.push(ti);
      }
      let v = vIdx >= 0 ? num(r[vIdx]) : null;
      if (v == null) v = r.map((c, i) => (used.includes(i) ? null : num(c))).find((x) => x != null) ?? null;
      if (v == null) continue;
      points.push({ t: ms(dt.y, dt.mo, dt.d, h, mi), v });
    }
    if (points.length < 3) throw new Error('讀不到用電數字');
    points.sort((a, b) => a.t - b.t);
    const diffs = points.slice(1, 200).map((p, i) => (p.t - points[i].t) / 60e3).filter((x) => x > 0).sort((a, b) => a - b);
    interval = diffs[Math.floor(diffs.length / 2)] || 15;
    // 時間標在「區間結束」（00:15 代表 00:00–00:15、最後一筆 24:00）→ 往前移一格
    const tod = (t) => new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();
    const hasMidnight = points.slice(0, 400).some((p) => tod(p.t) === 0);
    const firstTod = Math.min(...points.slice(0, 400).map((p) => tod(p.t) || 1440));
    const endLabeled = !hasMidnight || (firstTod === interval && /24:00/.test(text));
    if (endLabeled || /24:00/.test(text)) points = points.map((p) => ({ ...p, t: p.t - interval * 60e3 }));
    // 累計讀數 → 相減成每區間用電
    const mono = points.filter((p, i) => i && p.v >= points[i - 1].v).length / (points.length - 1);
    if (unit === 'cum' || (mono > 0.97 && points[points.length - 1].v > points[0].v * 1.5 && points[0].v > 100)) {
      points = points.slice(1).map((p, i) => ({ t: p.t, v: Math.max(0, p.v - points[i].v) }));
    } else if (unit === 'kw') {
      points = points.map((p) => ({ ...p, v: (p.v * interval) / 60 }));
    }
  }
  points = points.filter((p) => p.v >= 0 && p.v < 1e5);
  if (points.length < 24) throw new Error('有效資料太少');
  return { points, interval };
}

/* ───────── 彙整：每月各時段度數 + 平日／假日 24 小時平均曲線 ───────── */
export function aggregate({ points, interval }) {
  const months = {};
  const days = {};
  for (const { t, v } of points) {
    const mid = new Date(t + (interval * 60e3) / 2);
    const y = mid.getUTCFullYear(), m = mid.getUTCMonth() + 1, d = mid.getUTCDate(), h = mid.getUTCHours();
    const key = `${y}-${pad(m)}`;
    const p = periodOf(y, m, d, h);
    const M = months[key] ||= { key, summer: p.summer, kwh: 0, two: { peak: 0, off: 0 }, three: { peak: 0, half: 0, off: 0 },
      lv2: { peak: 0, sat: 0, off: 0 }, lv3: { peak: 0, half: 0, sat: 0, off: 0 }, maxKw: 0,
      wk: Array(24).fill(0), we: Array(24).fill(0), wkDays: 0, weDays: 0, days: 0 };
    M.kwh += v; M.two[p.two] += v; M.three[p.three] += v; M.lv2[p.lv2] += v; M.lv3[p.lv3] += v;
    M.maxKw = Math.max(M.maxKw, (v * 60) / interval);
    (p.dayOff ? M.we : M.wk)[h] += v;
    const dk = `${key}-${pad(d)}`;
    if (!days[dk]) { days[dk] = 1; M.days++; p.dayOff ? M.weDays++ : M.wkDays++; }
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  for (const M of Object.values(months)) {
    const [yy, mm] = M.key.split('-').map(Number);
    M.daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    M.full = M.days >= M.daysInMonth - 1;
    M.kwh = r2(M.kwh);
    for (const k of Object.keys(M.two)) M.two[k] = r2(M.two[k]);
    for (const k of Object.keys(M.three)) M.three[k] = r2(M.three[k]);
    for (const k of Object.keys(M.lv2)) M.lv2[k] = r2(M.lv2[k]);
    for (const k of Object.keys(M.lv3)) M.lv3[k] = r2(M.lv3[k]);
    M.maxKw = r2(M.maxKw);
    M.wk = M.wk.map(r2); M.we = M.we.map(r2);
  }
  return months;
}

/* ───────── 電費試算 ───────── */
/** 營業用累進電費；mult = 2 表示兩個月一期（級距加倍）；summerShare = 夏月度數比例（跨季的雙月帳單） */
function bizBill(kwh, summerShare, mult = 1) {
  let rest = kwh, prev = 0, sum = 0;
  for (const [cap, s, o] of RATES.biz) {
    const c = cap * mult;
    const n = Math.max(0, Math.min(rest, c - prev));
    sum += n * (s * summerShare + o * (1 - summerShare)); rest -= n; prev = c;
    if (rest <= 0) break;
  }
  return sum;
}
/** shift：把尖峰（三段式含半尖峰）用電的這個比例移到離峰，看可以再省多少 */
export function bills(M, shift = 0, { kw = 0, overKwh } = {}) {
  const s = M.summer ? 0 : 1;
  const over = (overKwh ?? Math.max(0, M.kwh - 2000)) * RATES.over2000;
  const mv2 = M.two.peak * shift;
  const two = RATES.two.base + (M.two.peak - mv2) * RATES.two.peak[s] + (M.two.off + mv2) * RATES.two.off[s] + over;
  const pk3 = M.three.peak * (1 - shift), hf3 = M.three.half * (1 - shift);
  const mv3 = M.three.peak + M.three.half - pk3 - hf3;
  const three = RATES.three.base + pk3 * (RATES.three.peak[s] ?? RATES.three.half[s]) + hf3 * RATES.three.half[s]
    + (M.three.off + mv3) * RATES.three.off[s] + over;
  const out = { biz: Math.round(bizBill(M.kwh, M.summer ? 1 : 0)), two: Math.round(two), three: Math.round(three) };
  // 低壓電力（參考）：需要經常契約容量；舊的匯入資料沒有週六分項 → 不算
  if (kw > 0 && M.lv2) {
    const L = RATES.lv;
    out.lv1 = Math.round(kw * L.flat.contract[s] + M.kwh * L.flat.kwh[s]);
    const m2 = M.lv2.peak * shift;
    out.lv2 = Math.round(L.two.base + kw * L.two.contract[s] + (M.lv2.peak - m2) * L.two.peak[s] + M.lv2.sat * L.two.sat[s] + (M.lv2.off + m2) * L.two.off[s]);
    const p3 = M.lv3.peak * (1 - shift), h3 = M.lv3.half * (1 - shift), m3 = M.lv3.peak + M.lv3.half - p3 - h3;
    out.lv3 = Math.round(L.three.base + kw * L.three.contract[s] + p3 * (L.three.peak[s] ?? L.three.half[s]) + h3 * L.three.half[s]
      + M.lv3.sat * L.three.sat[s] + (M.lv3.off + m3) * L.three.off[s]);
  }
  return out;
}

/** 兩個月一期：把月份兩兩配對（startOdd = 1–2、3–4 月…；否則 2–3、4–5 月…），配對內的營業用級距與 4,000 度門檻合併計算，再依度數分回各月 */
function pairBimonthly(rows, startOdd) {
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  for (const r of rows) {
    const [y, m] = r.key.split('-').map(Number);
    const first = (m % 2 === 1) === startOdd;
    const [py, pm] = first ? (m === 12 ? [y + 1, 1] : [y, m + 1]) : (m === 1 ? [y - 1, 12] : [y, m - 1]);
    const mate = byKey[`${py}-${pad(pm)}`];
    if (!mate) { r.pairOf = null; continue; }
    r.pairOf = mate.key;
    const kwh = r.kwh + mate.kwh || 1;
    const summerShare = ((r.summer ? r.kwh : 0) + (mate.summer ? mate.kwh : 0)) / kwh;
    r.pairBiz = bizBill(r.kwh + mate.kwh, summerShare, 2) * (r.kwh / kwh);
    r.pairOver = Math.max(0, r.kwh + mate.kwh - 4000) * (r.kwh / kwh);
  }
}

/** 建議的經常契約容量（瓩）：最大 15 分鐘需量，取整數 */
export const suggestKw = (months) => Math.ceil(Math.max(0, ...Object.values(months).map((M) => M.maxKw || 0)));

export function summarize(months, shift = 0, { bimonthly = null, kw = 0 } = {}) {
  const list = Object.values(months).sort((a, b) => a.key.localeCompare(b.key)).map((M) => ({ ...M }));
  if (bimonthly) pairBimonthly(list, bimonthly === 'odd');
  const opt = (r) => ({ kw, overKwh: bimonthly && r.pairOf ? r.pairOver : undefined });
  const fix = (r, b) => (bimonthly && r.pairOf ? { ...b, biz: Math.round(r.pairBiz) } : b);
  const rows = list.map((M) => ({ ...M, bill: fix(M, bills(M, shift, opt(M))), bill0: fix(M, bills(M, 0, opt(M))) }));
  const full = rows.filter((r) => r.full);
  const base = full.length ? full : rows;
  const tot = (k, src = 'bill') => base.reduce((a, r) => a + (r[src][k] ?? 0), 0);
  const totals = { biz: tot('biz', 'bill0'), two: tot('two', 'bill0'), three: tot('three', 'bill0') };
  const shifted = { two: tot('two'), three: tot('three') };
  const hasLv = kw > 0 && base.every((r) => r.bill0.lv1 != null);
  const lv = hasLv ? { lv1: tot('lv1', 'bill0'), lv2: tot('lv2', 'bill0'), lv3: tot('lv3', 'bill0'), lv2s: tot('lv2'), lv3s: tot('lv3') } : null;
  const best = Object.entries(totals).sort((a, b) => a[1] - b[1])[0][0];
  const kwh = base.reduce((a, r) => a + r.kwh, 0) || 1;
  return {
    rows, totals, shifted, best, lv, months: base.length, onlyPartial: !full.length, needReimport: kw > 0 && !hasLv,
    peakShare2: base.reduce((a, r) => a + r.two.peak, 0) / kwh,
    peakShare3: base.reduce((a, r) => a + r.three.peak + r.three.half, 0) / kwh
  };
}

/* ───────── 儲存（只在這台裝置） ───────── */
const KEY = 'tgf-store';
export function loadStore() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
export function saveStore(s) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* 略 */ } }

/** 範例：小吃店（週一公休，10–14、17–21 營業，冷藏 24 小時），近 12 個月、每 15 分鐘 */
export function sampleCsv(now = new Date()) {
  const out = ['讀表時間,用電度數(kWh)'];
  const tw = new Date(now.getTime() + 8 * 3600e3);
  const end = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), 1);
  const start = Date.UTC(tw.getUTCFullYear() - 1, tw.getUTCMonth(), 1);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = start; t < end; t += 15 * 60e3) {
    const d = new Date(t + 15 * 60e3);
    const m = new Date(t).getUTCMonth() + 1, h = new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60;
    const dow = new Date(t).getUTCDay();
    const summer = m >= 6 && m <= 9 ? 1.45 : m === 5 || m === 10 ? 1.15 : 1;
    let kw = 1.6 * summer; // 冷藏、冰箱
    if (dow !== 1) {
      if (h >= 9 && h < 10.5) kw += 4;
      if ((h >= 10.5 && h < 14) || (h >= 16.5 && h < 21)) kw += 9 * summer;
      if (h >= 14 && h < 16.5) kw += 3 * summer;
    }
    kw *= 0.9 + rnd() * 0.2;
    const lbl = `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? '24:00' : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`}`;
    // 24:00 要標在前一天
    const lblFix = lbl.endsWith('24:00') ? (() => { const p = new Date(t); return `${p.getUTCFullYear()}/${pad(p.getUTCMonth() + 1)}/${pad(p.getUTCDate())} 24:00`; })() : lbl;
    out.push(`${lblFix},${(kw / 4).toFixed(3)}`);
  }
  return out.join('\n');
}
