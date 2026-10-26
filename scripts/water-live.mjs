/**
 * 建置前抓水情即時資料 → public/data/water-live.json（npm run build 會先跑；deploy.yml 每 10 分鐘建置一次）
 *  ・水利署「水庫水情資料」（data.gov.tw 45501，每小時）：各水庫最新有效蓄水量、水位
 *  ・水利署「枯旱預警」（data.gov.tw 36695）：各供水區最新一筆通報
 *  ・抓不到就保留上一版（沒有就寫空的），不讓建置失敗；SKIP_OPENDATA=1 可跳過
 */
import { writeFileSync, mkdirSync } from 'node:fs';

if (process.env.SKIP_OPENDATA) { console.log('略過水情資料（SKIP_OPENDATA）'); process.exit(0); }

const WRA = 'https://opendata.wra.gov.tw/api/v2/';
const RES = '2be9044c-6e44-4856-aad5-dd108c2e6679'; // 45501 水庫水情資料
const DROUGHT = '51ea7202-18fd-46e3-adae-4d05bc827a28'; // 36695 枯旱預警
const OUT = new URL('../public/data/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const getJson = async (id) => {
  const r = await fetch(`${WRA}${id}?format=JSON`, { signal: AbortSignal.timeout(40000), headers: { 'User-Agent': 'Mozilla/5.0 taiwan-grid-flow-build' } });
  if (!r.ok) throw new Error(String(r.status));
  return JSON.parse((await r.text()).replace(/^﻿/, ''));
};
const num = (v) => (v === '' || v == null ? null : Number.isFinite(+v) ? +v : null);

const out = { t: new Date().toISOString(), reservoirs: {}, drought: [] };
try {
  for (const r of await getJson(RES)) {
    const id = r.reservoiridentifier;
    const eff = num(r.effectivewaterstoragecapacity);
    if (!id || eff == null) continue;
    const prev = out.reservoirs[id];
    if (!prev || r.observationtime > prev.t) out.reservoirs[id] = { t: r.observationtime, eff, lv: num(r.waterlevel) };
  }
} catch (e) { console.log('水庫水情抓不到：', e.message); }
try {
  const latest = new Map();
  for (const d of await getJson(DROUGHT)) {
    const k = d['供水區'];
    if (!k || !d['通報日期']) continue;
    if (!latest.has(k) || d['通報日期'] > latest.get(k).date) latest.set(k, { date: d['通報日期'], level: d['預警水情'], res: d['水庫名稱'], area: k });
  }
  out.drought = [...latest.values()].sort((a, b) => b.date.localeCompare(a.date));
} catch (e) { console.log('枯旱預警抓不到：', e.message); }

if (Object.keys(out.reservoirs).length || out.drought.length) {
  writeFileSync(new URL('water-live.json', OUT), JSON.stringify(out));
  console.log(`水情：水庫 ${Object.keys(out.reservoirs).length} 座、枯旱預警 ${out.drought.length} 區`);
} else console.log('水情資料都抓不到，保留上一版');
