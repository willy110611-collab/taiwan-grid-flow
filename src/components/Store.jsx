import { useMemo, useRef, useState } from 'react';
import { Panel } from './Panels.jsx';
import { parseMeterCsv, aggregate, summarize, loadStore, saveStore, sampleCsv, periodOf, PLAN_NAMES, RATES } from '../data/store.js';

/**
 * 店家用電分析
 *  匯入台電智慧電表（AMI）每 15 分鐘用電 CSV → 每月尖峰／離峰圖表、三種電價試算、離峰省電試算
 *  資料只存在這台裝置
 */
const COLOR = { peak: '#d95926', half: '#3987e5', off: '#199e70' }; // 已用 dataviz 驗證器檢查（深色底、色盲可分）
const LABEL = { peak: '尖峰', half: '半尖峰', off: '離峰' };
const money = (n) => `${Math.round(n).toLocaleString()}`;
const ym = (k) => `${Number(k.slice(5))}月`;

export function StorePanel({ onClose }) {
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
      setErr(`讀不懂這個檔案：${e.message}。請確認是台電智慧電表的用電明細（CSV），有「時間」與「度數」欄位。`);
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
        <p>匯入智慧電表的用電明細，就能看到：</p>
        <ul className="reasons">
          <li>每個月尖峰、離峰各用了多少度</li>
          <li>一般營業電價 vs 時間電價（二段式、三段式）哪個便宜、一年差多少</li>
          <li>一天之中哪些時段最花錢；把工作移到離峰能再省多少</li>
        </ul>
        <div className="store-btns">
          <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? '讀取中…' : '匯入電表 CSV'}</button>
          <button onClick={() => importText(sampleCsv(), 'sample')}>用範例資料看看</button>
        </div>
        {err && <p className="fine warm">{err}</p>}
        <div className="life-sec">
          <div className="hl-k">怎麼拿到用電明細？</div>
          <ol className="reasons">
            <li>店家要已經換裝台電「智慧電表（AMI）」（帳單上有「智慧電表」字樣，或問台電 1911）。</li>
            <li>用店家的電號登入「台灣電力」App 或台電網站的會員服務，到用電資訊／智慧電表用電查詢。</li>
            <li>選期間（建議一年），下載每 15 分鐘用電的 CSV 檔，再回到這裡匯入。</li>
          </ol>
          <p className="fine">支援「時間、度數」直式表，或「一天一列、96 個時段」橫式表；民國年、累計讀數也能自動判斷。資料只存在這台裝置，不會上傳。</p>
        </div>
      </Panel>
    );
  }
  return <StoreReport store={store} setName={setName} onReimport={() => fileRef.current?.click()} onSample={() => importText(sampleCsv(), 'sample')} clear={clear} err={err} picker={picker} onClose={onClose} />;
}

