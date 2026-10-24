import { useEffect, useState } from 'react';

/**
 * 中／英切換（介面主要文字）
 *  t('中文') → 英文模式時查表，查不到就維持中文
 *  tx('中文', 'English') → 長篇說明直接寫兩種語言
 *  語言存在這台裝置：localStorage 'tgf-lang'
 */
const KEY = 'tgf-lang';
let lang = (() => { try { return localStorage.getItem(KEY) || 'zh'; } catch { return 'zh'; } })();
const subs = new Set();
if (typeof document !== 'undefined') document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';

export function setLang(l) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* 略 */ }
  document.documentElement.lang = l === 'en' ? 'en' : 'zh-Hant';
  subs.forEach((f) => f(l));
}
export const getLang = () => lang;

export function t(zh) {
  if (lang !== 'en' || zh == null) return zh;
  return EN[zh] ?? zh;
}

export const tx = (zh, en) => (lang === 'en' ? en : zh);
export const isEn = () => lang === 'en';

/** 組合句（例如「離峰時段，電價較低」、錯誤訊息）：英文模式時先查整句，再逐段替換 */
const PHRASES = [
  [/今晚 24:00 起(離峰|尖峰)/g, (_, p) => (p === '離峰' ? 'off-peak from midnight' : 'peak from midnight')],
  [/(\d{2}:\d{2}) 起離峰/g, 'off-peak from $1'], [/(\d{2}:\d{2}) 起尖峰/g, 'peak from $1'],
  ['週末全日離峰', 'Weekend — off-peak all day'], ['國定假日全日離峰', 'Holiday — off-peak all day'],
  ['尖峰時段', 'Peak hours'], ['離峰時段', 'Off-peak hours'], ['，電價較低', ', lower price'], ['，電價較高', ', higher price'],
  ['碳排接近今日低點', 'Carbon near today’s low'], ['碳排接近今日高點', 'Carbon near today’s high'],
  [/^供電(.+)$/, (_, x) => `Supply: ${EN['供電' + x] || x}`],
  ['（', ' ('], ['）', ')'], ['，', ', ']
];
export function tr(zh) {
  if (lang !== 'en' || zh == null) return zh;
  if (EN[zh]) return EN[zh];
  let s = String(zh);
  for (const [a, b] of PHRASES) s = typeof a === 'string' ? s.split(a).join(b) : s.replace(a, b);
  return s;
}

/** React：語言改變時重新繪製 */
export function useT() {
  const [, set] = useState(lang);
  useEffect(() => { subs.add(set); return () => subs.delete(set); }, []);
  return t;
}
export function useLang() {
  const [l, set] = useState(lang);
  useEffect(() => { subs.add(set); return () => subs.delete(set); }, []);
  return [l, setLang];
}

