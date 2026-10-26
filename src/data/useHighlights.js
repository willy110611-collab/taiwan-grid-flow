import { useMemo } from 'react';
import { PLANTS } from '../config/geo.js';
import { greenPct, rowHM } from './history.js';

/**
 * 今日亮點（仿軌島「亮點」面板）— 由今日歷史 rows 計算
 */
export function useHighlights(snapshot, rows, stats, anomalies) {
  return useMemo(() => {
    if (!snapshot || !rows.length) return null;
    const enriched = rows.map((r) => ({ hm: rowHM(r), load: r.total, solar: r.totals.solar || 0, greenPct: greenPct(r.totals) }));
    const max = (k) => enriched.reduce((a, r) => (r[k] > a[k] ? r : a), enriched[0]);
    const topNow = [...snapshot.plants].sort((a, b) => b.mw - a.mw)[0];
    const solarPeak = max('solar');
    return {
      since: enriched[0].hm,
      partial: snapshot.source === 'live' && enriched[0].hm > '01:00',
      topPlant: topNow && { id: topNow.id, name: PLANTS.find((p) => p.id === topNow.id)?.name, mw: topNow.mw },
      solarPeak: solarPeak.solar > 50 ? solarPeak : null,
      greenPeak: max('greenPct'),
      loadPeak: max('load'),
      southToNorth: stats?.southToNorthMw ?? null,
      // 台電各區即時發電／用電：北部用電 − 北部發電 = 從外區送進北部的量（實測，優先於模型）
      northIn: snapshot.regions?.evidence === 'live' && snapshot.regions.byKey?.N ? snapshot.regions.byKey.N.load - snapshot.regions.byKey.N.gen : null,
      spark: enriched.map((r) => r.greenPct),
      anomalies: anomalies || []
    };
  }, [rows, snapshot, stats, anomalies]);
}
