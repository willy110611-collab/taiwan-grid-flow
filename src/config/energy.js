// ─────────────────────────────────────────────────────────────
//  能源色票 — 夜光地圖上每一種能量的「發光顏色」
//  RGB 0–255。粒子、光暈、圖例都從這裡取色，改這裡就能換整套氣質。
// ─────────────────────────────────────────────────────────────
export const FUELS = {
  solar:   { label: '太陽能', en: 'Solar',   color: [255, 198, 92],  green: true  }, // 金色 / 暖黃
  wind:    { label: '風力',   en: 'Wind',    color: [86, 238, 255],  green: true  }, // 青藍 Cyan
  hydro:   { label: '水力',   en: 'Hydro',   color: [52, 224, 156],  green: true  }, // 翡翠綠
  otherRe: { label: '其他再生', en: 'Other RE', color: [150, 240, 170], green: true },
  gas:     { label: '燃氣',   en: 'LNG',     color: [128, 104, 255], green: false }, // 深藍紫
  coal:    { label: '燃煤',   en: 'Coal',    color: [255, 122, 58],  green: false }, // 橘紅 / 琥珀
  cogen:   { label: '汽電共生', en: 'Co-Gen', color: [214, 146, 92],  green: false },
  oil:     { label: '燃油',   en: 'Oil',     color: [196, 86, 70],   green: false },
  nuclear: { label: '核能',   en: 'Nuclear', color: [214, 228, 255], green: false }, // 冰白
  storage: { label: '儲能',   en: 'Storage', color: [255, 255, 255], green: false }
};

/** 火力（熱機組）— 用於右上角「火力佔比」 */
export const THERMAL = new Set(['gas', 'coal', 'cogen', 'oil']);

/** 圖例顯示順序 */
export const LEGEND_ORDER = ['solar', 'wind', 'hydro', 'gas', 'coal', 'nuclear'];

/**
 * 台電 genary 第一欄是一段 HTML，例如 "<A NAME='coal'></A><b>燃煤(Coal)</b>"
 * 去掉標籤後用關鍵字判斷燃料別。順序有意義：先判斷較具體的詞。
 */
const FUEL_RULES = [
  [/儲能|storage/i, 'storage'],
  [/太陽|solar/i, 'solar'],
  [/風|wind/i, 'wind'],
  [/水力|hydro/i, 'hydro'],
  [/核|nuclear/i, 'nuclear'],
  [/再生|renewable|地熱|geothermal|生質|biomass/i, 'otherRe'],
  [/共生|co-?gen/i, 'cogen'],
  [/煤|coal/i, 'coal'],
  [/氣|lng|gas/i, 'gas'],
  [/油|oil|diesel/i, 'oil']
];

export function classifyFuel(typeText = '') {
  const t = String(typeText).replace(/<[^>]*>/g, '');
  for (const [re, fuel] of FUEL_RULES) if (re.test(t)) return fuel;
  return null;
}

/** 燃料鍵的固定順序（粒子以索引儲存燃料別） */
export const FUEL_KEYS = Object.keys(FUELS);

/** 能源篩選（仿軌島「全／台／高／捷」分類鈕） */
export const FILTERS = [
  { id: 'all',     label: '全部', fuels: null,                                   dot: [232, 238, 252] },
  { id: 'green',   label: '綠能', fuels: ['solar', 'wind', 'hydro', 'otherRe'],  dot: [110, 240, 190] },
  { id: 'thermal', label: '火力', fuels: ['gas', 'coal', 'cogen', 'oil'],        dot: [255, 150, 92] },
  { id: 'nuclear', label: '核能', fuels: ['nuclear'],                            dot: [214, 228, 255] },
  { id: 'demand',  label: '用電', fuels: null, demand: true,                     dot: [255, 120, 90] },
  { id: 'air',     label: '空品', fuels: null, air: true,                        dot: [200, 200, 210] }
];

/** 資料可信度分級（仿軌島「依證據區分即時與推估」） */
export const EVIDENCE = {
  live:      { label: '台電即時', desc: '機組名稱直接對應到此電廠，數值來自台電每 10 分鐘公布的淨發電量。', descEn: 'Unit names map directly to this plant; values are Taipower’s net output published every 10 minutes.' },
  allocated: { label: '推估分配', desc: '台電以彙總列公布（例如全台太陽能、陸域風力），依各區裝置比例分配到節點。', descEn: 'Taipower publishes aggregate rows (e.g. all solar, onshore wind); they are allocated to nodes by installed capacity per region.' },
  modeled:   { label: '模型推估', desc: '輸電流向由重力模型計算，代表「大致往哪裡送」，不是實際線路潮流。', descEn: 'Transmission flows come from a gravity model — “roughly where power goes”, not actual line flows.' },
  simulated: { label: '模擬',     desc: '無法取得台電資料時，依台灣時間的典型日負載曲線產生。', descEn: 'When Taipower data is unavailable, values follow a typical daily load curve for Taiwan time.' }
};
