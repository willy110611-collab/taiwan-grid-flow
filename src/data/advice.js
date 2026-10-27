import { carbonIntensity } from './carbon.js';

/**
 * 用電時機燈號
 * ─────────────────────────────────────────────────────────────
 * 綜合三件事：
 *  1. 時間電價時段（台電「簡易型時間電價－二段式」時段劃分；只有申請時間電價的用戶電費才會不同）
 *  2. 目前碳排強度相對今天的高低（越低越「乾淨」）
 *  3. 供電燈號（黃燈以上建議減少非必要用電）
 *  時間電價時段只在使用者勾選「我家有申請時間電價」時才算（一般住宅電價不分時段）
 * 註：國定假日也是離峰，但程式只判斷週六日（假日表每年不同）。
 */
const tw = (d) => new Date(d.getTime() + 8 * 3600e3);

/**
 * 台電「離峰日」：全日離峰。用國定假日本日（不含彈性補假），依行政院人事行政總處公告，每年更新。
 * 2025 年起新增教師節、光復節、行憲紀念日為國定假日。
 */
export const HOLIDAYS = new Set([
  // 2025（114 年）
  '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-28', '2025-04-04', '2025-05-01',
  '2025-05-31', '2025-09-28', '2025-10-06', '2025-10-10', '2025-10-25', '2025-12-25',
  // 2026（115 年）
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28', '2026-04-04', '2026-04-05',
  '2026-05-01', '2026-06-19', '2026-09-25', '2026-09-28', '2026-10-10', '2026-10-25', '2026-12-25',
  // 2027（116 年）
  // 2025 年修法起小年夜（除夕前一日）也放假：2027 年是 2/4（星期四）；2026 年的 2/15 是星期日，本來就離峰
  '2027-01-01', '2027-02-04', '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-28', '2027-04-04', '2027-04-05',
  '2027-05-01', '2027-06-09', '2027-09-15', '2027-09-28', '2027-10-10', '2027-10-25', '2027-12-25'
]);

/**
 * 台電簡易型時間電價「二段式」（114 年 10 月 1 日起，台電「各類電價表及計算範例」第 4 頁）
 *  週一至週五：夏月 09–24 尖峰；非夏月 06–11、14–24 尖峰；其餘離峰
 *  週六、週日及離峰日（國定假日）：全日離峰
 */
export const TOU_RATES = { base: 75, peak: { summer: 5.16, other: 4.93 }, off: { summer: 2.06, other: 1.99 }, over2000: 1.04 };
export const TIERED_RATES = [ // 表燈非時間電價（住宅），每月度數上限：[夏月, 非夏月]
  [120, 1.78, 1.78], [330, 2.55, 2.26], [500, 3.80, 3.13], [700, 5.14, 4.24], [1000, 6.44, 5.27], [Infinity, 8.86, 7.03]
];

export function touPeriod(date = new Date()) {
  const t = tw(date);
  const dow = t.getUTCDay();
  const h = t.getUTCHours() + t.getUTCMinutes() / 60;
  const m = t.getUTCMonth() + 1;
  const summer = m >= 6 && m <= 9;
  const ymd = t.toISOString().slice(0, 10);
  if (dow === 0 || dow === 6) return { peak: false, label: '週末全日離峰', summer, next: null };
  if (HOLIDAYS.has(ymd)) return { peak: false, label: '國定假日全日離峰', summer, next: null };
  const ranges = summer ? [[9, 24]] : [[6, 11], [14, 24]];
  const inPeak = ranges.some(([a, b]) => h >= a && h < b);
  const nextH = ranges.flat().filter((x) => x > h).sort((a, b) => a - b)[0] ?? 24;
  const when = nextH >= 24 ? '今晚 24:00' : `${String(nextH).padStart(2, '0')}:00`;
  return inPeak
    ? { peak: true, label: '尖峰時段', summer, next: `${when} 起離峰` }
    : { peak: false, label: '離峰時段', summer, next: `${when} 起尖峰` };
}

/** 電費試算：每月度數 kwh、尖峰用電比例 peakShare（0–1）、是否夏月 → { tiered, tou } 元 */
export function billCompare(kwh, peakShare, summer) {
  let rest = kwh, prev = 0, tiered = 0;
  for (const [cap, s, o] of TIERED_RATES) {
    const n = Math.max(0, Math.min(rest, cap - prev));
    tiered += n * (summer ? s : o);
    rest -= n; prev = cap;
    if (rest <= 0) break;
  }
  const k = summer ? 'summer' : 'other';
  const tou = TOU_RATES.base + kwh * peakShare * TOU_RATES.peak[k] + kwh * (1 - peakShare) * TOU_RATES.off[k] + Math.max(0, kwh - 2000) * TOU_RATES.over2000;
  return { tiered: Math.round(tiered), tou: Math.round(tou) };
}

