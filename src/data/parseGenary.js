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
  const charging = { pump: 0, battery: 0 };

  let currentFuel = null;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    let fuel = classifyFuel(row[0]) || currentFuel;
    if (!fuel) continue;
    currentFuel = fuel;
    // 台電把抽蓄水力（明潭、大觀二）與電池都歸在「儲能」，不算再生能源；這裡照台電分類（抽蓄放水仍畫在明潭節點上）

    const unit = cleanText(row[2] ?? row[1] ?? '').replace(/\s*\(註\s*\d+\)/g, ''); // 台電頁面的註腳編號對使用者沒有意義
    if (!unit || /小計|合計|總計|subtotal|total/i.test(unit)) continue;

    const capacity = num(row[3]);
    const mw = num(row[4] ?? row[3]);
    if (!Number.isFinite(mw)) continue;

    const isLoad = /負載|Load/i.test(String(row[0]));
    const matched = PLANTS.find((p) => p.match && p.match.test(unit));
    units.push({ fuel, unit, capacity, mw, note: cleanText(row[6] ?? ''), plantId: matched?.id || null, load: isLoad, sub: cleanText(row[1] ?? '').replace(/\s*\(註\s*\d+\)/g, '') });
    // 儲能充電（抽蓄抽水、電池充電）：負值，另外統計給「反向流」與 HUD
    if (isLoad && mw < 0) {
      if (/抽蓄/.test(String(row[1]))) charging.pump += -mw; else charging.battery += -mw;
      continue;
    }
    if (isLoad) continue; // 儲能負載列只看充電（負值），不算進發電
    if (mw <= 0) continue; // 停機不發光

    totals[fuel] = (totals[fuel] || 0) + mw;
    if (fuel === 'storage' && !matched) continue; // 電池放電：計入總量，沒有位置不畫節點

    const plant = matched;
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
      byPlant[p.id] = { oil: islandEstimate(p.est) };
      estimated[p.id] = true;
    }
  }

  const plants = PLANTS.map((p) => {
    const mix = byPlant[p.id];
    const mw = Object.values(mix).reduce((a, b) => a + b, 0);
    const liveMw = Math.min(mw, liveByPlant[p.id]);
    return { id: p.id, mw, mix, liveMw: estimated[p.id] ? 0 : liveMw, allocatedMw: mw - liveMw, estimated: !!estimated[p.id] };
  });

  return { timestamp, plants, totals, units, charging };
}

/**
 * 對不到節點的出力（例如台電把全部太陽能彙總成一列、或民營小電廠），
 * 依各節點的 share 設定分配；沒有 share 的燃料，就依「已有同燃料節點」的比例分配。
 */
/**
 * 即時日照係數（氣象署日射量，依各太陽能群最近測站；1 = 平均）
 * 由 useSun() 每 30 分鐘更新；沒有資料時全部視為 1（只依裝置容量分配）
 */
let SUN = null;
export function setSolarSun(map) { SUN = map && Object.keys(map).length ? map : null; }
export function solarSun() { return SUN; }

function distributeUnallocated(byPlant, unallocated) {
  for (const [fuel, mw] of Object.entries(unallocated)) {
    let weights = PLANTS.filter((p) => !p.island && p.share?.[fuel])
      .map((p) => [p.id, p.share[fuel] * (fuel === 'solar' && SUN ? (SUN[p.id] ?? 1) : 1)]);
    if (!weights.length) {
      // 離島是獨立電網：本島對不到的出力（例如基隆協和的燃油）不能分給澎湖、金門
      weights = PLANTS.filter((p) => !p.island).map((p) => [p.id, byPlant[p.id][fuel] || 0]).filter(([, w]) => w > 0);
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
const cleanText = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
/** "498.3(90.6%)" → 498.3；"N/A" / "-" → NaN */
function num(v) {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/**
 * 離島推估（台電未即時公布時）：以典型負載為基準，依季節與一天中的時段調整
 *  夏季（6–9 月）用電較高、冬季較低；白天到傍晚高、深夜低
 */
export function islandEstimate(base, now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600e3);
  const m = t.getUTCMonth() + 1;
  const h = t.getUTCHours() + t.getUTCMinutes() / 60;
  const season = m >= 6 && m <= 9 ? 1.15 : m === 12 || m <= 2 ? 0.85 : 1.0;
  const day = 0.78 + 0.32 * Math.max(0, Math.sin(((h - 6) / 18) * Math.PI)); // 06 點起上升、15 點最高、24 點回落
  return Math.round(base * season * day * 10) / 10;
}
