import { useEffect, useState } from 'react';

/**
 * 中／英切換（介面主要文字）
 *  t('中文') → 英文模式時查表，查不到就維持中文（長篇說明文字暫時只有中文）
 *  語言存在這台裝置：localStorage 'tgf-lang'
 */
const KEY = 'tgf-lang';
let lang = (() => { try { return localStorage.getItem(KEY) || 'zh'; } catch { return 'zh'; } })();
const subs = new Set();

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
  '放空': 'Drift', '我的家': 'Home', '亮點': 'Highlights', '徽章': 'Badges', '回放': 'Replay', '資訊': 'Info', '全螢幕': 'Fullscreen', '全島': 'Overview',
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
  // 語言
  '中文': '中文', 'English': 'English'
};
