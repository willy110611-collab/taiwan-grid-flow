import { useEffect, useMemo, useState } from 'react';
import { FUELS } from '../config/energy.js';
import { PLANTS } from '../config/geo.js';
import { parseGenary } from './parseGenary.js';
import { mockGenary } from './mockGenary.js';

/**
 * 今日亮點（仿軌島「亮點」面板）
 * ─────────────────────────────────────────────────────────────
 * 即時模式：每次取得新快照就記一筆到 localStorage（以台灣日期分檔），
 *           因此「今日最高」是從今天第一次打開頁面起算。
 * 模擬模式：直接用模擬曲線把今天 00:00 到現在每 10 分鐘算一遍，立刻有完整的一天。
 */
const twDateKey = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const twHM = (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(11, 16);

function summarize(snap, t) {
  const tot = snap.totals;
  const all = Object.entries(tot).filter(([f]) => f !== 'storage').reduce((a, [, v]) => a + v, 0) || 1;
  const green = Object.entries(tot).filter(([f]) => FUELS[f]?.green).reduce((a, [, v]) => a + v, 0);
  return { t, hm: twHM(new Date(t)), load: all, solar: tot.solar || 0, wind: tot.wind || 0, greenPct: (green / all) * 100 };
}

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function writeStore(key, rows) {
  try {
    localStorage.setItem(key, JSON.stringify(rows.slice(-200)));
    // 清掉三天前的紀錄
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('tgf-day-') && k < `tgf-day-${twDateKey(new Date(Date.now() - 3 * 864e5))}`) localStorage.removeItem(k);
    }
  } catch { /* 無痕模式等情況：只在記憶體保留 */ }
}

export function useHighlights(snapshot, stats) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!snapshot) return;
    const now = Date.now();
    if (snapshot.source !== 'live') {
      const tw = new Date(now + 8 * 3600e3);
      const midnight = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600e3;
      const out = [];
      for (let t = midnight; t <= now; t += 10 * 60000) out.push(summarize(parseGenary(mockGenary(new Date(t))), t));
      setRows(out);
      return;
    }
    const key = `tgf-day-${twDateKey()}`;
    const list = readStore(key);
    const row = summarize(snapshot, now);
    if (!list.length || list[list.length - 1].hm !== row.hm) list.push(row);
    writeStore(key, list);
    setRows([...list]);
  }, [snapshot]);

  return useMemo(() => {
    if (!snapshot || !rows.length) return null;
    const max = (k) => rows.reduce((a, r) => (r[k] > a[k] ? r : a), rows[0]);
    const topNow = [...snapshot.plants].sort((a, b) => b.mw - a.mw)[0];
    const solarPeak = max('solar');
    return {
      since: rows[0].hm,
      partial: snapshot.source === 'live' && rows[0].hm > '01:00',
      topPlant: topNow && { name: PLANTS.find((p) => p.id === topNow.id)?.name, mw: topNow.mw },
      solarPeak: solarPeak.solar > 50 ? solarPeak : null,
      greenPeak: max('greenPct'),
      loadPeak: max('load'),
      southToNorth: stats?.southToNorthMw ?? null,
      spark: rows.map((r) => r.greenPct)
    };
  }, [rows, snapshot, stats]);
}
