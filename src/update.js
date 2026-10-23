import { useEffect, useState } from 'react';

/**
 * 新版偵測與更新（特別是 iPhone 主畫面 App：從背景切回來不會重新載入，也不會自己檢查新版）
 *  ・打開後、每次切回前景（最多每分鐘一次）、每 30 分鐘：讀 version.json，比對主程式檔名（內容雜湊）
 *  ・有新版 → 跳出「立即更新／稍後」；按稍後之後，左上角 ⟳ 會亮起，隨時可點
 *  ・更新 = 清掉快取中的舊頁面 → 重新載入（程式檔有版本雜湊，不必清）
 */
const WALLPAPER = new URLSearchParams(location.search).get('mode') === 'wallpaper';
let state = { available: null, dismissed: false, checking: false, latest: null };
const subs = new Set();
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f(state)); };

const mine = () => document.querySelector('script[type="module"][src*="assets/index-"]')?.getAttribute('src')?.replace(/^.*assets\//, '') || null;

let lastCheck = 0;
export async function checkUpdate({ force = false } = {}) {
  if (!import.meta.env.PROD) return null;
  if (!force && Date.now() - lastCheck < 60e3) return state.available;
  lastCheck = Date.now();
  set({ checking: true });
  try {
    const r = await fetch(`./version.json?_=${Date.now()}`, { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    const cur = mine();
    if (!j?.entry || !cur) { set({ checking: false }); return null; }
    if (j.entry === cur) { set({ available: null, checking: false, latest: j }); return null; }
    // 剛更新過但伺服器（CDN）還沒換好 → 不要一直跳視窗，只亮 ⟳
    let tried = null;
    try { tried = sessionStorage.getItem('tgf-upd-tried'); } catch { /* 略 */ }
    set({ available: j, latest: j, checking: false, dismissed: state.dismissed || tried === j.entry });
    if (WALLPAPER) applyUpdate();
    return j;
  } catch {
    set({ checking: false });
    return null;
  }
}

export async function applyUpdate() {
  try { sessionStorage.setItem('tgf-upd-tried', state.available?.entry || ''); } catch { /* 略 */ }
  try { (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* 略 */ }
  try {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const req of await c.keys()) if (!/\/assets\//.test(req.url)) await c.delete(req);
    }
  } catch { /* 略 */ }
  location.reload();
}

export const dismissUpdate = () => set({ dismissed: true });

export function useUpdate() {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); return () => subs.delete(setS); }, []);
  return s;
}

export function startUpdateChecks() {
  if (!import.meta.env.PROD) return;
  setTimeout(() => checkUpdate({ force: true }), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
  addEventListener('focus', () => checkUpdate());
  setInterval(() => checkUpdate({ force: true }), 30 * 60 * 1000);
  // Service Worker 背景下載到不同的首頁 → 立刻再確認一次
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'tgf-update') checkUpdate({ force: true }); });
}
