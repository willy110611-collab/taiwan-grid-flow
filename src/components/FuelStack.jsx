import { useMemo, useState } from 'react';
import { FUELS } from '../config/energy.js';
import { fmtMw, rgb, chartKeys } from './widgets.jsx';
import { t, tx, isEn } from '../i18n.js';

// 由下往上：基載火力 → 其他火力 → 儲能 → 再生能源（太陽能在最上面，白天的起伏一眼看得出來）
const ORDER = ['coal', 'gas', 'cogen', 'oil', 'nuclear', 'storage', 'hydro', 'otherRe', 'wind', 'solar'];
const W = 320, H = 140;

const hmOf = (r) => String(r.timestamp || '').match(/(\d{1,2}):(\d{2})$/);
const minuteOf = (r) => { const m = hmOf(r); return m ? +m[1] * 60 + +m[2] : null; };

/**
 * 發電組成：台電各燃料別曲線（今天到現在、或昨天整天）的堆疊面積圖
 *  ・橫軸固定 00–24 時，今天只畫到現在
 *  ・手指或滑鼠在圖上移動看任一時刻；離開後停在最後一筆
 */
export function FuelStack({ today, yesterday }) {
  const [day, setDay] = useState('today');
  const [pick, setPick] = useState(null);
  const rows = (day === 'yesterday' ? yesterday : today) || [];

  const chart = useMemo(() => {
    const pts = rows.map((r) => ({ r, m: minuteOf(r) })).filter((p) => p.m != null).sort((a, b) => a.m - b.m);
    if (pts.length < 3) return null;
    const keys = ORDER.filter((f) => pts.some((p) => (p.r.totals?.[f] || 0) > 0.5));
    const total = (r) => keys.reduce((a, f) => a + (r.totals?.[f] || 0), 0);
    const max = Math.max(...pts.map((p) => total(p.r))) * 1.05 || 1;
    const x = (m) => (m / 1440) * W;
    const y = (v) => H - (v / max) * H;
    let base = pts.map(() => 0);
    const layers = keys.map((f) => {
      const top = pts.map((p, i) => base[i] + (p.r.totals?.[f] || 0));
      const up = pts.map((p, i) => `${x(p.m).toFixed(1)},${y(top[i]).toFixed(1)}`);
      const down = pts.map((p, i) => `${x(p.m).toFixed(1)},${y(base[i]).toFixed(1)}`).reverse();
      base = top;
      return { f, points: [...up, ...down].join(' ') };
    });
    const grid = [10000, 20000, 30000, 40000].filter((v) => y(v) > 12).map((v) => ({ v, y: y(v) })); // 太靠上緣的刻度不畫（會被切掉）
    return { pts, keys, layers, grid, x };
  }, [rows]);

  if (!chart) return null;
  const sel = chart.pts[pick != null ? Math.min(pick, chart.pts.length - 1) : chart.pts.length - 1];
  const tot = Object.entries(sel.r.totals || {}).reduce((a, [, v]) => a + v, 0) || 1;
  const green = ['solar', 'wind', 'hydro', 'otherRe'].reduce((a, f) => a + (sel.r.totals?.[f] || 0), 0);
  const hm = hmOf(sel.r)?.[0] || '';

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const m = ((e.clientX - box.left) / box.width) * 1440;
    let best = 0;
    chart.pts.forEach((p, i) => { if (Math.abs(p.m - m) < Math.abs(chart.pts[best].m - m)) best = i; });
    setPick(best);
  };

  return (
    <div className="fuel-stack" data-jump="fuel">
      <div className="hl-k">{t('發電組成')}<small className="muted">　{tx('台電各燃料別曲線（每 10 分鐘）', 'Taipower generation by fuel (every 10 min)')}</small></div>
      {yesterday?.length > 0 && (
        <div className="fs-tabs" role="tablist">
          {[['today', tx('今天', 'Today')], ['yesterday', tx('昨天', 'Yesterday')]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={day === k} className={day === k ? 'on' : ''} onClick={() => { setDay(k); setPick(null); }}>{label}</button>
          ))}
        </div>
      )}
      <svg className="fs-chart" viewBox={`0 0 ${W} ${H + 16}`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setPick(null)} tabIndex={0} onKeyDown={chartKeys(Math.min(pick ?? Infinity, chart.pts.length - 1), chart.pts.length, setPick)}
        role="slider" aria-label={t('發電組成')} aria-valuemin={0} aria-valuemax={chart.pts.length - 1} aria-valuenow={chart.pts.indexOf(sel)}
        aria-valuetext={tx(`${hm} 全台發電 ${fmtMw(tot)} MW，綠能 ${((green / tot) * 100).toFixed(1)}%`, `${hm} total ${fmtMw(tot)} MW, green ${((green / tot) * 100).toFixed(1)}%`)}>
        {chart.grid.map((g) => (
          <g key={g.v}>
            <line x1="0" x2={W} y1={g.y} y2={g.y} className="fs-grid" />
            <text x={W - 2} y={g.y - 3} textAnchor="end" className="fs-ax">{g.v / 1000} GW</text>
          </g>
        ))}
        {chart.layers.map((l) => <polygon key={l.f} points={l.points} fill={rgb(FUELS[l.f]?.color || [200, 200, 200], 0.8)} />)}
        <line x1={chart.x(sel.m)} x2={chart.x(sel.m)} y1="0" y2={H} className="fs-cursor" />
        {['00', '06', '12', '18', '24'].map((h, i) => (
          <text key={h} x={(i / 4) * W} y={H + 13} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="fs-ax">{h}</text>
        ))}
      </svg>
      <p className="fs-read">
        <span className="nw">{hm}</span>{'　'}
        <span className="nw">{tx('全台發電', 'Total')} <b>{fmtMw(tot)}</b> MW</span>{'　'}
        <span className="nw">{tx('太陽能', 'Solar')} <b>{fmtMw(sel.r.totals?.solar || 0)}</b></span>{'　'}
        <span className="nw">{tx('綠能', 'Green')} <b>{((green / tot) * 100).toFixed(1)}%</b></span>
      </p>
      <ul className="fs-legend">
        {[...chart.keys].reverse().map((f) => (
          <li key={f}><i style={{ background: rgb(FUELS[f]?.color || [200, 200, 200]) }} />{isEn() ? FUELS[f]?.en : FUELS[f]?.label}</li>
        ))}
      </ul>
      <p className="fine">{tx('手指在圖上滑動可看任一時刻；抽蓄與電池放電歸「儲能」，不算綠能。', 'Drag across the chart to see any moment; pumped hydro and battery discharge count as “storage”, not green.')}</p>
    </div>
  );
}
