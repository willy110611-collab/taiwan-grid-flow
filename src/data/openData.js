import { useEffect, useState } from 'react';
import { APP } from '../config/app.js';
import { TOWNS } from '../config/towns.js';
import { townName } from './useHome.js';

/**
 * 台電開放資料（D1 計畫停電、D3 鄉鎮用電、D4 歷年供需、D6 縣市綠電）
 *  建置時由 scripts/opendata.mjs 產生在網站的 ./data/，需要時才下載（每份只下載一次）
 * D2 颱風停電：中繼站 /typhoon.json（每 10 分鐘）；APP.typhoon 為 false 時停用
 */
const cache = new Map();
export function loadSiteJson(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`./data/${name}`, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .catch((e) => { cache.delete(name); throw e; }));
  }
  return cache.get(name);
}

/** { data, error } ；enabled=false 時先不下載 */
export function useSiteJson(name, enabled = true) {
  const [st, setSt] = useState({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadSiteJson(name).then((data) => alive && setSt({ data, error: null })).catch((e) => alive && setSt({ data: null, error: e.message || 'error' }));
    return () => { alive = false; };
  }, [name, enabled]);
  return st;
}

const COUNTY_EN = { 台北市: 'Taipei', 新北市: 'New Taipei', 基隆市: 'Keelung', 桃園市: 'Taoyuan', 新竹市: 'Hsinchu City', 新竹縣: 'Hsinchu County', 苗栗縣: 'Miaoli', 台中市: 'Taichung', 彰化縣: 'Changhua', 南投縣: 'Nantou', 雲林縣: 'Yunlin', 嘉義市: 'Chiayi City', 嘉義縣: 'Chiayi County', 台南市: 'Tainan', 高雄市: 'Kaohsiung', 屏東縣: 'Pingtung', 宜蘭縣: 'Yilan', 花蓮縣: 'Hualien', 台東縣: 'Taitung', 澎湖縣: 'Penghu', 金門縣: 'Kinmen', 連江縣: 'Lienchiang' };
/** 縣市名稱（英文介面顯示英文） */
export const countyName = (c, en) => (en ? COUNTY_EN[String(c).replace(/臺/g, '台')] || c : c);

export const norm = (s) => String(s || '').replace(/臺/g, '台').replace(/\s+/g, '');

/** 我的家 → { county, town, key:'彰化縣北斗鎮' }（用座標找最近的鄉鎮，不依賴名稱） */
export function homeTown(home) {
  if (!home?.pos) return null;
  const key = townName(home.pos);
  const t = TOWNS.find((x) => x[0] + x[1] === key);
  return t ? { county: t[0], town: t[1], key } : null;
}

export const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
export const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10);
export const daysUntil = (ymd) => Math.round((Date.parse(ymd) - Date.parse(twToday())) / 864e5);
const WD = '日一二三四五六', WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekday = (ymd, en) => (en ? WD_EN : WD)[new Date(`${ymd}T12:00:00+08:00`).getUTCDay()];

/** App 通知登記時一起送給中繼站的設定（計畫停電提醒；alerts＝是否也要空品／供電通知） */
export const pushExtra = (home) => ({ town: homeTown(home)?.key || '', road: home.outRoad || '', o3: !!home.outD3, o1: !!home.outD1, alerts: !!home.push, lowc: !!home.push && !!home.lowcPush });

/** 停電是否影響我家：同鄉鎮；有填路名再比對路段 */
export function outageHits(list, place, road) {
  if (!list || !place) return [];
  const r = norm(road);
  return list.filter((g) => g.county === place.county && (g.town === place.town || !g.town) && (!r || g.roads.some((x) => norm(x).includes(r))));
}

/* ───────── D2 颱風／天然災害停電 ───────── */
// 只在台電公布的資料是最近 36 小時內、而且仍有停電（或 12 小時內剛全部修復）時顯示
export function typhoonActive(d) {
  if (!d?.time || !d.ever) return false;
  const age = (Date.now() - Date.parse(d.time)) / 3600e3;
  return age < 36 && (d.now > 0 || age < 12);
}

