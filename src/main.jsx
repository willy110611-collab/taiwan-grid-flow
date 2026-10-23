import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { startUpdateChecks } from './update.js';

createRoot(document.getElementById('root')).render(<App />);

// PWA：正式版註冊 Service Worker（可加到手機主畫面、離線也能開啟）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  startUpdateChecks(); // 有新版 → 跳出「立即更新」（見 update.js）
}

// 桌布模式（Lively）好幾天都不會重新整理：
//  ・新版：update.js 每 30 分鐘檢查，桌布模式有新版直接更新
//  ・每天凌晨 4 點重新載入一次，釋放長時間 WebGL 累積的記憶體
if (import.meta.env.PROD && new URLSearchParams(location.search).get('mode') === 'wallpaper') {
  const t = new Date(Date.now() + 8 * 3600e3);
  const next4 = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + (t.getUTCHours() >= 4 ? 1 : 0), 4 - 8, 0, 0);
  setTimeout(() => location.reload(), Math.max(60e3, next4 - Date.now()));
}
