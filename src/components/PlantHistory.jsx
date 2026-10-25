import { useEffect, useState } from 'react';
import { FUELS } from '../config/energy.js';
import { fmtMw, rgb } from './widgets.jsx';
import { tx } from '../i18n.js';
import { NUCLEAR_IDS } from '../config/nuclear.js';

/**
 * 電廠卡：過去發電量（台電「各機組過去發電量」data.gov.tw 37331，scripts/unit-history.mjs 產生）
 *  ・每天一根柱子＝當天發電量；手指或滑鼠移到柱子上看那天的發電量與最高出力
 *  ・只有台電自有機組 → 民營電廠、購電的再生能源不在資料裡（沒有資料的電廠不顯示這段）
 */
let loading = null;
const load = () => (loading ||= fetch('./unit-history.json').then((r) => (r.ok ? r.json() : null)).catch(() => { loading = null; return null; }));

const W = 300, H = 56;
const gwh = (mwh) => (mwh >= 1000 ? `${(mwh / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} GWh` : `${fmtMw(mwh)} MWh`);
// 原檔的燃料別名稱 → 英文
const FUEL_EN = { 核能: 'nuclear', 燃煤: 'coal', 燃氣: 'gas', 燃油: 'oil', 輕油: 'light oil (gas turbines)', 水力: 'hydro', 抽蓄發電: 'pumped hydro', 風力: 'wind', 太陽能: 'solar', 汽電共生: 'cogeneration', 儲能: 'storage' };
// 原檔燃料別 → 網站的燃料（決定顏色、判斷電廠主要機組在不在資料裡）
const FUEL_KEY = { 核能: 'nuclear', 燃煤: 'coal', 燃氣: 'gas', 燃油: 'oil', 輕油: 'oil', 水力: 'hydro', 抽蓄發電: 'storage', 風力: 'wind', 太陽能: 'solar', 汽電共生: 'cogen', 儲能: 'storage' };
const dayOf = (start, i) => new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10);

export function PlantHistory({ id, fuel }) {
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(null);
  useEffect(() => { let alive = true; load().then((d) => alive && setData(d)); return () => { alive = false; }; }, []);
  useEffect(() => setPick(null), [id]);

  const h = data?.plants?.[id];
  if (!h) return null;
  const total = h.e.reduce((a, v) => a + v, 0);
  const fuels = Object.entries(h.f || {}).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
  const color = rgb(FUELS[FUEL_KEY[fuels[0]?.[0]] || fuel]?.color || [110, 240, 190], 0.85); // 用資料裡最多的燃料上色
  const head = (
    <div className="hl-k">{tx('過去發電量', 'Past generation')}<small className="muted">　{data.start.slice(5).replace('-', '/')}–{data.end.slice(5).replace('-', '/')}{tx('・台電自有機組', ' · Taipower-owned units')}</small></div>
  );
  if (total < 1) {
    return <div className="life-sec plant-hist">{head}<p className="fine">{tx('這段期間沒有發電。', 'No generation in this period.')}</p></div>;
  }
  const nuke = NUCLEAR_IDS.includes(id);
  const nukeIdle = nuke && !(h.f?.['核能'] >= 1); // 核能電廠：停機期間只剩廠內燃油氣渦輪機、太陽能
  // 例如麥寮（台塑燃煤）、澎湖尖山／金門塔山（柴油）：資料裡只有台電在附近的風力、太陽能 → 一定要講清楚
  const mainMissing = !nuke && fuel && FUELS[fuel] && fuels.length > 0 && !fuels.some(([k]) => FUEL_KEY[k] === fuel);
  const mixLine = fuels.length > 1 || nuke || mainMissing ? fuels.map(([k, v]) => `${tx(k, FUEL_EN[k] || k)} ${gwh(v)}`).join(tx('・', ' · ')) : '';
  const max = Math.max(...h.e, 1);
  const bw = W / h.e.length;
  const sel = pick ?? h.e.reduce((b, v, i) => (v > h.e[b] ? i : b), 0); // 預設停在發電最多的那天
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    setPick(Math.max(0, Math.min(h.e.length - 1, Math.floor(((e.clientX - box.left) / box.width) * h.e.length))));
  };
  // 每月 1 日的刻度
  const months = h.e.map((_, i) => dayOf(data.start, i)).map((d, i) => (d.endsWith('-01') ? { i, m: +d.slice(5, 7) } : null)).filter(Boolean);

  return (
    <div className="life-sec plant-hist">
      {head}
      <svg className="ph-chart" viewBox={`0 0 ${W} ${H + 14}`} onPointerMove={onMove} onPointerDown={onMove} role="img"
        aria-label={tx(`${h.e.length} 天合計 ${gwh(total)}`, `${h.e.length}-day total ${gwh(total)}`)}>
        {h.e.map((v, i) => {
          const bh = (v / max) * H;
          return <rect key={i} x={i * bw + 0.3} y={H - bh} width={Math.max(0.6, bw - 0.6)} height={bh} fill={color} opacity={i === sel ? 1 : 0.55} />;
        })}
        <line x1={(sel + 0.5) * bw} x2={(sel + 0.5) * bw} y1="0" y2={H} className="fs-cursor" />
        {months.map(({ i, m }) => (
          <text key={i} x={i * bw} y={H + 11} className="fs-ax">{tx(`${m} 月`, ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m])}</text>
        ))}
      </svg>
      <p className="fs-read">
        <span className="nw">{dayOf(data.start, sel).slice(5).replace('-', '/')}</span>{'　'}
        <span className="nw">{tx('發電', 'Output')} <b>{gwh(h.e[sel])}</b></span>{'　'}
        <span className="nw">{tx('最高', 'Peak')} <b>{fmtMw(h.pk[sel])}</b> MW</span>
      </p>
      {mixLine && <p className="fine">{tx('組成：', 'By fuel: ')}{mixLine}{nukeIdle ? tx('。核能機組這段期間沒有發電，圖中是廠內其他機組。', '. The nuclear units did not run in this period; the chart shows the other units on site.') : ''}{mainMissing ? tx(`。這座電廠的${FUELS[fuel].label}機組不在這份資料裡，圖中只有台電在附近的機組。`, `. This plant’s ${FUELS[fuel].en.toLowerCase()} units are not in this dataset; the chart shows only nearby Taipower units.`) : ''}</p>}
      <p className="fine">
        {tx(`${h.e.length} 天合計 ${gwh(total)}，平均每天 ${gwh(total / h.e.length)}。`, `${h.e.length}-day total ${gwh(total)}, ${gwh(total / h.e.length)} a day on average.`)}
        {tx(`資料含台電自有 ${h.units.length} 個機組或場站；民營電廠、購電的再生能源與之後才加入的機組不在這份資料裡。`, ` Covers ${h.units.length} Taipower-owned units or sites; private plants, purchased renewables and units added later are not included.`)}
        {' '}<a href={data.url} target="_blank" rel="noreferrer">{tx('台電：各機組過去發電量', 'Taipower: past generation by unit')}</a>
      </p>
    </div>
  );
}