/**
 * @param snap   目前快照
 * @param rows   今日歷史（含 totals）
 * @param yRows  昨日燃料曲線 [{hm, totals}]（推估今天剩餘時段用）
 */
export function usageAdvice(snap, rows = [], yRows = null, { touUser = false } = {}) {
  if (!snap) return null;
  const now = new Date();
  // 連不到台電、畫面退回模擬（不是刻意開的 ?sim=1 示範）：模擬數字不能拿來給建議
  if (snap.source !== 'live' && snap.diag?.length && !/[?&]sim\b/.test(globalThis.location?.search || '')) {
    return { level: 'na', head: '暫時無法判斷', reasons: ['連不到台電資料，目前是模擬畫面'], tou: touPeriod(now), ci: null, best: null };
  }
  const tou = touPeriod(now);
  const fx = snap.carbonFx;
  const ci = carbonIntensity(snap.totals, fx);
  const today = rows.map((r) => carbonIntensity(r.totals, fx)).filter((x) => x != null);
  const lo = today.length ? Math.min(...today) : ci;
  const hi = today.length ? Math.max(...today) : ci;
  const rel = hi > lo ? (ci - lo) / (hi - lo) : 0.5; // 0 = 今天最乾淨、1 = 今天最髒

  // 一般住宅電價不分時段 → 沒勾「時間電價」的人只看碳排與供電；有勾才把尖峰／離峰算進來
  let score = 0;
  const reasons = [];
  if (rel >= 0.7) { score -= 1; reasons.push('火力發電比例高，碳排接近今天高點'); }
  else if (rel <= 0.35) { score += 1; reasons.push('綠能比例高，碳排接近今天低點'); }
  else reasons.push('碳排在今天的中間');
  const lvl = snap.supply?.old ? 0 : (snap.supply?.level ?? 0); // 前一天發布的燈號不算
  if (lvl >= 1) { score -= 3; reasons.push(`供電${snap.supply.label}（備轉 ${snap.supply.rate}%），請減少非必要用電`); }
  else reasons.push('供電正常，不用特別省電');
  if (touUser) {
    score += tou.peak ? -2 : 2;
    reasons.push(`電價：${tou.label}${tou.next ? `（${tou.next}）` : ''}`);
  }

  // 標題直接寫原因（膠囊與「我的家」共用）
  const kind = lvl >= 1 ? 'supply'
    : score < 0 ? (rel >= 0.7 ? 'dirty' : 'peak')
    : rel <= 0.35 ? 'clean'
    : score >= 2 ? 'offpeak'
    : 'normal';
  const level = { supply: 'bad', dirty: 'bad', peak: 'bad', clean: 'good', offpeak: 'good', normal: 'ok' }[kind];
  const head = { supply: '供電吃緊・請省電', dirty: '碳排偏高・洗衣烘衣晚點用', peak: '尖峰電價・大電器晚點用', clean: '現在電比較乾淨', offpeak: '離峰電價・適合用電', normal: '普通時段' }[kind];

  return { level, kind, head, reasons, tou, touUser, ci, best: bestWindow(now, yRows, fx) };
}

/** 依昨日同時段的碳排曲線，找今天「剩下的時間」裡最低碳的 2 小時 */
function bestWindow(now, yRows, fx) {
  if (!yRows?.length) return null;
  const nowHM = tw(now).toISOString().slice(11, 16);
  const all = yRows.map((r) => ({ hm: r.hm, ci: carbonIntensity(r.totals, fx) })).filter((p) => p.ci != null);
  let pts = all.filter((p) => p.hm >= nowHM), tomorrow = false;
  // 今天剩不到 2 小時：改用昨天整天推估明天（07–22 點，避開深夜）
  if (pts.length < 12) { pts = all.filter((p) => p.hm >= '07:00' && p.hm <= '22:00'); tomorrow = true; }
  if (pts.length < 12) return null;
  let best = null;
  for (let i = 0; i + 12 <= pts.length; i++) {
    const avg = pts.slice(i, i + 12).reduce((a, p) => a + p.ci, 0) / 12;
    if (!best || avg < best.avg) best = { from: pts[i].hm, to: pts[Math.min(pts.length - 1, i + 12)].hm, avg, tomorrow };
  }
  return best;
}
