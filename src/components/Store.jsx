import { useMemo, useRef, useState } from 'react';
import { Panel } from './Panels.jsx';
import { parseMeterCsv, aggregate, summarize, loadStore, saveStore, sampleCsv, periodOf, PLAN_NAMES, RATES } from '../data/store.js';
import { tx, useT } from '../i18n.js';

/**
 * 店家用電分析
 *  匯入台電智慧電表（AMI）每 15 分鐘用電 CSV → 每月尖峰／離峰圖表、三種電價試算、離峰省電試算
 *  資料只存在這台裝置
 */
const COLOR = { peak: '#d95926', half: '#3987e5', off: '#199e70' }; // 已用 dataviz 驗證器檢查（深色底、色盲可分）
const LABEL_ZH = { peak: '尖峰', half: '半尖峰', off: '離峰' };
const LABEL_EN = { peak: 'Peak', half: 'Mid-peak', off: 'Off-peak' };
const LABEL = new Proxy({}, { get: (_, k) => tx(LABEL_ZH[k], LABEL_EN[k]) });
const PLAN_EN = { biz: 'Commercial standard (tiered)', two: 'Simple TOU (2-period)', three: 'Simple TOU (3-period)' };
const PN = (k) => tx(PLAN_NAMES[k], PLAN_EN[k]);
const PN_SHORT = (k) => tx(PLAN_NAMES[k].replace('簡易型時間電價', '時間電價'), PLAN_EN[k].replace('Simple ', ''));
const KWH = () => tx('度', 'kWh');
const NT = () => tx('元', 'NT$');
const money = (n) => `${Math.round(n).toLocaleString()}`;
const ym = (k) => `${Number(k.slice(5))}月`;

export function StorePanel({ onClose }) {
  useT();
  const [store, setStore] = useState(loadStore);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const importText = (text, source) => {
    try {
      const parsed = parseMeterCsv(text);
      const months = aggregate(parsed);
      const keep = source === 'sample' ? {} : (store?.source === 'sample' ? {} : store?.months || {});
      const next = { name: store?.source === 'sample' ? '' : store?.name || '', source, interval: parsed.interval, months: { ...keep, ...months }, at: Date.now() };
      saveStore(next);
      setStore(next);
      setErr('');
    } catch (e) {
      setErr(tx(`讀不懂這個檔案：${e.message}。請確認是台電智慧電表的用電明細（CSV），有「時間」與「度數」欄位。`, `Could not read this file (${e.message}). Make sure it is a Taipower smart-meter usage CSV with time and kWh columns.`));
    }
  };
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const rd = new FileReader();
    rd.onload = () => {
      let text = rd.result;
      // 台電舊系統可能是 Big5：UTF-8 解出亂碼就改用 Big5
      if (/�/.test(text)) {
        const r2 = new FileReader();
        r2.onload = () => { importText(r2.result, f.name); setBusy(false); };
        r2.readAsText(f, 'big5');
        return;
      }
      importText(text, f.name);
      setBusy(false);
    };
    rd.readAsText(f, 'utf-8');
    e.target.value = '';
  };
  const setName = (name) => { const n = { ...store, name }; saveStore(n); setStore(n); };
  const clear = () => { saveStore(null); setStore(null); };

  const picker = (
    <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: 'none' }} onChange={onFile} />
  );

  if (!store?.months || !Object.keys(store.months).length) {
    return (
      <Panel title="店家用電" onClose={onClose}>
        {picker}
        <p>{tx('匯入智慧電表的用電明細，就能看到：', 'Import your smart-meter usage to see:')}</p>
        <ul className="reasons">
          <li>{tx('每個月尖峰、離峰各用了多少度', 'How many kWh you use at peak and off-peak each month')}</li>
          <li>{tx('一般營業電價 vs 時間電價（二段式、三段式）哪個便宜、一年差多少', 'Whether the standard commercial tariff or time-of-use (2- or 3-period) is cheaper, and by how much per year')}</li>
          <li>{tx('一天之中哪些時段最花錢；把工作移到離峰能再省多少', 'Which hours cost the most, and how much more you save by moving work off-peak')}</li>
        </ul>
        <div className="store-btns">
          <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? tx('讀取中…', 'Loading…') : tx('匯入電表 CSV', 'Import meter CSV')}</button>
          <button onClick={() => importText(sampleCsv(), 'sample')}>{tx('用範例資料看看', 'Try sample data')}</button>
        </div>
        {err && <p className="fine warm">{err}</p>}
        <div className="life-sec">
          <div className="hl-k">{tx('怎麼拿到用電明細？', 'How do I get the usage data?')}</div>
          <ol className="reasons">
            <li>{tx('店家要已經換裝台電「智慧電表（AMI）」（帳單上有「智慧電表」字樣，或問台電 1911）。', 'The shop needs a Taipower smart meter (AMI) — the bill says 「智慧電表」, or ask Taipower at 1911.')}</li>
            <li>{tx('用店家的電號登入「台灣電力」App 或台電網站的會員服務，到用電資訊／智慧電表用電查詢。', 'Sign in to the Taipower app or website with the shop’s account number and open the smart-meter usage page.')}</li>
            <li>{tx('選期間（建議一年），下載每 15 分鐘用電的 CSV 檔，再回到這裡匯入。', 'Pick a period (a year is best), download the 15-minute usage CSV, then import it here.')}</li>
          </ol>
          <p className="fine">{tx('支援「時間、度數」直式表，或「一天一列、96 個時段」橫式表；民國年、累計讀數也能自動判斷。資料只存在這台裝置，不會上傳。', 'Supports “time, kWh” rows or “one row per day, 96 intervals”; ROC years and cumulative readings are detected automatically. Data stays on this device and is never uploaded.')}</p>
        </div>
      </Panel>
    );
  }
  return <StoreReport store={store} setName={setName} onReimport={() => fileRef.current?.click()} onSample={() => importText(sampleCsv(), 'sample')} clear={clear} err={err} picker={picker} onClose={onClose} />;
}

