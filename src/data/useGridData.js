import { useEffect, useRef, useState } from 'react';
import { parseGenary } from './parseGenary.js';
import { mockGenary, mockLoadPara, mockFuelCurveYesterday, mockForecast } from './mockGenary.js';
import { parseGenLoadAreas, parseLoadAreasCurve, parseFuelCurve, parseLoadPara, parseForecast, supplyLevel } from './parseAux.js';
import { computeRegions } from './regions.js';
import { unitFactors } from './carbon.js';
import { APP } from '../config/app.js';
import { putExtra } from './extras.js';

/**
 * 資料來源：台電「今日電力資訊」公開資料（政府公開、免申請、每 10 分鐘更新）
 * ─────────────────────────────────────────────────────────────
 *  依序嘗試：
 *  1. Cloudflare Worker 中繼站（任何裝置、任何網路都能用）
 *  2. 同網域 ./data/（GitHub Actions 每 10 分鐘備份一份）
 *  3. 本機 /taipower/* 代理（啟動.bat、桌布伺服器）
 */
const TP = '/taipower/d006/loadGraph/loadGraph/data';

/**
 * G4 資料合理性檢查：每份資料都要「確定來自台電、數值合理、時間夠新」才採用
 *  不合理 → 視為這個來源失敗、改試下一個來源；全部失敗 → 繼續顯示上一份真實資料並標示時間（不改成模擬）
 */
