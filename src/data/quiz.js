import { useEffect, useState } from 'react';
import { APP } from '../config/app.js';
import { QUIZ_BANK } from '../config/quizBank.js';
import { FUELS } from '../config/energy.js';
import { PLANTS, REGIONS } from '../config/geo.js';
import { isEn, tx } from '../i18n.js';

/**
 * 每週知識題
 * ─────────────────────────────────────────────────────────────
 *  ・每週 5 題（3 題知識＋2 題看地圖），週一 00:00（台灣時間）換題；每兩個月一季（1–2、3–4 … 11–12 月，依該週星期一的月份）
 *  ・季內可以補答前幾週的題目；每題只算第一次作答；排行榜：答對多者在前，同分比作答總時間（短者在前）
 *  ・選題：從 QUIZ_START 起逐週模擬，每週挑「最久沒出過」的題目（從沒出過的優先），同分用週代碼雜湊決定 →
 *    題庫往後加題不會改到已經出過的週；題目用完會自然重複最久以前出過的
 *  ・作答時間：打開題目到送出（中途去地圖找答案也算），單題最多計 30 分鐘
 *  ・對錯在這台裝置判斷；中繼站只記分與排名（/quiz/answer、/quiz/board）
 */
export const QUIZ_START = '2026-W45';
const KNOW_PER_WEEK = 3, MAP_PER_WEEK = 2;
const MAX_MS = 30 * 60e3;

/* ── 週與季（台灣時間）── */
const tw = (ms) => new Date(ms + 8 * 3600e3);
export function weekOf(ms = Date.now()) {
  const d = tw(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  const thu = new Date(mon + 3 * 864e5);
  const y = thu.getUTCFullYear();
  return `${y}-W${String(1 + Math.floor((thu - Date.UTC(y, 0, 1)) / 6048e5)).padStart(2, '0')}`;
}
/** 週代碼 → 星期一（以 UTC 表示的台灣日期） */
export function mondayOf(id) {
  const [y, w] = id.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  return new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 864e5 + (w - 1) * 6048e5);
}
const addWeeks = (id, n) => weekOf(mondayOf(id).getTime() - 8 * 3600e3 + n * 6048e5 + 12 * 3600e3);
export function seasonOf(id) {
  const m = mondayOf(id);
  const sm = m.getUTCMonth() - (m.getUTCMonth() % 2) + 1;
  return `${m.getUTCFullYear()}-${String(sm).padStart(2, '0')}`;
}
export const seasonLabel = (s) => { const [y, m] = s.split('-').map(Number); return tx(`${y} 年 ${m}–${m + 1} 月`, `${['Jan–Feb', '', 'Mar–Apr', '', 'May–Jun', '', 'Jul–Aug', '', 'Sep–Oct', '', 'Nov–Dec'][m - 1]} ${y}`); };
export const prevSeason = (s) => { const [y, m] = s.split('-').map(Number); return m === 1 ? `${y - 1}-11` : `${y}-${String(m - 2).padStart(2, '0')}`; };
/** 本季到本週為止的週（舊到新），不早於 QUIZ_START */
export function seasonWeeks(cur = weekOf()) {
  const s = seasonOf(cur), out = [];
  for (let w = cur; seasonOf(w) === s && w >= QUIZ_START; w = addWeeks(w, -1)) out.unshift(w);
  return out;
}
export const weekRange = (id) => {
  const m = mondayOf(id), e = new Date(m.getTime() + 6 * 864e5);
  return `${m.getUTCMonth() + 1}/${m.getUTCDate()}–${e.getUTCMonth() + 1}/${e.getUTCDate()}`;
};

