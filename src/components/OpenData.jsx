import { useEffect, useMemo, useState } from 'react';
import { APP } from '../config/app.js';
import { Panel } from './Panels.jsx';
import { Sparkline, fmtMw, Icon } from './widgets.jsx';
import { t, tx, tr, isEn, useT } from '../i18n.js';
import { billCompare } from '../data/advice.js';
import { loadStore } from '../data/store.js';
import { enablePush, disablePush } from '../data/useHome.js';
import {
  useSiteJson, homeTown, twToday, addDays, daysUntil, weekday, outageHits, norm,
  typhoonActive, typhoonCounty, pushExtra, countyName, placeName, APPLIANCES, HANDBOOK
} from '../data/openData.js';

const n0 = (v) => Math.round(v).toLocaleString();
const md = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
// 資料集名稱（建置時寫進 JSON 的是中文原名）→ 英文介面用的說明，以 data.gov.tw 編號對應
const SRC_EN = {
  26144: 'Taipower planned work outages',
  29936: 'Taipower renewable purchases by county',
  19995: 'Taipower historical supply & demand',
  14135: 'Taipower household electricity use by township',
};
const srcName = (data) => (isEn() && SRC_EN[data?.sourceUrl?.match(/dataset\/(\d+)/)?.[1]]) || data?.source;
const Src = ({ data, extra }) => (
  <p className="fine src-line">
    {tx('資料：', 'Source: ')}{data?.sourceUrl ? <a href={data.sourceUrl} target="_blank" rel="noreferrer">{srcName(data)}</a> : data?.source || '—'}
    {extra ? <>{tx('。', '. ')}{extra}</> : null}
  </p>
);
const Loading = ({ error }) => (
  <p className="fine">{error ? tx('這份資料暫時讀不到，稍後會自動恢復。', 'This data is temporarily unavailable; it will come back automatically.') : t('資料讀取中…')}</p>
);
const whenText = (d) => (d === 0 ? tx('今天', 'Today') : d === 1 ? tx('明天', 'Tomorrow') : d === 2 ? tx('後天', 'In 2 days') : tx(`${d} 天後`, `In ${d} days`));
const roadsText = (g, max = 6) => (g.roads.length ? g.roads.slice(0, max).join('、') + (g.roads.length > max ? tx(` 等 ${g.roads.length} 處`, ` and ${g.roads.length - max} more`) : '') : tx('（全區或未列路段）', '(area-wide or roads not listed)'));

