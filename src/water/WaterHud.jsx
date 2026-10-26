import { Panel } from '../components/Panels.jsx';
import { tx, useT } from '../i18n.js';

/* ───────── 電／水切換 ───────── */
export function ModeSwitch({ water, onChange }) {
  useT();
  return (
    <div className="mode-switch" role="tablist" aria-label={tx('切換電力／自來水', 'Switch power / water')}>
      <button role="tab" aria-selected={!water} className={!water ? 'on' : ''} onClick={() => water && onChange(false)}>⚡ {tx('電', 'Power')}</button>
      <button role="tab" aria-selected={water} className={water ? 'on water' : ''} onClick={() => !water && onChange(true)}>💧 {tx('水', 'Water')}</button>
    </div>
  );
}

const fmt = (v, d = 0) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const DROUGHT_EN = { 水情正常: 'normal', 水情稍緊: 'slightly tight', 一階限水: 'stage 1 restrictions', 二階限水: 'stage 2 restrictions', 三階限水: 'stage 3 restrictions' };
const droughtText = (d) => tx(`${d.area}：${d.level}（${d.date.slice(5).replace('-', '/')}）`, `${d.area}: ${DROUGHT_EN[d.level] || d.level} (${d.date.slice(5).replace('-', '/')})`);
/** 最近 30 天內、不是「水情正常」的通報 */
const activeDrought = (data) => (data?.drought || []).filter((d) => d.level !== '水情正常' && Date.now() - Date.parse(d.date) < 30 * 864e5);

/* ───────── 右上：水情總覽 ───────── */
export function WaterStats({ data }) {
  useT();
  const dr = activeDrought(data);
  return (
    <section className="mix water-stats">
      {data?.total ? (
        <>
          <div className="mix-row"><span className="mix-label">{tx('水庫蓄水', 'Reservoirs')}</span><span className="mix-value water">{data.total.pct.toFixed(1)}<small>%</small></span></div>
          <div className="mix-total">{tx(fmt(data.total.eff / 1e4, 1), fmt(data.total.eff / 1e5, 2))} <small>{tx(`億 m³ · ${data.total.n} 座水庫有效蓄水`, `billion m³ stored · ${data.total.n} reservoirs`)}</small></div>
        </>
      ) : <div className="mix-total"><small>{data ? tx('水庫水情暫時讀不到', 'Reservoir data unavailable') : tx('讀取中…', 'Loading…')}</small></div>}
      {data && <div className="mix-total"><small>{tx(`${data.plants.length} 座淨水場 · 臺北市管線 ${fmt(data.trunk?.km?.m_trunk + data.trunk?.km?.m_small)} 公里`, `${data.plants.length} treatment plants · Taipei pipes ${fmt(data.trunk?.km?.m_trunk + data.trunk?.km?.m_small)} km`)}</small></div>}
      {data && (
        <div className="supply water-chip" title={tx('經濟部水利署枯旱預警（最近 30 天）', 'Drought alerts from the Water Resources Agency (last 30 days)')}>
          <i style={{ background: dr.length ? '#c9d4ea' : '#5fd4ff' }} />
          <span>{dr.length ? tx(`枯旱預警 ${dr.length} 區`, `Drought alerts: ${dr.length}`) : tx('目前無枯旱預警', 'No drought alerts')}</span>
        </div>
      )}
    </section>
  );
}

/* ───────── 圖層開關（取代電力的能源篩選） ───────── */
const LAYERS = [['res', '水庫', 'Reservoirs', '#5fd4ff'], ['plants', '淨水場', 'Treatment plants', '#c6f6ff'], ['pipes', '管線', 'Pipes', '#7fb8ff']];
export function WaterFilters({ layers, onChange }) {
  useT();
  return (
    <nav className="filters water-filters" aria-label={tx('水的圖層', 'Water layers')}>
      {LAYERS.map(([k, zh, en, c]) => (
        <button key={k} className={layers[k] ? 'on' : ''} aria-pressed={!!layers[k]} style={{ '--dot': c }} onClick={() => onChange({ [k]: !layers[k] })}>
          <i />{tx(zh, en)}
        </button>
      ))}
    </nav>
  );
}

