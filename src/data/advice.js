import { carbonIntensity } from './carbon.js';

/**
 * 用電時機燈號
 * ─────────────────────────────────────────────────────────────
 * 綜合三件事：
 *  1. 時間電價時段（台電「簡易型時間電價－二段式」時段劃分；只有申請時間電價的用戶電費才會不同）
 *  2. 目前碳排強度相對今天的高低（越低越「乾淨」）
 *  3. 供電燈號（黃燈以上建議延後非必要用電）
 * 註：國定假日也是離峰，但程式只判斷週六日（假日表每年不同）。
 */
const tw = (d) => new Date(d.getTime() + 8 * 3600e3);

/**
 * 台電「離峰日」：全日離峰。用國定假日本日（不含彈性補假），依行政院人事行政總處公告，每年更新。
 * 2025 年起新增教師節、光復節、行憲紀念日為國定假日。
 */
const HOLIDAYS = new Set([
  // 2026（115 年）
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-28', '2026-04-04', '2026-04-05',
  '2026-05-01', '2026-06-19', '2026-09-25', '2026-09-28', '2026-10-10', '2026-10-25', '2026-12-25',
  // 2027（116 年）
  '2027-01-01', '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-28', '2027-04-04', '2027-04-05',
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
  const tou = touPeriod(now);
  const fx = snap.carbonFx;
  const ci = carbonIntensity(snap.totals, fx);
  const today = rows.map((r) => carbonIntensity(r.totals, fx)).filter((x) => x != null);
  const lo = today.length ? Math.min(...today) : ci;
  const hi = today.length ? Math.max(...today) : ci;
  const rel = hi > lo ? (ci - lo) / (hi - lo) : 0.5; // 0 = 今天最乾淨、1 = 今天最髒

  let score = 0;
  const reasons = [];
  if (!tou.peak) { score += touUser ? 2 : 1; reasons.push(`${tou.label}${touUser ? '，電價較低' : ''}`); }
  else { score -= touUser ? 2 : 1; reasons.push(`${tou.label}${touUser ? '，電價較高' : ''}（${tou.next}）`); }
  if (rel <= 0.35) { score += 1; reasons.push('碳排接近今日低點'); }
  else if (rel >= 0.7) { score -= 1; reasons.push('碳排接近今日高點'); }
  const lvl = snap.supply?.level ?? 0;
  if (lvl >= 1) { score -= 2; reasons.push(`供電${snap.supply.label}`); }

  const level = score >= 2 ? 'good' : score >= 0 ? 'ok' : 'bad';
  const head = { good: '適合用電', ok: '可以用電', bad: '建議延後' }[level];

  return { level, head, reasons, tou, ci, best: bestWindow(now, yRows, fx) };
}

/** 依昨日同時段的碳排曲線，找今天「剩下的時間」裡最低碳的 2 小時 */
function bestWindow(now, yRows, fx) {
  if (!yRows?.length) return null;
  const nowHM = tw(now).toISOString().slice(11, 16);
  const pts = yRows.filter((r) => r.hm >= nowHM).map((r) => ({ hm: r.hm, ci: carbonIntensity(r.totals, fx) })).filter((p) => p.ci != null);
  if (pts.length < 12) return null;
  let best = null;
  for (let i = 0; i + 12 <= pts.length; i++) {
    const avg = pts.slice(i, i + 12).reduce((a, p) => a + p.ci, 0) / 12;
    if (!best || avg < best.avg) best = { from: pts[i].hm, to: pts[Math.min(pts.length - 1, i + 12)].hm, avg };
  }
  return best;
}
