// ─────────────────────────────────────────────────────────────
//  台灣脈動 — Cloudflare Worker 中繼站 v8.10
//  v8.10：名稱改「台灣脈動」（推播、LINE 訊息）
//  v8.9：/water/tainan-pipes.json 轉送臺南市「公共管線圖資－給水系統管線」（soa.tainan.gov.tw 擋海外主機；給 Actions 定期轉檔用）
//  v8.8：低碳時段通知（訂閱 lowc）：每天依昨日燃料別曲線推估 07–22 點最低碳的 2 小時，時段開始時發 App 通知（中英）
//  v8.7：App 通知依訂閱語言（lang：zh／en）發中文或英文；網頁換語言時會重新登記
//  v8.6：意見回饋改為每則一個鍵 fb:日期:時間（同時送出不互相覆蓋）、60 秒限制改用 KV（只存 IP 雜湊、60 秒自動刪）、每天滿 100 則回 503 full
//  v8.5：意見回饋（POST /feedback）：存 KV fb:日期（180 天），每天前 10 則 LINE 通知管理者；管理者在 LINE 傳「回饋」看最近 7 天
//  v8.4：訂閱資料（App 通知 p:、LINE 好友 u:）同時存成 KV list metadata → 排程列出時不用逐筆讀（原本每 10 分鐘讀「人數」次，約 690 人就用完每天 10 萬次免費讀取）
//  v8.3：/bundle.json?x=air 順便帶空品（aqi）、煙道（cems）、日照（sun）→ 網頁每人每小時請求從約 16 次降到 6 次
//  v8.2：/open/unit-history.json 轉送台電「各機組過去發電量」（data.gov.tw 37331，每月更新）
//  v8.1：名稱改「台灣光脈動」；颱風停電暫停（/typhoon.json 直接回 503，不再等台電逾時）
//  v8：/bundle.json 一次給網頁 7 份台電資料（每人每 10 分鐘 1 次請求，原本 7 次）並回報同時在線人數（Durable Object「Presence」）；
//      台電讀不到時改給最後一份成功的資料（不讓大家同時失敗）；LINE 主動推播（供電／空品）預設只發給管理者 LINE_TO，好友不推（省免費額度）；台電資料問題連續 30 分鐘才通知；格式檢查不再把裝置容量「-」當錯誤
//  v7：台電開放資料原檔轉送（/open/…，給 GitHub 建置用）、颱風停電（/typhoon.json）、
//      計畫停電每日存檔（KV outage:raw:日期）與「前 3 天／前 1 天」App 通知（依訂閱者的鄉鎮、路名）
//  v6：網站錯誤回報與 30 天維修紀錄（POST /log）、台電資料格式改變偵測、每小時健康檢查失敗通知（/alert）
//      管理者在 LINE 傳「錯誤紀錄」可看最近 7 天的錯誤統計
//  v5：環境部 AQI 故障時改給最後一次成功的資料（存在 KV）；台電資料停更或空品備份太舊時 LINE 通知管理者（LINE_TO）
//  貼到 Cloudflare：Workers & Pages → taiwan-grid-flow-data → Edit code → 全部取代 → Deploy
//
//  路徑                     來源（政府公開資料）
//  /genary.json 等 6 檔      台電「今日電力資訊」（免金鑰）
//  /forecast.csv            台電「未來二個月電力供需預測」（免金鑰）
//  /aqi.json                環境部 空氣品質指標 AQI（需 MOENV_KEY）
//  /cems.json               環境部 固定污染源 CEMS 1 小時值，只保留電廠（需 MOENV_KEY）
//  /sun.json                氣象署 署屬氣象站日射量 O-A0091-001（需 CWA_KEY）
//  /bundle.json?sid=&x=air  給網頁：台電 7 份資料一次給＋同時在線人數（sid＝每個分頁隨機產生，不含個資）；x=air 另帶 aqi、cems、sun
//  /config.json             給網頁：LINE 加好友連結（v8：LINE_FRIENDS=1 才提供）
//  /open/unit-history.json 台電各機組過去發電量（每 10 分鐘，每月更新三個月前的資料）
//  /open/outage.zip 等      台電開放資料原檔（計畫停電、鄉鎮用電、過去供需、縣市再生能源），不解析、只轉送
//  /typhoon.json            台電「天然災害停復電」各縣市目前停電／曾經停電戶數（免金鑰）
//  /typhoon/county.json?gid= 同上，某縣市各鄉鎮市區
//  POST /line               LINE Webhook（好友登記測站、查詢；回覆訊息免費）
//  POST /push/subscribe     App 通知（Web Push，免費）訂閱／取消，金鑰自動產生存在 KV
//
//  設定（Worker → Settings → Variables and Secrets）：
//   MOENV_KEY        Secret  環境部資料開放平台 API 金鑰
//   CWA_KEY          Secret  （選用）氣象署開放資料授權碼：太陽能依各地即時日照分配
//   LINE_TOKEN       Secret  LINE Channel access token
//   LINE_SECRET      Secret  LINE Channel secret（驗證 Webhook 真的來自 LINE）
//   LINE_BASIC_ID    Text    官方帳號 ID，例如 @123abcde（網頁顯示加好友按鈕）
//   LINE_TO          Text    （選用）管理者 userId，不用傳訊息就自動登記 HOME_SITE；也接收「資料停更」通知
//   HOME_SITE        Text    （選用）管理者的測站，預設「西屯」
//   LINE_MONTHLY_CAP Text    （選用）每月主動推播上限則數，預設 200，避免超過免費額度
//   LINE_FRIENDS     Text    （選用）設成 1 才在網頁顯示加 LINE 好友、並對所有好友主動推播供電／空品（v8 預設只推管理者）
//  v8 另需：Durable Object 綁定 PRESENCE → 類別 Presence（SQLite）
//  另需：KV 綁定 NOTIFY、Triggers → Cron「*/10 * * * *」
//
//  好友用法：加好友 → 傳測站名稱（例如「西屯」）登記 → 空品不良或供電吃緊時收到通知
//           傳「現在」立即查詢；「只要供電」「全部通知」「停止」「說明」
// ─────────────────────────────────────────────────────────────
const TP = 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/';
const TP_FILES = new Set(['genary.json', 'genloadareaperc.csv', 'loadpara.json', 'loadfueltype.csv', 'loadfueltype_1.csv', 'loadareas.csv']);
const FORECAST = 'https://service.taipower.com.tw/data/opendata/apply/file/d006014/001.csv';
const MOENV = 'https://data.moenv.gov.tw/api/v2/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Referer: 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/genshx_.html',
  Accept: '*/*'
};

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const name = new URL(req.url).pathname.replace(/^\/(data\/)?/, '');
    if (req.method === 'POST' && name === 'line') return lineWebhook(req, env, ctx);
    if (req.method === 'POST' && (name === 'push/subscribe' || name === 'push/unsubscribe')) return pushRoute(req, env, name);
    if (req.method === 'POST' && name === 'log') return logRoute(req, env);
    if (req.method === 'POST' && name === 'feedback') return feedbackRoute(req, env, ctx);
    if (name === 'alert') return alertRoute(new URL(req.url), env);
    try {
      if (name === 'config.json') {
        const id = env.LINE_FRIENDS === '1' ? (env.LINE_BASIC_ID || '').trim() : ''; // v8：預設不給加好友連結
        const vapidPublic = env.NOTIFY ? (await vapidKeys(env)).pub : null;
        return new Response(JSON.stringify({ lineFriendUrl: id ? `https://line.me/R/ti/p/${encodeURIComponent(id.startsWith('@') ? id : '@' + id)}` : null, lineId: id || null, vapidPublic }), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
      }
      if (!name) return text(`OK · 機房 ${req.cf?.colo || '?'} · 環境部金鑰${env.MOENV_KEY ? '已設定' : '未設定'}`);
      if (name === 'bundle.json') return await bundle(req, env, ctx);
      if (TP_FILES.has(name)) return await cached(ctx, name, 120, () => upstream(TP + name, name));
      if (name === 'forecast.csv') return await cached(ctx, name, 3600, () => upstream(FORECAST, name));
      if (name.startsWith('open/')) return await openRoute(ctx, name.slice(5));
      if (name === 'water/tainan-pipes.json') { // v8.9：只轉送這一個固定網址（不是開放代理），邊收邊傳不佔記憶體，CDN 快取 1 天
        const r = await fetch(TAINAN_PIPES, { headers: UA, cf: { cacheTtl: 86400, cacheEverything: true } });
        return new Response(r.body, { status: r.status, headers: { ...CORS, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
      }
      // v8.1：颱風停電暫停（台電 psvs1 不讓海外主機讀，原本要等約 24 秒才逾時）→ 直接回應；有新來源時拿掉這行
      if (name === 'typhoon.json' || name === 'typhoon/county.json') return new Response(JSON.stringify({ error: '颱風停電資料暫停提供' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=3600' } });
      if (name === 'typhoon.json') return await cached(ctx, name, 300, () => typhoon());
      if (name === 'typhoon/county.json') { const gid = new URL(req.url).searchParams.get('gid'); if (!/^\d{1,3}$/.test(gid || '')) return new Response('bad gid', { status: 400, headers: CORS }); return await cached(ctx, `typhoon-${gid}`, 300, () => typhoonCounty(gid)); }
      if (name === 'aqi.json') return await cached(ctx, name, 600, () => aqi(env));
      if (name === 'cems.json') return await cached(ctx, name, 900, () => cems(env));
      if (name === 'sun.json') return new URL(req.url).searchParams.has('raw') ? await sun(env, new URL(req.url)) : await cached(ctx, name, 1800, () => sun(env));
      return new Response('not found', { status: 404, headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
    }
  },

  // ── 排程：每 10 分鐘檢查一次 ──
  //  ・只在 07:00–21:59 發送；夜裡變差的，早上 7 點通知
  //  ・每個測站每天最多一次（早上沒達標、下午才達標 → 下午通知）
  //  ・LINE 當月用量超過上限 80%：只推供電，空品改由 App 通知與「現在」查詢
  async scheduled(event, env, ctx) {
    if (!env.NOTIFY) return;
    await watchdog(env); // 資料停更檢查（全天，不受 07–22 限制）
    const hour = new Date(Date.now() + 8 * 3600e3).getUTCHours();
    if (hour === 18) await outageDaily(env).catch(() => {}); // 計畫停電：存檔＋前 3 天／前 1 天提醒（台電 17 時更新）
    if (hour < SEND_FROM || hour >= SEND_TO) return;
    const today = twDate();
    // v8：LINE 主動推播預設只發給管理者（LINE_TO）；好友傳訊息查詢（回覆）仍可用
    const users = !env.LINE_TOKEN ? [] : env.LINE_FRIENDS === '1' ? await listUsers(env) : (await listUsers(env)).filter((u) => u.id === env.LINE_TO); // 預設只推給管理者
    const subs = await listPushSubs(env);
    if (!users.length && !subs.length) return;

    // 1) 供電（全台同一件事）
    const sup = await supplyNow();
    if (sup?.alert) {
      const text = `⚡ 今日供電${sup.label}，尖峰預估備轉 ${sup.rate}%（${sup.hours}）。建議尖峰時段減少用電。`;
      if (users.length && !(await env.NOTIFY.get(`${today}:supply`))) {
        const to = users.filter((u) => u.supply !== false).map((u) => u.id);
        if (await send(env, to, `台灣脈動 ${text}`)) await env.NOTIFY.put(`${today}:supply`, '1', { expirationTtl: 2 * 86400 });
      }
      if (subs.length && !(await env.NOTIFY.get(`${today}:psupply`))) {
        const en = { title: 'Taiwan Grid Flow · Supply alert', body: `⚡ Taiwan’s power supply today: ${sup.labelEn}. Forecast peak operating reserve ${sup.rate}% (${sup.hours}). Please use less power during the peak.` };
        await pushAll(env, subs.filter((p) => p.alerts !== false), (p) => (p.lang === 'en' ? en : { title: '台灣脈動・供電提醒', body: text })); // v7：只訂停電提醒的不收
        await env.NOTIFY.put(`${today}:psupply`, '1', { expirationTtl: 2 * 86400 });
      }
    }

    // 1b) 低碳時段（v8.8）：依昨天同時段推估今天最低碳的 2 小時，開始時通知有勾選的訂閱者（每天一次）
    const lowSubs = subs.filter((p) => p.lowc);
    if (lowSubs.length && !(await env.NOTIFY.get(`${today}:plowc`))) {
      let win = await env.NOTIFY.get(`${today}:lowc`, 'json');
      if (!win) {
        win = (await lowCarbonWindow().catch(() => null)) || { none: true };
        await env.NOTIFY.put(`${today}:lowc`, JSON.stringify(win), { expirationTtl: 2 * 86400 });
      }
      const hm = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
      if (!win.none && hm >= win.from && hm < win.to) {
        await pushAll(env, lowSubs, (p) => (p.lang === 'en'
          ? { title: 'Taiwan Grid Flow · Low-carbon window', body: `🌿 Electricity should be cleanest from now until about ${win.to} (estimated from the same hours yesterday). A good time for laundry, the dryer or charging.` }
          : { title: '台灣脈動・低碳時段', body: `🌿 現在到 ${win.to} 左右電力碳排較低（依昨天同時段推估），適合洗衣、烘衣、充電。` }));
        await env.NOTIFY.put(`${today}:plowc`, '1', { expirationTtl: 2 * 86400 });
      }
    }

    // 2) 空品（各自登記的測站，AQI ≥ 101 對人體有害）
    if (!env.MOENV_KEY) return;
    const stations = await stationsNow(env);
    const bad = new Map(stations.filter((x) => x.aqi >= AQI_ALERT).map((x) => [x.site, x]));
    if (!bad.size) return;
    const aqiText = (x) => `😷 ${x.site}測站 AQI ${x.aqi}（${x.status}），PM2.5 ${x.pm25 ?? '—'}。敏感族群請減少戶外活動，外出可戴口罩。`;

    // 2a) App 通知（免費）
    for (const [site, x] of bad) {
      const targets = subs.filter((p) => p.site === site);
      const key = `${today}:paqi:${site}`;
      if (!targets.length || (await env.NOTIFY.get(key))) continue;
      await pushAll(env, targets, (p) => (p.lang === 'en'
        ? { title: 'Taiwan Grid Flow · Air quality', body: `😷 ${x.site} station AQI ${x.aqi} (${AQI_EN[x.status] || x.status}), PM2.5 ${x.pm25 ?? '—'}. Sensitive groups should limit time outdoors; consider a mask.` }
        : { title: '台灣脈動・空品提醒', body: aqiText(x) }));
      await env.NOTIFY.put(key, '1', { expirationTtl: 2 * 86400 });
    }

    // 2b) LINE（額度快用完就暫停空品）
    if (!users.length || (await quotaRatio(env)) >= 0.8) return;
    for (const [site, x] of bad) {
      const ids = users.filter((u) => u.site === site && u.aqi !== false).map((u) => u.id);
      const key = `${today}:aqi:${site}`;
      if (!ids.length || (await env.NOTIFY.get(key))) continue;
      if (await send(env, ids, `台灣脈動 ${aqiText(x)}`)) await env.NOTIFY.put(key, '1', { expirationTtl: 2 * 86400 });
    }
  }
};

const SEND_FROM = 7;   // 台灣時間 07:00 起才發送
const SEND_TO = 22;    // 22:00 後不發送
const AQI_ALERT = 101; // 對敏感族群不健康以上

async function pushAll(env, subs, msg) { // msg 可以是函式：依訂閱者（語言）給不同內容
  await Promise.all(subs.map(async (p) => {
    if ((await pushOne(env, p.sub, typeof msg === 'function' ? msg(p) : msg)) === 'gone') await env.NOTIFY.delete(p.key);
  }));
}

async function quotaRatio(env) {
  const used = Number(await env.NOTIFY.get(`quota:${twDate().slice(0, 7)}`)) || 0;
  return used / (Number(env.LINE_MONTHLY_CAP) || 200);
}

/* ───────── App 通知（Web Push，免費、不限則數）─────────
 * 金鑰（VAPID）第一次使用時自動產生並存在 KV，不需要手動設定。
 * 加密依 RFC 8291（aes128gcm），只用 Cloudflare 內建的 WebCrypto。 */
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)), (c) => c.charCodeAt(0))
};
const cat = (...arrs) => { const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const te = (s) => new TextEncoder().encode(s);

async function vapidKeys(env) {
  let k = await env.NOTIFY.get('vapid', 'json');
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    k = { jwk, pub: b64u.enc(pub) };
    await env.NOTIFY.put('vapid', JSON.stringify(k));
  }
  return k;
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** RFC 8291 加密：回傳 aes128gcm 內容 */
async function encryptPush(sub, payload) {
  const uaPub = b64u.dec(sub.keys.p256dh);
  const auth = b64u.dec(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(te('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(te(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function vapidAuth(env, endpoint) {
  const k = await vapidKeys(env);
  const key = await crypto.subtle.importKey('jwk', k.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u.enc(te(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(te(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://willy110611-collab.github.io/taiwan-grid-flow/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${k.pub}`;
}

/** 送一則 App 通知；回傳 'ok' | 'gone'（訂閱已失效）| 'fail' */
async function pushOne(env, sub, msg) {
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidAuth(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '43200', Urgency: 'normal' },
      body: await encryptPush(sub, JSON.stringify(msg))
    });
    return r.ok ? 'ok' : r.status === 404 || r.status === 410 ? 'gone' : 'fail';
  } catch { return 'fail'; }
}

const subKey = async (endpoint) => 'p:' + b64u.enc(await crypto.subtle.digest('SHA-256', te(endpoint))).slice(0, 32);

async function pushRoute(req, env, name) {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
  if (!env.NOTIFY) return json({ error: '中繼站尚未綁定 KV（NOTIFY）' }, 503);
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return json({ error: 'bad subscription' }, 400);
  const key = await subKey(sub.endpoint);
  if (name === 'push/unsubscribe') { await env.NOTIFY.delete(key); return json({ ok: true }); }
  if (!sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'bad subscription' }, 400);
  const site = String(body.site || '').slice(0, 20) || null;
  // v7：計畫停電提醒（只存鄉鎮與選填的路名，用來比對台電公告的停電範圍）
  const town = String(body.town || '').replace(/\s+/g, '').slice(0, 12) || null;
  const road = String(body.road || '').replace(/\s+/g, '').slice(0, 20) || null;
  const outage = { d3: !!body.o3, d1: !!body.o1 };
  const alerts = body.alerts !== false; // false＝只要停電提醒，不收空品／供電
  const lowc = !!body.lowc; // v8.8：低碳時段開始時通知
  const lang = body.lang === 'en' ? 'en' : 'zh';
  await kvPutJson(env, key, { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, site: alerts ? site : null, alerts, town, road, outage, lang, lowc, since: twDate() });
  if (body.test) await pushOne(env, sub, lang === 'en'
    ? { title: 'Taiwan Grid Flow', body: `Notifications are on${site ? ` (${site} station)` : ''}. We’ll let you know when air quality is poor or power supply is tight.` }
    : { title: '台灣脈動', body: `App 通知已開啟${site ? `（${site}測站）` : ''}，空品不良或供電吃緊時會通知你。` });
  return json({ ok: true, site, town, outage, lang });
}

/* v8.4：KV 值同時放進 list metadata（上限 1024 bytes）→ list() 一次拿到內容，不用逐筆 get()
 *  舊資料沒有 metadata：讀一次後補寫（每筆只會發生一次）；太大放不進 metadata 的就照舊逐筆讀 */
const META_MAX = 1000;
async function kvPutJson(env, key, obj) {
  const text = JSON.stringify(obj);
  await env.NOTIFY.put(key, text, new TextEncoder().encode(text).length <= META_MAX ? { metadata: obj } : undefined);
}
const MIGRATE_PER_RUN = 100; // 補寫 metadata 每次最多幾筆（KV 免費每天 1,000 次寫入，不能一次用光）
async function kvListJson(env, prefix) {
  const out = [];
  let cursor, migrated = 0;
  do {
    const r = await env.NOTIFY.list({ prefix, cursor });
    for (const k of r.keys) {
      let v = k.metadata;
      if (!v) {
        v = await env.NOTIFY.get(k.name, 'json');
        // 補寫失敗（例如寫入額度用完）不影響這次通知
        if (v && migrated < MIGRATE_PER_RUN && new TextEncoder().encode(JSON.stringify(v)).length <= META_MAX) { migrated++; await kvPutJson(env, k.name, v).catch(() => {}); }
      }
      if (v) out.push([k.name, v]);
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

async function listPushSubs(env) {
  return (await kvListJson(env, 'p:')).map(([key, v]) => ({ key, ...v }));
}

/* ───────── LINE ───────── */
const twDate = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const norm = (t) => String(t || '').trim().replace(/臺/g, '台').replace(/\s+/g, '');

async function listUsers(env) {
  const out = (await kvListJson(env, 'u:')).map(([key, v]) => ({ id: key.slice(2), ...v }));
  // 管理者（LINE_TO）沒傳過訊息也算登記
  if (env.LINE_TO && !out.some((u) => u.id === env.LINE_TO)) out.push({ id: env.LINE_TO, site: env.HOME_SITE || '西屯' });
  return out;
}

/** 主動推播（multicast，每位收件人算 1 則）；超過每月上限就不送 */
async function send(env, ids, textMsg) {
  if (!ids.length) return false;
  const month = twDate().slice(0, 7);
  const cap = Number(env.LINE_MONTHLY_CAP) || 200;
  const used = Number(await env.NOTIFY.get(`quota:${month}`)) || 0;
  if (used + ids.length > cap) return false;
  for (let i = 0; i < ids.length; i += 500) {
    const r = await fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LINE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: ids.slice(i, i + 500), messages: [{ type: 'text', text: textMsg }] })
    });
    if (!r.ok) return false;
  }
  await env.NOTIFY.put(`quota:${month}`, String(used + ids.length), { expirationTtl: 40 * 86400 });
  return true;
}

async function reply(env, token, textMsg) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken: token, messages: [{ type: 'text', text: textMsg.slice(0, 4900) }] })
  });
}

async function verify(env, body, sig) {
  if (!env.LINE_SECRET || !sig) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LINE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === sig;
}

const HELP = `台灣脈動 提醒小幫手 ⚡

📍 傳「測站名稱」登記你家附近的空品測站，例如：西屯、二林、忠明

🆓 隨時查詢（免費、想查幾次都可以）
・「現在」即時供電＋你測站的空氣品質
・「預報」未來兩個月供電預測

🔔 通知設定
・「只要供電」只收供電吃緊
・「全部通知」供電＋空品都收
・「停止」不再通知

空品 AQI ≥ 101（對人體有害）或供電非綠燈才通知，每天最多一次，只在 07–22 點發送。
📲 想收更多免費通知：在台灣脈動 App「我的家 → 提醒」開啟 App 通知。`;

async function lineWebhook(req, env, ctx) {
  const body = await req.text();
  if (!(await verify(env, body, req.headers.get('x-line-signature')))) return new Response('bad signature', { status: 401 });
  const events = JSON.parse(body).events || [];
  ctx.waitUntil(Promise.all(events.map((ev) => handleEvent(env, ev).catch(() => null))));
  return new Response('OK');
}

async function handleEvent(env, ev) {
  const id = ev.source?.userId;
  if (!id || !env.NOTIFY) return;
  const key = `u:${id}`;
  const user = (await env.NOTIFY.get(key, 'json')) || (id === env.LINE_TO ? { site: env.HOME_SITE || '西屯' } : {});
  const save = (patch) => kvPutJson(env, key, { ...user, ...patch });

  if (ev.type === 'unfollow') return env.NOTIFY.delete(key);
  if (ev.type === 'follow') {
    await save({ supply: true, aqi: true, since: twDate() });
    return reply(env, ev.replyToken, `感謝加入！\n\n${HELP}`);
  }
  if (ev.type !== 'message' || ev.message?.type !== 'text') return;
  const t = norm(ev.message.text);

  if (/^(說明|help|\?|？|使用說明)$/i.test(t)) return reply(env, ev.replyToken, HELP);
  if (id === env.LINE_TO && /^錯誤紀錄$/.test(t)) return reply(env, ev.replyToken, await errorSummary(env, 7));
  if (id === env.LINE_TO && /^(意見)?回饋$/.test(t)) return reply(env, ev.replyToken, await feedbackSummary(env, 7));
  if (/^(停止|關閉|取消)(通知)?$/.test(t)) { await save({ supply: false, aqi: false }); return reply(env, ev.replyToken, '已停止所有通知。想恢復請傳「全部通知」。'); }
  if (/^只要供電$/.test(t)) { await save({ supply: true, aqi: false }); return reply(env, ev.replyToken, '好的，只會通知供電吃緊。'); }
  if (/^(全部通知|開啟|開啟通知)$/.test(t)) { await save({ supply: true, aqi: true }); return reply(env, ev.replyToken, `供電與空品通知都已開啟${user.site ? `（測站：${user.site}）` : '，請再傳你家附近的測站名稱'}。`); }

  if (/^(預報|明天|供電預報)$/.test(t)) {
    const rows = await forecastNow();
    if (!rows.length) return reply(env, ev.replyToken, '暫時讀不到台電供電預報。');
    const dot = (r) => (r >= 10 ? '🟢' : r >= 6 ? '🟡' : '🟠');
    return reply(env, ev.replyToken, `📅 台電未來供電預測（尖峰備轉容量率）\n${rows.slice(0, 6).map((x) => `${dot(x.rate)} ${x.date}　${x.rate}%`).join('\n')}\n\n🟢 ≥10% 充裕　🟡 6–10% 吃緊　🟠 <6% 警戒`);
  }

  const stations = env.MOENV_KEY ? await stationsNow(env) : [];
  if (/^(現在|查詢|狀態|即時)$/.test(t)) {
    const sup = await supplyNow();
    const s = stations.find((x) => x.site === user.site);
    const lines = [
      sup ? `⚡ 供電：${sup.label}，今日尖峰預估備轉 ${sup.rate}%${sup.load ? `\n🔌 目前全台用電 ${Math.round(sup.load).toLocaleString()} MW` : ''}` : '⚡ 供電：暫時讀不到台電資料',
      s ? `🌫 ${s.site}：AQI ${s.aqi ?? '—'}（${s.status || '—'}），PM2.5 ${s.pm25 ?? '—'}` : '🌫 尚未登記測站，傳測站名稱即可登記',
      `🔔 通知：供電${user.supply === false ? '關' : '開'}・空品${user.aqi === false ? '關' : '開'}`,
      'https://willy110611-collab.github.io/taiwan-grid-flow/'
    ];
    return reply(env, ev.replyToken, lines.join('\n'));
  }

  // 測站登記：完全相同 → 去掉「區鄉鎮市」→ 包含
  const q = t.replace(/(測站|站)$/, '');
  const q2 = q.replace(/[區鄉鎮市]$/, '');
  const hit = stations.find((s) => norm(s.site) === q) || stations.find((s) => norm(s.site) === q2) ||
    (q2.length >= 2 ? stations.find((s) => norm(s.site).includes(q2) || q2.includes(norm(s.site))) : null);
  if (hit) {
    await save({ site: hit.site, aqi: user.aqi ?? true, supply: user.supply ?? true, since: user.since || twDate() });
    return reply(env, ev.replyToken, `已登記「${hit.site}」測站（${hit.county}）。\n目前 AQI ${hit.aqi ?? '—'}（${hit.status || '—'}）。\nAQI ≥ 101 時會通知你。`);
  }
  const county = stations.filter((s) => q.includes(norm(s.county).slice(0, 2))).map((s) => s.site);
  return reply(env, ev.replyToken, county.length
    ? `找不到「${ev.message.text}」測站。這個縣市的測站有：${county.join('、')}`
    : `找不到「${ev.message.text}」。\n\n${HELP}`);
}

/* 低碳時段：昨日燃料別曲線（每 10 分鐘，萬瓩）× 燃燒排放係數 → 07:00–22:00 內平均碳排最低的連續 2 小時
 * 欄位順序與網頁 parseAux.js 的 FUEL_COLS 相同；係數與網頁 carbon.js 的 EMISSION 相同 */
const CURVE_COLS = ['gas', 'gas', 'coal', 'coal', 'cogen', 'oil', 'solar', 'wind', 'hydro', 'storage', 'otherRe', null];
const CO2 = { coal: 0.92, gas: 0.39, oil: 0.78, cogen: 0.70 };
async function lowCarbonWindow() {
  const t = await (await fetch(TP + 'loadfueltype_1.csv', { headers: UA })).text();
  const pts = [];
  for (const l of t.replace(/^\uFEFF/, '').trim().split(/\r?\n/)) {
    const c = l.split(',').map((x) => parseFloat(x));
    const hm = (l.match(/^\s*(\d{1,2}):(\d{2})/) || []).slice(1).map((x) => x.padStart(2, '0')).join(':');
    if (!hm || c.length < 12) continue;
    const vals = c.slice(1);
    const cols = vals.length >= 13 ? ['nuclear', ...CURVE_COLS] : CURVE_COLS;
    let mw = 0, co2 = 0;
    cols.forEach((f, i) => { if (!f || f === 'storage' || !(vals[i] > 0)) return; mw += vals[i]; co2 += vals[i] * (CO2[f] || 0); });
    if (mw > 1000) pts.push({ hm, ci: co2 / mw });
  }
  const day = pts.filter((p) => p.hm >= `${String(SEND_FROM).padStart(2, '0')}:00` && p.hm < `${SEND_TO}:00`);
  let best = null;
  for (let i = 0; i + 12 <= day.length; i++) {
    const avg = day.slice(i, i + 12).reduce((a, p) => a + p.ci, 0) / 12;
    if (!best || avg < best.avg) best = { from: day[i].hm, to: day[Math.min(day.length - 1, i + 12)].hm, avg: Math.round(avg * 1000) / 1000 };
  }
  return best;
}

const AQI_EN = { 良好: 'good', 普通: 'moderate', 對敏感族群不健康: 'unhealthy for sensitive groups', 對所有族群不健康: 'unhealthy', 非常不健康: 'very unhealthy', 危害: 'hazardous' };

async function supplyNow() {
  const para = await (await fetch(TP + 'loadpara.json', { headers: UA })).json().catch(() => null);
  const rec = para?.records?.find((r) => r.fore_peak_resv_rate) || null;
  if (!rec) return null;
  const rate = parseFloat(rec.fore_peak_resv_rate);
  const ind = String(rec.fore_peak_resv_indicator || '').toUpperCase().slice(0, 1);
  const label = { G: '充裕（綠燈）', Y: '吃緊（黃燈）', O: '警戒（橘燈）', R: '限電警戒（紅燈）', B: '限電準備（黑燈）' }[ind] || (rate < 6 ? '警戒' : rate < 10 ? '吃緊' : '充裕');
  const labelEn = { G: 'ample (green)', Y: 'tight (yellow)', O: 'alert (orange)', R: 'rationing alert (red)', B: 'rationing prep (black)' }[ind] || (rate < 6 ? 'alert' : rate < 10 ? 'tight' : 'ample');
  const load = parseFloat(para.records.find((r) => r.curr_load)?.curr_load) * 10; // 萬瓩 → MW
  return { rate, label, labelEn, load, hours: rec.fore_peak_hour_range || '', alert: (ind && ind !== 'G') || rate < 10 };
}

async function forecastNow() {
  try {
    const t = await (await upstream(FORECAST, 'forecast.csv')).text();
    const today = twDate().replace(/-/g, '');
    return t.trim().split(/\r?\n/).map((l) => l.split(',')).filter((c) => /^\d{8}$/.test(c[0]) && c[0] >= today)
      .map((c) => ({ date: `${c[0].slice(4, 6)}/${c[0].slice(6, 8)}`, rate: parseFloat(c[4]) })).filter((x) => Number.isFinite(x.rate));
  } catch { return []; }
}

async function stationsNow(env) {
  try {
    const hit = typeof caches !== 'undefined' ? await caches.default.match(new Request('https://cache.local/aqi.json')) : null;
    return JSON.parse(await (hit || (await aqi(env))).text()).stations || [];
  } catch { return []; }
}

function text(s) {
  return new Response(s, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function upstream(url, name) {
  const up = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, { headers: UA });
  if (!up.ok) throw new Error(`來源回應 ${up.status}`);
  const type = name.endsWith('.json') ? 'application/json' : 'text/csv';
  // 台電即時資料是 UTF-8；部分開放資料 CSV 是 Big5。兩種都解一次，選「無法辨識字元」較少的那個。
  // （注意：用 \uFFFD 跳脫字元，不要直接寫那個符號——貼進 Cloudflare 編輯器時會被吃掉，造成每個檔案都被誤判成 Big5）
  const buf = await up.arrayBuffer();
  const bad = (t) => (t.match(/\uFFFD/g) || []).length;
  let body = new TextDecoder('utf-8').decode(buf);
  if (bad(body) > 0) {
    try {
      const big5 = new TextDecoder('big5').decode(buf);
      if (bad(big5) < bad(body)) body = big5;
    } catch { /* 保持 utf-8 */ }
  }
  return new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8` } });
}

async function moenv(env, id, params = '') {
  if (!env.MOENV_KEY) throw new Error('尚未設定環境部 API 金鑰（MOENV_KEY）');
  const r = await fetch(`${MOENV}${id}?api_key=${env.MOENV_KEY}&format=JSON&limit=10000${params}`);
  const t = await r.text();
  if (!t.trim().startsWith('{') && !t.trim().startsWith('[')) throw new Error(`環境部：${t.slice(0, 60)}`);
  const j = JSON.parse(t);
  return Array.isArray(j) ? j : j.records || [];
}

// AQI：只留下畫面需要的欄位
//  v5：成功時存一份到 KV；環境部故障時改給這份備份（stale: true、savedAt），網頁標示「顯示 HH:MM 的資料」
async function aqi(env) {
  let rows;
  try {
    rows = await moenv(env, 'aqx_p_432');
    if (!rows.length) throw new Error('環境部：沒有資料');
  } catch (e) {
    const last = env.NOTIFY ? await env.NOTIFY.get('aqi:last', 'json') : null;
    if (!last?.stations?.length) throw e;
    if (env.NOTIFY && !(await env.NOTIFY.get('aqi:failSince'))) await env.NOTIFY.put('aqi:failSince', String(Date.now()), { expirationTtl: 3 * 86400 });
    return new Response(JSON.stringify({ ...last, stale: true, reason: e.message }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  const n = (v) => (v === '' || v == null || v === '-' ? null : Number(v));
  const stations = rows.map((r) => ({
    site: r.sitename, county: r.county, aqi: n(r.aqi), status: r.status, pollutant: r.pollutant,
    pm25: n(r['pm2.5']), pm10: n(r.pm10), o3: n(r.o3),
    windSpeed: n(r.wind_speed), windDir: n(r.wind_direc),
    lng: n(r.longitude), lat: n(r.latitude), time: r.publishtime
  })).filter((s) => s.lng && s.lat);
  if (env.NOTIFY && stations.length) {
    const newest = stations.map((x) => x.time).filter(Boolean).sort().pop() || '';
    const prev = await env.NOTIFY.get('aqi:lastTime');
    if (newest !== prev) {
      await env.NOTIFY.put('aqi:last', JSON.stringify({ stations, savedAt: new Date().toISOString() }));
      await env.NOTIFY.put('aqi:lastTime', newest);
    }
    await env.NOTIFY.delete('aqi:failSince');
  }
  return new Response(JSON.stringify({ stations }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/* ───────── 資料停更檢查（v5）─────────
 *  台電機組資料超過 40 分鐘沒更新、或環境部空品故障超過 3 小時 → LINE 通知管理者（LINE_TO）
 *  同一件事 6 小時內只通知一次；恢復時再通知一次 */
async function watchdog(env) {
  if (!env.LINE_TOKEN || !env.LINE_TO) return;
  const issues = [];
  try {
    // v8：偶發的連線錯誤（例如 Cloudflare 1016）先等 5 秒重試一次
    const getG = async () => JSON.parse((await (await fetch(`${TP}genary.json?_=${Date.now()}`, { headers: UA })).text()).replace(/^\uFEFF/, ''));
    const g = await getG().catch(async () => { await new Promise((r) => setTimeout(r, 5000)); return getG(); });
    const ts = String(g[''] || g.timestamp || '').replace(/\//g, '-');
    const age = ts ? (Date.now() - new Date(ts.replace(' ', 'T') + '+08:00').getTime()) / 60e3 : Infinity;
    if (!(age < 40)) issues.push(['grid', `台電機組資料${Number.isFinite(age) ? `已 ${Math.round(age)} 分鐘沒更新（最後 ${ts.slice(11, 16)}）` : '讀不到'}`]);
  } catch (e) { issues.push(['grid', `台電機組資料讀不到（${e.message}）`]); }
  const fmt = await formatCheck();
  if (fmt) issues.push(['format', `台電資料格式可能改了（${fmt}），網站可能需要更新程式`]);
  const since = Number(await env.NOTIFY.get('aqi:failSince')) || 0;
  if (since && Date.now() - since > 3 * 3600e3) issues.push(['aqi', `環境部空品已故障 ${Math.round((Date.now() - since) / 3600e3)} 小時，網頁顯示備份資料`]);
  await errorAlerts(env);
  for (const k of ['grid', 'aqi', 'format']) {
    let hit = issues.find((x) => x[0] === k);
    // v8：台電／格式問題要連續 3 次（約 30 分鐘）都有才通知，避免一時連線不穩就發訊息
    if (k !== 'aqi') {
      const n = hit ? Number(await env.NOTIFY.get(`watchn:${k}`) || 0) + 1 : 0;
      if (hit) await env.NOTIFY.put(`watchn:${k}`, String(n), { expirationTtl: 3600 });
      else if (await env.NOTIFY.get(`watchn:${k}`)) await env.NOTIFY.delete(`watchn:${k}`);
      if (hit && n < 3) hit = null;
    }
    const flag = await env.NOTIFY.get(`watch:${k}`);
    if (hit && !flag) {
      if (await send(env, [env.LINE_TO], `⚠ 台灣脈動 資料停更：${hit[1]}`)) await env.NOTIFY.put(`watch:${k}`, '1', { expirationTtl: 6 * 3600 });
    } else if (!hit && flag) {
      await send(env, [env.LINE_TO], `✅ 台灣脈動：${{ grid: '台電機組資料', aqi: '環境部空品', format: '台電資料格式' }[k]}已恢復正常`);
      await env.NOTIFY.delete(`watch:${k}`);
    }
  }
}

// 日射量：氣象署 O-A0091-001（署屬氣象站，MJ/m²）
//  這個資料集只提供「檔案 API」（fileapi），即時查詢 API（rest/datastore）會回 404。
//  JSON 層級未公開 → 自動尋找「同時含測站名稱與日射量、且子層沒有更完整一筆」的物件；同站多個時間取最新。
async function sun(env, url) {
  if (!env.CWA_KEY) throw new Error('尚未設定氣象署授權碼（CWA_KEY）');
  const r = await fetch(`https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/O-A0091-001?Authorization=${env.CWA_KEY}&format=JSON`, { headers: { Accept: 'application/json' } });
  const text = await r.text();
  if (url?.searchParams.has('raw')) return new Response(text.slice(0, 4000), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  let j; try { j = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error(`氣象署回應 ${r.status}：${text.slice(0, 80)}`); }

  const lc = (k) => String(k).toLowerCase();
  const has = (o, key) => { let f = false; const w = (x) => { if (f || !x || typeof x !== 'object') return; for (const [k, v] of Object.entries(x)) { if (lc(k) === key) { f = true; return; } w(v); } }; w(o); return f; };
  const all = (o, key) => { const out = []; const w = (x) => { if (!x || typeof x !== 'object') return; for (const [k, v] of Object.entries(x)) { if (lc(k) === key) out.push(v); w(v); } }; w(o); return out; };
  const stationObjs = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    const kids = Array.isArray(o) ? o : Object.values(o);
    const both = (x) => has(x, 'stationname') && has(x, 'solarradiation');
    if (!Array.isArray(o) && both(o) && !kids.some((k) => k && typeof k === 'object' && !Array.isArray(k) && both(k) && has(k, 'stationname')) &&
        all(o, 'stationname').length === 1) { stationObjs.push(o); return; }
    kids.forEach(walk);
  };
  walk(j);

  const out = [];
  for (const o of stationObjs) {
    const name = all(o, 'stationname')[0];
    // 座標：優先 WGS84
    const coords = []; const cw = (x) => { if (!x || typeof x !== 'object') return; const ks = Object.keys(x).map(lc); if (ks.includes('stationlongitude')) coords.push(x); else Object.values(x).forEach(cw); }; cw(o);
    const c = coords.find((x) => /WGS/i.test(x.CoordinateName || x.coordinateName || '')) || coords[coords.length - 1] || {};
    const lng = parseFloat(c.StationLongitude ?? c.stationLongitude), lat = parseFloat(c.StationLatitude ?? c.stationLatitude);
    // 時間＋數值：找同時含 DateTime 與 SolarRadiation 的物件；沒有就用整站的
    const pairs = [];
    const pw = (x) => { if (!x || typeof x !== 'object') return; const ks = Object.keys(x).map(lc); if (ks.includes('datetime') && has(x, 'solarradiation')) pairs.push(x); Object.values(x).forEach(pw); }; pw(o);
    const cands = (pairs.length ? pairs : [o]).map((x) => ({ time: String(all(x, 'datetime')[0] ?? all(o, 'datetime')[0] ?? ''), value: parseFloat(all(x, 'solarradiation')[0]) }))
      .filter((x) => Number.isFinite(x.value) && x.value >= 0).sort((a, b) => (a.time < b.time ? 1 : -1));
    if (cands.length && lng > 118 && lat > 21) out.push({ site: name, lng, lat, value: cands[0].value, time: cands[0].time });
  }
  if (!out.length) throw new Error(`日射量資料格式不符（${text.slice(0, 120)}）`);
  return new Response(JSON.stringify({ stations: out }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

// CEMS：資料量很大，只保留名稱含「電廠／發電」的設施
async function cems(env) {
  const rows = await moenv(env, 'aqx_p_187');
  const isPlant = (r) => Object.values(r).some((v) => typeof v === 'string' && /發電|電廠|電力/.test(v));
  return new Response(JSON.stringify({ records: rows.filter(isPlant).slice(0, 3000) }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

async function cached(ctx, name, ttl, make) {
  const cache = caches.default;
  const key = new Request(`https://cache.local/${name}`);
  const staleKey = new Request(`https://cache.local/stale/${name}`);
  let res = await cache.match(key);
  if (!res) {
    let fresh;
    try { fresh = await make(); } catch (e) {
      // v8：來源讀不到 → 給最後一份成功的資料（6 小時內），標頭註明 X-Stale
      const old = await cache.match(staleKey);
      if (!old) throw e;
      const out = new Response(old.body, old);
      out.headers.set('X-Stale', '1');
      for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
      return out;
    }
    res = new Response(fresh.body, fresh);
    res.headers.set('Cache-Control', `public, max-age=${ttl}`);
    const keep = res.clone();
    keep.headers.set('Cache-Control', 'public, max-age=21600');
    ctx.waitUntil(Promise.all([cache.put(key, res.clone()), cache.put(staleKey, keep)]));
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

/* ───────── v6：資料格式檢查（台電大幅調整時提醒管理者更新程式）─────────
 *  只檢查「結構」：欄位數、數字欄位、筆數；回傳問題描述，正常回傳 null */
async function formatCheck() {
  const get = async (f) => (await fetch(`${TP}${f}?_=${Date.now()}`, { headers: UA })).text();
  try {
    const g = JSON.parse((await get('genary.json')).replace(/^\uFEFF/, ''));
    const rows = g.aaData;
    if (!Array.isArray(rows) || rows.length < 40) return `genary 只有 ${rows?.length ?? 0} 列`;
    // v8：只看「淨發電量」（第 5 欄）；裝置容量寫「-」的機組（新機組、除役中）是正常的，不算格式不符
    const units = rows.filter((r) => Array.isArray(r) && !/小計/.test(String(r[2])));
    const bad = units.filter((r) => r.length < 7 || !Number.isFinite(parseFloat(String(r[4]).replace(/,/g, ''))));
    if (bad.length > units.length * 0.2) return `genary 有 ${bad.length} 列發電量欄位不符`;
    const p = JSON.parse(await get('loadpara.json'));
    if (!p?.records?.some((r) => r.fore_peak_resv_rate != null)) return 'loadpara 找不到備轉容量率';
    const f = (await get('loadfueltype.csv')).trim().split(/\r?\n/);
    if (f.length < 2 || f[0].split(',').length < 12) return `loadfueltype 欄位 ${f[0]?.split(',').length ?? 0} 欄`;
    return null;
  } catch {
    return null; // 讀不到是連線問題，由「台電機組資料讀不到」那則通知負責，不重複發
  }
}

/* ───────── v6：網站錯誤回報（G3）─────────
 *  POST /log：網站匿名送來的錯誤（訊息、位置、版本、手機/電腦），存成每天一筆清單，保留 31 天
 *  同一個錯誤當天出現 3 次以上（整個畫面壞掉的 1 次就算）→ LINE 通知管理者一次 */
const sigOf = (e) => `${e.v}|${e.where}|${String(e.msg).slice(0, 80)}`;

async function logRoute(req, env) {
  const ok = new Response('ok', { headers: CORS });
  if (!env.NOTIFY) return ok;
  try {
    const raw = (await req.text()).slice(0, 4000);
    const j = JSON.parse(raw);
    const e = {
      t: Date.now(), v: String(j.v || '').slice(0, 12), where: String(j.where || '').slice(0, 20),
      msg: String(j.msg || '').slice(0, 300), stack: String(j.stack || '').slice(0, 800),
      device: j.device === 'mobile' ? 'mobile' : 'desktop', mode: j.mode === 'wallpaper' ? 'wallpaper' : 'app'
    };
    if (!e.msg) return ok;
    const day = twDate();
    const key = `err:${day}`;
    const list = (await env.NOTIFY.get(key, 'json')) || [];
    if (list.length < 300) {
      list.push(e);
      await env.NOTIFY.put(key, JSON.stringify(list), { expirationTtl: 31 * 86400 });
    }
  } catch { /* 格式不對就忽略 */ }
  return ok;
}

async function errorAlerts(env) {
  const day = twDate();
  const list = (await env.NOTIFY.get(`err:${day}`, 'json')) || [];
  if (!list.length) return;
  const by = new Map();
  for (const e of list) {
    const k = sigOf(e);
    const g = by.get(k) || { ...e, n: 0 };
    g.n++;
    by.set(k, g);
  }
  for (const [k, g] of by) {
    const severe = g.where === 'map' || g.where === 'hud';
    if (g.n < (severe ? 1 : 3)) continue;
    const flag = `erralert:${day}:${k}`;
    if (await env.NOTIFY.get(flag)) continue;
    const ok = await send(env, [env.LINE_TO], `⚠ 台灣脈動 網站錯誤（今天 ${g.n} 次）\n版本 v${g.v}・${g.where}・${g.device}\n${g.msg}\n\n傳「錯誤紀錄」看最近 7 天`);
    if (ok) await env.NOTIFY.put(flag, '1', { expirationTtl: 2 * 86400 });
  }
}

/* ───────── v8.5：意見回饋 ─────────
 *  網頁「更多 → 意見回饋」送來：類別、文字（≤500 字）、選填聯絡方式、選填的版本與目前畫面
 *  不存 IP（只存雜湊 60 秒防重複）；同一個 IP 60 秒內只能送一則、全站每天最多 100 則 */
const FB_KIND = { bug: '問題回報', data: '資料有誤', idea: '功能建議', other: '其他' };
async function feedbackRoute(req, env, ctx) {
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
  if (!env.NOTIFY) return json({ error: 'not configured' }, 503);
  let j;
  try { j = JSON.parse((await req.text()).slice(0, 6000)); } catch { return json({ error: 'bad request' }, 400); }
  if (!j || typeof j !== 'object') return json({ error: 'bad request' }, 400);
  const text = String(j.text || '').trim().slice(0, 500);
  if (text.length < 2) return json({ error: 'empty' }, 400);
  // 同一台 60 秒一則：KV 只存 IP 的雜湊、60 秒後自動刪除（workers.dev 網域上 Cache API 沒有作用，所以改用 KV）
  const ip = req.headers.get('CF-Connecting-IP') || '';
  const gate = ip ? `fbip:${await sha256Hex(`fb|${ip}`)}` : null;
  if (gate && await env.NOTIFY.get(gate)) return json({ error: 'too fast' }, 429);
  const day = twDate();
  const n = Number(await env.NOTIFY.get(`fbn:${day}`)) || 0; // 今天第幾則（概略計數，不需精確）
  if (n >= 100) return json({ error: 'full' }, 503);
  const c = j.ctx && typeof j.ctx === 'object' ? j.ctx : null;
  const e = {
    t: Date.now(), kind: FB_KIND[j.kind] ? j.kind : 'other', text,
    contact: String(j.contact || '').trim().slice(0, 80) || null,
    ctx: c ? { v: String(c.v || '').slice(0, 12), device: c.device === 'mobile' ? 'mobile' : 'desktop', lang: c.lang === 'en' ? 'en' : 'zh', view: String(c.view || '').slice(0, 40) } : null
  };
  // 每則一個鍵（同時送出也不會互相覆蓋）
  const ttl = { expirationTtl: 180 * 86400 };
  await env.NOTIFY.put(`fb:${day}:${e.t}-${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(e), ttl);
  ctx.waitUntil(Promise.all([
    env.NOTIFY.put(`fbn:${day}`, String(n + 1), { expirationTtl: 2 * 86400 }),
    gate ? env.NOTIFY.put(gate, '1', { expirationTtl: 60 }) : null
  ]).catch(() => {}));
  // 每天前 10 則用 LINE 通知管理者（主動推播有每月上限，其餘傳「回饋」查）
  if (env.LINE_TOKEN && env.LINE_TO && n < 10) {
    const info = e.ctx ? `\nv${e.ctx.v}・${e.ctx.device === 'mobile' ? '手機' : '電腦'}・${e.ctx.lang === 'en' ? '英文' : '中文'}${e.ctx.view ? `・${e.ctx.view}` : ''}` : '';
    ctx.waitUntil(send(env, [env.LINE_TO], `💬 台灣脈動 意見回饋（${FB_KIND[e.kind]}）\n${text}${e.contact ? `\n聯絡：${e.contact}` : ''}${info}\n\n傳「回饋」看最近 7 天`).catch(() => {}));
  }
  return json({ ok: true });
}

async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function feedbackSummary(env, days) {
  const out = [];
  for (let i = 0; i < days && out.length < 15; i++) {
    const day = new Date(Date.now() + 8 * 3600e3 - i * 864e5).toISOString().slice(0, 10);
    // v8.6 起每則一個鍵 fb:日期:時間；v8.5 的舊資料是整天一個陣列 fb:日期
    const keys = (await env.NOTIFY.list({ prefix: `fb:${day}:` })).keys.map((k) => k.name).sort().reverse();
    const items = (await Promise.all(keys.slice(0, 15 - out.length).map((k) => env.NOTIFY.get(k, 'json')))).filter(Boolean);
    const legacy = (await env.NOTIFY.get(`fb:${day}`, 'json')) || [];
    for (const e of [...items, ...legacy.slice().reverse()]) {
      if (out.length >= 15) break;
      out.push(`${day.slice(5)}［${FB_KIND[e.kind] || '其他'}］${String(e.text).slice(0, 120)}${e.contact ? `（${e.contact}）` : ''}`);
    }
  }
  return out.length ? `💬 最近 ${days} 天意見回饋（新到舊）\n\n${out.join('\n\n')}` : `最近 ${days} 天沒有意見回饋`;
}

async function errorSummary(env, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() + 8 * 3600e3 - i * 864e5).toISOString().slice(0, 10);
    const list = (await env.NOTIFY.get(`err:${day}`, 'json')) || [];
    if (!list.length) continue;
    const by = new Map();
    for (const e of list) { const k = sigOf(e); by.set(k, (by.get(k) || 0) + 1); }
    out.push(`${day}　${list.length} 筆`);
    for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      const [v, where, msg] = k.split('|');
      out.push(`・${n}× v${v} ${where}：${msg}`);
    }
  }
  return out.length ? `🛠 最近 ${days} 天網站錯誤\n${out.join('\n')}` : `✅ 最近 ${days} 天沒有網站錯誤紀錄`;
}

/* ───────── v6：外部健康檢查通知（G2／G6）─────────
 *  GitHub Actions 每小時用真實資料打開網站；失敗才呼叫 /alert?type=site
 *  只接受固定幾種類型、訊息內容寫死在這裡；同一類型 3 小時內只通知一次 */
const ALERTS = {
  site: '⚠ 台灣脈動 每小時檢查失敗：正式網站用真實資料打開時出錯，詳見 GitHub Actions「健康檢查」',
  data: '⚠ 台灣脈動 每小時檢查：網站上的台電資料超過 1 小時沒更新，詳見 GitHub Actions「健康檢查」',
  // v8.11：健康檢查發現嚴重問題（網頁打不開、數字明顯錯誤）已自動暫停網站
  maint: '⛔ 台灣脈動 已自動暫停網站：每小時檢查發現嚴重問題（網頁打不開或數字明顯錯誤），原因見 GitHub Actions「健康檢查」。修好後到 Actions「維護模式」按「重新開放」'
};
async function alertRoute(url, env) {
  const type = url.searchParams.get('type');
  const res = (s) => new Response(s, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!ALERTS[type] || !env.NOTIFY || !env.LINE_TOKEN || !env.LINE_TO) return res('ignored');
  const flag = `alert:${type}`;
  if (await env.NOTIFY.get(flag)) return res('throttled');
  if (await send(env, [env.LINE_TO], ALERTS[type])) await env.NOTIFY.put(flag, '1', { expirationTtl: 3 * 3600 });
  return res('sent');
}

/* ───────── v7：台電開放資料原檔轉送（給 GitHub Actions 建置用，GitHub 主機直連台電會被擋）─────────
 *  只轉送固定幾個檔案；不解析（避免超過 Worker CPU 限制），解析在建置時做 */
const OPEN = 'https://service.taipower.com.tw/data/opendata/apply/file/';
// 臺南市公共管線圖資－給水系統管線（data.gov.tw 122507，政府資料開放授權第 1 版）
const TAINAN_PIPES = 'https://soa.tainan.gov.tw/Api/Service/GetGis/32b5cb9a-2939-4655-b2cc-8031dd20f01e';
const OPEN_FILES = { 'unit-history.json': ['d006010/001.json', 12 * 3600], 'outage.zip': ['d077004/001.zip', 3600], 'supply-history.csv': ['d006005/001.csv', 6 * 3600], 'renew.csv': ['d007011/001.csv', 12 * 3600] };
async function openRoute(ctx, file) {
  const kwh = file.match(/^kwh-(\d{3})\.csv$/);
  const hit = OPEN_FILES[file] || (kwh ? [`d007025/dist_kwh_${kwh[1]}.csv`, 12 * 3600] : null);
  if (!hit) return new Response('not found', { status: 404, headers: CORS });
  return cached(ctx, `open-${file}`, hit[1], async () => {
    const r = await fetch(OPEN + hit[0], { headers: UA });
    if (!r.ok) throw new Error(`台電回應 ${r.status}`);
    return new Response(r.body, { headers: { 'Content-Type': file.endsWith('.zip') ? 'application/zip' : 'text/csv' } });
  });
}

/* ───────── v7：颱風／天然災害停電（台電「停電資訊」psvs1）─────────
 *  Country：各縣市 c0＝目前停電戶數、c1＝曾經停電戶數；typhoonVer：資料時間；title.json：事件名稱 */
const PSVS = 'https://service.taipower.com.tw/psvs1/';
const psvsGet = async (path) => {
  // 先用一般瀏覽器標頭，再試不帶 Referer；各等 12 秒
  const url = `${PSVS}${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`;
  let last;
  for (const headers of [{ ...UA, Referer: PSVS }, { 'User-Agent': UA['User-Agent'] }]) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`台電停電資訊回應 ${r.status}`);
      return JSON.parse((await r.text()).replace(/^\uFEFF/, ''));
    } catch (e) { last = e; }
  }
  throw new Error(`台電停電資訊讀不到（${last?.name === 'TimeoutError' ? '逾時' : last?.message}）`);
};
async function typhoon() {
  const list = await psvsGet('nj_psvs_attr/RangeInfo/Country'); // 主要資料先抓，讀不到就直接回錯誤
  const [title, ver] = await Promise.all([psvsGet('data/title.json').catch(() => ({})), psvsGet('nj_psvs_attr/RangeInfo/typhoonVer').catch(() => [])]);
  const dts = String((Array.isArray(ver) ? ver[0]?.dts : '') || ''); // 20261024.1400
  const m = dts.match(/^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})/);
  const counties = (Array.isArray(list) ? list : []).map((c) => ({ gid: c.gid, name: String(c.name || '').replace(/臺/g, '台'), now: Number(c.c0) || 0, ever: Number(c.c1) || 0 }))
    .filter((c) => c.name).sort((a, b) => b.now - a.now || b.ever - a.ever);
  const now = counties.reduce((a, c) => a + c.now, 0), ever = counties.reduce((a, c) => a + c.ever, 0);
  return new Response(JSON.stringify({ name: String(title?.name || ''), time: m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00` : null, now, ever, counties }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
async function typhoonCounty(gid) {
  // rangeFG 會附帶邊界座標（很大）；只用文字比對取出 info 欄位：「貢寮區:604:340:3966:4137, …」＝名稱:fcid:gid:目前停電:曾經停電
  const r = await fetch(`${PSVS}nj_psvs_attr/RangeInfo/rangeFG?gid=${gid}&fcid=603&_=${Date.now()}`, { headers: { ...UA, Referer: PSVS }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`台電停電資訊回應 ${r.status}`);
  const t = await r.text();
  const info = (t.match(/"info"\s*:\s*"([^"]*)"/) || [])[1] || '';
  const towns = info.split(/,\s*/).map((x) => x.split(':')).filter((a) => a.length >= 5)
    .map((a) => ({ name: a[0].replace(/臺/g, '台'), now: Number(a[3]) || 0, ever: Number(a[4]) || 0 })).sort((a, b) => b.now - a.now || b.ever - a.ever);
  return new Response(JSON.stringify({ gid: Number(gid), towns }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/* ───────── v7：計畫性工作停電（每天 18 時跑一次）─────────
 *  1. 存一份原始 ZIP 到 KV（台電不提供歷史，自己累積）
 *  2. App 通知：訂閱者「我的家」所在鄉鎮（有填路名就比對路名）3 天後／明天有停電 → 通知一次 */
async function outageDaily(env) {
  const today = twDate();
  if (await env.NOTIFY.get(`outage:done:${today}`)) return;
  const r = await fetch(OPEN + 'd077004/001.zip', { headers: UA });
  if (!r.ok) throw new Error(`台電回應 ${r.status}`);
  const zip = new Uint8Array(await r.arrayBuffer());
  await env.NOTIFY.put(`outage:raw:${today}`, zip); // 不設期限：長期累積成歷史
  await env.NOTIFY.put(`outage:done:${today}`, '1', { expirationTtl: 2 * 86400 });

  const subs = (await listPushSubs(env)).filter((p) => p.town && (p.outage?.d3 || p.outage?.d1));
  if (!subs.length) return;
  const rows = [];
  for (const u8 of Object.values(await unzipFiles(zip))) {
    const lines = new TextDecoder().decode(u8).split(/\r?\n/).slice(1);
    for (const l of lines) {
      const c = l.split(',');
      if (c.length < 6) continue;
      const m = String(c[3]).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})\s*[~～-]\s*(\d{1,2}:\d{2})/);
      if (!m) continue;
      rows.push({ date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, time: `${m[4]}–${m[5]}`, office: c[0].replace(/^台電/, ''), place: norm(c[5]) });
    }
  }
  const day = (n) => new Date(Date.parse(today) + n * 864e5).toISOString().slice(0, 10);
  const WD = '日一二三四五六';
  for (const p of subs) {
    for (const [n, flag] of [[3, 'd3'], [1, 'd1']]) {
      if (!p.outage?.[flag]) continue;
      const date = day(n);
      const town = norm(p.town);
      const hits = rows.filter((x) => x.date === date && x.place.startsWith(town) && (!p.road || x.place.includes(norm(p.road))));
      if (!hits.length) continue;
      const times = [...new Set(hits.map((x) => x.time))].join('、');
      const roads = [...new Set(hits.map((x) => x.place.slice(town.length)).filter(Boolean))];
      const wd = new Date(date + 'T12:00:00+08:00').getUTCDay();
      const md = date.slice(5).replace('-', '/');
      const when = `${n === 1 ? '明天' : '3 天後'} ${md}（${WD[wd]}）${times}`;
      const where = `${p.town}${roads.length ? ` ${roads.slice(0, 4).join('、')}${roads.length > 4 ? ` 等 ${roads.length} 處` : ''}` : ''}`;
      await pushOne(env, p.sub, p.lang === 'en'
        ? { title: 'Taiwan Grid Flow · Planned outage', body: `${n === 1 ? 'Tomorrow' : 'In 3 days'}, ${'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[wd]} ${md}, ${times}: planned power outage in ${p.town}${roads.length ? ` (${roads.slice(0, 4).join(', ')}${roads.length > 4 ? ` and ${roads.length - 4} more` : ''})` : ''}. Taipower’s notice is authoritative; call 1911 for details.` }
        : { title: '台灣脈動・計畫停電提醒', body: `${when}，${where}有計畫性停電（${hits[0].office}）。實際範圍以台電通知為準，可撥 1911 查詢。` });
    }
  }
}

async function unzipFiles(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是 ZIP 檔');
  const out = {};
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0, n = dv.getUint16(eocd + 10, true); k < n; k++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const fl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + fl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + size);
    if (/^\d+\.csv$/i.test(name)) out[name] = method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + fl + el + cl;
  }
  return out;
}

/* ───────── v8：一次給齊 7 份台電資料＋同時在線人數 ─────────
 *  網頁每 10 分鐘只打 1 次（原本 7 次），中繼站免費額度可撐約 3 倍人數
 *  每份檔案仍各自快取 2 分鐘（同一機房的人共用），讀不到就給最後一份成功的資料 */
const BUNDLE = { genary: 'genary.json', areas: 'genloadareaperc.csv', para: 'loadpara.json', fuelCurve: 'loadfueltype.csv', areaCurve: 'loadareas.csv', yFuel: 'loadfueltype_1.csv', forecast: 'forecast.csv' };
async function bundle(req, env, ctx) {
  const sid = (new URL(req.url).searchParams.get('sid') || '').replace(/[^\w-]/g, '').slice(0, 40);
  const files = {}, errors = {};
  await Promise.all(Object.entries(BUNDLE).map(async ([k, f]) => {
    try {
      const r = f === 'forecast.csv' ? await cached(ctx, f, 3600, () => upstream(FORECAST, f)) : await cached(ctx, f, 120, () => upstream(TP + f, f));
      files[k] = await r.text();
      if (r.headers.get('X-Stale')) errors[k] = 'stale';
    } catch (e) { errors[k] = e.message; }
  }));
  // v8.3：?x=air → 一起帶空品、煙道、日照（各自沿用原本的快取時間；某一份失敗只放 error，不影響其他）
  let extra;
  if ((new URL(req.url).searchParams.get('x') || '').split(',').includes('air')) {
    extra = {};
    const EXTRA = { aqi: ['aqi.json', 600, () => aqi(env)], cems: ['cems.json', 900, () => cems(env)], sun: ['sun.json', 1800, () => sun(env)] };
    await Promise.all(Object.entries(EXTRA).map(async ([k, [f, ttl, fn]]) => {
      try {
        const r = await cached(ctx, f, ttl, fn);
        extra[k] = JSON.parse(await r.text());
      } catch (e) { extra[k] = { error: e.message }; }
    }));
  }
  let online = null;
  if (sid && env.PRESENCE) {
    try {
      const stub = env.PRESENCE.get(env.PRESENCE.idFromName('all'));
      online = (await (await stub.fetch(`https://presence/hit?sid=${sid}`)).json()).online;
    } catch { /* 在線人數讀不到不影響資料 */ }
  }
  return new Response(JSON.stringify({ t: Date.now(), online, files, errors, ...(extra ? { extra } : {}) }), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/* ───────── v8：同時在線人數（Durable Object，全台只有一個實例）─────────
 *  每個分頁開著時每 10 分鐘來報到一次（跟資料一起，不另外多打）；12 分鐘內報到過的算「在線」
 *  只存隨機分頁代碼與時間，不存 IP 或任何個資 */
const ONLINE_WINDOW = 12 * 60e3;
export class Presence {
  constructor(state) { this.state = state; this.seen = null; }
  async fetch(req) {
    const now = Date.now();
    if (!this.seen) this.seen = new Map(await this.state.storage.list());
    const sid = new URL(req.url).searchParams.get('sid');
    if (sid) { this.seen.set(sid, now); await this.state.storage.put(sid, now); }
    const old = [];
    for (const [k, t] of this.seen) if (now - t > ONLINE_WINDOW) { this.seen.delete(k); old.push(k); }
    for (let i = 0; i < old.length; i += 128) await this.state.storage.delete(old.slice(i, i + 128));
    return new Response(JSON.stringify({ online: this.seen.size }), { headers: { 'Content-Type': 'application/json' } });
  }
}