export function WaterLegend({ data }) {
  useT();
  return (
    <>
      <ul className="legend water-legend">
        <li><i style={{ background: '#5fd4ff', boxShadow: '0 0 8px #5fd4ff' }} />{tx('水庫（填滿＝蓄水率）', 'Reservoir (fill = storage)')}</li>
        <li><i style={{ background: '#c6f6ff' }} />{tx('淨水場', 'Treatment plant')}</li>
        <li><i className="bar" style={{ background: '#5fd4ff' }} />{tx('管徑 ≥ 1,000 mm', 'Pipe ≥ 1,000 mm')}</li>
        <li><i className="bar thin" style={{ background: '#7fb8ff' }} />{tx('300–999 mm（放大看小管）', '300–999 mm (zoom in for small pipes)')}</li>
      </ul>
      <footer className="sourceline w-src">{tx('資料：台水（淨水場）· 水利署（水庫、枯旱預警）· 臺北市工務局（管線，僅供參考）· OpenStreetMap（水庫位置）', 'Data: Taiwan Water Corp (plants) · Water Resources Agency (reservoirs, drought) · Taipei Public Works (pipes, for reference only) · OpenStreetMap (reservoir locations)')}{data?.liveT ? tx(` · 水情 ${new Date(data.liveT).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })} 更新`, ` · updated ${new Date(data.liveT).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })}`) : ''}</footer>
    </>
  );
}

/* ───────── 點選：淨水場／水庫／管線 ───────── */
const OUTAGE_TW = 'https://web.water.gov.tw/wateroffmap/map';
const OUTAGE_TP = 'https://www.water.gov.taipei/';
const inTaipeiArea = (p) => p && p[0] > 121.4 && p[0] < 121.68 && p[1] > 24.95 && p[1] < 25.22;

export function WaterSelPanel({ sel, onClose, onPower }) {
  useT();
  if (!sel) return null;
  const outage = (
    <dd>
      <a href={inTaipeiArea(sel.pos) ? OUTAGE_TP : OUTAGE_TW} target="_blank" rel="noreferrer">
        {inTaipeiArea(sel.pos) ? tx('臺北自來水事業處停水公告 ↗', 'Taipei Water Dept outage notices ↗') : tx('台水停水查詢 ↗', 'Taiwan Water outage map ↗')}
      </a>
    </dd>
  );
  const power = <dd><button className="link-btn" onClick={onPower}>{tx('切到「電」看這一帶的發電與用電 ›', 'Switch to Power for this area ›')}</button></dd>;
  if (sel.kind === 'plant') {
    return (
      <Panel title={sel.n} onClose={onClose}>
        <p className="fine">{tx(`台水第 ${sel.r} 區管理處 · 位置：台水開放資料`, `Taiwan Water Corp, Branch ${sel.r} · location from TWC open data`)}</p>
        <dl className="w-dl">
          <dt>{tx('原水來源', 'Raw water')}</dt><dd>{sel.src || '—'}</dd>
          <dt>{tx('主要供水', 'Supplies')}</dt><dd>{sel.area || '—'}</dd>
          <dt>{tx('停水', 'Outages')}</dt>{outage}
          <dt>{tx('同區用電', 'Power')}</dt>{power}
        </dl>
      </Panel>
    );
  }
  if (sel.kind === 'res') {
    return (
      <Panel title={sel.n} onClose={onClose}>
        <div className="w-res-big">
          <b>{sel.pct != null ? `${sel.pct.toFixed(1)}%` : '—'}</b>
          <small>{sel.pct != null ? tx(`有效蓄水 ${fmt(sel.eff, 0)} 萬 m³ ／ 容量 ${fmt(sel.cap, 0)} 萬 m³`, `${fmt(sel.eff, 0)} / ${fmt(sel.cap, 0)} ×10,000 m³ effective storage`) : tx('目前沒有即時蓄水資料', 'No live storage data right now')}</small>
          {sel.pct != null && <div className="w-bar"><span style={{ width: `${sel.pct}%` }} /></div>}
        </div>
        <dl className="w-dl">
          {sel.river && <><dt>{tx('河川', 'River')}</dt><dd>{sel.river}</dd></>}
          {sel.t && <><dt>{tx('觀測時間', 'Observed')}</dt><dd>{sel.t.replace('T', ' ').slice(0, 16)}</dd></>}
          <dt>{tx('同區用電', 'Power')}</dt>{power}
        </dl>
        <p className="fine">{tx('蓄水資料：經濟部水利署（每小時；未經檢核的即時資料）。水情燈號以水利署公告為準。位置取自 OpenStreetMap 水庫範圍中心。', 'Storage: Water Resources Agency (hourly, unverified live data). Official water-supply signals are published by the WRA. Location: centre of the reservoir outline in OpenStreetMap.')}</p>
      </Panel>
    );
  }
  return (
    <Panel title={tx(`自來水管 · 管徑 ${fmt(sel.d)} mm`, `Water main · ${fmt(sel.d)} mm`)} onClose={onClose}>
      <dl className="w-dl">
        <dt>{tx('長度', 'Length')}</dt><dd>{tx(`約 ${fmt(sel.len)} 公尺（這一段）`, `about ${fmt(sel.len)} m (this segment)`)}</dd>
        <dt>{tx('停水', 'Outages')}</dt>{outage}
        <dt>{tx('同區用電', 'Power')}</dt>{power}
      </dl>
      <p className="fine">{tx('位置：臺北市政府工務局「公共管線圖資＿自來水系統管線」（政府資料開放授權）。圖資僅供參考，確切位置請洽管線機構；施工前請依規定向管線單位查詢。', 'Location: Taipei City Public Works Dept public utility pipeline data (Open Government Data License). For reference only — contact the utility for exact positions before any digging.')}</p>
    </Panel>
  );
}

