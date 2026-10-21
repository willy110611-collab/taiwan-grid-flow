import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 台電網站沒有開 CORS，瀏覽器直接打會被擋。
// 本機（開發 npm run dev、桌布 npm run wallpaper）由 Vite 代理轉發：/taipower/* → https://www.taipower.com.tw/*
// GitHub Pages 版則由 GitHub Actions 每 10 分鐘把資料抓到 ./data/genary.json（見 .github/workflows/deploy.yml）
const taipowerProxy = {
  '/taipower': {
    target: 'https://www.taipower.com.tw',
    changeOrigin: true,
    secure: true,
    rewrite: (p) => p.replace(/^\/taipower/, ''),
    headers: {
      Referer: 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/genshx_.html',
      'User-Agent': 'Mozilla/5.0 (TaiwanGridFlow proxy)'
    }
  }
};

export default defineConfig({
  base: './', // 相對路徑：同一份 build 可放在 GitHub Pages 子路徑，也可本機開
  plugins: [react()],
  server: { host: true, proxy: taipowerProxy },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: taipowerProxy },
  build: { chunkSizeWarningLimit: 2500 }
});