/* ═════════ D1 計畫性停電（我的家）═════════ */
export function OutageSection({ home, setHome, line, onMarks }) {
  useT();
  const place = homeTown(home);
  const { data, error } = useSiteJson('outages.json');
  const [range, setRange] = useState('week');
  const [near, setNear] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const today = twToday();
  const list = useMemo(() => (data?.list || []).filter((g) => g.date >= today), [data, today]);
  const mine = useMemo(() => outageHits(list, place, home.outRoad), [list, place?.key, home.outRoad]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const end = range === 'today' ? today : range === 'tomorrow' ? addDays(today, 1) : addDays(today, 7);
    const start = range === 'tomorrow' ? addDays(today, 1) : today;
    return list.filter((g) => g.date >= start && g.date <= end && (!place || (near ? g.county === place.county && (g.town === place.town || !g.town) : g.county === place.county)));
  }, [list, range, near, place?.key, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onMarks?.(shown.filter((g) => g.pos).slice(0, 300)); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onMarks?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 提醒：用 App 通知（Web Push），中繼站每天 18 時比對台電公告
  const remind = async (patch) => {
    const next = { outD3: !!home.outD3, outD1: !!home.outD1, ...patch };
    setBusy(true);
    try {
      if (next.outD3 || next.outD1) {
        if (!place) throw new Error(tx('請先設定「我的家」地點', 'Please set your Home location first'));
        await enablePush(APP.relayUrl, line?.vapidPublic, home.push ? home.pushSite : null, { test: false, extra: pushExtra({ ...home, ...next }) });
      } else if (home.push) {
        await enablePush(APP.relayUrl, line?.vapidPublic, home.pushSite, { test: false, extra: pushExtra({ ...home, ...next }) });
      } else {
        await disablePush(APP.relayUrl);
      }
      setHome({ ...next, outSig: place ? `${place.key}|${home.outRoad || ''}` : null }); setMsg('');
    } catch (e) { setMsg(tr(e.message)); }
    setBusy(false);
  };
  // 換了地點或路名 → 重新登記
  useEffect(() => {
    if (!(home.outD3 || home.outD1) || !place || !line?.vapidPublic) return;
    const sig = `${place.key}|${home.outRoad || ''}`;
    if (sig === home.outSig) return;
    const id = setTimeout(() => { // 打字時等停下來再送
      enablePush(APP.relayUrl, line.vapidPublic, home.push ? home.pushSite : null, { test: false, extra: pushExtra(home) })
        .then(() => setHome({ outSig: sig })).catch(() => {});
    }, 1500);
    return () => clearTimeout(id);
  }, [place?.key, home.outRoad, line?.vapidPublic]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = mine[0];
  const d = next ? daysUntil(next.date) : null;
  const en = isEn();
  return (
    <section className="life-sec outage">
      <div className="hl-k">{tx('計畫性停電', 'Planned outages')}　<span className="muted">{tx('台電公告，未來 7 天', 'Taipower notices, next 7 days')}</span></div>
      {!data ? <Loading error={error} /> : !place ? (
        <p className="fine">{tx('設定「我的家」地點後，會比對你家所在鄉鎮的停電公告。', 'Set your Home location to check outage notices for your township.')}</p>
      ) : next ? (
        <div className="out-card warn">
          <div className="out-top"><b>⚠ {isEn() ? `Outage ${whenText(d).toLowerCase()}` : `${whenText(d)}停電`}</b><span>{md(next.date)}（{weekday(next.date, en)}）</span></div>
          <div className="out-time">{next.from} – {next.to}{next.second ? <small>　{tx('及', 'and')} {next.second.from}–{next.second.to}</small> : null}</div>
          <p className="fine">{next.town || next.county} {roadsText(next)}{next.work ? ` · ${next.work}` : ''}</p>
          <p className="fine">{tx(`台電${next.office} · 請求號數 ${next.id} · 查詢 1911`, `Taipower ${next.office} · ref ${next.id} · call 1911`)}</p>
          {mine.length > 1 && <p className="fine warm">{tx(`另外還有 ${mine.length - 1} 筆，見下方清單。`, `${mine.length - 1} more listed below.`)}</p>}
        </div>
      ) : (
        <p className="fine green">{tx(`未來 7 天${placeName(place)}${home.outRoad ? `「${home.outRoad}」` : ''}沒有計畫性停電公告。`, `No planned outages announced for ${placeName(place)}${home.outRoad ? ` (${home.outRoad})` : ''} in the next 7 days.`)}</p>
      )}

      {data && place && (
        <>
          <input
            className="loc-search"
            type="search"
            value={home.outRoad || ''}
            onChange={(e) => setHome({ outRoad: e.target.value.trim().slice(0, 20) })}
            placeholder={tx('我家路名（選填，例如 光復路）', 'Your road (optional, in Chinese)')}
            enterKeyHint="done"
          />
          <div className="chips">
            {[['today', tx('今天', 'Today')], ['tomorrow', tx('明天', 'Tomorrow')], ['week', tx('7 天內', 'Next 7 days')]].map(([k, label]) => (
              <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{label}</button>
            ))}
            <button className={near ? 'on' : ''} onClick={() => setNear(!near)}>{near ? tx(`只看${placeName(place)}`, `${placeName(place)} only`) : tx(`整個${place.county}`, `All of ${countyName(place.county, true)}`)}</button>
          </div>
          {shown.length ? (
            <ul className="out-list">
              {shown.slice(0, 40).map((g) => (
                <li key={g.id + g.date + g.from + g.town} className={mine.includes(g) ? 'mine' : ''}>
                  <span className="out-d">{md(g.date)}<small>{weekday(g.date, en)}</small></span>
                  <span className="out-t">{g.from}–{g.to}</span>
                  <span className="out-p"><b>{g.town || g.county}</b> {roadsText(g, 4)}</span>
                </li>
              ))}
              {shown.length > 40 && <li className="fine">{tx(`還有 ${shown.length - 40} 筆`, `${shown.length - 40} more`)}</li>}
            </ul>
          ) : <p className="fine">{tx('這段期間沒有停電公告。', 'No notices for this period.')}</p>}
          <p className="fine">{tx(`地圖上的橘色圈＝這份清單的停電地點（共 ${shown.length} 筆）。`, `Orange rings on the map mark these ${shown.length} notices.`)}</p>

          <div className="hl-k" style={{ marginTop: 10 }}>{tx('提醒我', 'Remind me')}</div>
          <label className="switch"><input type="checkbox" disabled={busy} checked={!!home.outD3} onChange={(e) => remind({ outD3: e.target.checked })} /><span>{tx('前 3 天提醒', '3 days before')}</span></label>
          <label className="switch"><input type="checkbox" disabled={busy} checked={!!home.outD1} onChange={(e) => remind({ outD1: e.target.checked })} /><span>{tx('前 1 天提醒', '1 day before')}</span></label>
          {msg && <p className="fine warm">{msg}</p>}
          <p className="fine">{tx('用 App 通知，每天傍晚 6 點比對一次；只傳你家所在鄉鎮與選填的路名給本站伺服器，不含門牌。', 'Sent as app notifications, checked daily at 6 pm. Only your township and optional road name are sent to our server — never a house number.')}</p>
        </>
      )}
      {data && <Src data={data} extra={tx('路段比對可能有誤差，實際範圍以台電通知為準', 'Road matching may be imperfect; Taipower’s notice is authoritative')} />}
    </section>
  );
}

/* ═════════ D3 你家 vs 鄉鎮平均（我的家）═════════ */
export function TownCompare({ home, setHome }) {
  useT();
  const place = homeTown(home);
  const { data, error } = useSiteJson('towns-kwh.json', !!place);
  const [draft, setDraft] = useState('');
  const store = useMemo(() => {
    try {
      const s = loadStore();
      if (!s || s.source === 'sample') return null;
      const ms = Object.values(s.months || {}).filter((M) => M.kwh > 0);
      return ms.length ? Math.round(ms.reduce((a, M) => a + M.kwh, 0) / ms.length) : null;
    } catch { return null; }
  }, []);
  if (!place) return null;
  const tw = data && (data.towns[place.key] || data.towns[place.county]);
  const cty = data?.counties?.[place.county];
  const i = (data?.months?.length || 0) - 1;
  const town = tw?.avg?.[i], county = cty?.avg?.[i];
  const mine = home.billKwh > 0 ? home.billKwh : null;
  const max = Math.max(mine || 0, town || 0, county || 0, 1);
  const ym = data?.months?.[i];
  const prevYm = data?.months?.[i - 1];
  const label = ym ? tx(`${Number(prevYm?.slice(5))}–${Number(ym.slice(5))} 月`, `${prevYm?.slice(5)}–${ym.slice(5)}/${ym.slice(0, 4)}`) : '';
  const diff = mine && town ? Math.round(((mine - town) / town) * 100) : null;
  const Bar = ({ name, v, color }) => (
    <div className="cmp-row">
      <span>{name}</span>
      <i className="cmp-bar"><i style={{ width: `${(v / max) * 100}%`, background: color }} /></i>
      <b>{v != null ? n0(v) : '—'} <small>{tx('度', 'kWh')}</small></b>
    </div>
  );
  return (
    <section className="life-sec">
      <div className="hl-k">{tx(`你家 vs ${placeName(place)}住宅平均`, `You vs ${placeName(place)} homes`)}　<span className="muted">{tx('每戶每月', 'per home per month')}</span></div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="cmp">
            <Bar name={tx('你家', 'You')} v={mine} color="rgb(110,240,190)" />
            <Bar name={placeName(place)} v={town} color="rgb(170,185,215)" />
            <Bar name={countyName(place.county, isEn())} v={county} color="rgb(95,110,140)" />
          </div>
          {mine ? (
            diff != null && <p className={`fine ${diff <= 0 ? 'green' : 'warm'}`}>{diff <= 0 ? tx(`比鄉鎮平均少 ${-diff}%`, `${-diff}% below the township average`) : tx(`比鄉鎮平均多 ${diff}%`, `${diff}% above the township average`)}{tx('（鄉鎮為最近兩個月平均，季節不同會有落差）', ' (township figure is the latest two-month average; seasons differ)')}</p>
          ) : (
            <p className="fine">{tx('填上你家每月用電就能比較：', 'Enter your monthly use to compare:')}</p>
          )}
          <div className="kwh-in">
            <input type="number" min="0" max="9999" inputMode="numeric" placeholder={tx('每月度數', 'kWh / month')} value={draft !== '' ? draft : mine ?? ''} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== '') { setHome({ billKwh: Math.max(0, Math.min(9999, Number(draft) || 0)) || null }); setDraft(''); } }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            <span className="fine">{tx('度／月（帳單度數 ÷ 2）', 'kWh/month (bill ÷ 2)')}</span>
            {store && store !== mine && <button className="mini-btn" onClick={() => setHome({ billKwh: store })}>{tx(`用店家資料 ${n0(store)} 度`, `Use shop data (${n0(store)})`)}</button>}
          </div>
          {tw?.avg && (
            <>
              <div className="hl-k" style={{ marginTop: 10 }}>{tx(`${placeName(place)}近 12 個月`, `${placeName(place)}, last 12 months`)}</div>
              <Sparkline values={tw.avg.map((v) => v ?? 0)} color="rgb(110,240,190)" />
              <div className="spark-axis"><span>{data.months[0]?.replace('-', '/')}</span><span>{tx(`全年平均 ${tw.year ?? '—'} 度`, `Year avg ${tw.year ?? '—'} kWh`)}</span><span>{ym?.replace('-', '/')}</span></div>
            </>
          )}
          <Src data={data} extra={tx(`鄉鎮數字為${label}平均。住宅大多兩個月抄表一次，所以每個月都用「該月＋前一月」合計平均；5 戶以下不公開。你填的度數只存在這台裝置`, `Township figures are the ${label} average. Most homes are read every two months, so each month uses that month plus the previous one; areas under 6 homes are not published. Your number stays on this device`)} />
        </>
      )}
    </section>
  );
}

