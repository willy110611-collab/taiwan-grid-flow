import { useEffect, useState } from 'react';
import { FUELS } from '../config/energy.js';
import { parseGenary, islandEstimate } from './parseGenary.js';
import { mockGenary } from './mockGenary.js';
import { buildSnapshot } from './useGridData.js';
import { computeRegions } from './regions.js';
import { PLANTS } from '../config/geo.js';

/**
 * 今日歷史（給「今日亮點」與「今日回放」共用）
 * ─────────────────────────────────────────────────────────────
 * 即時模式：每次取得新快照就存一份精簡版到 localStorage（以台灣日期分檔，保留 3 天）
 * 模擬模式：直接把今天 00:00 到現在每 10 分鐘算一遍
 */
export const twDateKey = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
export const twHM = (t) => new Date(t + 8 * 3600e3).toISOString().slice(11, 16);
const r1 = (v) => Math.round(v * 10) / 10;

export function greenPct(totals) {
  const all = Object.entries(totals).reduce((a, [, v]) => a + v, 0) || 1;
  return (Object.entries(totals).filter(([f]) => FUELS[f]?.green).reduce((a, [, v]) => a + v, 0) / all) * 100;
}

/** 精簡快照：只留回放與統計需要的欄位（每筆約 2KB） */
export function compact(s) {
  return {
    t: s.t,
    timestamp: s.timestamp,
    source: s.source,
    total: r1(s.total),
    totals: Object.fromEntries(Object.entries(s.totals).map(([k, v]) => [k, r1(v)])),
    plants: s.plants.map((p) => ({
      id: p.id, mw: r1(p.mw), liveMw: r1(p.liveMw || 0), ...(p.estimated ? { estimated: true } : {}),
      mix: Object.fromEntries(Object.entries(p.mix).map(([k, v]) => [k, r1(v)]))
    })),
    regions: s.regions,
    supply: s.supply,
    reconstructed: !!s.reconstructed
  };
}

function readDay(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function writeDay(key, rows) {
  try {
    localStorage.setItem(key, JSON.stringify(rows.slice(-160)));
    const old = `tgf-day-${twDateKey(new Date(Date.now() - 3 * 864e5))}`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('tgf-day-') && k < old) localStorage.removeItem(k);
    }
  } catch { /* 空間不足或無痕模式：只在記憶體保留 */ }
}

function simulatedDay(now = Date.now()) {
  const tw = new Date(now + 8 * 3600e3);
  const midnight = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600e3;
  const out = [];
  for (let t = midnight; t <= now; t += 10 * 60000) {
    const d = new Date(t);
    out.push(compact(buildSnapshot(parseGenary(mockGenary(d)), { source: 'simulated', date: d })));
  }
  return out;
}

/**
 * 即時模式：用台電「今日燃料別曲線」+「今日區域用電曲線」重建整天（每 10 分鐘一筆）。
 * 曲線只有「各燃料全台總量」，所以各電廠的出力是依「目前各電廠在該燃料中的比例」分配（推估）。
 */
