import { APP } from './config/app.js';

/**
 * G3 錯誤回報（匿名）：網站出錯時把「錯誤訊息、發生位置、版本、手機/電腦」送到中繼站 /log
 *  ・不含任何個人資料（沒有位置、沒有我的家、沒有店家資料、網址不帶參數）
 *  ・同一個錯誤這次打開只送一次，每次打開最多 5 筆
 *  ・中繼站存 30 天作為維修紀錄；同一個錯誤一天出現多次才 LINE 通知管理者
 */
const sent = new Set();
let count = 0;

export function reportError(err, where = 'global') {
  try {
    const msg = String(err?.message || err || 'unknown').slice(0, 300);
    const key = `${where}|${msg}`;
    if (sent.has(key) || count >= 5) return;
    sent.add(key);
    count++;
    const body = {
      v: APP.version,
      where,
      msg,
      stack: String(err?.stack || '').split('\n').slice(0, 6).join('\n').slice(0, 800),
      device: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop',
      mode: new URLSearchParams(location.search).get('mode') || 'app',
      t: Date.now()
    };
    const url = `${APP.relayUrl}/log`;
    const data = JSON.stringify(body);
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([data], { type: 'text/plain' }));
    else fetch(url, { method: 'POST', body: data, keepalive: true }).catch(() => {});
  } catch { /* 回報失敗就算了，不能讓回報本身再出錯 */ }
}

/** 全域：沒有被接住的錯誤 */
export function installErrorReporting() {
  if (!import.meta.env.PROD || new URLSearchParams(location.search).has('sim')) return; // 開發與模擬模式不回報
  addEventListener('error', (e) => {
    if (e?.message === 'ResizeObserver loop limit exceeded' || /ResizeObserver loop/.test(e?.message || '')) return; // 瀏覽器雜訊
    reportError(e.error || e.message, 'global');
  });
  addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
