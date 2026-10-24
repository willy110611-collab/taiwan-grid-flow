import { useEffect, useMemo, useState } from 'react';
import { APP } from '../config/app.js';
import { Panel } from './Panels.jsx';
import { Sparkline, fmtMw, rgb, minutesAgo } from './widgets.jsx';
import { PLANTS, REGIONS } from '../config/geo.js';
import { THERMAL } from '../config/energy.js';
import { carbonIntensity, carbonLevel, OFFICIAL_FACTOR } from '../data/carbon.js';
import { aqiLevel, nearestStation, nearestWind, distKm } from '../data/useAir.js';
import { locate, requestNotify, searchTowns, enablePush, disablePush, pushSupport } from '../data/useHome.js';
import { SUPPLY_LEVELS } from '../data/parseAux.js';
import { billCompare } from '../data/advice.js';
import { t, tx, tr, isEn, useT } from '../i18n.js';
import { OutageSection, TownCompare } from './OpenData.jsx';
import { pushExtra } from '../data/openData.js';

const DIRS = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
const DIRS_EN = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const windText = (deg) => (deg == null ? '—' : isEn() ? `${DIRS_EN[Math.round(deg / 22.5) % 16]} wind` : `${DIRS[Math.round(deg / 22.5) % 16]}風`);
const R_EN = { NORTH: 'Northern', CENTRAL: 'Central', SOUTH: 'Southern', EAST: 'Eastern' };
const rName = (r) => (isEn() ? R_EN[r.en] || r.en : r.name);
/** 空品讀不到的原因：環境部故障 vs 中繼站沒設定金鑰 */
const airErrText = (err) => (/金鑰|MOENV_KEY/.test(err || '')
  ? tx('空品資料尚未接上：', 'Air data not connected: ') + tr(err)
  : /429|1027/.test(err || '')
    ? tx('今天使用人數太多，中繼站免費額度用完，空品資料早上 8 點恢復（發電資料改用網站備份，照常顯示）。', 'Too many visitors today: the relay’s free quota is used up. Air data returns at 8 am Taiwan time (power data keeps working from the site backup).')
    : tx('環境部空品服務暫時故障，稍後會自動恢復。', 'The MOENV air-quality service is temporarily down; it will recover automatically.'));
/** 中繼站給的是備份資料 → 標示資料時間 */
function StaleNote({ air }) {
  if (!air?.staleAt && !(minutesAgo(air?.asOf) > 120)) return null;
  const hm = String(air.asOf || air.staleAt || '').replace('T', ' ').slice(11, 16);
  return <p className="fine warm">{tx(`環境部暫時無法提供最新資料，顯示 ${hm} 的資料。`, `MOENV is not providing new data right now; showing data from ${hm}.`)}</p>;
}
const ADVICE_COLOR = { good: [110, 240, 160], ok: [255, 214, 92], bad: [255, 130, 90] };

/** 我的家的即時摘要（給卡片與面板共用） */
export function homeSummary({ home, snapshot, air, rows, advice }) {
  if (!snapshot) return null;
  const ciSeries0 = rows.map((r) => carbonIntensity(r.totals, snapshot.carbonFx)).filter((x) => x != null);
  if (!home.pos) return { station: null, wind: null, thermal: [], region: null, ci: advice?.ci, ciSeries: ciSeries0, unset: true };
  const station = nearestStation(air.stations, home.pos);
  const wind = nearestWind(air.stations, home.pos);
  // 附近的火力電廠（60 km 內），判斷是否位在下風側（僅示意）
  const thermal = PLANTS.filter((p) => !p.island).map((p) => {
    const s = snapshot.plants.find((x) => x.id === p.id);
    const mw = s ? Object.entries(s.mix).filter(([f]) => THERMAL.has(f)).reduce((a, [, v]) => a + v, 0) : 0;
    const d = distKm(home.pos, p.pos);
    let downwind = false;
    if (wind && mw > 80 && d < 60) {
      const toward = (wind.dir + 180) % 360; // 煙飄去的方向
      const bearing = (Math.atan2((home.pos[0] - p.pos[0]) * Math.cos((p.pos[1] * Math.PI) / 180), home.pos[1] - p.pos[1]) * 180) / Math.PI;
      const diff = Math.abs(((bearing - toward + 540) % 360) - 180);
      downwind = diff < 30;
    }
    return { ...p, mw, d, downwind };
  }).filter((p) => p.mw > 50).sort((a, b) => a.d - b.d).slice(0, 3);
  const region = home.region && REGIONS[home.region] ? { ...REGIONS[home.region], ...snapshot.regions?.byKey?.[home.region] } : null;
  const ciSeries = rows.map((r) => carbonIntensity(r.totals, snapshot.carbonFx)).filter((x) => x != null);
  return { station, wind, thermal, region, ci: advice?.ci, ciSeries };
}

