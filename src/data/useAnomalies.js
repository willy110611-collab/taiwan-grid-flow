import { useEffect, useRef, useState } from 'react';
import { PLANTS } from '../config/geo.js';
import { twDateKey } from './history.js';
import { dataTime } from './badges.js';

/**
 * 機組異常偵測（仿軌島營運異常橫幅）
 * ─────────────────────────────────────────────────────────────
 * 比較前後兩次台電快照（間隔約 10 分鐘），同一部機組：
 *   出力減少 ≥ 300 MW，且剩不到原本的一半 → 視為「出力驟降」
 * 只看火力與核能：太陽能、風力隨天氣變化，抽蓄水力本來就會大幅升降，不列入。
 * 這是「偵測」不是官方通報：也可能是計畫性降載或停機。
 */
const WATCH = new Set(['coal', 'gas', 'nuclear', 'oil', 'cogen']);
const DROP_MW = 300;
const BANNER_MS = 15 * 60 * 1000;
const GAP_MS = 25 * 60 * 1000; // 台電約 10 分鐘更新一次，容許漏掉一兩次

export function useAnomalies(snapshot) {
  const prev = useRef(null);
  const [list, setList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`tgf-anomaly-${twDateKey()}`) || '[]'); } catch { return []; }
  });
  const [active, setActive] = useState(null);
  const day = useRef(twDateKey());

  useEffect(() => {
    if (!snapshot) return;
    // 開著跨過午夜：今日清單從空的開始
    if (day.current !== twDateKey()) { day.current = twDateKey(); setList([]); }
    const demo = new URLSearchParams(location.search).get('demo') === 'anomaly';
    if ((snapshot.source !== 'live' || snapshot.cached) && !demo) return;
    if (prev.current?.timestamp === snapshot.timestamp && !demo) return;

    let before = prev.current;
    prev.current = snapshot;
    // 前後兩筆相隔太久（例如分頁在背景幾小時後回來）就不比較，避免把正常的日夜變化當成驟降
    if (before && !demo && !(Math.abs(dataTime(snapshot) - dataTime(before)) <= GAP_MS)) before = null;
    let found = [];
    if (demo && !before) {
      found = [{ unit: '興達#2', fuel: 'coal', from: 520, to: 40 }];
    } else if (before) {
      const old = new Map(before.units.map((u) => [`${u.fuel}|${u.unit}`, u]));
      for (const u of snapshot.units) {
        if (!WATCH.has(u.fuel)) continue;
        const o = old.get(`${u.fuel}|${u.unit}`);
        if (o && o.mw > 0 && o.mw - u.mw >= DROP_MW && u.mw < o.mw * 0.5) found.push({ unit: u.unit, fuel: u.fuel, from: o.mw, to: u.mw });
      }
    }
    if (!found.length) return;

    const items = found.map((f) => {
      const plant = PLANTS.find((p) => p.match?.test(f.unit));
      return { ...f, demo, plant: plant?.name || null, plantId: plant?.id || null, time: snapshot.timestamp?.slice(-5) || '', at: Date.now() };
    });
    setList((l) => {
      const next = [...l, ...items].slice(-30);
      if (!demo) try { localStorage.setItem(`tgf-anomaly-${twDateKey()}`, JSON.stringify(next)); } catch { /* 略 */ }
      return next;
    });
    setActive(items[0]);
  }, [snapshot]);

  // 橫幅 15 分鐘後自動收起
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setActive(null), Math.max(0, active.at + BANNER_MS - Date.now()));
    return () => clearTimeout(id);
  }, [active]);

  return { list, active, dismiss: () => setActive(null) };
}
