import { isEn } from '../i18n.js';

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
/**
 * 各縣市太陽光電裝置容量（台電「各縣市太陽光電裝置容量排名」115 年 08 月，單位瓩）
 * 台電即時資料裡約 86% 的太陽能是「其它購電太陽能」一整行、沒有位置 → 依這份裝置容量分配到各縣市光點。
 * 每年更新一次即可：https://www.taipower.com.tw/chart/（歷年各縣市太陽光電裝置容量 CSV）
 */
export const SOLAR_COUNTY_KW = {
  version: '115-08',
  台南市: 3014337, 彰化縣: 2219385, 雲林縣: 1714586, 高雄市: 1601699, 屏東縣: 1550424,
  嘉義縣: 1221705, 嘉義市: 61223, 台中市: 989219, 桃園市: 963946, 苗栗縣: 419590, 南投縣: 334201,
  新北市: 223625, 台北市: 87706, 基隆市: 32246, 新竹縣: 231268, 新竹市: 56824,
  宜蘭縣: 232256, 花蓮縣: 239251, 台東縣: 111132
};
const kw = (...cs) => cs.reduce((a, c) => a + SOLAR_COUNTY_KW[c], 0) / 1e6; // → GW，當作分配權重

/** 電廠顯示名稱：英文介面用 en */
export const plantName = (p) => (isEn() && p?.en ? p.en : p?.name);

