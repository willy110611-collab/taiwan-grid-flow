import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// PWA：正式版註冊 Service Worker（可加到手機主畫面、離線也能開啟）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  const WALLPAPER = new URLSearchParams(location.search).get('mode') === 'wallpaper';
  // 背景下載到新版 → 一般模式：右上角出現「有新版本・點此更新」；桌布模式：直接重新載入（沒人會去點）
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'tgf-update' && WALLPAPER) { location.reload(); return; }
    if (e.data?.type !== 'tgf-update' || document.getElementById('tgf-update')) return;
    const b = document.createElement('button');
    b.id = 'tgf-update';
    b.textContent = '有新版本・點此更新';
    b.onclick = () => location.reload();
    document.body.appendChild(b);
  });
}

// 桌布模式（Lively）好幾天都不會重新整理：
//  ・每 30 分鐘向伺服器確認一次首頁（Service Worker 會比對，有新版就通知 → 上面自動重新載入）
//  ・每天凌晨 4 點重新載入一次，釋放長時間 WebGL 累積的記憶體
if (import.meta.env.PROD && new URLSearchParams(location.search).get('mode') === 'wallpaper') {
  setInterval(() => {
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    fetch(`./?check=${Date.now()}`).catch(() => {});
  }, 30 * 60 * 1000);
  const t = new Date(Date.now() + 8 * 3600e3);
  const next4 = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + (t.getUTCHours() >= 4 ? 1 : 0), 4 - 8, 0, 0);
  setTimeout(() => location.reload(), Math.max(60e3, next4 - Date.now()));
}
