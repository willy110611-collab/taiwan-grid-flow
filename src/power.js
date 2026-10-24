/** 省電模式偏好：auto（電池低於 20% 且沒在充電、或系統開「節省數據」）／on／off，存在這台裝置 */
const POWER_KEY = 'tgf-power';
export const getPowerPref = () => { try { return localStorage.getItem(POWER_KEY) || 'auto'; } catch { return 'auto'; } };
export const setPowerPref = (v) => { try { localStorage.setItem(POWER_KEY, v); } catch { /* 略 */ } dispatchEvent(new Event('tgf-power')); };
