import { PLANTS } from '../config/geo.js';
import { classifyFuel } from '../config/energy.js';

/**
 * 解析台電「各機組發電量」genary 資料。
 *
 * 原始格式（近年版本）大致為：
 * {
 *   "": "2026-10-21 14:30",
 *   "aaData": [
 *     ["<A NAME='coal'></A><b>燃煤(Coal)</b>", "", "台中#1", "550.0", "498.3(90.6%)", "90.6%", ""],
 *     ...
 *     ["<b>燃煤(Coal)</b>", "", "小計", ...]       ← 小計列要跳過，避免重複計算
 *   ]
 * }
 * 欄位：[0]能源別(HTML) [1]空 [2]機組名稱 [3]裝置容量MW [4]淨發電量MW(%) [5]使用率 [6]備註
 *
 * 台電偶爾會調整欄位或改成 genary.json，所以這裡寫得盡量寬鬆：
 *  - 自動尋找「看起來像資料列的二維陣列」
 *  - 欄位內容用數字擷取，而不是寫死格式
 */
export function parseGenary(raw) {
  const json = typeof raw === 'string' ? JSON.parse(stripBom(raw)) : raw;
  const rows = findRows(json);
  if (!rows || rows.length < 5) throw new Error('genary: 找不到機組資料列');

  const timestamp = findTimestamp(json);

  /** @type {Record<string, Record<string, number>>} plantId → fuel → MW */
  const byPlant = Object.fromEntries(PLANTS.map((p) => [p.id, {}]));
  /** 直接以機組名稱對應到的出力（= 台電即時） */
  const liveByPlant = Object.fromEntries(PLANTS.map((p) => [p.id, 0]));
  const estimated = {};
  /** 每種燃料的全台總量 */
  const totals = {};
  /** 對不到座標的機組，先依燃料暫存，稍後依比例分配到節點 */
  const unallocated = {};
  const units = [];

  let currentFuel = null;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    let fuel = classifyFuel(row[0]) || currentFuel;
    if (!fuel) continue;
    currentFuel = fuel;
    // 台電把抽蓄水力（明潭、大觀二）歸在「儲能」；發電時當作水力顯示，儲能負載（抽水 / 充電）則略過
    if (fuel === 'storage' && /抽蓄/.test(String(row[1])) && !/負載|Load/i.test(String(row[0]))) fuel = 'hydro';

    const unit = cleanText(row[2] ?? row[1] ?? '');
    if (!unit || /小計|合計|總計|subtotal|total/i.test(unit)) continue;

    const capacity = num(row[3]);
    const mw = num(row[4] ?? row[3]);
    if (!Number.isFinite(mw)) continue;

    units.push({ fuel, unit, capacity, mw, note: cleanText(row[6] ?? '') });
    if (mw <= 0) continue; // 停機或儲能充電（負值）不發光

    totals[fuel] = (totals[fuel] || 0) + mw;
    if (fuel === 'storage') continue; // 電池儲能放電：只計入總量，不畫在地圖節點上

    const plant = PLANTS.find((p) => p.match && p.match.test(unit));
    if (plant) {
      byPlant[plant.id][fuel] = (byPlant[plant.id][fuel] || 0) + mw;
      liveByPlant[plant.id] += mw;
    }
    else unallocated[fuel] = (unallocated[fuel] || 0) + mw;
  }

  distributeUnallocated(byPlant, unallocated);

  // 離島：台電若未即時公布（0 或 N/A），以典型負載推估，避免離島整片熄滅
  for (const p of PLANTS) {
    if (!p.island) continue;
    const reported = Object.values(byPlant[p.id]).reduce((a, b) => a + b, 0);
    if (reported < 1) {
      byPlant[p.id] = { oil: p.est };
      estimated[p.id] = true;
    }
  }

  const plants = PLANTS.map((p) => {
    const mix = byPlant[p.id];
    const mw = Object.values(mix).reduce((a, b) => a + b, 0);
    const liveMw = Math.min(mw, liveByPlant[p.id]);
    return { id: p.id, mw, mix, liveMw: estimated[p.id] ? 0 : liveMw, allocatedMw: mw - liveMw, estimated: !!estimated[p.id] };
  });

  return { timestamp, plants, totals, units };
}

/**
 * 對不到節點的出力（例如台電把全部太陽能彙總成一列、或民營小電廠），
 * 依各節點的 share 設定分配；沒有 share 的燃料，就依「已有同燃料節點」的比例分配。
 */
function distributeUnallocated(byPlant, unallocated) {
  for (const [fuel, mw] of Object.entries(unallocated)) {
    let weights = PLANTS.filter((p) => p.share?.[fuel]).map((p) => [p.id, p.share[fuel]]);
    if (!weights.length) {
      weights = PLANTS.map((p) => [p.id, byPlant[p.id][fuel] || 0]).filter(([, w]) => w > 0);
    }
    const sum = weights.reduce((a, [, w]) => a + w, 0);
    if (!sum) continue; // 例如儲能、燃油沒有節點 → 只計入總量
    for (const [id, w] of weights) {
      byPlant[id][fuel] = (byPlant[id][fuel] || 0) + (mw * w) / sum;
    }
  }
}

function findRows(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.aaData)) return obj.aaData;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length && Array.isArray(v[0])) return v;
  }
  return null;
}

function findTimestamp(obj) {
  for (const v of Object.values(obj || {})) {
    if (typeof v === 'string' && /\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/.test(v)) return v;
  }
  return null;
}

const stripBom = (s) => s.replace(/^﻿/, '');
const cleanText = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
/** "498.3(90.6%)" → 498.3；"N/A" / "-" → NaN */
function num(v) {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}
