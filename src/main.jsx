import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// PWA：正式版註冊 Service Worker（可加到手機主畫面、離線也能開啟）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  // 背景下載到新版 → 右上角出現「有新版本・點此更新」
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'tgf-update' || document.getElementById('tgf-update')) return;
    const b = document.createElement('button');
    b.id = 'tgf-update';
    b.textContent = '有新版本・點此更新';
    b.onclick = () => location.reload();
    document.body.appendChild(b);
  });
}
