import { useEffect, useState } from 'react';
import { Sparkline } from './widgets.jsx';
import { tx, isEn } from '../i18n.js';

/**
 * 台灣在世界的位置：Ember「Yearly Electricity Data」（CC BY 4.0，scripts/ember.mjs 產生 public/ember.json）
 *  ・三種指標切換：電力碳強度、再生能源比例、燃煤比例；台灣標亮
 *  ・下方是台灣 2000 年起的變化
 *  ・Ember 用同一套方法估各國 → 適合國與國比較；和能源署公告的電力排碳係數算法不同，不混用
 */
let loading = null;
const load = () => (loading ||= fetch('./ember.json').then((r) => (r.ok ? r.json() : null)).catch(() => { loading = null; return null; }));

const METRICS = [
  { k: 'co2', zh: '碳強度', en: 'Carbon intensity', unit: 'g/kWh', low: true },
  { k: 'renew', zh: '再生能源', en: 'Renewables', unit: '%' },
  { k: 'coal', zh: '燃煤', en: 'Coal', unit: '%', low: true }
];

export function WorldCompare() {
  const [data, setData] = useState(null);
  const [m, setM] = useState('co2');
  useEffect(() => { let alive = true; load().then((d) => alive && setData(d)); return () => { alive = false; }; }, []);
  if (!data?.areas?.length) return null;

  const metric = METRICS.find((x) => x.k === m);
  const rows = data.areas.filter((a) => a[m] != null).sort((a, b) => (metric.low ? a[m] - b[m] : b[m] - a[m]));
  const max = Math.max(...rows.map((a) => a[m]), 1);
  const tw = rows.find((a) => a.id === 'Taiwan');
  const rank = tw ? rows.filter((a) => a.id !== 'World').findIndex((a) => a.id === 'Taiwan') + 1 : 0;
  const n = rows.filter((a) => a.id !== 'World').length;
  const series = (data.taiwan || []).filter((y) => y[m] != null);
  const fmt = (v) => (metric.unit === '%' ? `${v.toFixed(1)}%` : `${Math.round(v)}`);
  const years = [...new Set(rows.map((a) => a.year))];

  return (
    <div className="world">
      <div className="hl-k">{tx('台灣在世界的位置', 'Taiwan vs the world')}<small className="muted">　Ember {years.length === 1 ? years[0] : `${Math.min(...years)}–${Math.max(...years)}`}</small></div>
      <div className="fs-tabs" role="tablist">
        {METRICS.map((x) => (
          <button key={x.k} role="tab" aria-selected={m === x.k} className={m === x.k ? 'on' : ''} onClick={() => setM(x.k)}>{tx(x.zh, x.en)}</button>
        ))}
      </div>
      <ul className="world-bars">
        {rows.map((a) => (
          <li key={a.id} className={a.id === 'Taiwan' ? 'tw' : a.id === 'World' ? 'world-avg' : ''}>
            <span className="wb-name">{isEn() ? a.en : a.zh}</span>
            <span className="wb-bar"><i style={{ width: `${(a[m] / max) * 100}%` }} /></span>
            <span className="wb-v">{fmt(a[m])}</span>
          </li>
        ))}
      </ul>
      {tw && (
        <p className="fs-read">
          {tx(`台灣 ${fmt(tw[m])}${metric.unit === '%' ? '' : ' g/kWh'}：${metric.low ? '由低到高' : '由高到低'}排第 ${rank}（共 ${n} 個國家）。`,
            `Taiwan ${fmt(tw[m])}${metric.unit === '%' ? '' : ' g/kWh'}: ranks ${rank} of ${n} (${metric.low ? 'lowest first' : 'highest first'}).`)}
        </p>
      )}
      {series.length > 3 && (
        <div className="world-trend">
          <Sparkline values={series.map((y) => y[m])} color="rgb(110, 240, 190)" w={300} h={36} />
          <p className="fine">
            {tx(`台灣 ${series[0].year} 年 ${fmt(series[0][m])} → ${series[series.length - 1].year} 年 ${fmt(series[series.length - 1][m])}`,
              `Taiwan ${series[0].year}: ${fmt(series[0][m])} → ${series[series.length - 1].year}: ${fmt(series[series.length - 1][m])}`)}
          </p>
        </div>
      )}
      <p className="fine">
        {tx('碳強度＝每發一度電的二氧化碳排放。Ember 用同一套方法估算各國，適合國與國之間比較；和網站上依能源署電力排碳係數算的即時數字算法不同。',
          'Carbon intensity = CO₂ per kWh generated. Ember estimates every country the same way, so it suits cross-country comparison; it differs from the live figure on this site, which uses the Energy Administration grid factor.')}
        {' '}<a href={data.url} target="_blank" rel="noreferrer">Ember, Yearly Electricity Data（CC BY 4.0）</a>
      </p>
    </div>
  );
}
