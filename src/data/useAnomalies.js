import { useEffect, useRef, useState } from 'react';
import { PLANTS } from '../config/geo.js';
import { twDateKey } from './history.js';

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

export function useAnomalies(snapshot) {
  const prev = useRef(null);
  const [list, setList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`tgf-anomaly-${twDateKey()}`) || '[]'); } catch { return []; }
  });
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!snapshot) return;
    const demo = new URLSearchParams(location.search).get('demo') === 'anomaly';
    if (snapshot.source !== 'live' && !demo) return;
    if (prev.current?.timestamp === snapshot.timestamp && !demo) return;

    const before = prev.current;
    prev.current = snapshot;
    let found = [];
    if (demo && !before) {
      found = [{ unit: '興達#2', fuel: 'coal', from: 520, to: 40 }];
    } else if (before) {
      const old = new Map(before.units.map((u) => [`${u.fuel}|${u.unit}`, u]));
      for (const u of snapshot.units) {
        if (!WATCH.has(u.fuel)) continue;
        const o = old.get(`${u.fuel}|${u.unit}`);
        if (o && o.mw - u.mw >= DROP_MW && u.mw < o.mw * 0.5) found.push({ unit: u.unit, fuel: u.fuel, from: o.mw, to: u.mw });
      }
    }
    if (!found.length) return;

    const items = found.map((f) => {
      const plant = PLANTS.find((p) => p.match?.test(f.unit));
      return { ...f, plant: plant?.name || null, plantId: plant?.id || null, time: snapshot.timestamp?.slice(-5) || '', at: Date.now() };
    });
    setList((l) => {
      const next = [...l, ...items].slice(-30);
      try { localStorage.setItem(`tgf-anomaly-${twDateKey()}`, JSON.stringify(next)); } catch { /* 略 */ }
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