/* ───────── 水庫清單 ───────── */
export function ReservoirPanel({ data, onPick, onClose }) {
  useT();
  const list = (data?.reservoirs || []).filter((r) => r.cap > 0).sort((a, b) => (b.cap || 0) - (a.cap || 0));
  const dr = activeDrought(data);
  return (
    <Panel title="水庫" onClose={onClose} meta={data?.total ? tx(`全台 ${data.total.pct.toFixed(1)}%`, `Overall ${data.total.pct.toFixed(1)}%`) : null}>
      {dr.length > 0 && (
        <section className="life-sec">
          <div className="hl-k">{tx('枯旱預警（水利署，最近 30 天）', 'Drought alerts (WRA, last 30 days)')}</div>
          <ul className="w-drought">{dr.map((d) => <li key={d.area}>{droughtText(d)}</li>)}</ul>
        </section>
      )}
      <ul className="finder-list w-res-list">
        {list.map((r) => (
          <li key={r.id}>
            <button onClick={() => onPick(r)}>
              <b>{r.n}</b>
              <span className="w-bar small"><span style={{ width: `${r.pct ?? 0}%` }} /></span>
              <span>{r.pct != null ? `${r.pct.toFixed(0)}%` : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="fine">{tx('依容量排序。蓄水率＝有效蓄水量 ÷ 目前有效容量（水利署水庫基本資料）。', 'Sorted by capacity. Storage = effective storage ÷ current effective capacity (WRA reservoir register).')}</p>
    </Panel>
  );
}

/* ───────── 停水 ───────── */
export function OutagePanel({ onClose }) {
  useT();
  return (
    <Panel title="停水" onClose={onClose}>
      <p>{tx('停水公告由各自來水機構發布，請以官方查詢為準：', 'Outages are announced by each water utility; please check the official sources:')}</p>
      <ul className="w-links">
        <li><a href={OUTAGE_TW} target="_blank" rel="noreferrer">{tx('台灣自來水公司 停水查詢（全台，臺北市與新北部分地區除外）↗', 'Taiwan Water Corp outage map (nationwide except Taipei area) ↗')}</a></li>
        <li><a href={OUTAGE_TP} target="_blank" rel="noreferrer">{tx('臺北自來水事業處 停水公告（臺北市、新北市部分地區）↗', 'Taipei Water Dept outage notices (Taipei and parts of New Taipei) ↗')}</a></li>
      </ul>
      <p className="fine">{tx('停水資料還沒有接進地圖：台水沒有公開的停水資料介面；臺北自來水事業處有開放資料，之後會加上。', 'Outages are not on the map yet: Taiwan Water has no public outage API; the Taipei Water Dept publishes open data, which will be added later.')}</p>
    </Panel>
  );
}

