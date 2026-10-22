// ─────────────────────────────────────────────────────────────
//  台灣光脈搏 — Cloudflare Worker 中繼站 v3
//  貼到 Cloudflare：Workers & Pages → taiwan-grid-flow-data → Edit code → 全部取代 → Deploy
//
//  路徑                     來源（政府公開資料）
//  /genary.json 等 6 檔      台電「今日電力資訊」（免金鑰）
//  /forecast.csv            台電「未來二個月電力供需預測」（免金鑰）
//  /aqi.json                環境部 空氣品質指標 AQI（需 MOENV_KEY）
//  /cems.json               環境部 固定污染源 CEMS 1 小時值，只保留電廠（需 MOENV_KEY）
//  /config.json             給網頁：LINE 加好友連結
//  POST /line               LINE Webhook（好友登記測站、查詢；回覆訊息免費）
//
//  設定（Worker → Settings → Variables and Secrets）：
//   MOENV_KEY        Secret  環境部資料開放平台 API 金鑰
//   LINE_TOKEN       Secret  LINE Channel access token
//   LINE_SECRET      Secret  LINE Channel secret（驗證 Webhook 真的來自 LINE）
//   LINE_BASIC_ID    Text    官方帳號 ID，例如 @123abcde（網頁顯示加好友按鈕）
//   LINE_TO          Text    （選用）管理者 userId，不用傳訊息就自動登記 HOME_SITE
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
    try {
      if (name === 'config.json') {
        const id = (env.LINE_BASIC_ID || '').trim();
        return new Response(JSON.stringify({ lineFriendUrl: id ? `https://line.me/R/ti/p/${encodeURIComponent(id.startsWith('@') ? id : '@' + id)}` : null, lineId: id || null }), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
      }
      if (!name) return text(`OK · 機房 ${req.cf?.colo || '?'} · 環境部金鑰${env.MOENV_KEY ? '已設定' : '未設定'}`);
      if (TP_FILES.has(name)) return await cached(ctx, name, 120, () => upstream(TP + name, name));
      if (name === 'forecast.csv') return await cached(ctx, name, 3600, () => upstream(FORECAST, name));
      if (name === 'aqi.json') return await cached(ctx, name, 600, () => aqi(env));
      if (name === 'cems.json') return await cached(ctx, name, 900, () => cems(env));
      return new Response('not found', { status: 404, headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
    }
  },

  // ── 排程：每 10 分鐘檢查一次。每件事每天最多通知一次；超過每月上限就不再主動推播 ──
  async scheduled(event, env, ctx) {
    if (!env.LINE_TOKEN || !env.NOTIFY) return;
    const today = twDate();
    const users = await listUsers(env);
    if (!users.length) return;

    // 1) 供電（全台同一件事）
    const sup = await supplyNow();
    if (sup && sup.alert && !(await env.NOTIFY.get(`${today}:supply`))) {
      const to = users.filter((u) => u.supply !== false).map((u) => u.id);
      if (await send(env, to, `⚡ 台灣光脈搏：今日供電${sup.label}，尖峰預估備轉 ${sup.rate}%（${sup.hours}）。建議尖峰時段減少用電。`)) {
        await env.NOTIFY.put(`${today}:supply`, '1', { expirationTtl: 2 * 86400 });
      }
    }

    // 2) 空品（各自登記的測站）
    if (!env.MOENV_KEY) return;
    const stations = await stationsNow(env);
    const bySite = new Map();
    for (const u of users) if (u.site && u.aqi !== false) (bySite.get(u.site) || bySite.set(u.site, []).get(u.site)).push(u.id);
    for (const [site, ids] of bySite) {
      const s = stations.find((x) => x.site === site);
      if (!s || !(s.aqi >= 101)) continue;
      const key = `${today}:aqi:${site}`;
      if (await env.NOTIFY.get(key)) continue;
      if (await send(env, ids, `😷 台灣光脈搏：${site}測站 AQI ${s.aqi}（${s.status}），PM2.5 ${s.pm25 ?? '—'}。敏感族群請減少戶外活動。`)) {
        await env.NOTIFY.put(key, '1', { expirationTtl: 2 * 86400 });
      }
    }
  }
};

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
・傳「測站名稱」登記你家附近的空品測站，例如：西屯、二林、忠明
・傳「現在」：即時供電與你測站的空氣品質
・傳「只要供電」：只收供電吃緊通知
・傳「全部通知」：供電＋空品都收
・傳「停止」：不再收任何通知
空品 AQI ≥ 101 或供電非綠燈時才會通知，同一件事每天最多一次。`;

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
  // 台電開放資料 CSV 可能是 Big5；若解不出中文就用 big5 再解一次
  const buf = await up.arrayBuffer();
  let body = new TextDecoder('utf-8').decode(buf);
  if (body.includes('�')) {
    try { body = new TextDecoder('big5').decode(buf); } catch { /* 保持 utf-8 */ }
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
async function aqi(env) {
  const rows = await moenv(env, 'aqx_p_432');
  const n = (v) => (v === '' || v == null || v === '-' ? null : Number(v));
  const stations = rows.map((r) => ({
    site: r.sitename, county: r.county, aqi: n(r.aqi), status: r.status, pollutant: r.pollutant,
    pm25: n(r['pm2.5']), pm10: n(r.pm10), o3: n(r.o3),
    windSpeed: n(r.wind_speed), windDir: n(r.wind_direc),
    lng: n(r.longitude), lat: n(r.latitude), time: r.publishtime
  })).filter((s) => s.lng && s.lat);
  return new Response(JSON.stringify({ stations }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
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
