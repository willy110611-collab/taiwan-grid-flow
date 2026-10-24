// ─────────────────────────────────────────────────────────────
//  台灣光脈搏 — Cloudflare Worker 中繼站 v5
//  v5：環境部 AQI 故障時改給最後一次成功的資料（存在 KV）；台電資料停更或空品備份太舊時 LINE 通知管理者（LINE_TO）
//  貼到 Cloudflare：Workers & Pages → taiwan-grid-flow-data → Edit code → 全部取代 → Deploy
//
//  路徑                     來源（政府公開資料）
//  /genary.json 等 6 檔      台電「今日電力資訊」（免金鑰）
//  /forecast.csv            台電「未來二個月電力供需預測」（免金鑰）
//  /aqi.json                環境部 空氣品質指標 AQI（需 MOENV_KEY）
//  /cems.json               環境部 固定污染源 CEMS 1 小時值，只保留電廠（需 MOENV_KEY）
//  /sun.json                氣象署 署屬氣象站日射量 O-A0091-001（需 CWA_KEY）
//  /config.json             給網頁：LINE 加好友連結
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
//  另需：KV 綁定 NOTIFY、Triggers → Cron「*/10 * * * *」
//
//  好友用法：加好友 → 傳測站名稱（例如「西屯」）登記 → 空品不良或供電吃緊時收到通知
//           傳「現在」立即查詢；「只要供電」「全部通知」「停止」「說明」
// ─────────────────────────────────────────────────────────────
const TP = 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/';
const TP_FILES = new Set(['genary.json', 'genloadareaperc.csv', 'loadpara.json', 'loadfueltype.csv', 'loadfueltype_1.csv', 'loadareas.csv']);
const FORECAST = 'https://service.taipower.com.tw/data/opendata/apply/file/d006014/001.csv';
const MOENV = 'https://data.moenv.gov.tw/api/v2/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
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
    try {
      if (name === 'config.json') {
        const id = (env.LINE_BASIC_ID || '').trim();
        const vapidPublic = env.NOTIFY ? (await vapidKeys(env)).pub : null;
        return new Response(JSON.stringify({ lineFriendUrl: id ? `https://line.me/R/ti/p/${encodeURIComponent(id.startsWith('@') ? id : '@' + id)}` : null, lineId: id || null, vapidPublic }), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
      }
      if (!name) return text(`OK · 機房 ${req.cf?.colo || '?'} · 環境部金鑰${env.MOENV_KEY ? '已設定' : '未設定'}`);
      if (TP_FILES.has(name)) return await cached(ctx, name, 120, () => upstream(TP + name, name));
      if (name === 'forecast.csv') return await cached(ctx, name, 3600, () => upstream(FORECAST, name));
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
    if (hour < SEND_FROM || hour >= SEND_TO) return;
    const today = twDate();
    const users = env.LINE_TOKEN ? await listUsers(env) : [];
    const subs = await listPushSubs(env);
    if (!users.length && !subs.length) return;

    // 1) 供電（全台同一件事）
    const sup = await supplyNow();
    if (sup?.alert) {
      const text = `⚡ 今日供電${sup.label}，尖峰預估備轉 ${sup.rate}%（${sup.hours}）。建議尖峰時段減少用電。`;
      if (users.length && !(await env.NOTIFY.get(`${today}:supply`))) {
        const to = users.filter((u) => u.supply !== false).map((u) => u.id);
        if (await send(env, to, `台灣光脈搏 ${text}`)) await env.NOTIFY.put(`${today}:supply`, '1', { expirationTtl: 2 * 86400 });
      }
      if (subs.length && !(await env.NOTIFY.get(`${today}:psupply`))) {
        await pushAll(env, subs, { title: '台灣光脈搏・供電提醒', body: text });
        await env.NOTIFY.put(`${today}:psupply`, '1', { expirationTtl: 2 * 86400 });
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
      await pushAll(env, targets, { title: '台灣光脈搏・空品提醒', body: aqiText(x) });
      await env.NOTIFY.put(key, '1', { expirationTtl: 2 * 86400 });
    }

    // 2b) LINE（額度快用完就暫停空品）
    if (!users.length || (await quotaRatio(env)) >= 0.8) return;
    for (const [site, x] of bad) {
      const ids = users.filter((u) => u.site === site && u.aqi !== false).map((u) => u.id);
      const key = `${today}:aqi:${site}`;
      if (!ids.length || (await env.NOTIFY.get(key))) continue;
      if (await send(env, ids, `台灣光脈搏 ${aqiText(x)}`)) await env.NOTIFY.put(key, '1', { expirationTtl: 2 * 86400 });
    }
  }
};

const SEND_FROM = 7;   // 台灣時間 07:00 起才發送
const SEND_TO = 22;    // 22:00 後不發送
const AQI_ALERT = 101; // 對敏感族群不健康以上

async function pushAll(env, subs, msg) {
  await Promise.all(subs.map(async (p) => {
    if ((await pushOne(env, p.sub, msg)) === 'gone') await env.NOTIFY.delete(p.key);
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
  await env.NOTIFY.put(key, JSON.stringify({ sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, site, since: twDate() }));
  if (body.test) await pushOne(env, sub, { title: '台灣光脈搏', body: `App 通知已開啟${site ? `（${site}測站）` : ''}，空品不良或供電吃緊時會通知你。` });
  return json({ ok: true, site });
}

async function listPushSubs(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.NOTIFY.list({ prefix: 'p:', cursor });
    for (const k of r.keys) { const v = await env.NOTIFY.get(k.name, 'json'); if (v) out.push({ key: k.name, ...v }); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

/* ───────── LINE ───────── */
const twDate = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const norm = (t) => String(t || '').trim().replace(/臺/g, '台').replace(/\s+/g, '');

async function listUsers(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.NOTIFY.list({ prefix: 'u:', cursor });
    for (const k of r.keys) {
      const v = await env.NOTIFY.get(k.name, 'json');
      if (v) out.push({ id: k.name.slice(2), ...v });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
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

const HELP = `台灣光脈搏 提醒小幫手 ⚡

📍 傳「測站名稱」登記你家附近的空品測站，例如：西屯、二林、忠明

🆓 隨時查詢（免費、想查幾次都可以）
・「現在」即時供電＋你測站的空氣品質
・「預報」未來兩個月供電預測

🔔 通知設定
・「只要供電」只收供電吃緊
・「全部通知」供電＋空品都收
・「停止」不再通知

空品 AQI ≥ 101（對人體有害）或供電非綠燈才通知，每天最多一次，只在 07–22 點發送。
📲 想收更多免費通知：在光脈搏 App「我的家 → 提醒」開啟 App 通知。`;

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
  const save = (patch) => env.NOTIFY.put(key, JSON.stringify({ ...user, ...patch }));

  if (ev.type === 'unfollow') return env.NOTIFY.delete(key);
  if (ev.type === 'follow') {
    await save({ supply: true, aqi: true, since: twDate() });
    return reply(env, ev.replyToken, `感謝加入！\n\n${HELP}`);
  }
  if (ev.type !== 'message' || ev.message?.type !== 'text') return;
  const t = norm(ev.message.text);

  if (/^(說明|help|\?|？|使用說明)$/i.test(t)) return reply(env, ev.replyToken, HELP);
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

async function supplyNow() {
  const para = await (await fetch(TP + 'loadpara.json', { headers: UA })).json().catch(() => null);
  const rec = para?.records?.find((r) => r.fore_peak_resv_rate) || null;
  if (!rec) return null;
  const rate = parseFloat(rec.fore_peak_resv_rate);
  const ind = String(rec.fore_peak_resv_indicator || '').toUpperCase().slice(0, 1);
  const label = { G: '充裕（綠燈）', Y: '吃緊（黃燈）', O: '警戒（橘燈）', R: '限電警戒（紅燈）', B: '限電準備（黑燈）' }[ind] || (rate < 6 ? '警戒' : rate < 10 ? '吃緊' : '充裕');
  const load = parseFloat(para.records.find((r) => r.curr_load)?.curr_load) * 10; // 萬瓩 → MW
  return { rate, label, load, hours: rec.fore_peak_hour_range || '', alert: (ind && ind !== 'G') || rate < 10 };
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
    const g = await (await fetch(`${TP}genary.json?_=${Date.now()}`, { headers: UA })).json();
    const ts = String(g[''] || g.timestamp || '').replace(/\//g, '-');
    const age = ts ? (Date.now() - new Date(ts.replace(' ', 'T') + '+08:00').getTime()) / 60e3 : Infinity;
    if (!(age < 40)) issues.push(['grid', `台電機組資料${Number.isFinite(age) ? `已 ${Math.round(age)} 分鐘沒更新（最後 ${ts.slice(11, 16)}）` : '讀不到'}`]);
  } catch (e) { issues.push(['grid', `台電機組資料讀不到（${e.message}）`]); }
  const since = Number(await env.NOTIFY.get('aqi:failSince')) || 0;
  if (since && Date.now() - since > 3 * 3600e3) issues.push(['aqi', `環境部空品已故障 ${Math.round((Date.now() - since) / 3600e3)} 小時，網頁顯示備份資料`]);
  for (const k of ['grid', 'aqi']) {
    const hit = issues.find((x) => x[0] === k);
    const flag = await env.NOTIFY.get(`watch:${k}`);
    if (hit && !flag) {
      if (await send(env, [env.LINE_TO], `⚠ 台灣光脈搏 資料停更：${hit[1]}`)) await env.NOTIFY.put(`watch:${k}`, '1', { expirationTtl: 6 * 3600 });
    } else if (!hit && flag) {
      await send(env, [env.LINE_TO], `✅ 台灣光脈搏：${k === 'grid' ? '台電機組資料' : '環境部空品'}已恢復正常`);
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
  let res = await cache.match(key);
  if (!res) {
    const fresh = await make();
    res = new Response(fresh.body, fresh);
    res.headers.set('Cache-Control', `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}
