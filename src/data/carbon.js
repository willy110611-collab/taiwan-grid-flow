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

/**
 * 依機組型式的典型排放係數（kg CO₂/kWh，燃燒端；公開文獻常見值，非官方逐機組數據）
 * 用台電 genary 的機組名稱判斷型式，算出「目前這一刻」燃煤、燃氣的加權係數
 */
const UNIT_FACTORS = [
  { fuel: 'coal', re: /林口|大林/, v: 0.80 },        // 超超臨界燃煤
  { fuel: 'coal', re: /和平|麥寮/, v: 0.88 },        // 民營燃煤
  { fuel: 'coal', re: /台中|興達/, v: 0.92 },        // 亞臨界燃煤
  { fuel: 'gas',  re: /大潭|通霄|台中CC|興達新|大林#[56]/, v: 0.37 }, // 新型複循環
  { fuel: 'gas',  re: /海湖|國光|星彰|星元|嘉惠|豐德|新桃|長生|森霸/, v: 0.40 }, // 民營燃氣
  { fuel: 'gas',  re: /興達CC|南部CC/, v: 0.42 }     // 較舊複循環
];

/** 機組清單 → { coal, gas } 當下加權係數（對不到型式的機組用 EMISSION 預設值） */
export function unitFactors(units) {
  const acc = { coal: [0, 0], gas: [0, 0] };
  for (const u of units || []) {
    if (!(u.mw > 0) || !acc[u.fuel]) continue;
    const v = UNIT_FACTORS.find((x) => x.fuel === u.fuel && x.re.test(u.unit))?.v ?? EMISSION[u.fuel];
    acc[u.fuel][0] += u.mw * v;
    acc[u.fuel][1] += u.mw;
  }
  const out = {};
  for (const [f, [co2, mw]] of Object.entries(acc)) if (mw > 0) out[f] = co2 / mw;
  return out;
}

/** totals（MW）→ kg CO₂/kWh；fx 可覆蓋燃煤、燃氣的係數（來自 unitFactors） */
export function carbonIntensity(totals, fx = null) {
  let mw = 0, co2 = 0;
  for (const [f, v] of Object.entries(totals || {})) {
    if (f === 'storage' || !(v > 0)) continue;
    mw += v;
    co2 += v * (fx?.[f] ?? EMISSION[f] ?? 0.5);
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