/* ───────── 右上角小卡（點了打開「我的家」） ───────── */
export function HomeCard({ sum, advice, onOpen, className = '' }) {
  useT();
  if (!sum || !advice) return null;
  const c = rgb(ADVICE_COLOR[advice.level]);
  const st = sum.station;
  return (
    <button className={`home-card ${className} ${sum.unset ? 'unset' : ''}`} onClick={onOpen}>
      <span className="hc-advice"><i style={{ background: c, boxShadow: `0 0 10px ${c}` }} />{t(advice.head)}</span>
      <span className="hc-row">
        <b>{advice.ci?.toFixed(2) ?? '—'}</b><small>{tx('kg CO₂/度', 'kg CO₂/kWh')}</small>
        {st && (
          <>
            <em style={{ color: rgb(aqiLevel(st.aqi).color) }}>AQI {st.aqi ?? '—'}</em>
            <small>{st.site}</small>
          </>
        )}
      </span>
      {sum.unset && <span className="hc-set">{t('＋ 設定我的家')}</span>}
    </button>
  );
}

/* ───────── 我的家 面板 ───────── */
export function HomePanel({ home, setHome, sum, advice, snapshot, air, onPick, onMarks, onClose }) {
  useT();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const line = useLineConfig();
  const st0 = sum?.station;
  // 我的家換了地方 → App 通知改登記新的測站（不再發測試通知）
  useEffect(() => {
    if (!home.push || !st0 || !line?.vapidPublic || st0.site === home.pushSite) return;
    enablePush(APP.relayUrl, line.vapidPublic, st0.site, { test: false, extra: pushExtra(home) }).then(() => setHome({ pushSite: st0.site })).catch(() => {});
  }, [home.push, st0?.site, line?.vapidPublic]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sum) return <Panel title="我的家" onClose={onClose}><p className="muted">{t('資料讀取中…')}</p></Panel>;
  const st = sum.station;
  const cl = carbonLevel(sum.ci);
  const fc = (snapshot.forecast || []).filter((d) => d.date >= new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)).slice(0, 6);

  return (
    <Panel title="我的家" onClose={onClose}>
      <div className="home-loc">
        <div>
          <b>{home.name || tx('尚未設定地點', 'No location set')}</b>
          <span className="muted">　{sum.region ? tx(`${sum.region.name}供電區`, `${rName(sum.region)} supply region`) : ''}</span>
        </div>
      </div>
      {sum.unset && <p className="fine">{tx('設定地點後會顯示附近空品、下風側電廠與所屬供電區；只存在這台裝置，不會上傳。', 'Set a location to see nearby air quality, upwind plants and your supply region. It stays on this device and is never uploaded.')}</p>}
      <LocationPicker home={home} setHome={setHome} stations={air.stations} onPick={onPick} setMsg={setMsg} />
      {msg && <p className="fine warm">{msg}</p>}

      {/* D1 計畫性停電 */}
      <OutageSection home={home} setHome={setHome} line={line} onMarks={onMarks} />

      {/* 1. 用電時機 */}
      <section className="life-sec">
        <div className="hl-k">{tx('現在用電時機', 'Is now a good time?')}</div>
        <div className="advice-head" style={{ color: rgb(ADVICE_COLOR[advice.level]) }}>{t(advice.head)}</div>
        <ul className="reasons">{advice.reasons.map((r) => <li key={r}>{tr(r)}</li>)}</ul>
        {advice.best && (
          <p className="fine">{tx('依昨日同時段推估，今天 ', 'Based on yesterday, ')}<b className="green">{advice.best.from}–{advice.best.to}</b>{tx(' 碳排最低，適合洗衣、烘衣、電動車充電。', ' should have the lowest carbon today — a good time for laundry, drying or EV charging.')}</p>
        )}
        <label className="switch">
          <input type="checkbox" checked={!!home.touUser} onChange={(e) => setHome({ touUser: e.target.checked })} />
          <span>{tx('我家有申請「時間電價」', 'My home is on a time-of-use tariff')}</span>
        </label>
        <p className="fine">{tx('時段依台電簡易型二段式時間電價（114 年 10 月起）：平日夏月（6–9 月）09–24 時尖峰、其他月份 06–11、14–24 時尖峰；週六、週日與國定假日全日離峰。', 'Periods follow Taipower’s simple two-period TOU tariff (since Oct 2025): on weekdays, peak is 09–24 in summer (Jun–Sep) and 06–11 & 14–24 in other months; weekends and national holidays are off-peak all day.')}</p>
        <BillCalc home={home} setHome={setHome} />
      </section>

      {/* D3 你家 vs 鄉鎮平均 */}
      <TownCompare home={home} setHome={setHome} />

      {/* 2. 碳排 */}
      <section className="life-sec">
        <div className="hl-k">{tx('每度電的碳排', 'Carbon per kWh')} <em className="tag modeled">{tx('推估', 'est.')}</em></div>
        <div className="big-num">{sum.ci?.toFixed(3) ?? '—'} <small>{tx('kg CO₂ / 度', 'kg CO₂ / kWh')}</small> <span className={cl.tone}>{t(cl.label)}</span></div>
        <Sparkline values={sum.ciSeries} color="rgb(255,170,110)" />
        <p className="fine">{tx(`依各機組即時發電量 × 機組型式的典型排放係數推算（超超臨界燃煤、亞臨界燃煤、新舊複循環燃氣分開計算）。對照：能源署公告 ${OFFICIAL_FACTOR.year} 年度電力排碳係數 ${OFFICIAL_FACTOR.value} kg CO₂e/度（全年平均）。`, `Estimated from each unit’s live output × typical emission factor for its type (ultra-supercritical coal, subcritical coal, new and old combined-cycle gas counted separately). For reference: the Energy Administration’s ${OFFICIAL_FACTOR.year} grid factor is ${OFFICIAL_FACTOR.value} kg CO₂e/kWh (annual average).`)}</p>
      </section>

      {/* 3. 空氣 */}
      <section className="life-sec">
        <div className="hl-k">{tx('空氣品質', 'Air quality')}　<span className="muted">{tx('環境部（每小時）', 'MOENV (hourly)')}</span></div>
        {air.error ? (
          <p className="fine warm">{airErrText(air.error)}</p>
        ) : sum.unset ? (
          <p className="fine">{tx('設定「我的家」地點後顯示。', 'Shown after you set a Home location.')}</p>
        ) : st ? (
          <>
            <div className="aqi-row">
              <span className="aqi-dot" style={{ background: rgb(aqiLevel(st.aqi).color) }} />
              <b>AQI {st.aqi ?? '—'}</b>
              <span>{t(aqiLevel(st.aqi).label)}</span>
              <span className="muted">PM2.5 {st.pm25 ?? '—'} μg/m³ · {st.site}{tx('測站', ' station')}（{st.d.toFixed(0)} km）</span>
            </div>
            <StaleNote air={air} />
            {sum.wind && <p className="fine">{tx('風向：', 'Wind: ')}{windText(sum.wind.dir)}{tx('，', ', ')}{sum.wind.speed} m/s（{sum.wind.site}）</p>}
            <ul className="near-plants">
              {sum.thermal.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span className="muted">{p.d.toFixed(0)} km · {t('火力')} {fmtMw(p.mw)} MW</span>
                  {p.downwind && <em className="tag est">{tx('你在下風側', 'You are downwind')}</em>}
                </li>
              ))}
            </ul>
            <p className="fine">{tx('「下風側」只依最近測站的風向判斷位置關係，PM2.5 來源包含交通、工業、境外等，不代表污染來自該電廠。', '“Downwind” only uses the nearest station’s wind direction. PM2.5 also comes from traffic, industry and transboundary sources, so it does not mean the pollution comes from that plant.')}</p>
          </>
        ) : <p className="muted">{t('讀取中…')}</p>}
      </section>

      {/* 4. 供電預報 */}
      <section className="life-sec">
        <div className="hl-k">{tx('未來供電預報', 'Supply forecast')}　<span className="muted">{tx('台電，每 10 天一筆', 'Taipower, every 10 days')}</span></div>
        {fc.length ? (
          <ul className="forecast">
            {fc.map((d) => (
              <li key={d.date}>
                <small>{d.date.slice(5).replace('-', '/')}</small>
                <i style={{ background: rgb(d.color) }} />
                <b>{d.rate.toFixed(1)}%</b>
              </li>
            ))}
          </ul>
        ) : <p className="fine">{tx('預報資料需要更新 Cloudflare 中繼站（v2）後才會出現。', 'The forecast appears after the Cloudflare relay is updated (v2).')}</p>}
        <p className="fine">{tx('尖峰預估備轉容量率：綠 ≥10%、黃 6–10%、橘 <6%。', 'Forecast peak reserve margin: green ≥10%, yellow 6–10%, orange <6%.')}</p>
      </section>

      {/* 5. 所屬供電區 */}
      {sum.region?.load && (
        <section className="life-sec">
          <div className="hl-k">{tx(`${sum.region.name}供電區`, `${rName(sum.region)} supply region`)}</div>
          <p className="fine">{tx('用電', 'Demand')} {fmtMw(sum.region.load)} MW · {tx('發電', 'Generation')} {fmtMw(sum.region.gen)} MW · {tx('自給', 'Self-supply')} {Math.round(sum.region.ratio * 100)}%（{sum.region.ratio >= 1 ? tx('供能給其他區', 'exports to other regions') : tx('需要外區送電', 'imports from other regions')}）</p>
        </section>
      )}

      {/* 6. 提醒 */}
      <section className="life-sec">
        <div className="hl-k">{tx('提醒', 'Alerts')}</div>
        <p className="fine">{tx('空品 AQI ≥ 101（對人體有害）或供電非綠燈時通知；每天最多一次，只在 07–22 點發送。', 'Notifies when AQI ≥ 101 (unhealthy) or the supply signal is not green; at most once a day, only between 07:00 and 22:00.')}</p>

        {/* App 通知（免費） */}
        <label className="switch">
          <input
            type="checkbox"
            checked={!!home.push}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              try {
                if (e.target.checked) {
                  if (!st) throw new Error(tx('請先設定「我的家」地點', 'Please set your Home location first'));
                  await enablePush(APP.relayUrl, line?.vapidPublic, st.site, { extra: pushExtra({ ...home, push: true }) });
                  setHome({ push: true, pushSite: st.site });
                } else {
                  // 還有開計畫停電提醒 → 保留訂閱，只關空品／供電
                  if (home.outD3 || home.outD1) await enablePush(APP.relayUrl, line?.vapidPublic, null, { test: false, extra: pushExtra({ ...home, push: false }) });
                  else await disablePush(APP.relayUrl);
                  setHome({ push: false });
                }
                setMsg('');
              } catch (err) { setMsg(tr(err.message)); }
              setBusy(false);
            }}
          />
          <span>📲 {tx('App 通知（免費、不限次數）', 'App notifications (free, unlimited)')}{home.push && home.pushSite ? tx(`：${home.pushSite}測站`, `: ${home.pushSite} station`) : ''}</span>
        </label>
        {!home.push && pushSupport().ios && <p className="fine">{tx('iPhone：Safari「分享 → 加入主畫面」後，從主畫面打開光脈動再開啟這個開關。', 'iPhone: in Safari tap Share → Add to Home Screen, open the app from the Home Screen, then turn this on.')}</p>}

        {/* LINE */}
        {line?.lineFriendUrl && (
          <div className="line-box">
            <a className="line-btn" href={line.lineFriendUrl} target="_blank" rel="noreferrer">{tx('加 LINE 好友收提醒', 'Add the LINE bot for alerts')}</a>
            <p className="fine">{tx('加好友後傳你家附近的測站名稱登記', 'After adding it, send the name of a station near you to register')}{st ? <>{tx('，例如「', ', e.g. “')}<b>{st.site}</b>{tx('」', '”')}</> : ''}{tx('。', '.')}</p>
            <p className="fine">{tx('🆓 隨時傳「現在」查即時供電與空品、「預報」查未來供電，免費不限次數。', '🆓 Send 「現在」 any time for live supply and air, or 「預報」 for the supply forecast — free and unlimited.')}</p>
            <p className="fine">{tx('LINE 主動通知每月有則數上限，快用完時只送供電警示；空品請優先用上面的 App 通知。', 'LINE push messages have a monthly cap; when it runs low only supply alerts are sent. For air quality, prefer the App notifications above.')}</p>
          </div>
        )}

        {/* 開著 App 時的提醒 */}
        <label className="switch">
          <input
            type="checkbox"
            checked={!!home.notify}
            onChange={async (e) => {
              if (!e.target.checked) return setHome({ notify: false });
              try { await requestNotify(); setHome({ notify: true }); setMsg(''); } catch (err) { setMsg(tr(err.message)); }
            }}
          />
          <span>{tx('開著光脈動時另外提醒：機組異常、低碳時段開始', 'While the app is open, also alert me to unit anomalies and the start of low-carbon periods')}</span>
        </label>
      </section>
    </Panel>
  );
}

