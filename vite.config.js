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
    // 用一般瀏覽器的標頭；台電網站的防火牆可能擋掉不像瀏覽器的請求
    headers: {
      Referer: 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/genshx_.html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-TW,zh;q=0.9'
    },
    configure: (proxy) => {
      proxy.on('error', (err) => console.error('[台電代理] 連線失敗：', err.code || err.message));
      proxy.on('proxyRes', (res, req) => {
        if (res.statusCode >= 400) console.error(`[台電代理] ${req.url} → HTTP ${res.statusCode}`);
      });
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