/* ═════════ D4 歷年供需（亮點）═════════ */
const resvColor = (r) => (r < 6 ? 'rgb(255,138,76)' : r < 10 ? 'rgb(255,214,92)' : r < 15 ? 'rgb(47,158,122)' : 'rgb(29,92,74)');
export function SupplyHistory({ hl, live }) {
  useT();
  const { data, error } = useSiteJson('supply-history.json');
  const years = useMemo(() => [...new Set((data?.days || []).map((d) => d[0].slice(0, 4)))].sort(), [data]);
  const [year, setYear] = useState(null);
  const [sel, setSel] = useState(null);
  const y = year || years[years.length - 1];
  const days = useMemo(() => (data?.days || []).filter((d) => d[0].startsWith(y || '????')), [data, y]);
  const byDate = useMemo(() => new Map(days.map((d) => [d[0], d])), [days]);
  if (!data) return <section className="life-sec" data-jump="history"><div className="hl-k">{tx('歷年供需', 'Supply history')}</div><Loading error={error} /></section>;
  const thisYear = twToday().slice(0, 4);
  const cur = (data.days || []).filter((d) => d[0].startsWith(thisYear));
  const last = data.days[data.days.length - 1];
  const todayPeak = hl?.loadPeak?.load;
  const rank = todayPeak && cur.length ? cur.filter((d) => d[1] > todayPeak).length + 1 : null;
  const yearMax = (ys) => (data.days || []).filter((d) => d[0].startsWith(ys)).reduce((a, d) => (!a || d[1] > a[1] ? d : a), null);
  const top = yearMax(thisYear), prevTop = yearMax(String(Number(thisYear) - 1));
  // 去年同一天的尖峰（2/29 沒有對應就不顯示）
  const lastYearDay = (data.days || []).find((d) => d[0] === `${Number(thisYear) - 1}${twToday().slice(4)}`);
  const wd = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const tight = days.filter((d) => d[2] < 10).length;
  const s = sel && byDate.get(sel);
  return (
    <section className="life-sec" data-jump="history">
      <div className="hl-k">{tx('今天在今年排第幾', 'How today ranks this year')}</div>
      {todayPeak ? (
        <div className="rank-card">
          <div className="big-num">{fmtMw(todayPeak)} <small>MW</small></div>
          <p className="fine">
            {tx(`今天到目前的最高用電（${hl.loadPeak.hm}）`, `Today’s peak so far (${hl.loadPeak.hm})`)}{!live && <em className="tag modeled">{tx('模擬', 'sim')}</em>}<br />
            {rank ? tx(`和今年 1/1–${md(cur[cur.length - 1][0])} 每日尖峰比，排第 `, `Ranks #`) : ''}{rank ? <b className="gold">{rank}</b> : null}{rank ? tx(` 高（共 ${cur.length} 天）`, ` of ${cur.length} days this year (Jan 1–${md(cur[cur.length - 1][0])})`) : ''}
          </p>
        </div>
      ) : null}
      <ul className="hl-list compact">
        {top && <li><span className="hl-k">{tx(`${thisYear} 最高`, `${thisYear} peak`)}</span><span className="hl-v">{md(top[0])}</span><span className="hl-n">{fmtMw(top[1])} <small>MW</small></span></li>}
        {lastYearDay && <li><span className="hl-k">{tx('去年今天', 'This day last year')}</span><span className="hl-v">{md(lastYearDay[0])}{tx(`（週${'日一二三四五六'[wd(lastYearDay[0])]}）`, ` (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd(lastYearDay[0])]})`)}</span><span className="hl-n">{fmtMw(lastYearDay[1])} <small>MW</small></span></li>}
        {prevTop && <li><span className="hl-k">{tx(`${Number(thisYear) - 1} 最高`, `${Number(thisYear) - 1} peak`)}</span><span className="hl-v">{md(prevTop[0])}</span><span className="hl-n">{fmtMw(prevTop[1])} <small>MW</small></span></li>}
      </ul>

      <div className="hl-k" style={{ marginTop: 10 }}>{tx('每日備轉容量率', 'Daily operating reserve')}</div>
      {years.length > 1 && (
        <div className="chips">{years.map((yy) => <button key={yy} className={yy === y ? 'on' : ''} onClick={() => { setYear(yy); setSel(null); }}>{yy}</button>)}</div>
      )}
      <div className="heat">
        {Array.from({ length: 12 }, (_, m) => (
          <div className="heat-row" key={m}>
            <small>{m + 1}</small>
            {Array.from({ length: 31 }, (_, d) => {
              const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
              const r = byDate.get(key);
              return <i key={d} className={sel === key ? 'sel' : ''} style={r ? { background: resvColor(r[2]) } : undefined} onClick={() => r && setSel(sel === key ? null : key)} />;
            })}
          </div>
        ))}
      </div>
      <div className="heat-legend">
        <span><i style={{ background: resvColor(5) }} />&lt;6%</span><span><i style={{ background: resvColor(8) }} />6–10%</span><span><i style={{ background: resvColor(12) }} />10–15%</span><span><i style={{ background: resvColor(20) }} />≥15%</span>
      </div>
      {s ? (
        <p className="fine"><b>{s[0].replace(/-/g, '/')}</b>　{tx('尖峰負載', 'Peak load')} {fmtMw(s[1])} MW · {tx('備轉', 'Reserve')} {s[2]}%{s[3] ? ` · ${tx('供電能力', 'Capacity')} ${fmtMw(s[3])} MW` : ''}</p>
      ) : (
        <p className="fine">{tx(`點格子看那天。${y} 年有 ${tight} 天備轉低於 10%。`, `Tap a square for that day. ${tight} days in ${y} had reserve below 10%.`)}</p>
      )}
      <Src data={data} extra={tx(`資料到 ${last[0].replace(/-/g, '/')}（台電約晚 1–2 個月公布）；「今天」用本 App 的即時全台發電量`, `Data through ${last[0]} (Taipower publishes 1–2 months late); “today” uses this app’s live national generation`)} />
    </section>
  );
}

