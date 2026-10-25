import { useCallback, useEffect, useRef, useState } from 'react';
import { greenPct, twDateKey } from './history.js';
import { sunElevation } from '../engine/daylight.js';
import { PLANTS } from '../config/geo.js';
// 很多離岸風場、離島常常 0 MW（光球不亮、摸不到）→ 不要求全部，摸過 20 座就算完成
const DEX_GOAL = Math.min(20, PLANTS.length);
import { SHOTS } from '../engine/cruise.js';

/**
 * 徽章收集（仿軌島護照集章）
 * ─────────────────────────────────────────────────────────────
 * 「電網徽章」：只有在真實電網（台電即時資料）出現該狀態的當下打開才拿得到。
 *              模擬資料或回放中不會頒發，避免變成「刷」出來的。
 * 「探索徽章」：與資料無關的操作成就。
 * 進度存在 localStorage（每台裝置各自收集）。
 */
const twHour = (t = Date.now()) => ((new Date(t).getUTCHours() + 8) % 24) + new Date(t).getUTCMinutes() / 60;

export const BADGES = [
  {
    id: 'noon-sea', name: '午間光海', kind: 'grid', rarity: '常見', color: [255, 198, 92],
    desc: '太陽能佔全台發電 30% 以上時在線。', hint: '晴天中午打開看看',
    nameEn: 'Noon Light Sea', descEn: `Online when solar is 30%+ of Taiwan’s generation.`, hintEn: 'Open it at noon on a sunny day',
    glyph: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
    check: ({ snap }) => (snap.totals.solar || 0) / snap.total >= 0.3
  },
  {
    id: 'north-wind', name: '北風之夜', kind: 'grid', rarity: '少見', color: [86, 238, 255],
    desc: '入夜後風力發電超過 2,500 MW。', hint: '東北季風強勁的夜晚',
    nameEn: 'North Wind Night', descEn: `Wind tops 2,500 MW after dark.`, hintEn: 'A night of strong northeast monsoon',
    glyph: 'M3 9h11a3 3 0 1 0-3-3M3 15h14a3 3 0 1 1-3 3M3 12h7',
    check: ({ snap }) => (snap.totals.wind || 0) >= 2500 && sunElevation(new Date(snap.t)) < -6
  },
  {
    id: 'green-half', name: '綠能過半', kind: 'grid', rarity: '稀有', color: [110, 240, 190],
    desc: '綠能佔全台發電一半以上。', hint: '陽光與風同時很強的日子',
    nameEn: 'Green Majority', descEn: `Green energy is over half of Taiwan’s generation.`, hintEn: 'A day with strong sun and wind together',
    glyph: 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l8-8',
    check: ({ snap }) => greenPct(snap.totals) >= 50
  },
  {
    id: 'dawn-shift', name: '黎明交班', kind: 'grid', rarity: '常見', color: [255, 168, 120],
    desc: '清晨太陽能剛開始爬升（0–2,000 MW）時在線。', hint: '早起看日出',
    nameEn: 'Dawn Shift', descEn: `Online as solar starts to climb in the morning (0–2,000 MW).`, hintEn: 'Get up for the sunrise',
    glyph: 'M3 17h18M7 17a5 5 0 0 1 10 0M12 6v3M5 10l1.5 1.5M19 10l-1.5 1.5',
    check: ({ snap }) => { const h = twHour(snap.t); const s = snap.totals.solar || 0; return h >= 5 && h < 8 && s > 1 && s < 2000; }
  },
  {
    id: 'night-valley', name: '深夜低谷', kind: 'grid', rarity: '常見', color: [150, 160, 255],
    desc: '凌晨 2–5 點，全台用電最低的時段在線。', hint: '夜貓子專屬',
    nameEn: 'Midnight Valley', descEn: `Online at 2–5 am, Taiwan’s lowest-demand hours.`, hintEn: 'For night owls',
    glyph: 'M3 19l5-5 3 3 4-4 6 6M16 4a4 4 0 1 0 4 5 3 3 0 0 1-4-5z',
    check: ({ snap }) => { const h = twHour(snap.t); return h >= 2 && h < 5; }
  },
  {
    id: 'peak-watch', name: '尖峰守望者', kind: 'grid', rarity: '少見', color: [255, 122, 58],
    desc: '白天全台發電量創今日新高的那一刻在線。', hint: '午後用電高峰',
    nameEn: 'Peak Watcher', descEn: `Online the moment daytime generation hits today’s high.`, hintEn: 'Afternoon demand peak',
    glyph: 'M13 3L5 14h6l-1 7 8-11h-6z',
    check: ({ snap, rows }) => {
      const h = twHour(snap.t);
      return h >= 10 && h < 21 && rows.length >= 6 && rows.every((r) => r.total <= snap.total + 1);
    }
  },
  {
    id: 'yellow-witness', name: '黃燈見證', kind: 'grid', rarity: '稀有', color: [255, 214, 92],
    desc: '供電燈號亮起黃燈或更高等級時在線。', hint: '炎夏傍晚',
    nameEn: 'Yellow Light Witness', descEn: `Online when the supply signal is yellow or worse.`, hintEn: 'A hot summer evening',
    glyph: 'M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 15v5M8 20h8M12 7v3',
    check: ({ snap }) => snap.supply?.evidence === 'live' && snap.supply.level >= 1
  },
  {
    id: 'anomaly', name: '異常目擊', kind: 'grid', rarity: '稀有', color: [255, 110, 110],
    desc: '偵測到機組出力驟降的當下在線。', hint: '可遇不可求',
    nameEn: 'Anomaly Spotter', descEn: `Online when a sudden unit output drop is detected.`, hintEn: 'Pure luck',
    glyph: 'M12 3l9 17H3zM12 10v4M12 17v.5',
    check: ({ progress }) => !!progress.anomalySeen
  },
  {
    id: 'island-tour', name: '全島巡禮', kind: 'explore', rarity: '常見', color: [200, 210, 255],
    desc: `放空巡航看完全部 ${SHOTS.length} 個場景（其中「${SHOTS.filter((x) => x.day).map((x) => x.name).join('、')}」只在白天出現）。`, hint: '白天打開「放空」慢慢看',
    nameEn: 'Island Tour', descEn: `Watch all ${SHOTS.length} cruise scenes in Drift mode (one of them only appears in daytime).`, hintEn: 'Open Drift in the daytime and take your time',
    glyph: 'M12 3l3 6.5 6.5 2.5-6.5 2.5L12 21l-3-6.5L2.5 12 9 9.5z',
    check: ({ progress }) => (progress.shots || []).length >= SHOTS.length,
    progress: (p) => `${(p.shots || []).length} / ${SHOTS.length}`
  },
  {
    id: 'plant-dex', name: '電廠圖鑑', kind: 'explore', rarity: '常見', color: [214, 228, 255],
    desc: `點過（或滑過）${DEX_GOAL} 座不同的電廠或風場。`, hint: '把亮著的光球都摸一遍',
    nameEn: 'Plant Dex', descEn: `Tap (or hover) ${DEX_GOAL} different plants or wind farms.`, hintEn: 'Touch every glowing plant',
    glyph: 'M5 4h9a5 5 0 0 1 5 5v11H10a5 5 0 0 1-5-5zM10 4v16',
    check: ({ progress }) => (progress.plants || []).length >= DEX_GOAL,
    progress: (p) => `${Math.min(DEX_GOAL, (p.plants || []).length)} / ${DEX_GOAL}`
  },
  {
    id: 'time-traveler', name: '時光旅人', kind: 'explore', rarity: '常見', color: [180, 150, 255],
    desc: '用「回放」看完一整段今日電力變化。', hint: '試試回放功能',
    nameEn: 'Time Traveler', descEn: `Watch a full day of today’s power with Replay.`, hintEn: 'Try Replay',
    glyph: 'M12 7v5l3 2M4 12a8 8 0 1 0 2.3-5.7M4 3v4h4',
    check: ({ progress }) => !!progress.replayDone
  },
  {
    id: 'streak-7', name: '連續觀測', kind: 'explore', rarity: '少見', color: [255, 150, 92],
    desc: '連續 7 天打開光脈動。', hint: '每天來看一眼',
    nameEn: 'Streak Watcher', descEn: `Open the app 7 days in a row.`, hintEn: 'Take a look every day',
    glyph: 'M12 3c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3.5 2 3.5 0-3-1-6 1-9z',
    check: ({ progress }) => streak(progress.days || []) >= 7,
    progress: (p) => `${Math.min(7, streak(p.days || []))} / 7`
  }
];

