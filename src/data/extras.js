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
// 模擬模式不抓資料包 → 不用等
try { if (new URLSearchParams(location.search).has('sim')) firstDone(); } catch { /* 非瀏覽器環境 */ }

export function putExtra(x) {
  firstDone();
  if (!x) return;
  extra = x;
  extraAt = Date.now();
  subs.forEach((f) => f());
}

/** 等第一個資料包（成功或失敗都會通知；資料包本身 9 秒逾時，這裡最多等 10 秒），避免一開頁就同時再打 3 次 */
export const firstExtra = () => Promise.race([first, new Promise((r) => setTimeout(r, 10000))]);

export function onExtra(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** 資料包裡有沒有新鮮的那份（成功或失敗都算；排程判斷用，不會丟例外） */
export const hasExtra = (key) => !!extra?.[key] && Date.now() - extraAt <= FRESH;

/** 資料包裡新鮮的那份（可能是 { error }）；沒有就回傳 undefined → 呼叫端改打個別網址。
 *  中繼站讀失敗時個別網址走的是同一個快取，再打一次也一樣，所以不另外抓。 */
export const freshExtra = (key) => (hasExtra(key) ? extra[key] : undefined);