const twNow = () => Date.now();
const ageMin = (ts) => {
  const t = new Date(String(ts || '').replace(/\//g, '-').replace(' ', 'T') + '+08:00').getTime();
  return Number.isFinite(t) ? (twNow() - t) / 60e3 : null;
};
function checkedGenary(text) {
  const g = parseGenary(text);
  if (!g) throw new Error('格式不符');
  const total = Object.entries(g.totals || {}).reduce((a, [, v]) => a + v, 0);
  if (!(g.units?.length >= 40)) throw new Error(`資料不合理：只有 ${g.units?.length || 0} 部機組`);
  if (total < 8000 || total > 60000) throw new Error(`資料不合理：全台發電 ${Math.round(total)} MW`);
  const age = ageMin(g.timestamp);
  if (age == null) throw new Error('資料不合理：沒有資料時間');
  if (age > 180) throw new Error(`資料過舊：${g.timestamp}`);
  if (age < -30) throw new Error(`資料時間不合理：${g.timestamp}`);
  return g;
}
function checkedForecast(text) {
  const rows = parseForecast(text);
  if (rows && rows.some((d) => !(d.rate >= 0 && d.rate <= 60))) throw new Error('資料不合理：備轉容量率超出範圍');
  return rows;
}
const R = APP.relayUrl;
const FILES = {
  genary:    { name: '各機組發電量', urls: [`${R}/genary.json`, './data/genary.json', `${TP}/genary.json`, `${TP}/genary.txt`], parse: checkedGenary },
  areas:     { name: '各區發電/用電', urls: [`${R}/genloadareaperc.csv`, './data/genloadareaperc.csv', `${TP}/genloadareaperc.csv`], parse: parseGenLoadAreas },
  para:      { name: '供電狀況', urls: [`${R}/loadpara.json`, './data/loadpara.json', `${TP}/loadpara.json`], parse: parseLoadPara },
  fuelCurve: { name: '今日燃料別曲線', urls: [`${R}/loadfueltype.csv`, './data/loadfueltype.csv', `${TP}/loadfueltype.csv`], parse: parseFuelCurve, ms: 9000 },
  areaCurve: { name: '今日區域用電曲線', urls: [`${R}/loadareas.csv`, './data/loadareas.csv', `${TP}/loadareas.csv`], parse: parseLoadAreasCurve, ms: 9000 },
  yFuel:     { name: '昨日燃料別曲線', urls: [`${R}/loadfueltype_1.csv`, './data/loadfueltype_1.csv', `${TP}/loadfueltype_1.csv`], parse: parseYesterday, ms: 9000 },
  forecast:  { name: '未來供電預測', urls: [`${R}/forecast.csv`, './data/forecast.csv'], parse: checkedForecast, ms: 9000 }
};
/** 昨日曲線：要是「完整的一天」才用（台電換日前後偶爾只有半天或空檔）→ 不完整就當作讀取失敗、改試下一個來源 */
function parseYesterday(text) {
  const rows = parseFuelCurve(text);
  if (!rows || rows.length < 120) throw new Error(rows ? `只有 ${rows.length} 筆（不完整）` : '格式不符');
  return rows;
}
if (import.meta.env.VITE_GENARY_URL) FILES.genary.urls.unshift(import.meta.env.VITE_GENARY_URL);

const LIVE_REFRESH_MS = 10 * 60 * 1000; // 台電每 10 分鐘更新
const SIM_REFRESH_MS = 60 * 1000;
const BUSY_ONLINE = 400; // 同時在線超過這個數字：改每 20 分鐘更新一次（不擋人，只省中繼站免費額度）       // 模擬模式每分鐘推進一次，讓畫面有生命

async function fetchText(url, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('收到網頁而不是資料（此網址不存在）');
    return text;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '逾時' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

/** 依序嘗試多個網址；回傳 { data, diag }，diag 記錄每個網址的結果（給「資訊 → 連線診斷」） */
async function fetchFile(key) {
  const f = FILES[key];
  const tries = [];
  for (const url of f.urls) {
    try {
      const data = f.parse(await fetchText(url, f.ms));
      if (data) {
        tries.push({ url, ok: true });
        // 曲線類資料：顯示筆數與時間範圍，方便確認是否完整
        const detail = Array.isArray(data) && data[0]?.hm ? `${data.length} 筆 ${data[0].hm}–${data[data.length - 1].hm}` : Array.isArray(data) ? `${data.length} 筆` : '';
        // 資料時間（給「連線診斷」顯示幾分鐘前）：機組表有 timestamp；今日曲線取最後一筆
        const asOf = data.timestamp || (key === 'fuelCurve' || key === 'areaCurve' ? data[data.length - 1]?.hm : null) || data.time || null;
        return { data, diag: { name: f.name, ok: true, url, tries, detail, asOf } };
      }
      tries.push({ url, ok: false, msg: '格式不符' });
    } catch (err) {
      tries.push({ url, ok: false, msg: err.message });
    }
  }
  return { data: null, diag: { name: f.name, ok: false, tries } };
}

/* ───────── 中繼站 /bundle.json：一次給齊＋同時在線人數 ───────── */
const SID = (() => { // 每個分頁一組隨機代碼（只用來算在線人數，不含個資）
  try { let v = sessionStorage.getItem('tgf-sid'); if (!v) { v = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('tgf-sid', v); } return v; } catch { return Math.random().toString(36).slice(2, 12); }
})();
async function fetchBundle() {
  let pre = null;
  try { pre = JSON.parse(await fetchText(`${R}/bundle.json?sid=${SID}&x=air`, 9000)); } catch { /* 改走個別網址 */ }
  putExtra(pre?.extra); // 空品、煙道、日照（中繼站 v8.3）
  return pre;
}
function fromBundle(pre, key) {
  const text = pre?.files?.[key];
  if (!text || pre.errors?.[key] && pre.errors[key] !== 'stale') return null;
  try {
    const data = FILES[key].parse(text);
    if (!data) return null;
    const url = `${R}/bundle.json`;
    const asOf = data.timestamp || (key === 'fuelCurve' || key === 'areaCurve' ? data[data.length - 1]?.hm : null) || data.time || null;
    const detail = Array.isArray(data) && data[0]?.hm ? `${data.length} 筆 ${data[0].hm}–${data[data.length - 1].hm}` : Array.isArray(data) ? `${data.length} 筆` : '';
    return Promise.resolve({ data, diag: { name: FILES[key].name, ok: true, url, tries: [{ url, ok: true }], detail, asOf } });
  } catch { return null; } // 不合理（例如機組數太少）→ 改走個別網址
}
const withOnline = (pre, snap) => (Number.isFinite(pre?.online) ? { ...snap, online: pre.online } : snap);

const totalOf = (totals) => Object.entries(totals).reduce((a, [, v]) => a + v, 0);

/** 由 genary 結果 + 輔助資料組成完整快照 */
export function buildSnapshot(base, { source, areas = null, para = null, curves = null, forecast = null, diag = [], date = new Date() }) {
  const total = totalOf(base.totals);
  const regions = computeRegions(base.plants, total, areas, date);
  let supply = para ? { ...para, evidence: 'live' } : null;
  if (!supply && source !== 'live') {
    const m = mockLoadPara(total);
    supply = { ...m, ...supplyLevel(m.rate, m.cap), evidence: 'simulated' };
  }
  if (source !== 'live') {
    curves = curves || { yesterday: mockFuelCurveYesterday() };
    forecast = forecast || mockForecast().map((d) => ({ ...d, ...supplyLevel(d.rate, d.resv / 10) }));
  }
  const carbonFx = source === 'live' ? unitFactors(base.units) : null;
  return { ...base, source, total, regions, supply, curves, forecast, carbonFx, diag, t: date.getTime() };
}

export async function loadGridSnapshot({ forceSim = false, onFirst } = {}) {
  if (!forceSim) {
    // v0.8.1：先向中繼站一次拿齊 7 份（每人每 10 分鐘只打 1 次，人多也不會用完免費額度），哪份不行再個別補抓
    const pre = await fetchBundle();
    const jobs = Object.keys(FILES).map((k) => fromBundle(pre, k) || fetchFile(k));
    // 先用最關鍵的三個小檔畫出畫面，曲線、預報等稍後補上（不讓最慢的檔案拖住整個畫面）
    if (onFirst) {
      Promise.all(jobs.slice(0, 3)).then(([g, a, p]) => {
        if (g.data) onFirst(buildSnapshot(g.data, { source: 'live', areas: a.data, para: p.data, diag: [] }));
      }).catch(() => {});
    }
    const results = await Promise.all(jobs);
    const [genary, areas, para, fuelCurve, areaCurve, yFuel, forecast] = results;
    const diag = results.map((r) => r.diag);
    if (genary.data) {
      return withOnline(pre, buildSnapshot(genary.data, {
        source: 'live',
        areas: areas.data,
        para: para.data,
        curves: { fuel: fuelCurve.data, areas: areaCurve.data, yesterday: yFuel.data },
        forecast: forecast.data,
        diag
      }));
    }
    return { ...buildSnapshot(parseGenary(mockGenary()), { source: 'simulated' }), diag };
  }
  return buildSnapshot(parseGenary(mockGenary()), { source: 'simulated', diag: [{ name: '示範模式（模擬資料）', ok: false, tries: [] }] });
}

/**
 * React hook：回傳最新的電網快照，並自動輪詢。
 * URL 帶 ?sim=1 可強制使用模擬資料（展示 / 離線開發用）。
 */
/* 上次的快照存在這台裝置：下次打開立刻有畫面與粒子，不用等網路 */
const CACHE_KEY = 'tgf-last-snapshot';
const CACHE_MAX_AGE = 6 * 3600e3;
function loadCached() {
  if (new URLSearchParams(location.search).has('sim')) return null;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && Date.now() - c.t < CACHE_MAX_AGE ? { ...c, cached: true } : null;
  } catch { return null; }
}
function saveCached(snap) {
  if (snap.source !== 'live') return;
  try {
    const { diag, ...rest } = snap; // eslint-disable-line no-unused-vars
    localStorage.setItem(CACHE_KEY, JSON.stringify(rest));
    const all = Object.entries(snap.totals).reduce((a, [, v]) => a + v, 0) || 1;
    const green = ['solar', 'wind', 'hydro', 'otherRe'].reduce((a, f) => a + (snap.totals[f] || 0), 0);
    const hm = new Date(snap.t + 8 * 3600e3).toISOString().slice(11, 16);
    localStorage.setItem('tgf-last-brief', JSON.stringify({ t: snap.t, hm, green: ((green / all) * 100).toFixed(1), total: Math.round(all).toLocaleString() }));
  } catch { /* 空間不足就算了 */ }
}

export function useGridData() {
  const [snapshot, setSnapshot] = useState(loadCached);
  const timer = useRef();
  const lastLive = useRef(null);
  if (!lastLive.current && snapshot?.source === 'live') lastLive.current = snapshot;

  useEffect(() => {
    const forceSim = new URLSearchParams(location.search).has('sim');
    let alive = true;
    let gotFirst = false;
    const tick = async () => {
      // 省電：App 在背景時不抓資料，切回前景立刻補抓
      if (document.hidden && gotFirst) {
        const back = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', back); tick(); } };
        document.addEventListener('visibilitychange', back);
        return;
      }
      const snap = await loadGridSnapshot({
        forceSim,
        onFirst: (s) => { if (alive && !gotFirst) { gotFirst = true; setSnapshot((cur) => (cur && !cur.cached ? cur : s)); } }
      });
      if (!alive) return;
      gotFirst = true;
      if (snap.source === 'live') {
        lastLive.current = snap;
        setSnapshot(snap);
        saveCached(snap);
      } else if (!forceSim && lastLive.current && Date.now() - lastLive.current.t < CACHE_MAX_AGE) {
        // 台電資料讀不到或不合理：不要亂顯示模擬值，繼續顯示上一份真實資料，並標示「讀不到最新」
        setSnapshot({ ...lastLive.current, cached: true, stale: true, diag: snap.diag });
      } else {
        setSnapshot(snap);
      }
      // 即時模式：對齊台電的 10 分鐘更新（整 10 分後 1 分鐘再抓）
      // 再加 0–2 分鐘隨機延遲：大家不要同一秒湧進中繼站
      const wait = snap.source === 'live' || lastLive.current
        ? Math.min(LIVE_REFRESH_MS, 10 * 60000 - (Date.now() % (10 * 60000)) + 60000 + Math.random() * 120000) + (snap.online > BUSY_ONLINE ? 10 * 60000 : 0)
        : SIM_REFRESH_MS;
      timer.current = setTimeout(tick, wait);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, []);

  return snapshot;
}