/* ── 看地圖題：答案依當下台電資料 ── */
const fuelName = (f) => (isEn() ? FUELS[f]?.en : FUELS[f]?.label) || f;
const regionName = (k) => (isEn() ? REGIONS[k]?.en : REGIONS[k]?.name) || k;
const plantLabel = (id) => { const p = PLANTS.find((x) => x.id === id); return (isEn() ? p?.en : p?.name) || id; };
const greenShare = (snap) => {
  const t = snap?.totals || {};
  const all = Object.values(t).reduce((a, b) => a + b, 0) || 1;
  return (Object.entries(t).filter(([f]) => FUELS[f]?.green).reduce((a, [, v]) => a + v, 0) / all) * 100;
};
export const MAP_QUESTIONS = {
  top: {
    q: () => tx('現在全台出力最大的電廠是哪一座？', 'Which plant is generating the most right now?'),
    hint: () => tx('光球越大越亮，出力越多；點光球可以看數字。', 'Bigger, brighter dots generate more; tap one to see its output.'),
    // 選項在第一次打開時固定（出力前 4 名、打亂順序），答案在送出時用當下資料判斷
    make: (snap) => {
      const top = (snap?.plants || []).filter((p) => p.mw > 0).sort((a, b) => b.mw - a.mw).slice(0, 4).map((p) => p.id);
      return top.length >= 2 ? shuffle(top, top.join()) : null;
    },
    label: plantLabel,
    answer: (snap, keys) => keys.reduce((best, k) => ((snap.plants.find((p) => p.id === k)?.mw || 0) > (snap.plants.find((p) => p.id === best)?.mw || 0) ? k : best), keys[0]),
    more: { filter: 'all' }
  },
  north: {
    q: () => tx('現在北部是在送電給其他區，還是需要其他區送電進來？', 'Right now, is the north sending power to other regions or taking power in?'),
    hint: () => tx('能源篩選切到「用電」，看北部的自給率。', 'Switch the filter to Demand and check the north’s self-supply.'),
    make: (snap) => (snap?.regions?.byKey?.N ? ['out', 'in'] : null),
    label: (k) => (k === 'out' ? tx('送電給其他區', 'Sending power out') : tx('需要其他區送電進來', 'Taking power in')),
    answer: (snap) => (snap.regions.byKey.N.ratio >= 1 ? 'out' : 'in'),
    more: { filter: 'demand' }
  },
  green: {
    q: () => tx('現在綠能大約佔全台發電多少？', 'About what share of Taiwan’s generation is renewable right now?'),
    hint: () => tx('右上角的大數字就是綠能佔比。', 'The big number at the top right is the renewable share.'),
    make: (snap) => (snap?.totals ? ['a', 'b', 'c', 'd'] : null),
    label: (k) => ({ a: tx('不到 10%', 'Under 10%'), b: '10–20%', c: '20–30%', d: tx('30% 以上', '30% or more') })[k],
    answer: (snap) => { const g = greenShare(snap); return g < 10 ? 'a' : g < 20 ? 'b' : g < 30 ? 'c' : 'd'; },
    more: { filter: 'green' }
  },
  fuel: {
    q: () => tx('現在發電最多的是哪一種能源？', 'Which energy source is generating the most right now?'),
    hint: () => tx('能源篩選切換「綠能」「火力」，看哪些電廠最亮。', 'Switch between Green and Thermal to see which plants glow brightest.'),
    make: (snap) => {
      const top = Object.entries(snap?.totals || {}).filter(([f]) => FUELS[f]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f]) => f);
      return top.length >= 2 ? shuffle(top, top.join()) : null;
    },
    label: fuelName,
    answer: (snap, keys) => keys.reduce((best, k) => ((snap.totals[k] || 0) > (snap.totals[best] || 0) ? k : best), keys[0]),
    more: { filter: 'thermal' }
  },
  region: {
    q: () => tx('現在北、中、南、東哪一區發電最多？', 'Which region — north, central, south or east — is generating the most right now?'),
    hint: () => tx('能源篩選切到「用電」，四區都會標出發電量。', 'Switch the filter to Demand to see each region’s generation.'),
    make: (snap) => (snap?.regions?.byKey ? ['N', 'C', 'S', 'E'] : null),
    label: regionName,
    answer: (snap) => ['N', 'C', 'S', 'E'].reduce((best, k) => (snap.regions.byKey[k].gen > snap.regions.byKey[best].gen ? k : best), 'N'),
    more: { filter: 'demand' }
  },
  supply: {
    q: () => tx('今天台電的供電燈號是什麼顏色？', 'What colour is Taipower’s supply light today?'),
    hint: () => tx('右上角綠能數字下面有供電燈號。', 'The supply light is under the renewable share at the top right.'),
    make: (snap) => (snap?.supply && Number.isFinite(snap.supply.level) && !snap.supply.old ? ['0', '1', '2', '3'] : null),
    label: (k) => [tx('綠燈（充裕）', 'Green (ample)'), tx('黃燈（吃緊）', 'Yellow (tight)'), tx('橘燈（警戒）', 'Orange (alert)'), tx('紅燈以上（限電警戒）', 'Red or worse')][k],
    answer: (snap) => String(Math.min(3, snap.supply.level)),
    more: { filter: 'all' }
  }
};

/* ── 選題 ── */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  // 再攪拌一次（只差最後一個字的 id 不會排在一起，避免同一週三題都是同一類）
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
function shuffle(arr, seed) { return arr.map((x) => [hash(`${seed}|${x}`), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]); }
const pickCache = new Map();
/** 某一週的 5 題：[{ qid: 'k:k01' | 'm:top', kind: 'k' | 'm', id }] */
export function questionsOf(week) {
  if (pickCache.has(week)) return pickCache.get(week);
  const lastK = new Map(), lastM = new Map();
  let result = [];
  for (let w = QUIZ_START, i = 0; w <= week && i < 2000; w = addWeeks(w, 1), i++) {
    const mon = mondayOf(w).toISOString().slice(0, 10);
    const pick = (ids, last, n) => ids
      .map((id) => [last.has(id) ? last.get(id) : -1, hash(`${w}|${id}`), id])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, n).map((x) => x[2]);
    const ks = pick(QUIZ_BANK.filter((q) => q.since <= mon).map((q) => q.id), lastK, KNOW_PER_WEEK);
    const ms = pick(Object.keys(MAP_QUESTIONS), lastM, MAP_PER_WEEK);
    ks.forEach((id) => lastK.set(id, i));
    ms.forEach((id) => lastM.set(id, i));
    const list = shuffle([...ks.map((id) => ({ qid: `k:${id}`, kind: 'k', id })), ...ms.map((id) => ({ qid: `m:${id}`, kind: 'm', id }))], `order|${w}`);
    pickCache.set(w, list);
    if (w === week) result = list;
  }
  return result;
}