function StoreReport({ store, setName, onReimport, onSample, clear, err, picker, onClose }) {
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
      <input className="loc-search store-name" value={store.name || ''} onChange={(e) => setName(e.target.value)} placeholder="店名（選填）" />
      <p className="fine">
        {store.source === 'sample' ? <b className="warm">範例資料（虛構的小吃店）</b> : store.source}
        　{first && `${first.replace('-', '/')} – ${last.replace('-', '/')}`}　共 {s.rows.length} 個月{s.onlyPartial ? '（都不是完整月份，金額僅供參考）' : s.rows.length > s.months ? `，完整 ${s.months} 個月列入比較` : ''}
      </p>

      {/* 1. 結論 */}
      <section className="life-sec">
        <div className="hl-k">建議電價</div>
        <div className="store-best">
          <b>{PLAN_NAMES[s.best]}</b>
          {s.best === 'biz'
            ? <p>維持一般營業電價最划算；改時間電價每月反而多約 {money((s.totals[bestTou] - s.totals.biz) / (s.months || 1))} 元。</p>
            : <p>比一般營業電價每月約省 <b className="green">{money(per)}</b> 元，{s.months} 個月共省 <b className="green">{money(save)}</b> 元。</p>}
        </div>
        <ul className="plan-bars">
          {['biz', 'two', 'three'].map((k) => {
            const max = Math.max(s.totals.biz, s.totals.two, s.totals.three) || 1;
            return (
              <li key={k} className={k === s.best ? 'best' : ''}>
                <span>{PLAN_NAMES[k].replace('簡易型時間電價', '時間電價')}</span>
                <i style={{ width: `${(s.totals[k] / max) * 100}%` }} />
                <b>{money(s.totals[k] / (s.months || 1))} <small>元/月</small></b>
              </li>
            );
          })}
        </ul>
        <p className="fine">尖峰用電佔 {Math.round(s.peakShare2 * 100)}%（二段式）；三段式的尖峰＋半尖峰佔 {Math.round(s.peakShare3 * 100)}%。</p>
      </section>

      {/* 2. 離峰省電 */}
      <section className="life-sec">
        <div className="hl-k">把工作移到離峰，可以再省多少？</div>
        <label className="bill-range">移到離峰的尖峰用電 <b>{shift}%</b>
          <input type="range" min="0" max="60" step="5" value={shift} onChange={(e) => setShift(Number(e.target.value))} />
        </label>
        <p>
          用{PLAN_NAMES[bestTou].replace('簡易型', '')}，再省 <b className="green">{money(extra / (s.months || 1))}</b> 元/月
          （{s.months} 個月 {money(extra)} 元）。
        </p>
        <p className="fine">例如：備料、洗碗機、製冰、熱水、電動車或機車充電改在平日早上 9 點前（夏月）／6 點前與 11–14 點（非夏月），或週末做。冷藏與營業照明通常移不動。</p>
      </section>

      {/* 3. 每月尖離峰 */}
      <section className="life-sec">
        <div className="chart-head">
          <div className="hl-k">每月用電（度）</div>
          <div className="seg">
            {['two', 'three'].map((k) => <button key={k} className={plan === k ? 'on' : ''} onClick={() => setPlan(k)}>{k === 'two' ? '二段式' : '三段式'}</button>)}
            <button className={table ? 'on' : ''} onClick={() => setTable(!table)}>表格</button>
          </div>
        </div>
        {table ? <MonthTable rows={s.rows} plan={plan} /> : <MonthChart rows={s.rows} plan={plan} />}
      </section>

      {/* 4. 一天的用電 */}
      <section className="life-sec">
        <DayProfile rows={s.rows} plan={plan} />
      </section>

      <div className="store-btns">
        <button onClick={onReimport}>匯入新的 CSV</button>
        {store.source !== 'sample' && <button onClick={onSample}>看範例</button>}
        <button onClick={clear}>清除資料</button>
      </div>
      {err && <p className="fine warm">{err}</p>}
      <p className="fine">
        電價：台電表燈電價（{RATES.version} 起）。營業用一般電價依每月度數累進；時間電價基本費每戶每月 {RATES.two.base} 元、每月超過 2,000 度每度加 {RATES.over2000} 元。
        週六日與國定假日全日離峰。以日曆月計算，未含各種折扣、契約容量與功率因數調整；
        用電量大或有契約容量的店家可能適用「低壓電力」電價，申請前請以台電試算為準。
      </p>
    </Panel>
  );
}

/* ───────── 每月堆疊長條（離峰在下、尖峰在上），點／滑可看明細 ───────── */
function MonthChart({ rows, plan }) {
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
            <b>{r.key.replace('-', '/')}{r.summer ? '（夏月）' : ''}{!r.full ? `　＊只有 ${r.days} 天` : ''}</b>
            <span>{keys.slice().reverse().map((k) => `${LABEL[k]} ${short(r[plan][k])} 度`).join('　')}　共 {short(r.kwh)} 度</span>
            <span>營業用 {money(r.bill0.biz)} 元　二段式 {money(r.bill0.two)} 元　三段式 {money(r.bill0.three)} 元</span>
          </>
        ) : <span className="muted">點一下長條看每月明細與電費（＊＝不完整月份）</span>}
      </div>
    </div>
  );
}

function MonthTable({ rows, plan }) {
  const keys = plan === 'two' ? ['peak', 'off'] : ['peak', 'half', 'off'];
  return (
    <div className="store-table">
      <table>
        <thead><tr><th>月份</th>{keys.map((k) => <th key={k}>{LABEL[k]}</th>)}<th>合計</th><th>營業用</th><th>二段式</th><th>三段式</th></tr></thead>
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
      <p className="fine">單位：度、元。＊不完整月份。</p>
    </div>
  );
}

/* ───────── 平日一天 24 小時的平均用電，依時段上色 ───────── */
function DayProfile({ rows, plan }) {
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
        <div className="hl-k">平日一天怎麼用電（每小時平均度數）</div>
        {hasSummer && hasOther && (
          <div className="seg">
            <button className={season === 'summer' ? 'on' : ''} onClick={() => setSeason('summer')}>夏月</button>
            <button className={season === 'other' ? 'on' : ''} onClick={() => setSeason('other')}>非夏月</button>
          </div>
        )}
      </div>
      <div className="chart">
        <ul className="legend-row">
          {(plan === 'two' ? ['peak', 'off'] : ['peak', 'half', 'off']).map((k) => <li key={k}><i style={{ background: COLOR[k] }} />{LABEL[k]}</li>)}
          <li><i className="line" />週末／假日</li>
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
            ? <><b>{String(hi).padStart(2, '0')}:00–{String(hi + 1).padStart(2, '0')}:00　{LABEL[perW(hi)]}</b><span>平日平均 {prof[hi].toFixed(2)} 度　週末／假日 {we[hi].toFixed(2)} 度</span></>
            : <span>平日每天：{Object.entries(sum).filter(([, v]) => v > 0).map(([k, v]) => `${LABEL[k]} ${v.toFixed(0)} 度`).join('　')}</span>}
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
