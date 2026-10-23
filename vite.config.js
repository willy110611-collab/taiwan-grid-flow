import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

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

/** 打包後的樣式檔改成「非阻擋」載入：開機畫面（index.html 內嵌樣式）不必等它，HTML 一到就顯示 */
const nonBlockingCss = {
  name: 'non-blocking-css',
  enforce: 'post',
  transformIndexHtml(html) {
    return html.replace(/<link rel="stylesheet"( crossorigin)? href="([^"]+\.css)">/g,
      (m, co, href) => `<link rel="preload" as="style"${co || ''} href="${href}" onload="this.onload=null;this.rel='stylesheet';window.__cssDone=(window.__cssDone||0)+1"><noscript><link rel="stylesheet" href="${href}"></noscript>`);
  }
};

/**
 * 產生 version.json：給已開著的頁面（尤其 iPhone 主畫面 App）檢查有沒有新版
 *  entry = 主程式檔名（內容雜湊）：程式有改才會不同；GitHub Actions 每 10 分鐘重建資料不會誤判成新版
 */
const versionFile = {
  name: 'version-file',
  apply: 'build',
  generateBundle(_, bundle) {
    const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry)?.fileName.replace(/^assets\//, '');
    const cl = JSON.parse(readFileSync(new URL('./src/config/changelog.json', import.meta.url), 'utf8'));
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...cl, entry }) });
  }
};

export default defineConfig({
  base: './', // 相對路徑：同一份 build 可放在 GitHub Pages 子路徑，也可本機開
  plugins: [react(), nonBlockingCss, versionFile],
  server: { host: true, proxy: taipowerProxy },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: taipowerProxy },
  build: {
    chunkSizeWarningLimit: 2500,
    // 地圖引擎拆成獨立檔：版本更新時通常不變 → 手機直接用快取，不用重新下載
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre';
          if (id.includes('node_modules/@deck.gl') || id.includes('node_modules/@luma.gl') || id.includes('node_modules/@loaders.gl') || id.includes('node_modules/@math.gl') || id.includes('node_modules/@probe.gl')) return 'deckgl';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/taiwan-atlas') || id.includes('node_modules/topojson')) return 'geo';
        }
      }
    }
  }
});
