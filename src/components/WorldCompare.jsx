import { useEffect, useState } from 'react';
import { Sparkline, rgb, chartKeys } from './widgets.jsx';
import { FUELS } from '../config/energy.js';
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
  { k: 'coal', zh: '燃煤', en: 'Coal', unit: '%', low: true },
  { k: 'perCap', zh: '人均用電', en: 'Use per person', unit: 'MWh' }
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
  const fmt = (v) => (metric.unit === '%' ? `${v.toFixed(1)}%` : metric.unit === 'MWh' ? v.toFixed(1) : `${Math.round(v)}`);
  const unitText = metric.unit === '%' ? '' : ` ${metric.unit === 'MWh' ? tx('MWh（千度）／人・年', 'MWh per person a year') : 'g/kWh'}`;
  const years = [...new Set(rows.map((a) => a.year))];

  return (
    <div className="world" data-jump="world">
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
          {tx(`台灣 ${fmt(tw[m])}${unitText}：${metric.low ? '由低到高' : '由高到低'}排第 ${rank}（共 ${n} 個國家）。${m === 'perCap' ? '人均用電＝全國用電 ÷ 人口，含工業與商業，不只家裡。' : ''}`,
            `Taiwan ${fmt(tw[m])}${unitText}: ranks ${rank} of ${n} (${metric.low ? 'lowest first' : 'highest first'}).${m === 'perCap' ? ' Per person = national demand ÷ population, including industry and business, not just homes.' : ''}`)}
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
      <TaiwanMix series={data.taiwan || []} />
      <p className="fine">
        {tx('碳強度＝Ember 估算的每度電排放量。Ember 用同一套方法估算各國，適合國與國之間比較；網站上的即時數字是依各機組型式的係數推算，算法不同，不能直接相比。',
          'Carbon intensity = emissions per kWh as estimated by Ember. Ember uses one method for every country, so it suits cross-country comparison; this site’s live figure is estimated from per-unit-type factors, so the two are not directly comparable.')}
        {' '}<a href={data.url} target="_blank" rel="noreferrer">Ember, Yearly Electricity Data（CC BY 4.0）</a>
      </p>
    </div>
  );
}

/** 台灣發電結構（Ember，2000 年起每年的發電比例）：由下往上 燃煤、燃氣、其他化石、核能、水力等再生、風光 */
const MIX = [
  { k: 'coal', zh: '燃煤', en: 'Coal', c: 'coal', v: (y) => y.coal },
  { k: 'gas', zh: '燃氣', en: 'Gas', c: 'gas', v: (y) => y.gas },
  { k: 'oil', zh: '其他化石', en: 'Other fossil', c: 'oil', v: (y) => Math.max(0, y.fossil - y.coal - y.gas) },
  { k: 'nuclear', zh: '核能', en: 'Nuclear', c: 'nuclear', v: (y) => y.nuclear || 0 },
  { k: 'hydro', zh: '水力等再生', en: 'Hydro & other RE', c: 'hydro', v: (y) => Math.max(0, y.renew - y.windSolar) },
  { k: 'ws', zh: '風力＋太陽能', en: 'Wind + solar', c: 'solar', v: (y) => y.windSolar || 0 }
];
const MW = 300, MH = 90;

function TaiwanMix({ series }) {
  const [pick, setPick] = useState(null);
  const ys = series.filter((y) => y.fossil != null && y.renew != null);
  if (ys.length < 5) return null;
  const x = (i) => (i / (ys.length - 1)) * MW;
  let base = ys.map(() => 0);
  const layers = MIX.map((m) => {
    const top = ys.map((y, i) => base[i] + m.v(y));
    const pts = [...ys.map((_, i) => `${x(i).toFixed(1)},${(MH - (top[i] / 100) * MH).toFixed(1)}`), ...ys.map((_, i) => `${x(i).toFixed(1)},${(MH - (base[i] / 100) * MH).toFixed(1)}`).reverse()];
    base = top;
    return { ...m, points: pts.join(' ') };
  });
  const sel = ys[pick ?? ys.length - 1];
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    setPick(Math.max(0, Math.min(ys.length - 1, Math.round(((e.clientX - box.left) / box.width) * (ys.length - 1)))));
  };
  const si = ys.indexOf(sel);
  return (
    <div className="world-mix">
      <div className="hl-k">{tx(`台灣發電結構 ${ys[0].year}–${ys[ys.length - 1].year}`, `Taiwan’s generation mix ${ys[0].year}–${ys[ys.length - 1].year}`)}</div>
      <svg className="fs-chart" viewBox={`0 0 ${MW} ${MH + 14}`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setPick(null)} tabIndex={0} onKeyDown={chartKeys(si, ys.length, setPick)}
        role="slider" aria-label={tx('台灣發電結構', 'Taiwan’s generation mix')} aria-valuemin={0} aria-valuemax={ys.length - 1} aria-valuenow={si}
        aria-valuetext={tx(`${sel.year} 年燃煤 ${sel.coal}%、燃氣 ${sel.gas}%、核能 ${sel.nuclear}%、再生能源 ${sel.renew}%`, `${sel.year}: coal ${sel.coal}%, gas ${sel.gas}%, nuclear ${sel.nuclear}%, renewables ${sel.renew}%`)}>
        {layers.map((l) => <polygon key={l.k} points={l.points} fill={rgb(FUELS[l.c]?.color || [200, 200, 200], 0.8)} />)}
        <line x1={x(si)} x2={x(si)} y1="0" y2={MH} className="fs-cursor" />
        {[0, Math.floor((ys.length - 1) / 2), ys.length - 1].map((i, j) => (
          <text key={i} x={x(i)} y={MH + 12} textAnchor={j === 0 ? 'start' : j === 2 ? 'end' : 'middle'} className="fs-ax">{ys[i].year}</text>
        ))}
      </svg>
      <p className="fs-read">
        <span className="nw">{sel.year}</span>{'　'}
        {MIX.filter((m) => m.v(sel) >= 0.5).map((m) => (
          <span key={m.k} className="nw"><i className="wm-dot" style={{ background: rgb(FUELS[m.c]?.color || [200, 200, 200]) }} />{tx(m.zh, m.en)} <b>{m.v(sel).toFixed(1)}%</b>{'　'}</span>
        ))}
      </p>
    </div>
  );
}
