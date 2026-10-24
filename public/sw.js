// 離線快取：頁面與程式用「先上網、失敗再用快取」，所以一鍵更新後重開就是新版。
// 電力資料（data/、taipower/）永遠走網路，不快取，避免看到舊數字。
const CACHE = 'tgf-v0.8.1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  // 連同首頁用到的程式檔一起先存好 → 第二次打開就完全不用下載
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(SHELL);
    const html = await (await c.match('./index.html')).text();
    const assets = [...new Set([...html.matchAll(/(?:href|src)="\.\/(assets\/[^"]+)"/g)].map((m) => './' + m[1]))];
    await c.addAll(assets).catch(() => {});
  }).then(() => self.skipWaiting()));
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
  if (/version\.json$/.test(url.pathname)) return; // 新版檢查：永遠問伺服器
  if (/version\.json$/.test(url.pathname)) return; // 新版檢查：永遠問伺服器

  // 程式檔（檔名含版本雜湊，內容永不改變）：快取優先 → 第二次打開幾乎不用下載
  if (/\/assets\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // 頁面：快取有就「立刻」開（不等網路），同時背景下載新版；新版不同時通知畫面顯示「更新」
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const key = url.pathname.endsWith('/') ? './' : req;
    // 只有「打開頁面」才退回首頁；圖片等其他檔案沒快取就直接上網拿（否則圖片會被錯拿成首頁而顯示不出來）
    const hit = await c.match(key) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
    const net = fetch(req).then(async (res) => {
      if (res.ok && res.type === 'basic') {
        const fresh = await res.clone().text();
        const old = hit ? await hit.clone().text() : null;
        await c.put(key, res.clone());
        if (old && old !== fresh) {
          const list = await self.clients.matchAll({ type: 'window' });
          list.forEach((w) => w.postMessage({ type: 'tgf-update' }));
        }
      }
      return res;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => Response.error());
  }));
});

// ── App 通知（Web Push）：中繼站在空品不良、供電吃緊時送來 ──
self.addEventListener('push', (e) => {
  let msg = { title: '台灣光脈搏', body: '' };
  try { msg = { ...msg, ...e.data.json() }; } catch { if (e.data) msg.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, icon: './icon-192.png', badge: './icon-192.png', tag: msg.tag || msg.title, renotify: true
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((x) => x.url.includes(self.registration.scope));
    return c ? c.focus() : self.clients.openWindow('./');
  }));
});
