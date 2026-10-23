import { useEffect, useMemo, useState } from 'react';
import { APP } from '../config/app.js';
import { Panel } from './Panels.jsx';
import { Sparkline, fmtMw, rgb } from './widgets.jsx';
import { PLANTS, REGIONS } from '../config/geo.js';
import { THERMAL } from '../config/energy.js';
import { carbonIntensity, carbonLevel, OFFICIAL_FACTOR } from '../data/carbon.js';
import { aqiLevel, nearestStation, nearestWind, distKm } from '../data/useAir.js';
import { locate, requestNotify, searchTowns, enablePush, disablePush, pushSupport } from '../data/useHome.js';
import { SUPPLY_LEVELS } from '../data/parseAux.js';
import { billCompare } from '../data/advice.js';
import { t } from '../i18n.js';

const DIRS = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
export const windText = (deg) => (deg == null ? '—' : `${DIRS[Math.round(deg / 22.5) % 16]}風`);
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
  if (!sum || !advice) return null;
  const c = rgb(ADVICE_COLOR[advice.level]);
  const st = sum.station;
  return (
    <button className={`home-card ${className} ${sum.unset ? 'unset' : ''}`} onClick={onOpen}>
      <span className="hc-advice"><i style={{ background: c, boxShadow: `0 0 10px ${c}` }} />{t(advice.head)}</span>
      <span className="hc-row">
        <b>{advice.ci?.toFixed(2) ?? '—'}</b><small>kg CO₂/度</small>
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
export function HomePanel({ home, setHome, sum, advice, snapshot, air, onPick, onClose }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const line = useLineConfig();
  const st0 = sum?.station;
  // 我的家換了地方 → App 通知改登記新的測站（不再發測試通知）
  useEffect(() => {
    if (!home.push || !st0 || !line?.vapidPublic || st0.site === home.pushSite) return;
    enablePush(APP.relayUrl, line.vapidPublic, st0.site, { test: false }).then(() => setHome({ pushSite: st0.site })).catch(() => {});
  }, [home.push, st0?.site, line?.vapidPublic]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sum) return <Panel title="我的家" onClose={onClose}><p className="muted">資料讀取中…</p></Panel>;
  const st = sum.station;
  const cl = carbonLevel(sum.ci);
  const fc = (snapshot.forecast || []).filter((d) => d.date >= new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)).slice(0, 6);

  return (
    <Panel title="我的家" onClose={onClose}>
      <div className="home-loc">
        <div>
          <b>{home.name || '尚未設定地點'}</b>
          <span className="muted">　{sum.region ? `${sum.region.name}供電區` : ''}</span>
        </div>
      </div>
      {sum.unset && <p className="fine">設定地點後會顯示附近空品、下風側電廠與所屬供電區；只存在這台裝置，不會上傳。</p>}
      <LocationPicker home={home} setHome={setHome} stations={air.stations} onPick={onPick} setMsg={setMsg} />
      {msg && <p className="fine warm">{msg}</p>}

      {/* 1. 用電時機 */}
      <section className="life-sec">
        <div className="hl-k">現在用電時機</div>
        <div className="advice-head" style={{ color: rgb(ADVICE_COLOR[advice.level]) }}>{advice.head}</div>
        <ul className="reasons">{advice.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {advice.best && (
          <p className="fine">依昨日同時段推估，今天 <b className="green">{advice.best.from}–{advice.best.to}</b> 碳排最低，適合洗衣、烘衣、電動車充電。</p>
        )}
        <label className="switch">
          <input type="checkbox" checked={!!home.touUser} onChange={(e) => setHome({ touUser: e.target.checked })} />
          <span>我家有申請「時間電價」</span>
        </label>
        <p className="fine">時段依台電簡易型二段式時間電價（114 年 10 月起）：平日夏月（6–9 月）09–24 時尖峰、其他月份 06–11、14–24 時尖峰；週六、週日與國定假日全日離峰。</p>
        <BillCalc home={home} setHome={setHome} />
      </section>

      {/* 2. 碳排 */}
      <section className="life-sec">
        <div className="hl-k">每度電的碳排 <em className="tag modeled">推估</em></div>
        <div className="big-num">{sum.ci?.toFixed(3) ?? '—'} <small>kg CO₂ / 度</small> <span className={cl.tone}>{cl.label}</span></div>
        <Sparkline values={sum.ciSeries} color="rgb(255,170,110)" />
        <p className="fine">依各機組即時發電量 × 機組型式的典型排放係數推算（超超臨界燃煤、亞臨界燃煤、新舊複循環燃氣分開計算）。對照：能源署公告 {OFFICIAL_FACTOR.year} 年度電力排碳係數 {OFFICIAL_FACTOR.value} kg CO₂e/度（全年平均）。</p>
      </section>

      {/* 3. 空氣 */}
      <section className="life-sec">
        <div className="hl-k">空氣品質　<span className="muted">環境部（每小時）</span></div>
        {air.error ? (
          <p className="fine warm">空品資料尚未接上：{air.error}</p>
        ) : sum.unset ? (
          <p className="fine">設定「我的家」地點後顯示。</p>
        ) : st ? (
          <>
            <div className="aqi-row">
              <span className="aqi-dot" style={{ background: rgb(aqiLevel(st.aqi).color) }} />
              <b>AQI {st.aqi ?? '—'}</b>
              <span>{aqiLevel(st.aqi).label}</span>
              <span className="muted">PM2.5 {st.pm25 ?? '—'} μg/m³ · {st.site}測站（{st.d.toFixed(0)} km）</span>
            </div>
            {sum.wind && <p className="fine">風向：{windText(sum.wind.dir)}，{sum.wind.speed} m/s（{sum.wind.site}）</p>}
            <ul className="near-plants">
              {sum.thermal.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span className="muted">{p.d.toFixed(0)} km · 火力 {fmtMw(p.mw)} MW</span>
                  {p.downwind && <em className="tag est">你在下風側</em>}
                </li>
              ))}
            </ul>
            <p className="fine">「下風側」只依最近測站的風向判斷位置關係，PM2.5 來源包含交通、工業、境外等，不代表污染來自該電廠。</p>
          </>
        ) : <p className="muted">讀取中…</p>}
      </section>

      {/* 4. 供電預報 */}
      <section className="life-sec">
        <div className="hl-k">未來供電預報　<span className="muted">台電，每 10 天一筆</span></div>
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
        ) : <p className="fine">預報資料需要更新 Cloudflare 中繼站（v2）後才會出現。</p>}
        <p className="fine">尖峰預估備轉容量率：綠 ≥10%、黃 6–10%、橘 &lt;6%。</p>
      </section>

      {/* 5. 所屬供電區 */}
      {sum.region?.load && (
        <section className="life-sec">
          <div className="hl-k">{sum.region.name}供電區</div>
          <p className="fine">用電 {fmtMw(sum.region.load)} MW · 發電 {fmtMw(sum.region.gen)} MW · 自給 {Math.round(sum.region.ratio * 100)}%（{sum.region.ratio >= 1 ? '供能給其他區' : '需要外區送電'}）</p>
        </section>
      )}

      {/* 6. 提醒 */}
      <section className="life-sec">
        <div className="hl-k">提醒</div>
        <p className="fine">空品 AQI ≥ 101（對人體有害）或供電非綠燈時通知；每天最多一次，只在 07–22 點發送。</p>

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
                  if (!st) throw new Error('請先設定「我的家」地點');
                  await enablePush(APP.relayUrl, line?.vapidPublic, st.site);
                  setHome({ push: true, pushSite: st.site });
                } else {
                  await disablePush(APP.relayUrl);
                  setHome({ push: false });
                }
                setMsg('');
              } catch (err) { setMsg(err.message); }
              setBusy(false);
            }}
          />
          <span>📲 App 通知（免費、不限次數）{home.push && home.pushSite ? `：${home.pushSite}測站` : ''}</span>
        </label>
        {!home.push && pushSupport().ios && <p className="fine">iPhone：Safari「分享 → 加入主畫面」後，從主畫面打開光脈搏再開啟這個開關。</p>}

        {/* LINE */}
        {line?.lineFriendUrl && (
          <div className="line-box">
            <a className="line-btn" href={line.lineFriendUrl} target="_blank" rel="noreferrer">加 LINE 好友收提醒</a>
            <p className="fine">加好友後傳你家附近的測站名稱登記{st ? <>，例如「<b>{st.site}</b>」</> : ''}。</p>
            <p className="fine">🆓 隨時傳「現在」查即時供電與空品、「預報」查未來供電，免費不限次數。</p>
            <p className="fine">LINE 主動通知每月有則數上限，快用完時只送供電警示；空品請優先用上面的 App 通知。</p>
          </div>
        )}

        {/* 開著 App 時的提醒 */}
        <label className="switch">
          <input
            type="checkbox"
            checked={!!home.notify}
            onChange={async (e) => {
              if (!e.target.checked) return setHome({ notify: false });
              try { await requestNotify(); setHome({ notify: true }); setMsg(''); } catch (err) { setMsg(err.message); }
            }}
          />
          <span>開著光脈搏時另外提醒：機組異常、低碳時段開始</span>
        </label>
      </section>
    </Panel>
  );
}

