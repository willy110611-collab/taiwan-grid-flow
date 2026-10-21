// ─────────────────────────────────────────────────────────────
//  地理靜態資料：發電節點（Source）、都市負載點（Target）、西部骨幹
//  座標格式 [lng, lat]
// ─────────────────────────────────────────────────────────────

/**
 * 發電節點
 *  match : 用來比對台電 genary「機組名稱」欄的正規式
 *  share : 若該燃料是「全台總量」型資料（例如太陽能、風力在台電資料中是彙總列），
 *          依此比例把總量分配到各節點。share 以燃料別為鍵。
 */
export const PLANTS = [
  // ── 使用者指定的 6 個主節點 ──
  { id: 'datan',    name: '大潭發電廠',   en: 'Datan',      pos: [121.047, 25.029], match: /大潭/ },
  { id: 'taichung', name: '台中發電廠',   en: 'Taichung',   pos: [120.481, 24.213], match: /台中|中火/ },
  { id: 'hsinta',   name: '興達發電廠',   en: 'Hsinta',     pos: [120.198, 22.856], match: /興達/ },
  { id: 'maanshan', name: '第三核能發電廠', en: 'Maanshan', pos: [120.751, 21.958], match: /核三|馬鞍山/ },
  { id: 'changbin', name: '彰濱離岸風電 / 太陽能群', en: 'Changhua Offshore', pos: [120.354, 24.083],
    match: /彰濱|彰工|大彰化|海能|沃旭|中能|海峽|台電離岸|離岸一期/, share: { wind: 0.62, solar: 0.22 } },
  { id: 'cigu',     name: '七股鹽山太陽能群', en: 'Cigu Solar', pos: [120.106, 23.149], share: { solar: 0.30 } },

  // ── 補充節點：讓全台光網更完整（可自行刪減） ──
  { id: 'linkou',   name: '林口發電廠',   en: 'Linkou',     pos: [121.305, 25.120], match: /林口/ },
  { id: 'tunghsiao',name: '通霄發電廠',   en: 'Tunghsiao',  pos: [120.672, 24.492], match: /通霄/ },
  { id: 'mailiao',  name: '麥寮電廠',     en: 'Mailiao',    pos: [120.195, 23.790], match: /麥寮|允能|雲林/, share: { wind: 0.18 } },
  { id: 'chiayi',   name: '嘉義沿海太陽能群', en: 'Chiayi Solar', pos: [120.170, 23.420], share: { solar: 0.26 } },
  { id: 'pingtung', name: '屏東太陽能群', en: 'Pingtung Solar', pos: [120.560, 22.560], share: { solar: 0.22 } },
  { id: 'nanbu',    name: '南部 / 大林發電廠', en: 'Nanbu · Talin', pos: [120.330, 22.590], match: /南部|大林/ },
  { id: 'hoping',   name: '和平電廠',     en: 'Ho-Ping',    pos: [121.755, 24.300], match: /和平/ },
  { id: 'miaoli',   name: '苗栗離岸風場', en: 'Miaoli Offshore', pos: [120.780, 24.700], match: /海洋|竹南|苗栗|Formosa/i, share: { wind: 0.20 } },
  { id: 'mingtan',  name: '明潭 / 大觀抽蓄', en: 'Sun Moon Lake Hydro', pos: [120.865, 23.835], match: /明潭|大觀|日月潭/, share: { hydro: 0.62 } },
  { id: 'tachien',  name: '德基 / 青山水力', en: 'Tachien Hydro', pos: [121.180, 24.240], match: /德基|青山|谷關|天輪|立霧|龍澗/, share: { hydro: 0.38 } }
];

/**
 * 都市負載點（引力中心）
 *  demand : 相對用電權重（大致依各區域負載比例；北部最大 → 自然產生南電北送）
 */
export const LOADS = [
  { id: 'xinyi',     name: '台北信義區',   en: 'Taipei · Xinyi',      pos: [121.567, 25.033], demand: 0.36 },
  { id: 'hsp',       name: '新竹科學園區', en: 'Hsinchu Science Park', pos: [121.000, 24.780], demand: 0.17 },
  { id: 'xitun',     name: '台中西屯區',   en: 'Taichung · Xitun',    pos: [120.640, 24.180], demand: 0.17 },
  { id: 'stsp',      name: '台南科學園區', en: 'Tainan Science Park', pos: [120.280, 23.105], demand: 0.13 },
  { id: 'qianzhen',  name: '高雄前鎮區',   en: 'Kaohsiung · Qianzhen', pos: [120.310, 22.595], demand: 0.17 }
];

/**
 * 西部「無形骨幹」— 對應真實 345kV 超高壓走廊的大致走向（由南到北）。
 * 貝茲曲線的控制點會被這條脊線吸引，讓粒子沿西海岸流動。
 */
export const SPINE = [
  [120.70, 22.15],
  [120.45, 22.55],
  [120.33, 22.95],
  [120.33, 23.40],
  [120.45, 23.85],
  [120.62, 24.25],
  [120.85, 24.62],
  [121.08, 24.88],
  [121.38, 25.02]
];

/** 地圖初始範圍：整座台灣本島 */
export const TAIWAN_BOUNDS = [[119.95, 21.85], [122.05, 25.35]];
