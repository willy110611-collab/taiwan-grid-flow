/**
 * 台電各機組過去發電量（data.gov.tw 37331，經中繼站 /open/unit-history.json）→ public/unit-history.json
 * ─────────────────────────────────────────────────────────────
 * 原檔約 200 MB（每部機組每 10 分鐘一筆），只在資料更新時手動跑一次：
 *   node scripts/unit-history.mjs [本機原檔.json]
 * 輸出每座電廠每天的發電量（MWh）與當天最高出力（MW，全廠同一時刻加總），電廠對應規則與網頁相同（geo.js 的 match）。
 * 這份資料只有台電自有機組：民營電廠、購電的再生能源不在裡面。
 */
import fs from 'fs';
import { PLANTS } from '../src/config/geo.js';

const URL = 'https://taiwan-grid-flow-data.willy110611.workers.dev/open/unit-history.json';
const src = process.argv[2];
const text = src ? fs.readFileSync(src, 'utf8') : await (await fetch(URL)).text();
const rec = JSON.parse(text.replace(/^﻿/, '')).records;

const day0 = rec.START_DATE.slice(0, 10);
const dayIdx = (iso) => Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(day0)) / 864e5);
const days = dayIdx(rec.END_DATE) + 1;

const plants = {};
const unmatched = new Set();
const seen = new Set();
let dup = 0;
for (const r of rec.NET_P) {
  const v = Number(r.NET_P);
  if (!Number.isFinite(v)) continue;
  // 原檔 2026-04-01 整天每筆都出現兩次 → 機組、時間、數值都相同的只算一次
  const key = `${r.UNIT_NAME}|${r.DATETIME}|${r.NET_P}`;
  if (seen.has(key)) { dup++; continue; }
  seen.add(key);
  const di = dayIdx(r.DATETIME);
  if (di < 0 || di >= days) continue; // 超出 START_DATE～END_DATE 的資料不算
  const p = PLANTS.find((x) => x.match && x.match.test(r.UNIT_NAME));
  if (!p) { unmatched.add(r.UNIT_NAME); continue; }
  const P = (plants[p.id] ||= { units: new Set(), e: new Array(days).fill(0), at: new Map(), f: {} });
  P.units.add(r.UNIT_NAME);
  P.f[r.FUEL_TYPE] = (P.f[r.FUEL_TYPE] || 0) + v / 6; // 各燃料別合計（例如核能電廠裡的燃油氣渦輪機、太陽能）
  P.e[di] += v / 6; // 10 分鐘 → MWh
  P.at.set(r.DATETIME, (P.at.get(r.DATETIME) || 0) + v);
}

const out = {
  source: '台灣電力公司「各機組過去發電量」（政府資料開放平臺 37331）',
  url: 'https://data.gov.tw/dataset/37331',
  start: day0,
  end: rec.END_DATE.slice(0, 10),
  plants: {}
};
for (const [id, P] of Object.entries(plants)) {
  const pk = new Array(days).fill(0);
  for (const [t, mw] of P.at) { const i = dayIdx(t); if (mw > pk[i]) pk[i] = mw; }
  const f = Object.fromEntries(Object.entries(P.f).map(([k, v]) => [k, Math.round(v)]));
  out.plants[id] = { units: [...P.units].sort(), f, e: P.e.map(Math.round), pk: pk.map(Math.round) };
}
fs.writeFileSync('public/unit-history.json', JSON.stringify(out));
console.log(`  略過重複資料 ${dup.toLocaleString()} 筆`);
console.log(`✓ ${Object.keys(out.plants).length} 座電廠，${out.start}～${out.end}（${days} 天）`);
console.log(`  對不到電廠的機組（小水力、陸域小風場、小型光電等）：${[...unmatched].join('、')}`);