function StoreReport({ store, setName, onReimport, onSample, clear, err, picker, onClose }) {
  useT();
  const [shift, setShift] = useState(20);
  const [plan, setPlan] = useState('two');
  const [table, setTable] = useState(false);
  const s = useMemo(() => summarize(store.months, shift / 100), [store.months, shift]);
  const bestTou = s.totals.two <= s.totals.three ? 'two' : 'three';
  const save = s.totals.biz - s.totals[s.best];
  const per = s.months ? save / s.months : 0;
  const extra = s.totals[bestTou] - s.shifted[bestTou];
  const first = s.rows[0]?.key, last = s.rows[s.rows.length - 1]?.key;

  return (
    <Panel title="店家用電" onClose={onClose}>
      {picker}
      <input className="loc-search store-name" value={store.name || ''} onChange={(e) => setName(e.target.value)} placeholder={tx('店名（選填）', 'Shop name (optional)')} />
      <p className="fine">
        {store.source === 'sample' ? <b className="warm">{tx('範例資料（虛構的小吃店）', 'Sample data (a fictional eatery)')}</b> : store.source}
        　{first && `${first.replace('-', '/')} – ${last.replace('-', '/')}`}　{tx(`共 ${s.rows.length} 個月`, `${s.rows.length} months`)}{s.onlyPartial ? tx('（都不是完整月份，金額僅供參考）', ' (no complete months — amounts are indicative only)') : s.rows.length > s.months ? tx(`，完整 ${s.months} 個月列入比較`, `, ${s.months} complete months compared`) : ''}
      </p>

      {/* 1. 結論 */}
      <section className="life-sec">
        <div className="hl-k">{tx('建議電價', 'Recommended tariff')}</div>
        <div className="store-best">
          <b>{PN(s.best)}</b>
          {s.best === 'biz'
            ? <p>{tx(`維持一般營業電價最划算；改時間電價每月反而多約 ${money((s.totals[bestTou] - s.totals.biz) / (s.months || 1))} 元。`, `The standard commercial tariff is cheapest; time-of-use would cost about NT$${money((s.totals[bestTou] - s.totals.biz) / (s.months || 1))} more a month.`)}</p>
            : <p>{tx('比一般營業電價每月約省 ', 'Saves about NT$')}<b className="green">{money(per)}</b>{tx(` 元，${s.months} 個月共省 `, ` a month vs the standard tariff — NT$`)}<b className="green">{money(save)}</b>{tx(' 元。', ` over ${s.months} months.`)}</p>}
        </div>
        <ul className="plan-bars">
          {['biz', 'two', 'three'].map((k) => {
            const max = Math.max(s.totals.biz, s.totals.two, s.totals.three) || 1;
            return (
              <li key={k} className={k === s.best ? 'best' : ''}>
                <span>{PN_SHORT(k)}</span>
                <i style={{ width: `${(s.totals[k] / max) * 100}%` }} />
                <b>{money(s.totals[k] / (s.months || 1))} <small>{tx('元/月', 'NT$/mo')}</small></b>
              </li>
            );
          })}
        </ul>
        <p className="fine">{tx(`尖峰用電佔 ${Math.round(s.peakShare2 * 100)}%（二段式）；三段式的尖峰＋半尖峰佔 ${Math.round(s.peakShare3 * 100)}%。`, `Peak use is ${Math.round(s.peakShare2 * 100)}% (2-period); peak + mid-peak under 3-period is ${Math.round(s.peakShare3 * 100)}%.`)}</p>
      </section>

      {/* 2. 離峰省電 */}
      <section className="life-sec">
        <div className="hl-k">{tx('把工作移到離峰，可以再省多少？', 'How much more if you shift work off-peak?')}</div>
        <label className="bill-range">{tx('移到離峰的尖峰用電', 'Peak use moved off-peak')} <b>{shift}%</b>
          <input type="range" min="0" max="60" step="5" value={shift} onChange={(e) => setShift(Number(e.target.value))} />
        </label>
        <p>
          {tx(`用${PLAN_NAMES[bestTou].replace('簡易型', '')}，再省 `, `With ${PLAN_EN[bestTou].replace('Simple ', '')}, save another NT$`)}<b className="green">{money(extra / (s.months || 1))}</b>{tx(' 元/月', '/month')}
          {tx(`（${s.months} 個月 ${money(extra)} 元）。`, ` (NT$${money(extra)} over ${s.months} months).`)}
        </p>
        <p className="fine">{tx('例如：備料、洗碗機、製冰、熱水、電動車或機車充電改在平日早上 9 點前（夏月）／6 點前與 11–14 點（非夏月），或週末做。冷藏與營業照明通常移不動。', 'For example, do prep, dishwashing, ice-making, water heating or EV/scooter charging before 9 am on weekdays (summer) / before 6 am or 11–14 (other months), or at weekends. Refrigeration and shop lighting usually can’t move.')}</p>
      </section>

      {/* 3. 每月尖離峰 */}
      <section className="life-sec">
        <div className="chart-head">
          <div className="hl-k">{tx('每月用電（度）', 'Monthly use (kWh)')}</div>
          <div className="seg">
            {['two', 'three'].map((k) => <button key={k} className={plan === k ? 'on' : ''} onClick={() => setPlan(k)}>{k === 'two' ? tx('二段式', '2-period') : tx('三段式', '3-period')}</button>)}
            <button className={table ? 'on' : ''} onClick={() => setTable(!table)}>{tx('表格', 'Table')}</button>
          </div>
        </div>
        {table ? <MonthTable rows={s.rows} plan={plan} /> : <MonthChart rows={s.rows} plan={plan} />}
      </section>

      {/* 4. 一天的用電 */}
      <section className="life-sec">
        <DayProfile rows={s.rows} plan={plan} />
      </section>

      <div className="store-btns">
        <button onClick={onReimport}>{tx('匯入新的 CSV', 'Import new CSV')}</button>
        {store.source !== 'sample' && <button onClick={onSample}>{tx('看範例', 'Sample')}</button>}
        <button onClick={clear}>{tx('清除資料', 'Clear data')}</button>
      </div>
      {err && <p className="fine warm">{err}</p>}
      <p className="fine">
        {tx(`電價：台電表燈電價（${RATES.version} 起，已對照台電官方電價表）。營業用一般電價依每月度數累進；時間電價基本費每戶每月 ${RATES.two.base} 元、每月超過 2,000 度每度加 ${RATES.over2000} 元。週六日與國定假日全日離峰。以日曆月計算，未含各種折扣、契約容量與功率因數調整；用電量大或有契約容量的店家可能適用「低壓電力」電價，申請前請以台電試算為準。`,
          `Tariffs: Taipower lighting (commercial) rates from ${RATES.version} (ROC calendar), checked against Taipower’s official table. The standard commercial rate is tiered by monthly kWh; time-of-use has a NT$${RATES.two.base}/month customer charge and +NT$${RATES.over2000}/kWh above 2,000 kWh a month. Weekends and national holidays are off-peak all day. Calculated by calendar month, excluding discounts, contract capacity and power-factor adjustments. Large users or shops with contract capacity may be on the low-voltage power tariff — check Taipower’s calculator before applying.`)}
      </p>
    </Panel>
  );
}