/* ───────── 選擇「我的家」：目前位置／地圖點選／搜尋鄉鎮或測站／測站清單 ───────── */
function LocationPicker({ home, setHome, stations = [], onPick, setMsg }) {
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
        <button onClick={() => locate(setHome).then(() => setMsg('')).catch((e) => setMsg(e.message))}>使用目前位置</button>
        <button onClick={onPick}>在地圖上點選</button>
      </div>
      <input
        className="loc-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋鄉鎮市區或測站，例如 北斗、西屯"
        enterKeyHint="search"
      />
      {results.length > 0 && (
        <ul className="loc-results">
          {results.map((r) => (
            <li key={r.name + r.pos}><button onClick={() => choose(r.name, r.pos)}>{r.name}<small>{r.sub}</small></button></li>
          ))}
        </ul>
      )}
      {q.trim() && !results.length && <p className="fine">找不到「{q}」</p>}
      {byCounty.length > 0 && (
        <select
          className="loc-select"
          value=""
          onChange={(e) => {
            const s = stations.find((x) => x.site === e.target.value);
            if (s) choose(`${s.site}測站`, [s.lng, s.lat]);
          }}
        >
          <option value="">或從 {stations.length} 個空品測站選…</option>
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
  const st = home.pos ? nearestStation(air.stations, home.pos) : null;
  const plants = PLANTS.filter((p) => air.cems?.[p.id]);
  return (
    <Panel title="空品" onClose={onClose}>
      {air.error ? (
        <div className="doc">
          <p className="warm">空品資料尚未接上：{air.error}</p>
          <p className="fine">需要到環境部資料開放平台免費申請 API 金鑰，貼到 Cloudflare 中繼站的 MOENV_KEY（說明在 README）。</p>
        </div>
      ) : (
        <>
          <ul className="aqi-legend">
            {[25, 75, 125, 175, 250].map((v) => (
              <li key={v}><i style={{ background: rgb(aqiLevel(v).color) }} />{aqiLevel(v).label}</li>
            ))}
          </ul>
          {st && <p className="fine">離你最近：{st.site} AQI {st.aqi}（{aqiLevel(st.aqi).label}），PM2.5 {st.pm25} μg/m³</p>}
          <p className="fine">地圖上的淡色扇形＝火力電廠依最近測站風向的「下風方向」示意，長度隨火力出力與風速變化。</p>
        </>
      )}

      <div className="hl-k" style={{ marginTop: 12 }}>電廠煙道即時監測　<span className="muted">環境部 CEMS（1 小時值）</span></div>
      {air.cemsError ? (
        <p className="fine warm">{air.cemsError}</p>
      ) : plants.length ? (
        <ul className="cems">
          {plants.map((p) => {
            const c = air.cems[p.id];
            const mw = snapshot?.plants.find((x) => x.id === p.id)?.mw || 0;
            return (
              <li key={p.id}>
                <div><b>{p.name}</b><span className="muted">　出力 {fmtMw(mw)} MW{c.time ? ` · ${c.time.slice(11, 16)} 量測` : ''}</span>{!c.running && c.stopped ? <em className="tag est">煙道停機</em> : null}</div>
                <div className="cems-items">
                  {Object.entries(c.items).map(([k, it]) => {
                    const u = it.unit ? <small> {it.unit}</small> : null;
                    const pct = it.std ? Math.min(1, it.max / it.std) : null;
                    return (
                      <span key={k}>
                        {k} <b>{Math.round(it.max * 10) / 10}</b>{it.std ? <small> / {it.std}</small> : null}{u}
                        {pct != null && <i className="cems-bar"><i style={{ width: `${pct * 100}%`, background: pct > 0.8 ? 'rgb(255,120,90)' : 'rgb(110,240,190)' }} /></i>}
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="fine">目前沒有電廠的 CEMS 資料（或格式尚待確認）。</p>}
      <p className="fine">數值為該廠運轉中煙囪的最高值（1 小時平均，環境部約晚 1–2 小時公布）；斜線後為法規或環評承諾標準。只列台電與和平等發電廠本身，不含民營汽電共生廠。</p>
    </Panel>
  );
}

export { SUPPLY_LEVELS };

/** 電費試算：一般（累進）電價 vs 簡易型二段式時間電價 */
function BillCalc({ home, setHome }) {
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
        <label>每月用電<input type="number" min="0" max="5000" inputMode="numeric" value={kwh} onChange={(e) => setHome({ billKwh: Number(e.target.value) || 0 })} /> 度</label>
        <label className="switch"><input type="checkbox" checked={summer} onChange={(e) => setSummer(e.target.checked)} /><span>夏月</span></label>
      </div>
      <label className="bill-range">尖峰時段用電 <b>{peak}%</b>
        <input type="range" min="0" max="100" step="5" value={peak} onChange={(e) => setHome({ billPeak: Number(e.target.value) })} />
      </label>
      <ul className="bill-out">
        <li><span>一般電價（累進）</span><b>{r.tiered.toLocaleString()} 元</b></li>
        <li><span>時間電價（二段式）</span><b>{r.tou.toLocaleString()} 元</b></li>
      </ul>
      <p className={`fine ${diff > 0 ? 'green' : 'warm'}`}>
        {Math.abs(diff) < 20 ? '兩種差不多，不用特地改。' : diff > 0 ? `改時間電價每月約省 ${diff.toLocaleString()} 元。` : `維持一般電價較划算（時間電價每月多 ${(-diff).toLocaleString()} 元）。`}
      </p>
      <p className="fine">台電帳單兩個月一期，請把帳單度數除以 2。估算未含電費折扣與流動電費調整，申請前請以台電試算為準。</p>
    </div>
  );
}
