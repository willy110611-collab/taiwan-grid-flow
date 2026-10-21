import { useEffect, useRef, useState } from 'react';
import { parseGenary } from './parseGenary.js';
import { mockGenary } from './mockGenary.js';

/**
 * 依序嘗試的資料來源。
 *  - 開發時 /taipower/* 由 vite.config.js 代理到台電網站（解決 CORS）
 *  - 可用環境變數 VITE_GENARY_URL 指定自架代理（例如 Cloudflare Worker）
 */
const SOURCES = [
  import.meta.env.VITE_GENARY_URL,
  // GitHub Pages 版：由 GitHub Actions 每 10 分鐘抓台電資料放在同網域（沒有 CORS 問題）
  './data/genary.json',
  // 本機版：由 Vite 代理轉發到台電
  '/taipower/d006/loadGraph/loadGraph/data/genary.json',
  '/taipower/d006/loadGraph/loadGraph/data/genary.txt'
].filter(Boolean);

const LIVE_REFRESH_MS = 10 * 60 * 1000; // 台電每 10 分鐘更新
const SIM_REFRESH_MS = 60 * 1000;       // 模擬模式每分鐘推進一次，讓畫面有生命

async function fetchWithTimeout(url, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
      signal: ctrl.signal,
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadGridSnapshot({ forceSim = false } = {}) {
  if (!forceSim) {
    for (const url of SOURCES) {
      try {
        const snapshot = parseGenary(await fetchWithTimeout(url));
        return { ...snapshot, source: 'live', sourceUrl: url };
      } catch (err) {
        console.info(`[grid] ${url} 無法使用：${err.message}`);
      }
    }
  }
  return { ...parseGenary(mockGenary()), source: 'simulated' };
}

/**
 * React hook：回傳最新的電網快照，並自動輪詢。
 * URL 帶 ?sim=1 可強制使用模擬資料（展示 / 離線開發用）。
 */
export function useGridData() {
  const [snapshot, setSnapshot] = useState(null);
  const timer = useRef();

  useEffect(() => {
    const forceSim = new URLSearchParams(location.search).has('sim');
    let alive = true;
    const tick = async () => {
      const snap = await loadGridSnapshot({ forceSim });
      if (!alive) return;
      setSnapshot(snap);
      timer.current = setTimeout(tick, snap.source === 'live' ? LIVE_REFRESH_MS : SIM_REFRESH_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, []);

  return snapshot;
}