function streak(days) {
  const set = new Set(days);
  let n = 0;
  for (let d = new Date(); set.has(twDateKey(d)); d = new Date(d.getTime() - 864e5)) n++;
  return n;
}

const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 略 */ } };

export function useBadges(snapshot, rows, { replaying = false } = {}) {
  const [earned, setEarned] = useState(() => load('tgf-badges', {}));
  const [progress, setProgress] = useState(() => load('tgf-progress', {}));
  const [toast, setToast] = useState(null);
  const earnedRef = useRef(earned);
  earnedRef.current = earned;

  const award = useCallback((ctx) => {
    const now = new Date().toISOString();
    const fresh = BADGES.filter((b) => !earnedRef.current[b.id] && (b.kind === 'explore' || b.id === 'anomaly' || ctx.snap) && safe(() => b.check(ctx)));
    if (!fresh.length) return;
    const next = { ...earnedRef.current };
    fresh.forEach((b) => { next[b.id] = { at: now }; });
    earnedRef.current = next;
    setEarned(next);
    save('tgf-badges', next);
    setToast({ badge: fresh[0], key: now });
  }, []);

  // 記錄今天有打開（連續觀測）
  useEffect(() => {
    record('day', twDateKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 電網徽章：只在真實即時資料、且不在回放時檢查
  useEffect(() => {
    if (!snapshot || replaying || snapshot.source !== 'live' || snapshot.cached) return; // 快取的舊資料不頒電網徽章
    award({ snap: snapshot, rows, progress });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, rows]);

  /** 記錄探索進度：record('shot', name) / ('plant', id) / ('replay') / ('anomaly') / ('day', date) */
  const record = useCallback((type, value) => {
    setProgress((p) => {
      const n = { ...p };
      const addTo = (k) => { if (!(n[k] || []).includes(value)) n[k] = [...(n[k] || []), value].slice(-60); };
      if (type === 'shot') addTo('shots');
      else if (type === 'plant') addTo('plants');
      else if (type === 'day') addTo('days');
      else if (type === 'replay') n.replayDone = true;
      else if (type === 'anomaly') n.anomalySeen = true;
      if (JSON.stringify(n) === JSON.stringify(p)) return p;
      save('tgf-progress', n);
      setTimeout(() => award({ snap: null, rows: [], progress: n }), 0);
      return n;
    });
  }, [award]);

  return { earned, progress, toast, clearToast: () => setToast(null), record };
}

function safe(fn) { try { return fn(); } catch { return false; } }