function reconstructDay(snap, fuel = snap.curves?.fuel, areaRows = snap.curves?.areas, dayOffset = 0) {
  if (!fuel?.length) return null;
  const areaByHm = new Map((areaRows || []).map((r) => [r.hm, r.load]));
  const tw = new Date(snap.t + (8 - 24 * dayOffset) * 3600e3);
  const ymd = tw.toISOString().slice(0, 10);
  const midnight = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600e3;

  // 每種燃料：各電廠的分配權重與「對得到電廠的比例」
  const weights = {};
  const fuels = new Set([...Object.keys(snap.totals), ...fuel.flatMap((r) => Object.keys(r.totals))]);
  for (const f of fuels) {
    let w = snap.plants.map((p) => (p.estimated ? 0 : p.mix[f] || 0)); // 推估的離島不參與分配，下面另外推估
    let sum = w.reduce((a, b) => a + b, 0);
    let coverage = snap.totals[f] > 0 ? Math.min(1, sum / snap.totals[f]) : 1;
    if (!sum) {
      w = PLANTS.map((p) => p.share?.[f] || 0);
      sum = w.reduce((a, b) => a + b, 0);
      coverage = 1;
    }
    // 儲能：曲線只有「抽蓄＋電池」總量；用裝置容量拆出抽蓄的份額（畫在明潭），不用快照當下比例
    // （快照若剛好電池 0，會把整天的電池都算進明潭；剛好抽蓄 0 則整天都畫不出來）
    if (f === 'storage') {
      const su = (snap.units || []).filter((u) => u.fuel === 'storage' && !u.load && u.capacity > 0);
      const all = su.reduce((a, u) => a + u.capacity, 0);
      const pump = su.filter((u) => u.plantId === 'mingtan').reduce((a, u) => a + u.capacity, 0);
      const i = snap.plants.findIndex((p) => p.id === 'mingtan');
      if (all > 0 && pump > 0 && i >= 0) { w = snap.plants.map((_, j) => (j === i ? 1 : 0)); sum = 1; coverage = pump / all; }
    }
    if (sum) weights[f] = { w: w.map((x) => x / sum), coverage };
  }

  return fuel.map((row) => {
    const [h, m] = row.hm.split(':').map(Number);
    const t = midnight + (h * 60 + m) * 60000;
    const plants = snap.plants.map((p, i) => {
      // 台電未即時公布的離島：回放時也用同一套推估（依季節與時段），不從全台燃油曲線分配
      if (p.estimated) {
        const est = PLANTS.find((x) => x.id === p.id)?.est;
        if (est) { const mw = islandEstimate(est, new Date(t)); return { id: p.id, mw, liveMw: 0, mix: { oil: mw }, estimated: true }; }
      }
      const mix = {};
      for (const [f, mw] of Object.entries(row.totals)) {
        const wf = weights[f];
        if (wf && wf.w[i] > 0) mix[f] = mw * wf.coverage * wf.w[i];
      }
      const total = Object.values(mix).reduce((a, b) => a + b, 0);
      return { id: p.id, mw: total, liveMw: 0, mix };
    });
    const total = Object.entries(row.totals).reduce((a, [, v]) => a + v, 0);
    const load = areaByHm.get(row.hm);
    return compact({
      t, timestamp: `${ymd} ${row.hm}`, source: 'live', total, totals: row.totals, plants,
      regions: computeRegions(plants, total, load ? { load } : null, new Date(t)),
      supply: null, reconstructed: true
    });
  });
}

/** 昨天整天（台電「昨日燃料別曲線」；模擬模式用模擬曲線），給「回放 → 昨天」 */
export function useYesterday(snapshot) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!snapshot?.curves?.yesterday?.length) return;
    const r = reconstructDay(snapshot, snapshot.curves.yesterday, null, 1);
    if (r) setRows(r.map((x) => ({ ...x, source: snapshot.source, yesterday: true })));
  }, [snapshot?.curves?.yesterday]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

export function useDayHistory(snapshot) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.source !== 'live') {
      setRows(simulatedDay());
      return;
    }
    const rebuilt = reconstructDay(snapshot);
    if (rebuilt) {
      // 最後一筆用真正的即時快照（含各電廠即時數值與供電狀況）
      const last = compact(snapshot);
      setRows([...rebuilt.filter((r) => r.timestamp < last.timestamp), last]);
      return;
    }
    const key = `tgf-day-${twDateKey()}`;
    const list = readDay(key);
    const row = compact(snapshot);
    if (!list.length || list[list.length - 1].timestamp !== row.timestamp) list.push(row);
    writeDay(key, list);
    setRows([...list]);
  }, [snapshot]);
  return rows;
}

/**
 * 個人紀錄（這台裝置看過的最高值，存在 localStorage）
 *  只記即時資料；模擬資料不算
 */
const REC_KEY = 'tgf-records';
export function useRecords(snapshot) {
  const [rec, setRec] = useState(() => { try { return JSON.parse(localStorage.getItem(REC_KEY) || '{}'); } catch { return {}; } });
  useEffect(() => {
    if (!snapshot || snapshot.source !== 'live' || snapshot.cached) return;
    const vals = {
      green: greenPct(snapshot.totals),
      solar: snapshot.totals.solar || 0,
      wind: snapshot.totals.wind || 0,
      load: (!snapshot.supply?.old && snapshot.supply?.load) || snapshot.total || 0
    };
    setRec((old) => {
      let changed = false;
      const next = { ...old };
      for (const [k, v] of Object.entries(vals)) {
        if (v > 0 && (!old[k] || v > old[k].v)) { next[k] = { v: r1(v), t: snapshot.t }; changed = true; }
      }
      if (!next.since) { next.since = snapshot.t; changed = true; }
      if (!changed) return old;
      try { localStorage.setItem(REC_KEY, JSON.stringify(next)); } catch { /* 略 */ }
      return next;
    });
  }, [snapshot]);
  return rec;
}