export const PLANTS = [
  // ── 離岸風場：台電每 10 分鐘公布「每個風場」的即時淨發電量，各自一個光點（位置為風場約略中心）──
  //    放在最前面：機組名稱優先對應到這裡，不會被下面的區域節點吃掉
  { id: 'ow_formosa1', name: '海洋竹南離岸風場', en: 'Formosa 1',           pos: [120.816, 24.691], match: /海洋竹南/, offshore: true },
  { id: 'ow_formosa2', name: '海能離岸風場',     en: 'Formosa 2',           pos: [120.776, 24.716], match: /海能/, offshore: true },
  { id: 'ow_zhongneng', name: '中能離岸風場',    en: 'Zhong Neng',          pos: [120.200, 24.290], match: /中能/, offshore: true },
  { id: 'ow_changfang', name: '彰芳西島離岸風場', en: 'Changfang & Xidao',  pos: [120.180, 24.165], match: /芳[一二]風/, offshore: true },
  { id: 'ow_gch12',    name: '沃旭大彰化東南 / 西南', en: 'Greater Changhua 1 & 2a', pos: [120.070, 24.170], match: /沃[一二]風/, offshore: true },
  { id: 'ow_gch4',     name: '沃旭大彰化 2b（沃南）/ 4', en: 'Greater Changhua 2b & 4', pos: [120.020, 24.050], match: /沃[四南]風/, offshore: true },
  { id: 'ow_tpc',      name: '台電離岸一 / 二期', en: 'TPC Offshore 1 & 2',  pos: [120.225, 23.985], match: /離岸[一二]期/, offshore: true },
  { id: 'ow_hailong',  name: '海龍離岸風場',     en: 'Hai Long',            pos: [119.930, 24.110], match: /龍[AB三]風/, offshore: true },
  { id: 'ow_yunneng',  name: '允能雲林離岸風場', en: 'Yunneng',             pos: [120.050, 23.800], match: /允湖|允西/, offshore: true },

  // ── 使用者指定的 6 個主節點 ──
  { id: 'datan',    name: '大潭發電廠',   en: 'Datan',      pos: [121.047, 25.029], match: /大潭|海湖|新桃|國光|觀園|觀威/ },
  { id: 'taichung', name: '台中發電廠',   en: 'Taichung',   pos: [120.481, 24.213], match: /台中|中火/ },
  { id: 'hsinta',   name: '興達發電廠',   en: 'Hsinta',     pos: [120.198, 22.856], match: /興達/ },
  { id: 'maanshan', name: '第三核能發電廠', en: 'Maanshan', pos: [120.751, 21.958], match: /核三|馬鞍山/ },
  // 核一、核二：已停機（台電即時資料只剩廠內備用燃油氣渦輪「核二Gas1/2」），放著讓「核能」分類可以點
  { id: 'chinshan', name: '第一核能發電廠', en: 'Chinshan', pos: [121.586, 25.286], match: /核一/ },
  { id: 'kuosheng', name: '第二核能發電廠', en: 'Kuosheng', pos: [121.662, 25.203], match: /核二|國聖/ },
  // 嘉惠電廠（民營燃氣，嘉義民雄；位置：Global Energy Monitor「Chia-Hui power station」23.5318, 120.4727）
  { id: 'chiahui',  name: '嘉惠電廠', en: 'Chiahui', pos: [120.473, 23.532], match: /^嘉惠/ },
  // 協和發電廠（台電燃油，基隆中山區；位置：Wikipedia／Global Energy Monitor 25.1573, 121.7394；3、4 號機 2×500 MW）
  { id: 'hsiehho',  name: '協和發電廠', en: 'Hsieh-ho', pos: [121.739, 25.157], match: /^協和/ },
  // 彰濱：彰濱光、崙尾光、星崙光（彰濱工業區崙尾區，台電即時逐案公布）＋陸域風電
  { id: 'changbin', name: '彰濱風電 / 光電', en: 'Changbin', pos: [120.400, 24.110],
    match: /彰濱|彰工|彰品|王功|星彰|崙尾|星崙/, share: { wind: 0.62 } },
  { id: 'cigu',     name: '台南太陽能群', en: 'Tainan Solar', pos: [120.140, 23.160], match: /南鹽|七股/, share: { solar: kw('台南市') }, solar: true },

  // ── 補充節點：讓全台光網更完整（可自行刪減） ──
  { id: 'linkou',   name: '林口發電廠',   en: 'Linkou',     pos: [121.305, 25.120], match: /林口/ },
  { id: 'tunghsiao',name: '通霄發電廠',   en: 'Tunghsiao',  pos: [120.672, 24.492], match: /通霄/ },
  { id: 'mailiao',  name: '麥寮電廠',     en: 'Mailiao',    pos: [120.195, 23.790], match: /麥寮|雲林|雲麥|四湖|崙背|星元/, share: { wind: 0.18 } },
  { id: 'chiayi',   name: '嘉義太陽能群', en: 'Chiayi Solar', pos: [120.200, 23.420], share: { solar: kw('嘉義縣', '嘉義市') }, solar: true },
  { id: 'pingtung', name: '屏東太陽能群', en: 'Pingtung Solar', pos: [120.560, 22.560], share: { solar: kw('屏東縣') }, solar: true },
  // ── 各縣市太陽能群（依台電各縣市裝置容量分配「其它購電太陽能」；位置取該縣市光電較集中處）──
  { id: 'sol_changhua', name: '彰化太陽能群', en: 'Changhua Solar',  pos: [120.330, 23.930], share: { solar: kw('彰化縣') }, solar: true },
  { id: 'sol_yunlin',   name: '雲林太陽能群', en: 'Yunlin Solar',    pos: [120.230, 23.620], share: { solar: kw('雲林縣') }, solar: true },
  { id: 'sol_kaohsiung', name: '高雄太陽能群', en: 'Kaohsiung Solar', pos: [120.290, 22.800], share: { solar: kw('高雄市') }, solar: true },
  { id: 'sol_taichung', name: '台中太陽能群', en: 'Taichung Solar',  pos: [120.590, 24.280], share: { solar: kw('台中市') }, solar: true },
  { id: 'sol_taoyuan',  name: '桃園太陽能群', en: 'Taoyuan Solar',   pos: [121.170, 24.980], share: { solar: kw('桃園市') }, solar: true },
  { id: 'sol_miaoli',   name: '苗栗太陽能群', en: 'Miaoli Solar',    pos: [120.820, 24.520], share: { solar: kw('苗栗縣') }, solar: true },
  { id: 'sol_nantou',   name: '南投太陽能群', en: 'Nantou Solar',    pos: [120.690, 23.880], share: { solar: kw('南投縣') }, solar: true },
  { id: 'sol_north',    name: '北北基竹太陽能群', en: 'North Solar', pos: [121.030, 24.820], share: { solar: kw('新北市', '台北市', '基隆市', '新竹縣', '新竹市') }, solar: true },
  { id: 'sol_east',     name: '宜花東太陽能群', en: 'East Solar',    pos: [121.580, 23.950], share: { solar: kw('宜蘭縣', '花蓮縣', '台東縣') }, solar: true },
  { id: 'nanbu',    name: '南部 / 大林發電廠', en: 'Nanbu · Talin', pos: [120.330, 22.590], match: /南部CC|大林/ }, // 「南部小水力」是彙總列，不屬於這座電廠
  { id: 'hoping',   name: '和平電廠',     en: 'Ho-Ping',    pos: [121.755, 24.300], match: /和平/ },
  { id: 'miaoli',   name: '苗栗風場', en: 'Miaoli Wind', pos: [120.780, 24.640], match: /苗栗|大鵬/, share: { wind: 0.20 } },
  { id: 'mingtan',  name: '明潭 / 大觀抽蓄', en: 'Sun Moon Lake Hydro', pos: [120.865, 23.835], match: /明潭|大觀|日月潭/, share: { hydro: 0.62 } },
  // ── 離島（獨立電網，不與本島相連；電只在島內流動）──
  //  est：台電若未即時公布（顯示 0 或 N/A），以典型負載推估（MW）
  { id: 'penghu', name: '澎湖尖山電廠', en: 'Penghu · Jianshan', pos: [119.662, 23.583], match: /澎湖|尖山|中屯|湖西/, island: 'penghu', est: 75 },
  { id: 'kinmen', name: '金門塔山電廠', en: 'Kinmen · Tashan', pos: [118.433, 24.487], match: /金門|塔山|夏興/, island: 'kinmen', est: 55 },
  { id: 'matsu',  name: '馬祖珠山電廠', en: 'Matsu · Zhushan', pos: [119.952, 26.150], match: /馬祖|珠山|連江/, island: 'matsu', est: 14 },
  { id: 'ludao',  name: '綠島發電廠',   en: 'Green Island', pos: [121.476, 22.659], match: /綠島/, island: 'ludao', est: 3 },
  { id: 'lanyu',  name: '蘭嶼發電廠',   en: 'Orchid Island', pos: [121.512, 22.066], match: /蘭嶼/, island: 'lanyu', est: 2.5 },
  { id: 'tachien',  name: '德基 / 青山水力', en: 'Tachien Hydro', pos: [121.180, 24.240], match: /德基|青山|谷關|天輪|馬鞍#|卓蘭|萬大|松林|鉅工|水里/, share: { hydro: 0.38 } }
];

/**
 * 都市負載點（引力中心）
 *  demand : 相對用電權重（大致依各區域負載比例；北部最大 → 自然產生南電北送）
 */
export const LOADS = [
  { id: 'xinyi',     name: '台北信義區',   en: 'Taipei · Xinyi',      pos: [121.567, 25.033], demand: 0.36, side: 'right' }, // side：用電視角的標籤放旁邊，避免和新竹重疊
  { id: 'hsp',       name: '新竹科學園區', en: 'Hsinchu Science Park', pos: [121.000, 24.780], demand: 0.17, side: 'left' },
  { id: 'xitun',     name: '台中西屯區',   en: 'Taichung · Xitun',    pos: [120.640, 24.180], demand: 0.17 },
  { id: 'stsp',      name: '台南科學園區', en: 'Tainan Science Park', pos: [120.280, 23.105], demand: 0.13 },
  { id: 'qianzhen',  name: '高雄前鎮區',   en: 'Kaohsiung · Qianzhen', pos: [120.310, 22.595], demand: 0.17 },
  { id: 'hualien',   name: '花蓮市區',     en: 'Hualien City',        pos: [121.605, 23.985], demand: 0.02 },
  { id: 'magong',    name: '馬公市',       en: 'Magong',              pos: [119.566, 23.566], demand: 0, island: 'penghu' },
  { id: 'jincheng',  name: '金城鎮',       en: 'Jincheng',            pos: [118.318, 24.434], demand: 0, island: 'kinmen' },
  { id: 'nangan',    name: '南竿',         en: 'Nangan',              pos: [119.944, 26.160], demand: 0, island: 'matsu' },
  { id: 'ludaotown', name: '綠島鄉',       en: 'Green Island',        pos: [121.493, 22.673], demand: 0, island: 'ludao' },
  { id: 'lanyutown', name: '蘭嶼鄉',       en: 'Orchid Island',       pos: [121.557, 22.043], demand: 0, island: 'lanyu' }
];
// 每個負載點屬於哪個供電區、在該區用電中所佔比例（區域即時用電 → 分配到負載點）
export const LOAD_REGION = {
  xinyi: ['N', 0.66], hsp: ['N', 0.34],
  xitun: ['C', 1],
  stsp: ['S', 0.45], qianzhen: ['S', 0.55],
  hualien: ['E', 1]
};

/**
 * 台電四大供電區（與台電「各區域用電」相同劃分）
 *  share   : 無即時資料時的典型用電比例（推估用）
 *  label   : 地圖上區域文字的位置
 */
export const REGIONS = {
  N: { name: '北部', en: 'NORTH',   share: 0.385, label: [121.72, 25.28], anchor: 'start',
       counties: ['臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣', '連江縣'] },
  C: { name: '中部', en: 'CENTRAL', share: 0.30,  label: [120.22, 24.62], anchor: 'end',
       counties: ['苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣'] },
  S: { name: '南部', en: 'SOUTH',   share: 0.295, label: [119.98, 22.82], anchor: 'end',
       counties: ['嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '澎湖縣', '金門縣'] },
  E: { name: '東部', en: 'EAST',    share: 0.02,  label: [121.62, 23.15], anchor: 'start',
       counties: ['花蓮縣', '臺東縣'] }
};
export const REGION_KEYS = ['N', 'C', 'S', 'E'];
export const countyRegion = (name = '') => {
  const n = name.replace('台', '臺');
  return REGION_KEYS.find((k) => REGIONS[k].counties.includes(n)) || null;
};

/** 電廠所在供電區 */
export const PLANT_REGION = {
  datan: 'N', linkou: 'N', chinshan: 'N', kuosheng: 'N', hsiehho: 'N',
  ow_formosa1: 'C', ow_formosa2: 'C', ow_zhongneng: 'C', ow_changfang: 'C', ow_gch12: 'C', ow_gch4: 'C', ow_tpc: 'C', ow_hailong: 'C', ow_yunneng: 'C',
  taichung: 'C', tunghsiao: 'C', mailiao: 'C', changbin: 'C', miaoli: 'C', mingtan: 'C', tachien: 'C',
  sol_changhua: 'C', sol_yunlin: 'C', sol_taichung: 'C', sol_miaoli: 'C', sol_nantou: 'C', sol_taoyuan: 'N', sol_north: 'N', sol_kaohsiung: 'S', sol_east: 'E',
  hsinta: 'S', maanshan: 'S', cigu: 'S', chiayi: 'S', pingtung: 'S', nanbu: 'S', chiahui: 'S',
  hoping: 'E',
  penghu: 'X', kinmen: 'X', matsu: 'X', ludao: 'X', lanyu: 'X'
};

/** 住家預設位置：彰化北斗 */
/** 我的家沒有固定預設值：每位使用者第一次自己設定（存在各自的裝置） */
export const DEFAULT_HOME = { name: null, pos: null };

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
export const TAIWAN_BOUNDS = [[119.45, 21.85], [122.05, 25.35]]; // 含澎湖
