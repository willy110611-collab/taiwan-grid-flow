/**
 * 中繼站 v8.3：/bundle.json?x=air 順便帶的空品（aqi）、煙道（cems）、日照（sun）
 * 資料包到了就通知 useAir／useSun 更新；15 分鐘內的直接用，不另外打中繼站。
 * 中繼站還是舊版（沒有 extra）或資料包失敗時，各自退回原本的網址。
 */
const FRESH = 15 * 60e3;
let extra = null;
let extraAt = 0;
const subs = new Set();
let firstDone;
const first = new Promise((r) => { firstDone = r; });

export function putExtra(x) {
  firstDone();
  if (!x) return;
  extra = x;
  extraAt = Date.now();
  subs.forEach((f) => f());
}

/** 等第一個資料包（最多 6 秒），避免一開頁就同時再打 3 次 */
export const firstExtra = () => Promise.race([first, new Promise((r) => setTimeout(r, 6000))]);

export function onExtra(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** 資料包裡新鮮的那份；沒有就回傳 undefined（呼叫端自己抓） */
export function freshExtra(key) {
  if (!extra?.[key] || Date.now() - extraAt > FRESH) return undefined;
  if (extra[key].error) throw new Error(extra[key].error);
  return extra[key];
}
