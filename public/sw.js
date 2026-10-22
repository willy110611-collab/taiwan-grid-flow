// 離線快取：頁面與程式用「先上網、失敗再用快取」，所以一鍵更新後重開就是新版。
// 電力資料（data/、taipower/）永遠走網路，不快取，避免看到舊數字。
const CACHE = 'tgf-v0.4.4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 字型、地形圖磚交給瀏覽器
  if (/\/(data|taipower)\//.test(url.pathname)) return; // 即時資料不快取
  e.respondWith(
    fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
