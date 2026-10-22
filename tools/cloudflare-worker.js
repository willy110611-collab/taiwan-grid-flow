// ─────────────────────────────────────────────────────────────
//  台灣光脈搏 — Cloudflare Worker 中繼站 v2
//  貼到 Cloudflare：Workers & Pages → taiwan-grid-flow-data → Edit code → 全部取代 → Deploy
//
//  路徑                     來源（政府公開資料）
//  /genary.json 等 6 檔      台電「今日電力資訊」（免金鑰）
//  /forecast.csv            台電「未來二個月電力供需預測」（免金鑰）
//  /aqi.json                環境部 空氣品質指標 AQI（需 MOENV_KEY）
//  /cems.json               環境部 固定污染源 CEMS 1 小時值，只保留電廠（需 MOENV_KEY）
//
//  設定（Worker → Settings → Variables and Secrets）：
//   MOENV_KEY   Secret  環境部資料開放平台 API 金鑰（免費申請）
//   LINE_TOKEN  Secret  （選用）LINE Messaging API Channel access token
//   LINE_TO     Text    （選用）你的 LINE userId（U 開頭）
//   HOME_SITE   Text    （選用）住家附近的空品測站名稱，預設「二林」
//  LINE 提醒另需：KV 命名空間綁定 NOTIFY、Triggers → Cron「*/10 * * * *」
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
    try {
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

  // ── 排程：每 10 分鐘檢查一次，必要時用 LINE 提醒（每種事件每天最多一次）──
  async scheduled(event, env, ctx) {
    if (!env.LINE_TOKEN || !env.LINE_TO || !env.NOTIFY) return;
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const msgs = [];

    const para = await (await fetch(TP + 'loadpara.json', { headers: UA })).json().catch(() => null);
    const rec = para?.records?.find((r) => r.fore_peak_resv_rate) || {};
    const rate = parseFloat(rec.fore_peak_resv_rate);
    const ind = String(rec.fore_peak_resv_indicator || '').toUpperCase();
    if ((ind && ind !== 'G') || rate < 10) {
      msgs.push(['supply', `⚡ 台灣光脈搏：今日供電${ind === 'Y' ? '吃緊（黃燈）' : '警戒'}，尖峰預估備轉 ${rate}%（${rec.fore_peak_hour_range || ''}）。建議尖峰時段減少用電。`]);
    }

    if (env.MOENV_KEY) {
      const site = env.HOME_SITE || '二林';
      const list = JSON.parse(await (await aqi(env)).text());
      const s = list.stations?.find((x) => x.site === site);
      if (s && s.aqi >= 101) msgs.push(['aqi', `😷 台灣光脈搏：${site}測站 AQI ${s.aqi}（${s.status}），PM2.5 ${s.pm25}。敏感族群請減少戶外活動。`]);
    }

    for (const [kind, msg] of msgs) {
      const key = `${today}:${kind}`;
      if (await env.NOTIFY.get(key)) continue;
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.LINE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: 'text', text: msg }] })
      });
      await env.NOTIFY.put(key, '1', { expirationTtl: 2 * 86400 });
    }
  }
};

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
