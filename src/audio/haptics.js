/**
 * 按鈕震動（觸覺回饋）：按下按鈕時輕震 8 毫秒
 *  ・只有支援 navigator.vibrate 的裝置（Android Chrome 等）；iPhone 的瀏覽器不支援，選單裡不顯示這個開關
 *  ・預設開啟，可在「更多 → 震動」關掉
 */
const KEY = 'tgf-haptic';

export const hapticSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches;
export const hapticPref = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export function setHapticPref(on) {
  try { on ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, '0'); } catch { /* 只在本次有效 */ }
}

let bound = false;
export function installHaptics() {
  if (bound || !hapticSupported()) return;
  bound = true;
  addEventListener('pointerdown', (e) => {
    if (!hapticPref()) return;
    if (e.target.closest?.('button:not(:disabled), [role="button"], [role="menuitem"], [role="tab"]')) {
      try { navigator.vibrate(8); } catch { /* 部分瀏覽器在背景時會拒絕 */ }
    }
  }, { capture: true, passive: true });
}
