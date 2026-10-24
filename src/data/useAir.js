import { useEffect, useState } from 'react';
import { APP } from '../config/app.js';
import { PLANTS } from '../config/geo.js';
import { setSolarSun } from './parseGenary.js';

/**
 * 空氣品質（環境部 AQI，每小時）與電廠煙道排放（環境部 CEMS 1 小時值）
 * 經 Cloudflare 中繼站取得（金鑰存在中繼站，不會出現在網頁裡）。
 * 中繼站尚未設定環境部金鑰時，error 會說明原因，畫面顯示設定提示。
 */
const REFRESH = 15 * 60 * 1000;

async function getJson(path) {
  const r = await fetch(`${APP.relayUrl}/${path}?_=${Date.now()}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export function useAir() {
  const [air, setAir] = useState({ stations: [], cems: {}, error: null, cemsError: null, loading: true });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.hidden && !first) return; // 省電：背景不抓，切回前景時補抓
      first = false;
      const next = { stations: [], cems: {}, error: null, cemsError: null, loading: false };
      try {
        const j = await getJson('aqi.json');
        next.stations = j.stations || [];
        // 中繼站 v5：環境部故障時改給最後一次成功的資料（stale）
        if (j.stale) next.staleAt = j.savedAt || null;
        next.asOf = next.stations.map((x) => x.time).filter(Boolean).sort().pop() || null;
      } catch (e) { next.error = e.message; }
      try { next.cems = groupCems((await getJson('cems.json')).records || []); next.cemsAsOf = Object.values(next.cems).map((c) => c.time).filter(Boolean).sort().pop() || null; } catch (e) { next.cemsError = e.message; }
      if (alive) setAir(next);
    };
    let first = true;
    tick();
    const id = setInterval(tick, REFRESH);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return air;
}

/* ── CEMS（環境部 aqx_p_187）：abbr 廠名、itemdesc 項目、m_value 值、std 標準（≤0 表示無標準）、code2desc 狀態 ──
 * 只對應「發電廠」本身：民營電廠（新桃、國光、星能…）與石化廠不併進台電電廠，避免混在一起取最大值 */
const PLANT_ALIAS = [
  [/台中發電廠|臺中發電廠/, 'taichung'], [/麥寮汽電|麥寮發電/, 'mailiao'], [/興達發電廠/, 'hsinta'], [/林口發電廠/, 'linkou'],
  [/南部發電廠/, 'nanbu'], [/大林發電廠/, 'talin'], [/和平.*發電廠/, 'hoping'], [/大潭發電廠/, 'datan'], [/通霄發電廠/, 'tunghsiao'],
  [/協和發電廠/, 'hsiehho'], [/尖山發電廠/, 'penghu'], [/塔山發電廠/, 'kinmen'], [/珠山發電廠/, 'matsu']
];
const ITEM_NAME = [[/SO|硫/i, '硫氧化物'], [/NO|氮/i, '氮氧化物'], [/不透光|OP/i, '不透光率'], [/粒狀|PM|TSP/i, '粒狀物'], [/CO(?!2)|一氧化碳/i, '一氧化碳']];

export function groupCems(records) {
  if (!records.length) return {};
  const keys = Object.keys(records[0]);
  const find = (re) => keys.find((k) => re.test(k));
  const kName = find(/fac.*name|abbr|名稱|廠/i) || keys.find((k) => records.some((r) => /電/.test(r[k] || '')));
  const kItem = find(/item.*desc|item_?name|itemdesc|項目|desp|desc/i) || find(/item/i);
  const kVal = find(/^m?_?val|value|監測值|數值/i);
  const kStd = find(/std|standard|limit|標準/i);
  const kTime = find(/time|date|時間/i);
  const kUnit = find(/unit|單位/i);
  const out = {};
  for (const r of records) {
    const name = String(r[kName] || '');
    const plant = PLANT_ALIAS.find(([re]) => re.test(name))?.[1];
    if (!plant) continue;
    const stopped = /暫停運轉|停爐|停機/.test(String(r.code2desc || ''));
    const rawItem = String(r[kItem] || '');
    const item = ITEM_NAME.find(([re]) => re.test(rawItem))?.[1];
    const val = parseFloat(r[kVal]);
    if (!item || !Number.isFinite(val)) continue;
    const stdRaw = parseFloat(r[kStd]);
    const std = stdRaw > 0 ? stdRaw : null;
    const time = String(r[kTime] || '');
    const P = (out[plant] ||= { name, items: {}, time: '', running: 0, stopped: 0 });
    stopped ? P.stopped++ : P.running++;
    if (time > P.time) P.time = time;
    if (stopped) continue; // 停機中的煙囪不列入最大值
    const slot = (P.items[item] ||= { max: -Infinity, std: null, unit: r[kUnit] || '', time: '' });
    // 同一電廠有多根煙囪：取運轉中最高的一根（最保守）
    if (val > slot.max) Object.assign(slot, { max: val, std: std ?? slot.std, time, unit: r[kUnit] || slot.unit });
  }
  return out;
}

/* ── 距離與最近測站 ── */
export function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function nearestStation(stations, pos) {
  let best = null;
  for (const s of stations) {
    if (s.aqi == null && s.pm25 == null) continue;
    const d = distKm(pos, [s.lng, s.lat]);
    if (!best || d < best.d) best = { ...s, d };
  }
  return best;
}
/** 風向：測站若沒有風資料，往外找最近有風資料的測站 */
export function nearestWind(stations, pos) {
  let best = null;
  for (const s of stations) {
    if (s.windDir == null || s.windSpeed == null) continue;
    const d = distKm(pos, [s.lng, s.lat]);
    if (!best || d < best.d) best = { dir: s.windDir, speed: s.windSpeed, site: s.site, d };
  }
  return best;
}

/** 環境部 AQI 官方分級與顏色 */
export function aqiLevel(aqi) {
  if (aqi == null) return { label: '—', color: [140, 150, 170] };
  if (aqi <= 50) return { label: '良好', color: [0, 228, 120] };
  if (aqi <= 100) return { label: '普通', color: [255, 230, 0] };
  if (aqi <= 150) return { label: '對敏感族群不健康', color: [255, 126, 0] };
  if (aqi <= 200) return { label: '對所有族群不健康', color: [255, 40, 40] };
  if (aqi <= 300) return { label: '非常不健康', color: [170, 60, 200] };
  return { label: '危害', color: [126, 0, 35] };
}

/* ── 即時日照（氣象署日射量）→ 各太陽能群的分配係數 ──
 * 係數 = 最近測站日射量 ÷ 全台中位數（限制在 0.3–1.8）；只改變「全台總量怎麼分到各縣市」，總量仍是台電即時值。
 * 中繼站沒有設定 CWA_KEY 時拿不到資料 → 係數全部 1（只依裝置容量）。 */
export function useSun() {
  const [sun, setSun] = useState({ factors: null, error: null });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { stations } = await getJson('sun.json');
        // 用「最新一天」的資料（氣象署可能是逐時，也可能是隔天公布的日總量）；超過 3 天前就不用
        const day = (x) => String(x.time || '').replace(/\//g, '-').slice(0, 10);
        const latest = stations.map(day).filter(Boolean).sort().pop();
        const tooOld = latest && Date.now() - new Date(latest + 'T00:00:00+08:00').getTime() > 3 * 86400e3;
        const ok = stations.filter((x) => x.value > 0 && (!latest || day(x) === latest));
        // 夜裡日射量全是 0：不是故障，只是沒有太陽（係數回到只依裝置容量）
        if (!tooOld && ok.length < 5 && stations.some((x) => day(x) === latest) && stations.every((x) => !(x.value > 0))) {
          setSolarSun(null);
          if (alive) setSun({ factors: null, error: null, night: true });
          return;
        }
        if (ok.length < 5 || tooOld) throw new Error('日射量資料不足或過舊');
        const sorted = ok.map((x) => x.value).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const factors = {};
        for (const p of PLANTS.filter((x) => x.solar)) {
          let best = null;
          for (const x of ok) { const d = distKm(p.pos, [x.lng, x.lat]); if (!best || d < best.d) best = { d, v: x.value }; }
          if (best && best.d < 90) factors[p.id] = Math.max(0.3, Math.min(1.8, best.v / median));
        }
        setSolarSun(factors);
        if (alive) setSun({ factors, error: null, asOf: stations.map((x) => x.time).filter(Boolean).sort().pop() || null });
      } catch (e) {
        setSolarSun(null);
        if (alive) setSun({ factors: null, error: e.message });
      }
    };
    tick();
    const id = setInterval(tick, 30 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return sun;
}