const EN = {
  // HUD
  '綠能': 'Green', '火力': 'Thermal', '核能': 'Nuclear', '全部': 'All', '用電': 'Demand', '空品': 'Air',
  'MW · 全台發電': 'MW · generation', 'MW · 全台用電': 'MW · demand',
  '放空': 'Drift', '我的家': 'Home', '亮點': 'Peaks', '徽章': 'Badges', '回放': 'Replay', '資訊': 'Info', '全螢幕': 'Fullscreen', '全島': 'Overview',
  '放空巡航': 'Drift cruise', '日出': 'Sunrise', '日落': 'Sunset', '資料': 'Data',
  'LIVE · 台電即時': 'LIVE · Taipower', 'SIMULATED · 模擬資料': 'SIMULATED', '尖峰備轉': 'peak reserve', '模擬': 'sim', '更新中 · 上次': 'Updating · last',
  '供電充裕': 'Supply OK', '供電吃緊': 'Supply tight', '供電警戒': 'Supply alert', '限電警戒': 'Rationing alert', '限電準備': 'Rationing prep',
  '適合用電': 'Good time to use', '可以用電': 'OK to use', '建議延後': 'Better to wait', '＋ 設定我的家': '＋ Set home',
  '點地圖選擇「我的家」': 'Tap the map to set Home', '取消': 'Cancel', '有新版本・點此更新': 'New version · tap to update',
  // 燃料
  '太陽能': 'Solar', '風力': 'Wind', '水力': 'Hydro', '其他再生': 'Other RE', '燃氣': 'LNG', '燃煤': 'Coal', '汽電共生': 'Co-gen', '燃油': 'Oil', '儲能': 'Storage',
  // 面板標題
  '今日亮點': "Today's highlights", '徽章簿': 'Badges',
  '資料來源': 'Data sources', '準確度': 'Accuracy', '關於': 'About', '連線診斷': 'Connection check', '正常': 'OK',
  // 巡航場景
  '全島能量網': 'Island energy web', '北部負載中心': 'Northern load center', '中部火力走廊': 'Central thermal corridor', '西部能量動脈': 'Western energy artery',
  '嘉南光電星海': 'Chiayi–Tainan solar sea', '南部電源基地': 'Southern power base', '彰濱離岸風場': 'Changhua offshore wind', '離島微光': 'Outlying islands',
  // 電廠卡
  '抽水儲能中': 'Pumping (storing)', '附近風況': 'Nearby wind', '測站': ' station', '岸邊': 'coast',
  '風太小，風機轉不太動': 'too calm for turbines', '風太大，風機可能停機保護': 'too strong, turbines may shut down',
  '有風但沒發電：可能是檢修、測試或尚未商轉': 'windy but idle: maintenance, testing or not yet commercial', '風況正常': 'normal wind',
  '岸邊風速通常比外海小，僅供參考。': 'Coastal wind is usually weaker than offshore; for reference only.',
  '台電即時機組': 'Taipower live units', '硫氧化物': 'SOx', '氮氧化物': 'NOx', '粒狀物': 'PM', '不透光率': 'Opacity', '一氧化碳': 'CO',
  '煙道即時監測（環境部 CEMS）': 'Stack monitoring (MOENV CEMS)',
  '資料：台灣電力公司「今日電力資訊」各機組發電量，每 10 分鐘更新。': 'Source: Taipower real-time unit output, updated every 10 minutes.',
  // 回放
  '今天': 'Today', '昨天': 'Yesterday', '回放 · 電廠出力依燃料曲線推估': 'Replay · plant output estimated from fuel curves',
  'MW · 儲能充電中': 'MW · storage charging', '回放': 'Replay',
  // 亮點／紀錄／試算
  '我的紀錄': 'My records', '這台裝置看過的最高值': 'highest seen on this device', '綠能佔比': 'Green share', '太陽能出力': 'Solar output',
  '風力出力': 'Wind output', '全台用電': 'Demand', '試算：時間電價划算嗎？': 'Calc: is time-of-use cheaper?',
  '空品測站風速資料讀取中（需中繼站環境部金鑰）': 'Loading station wind (needs MOENV key on relay)',
  '目前出力最大': 'Top plant now', '太陽能今日尖峰': 'Solar peak today', '日出後開始累計': 'counts after sunrise', '綠能佔比最高': 'Peak green share',
  '全台負載最高': 'Peak demand', '南電北送': 'South → North', '模型推估': 'modeled', '中南部 → 北部': 'Central/South → North',
  '今日機組異常（偵測）': 'Unit anomalies today', '今日綠能佔比': 'Green share today', '資料讀取中…': 'Loading…', '統計範圍：今日 00:00 至現在。': 'Range: today 00:00 to now.',
  '有新版本': 'New version', '稍後': 'Later', '立即更新': 'Update now', '已是最新版': 'Up to date', '更新到': 'Update to', '檢查新版本': 'Check for updates',
  '按「稍後」之後，左上角的 ⟳ 隨時可以更新。': 'You can update any time with ⟳ at top-left.',
  '歡迎來到': 'Welcome to', '開始': 'Start', '之後可以在「資訊 → 使用說明」再看一次。': 'See it again under Info → Guide.',
  '看現在': 'Now', '點光球': 'Tap a plant', '使用說明': 'Guide', '部分資料暫時讀不到': 'Some data unavailable', '等': '+', '項': 'more',
  '連不到台電資料，目前是模擬畫面': 'Cannot reach Taipower — showing simulation',
  '店家': 'Shop', '店家用電': 'Shop energy',
  // v0.6.2 補齊
  '回到全島俯視圖': 'Back to island view', '贊助': 'Support', '調整模式': 'Adjust mode',
  '拖曳移動 · 滾輪縮放 · 右鍵拖曳旋轉與傾斜': 'Drag to move · scroll to zoom · right-drag to rotate and tilt',
  '固定這個畫面': 'Lock this view', '恢復自動巡航': 'Resume cruise', '2 分鐘沒有操作會自動固定並鎖定': 'Locks automatically after 2 minutes idle',
  '解鎖以調整畫面': 'Unlock to adjust view', '鎖定並固定這個畫面': 'Lock this view', '讀取中…': 'Loading…',
  '用電網多出來的電把水抽上山，晚上再放水發電。地圖上流進這裡的粒子就是這些電。': 'Surplus grid power pumps water uphill; it is released to generate at night. The particles flowing in here are that power.',
  '台電即時資料中約 86% 的太陽能是一整行「其它購電太陽能」，沒有位置；這裡依台電「各縣市太陽光電裝置容量」': 'About 86% of solar in Taipower’s live data is a single “other purchased solar” row with no location; here it is allocated by Taipower’s installed PV capacity by county',
  '分配': '', '並依氣象署即時日射量調整（目前係數': 'adjusted by CWA live solar radiation (factor',
  '台電未即時公布這座離島電廠的出力，依典型負載、季節與時段推估。': 'Taipower does not publish this island plant’s live output; it is estimated from typical load, season and time of day.',
  '台電以彙總列公布（例如陸域風力、小水力），依各節點比例分配。': 'Taipower publishes this as an aggregate row (e.g. onshore wind, small hydro), allocated across nodes by share.',
  // 面板標題、等級
  '空品': 'Air', '用電': 'Demand', '徽章簿': 'Badges', '店家用電': 'Shop energy',
  '常見': 'Common', '少見': 'Uncommon', '稀有': 'Rare',
  '偏低': 'Low', '普通': 'Moderate', '偏高': 'High',
  '良好': 'Good', '對敏感族群不健康': 'Unhealthy for sensitive groups', '對所有族群不健康': 'Unhealthy', '非常不健康': 'Very unhealthy', '危害': 'Hazardous',
  '台電即時': 'Taipower live', '推估分配': 'Allocated',
  // 連線診斷
  '各機組發電量': 'Unit output', '各區發電/用電': 'Regional gen/demand', '供電狀況': 'Supply status', '今日燃料別曲線': 'Today by fuel',
  '今日區域用電曲線': 'Today by region', '昨日燃料別曲線': 'Yesterday by fuel', '未來供電預測': 'Supply forecast',
  '環境部 AQI': 'MOENV AQI', '環境部 CEMS': 'MOENV CEMS', '氣象署日射量': 'CWA solar radiation',
  // 錯誤訊息
  '此瀏覽器不支援定位': 'This browser does not support location', '定位權限被拒絕': 'Location permission denied', '無法取得位置': 'Could not get your location',
  '此瀏覽器不支援通知（iPhone 需先「加入主畫面」）': 'This browser does not support notifications (on iPhone, Add to Home Screen first)',
  '通知權限未允許': 'Notification permission not granted', '中繼站尚未更新到 v4，暫時無法開啟': 'The relay is not on v4 yet, so this is unavailable',
  '通知權限未允許（可到手機設定 → 通知 開啟）': 'Notification permission not granted (enable it in your phone’s Settings → Notifications)',
  '此瀏覽器不支援 App 通知': 'This browser does not support app notifications',
  'iPhone 要先用 Safari「分享 → 加入主畫面」，再從主畫面打開光脈搏開啟（iOS 16.4 以上）': 'On iPhone, use Safari Share → Add to Home Screen first, then open the app from the Home Screen to turn this on (iOS 16.4+)',
  '強制模擬（網址帶 ?sim=1）': 'Forced simulation (?sim=1 in URL)',
  '日射量資料不足或過舊': 'Solar radiation data missing or stale',
  '電廠': 'Plants',
  // 語言
  '中文': '中文', 'English': 'English'
};