/* ───────── 選擇「我的家」：目前位置／地圖點選／搜尋鄉鎮或測站／測站清單 ───────── */
function LocationPicker({ home, setHome, stations = [], onPick, setMsg }) {
  useT();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const key = q.trim().replace(/臺/g, '台');
    if (!key) return [];
    const st = stations.filter((s) => s.site.replace(/臺/g, '台').includes(key))
      .slice(0, 4).map((s) => ({ name: `${s.site}測站`, sub: s.county, pos: [s.lng, s.lat] }));
    return [...searchTowns(key, 8 - st.length).map((t) => ({ ...t, sub: '' })), ...st];
  }, [q, stations]);
  const byCounty = useMemo(() => {
    const m = new Map();
    for (const s of stations) (m.get(s.county) || m.set(s.county, []).get(s.county)).push(s);
    return [...m];
  }, [stations]);
  const choose = (name, pos) => { setHome({ name, pos }); setQ(''); setMsg(''); };

  return (
    <div className="loc-pick">
      <div className="home-loc-btns">
        <button onClick={() => locate(setHome).then(() => setMsg('')).catch((e) => setMsg(tr(e.message)))}>{tx('使用目前位置', 'Use my location')}</button>
        <button onClick={onPick}>{tx('在地圖上點選', 'Pick on map')}</button>
      </div>
      <input
        className="loc-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tx('搜尋鄉鎮市區或測站，例如 北斗、西屯', 'Search a township or station (Chinese), e.g. 北斗')}
        enterKeyHint="search"
      />
      {results.length > 0 && (
        <ul className="loc-results">
          {results.map((r) => (
            <li key={r.name + r.pos}><button onClick={() => choose(r.name, r.pos)}>{r.name}<small>{r.sub}</small></button></li>
          ))}
        </ul>
      )}
      {q.trim() && !results.length && <p className="fine">{tx(`找不到「${q}」`, `No match for “${q}”`)}</p>}
      {byCounty.length > 0 && (
        <select
          className="loc-select"
          value=""
          onChange={(e) => {
            const s = stations.find((x) => x.site === e.target.value);
            if (s) choose(`${s.site}測站`, [s.lng, s.lat]);
          }}
        >
          <option value="">{tx(`或從 ${stations.length} 個空品測站選…`, `Or choose from ${stations.length} air stations…`)}</option>
          {byCounty.map(([county, list]) => (
            <optgroup key={county} label={county}>
              {list.map((s) => <option key={s.site} value={s.site}>{s.site}</option>)}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

/** 中繼站提供的 LINE 加好友連結 */
function useLineConfig() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    fetch(`${APP.relayUrl}/config.json`).then((r) => r.json()).then(setCfg).catch(() => setCfg(null));
  }, []);
  return cfg;
}

/* ───────── 空品 面板（篩選列選「空品」時自動打開） ───────── */
export function AirPanel({ air, snapshot, home, onClose }) {
  useT();
  const st = home.pos ? nearestStation(air.stations, home.pos) : null;
  const plants = PLANTS.filter((p) => air.cems?.[p.id]);
  return (
    <Panel title="空品" onClose={onClose}>
      {air.error ? (
        <div className="doc">
          <p className="warm">{airErrText(air.error)}</p>
          {/金鑰|MOENV_KEY/.test(air.error) && <p className="fine">{tx('需要到環境部資料開放平台免費申請 API 金鑰，貼到 Cloudflare 中繼站的 MOENV_KEY（說明在 README）。', 'Get a free API key from the MOENV open-data platform and set it as MOENV_KEY on the Cloudflare relay (see README).')}</p>}
        </div>
      ) : (
        <>
          <ul className="aqi-legend">
            {[25, 75, 125, 175, 250].map((v) => (
              <li key={v}><i style={{ background: rgb(aqiLevel(v).color) }} />{t(aqiLevel(v).label)}</li>
            ))}
          </ul>
          <StaleNote air={air} />
          {st && <p className="fine">{tx('離你最近：', 'Nearest: ')}{st.site} AQI {st.aqi}（{t(aqiLevel(st.aqi).label)}），PM2.5 {st.pm25} μg/m³</p>}
          <p className="fine">{tx('地圖上的淡色扇形＝火力電廠依最近測站風向的「下風方向」示意，長度隨火力出力與風速變化。', 'Faint fans on the map show the downwind direction of thermal plants based on the nearest station’s wind; their length scales with thermal output and wind speed.')}</p>
        </>
      )}

      <div className="hl-k" style={{ marginTop: 12 }}>{tx('電廠煙道即時監測', 'Stack monitoring')}　<span className="muted">{tx('環境部 CEMS（1 小時值）', 'MOENV CEMS (hourly)')}</span></div>
      {air.cemsError ? (
        <p className="fine warm">{tr(air.cemsError)}</p>
      ) : plants.length ? (
        <ul className="cems">
          {plants.map((p) => {
            const c = air.cems[p.id];
            const mw = snapshot?.plants.find((x) => x.id === p.id)?.mw || 0;
            return (
              <li key={p.id}>
                <div><b>{p.name}</b><span className="muted">　{tx('出力', 'Output')} {fmtMw(mw)} MW{c.time ? tx(` · ${c.time.slice(11, 16)} 量測`, ` · measured ${c.time.slice(11, 16)}`) : ''}</span>{!c.running && c.stopped ? <em className="tag est">{tx('煙道停機', 'Stacks off')}</em> : null}</div>
                <div className="cems-items">
                  {Object.entries(c.items).map(([k, it]) => {
                    const u = it.unit ? <small> {it.unit}</small> : null;
                    const pct = it.std ? Math.min(1, it.max / it.std) : null;
                    return (
                      <span key={k}>
                        {t(k)} <b>{Math.round(it.max * 10) / 10}</b>{it.std ? <small> / {it.std}</small> : null}{u}
                        {pct != null && <i className="cems-bar"><i style={{ width: `${pct * 100}%`, background: pct > 0.8 ? 'rgb(255,120,90)' : 'rgb(110,240,190)' }} /></i>}
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="fine">{tx('目前沒有電廠的 CEMS 資料（或格式尚待確認）。', 'No plant CEMS data right now (or the format is unconfirmed).')}</p>}
      <p className="fine">{tx('數值為該廠運轉中煙囪的最高值（1 小時平均，環境部約晚 1–2 小時公布）；斜線後為法規或環評承諾標準。只列台電與和平等發電廠本身，不含民營汽電共生廠。', 'Values are the highest among the plant’s running stacks (1-hour average, published 1–2 hours late); the number after the slash is the regulatory or EIA limit. Only Taipower, Ho-Ping and similar power plants are listed, not private co-generation plants.')}</p>
    </Panel>
  );
}

export { SUPPLY_LEVELS };

/** 電費試算：一般（累進）電價 vs 簡易型二段式時間電價 */
function BillCalc({ home, setHome }) {
  useT();
  const [open, setOpen] = useState(false);
  const kwh = home.billKwh ?? 350;
  const peak = home.billPeak ?? 50;
  const tw = new Date(Date.now() + 8 * 3600e3);
  const [summer, setSummer] = useState(() => { const m = tw.getUTCMonth() + 1; return m >= 6 && m <= 9; });
  const r = billCompare(Math.max(0, kwh), peak / 100, summer);
  const diff = r.tiered - r.tou;
  if (!open) return <button className="bill-open" onClick={() => setOpen(true)}>🧮 {t('試算：時間電價划算嗎？')}</button>;
  return (
    <div className="bill">
      <div className="bill-row">
        <label>{tx('每月用電', 'Monthly use')}<input type="number" min="0" max="5000" inputMode="numeric" value={kwh} onChange={(e) => setHome({ billKwh: Number(e.target.value) || 0 })} /> {tx('度', 'kWh')}</label>
        <label className="switch"><input type="checkbox" checked={summer} onChange={(e) => setSummer(e.target.checked)} /><span>{tx('夏月', 'Summer')}</span></label>
      </div>
      <label className="bill-range">{tx('尖峰時段用電', 'Use during peak')} <b>{peak}%</b>
        <input type="range" min="0" max="100" step="5" value={peak} onChange={(e) => setHome({ billPeak: Number(e.target.value) })} />
      </label>
      <ul className="bill-out">
        <li><span>{tx('一般電價（累進）', 'Standard (tiered)')}</span><b>{r.tiered.toLocaleString()} {tx('元', 'NT$')}</b></li>
        <li><span>{tx('時間電價（二段式）', 'Time-of-use (2-period)')}</span><b>{r.tou.toLocaleString()} {tx('元', 'NT$')}</b></li>
      </ul>
      <p className={`fine ${diff > 0 ? 'green' : 'warm'}`}>
        {Math.abs(diff) < 20 ? tx('兩種差不多，不用特地改。', 'About the same — no need to switch.') : diff > 0 ? tx(`改時間電價每月約省 ${diff.toLocaleString()} 元。`, `Switching to time-of-use saves about NT$${diff.toLocaleString()} a month.`) : tx(`維持一般電價較划算（時間電價每月多 ${(-diff).toLocaleString()} 元）。`, `Stay on the standard tariff (time-of-use costs NT$${(-diff).toLocaleString()} more a month).`)}
      </p>
      <p className="fine">{tx('台電帳單兩個月一期，請把帳單度數除以 2。估算未含電費折扣與流動電費調整，申請前請以台電試算為準。', 'Taipower bills cover two months, so divide the billed kWh by 2. This estimate excludes discounts and adjustments; check Taipower’s own calculator before applying.')}</p>
    </div>
  );
}
