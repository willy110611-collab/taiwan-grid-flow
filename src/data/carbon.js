/**
 * 即時碳排強度（推估）
 * ─────────────────────────────────────────────────────────────
 * 台電沒有公布即時碳排，這裡用「各燃料發電量 × 燃燒排放係數」推算全台每度電的直接排放。
 * 係數為各類機組的典型值（kg CO₂/kWh），只計發電端燃燒排放，不含生命週期。
 * 對照：經濟部能源署公告 114 年度電力排碳係數 0.467 kg CO₂e/度（全年平均）。
 */
export const EMISSION = {
  coal: 0.92,   // 燃煤（亞臨界／超臨界機組平均）
  gas: 0.39,    // 燃氣（複循環為主）
  oil: 0.78,    // 燃油／輕油
  cogen: 0.70,  // 汽電共生（燃料混合）
  nuclear: 0, solar: 0, wind: 0, hydro: 0, otherRe: 0, storage: 0
};
export const OFFICIAL_FACTOR = { year: 114, value: 0.467 };

/** totals（MW）→ kg CO₂/kWh */
export function carbonIntensity(totals) {
  let mw = 0, co2 = 0;
  for (const [f, v] of Object.entries(totals || {})) {
    if (f === 'storage' || !(v > 0)) continue;
    mw += v;
    co2 += v * (EMISSION[f] ?? 0.5);
  }
  return mw > 0 ? co2 / mw : null;
}

/** 依強度給文字等級（相對官方年平均） */
export function carbonLevel(ci) {
  if (ci == null) return { label: '—', tone: 'muted' };
  const r = ci / OFFICIAL_FACTOR.value;
  if (r < 0.85) return { label: '偏低', tone: 'green' };
  if (r < 1.05) return { label: '普通', tone: 'ink' };
  return { label: '偏高', tone: 'warm' };
}
