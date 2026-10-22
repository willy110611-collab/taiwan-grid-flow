import { useEffect, useRef, useState } from 'react';
import { parseGenary } from './parseGenary.js';
import { mockGenary, mockLoadPara, mockFuelCurveYesterday, mockForecast } from './mockGenary.js';
import { parseGenLoadAreas, parseLoadAreasCurve, parseFuelCurve, parseLoadPara, parseForecast, supplyLevel } from './parseAux.js';
import { computeRegions } from './regions.js';
import { APP } from '../config/app.js';

/**
 * 資料來源：台電「今日電力資訊」公開資料（政府公開、免申請、每 10 分鐘更新）
 * ─────────────────────────────────────────────────────────────
 *  依序嘗試：
 *  1. Cloudflare Worker 中繼站（任何裝置、任何網路都能用）
 *  2. 同網域 ./data/（GitHub Actions 每 10 分鐘備份一份）
 *  3. 本機 /taipower/* 代理（啟動.bat、桌布伺服器）
 */
const TP = '/taipower/d006/loadGraph/loadGraph/data';
const R = APP.relayUrl;
const FILES = {
  genary:    { name: '各機組發電量', urls: [`${R}/genary.json`, './data/genary.json', `${TP}/genary.json`, `${TP}/genary.txt`], parse: parseGenary },
  areas:     { name: '各區發電/用電', urls: [`${R}/genloadareaperc.csv`, './data/genloadareaperc.csv', `${TP}/genloadareaperc.csv`], parse: parseGenLoadAreas },
  para:      { name: '供電狀況', urls: [`${R}/loadpara.json`, './data/loadpara.json', `${TP}/loadpara.json`], parse: parseLoadPara },
  fuelCurve: { name: '今日燃料別曲線', urls: [`${R}/loadfueltype.csv`, './data/loadfueltype.csv', `${TP}/loadfueltype.csv`], parse: parseFuelCurve },
  areaCurve: { name: '今日區域用電曲線', urls: [`${R}/loadareas.csv`, './data/loadareas.csv', `${TP}/loadareas.csv`], parse: parseLoadAreasCurve },
  yFuel:     { name: '昨日燃料別曲線', urls: [`${R}/loadfueltype_1.csv`, `${TP}/loadfueltype_1.csv`], parse: parseFuelCurve },
  forecast:  { name: '未來供電預測', urls: [`${R}/forecast.csv`], parse: parseForecast }
};
if (import.meta.env.VITE_GENARY_URL) FILES.genary.urls.unshift(import.meta.env.VITE_GENARY_URL);

const LIVE_REFRESH_MS = 10 * 60 * 1000; // 台電每 10 分鐘更新
const SIM_REFRESH_MS = 60 * 1000;       // 模擬模式每分鐘推進一次，讓畫面有生命

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
      const data = f.parse(await fetchText(url));
      if (data) {
        tries.push({ url, ok: true });
        return { data, diag: { name: f.name, ok: true, url, tries } };
      }
      tries.push({ url, ok: false, msg: '格式不符' });
    } catch (err) {
      tries.push({ url, ok: false, msg: err.message });
    }
  }
  return { data: null, diag: { name: f.name, ok: false, tries } };
}

const totalOf = (totals) => Object.entries(totals).filter(([f]) => f !== 'storage').reduce((a, [, v]) => a + v, 0);

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
  return { ...base, source, total, regions, supply, curves, forecast, diag, t: date.getTime() };
}

export async function loadGridSnapshot({ forceSim = false, onFirst } = {}) {
  if (!forceSim) {
    const jobs = Object.keys(FILES).map(fetchFile);
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
      return buildSnapshot(genary.data, {
        source: 'live',
        areas: areas.data,
        para: para.data,
        curves: { fuel: fuelCurve.data, areas: areaCurve.data, yesterday: yFuel.data },
        forecast: forecast.data,
        diag
      });
    }
    return { ...buildSnapshot(parseGenary(mockGenary()), { source: 'simulated' }), diag };
  }
  return buildSnapshot(parseGenary(mockGenary()), { source: 'simulated', diag: [{ name: '強制模擬（網址帶 ?sim=1）', ok: false, tries: [] }] });
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
    const all = Object.entries(snap.totals).filter(([f]) => f !== 'storage').reduce((a, [, v]) => a + v, 0) || 1;
    const green = ['solar', 'wind', 'hydro', 'otherRe'].reduce((a, f) => a + (snap.totals[f] || 0), 0);
    const hm = new Date(snap.t + 8 * 3600e3).toISOString().slice(11, 16);
    localStorage.setItem('tgf-last-brief', JSON.stringify({ t: snap.t, hm, green: ((green / all) * 100).toFixed(1), total: Math.round(all).toLocaleString() }));
  } catch { /* 空間不足就算了 */ }
}

export function useGridData() {
  const [snapshot, setSnapshot] = useState(loadCached);
  const timer = useRef();

  useEffect(() => {
    const forceSim = new URLSearchParams(location.search).has('sim');
    let alive = true;
    let gotFirst = false;
    const tick = async () => {
      const snap = await loadGridSnapshot({
        forceSim,
        onFirst: (s) => { if (alive && !gotFirst) { gotFirst = true; setSnapshot((cur) => (cur && !cur.cached ? cur : s)); } }
      });
      if (!alive) return;
      gotFirst = true;
      setSnapshot(snap);
      saveCached(snap);
      // 即時模式：對齊台電的 10 分鐘更新（整 10 分後 1 分鐘再抓）
      const wait = snap.source === 'live'
        ? Math.min(LIVE_REFRESH_MS, 10 * 60000 - (Date.now() % (10 * 60000)) + 60000)
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