export function useTyphoon(enabled = true) {
  const [st, setSt] = useState({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true, latest = null;
    const tick = () => {
      if (document.hidden) return;
      fetch(`${APP.relayUrl}/typhoon.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => { latest = data; if (alive) setSt({ data, error: null }); }).catch((e) => alive && setSt((s) => ({ data: s.data, error: e.message })));
    };
    tick();
    // 沒有颱風停電時 30 分鐘看一次就好；有停電時每 10 分鐘更新
    let id;
    const loop = () => { id = setTimeout(() => { tick(); loop(); }, typhoonActive(latest) ? 10 * 60e3 : 30 * 60e3); };
    loop();
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearTimeout(id); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled]);
  return st;
}

export async function typhoonCounty(gid) {
  const r = await fetch(`${APP.relayUrl}/typhoon/county.json?gid=${gid}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/* ───────── D5 家電 ───────── */
// 常見功率（參考值，實際以家電銘牌或能源效率標示為準）；冰箱用「每月度數」
export const APPLIANCES = [
  { id: 'ac', zh: '冷氣', en: 'Air con', w: 900, h: 8, note: { zh: '變頻冷氣實際耗電隨溫差變動，900 W 約為 1.5 噸變頻冷氣運轉中的平均', en: 'Inverter units vary with temperature; 900 W is a typical running average for a 1.5-ton inverter unit' } },
  { id: 'heater', zh: '電暖器', en: 'Heater', w: 1200, h: 4 },
  { id: 'dehum', zh: '除濕機', en: 'Dehumidifier', w: 250, h: 8 },
  { id: 'water', zh: '電熱水器', en: 'Water heater', w: 3000, h: 1.5, note: { zh: '儲熱式依保溫與用水量差異大', en: 'Storage heaters vary a lot with insulation and hot-water use' } },
  { id: 'cooker', zh: '電鍋', en: 'Rice cooker', w: 800, h: 0.7 },
  { id: 'dryer', zh: '烘衣機', en: 'Dryer', w: 1200, h: 1.5 },
  { id: 'washer', zh: '洗衣機', en: 'Washer', w: 400, h: 1 },
  { id: 'tv', zh: '電視', en: 'TV', w: 120, h: 5 },
  { id: 'pc', zh: '電腦', en: 'Computer', w: 200, h: 6 },
  { id: 'hair', zh: '吹風機', en: 'Hair dryer', w: 1200, h: 0.2 },
  { id: 'scooter', zh: '電動機車充電', en: 'E-scooter charging', w: 600, h: 2 }
];

/** 電費小手冊：每篇都附原始來源（只收台電公開資料） */
export const HANDBOOK = [
  {
    zh: '為什麼帳單兩個月一次？級距也跟著加倍', en: 'Why bills come every two months (and tiers double)',
    body: { zh: '住宅與小商店每 2 個月抄表收費一次，約一半用戶在單數月、一半在雙數月抄表；累進電價的每段度數也依兩個月加倍計算。所以把帳單度數除以 2，才是每月用電。', en: 'Homes and small shops are read and billed every two months — about half in odd months, half in even months — and each tier’s kWh is doubled for the two-month bill. Divide your billed kWh by 2 for a monthly figure.' },
    src: '台電〈電價小常識〉', url: 'https://www.taipower.com.tw/2289/2363/2388/2389/10732/normalPost'
  },
  {
    zh: '夏月（6–9 月）每度比較貴', en: 'Summer months (Jun–Sep) cost more per kWh',
    body: { zh: '夏天冷氣用電大增，台電要開發電成本較高的機組，所以住宅與小商店 6 月到 9 月適用較高的夏月電價，其他月份恢復非夏月電價。', en: 'Air-conditioning pushes demand up in summer, so Taipower runs costlier units; homes and small shops pay higher summer rates from June to September.' },
    src: '台電〈電價小常識〉', url: 'https://www.taipower.com.tw/2289/2363/2388/2389/10732/normalPost'
  },
  {
    zh: '冷氣設 26–28°C，搭配電扇', en: 'Set the AC to 26–28°C and add a fan',
    body: { zh: '設定溫度每提高 1°C 約省電 6%；搭配電風扇讓冷氣分布均勻。濾網約每 2 週清一次。冷氣噸數約＝室內坪數 × 0.15，西曬或頂樓可再大一點。', en: 'Each 1°C higher saves about 6%; a fan spreads the cool air. Clean the filter about every 2 weeks. Size ≈ floor area (ping) × 0.15 tons; go larger for west-facing or top-floor rooms.' },
    src: '台電兒童網〈電器節電－冷氣機〉', url: 'https://www.taipower.com.tw/1136/1149/2273/3157/normalPost'
  },
  {
    zh: '開冷氣前先讓房間降溫', en: 'Cool the room before turning on the AC',
    body: { zh: '白天拉窗簾、窗戶貼隔熱紙可擋輻射熱；出門前關電器；回家先開窗散熱，再開冷氣，冷氣負荷較小。', en: 'Close curtains and use window film by day, switch appliances off when you leave, and air the room out before turning the AC on.' },
    src: '台電〈不插電降溫有撇步 開冷氣前別忘了〉', url: 'https://www.taipower.com.tw/2289/2512/65434/2513/61892/normalPost'
  },
  {
    zh: '老舊窗型冷氣換一級變頻能省多少？', en: 'Swapping an old window unit for a grade-1 inverter',
    body: { zh: '台電試算：冷房能力 5 kW（約 6–8 坪）、每天開 8 小時，舊窗型定頻換成一級能效變頻，整個夏天約省近 4,000 元；實際依使用環境而不同。', en: 'Taipower’s example: a 5 kW unit (6–8 ping room) running 8 h a day saves nearly NT$4,000 over a summer when an old fixed-speed window unit is replaced by a grade-1 inverter. Real savings vary.' },
    src: '台電〈舊窗型定頻換分離式變頻 電費可省多少?〉', url: 'https://www.taipower.com.tw/2289/2512/65434/2513/56532/normalPost'
  },
  {
    zh: '冰箱：8 分滿、少開門、檢查門封條', en: 'Fridge: 80% full, fewer openings, check the seal',
    body: { zh: '冰箱塞太滿冷空氣不流通；開一次門壓縮機平均要多運轉約 10 分鐘；門封條老化會一直漏冷氣。', en: 'Overfilling blocks airflow; each opening makes the compressor run about 10 extra minutes; a worn door seal leaks cold air.' },
    src: '台電〈冰食材小心別漏財 3招冰箱節電術〉', url: 'https://www.taipower.com.tw/2289/2512/65434/2513/69254/normalPost'
  },
  {
    zh: '除濕機：清濾網、關門窗、放中間', en: 'Dehumidifier: clean filter, close windows, place centrally',
    body: { zh: '濾網 2–3 週清一次，一年約省 8% 用電；開除濕機要關門窗；放在房間中央通風處，搭配風扇效率更好。', en: 'Cleaning the filter every 2–3 weeks saves about 8% a year; close doors and windows; put it in the middle of the room and add a fan.' },
    src: '台電〈濕氣除不完 4招除濕效率更好〉', url: 'https://www.taipower.com.tw/2289/2512/65434/2513/69261/normalPost'
  },
  {
    zh: '冬天開暖氣：出風口朝下', en: 'Heating in winter: point the vents down',
    body: { zh: '熱空氣會上升，暖氣出風口要朝下；拉上厚窗簾減少散熱；搭配吊扇或循環扇讓熱空氣下沉。', en: 'Hot air rises, so point vents down; heavy curtains keep heat in; a ceiling or circulation fan pushes warm air down.' },
    src: '台電〈3撇步 讓變頻暖氣暖房效果更好〉', url: 'https://www.taipower.com.tw/2289/2512/65434/2513/45574/normalPost'
  },
  {
    zh: '時間電價適不適合我家？', en: 'Is a time-of-use tariff right for me?',
    body: { zh: '可以先用本 App「我的家」的試算，或用台電官方的試算評估網頁。', en: 'Try the estimate under Home in this app, or Taipower’s official evaluator.' },
    src: '台電〈簡易型時間電價試算評估〉', url: 'https://service.taipower.com.tw/taipowerdsm/residential-and-commercial'
  }
];