/* ── 這台裝置的紀錄（localStorage tgf-quiz）── */
const KEY = 'tgf-quiz';
const NAMES = ['午間光海', '北風之夜', '綠能過半', '黎明交班', '深夜低谷', '尖峰守望者', '嘉南光電星海', '彰濱離岸風場', '離島微光', '西部能量動脈'];
const NAMES_EN = ['Noon Light Sea', 'North Wind Night', 'Green Majority', 'Dawn Shift', 'Night Trough', 'Peak Watcher', 'Chianan Solar Stars', 'Changbin Offshore', 'Island Glow', 'West Artery'];
const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* 無痕模式 */ }
  if (!s || typeof s !== 'object' || !/^[a-z0-9]{16,40}$/.test(s.uid || '')) {
    const i = Math.floor(Math.random() * NAMES.length), n = String(Math.floor(Math.random() * 9000) + 1000);
    s = { uid: randId(), name: `${(isEn() ? NAMES_EN : NAMES)[i]} #${n}`, ans: {}, open: {}, opts: {}, seen: null };
  }
  s.ans ||= {}; s.open ||= {}; s.opts ||= {};
  return s;
}
let state = load();
const subs = new Set();
function save(patch) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 略 */ }
  subs.forEach((f) => f(state));
}
export function useQuiz() {
  const [s, set] = useState(state);
  useEffect(() => { subs.add(set); return () => subs.delete(set); }, []);
  return s;
}
const key = (week, qid) => `${week}|${qid}`;
export const answerOf = (s, week, qid) => s.ans[key(week, qid)] || null;

/** 打開題目：記下開始時間（之後去地圖找答案再回來也接著算）；看地圖題第一次打開時固定選項 */
export function openQuestion(week, item, snap) {
  const k = key(week, item.qid);
  const patch = {};
  if (!state.open[k]) patch.open = { ...state.open, [k]: Date.now() };
  if (item.kind === 'm' && !state.opts[k]) {
    const opts = MAP_QUESTIONS[item.id].make(snap);
    if (opts) patch.opts = { ...state.opts, [k]: opts };
  }
  if (Object.keys(patch).length) save(patch);
}
export const optionsOf = (s, week, item) => (item.kind === 'k' ? null : s.opts[key(week, item.qid)] || null);

/** 送出答案：本機判斷對錯，存紀錄並送到中繼站記分 */
export async function submitAnswer(week, item, choice, snap) {
  const k = key(week, item.qid);
  if (state.ans[k]) return state.ans[k];
  let ok, correct;
  if (item.kind === 'k') {
    const q = QUIZ_BANK.find((x) => x.id === item.id);
    correct = q.a; ok = choice === q.a;
  } else {
    const m = MAP_QUESTIONS[item.id];
    correct = m.answer(snap, state.opts[k]); ok = choice === correct;
  }
  const ms = Math.min(MAX_MS, Math.max(0, Date.now() - (state.open[k] || Date.now())));
  const rec = { choice, correct, ok, ms, t: Date.now() };
  save({ ans: { ...state.ans, [k]: rec } });
  post('answer', { uid: state.uid, name: state.name, week, qid: item.qid, ok, ms }).catch(() => {});
  return rec;
}

/* ── 排行榜 ── */
const post = (action, body) => fetch(`${APP.relayUrl}/quiz/${action}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
export async function fetchBoard(season) {
  const r = await fetch(`${APP.relayUrl}/quiz/board?season=${season}&uid=${state.uid}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function setName(name) {
  const n = String(name || '').normalize('NFKC').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!n) return false;
  save({ name: n });
  await post('name', { uid: state.uid, name: n }).catch(() => {});
  return true;
}
/** 刪除我的排行榜紀錄（中繼站）與這台裝置的作答 */
export async function forgetMe() {
  await post('forget', { uid: state.uid });
  try { localStorage.removeItem(KEY); } catch { /* 略 */ }
  state = load();
  subs.forEach((f) => f(state));
}

/** 本季統計（這台裝置）：已答、答對、作答總時間 */
export function seasonStats(s, weeks = seasonWeeks()) {
  let n = 0, ok = 0, ms = 0, total = 0;
  for (const w of weeks) for (const it of questionsOf(w)) {
    total++;
    const a = answerOf(s, w, it.qid);
    if (a) { n++; ok += a.ok ? 1 : 0; ms += a.ms; }
  }
  return { n, ok, ms, total };
}
/** 「更多」上的提示點：本週題目還沒看過 */
export const hasNewWeek = (s) => s.seen !== weekOf();
export const markSeen = () => { if (state.seen !== weekOf()) save({ seen: weekOf() }); };
export const fmtTime = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
