import { REGIONS, REGION_KEYS, PLANT_REGION } from '../config/geo.js';

/**
 * 四大供電區的「發電 vs 用電」
 * ─────────────────────────────────────────────────────────────
 *  發電：用 genary 每座電廠出力加總（台電即時，必定有）
 *  優先用台電 genloadareaperc.csv 公布的各區即時發電與用電（台電即時）
 *  拿不到時：發電由電廠出力加總、用電依典型比例推估
 *  自給率 = 發電 / 用電：>100% 該區在「供能」，<100% 在「吸能」
 */
export function regionalGeneration(plants) {
  const gen = { N: 0, C: 0, S: 0, E: 0 };
  for (const p of plants) {
    const r = PLANT_REGION[p.id] || 'C';
    if (r !== 'X') gen[r] += p.mw; // X = 離島獨立電網，不計入本島四區
  }
  return gen;
}

/** 典型的區域用電比例（白天中南部工業用電略升；夜間北部住宅比重較高） */
export function typicalShares(date = new Date()) {
  const h = (date.getUTCHours() + 8) % 24 + date.getUTCMinutes() / 60;
  const day = Math.max(0, Math.sin((Math.PI * (h - 6)) / 14));
  return {
    N: REGIONS.N.share + 0.012 * (1 - day),
    C: REGIONS.C.share + 0.006 * day,
    S: REGIONS.S.share + 0.006 * day - 0.012 * (1 - day) * 0.5,
    E: REGIONS.E.share
  };
}

/**
 * @param plants   snapshot.plants
 * @param total    全台發電（MW）
 * @param measured parseLoadAreas() 的結果或 null
 */
export function computeRegions(plants, total, measured, date = new Date()) {
  let gen = measured?.gen;
  if (!gen) {
    gen = regionalGeneration(plants);
    // genary 裡對不到電廠的出力（汽電共生等）依比例補進各區，讓總量一致
    const genSum = REGION_KEYS.reduce((a, k) => a + gen[k], 0) || 1;
    for (const k of REGION_KEYS) gen[k] *= total / genSum;
  }

  let load, evidence;
  if (measured?.load) {
    load = measured.load;
    evidence = 'live';
  } else {
    const sh = typicalShares(date);
    const s = REGION_KEYS.reduce((a, k) => a + sh[k], 0);
    load = Object.fromEntries(REGION_KEYS.map((k) => [k, (total * sh[k]) / s]));
    evidence = 'modeled';
  }

  const out = {};
  for (const k of REGION_KEYS) {
    const l = Math.max(1, load[k]);
    out[k] = { key: k, name: REGIONS[k].name, gen: gen[k], load: l, ratio: gen[k] / l };
  }
  return { byKey: out, evidence, time: measured?.time || null };
}