/* ───────── 每月堆疊長條（離峰在下、尖峰在上），點／滑可看明細 ───────── */
function MonthChart({ rows, plan }) {
  useT();
  const [hi, setHi] = useState(null);
  const keys = plan === 'two' ? ['off', 'peak'] : ['off', 'half', 'peak'];
  const W = 340, H = 170, L = 34, B = 20, T = 8;
  const max = Math.max(...rows.map((r) => r.kwh), 1);
  const nice = niceMax(max);
  const bw = Math.min(22, (W - L - 4) / rows.length - 4);
  const x = (i) => L + 2 + i * ((W - L - 4) / rows.length) + ((W - L - 4) / rows.length - bw) / 2;
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  const r = hi != null ? rows[hi] : null;
  return (
    <div className="chart">
      <ul className="legend-row">
        {keys.slice().reverse().map((k) => <li key={k}><i style={{ background: COLOR[k] }} />{LABEL[k]}</li>)}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHi(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W} y1={y(nice * f)} y2={y(nice * f)} className="grid" />
            <text x={L - 4} y={y(nice * f) + 3} className="axis" textAnchor="end">{short(nice * f)}</text>
          </g>
        ))}
        {rows.map((row, i) => {
          let acc = 0;
          const segs = keys.map((k) => {
            const v = row[plan][k];
            const y0 = y(acc), y1 = y(acc + v);
            acc += v;
            return { k, y: y1, h: Math.max(0, y0 - y1 - (v > 0 ? 1.5 : 0)) };
          });
          return (
            <g key={row.key} className={hi === i ? 'hi' : hi != null ? 'dim' : ''} onMouseEnter={() => setHi(i)} onClick={() => setHi(hi === i ? null : i)}>
              <rect x={x(i) - 3} y={T} width={bw + 6} height={H - T - B} fill="transparent" />
              {segs.map((g, j) => (
                <rect key={g.k} x={x(i)} y={g.y} width={bw} height={g.h} rx={j === segs.length - 1 ? 3 : 0} fill={COLOR[g.k]} />
              ))}
              {!row.full && <text x={x(i) + bw / 2} y={y(row.kwh) - 3} className="axis" textAnchor="middle">*</text>}
              <text x={x(i) + bw / 2} y={H - 6} className="axis" textAnchor="middle">{Number(row.key.slice(5))}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-tip">
        {r ? (
          <>
            <b>{r.key.replace('-', '/')}{r.summer ? tx('（夏月）', ' (summer)') : ''}{!r.full ? tx(`　＊只有 ${r.days} 天`, `　* only ${r.days} days`) : ''}</b>
            <span>{keys.slice().reverse().map((k) => `${LABEL[k]} ${short(r[plan][k])} ${KWH()}`).join('　')}　{tx('共', 'Total')} {short(r.kwh)} {KWH()}</span>
            <span>{tx('營業用', 'Standard')} {money(r.bill0.biz)} {NT()}　{tx('二段式', '2-period')} {money(r.bill0.two)} {NT()}　{tx('三段式', '3-period')} {money(r.bill0.three)} {NT()}</span>
          </>
        ) : <span className="muted">{tx('點一下長條看每月明細與電費（＊＝不完整月份）', 'Tap a bar for monthly detail and cost (* = incomplete month)')}</span>}
      </div>
    </div>
  );
}

function MonthTable({ rows, plan }) {
  useT();
  const keys = plan === 'two' ? ['peak', 'off'] : ['peak', 'half', 'off'];
  return (
    <div className="store-table">
      <table>
        <thead><tr><th>{tx('月份', 'Month')}</th>{keys.map((k) => <th key={k}>{LABEL[k]}</th>)}<th>{tx('合計', 'Total')}</th><th>{tx('營業用', 'Standard')}</th><th>{tx('二段式', '2-period')}</th><th>{tx('三段式', '3-period')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key.replace('-', '/')}{r.full ? '' : '＊'}</td>
              {keys.map((k) => <td key={k}>{short(r[plan][k])}</td>)}
              <td>{short(r.kwh)}</td><td>{money(r.bill0.biz)}</td><td>{money(r.bill0.two)}</td><td>{money(r.bill0.three)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">{tx('單位：度、元。＊不完整月份。', 'Units: kWh, NT$. * incomplete month.')}</p>
    </div>
  );
}

/* ───────── 平日一天 24 小時的平均用電，依時段上色 ───────── */
function DayProfile({ rows, plan }) {
  useT();
  const hasSummer = rows.some((r) => r.summer), hasOther = rows.some((r) => !r.summer);
  const [season, setSeason] = useState(hasSummer ? 'summer' : 'other');
  const [hi, setHi] = useState(null);
  const sel = rows.filter((r) => (season === 'summer') === r.summer);
  const days = sel.reduce((a, r) => a + r.wkDays, 0) || 1;
  const prof = Array.from({ length: 24 }, (_, h) => sel.reduce((a, r) => a + r.wk[h], 0) / days);
  const wDays = sel.reduce((a, r) => a + r.weDays, 0) || 1;
  const we = Array.from({ length: 24 }, (_, h) => sel.reduce((a, r) => a + r.we[h], 0) / wDays);
  // 取一個平日（2026/7/1、11/4 都是週三）來判斷每個小時屬於哪個時段
  const perW = (h) => (season === 'summer' ? periodOf(2026, 7, 1, h) : periodOf(2026, 11, 4, h))[plan];
  const W = 340, H = 150, L = 30, B = 20, T = 8;
  const nice = niceMax(Math.max(...prof, ...we, 0.1));
  const bw = (W - L - 4) / 24;
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  const sum = { peak: 0, half: 0, off: 0 };
  prof.forEach((v, h) => { sum[perW(h)] += v; });
  return (
    <>
      <div className="chart-head">
        <div className="hl-k">{tx('平日一天怎麼用電（每小時平均度數）', 'A typical weekday (average kWh per hour)')}</div>
        {hasSummer && hasOther && (
          <div className="seg">
            <button className={season === 'summer' ? 'on' : ''} onClick={() => setSeason('summer')}>{tx('夏月', 'Summer')}</button>
            <button className={season === 'other' ? 'on' : ''} onClick={() => setSeason('other')}>{tx('非夏月', 'Other months')}</button>
          </div>
        )}
      </div>
      <div className="chart">
        <ul className="legend-row">
          {(plan === 'two' ? ['peak', 'off'] : ['peak', 'half', 'off']).map((k) => <li key={k}><i style={{ background: COLOR[k] }} />{LABEL[k]}</li>)}
          <li><i className="line" />{tx('週末／假日', 'Weekend / holiday')}</li>
        </ul>
        <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHi(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W} y1={y(nice * f)} y2={y(nice * f)} className="grid" />
              <text x={L - 4} y={y(nice * f) + 3} className="axis" textAnchor="end">{short(nice * f, 1)}</text>
            </g>
          ))}
          {prof.map((v, h) => (
            <g key={h} className={hi === h ? 'hi' : hi != null ? 'dim' : ''} onMouseEnter={() => setHi(h)} onClick={() => setHi(hi === h ? null : h)}>
              <rect x={L + 2 + h * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              <rect x={L + 2 + h * bw + 1} y={y(v)} width={Math.max(1, bw - 2)} height={Math.max(0, y(0) - y(v))} rx="2" fill={COLOR[perW(h)]} />
              {h % 3 === 0 && <text x={L + 2 + h * bw + bw / 2} y={H - 6} className="axis" textAnchor="middle">{h}</text>}
            </g>
          ))}
          <polyline className="we-line" fill="none" points={we.map((v, h) => `${L + 2 + h * bw + bw / 2},${y(v)}`).join(' ')} />
        </svg>
        <div className="chart-tip">
          {hi != null
            ? <><b>{String(hi).padStart(2, '0')}:00–{String(hi + 1).padStart(2, '0')}:00　{LABEL[perW(hi)]}</b><span>{tx('平日平均', 'Weekday avg')} {prof[hi].toFixed(2)} {KWH()}　{tx('週末／假日', 'Weekend/holiday')} {we[hi].toFixed(2)} {KWH()}</span></>
            : <span>{tx('平日每天：', 'Per weekday: ')}{Object.entries(sum).filter(([, v]) => v > 0).map(([k, v]) => `${LABEL[k]} ${v.toFixed(0)} ${KWH()}`).join('　')}</span>}
        </div>
      </div>
    </>
  );
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) || v;
}
function short(v, d = 0) {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(d);
}