/* ═════════ D5 家電電費＋電費小手冊 ═════════ */
export function AppliancePanel({ home, onClose }) {
  useT();
  const en = isEn();
  const [id, setId] = useState('ac');
  const preset = APPLIANCES.find((a) => a.id === id) || APPLIANCES[0];
  const [w, setW] = useState(preset.w);
  const [h, setH] = useState(preset.h);
  const [days, setDays] = useState(30);
  const m = new Date(Date.now() + 8 * 3600e3).getUTCMonth() + 1;
  const [summer, setSummer] = useState(m >= 6 && m <= 9);
  const [open, setOpen] = useState(null);
  const pick = (a) => { setId(a.id); setW(a.w); setH(a.h); };
  const kwh = Math.max(0, (w * h * days) / 1000);
  const base = home?.billKwh > 0 ? home.billKwh : 300;
  const baseFrom = home?.billKwh > 0 ? tx('你家', 'your home') : tx('一般家庭（假設）', 'a typical home (assumed)');
  const extra = billCompare(base + kwh, 0, summer).tiered - billCompare(base, 0, summer).tiered;
  const num = (v, set, max) => <input type="number" min="0" max={max} inputMode="decimal" value={v} onChange={(e) => set(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />;
  return (
    <Panel title="家電電費" onClose={onClose}>
      <div className="chips">
        {APPLIANCES.map((a) => <button key={a.id} className={id === a.id ? 'on' : ''} onClick={() => pick(a)}>{en ? a.en : a.zh}</button>)}
      </div>
      <div className="calc-in">
        <label>{tx('功率', 'Power')}<span>{num(w, setW, 10000)} W</span></label>
        <label>{tx('每天', 'Per day')}<span>{num(h, setH, 24)} {tx('小時', 'h')}</span></label>
        <label>{tx('一個月', 'Per month')}<span>{num(days, setDays, 31)} {tx('天', 'days')}</span></label>
      </div>
      <div className="calc-out">
        <div><small>{tx('每月約', 'About')}</small><b>{n0(kwh)}</b><small>{tx('度', 'kWh / month')}</small></div>
        <div><small>{tx('電費約多', 'Adds about')}</small><b className="gold">NT$ {n0(extra)}</b><small>{tx('／月', '/mo')}</small></div>
      </div>
      <label className="switch"><input type="checkbox" checked={summer} onChange={(e) => setSummer(e.target.checked)} /><span>{tx('夏月電價（6–9 月）', 'Summer rates (Jun–Sep)')}</span></label>
      <p className="fine">{tx(`以${baseFrom}每月 ${n0(base)} 度為基準，用住宅累進電價算「多用這些電」會多付多少（越用越貴，所以同一台家電在用電多的家庭比較貴）。功率是常見參考值，請以家電銘牌或能源效率標示為準。`, `Based on ${baseFrom} using ${n0(base)} kWh a month: the extra cost on the residential tiered tariff (each extra kWh costs more in a high-use home). Wattages are typical values; check the appliance’s label.`)}{preset.note ? ` ${en ? preset.note.en : preset.note.zh}` : ''}</p>

      <div className="hl-k" style={{ marginTop: 14 }}>{tx('電費小手冊', 'Power-bill handbook')}　<span className="muted">{tx('整理自台電公開資料', 'from Taipower’s public pages')}</span></div>
      <ul className="handbook">
        {HANDBOOK.map((b, i) => (
          <li key={i} className={open === i ? 'open' : ''}>
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{en ? b.en : b.zh}<span>{open === i ? '−' : '+'}</span></button>
            {open === i && (
              <div>
                <p>{en ? b.body.en : b.body.zh}</p>
                <a href={b.url} target="_blank" rel="noreferrer">{tx('來源：', 'Source: ')}{b.src} ↗</a>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="fine">{tx('電價依台電「電價表」住宅累進電價（未含各項折扣與調整）。', 'Rates follow Taipower’s residential tiered tariff, excluding discounts and adjustments.')}</p>
    </Panel>
  );
}

/* ═════════ D6 縣市綠電（資訊 → 縣市綠電）═════════ */
export function RenewTab() {
  useT();
  const { data, error } = useSiteJson('renew.json');
  const [metric, setMetric] = useState('kwh');
  if (!data) return <div className="doc"><Loading error={error} /></div>;
  const rows = data.counties.map((c) => ({ ...c, total: c.pv[metric] + c.wind[metric] + c.other[metric] })).sort((a, b) => b.total - a.total);
  const max = rows[0]?.total || 1;
  const all = rows.reduce((a, r) => a + r.total, 0);
  const fmt = (v) => (metric === 'kwh' ? (v >= 1e8 ? tx(`${(v / 1e8).toFixed(1)} 億度`, `${(v / 1e9).toFixed(2)} TWh`) : tx(`${n0(v / 1e4)} 萬度`, `${(v / 1e6).toFixed(0)} GWh`)) : `${n0(v / 1000)} MW`);
  return (
    <div className="doc">
      <p className="fine">{tx(`${data.year} 年各縣市台電購入的再生能源（${metric === 'kwh' ? '購電度數' : '躉購容量'}），全台合計 ${fmt(all)}。`, `Renewable power Taipower bought by county in ${data.year} (${metric === 'kwh' ? 'energy' : 'contracted capacity'}), total ${fmt(all)}.`)}</p>
      <div className="seg seg-wrap">
        {[['kwh', tx('購電度數', 'Energy')], ['kw', tx('容量', 'Capacity')]].map(([k, l]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{l}</button>)}
      </div>
      <ul className="renew">
        {rows.map((r) => (
          <li key={r.county}>
            <span>{countyName(r.county, isEn())}</span>
            <i className="stack">
              <i style={{ width: `${(r.pv[metric] / max) * 100}%`, background: 'rgb(255,214,92)' }} />
              <i style={{ width: `${(r.wind[metric] / max) * 100}%`, background: 'rgb(127,211,255)' }} />
              <i style={{ width: `${(r.other[metric] / max) * 100}%`, background: 'rgb(181,140,255)' }} />
            </i>
            <small>{fmt(r.total)}</small>
          </li>
        ))}
      </ul>
      <div className="heat-legend"><span><i style={{ background: 'rgb(255,214,92)' }} />{tx('太陽光電', 'Solar')}</span><span><i style={{ background: 'rgb(127,211,255)' }} />{tx('風力', 'Wind')}</span><span><i style={{ background: 'rgb(181,140,255)' }} />{tx('其他（含水力）', 'Other (incl. hydro)')}</span></div>
      <Src data={data} extra={tx('只含台電向民間購入（躉購）的部分，不含台電自有電廠、自發自用與轉供直供；離岸風場依併網縣市統計', 'Only renewables Taipower buys from private generators (feed-in); excludes Taipower’s own plants, self-use and direct-supply contracts')} />
    </div>
  );
}

/* ═════════ D2 颱風／天然災害停電 ═════════ */
const DISMISS = 'tgf-typhoon-dismiss';
export function TyphoonBanner({ data, onOpen }) {
  useT();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(DISMISS); } catch { return null; } });
  if (!typhoonActive(data) || hidden === data.time) return null;
  const pct = Math.round(((data.ever - data.now) / data.ever) * 100);
  return (
    <div className="typhoon-banner" role="status">
      <button className="tb-main" onClick={onOpen}>
        <i />
        <span><b>{data.name || tx('天然災害停電', 'Disaster outages')}</b>{data.now ? tx(`仍停電 ${n0(data.now)} 戶 · 已修復 ${pct}%`, `${n0(data.now)} homes still out · ${pct}% restored`) : tx(`已全部修復（曾停電 ${n0(data.ever)} 戶）`, `All restored (${n0(data.ever)} homes were affected)`)} ›</span>
      </button>
      <button className="icon-btn" onClick={() => { try { sessionStorage.setItem(DISMISS, data.time); } catch { /* 略 */ } setHidden(data.time); }} aria-label={tx('關閉', 'Close')}>{Icon.close}</button>
    </div>
  );
}

export function TyphoonPanel({ data, home, onClose }) {
  useT();
  const [open, setOpen] = useState(null);
  const [towns, setTowns] = useState({});
  const place = homeTown(home);
  if (!data) return <Panel title="颱風停電" onClose={onClose}><Loading /></Panel>;
  const pct = data.ever ? Math.round(((data.ever - data.now) / data.ever) * 100) : 100;
  const time = data.time ? new Date(Date.parse(data.time) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ').replace(/-/g, '/') : '—';
  const toggle = (c) => {
    if (open === c.gid) return setOpen(null);
    setOpen(c.gid);
    if (!towns[c.gid]) typhoonCounty(c.gid).then((j) => setTowns((x) => ({ ...x, [c.gid]: j.towns || [] }))).catch(() => setTowns((x) => ({ ...x, [c.gid]: 'error' })));
  };
  const list = [...data.counties].sort((a, b) => (norm(b.name) === place?.county) - (norm(a.name) === place?.county) || b.now - a.now || b.ever - a.ever).filter((c) => c.ever > 0);
  return (
    <Panel title="颱風停電" onClose={onClose}>
      <div className="hl-k">{data.name}</div>
      <div className="row-sb fine"><span>{tx(`曾停電 ${n0(data.ever)} 戶`, `${n0(data.ever)} homes affected`)}</span><span>{time}</span></div>
      <i className="cmp-bar big"><i style={{ width: `${pct}%`, background: 'rgb(110,240,190)' }} /></i>
      <div className="row-sb fine"><span className="green">{tx(`已修復 ${n0(data.ever - data.now)}（${pct}%）`, `Restored ${n0(data.ever - data.now)} (${pct}%)`)}</span><span className="warm">{tx(`仍停電 ${n0(data.now)}`, `Still out ${n0(data.now)}`)}</span></div>
      <div className="hl-k" style={{ marginTop: 12 }}>{tx('各縣市（仍停電 / 曾停電）', 'By county (still out / affected)')}</div>
      <ul className="ty-list">
        {list.map((c) => (
          <li key={c.gid} className={open === c.gid ? 'open' : ''}>
            <button onClick={() => toggle(c)} aria-expanded={open === c.gid}>
              <span><b>{countyName(c.name, isEn())}</b>{norm(c.name) === place?.county && <em className="tag est">{tx('我的家', 'Home')}</em>}</span>
              <span><b className={c.now ? 'warm' : 'green'}>{n0(c.now)}</b> <small className="muted">/ {n0(c.ever)}</small></span>
              <i className="cmp-bar"><i style={{ width: `${c.ever ? ((c.ever - c.now) / c.ever) * 100 : 100}%`, background: 'rgb(110,240,190)' }} /></i>
            </button>
            {open === c.gid && (
              towns[c.gid] === 'error' ? <p className="fine warm">{tx('讀不到各區資料', 'District data unavailable')}</p>
                : !towns[c.gid] ? <p className="fine">{t('讀取中…')}</p>
                  : (
                    <ul className="ty-towns">
                      {towns[c.gid].filter((x) => x.ever > 0).map((x) => (
                        <li key={x.name} className={place && norm(c.name) === place.county && norm(x.name) === norm(place.town) ? 'mine' : ''}><span>{x.name}</span><span><b className={x.now ? 'warm' : 'green'}>{n0(x.now)}</b> <small className="muted">/ {n0(x.ever)}</small></span></li>
                      ))}
                    </ul>
                  )
            )}
          </li>
        ))}
      </ul>
      <p className="fine src-line">{tx('資料：', 'Source: ')}<a href="https://service.taipower.com.tw/psvs1/" target="_blank" rel="noreferrer">{tx('台電「天然災害停復電查詢」', 'Taipower disaster outage map')}</a>{tx('（每 10 分鐘更新）。只在台電發布災害停電時出現。', ' (updated every 10 min). Shown only while Taipower reports disaster outages.')}</p>
    </Panel>
  );
}
