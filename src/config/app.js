export const APP = {
  name: '台灣光脈搏',
  en: 'Taiwan Grid Flow',
  version: '0.5.6',
  designer: '無聊的人',
  // GitHub Pages 網址（一鍵更新.bat 推送後由 GitHub Actions 自動部署）
  pagesUrl: 'https://willy110611-collab.github.io/taiwan-grid-flow/',
  // Cloudflare Worker 中繼站：代替網頁去抓台電公開資料（解決跨網站限制與海外連線被擋）
  relayUrl: 'https://taiwan-grid-flow-data.willy110611.workers.dev',
  // 小額贊助：填入網址才會顯示按鈕（可放多個平台）
  donate: [
    // { label: 'Buy Me a Coffee', url: 'https://buymeacoffee.com/你的帳號' },
    // { label: '綠界贊助', url: 'https://p.ecpay.com.tw/...' },
  ],
  taipowerPage: 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/genshx_.html'
};
