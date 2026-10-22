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

export function touPeriod(date = new Date()) {
  const t = tw(date);
  const dow = t.getUTCDay();
  const h = t.getUTCHours() + t.getUTCMinutes() / 60;
  const m = t.getUTCMonth() + 1;
  const summer = m >= 6 && m <= 9;
  if (dow === 0 || dow === 6) return { peak: false, label: '週末離峰', summer, next: null };
  const peakRanges = summer ? [[9, 24]] : [[6, 11], [14, 24]];
  const inPeak = peakRanges.some(([a, b]) => h >= a && h < b);
  // 下一個切換時刻
  const edges = peakRanges.flat().filter((x) => x > h).sort((a, b) => a - b);
  const nextH = edges[0] ?? 24;
  const hm = `${String(Math.floor(nextH) % 24).padStart(2, '0')}:00`;
  return {
    peak: inPeak,
    label: inPeak ? '尖峰時段' : '離峰時段',
    summer,
    next: inPeak ? `${hm} 起離峰` : `${hm} 起尖峰`
  };
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
  const ci = carbonIntensity(snap.totals);
  const today = rows.map((r) => carbonIntensity(r.totals)).filter((x) => x != null);
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

  return { level, head, reasons, tou, ci, best: bestWindow(now, yRows) };
}

/** 依昨日同時段的碳排曲線，找今天「剩下的時間」裡最低碳的 2 小時 */
function bestWindow(now, yRows) {
  if (!yRows?.length) return null;
  const nowHM = tw(now).toISOString().slice(11, 16);
  const pts = yRows.filter((r) => r.hm >= nowHM).map((r) => ({ hm: r.hm, ci: carbonIntensity(r.totals) })).filter((p) => p.ci != null);
  if (pts.length < 12) return null;
  let best = null;
  for (let i = 0; i + 12 <= pts.length; i++) {
    const avg = pts.slice(i, i + 12).reduce((a, p) => a + p.ci, 0) / 12;
    if (!best || avg < best.avg) best = { from: pts[i].hm, to: pts[Math.min(pts.length - 1, i + 12)].hm, avg };
  }
  return best;
}
