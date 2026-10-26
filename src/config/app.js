import CHANGELOG from './changelog.json';

export const APP = {
  name: '台灣光脈動',
  en: 'Taiwan Grid Flow',
  version: CHANGELOG.version, // 版本號與更新說明統一寫在 changelog.json
  designer: '無聊的人',
  // GitHub Pages 網址（一鍵更新.bat 推送後由 GitHub Actions 自動部署）
  pagesUrl: 'https://willy110611-collab.github.io/taiwan-grid-flow/',
  // Cloudflare Worker 中繼站：代替網頁去抓台電公開資料（解決跨網站限制與海外連線被擋）
  relayUrl: 'https://taiwan-grid-flow-data.willy110611.workers.dev',
  // 小額贊助：填入網址才會顯示按鈕（可放多個平台）
  donate: [
    // 暫時關閉；要開啟時取消下一行註解
    // { label: '用 Portaly 贊助', url: 'https://portaly.cc/tp6ej04jo3' } // 付款 QR 已移出 repo（不公開）
  ],
  // 颱風停電（D2）：台電 psvs1 擋海外主機、也不給跨網站讀取，暫停使用；有新的資料來源再改成 true
  typhoon: false,
  taipowerPage: 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/genshx_.html'
};
