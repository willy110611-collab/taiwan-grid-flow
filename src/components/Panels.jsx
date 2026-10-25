import { useEffect, useRef, useState } from 'react';
import { GUIDE } from './Guide.jsx';
import { APP } from '../config/app.js';
import { EVIDENCE } from '../config/energy.js';
import { Icon, Sparkline, fmtMw, minutesAgo } from './widgets.jsx';
import { t, tx, tr, useT, isEn } from '../i18n.js';

const srcLabel = (u = '') => (/workers\.dev/.test(u) ? tx(' · 中繼站', ' · relay') : /^\.\/data\//.test(u) ? tx(' · 網站備份', ' · site backup') : /taipower/.test(u) ? tx(' · 本機代理', ' · local proxy') : '');
const agoLabel = (m) => (m < 1 ? tx('剛剛', 'just now') : m < 60 ? tx(`${m} 分鐘前`, `${m} min ago`) : m < 1440 ? tx(`${Math.floor(m / 60)} 小時前`, `${Math.floor(m / 60)} h ago`) : tx(`${Math.floor(m / 1440)} 天前`, `${Math.floor(m / 1440)} d ago`));
import { PLANTS, SOLAR_COUNTY_KW, plantName } from '../config/geo.js';
import { twHM } from '../data/history.js';
import { setPowerPref } from '../power.js';
import { SupplyHistory, RenewTab } from './OpenData.jsx';
import { NUCLEAR_SOURCES, NUCLEAR_VERIFIED } from '../config/nuclear.js';
import { FuelStack } from './FuelStack.jsx';
import { WorldCompare } from './WorldCompare.jsx';

/** 面板外框：桌面為浮動卡片，手機為底部抽屜（CSS 依螢幕寬度切換） */
export function Panel({ title, meta, onClose, children }) {
  useT();
  // 鍵盤：Esc 關閉面板
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) onClose?.(); }; // 注音組字中、輸入框裡按 Esc 不關面板
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // 鍵盤：打開時把焦點移進面板（Tab 從面板開始），不捲動頁面
  const ref = useRef(null);
  useEffect(() => { if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true }); }, []);
  title = t(title);
  return (
    <section className="panel" role="dialog" aria-label={title} tabIndex={-1} ref={ref}>
      <div className="panel-grip" onClick={onClose} />
      <header className="panel-head">
        <h2>{title}{meta != null && <small className="panel-meta">{meta}</small>}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={tx('關閉', 'Close')}>{Icon.close}</button>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/* ───────────── 今日亮點 ───────────── */
const md = (ts) => { const d = new Date(ts + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${twHM(ts)}`; };
const REC_ROWS = [
  ['green', '綠能佔比', '%', 'green'],
  ['solar', '太陽能出力', 'MW', 'gold'],
  ['wind', '風力出力', 'MW', ''],
  ['load', '全台用電', 'MW', '']
];

/** 亮點內容很長：頂端一排跳到各段的按鈕（只在面板內捲動） */
const JUMPS = [['today', '今日', 'Today'], ['fuel', '發電組成', 'Mix'], ['history', '歷年供需', 'History'], ['world', '國際比較', 'World']];
function JumpBar() {
  const ref = useRef(null);
  const [avail, setAvail] = useState(() => JUMPS.map(([k]) => k));
  // 只顯示面板裡真的有的段落（例如剛過午夜發電組成圖還沒資料、國際比較讀不到時）
  useEffect(() => {
    const check = () => {
      const body = ref.current?.closest('.panel-body');
      if (!body) return;
      const next = JUMPS.map(([k]) => k).filter((k) => body.querySelector(`[data-jump="${k}"]`));
      setAvail((cur) => (cur.join() === next.join() ? cur : next));
    };
    check();
    const id = setInterval(check, 1500);
    return () => clearInterval(id);
  }, []);
  const go = (e, k) => {
    const body = e.currentTarget.closest('.panel-body');
    const el = body?.querySelector(`[data-jump="${k}"]`);
    if (!el) return;
    const bar = e.currentTarget.closest('.hl-jump').offsetHeight;
    const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - bar - 8;
    body.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return (
    <nav className="hl-jump" ref={ref} aria-label={tx('跳到', 'Jump to')}>
      {JUMPS.filter(([k]) => avail.includes(k)).map(([k, zh, en]) => <button key={k} onClick={(e) => go(e, k)}>{tx(zh, en)}</button>)}
    </nav>
  );
}

export function HighlightsPanel({ hl, live, records, dayRows, yRows, onPlant, onClose }) {
  useT();
  return (
    <Panel title="今日亮點" onClose={onClose}>
      {!hl ? (
        <p className="muted">{t('資料讀取中…')}</p>
      ) : (
        <>
          <JumpBar />
          <ul className="hl-list" data-jump="today">
            {hl.topPlant && (
              <li className="clickable" role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && hl.topPlant.id && onPlant?.(hl.topPlant.id)} onClick={() => hl.topPlant.id && onPlant?.(hl.topPlant.id)} title={tx('看這座電廠的機組', 'See this plant’s units')}>
                <span className="hl-k">{t('目前出力最大')}</span>
                <span className="hl-v">{plantName(PLANTS.find((p) => p.id === hl.topPlant.id)) || hl.topPlant.name} <small className="muted">›</small></span>
                <span className="hl-n">{fmtMw(hl.topPlant.mw)} <small>MW</small></span>
              </li>
            )}
            <li>
              <span className="hl-k">{t('太陽能今日尖峰')}</span>
              {hl.solarPeak ? (
                <>
                  <span className="hl-v gold">{hl.solarPeak.hm}</span>
                  <span className="hl-n">{fmtMw(hl.solarPeak.solar)} <small>MW</small></span>
                </>
              ) : (
                <span className="hl-v muted">{t('日出後開始累計')}</span>
              )}
            </li>
            <li>
              <span className="hl-k">{t('綠能佔比最高')}</span>
              <span className="hl-v green">{hl.greenPeak.hm}</span>
              <span className="hl-n">{hl.greenPeak.greenPct.toFixed(1)} <small>%</small></span>
            </li>
            <li>
              <span className="hl-k">{t('全台負載最高')}</span>
              <span className="hl-v">{hl.loadPeak.hm}</span>
              <span className="hl-n">{fmtMw(hl.loadPeak.load)} <small>MW</small></span>
            </li>
            {hl.northIn != null ? (
              <li>
                <span className="hl-k">{hl.northIn > 0 ? t('南電北送') : tx('北部送出', 'North exporting')} <em className="tag live">{t('台電即時')}</em></span>
                <span className="hl-v">{hl.northIn > 0 ? t('中南部 → 北部') : tx('北部 → 中南東部', 'North → other regions')}</span>
                <span className="hl-n">{fmtMw(Math.round(Math.abs(hl.northIn) / 10) * 10)} <small>MW</small></span>
              </li>
            ) : hl.southToNorth != null && (
              <li>
                <span className="hl-k">{t('南電北送')} <em className="tag est">{t('模型推估')}</em></span>
                <span className="hl-v">{t('中南部 → 北部')}</span>
                <span className="hl-n">≈ {fmtMw(Math.round(hl.southToNorth / 50) * 50)} <small>MW</small></span>
              </li>
            )}
          </ul>
          {hl.anomalies?.length > 0 && (
            <div className="hl-anom">
              <div className="hl-k">{t('今日機組異常（偵測）')}</div>
              <ul>
                {hl.anomalies.slice(-5).reverse().map((a, i) => (
                  <li key={i}><span>{a.time}</span>{a.plant || a.unit}　{a.unit}　{fmtMw(a.from)} → {fmtMw(a.to)} MW</li>
                ))}
              </ul>
            </div>
          )}
          {dayRows?.length >= 3 || yRows?.length >= 3 ? (
            <FuelStack today={dayRows} yesterday={yRows} />
          ) : (
            <div className="hl-chart">
              <div className="hl-k">{t('今日綠能佔比')}</div>
              <Sparkline values={hl.spark} />
            </div>
          )}
          {records && REC_ROWS.some(([k]) => records[k]) && (
            <div className="hl-rec">
              <div className="hl-k">{t('我的紀錄')}<small className="muted">　{t('這台裝置看過的最高值')}{records.since ? tx(`（${md(records.since).split(' ')[0]} 起）`, ` (since ${md(records.since).split(' ')[0]})`) : ''}</small></div>
              <ul className="hl-list">
                {REC_ROWS.filter(([k]) => records[k]).map(([k, label, unit, cls]) => (
                  <li key={k}>
                    <span className="hl-k">{t(label)}</span>
                    <span className={`hl-v ${cls}`}>{md(records[k].t)}</span>
                    <span className="hl-n">{unit === '%' ? records[k].v.toFixed(1) : fmtMw(records[k].v)} <small>{unit}</small></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="fine">
            {hl.partial ? tx(`今日紀錄從 ${hl.since} 開始（打開頁面後才開始累計）。`, `Today’s records start at ${hl.since} (counted only while the page is open).`) : t('統計範圍：今日 00:00 至現在。')}
          </p>
          <SupplyHistory hl={hl} live={live} />
          <WorldCompare />
        </>
      )}
    </Panel>
  );
}

/* ───────────── 資訊（資料來源 / 準確度 / 關於） ───────────── */
const TABS = [
  ['guide', '使用說明'],
  ['source', '資料來源'],
  ['accuracy', '準確度'],
  ['renew', '縣市綠電'],
  ['about', '關於']
];

export function InfoPanel({ snapshot, air, sun, onClose, initialTab, power = 'auto', powerSave = false }) {
  useT();
  const [tab, setTab] = useState(initialTab === 'diag' ? 'source' : initialTab || 'guide');
  // 從「部分資料讀不到」點進來 → 直接捲到連線診斷
  useEffect(() => {
    if (initialTab !== 'diag') return;
    const id = setTimeout(() => document.querySelector('.panel .diag')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120);
    return () => clearTimeout(id);
  }, [initialTab]);
  const live = snapshot?.source === 'live';
  return (
    <Panel title="資訊" onClose={onClose}>
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t(label)}</button>
        ))}
      </nav>

      {tab === 'guide' && (
        <div className="doc">
          <ul className="guide-list">
            {GUIDE.map(([ico, k, v, en]) => (
              <li key={k}><span className="g-ico">{ico}</span><div><b>{t(k)}</b><p>{tx(v, en)}</p></div></li>
            ))}
          </ul>
          <div className="hl-k" style={{ marginTop: 12 }}>{tx('小技巧', 'Tips')}</div>
          <ul className="reasons">
            <li>{tx('上方「綠能／火力／核能／用電／空品」可以只看某一種；「用電」看哪一區最吃電。', 'Use the filters at the top (Green / Thermal / Nuclear / Demand / Air) to show one kind only; “Demand” shows which region uses the most power.')}</li>
            <li>{tx(`左上角 ⟳：檢查並更新到最新版（目前 v${APP.version}）。`, `⟳ at top-left checks for and installs the latest version (now v${APP.version}).`)}</li>
            <li>{tx('右上角「供電充裕／吃緊」：台電備轉容量率燈號。', '“Supply OK / tight” at top-right is Taipower’s operating-reserve signal.')}</li>
            <li>{tx('資料每 10 分鐘更新一次（台電公布頻率），左下角顯示資料時間。', 'Data refreshes every 10 minutes (Taipower’s publishing interval); the data time is shown at bottom-left.')}</li>
            <li>{tx('iPhone：Safari 開啟 → 分享 → 加入主畫面，就像 App 一樣。', 'iPhone: open in Safari → Share → Add to Home Screen to use it like an app.')}</li>
            <li>{tx('「電廠」可以搜尋電廠或機組，也能看今天哪些機組在歲修、降載；電廠卡下方可以分享連結。', '“Plants” lets you search plants or units and see which are under maintenance today; share a link from the bottom of a plant card.')}</li>
            <li>{tx('電廠卡也有裝置容量、運轉比例，以及台電自有機組過去三個月每天的發電量。', 'Plant cards also show capacity, how hard the plant is running, and daily output of Taipower-owned units over three months.')}</li>
            <li>{tx('「更多 → 線路」：光流沿真實輸電線（預設）或示意光纖；放大地圖可看到超高壓變電所名稱。', '“More → Lines” switches particles between real transmission lines (default) and schematic routes; zoom in to see EHV substation names.')}</li>
            <li>{tx('「亮點」：今天的紀錄、發電組成、去年今天、歷年供需，以及台灣和各國的碳強度、再生能源比較。', '“Peaks”: today’s records, generation mix, this day last year, supply history, and how Taiwan compares with other countries.')}</li>
          </ul>
          <div className="hl-k" style={{ marginTop: 12 }}>{tx('省電模式', 'Power saving')}　<span className="muted">{powerSave ? tx('目前開啟', 'on now') : tx('目前關閉', 'off now')}</span></div>
          <div className="seg seg-wrap">
            {[['auto', tx('自動', 'Auto')], ['on', tx('開', 'On')], ['off', tx('關', 'Off')]].map(([k, label]) => (
              <button key={k} className={power === k ? 'on' : ''} onClick={() => setPowerPref(k)}>{label}</button>
            ))}
          </div>
          <p className="fine">{tx('省電時粒子減半、畫面每秒 20 張。「自動」會在電池低於 20% 且沒有充電、或手機開了節省數據時開啟。App 在背景時不會抓資料。', 'Power saving halves the particles and draws 20 frames per second. “Auto” turns on when the battery is below 20% and not charging, or Data Saver is on. No data is fetched while the app is in the background.')}</p>
        </div>
      )}

      {tab === 'renew' && <RenewTab />}

      {tab === 'source' && (
        <div className="doc">
          <div className="status-row">
            <span className={`dot ${live ? 'live' : 'sim'}`} />
            {live ? tx('目前顯示台電即時資料', 'Showing live Taipower data') : tx('目前顯示模擬資料（無法連到台電）', 'Showing simulated data (cannot reach Taipower)')}
            {snapshot?.timestamp && <span className="muted">　{tx('資料時間', 'Data time')} {snapshot.timestamp}</span>}
          </div>
          <dl>
            <dt>{tx('各機組發電量', 'Unit output')}</dt>
            <dd>
              {tx('台灣電力公司「今日電力資訊」公開資料，每 10 分鐘更新：各機組發電量、各區發電／用電、今日燃料別發電曲線、今日區域用電曲線、供電狀況（備轉容量率與燈號）。',
                'Taipower “Today’s Power Information” open data, updated every 10 minutes: output of each unit, generation/demand by region, today’s generation by fuel, today’s regional demand curve, and supply status (operating reserve and signal).')}
              <a href={APP.taipowerPage} target="_blank" rel="noreferrer">{tx('台電原始頁面 ↗', 'Taipower source page ↗')}</a>
            </dd>
            <dt>{tx('電廠座標與機組對應', 'Plant locations & unit mapping')}</dt>
            <dd>{tx(`本專案整理（src/config/geo.js），以機組名稱比對到 ${PLANTS.length} 個發電節點（含 9 座離岸風場、12 個縣市太陽能群）。離岸風場座標參考維基百科與開發商公開資料。`,
              `Compiled by this project (src/config/geo.js): unit names are matched to ${PLANTS.length} generation nodes (including 9 offshore wind farms and 12 county solar clusters). Offshore wind locations follow Wikipedia and developers’ public data.`)}</dd>
            <dt>{tx('太陽能分配', 'Solar allocation')}</dt>
            <dd>
              {tx(`台電「各縣市太陽光電裝置容量」（${SOLAR_COUNTY_KW.version}）＋ 交通部中央氣象署「日射量」O-A0091-001（每小時）。台電即時資料約 86% 的太陽能沒有位置，依縣市容量 × 當地日照分配。`,
                `Taipower “Installed PV capacity by county” (${SOLAR_COUNTY_KW.version}) + Central Weather Administration solar radiation O-A0091-001 (hourly). About 86% of solar in Taipower’s live data has no location, so it is allocated by county capacity × local sunshine.`)}
            </dd>
            <dt>{tx('空氣品質、風向風速', 'Air quality & wind')}</dt>
            <dd>{tx('環境部「空氣品質指標 AQI」（每小時）；電廠煙道排放為環境部「固定污染源連續自動監測 CEMS」。', 'Ministry of Environment AQI (hourly); stack emissions from the Ministry of Environment’s continuous emission monitoring (CEMS).')}</dd>
            <dt>{tx('未來供電預測', 'Supply forecast')}</dt>
            <dd>{tx('台電「未來兩個月電力供需預測」（每 10 天一筆）。', 'Taipower two-month supply & demand forecast (one value every 10 days).')}</dd>
            <dt>{tx('電廠位置', 'Plant locations')}</dt>
            <dd><a href="https://www.gem.wiki/" target="_blank" rel="noreferrer">Global Energy Monitor</a>{tx('、維基百科「台灣發電廠列表」、OpenStreetMap（豐德、海湖、新桃、國光、星元、星能等民營燃氣電廠；火力、核能、離島電廠已和 OSM 交叉核對，相差約 1.3 公里內）；太陽能群與風場為所在縣市、風場約略中心。', ', Wikipedia “List of power stations in Taiwan” and OpenStreetMap (private gas plants such as Fong Der, Haihu, Hsintao, Kuokuang, Star Buck and Star Energy; thermal, nuclear and island plants cross-checked against OSM, all within about 1.3 km); solar clusters and wind farms are placed at their county or approximate farm centre.')}</dd>
            <dt>{tx('核電廠現況', 'Nuclear plant status')}</dt>
            <dd>{NUCLEAR_SOURCES.map((s, i) => <span key={s.url}>{i ? '；' : ''}<a href={s.url} target="_blank" rel="noreferrer">{isEn() ? s.en : s.label}</a></span>)}{tx(`（整理於 ${NUCLEAR_VERIFIED}）。`, ` (as of ${NUCLEAR_VERIFIED}).`)}</dd>
            <dt>{tx('計畫性停電', 'Planned outages')}</dt>
            <dd><a href="https://data.gov.tw/dataset/26144" target="_blank" rel="noreferrer">{tx('台灣電力公司計畫性工作停電資料', 'Taipower planned work outages')}</a>{tx('（每天 17 時更新；中繼站每天存一份，累積歷史）。', ' (updated daily at 17:00; the relay keeps a daily copy to build history).')}</dd>
            {APP.typhoon && <>
            <dt>{tx('颱風停電', 'Typhoon outages')}</dt>
            <dd><a href="https://service.taipower.com.tw/psvs1/" target="_blank" rel="noreferrer">{tx('台電「天然災害停復電查詢」', 'Taipower disaster outage map')}</a>{tx('（各縣市、鄉鎮目前／曾經停電戶數）。', ' (homes currently / ever without power by county and district).')}</dd>
            </>}
            <dt>{tx('鄉鎮用電', 'Township use')}</dt>
            <dd><a href="https://data.gov.tw/dataset/14135" target="_blank" rel="noreferrer">{tx('台灣電力公司鄉鎮市(郵遞區)別用電統計資料', 'Taipower electricity use by township (postcode)')}</a>{tx('，取「表燈非營業用」每戶平均。', ', residential lighting (non-business) average per customer.')}</dd>
            <dt>{tx('歷年供需', 'Supply history')}</dt>
            <dd><a href="https://data.gov.tw/dataset/19995" target="_blank" rel="noreferrer">{tx('台灣電力公司過去電力供需資訊', 'Taipower past supply & demand')}</a>{tx('（每日尖峰負載、備轉容量率）。', ' (daily peak load and operating reserve).')}</dd>
            <dt>{tx('縣市綠電', 'Renewables by county')}</dt>
            <dd><a href="https://data.gov.tw/dataset/29936" target="_blank" rel="noreferrer">{tx('台灣電力公司各縣市再生能源別購入情形', 'Taipower renewable purchases by county')}</a>{tx('。', '.')}</dd>
            <dt>{tx('電費小手冊', 'Bill handbook')}</dt>
            <dd>{tx('整理自台電網站的電價說明與省電文章，每篇附原始連結。', 'Summarised from Taipower’s tariff notes and energy-saving articles; each item links to the original.')}</dd>
            <dt>{tx('電價與碳排', 'Tariffs & carbon')}</dt>
            <dd>
              {tx('台電「電價表」（114/10/1 公告，115/4/1 凍漲沿用）：住宅與營業用非時間電價、簡易型二段式／三段式時間電價；碳排以經濟部能源署公告電力排碳係數（0.467 kg/度）為基準，依機組類型細分。假日依行政院人事行政總處「政府行政機關辦公日曆表」。',
                'Taipower tariff table (announced 2025-10-01, unchanged on 2026-04-01): residential and commercial tiered rates, simple two- and three-period time-of-use rates. Carbon uses the Energy Administration grid factor (0.467 kg/kWh) as a baseline, refined by unit type. Holidays follow the government office calendar (DGPA).')}
            </dd>
            <dt>{tx('中繼站', 'Relay')}</dt>
            <dd>{tx('Cloudflare Workers：轉送台電、環境部、氣象署資料（解決跨網域、編碼與金鑰），並負責 App 推播通知與同時在線人數。', 'Cloudflare Workers: relays Taipower, MOENV and CWA data (handling CORS, encoding and API keys), sends app push notifications and counts who is online.')}</dd>
            <dt>{tx('縣市界、海岸線', 'County borders & coastline')}</dt>
            <dd>{tx('內政部國土測繪中心開放資料（經 taiwan-atlas 整理）。', 'Ministry of the Interior NLSC open data (via taiwan-atlas).')}</dd>
            <dt>{tx('電廠過去發電量', 'Past plant generation')}</dt>
            <dd><a href="https://data.gov.tw/dataset/37331" target="_blank" rel="noreferrer">{tx('台電「各機組過去發電量」', 'Taipower past generation by unit')}</a>{tx('（2026-03-01～05-31，每 10 分鐘）：只有台電自有機組，加總成每座電廠每天的發電量與最高出力；原檔 4 月 1 日每筆重複出現，已去除。',
              ' (2026-03-01 to 05-31, every 10 min): Taipower-owned units only, summed into each plant’s daily output and peak; duplicate rows on 1 April were removed.')}</dd>
            <dt>{tx('國際比較', 'International comparison')}</dt>
            <dd><a href="https://ember-energy.org/data/yearly-electricity-data/" target="_blank" rel="noreferrer">Ember, Yearly Electricity Data</a>{tx('（CC BY 4.0）：各國電力碳強度與發電組成，每年更新。', ' (CC BY 4.0): carbon intensity and generation mix by country, updated yearly.')}</dd>
            <dt>{tx('輸電線路', 'Transmission lines')}</dt>
            <dd>{tx('© OpenStreetMap 貢獻者（ODbL 授權）：345kV、161kV 線路與超高壓變電所，2026-10-25 擷取。光流沿線路的最短路徑跑，實際電力潮流以台電調度為準；可在「更多 → 線路」改回示意光纖。',
              '© OpenStreetMap contributors (ODbL): 345 kV and 161 kV lines and EHV substations, extracted 2026-10-25. Particles follow the shortest path along the lines; real power flows follow Taipower dispatch. Switch back to schematic routes under More → Lines.')}</dd>
            <dt>{tx('山脈陰影', 'Hillshade')}</dt>
            <dd>Mapzen Terrain Tiles / AWS Open Data。</dd>
            <dt>{tx('日出日落、天色', 'Sunrise, sunset & sky')}</dt>
            <dd>{tx('依台灣經緯度以天文公式計算。', 'Computed astronomically for Taiwan’s latitude and longitude.')}</dd>
            <dt>{tx('系統頻率', 'Grid frequency')}</dt>
            <dd>{tx('台電未公開即時頻率，畫面上的 60.00 Hz 為模擬值。', 'Taipower does not publish live frequency; the 60.00 Hz shown is simulated.')}</dd>
            <dt>{tx('技術', 'Tech')}</dt>
            <dd>MapLibre GL JS、deck.gl、React。</dd>
          </dl>
          {snapshot?.diag?.length > 0 && (
            <>
              <div className="hl-k" style={{ marginTop: 14 }}>{t('連線診斷')}</div>
              <ul className="diag">
                {snapshot.diag.map((d) => {
                  const ago = d.ok ? minutesAgo(d.asOf) : null;
                  return (
                    <li key={d.name} className={d.ok ? (ago != null && ago > 40 && !/昨日|預測/.test(d.name) ? 'stale' : 'ok') : 'fail'}>
                      <span className={`dot ${d.ok ? 'live' : 'sim'}`} />
                      <b>{t(d.name)}</b>
                      <small>{d.ok ? `${t('正常')}${srcLabel(d.url)}${d.detail ? ` · ${d.detail}` : ''}${ago != null && !/昨日|預測/.test(d.name) ? ` · ${agoLabel(ago)}` : ''}` : d.tries.map((x) => `${x.url.replace(/^.*\//, '')}：${x.msg}`).slice(-1)[0] || tx('未嘗試', 'not tried')}</small>
                    </li>
                  );
                })}
                {[
                  ['環境部 AQI', air?.stations?.length > 0, air?.error, air?.asOf, air?.staleAt],
                  ['環境部 CEMS', air?.cems && Object.keys(air.cems).length > 0, air?.cemsError, air?.cemsAsOf],
                  ['氣象署日射量', !!sun?.factors || !!sun?.night, sun?.error, sun?.asOf]
                ].map(([name, ok, err, asOf, staleAt]) => {
                  const ago = ok ? minutesAgo(asOf) : null;
                  return (
                    <li key={name} className={ok ? (staleAt ? 'stale' : 'ok') : 'fail'}>
                      <span className={`dot ${ok ? 'live' : 'sim'}`} />
                      <b>{t(name)}</b>
                      <small>{ok && name === '氣象署日射量' && sun?.night ? tx('正常 · 夜間或日出日落，日照太弱', 'OK · night or low sun') : ok ? `${staleAt ? tx('環境部暫時故障，顯示備份', 'MOENV down — showing backup') : t('正常')}${ago != null ? ` · ${agoLabel(ago)}` : ''}` : tr(err) || t('讀取中…')}</small>
                    </li>
                  );
                })}
              </ul>
              {!live && (
                <p className="fine">
                  {tx('本機版請用「啟動.bat」或桌布伺服器開啟（直接開 HTML 檔無法連到台電）；手機版需等 GitHub Actions 抓到資料。', 'On a PC, open it with 啟動.bat or the wallpaper server (opening the HTML file directly cannot reach Taipower); the mobile site needs GitHub Actions to fetch data first.')}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'accuracy' && (
        <div className="doc">
          <p>{tx('畫面上每個數字都依「證據強度」分級。把滑鼠移到（或點一下）電廠光球，標籤最下方會標示該數值的等級。', 'Every number on screen is graded by strength of evidence. Hover over (or tap) a plant to see the grade at the bottom of its label.')}</p>
          <ul className="evidence">
            {Object.entries(EVIDENCE).map(([k, v]) => (
              <li key={k}>
                <em className={`tag ${k}`}>{t(v.label)}</em>
                <span>{tx(v.desc, v.descEn)}</span>
              </li>
            ))}
          </ul>
          <div className="hl-k" style={{ marginTop: 14 }}>{tx('計算方式', 'How numbers are computed')}</div>
          <ul className="fine-list">
            <li>{tx('燃料分類照台電「今日電力資訊」：抽蓄水力（明潭、大觀二）與電池放電歸「儲能」，不算再生能源。', 'Fuel categories follow Taipower’s live data: pumped hydro (Mingtan, Taikuan II) and battery discharge count as “storage”, not renewables.')}</li>
            <li>{tx('全台發電＝台電各類別小計相加（含儲能放電）；與台電公布的目前用電相差通常不到 0.5%。', 'Total generation = sum of Taipower’s category subtotals (including storage discharge); it usually matches Taipower’s published demand within 0.5%.')}</li>
            <li>{tx('綠能＝太陽能＋風力＋水力＋其他再生能源（地熱、生質能）÷ 全台發電。', 'Green = solar + wind + hydro + other renewables (geothermal, biomass) ÷ total generation.')}</li>
            <li>{tx('對不到電廠的出力：「其它購電太陽能／風力」等依各縣市裝置容量或風場比例分到地圖上的節點，其餘（例如小水力、石門）依同燃料電廠的出力比例分配；汽電共生、電池放電沒有固定位置，只算進全台總量，不畫在地圖上。', 'Output that cannot be tied to a plant: lumped purchased solar and wind are spread over map nodes by county capacity or wind-farm share, and the rest (e.g. small hydro, Shimen) in proportion to same-fuel plants; cogeneration and battery discharge have no fixed location, so they count toward the national total but are not drawn.')}</li>
            <li>{tx('系統頻率：台電沒有公開即時值，畫面上標「模擬」的頻率只是示意。', 'System frequency: Taipower does not publish a live value; the frequency marked “sim” is illustrative only.')}</li>
          </ul>
          <p className="fine">
            {tx('粒子數量與發電量成正比（每 100 MW 每秒 1 顆）。路線預設沿真實輸電線（OpenStreetMap 345kV／161kV 的最短路徑，繞太遠時改用示意路線），也可在「更多 → 線路」改成示意光纖；實際電力潮流由台電調度決定，路線只表示電大致怎麼走。', 'Particle count is proportional to output (1 particle per second per 100 MW). By default particles follow real transmission lines (shortest path over OpenStreetMap 345/161 kV lines, falling back to a schematic route when the detour is too long); switch to schematic routes under More → Lines. Actual power flows are set by Taipower dispatch; routes only show roughly where power goes.')}
          </p>
        </div>
      )}

      {tab === 'about' && (
        <div className="doc">
          <p className="about-title">{APP.name} <span>{APP.en}</span></p>
          <p>{tx('把台電冷冰冰的發電數字，轉成在夜光地圖上流動的能量。發電廠是光源，都市是引力中心，能量沿著西部走廊往北流動。', 'Turning Taipower’s cold numbers into energy flowing across a night-light map. Power plants are light sources, cities are centers of gravity, and energy flows north along the western corridor.')}</p>
          <dl>
            <dt>{tx('設計者', 'Designer')}</dt>
            <dd>{APP.designer}</dd>
            <dt>{tx('版本', 'Version')}</dt>
            <dd>v{APP.version}</dd>
            <dt>{tx('手機版', 'Mobile')}</dt>
            <dd>
              <a href={APP.pagesUrl} target="_blank" rel="noreferrer">{APP.pagesUrl.replace('https://', '')}</a>
              <br />{tx('iPhone：Safari 開啟 → 分享 → 加入主畫面', 'iPhone: Safari → Share → Add to Home Screen')}
            </dd>
          </dl>
          {APP.donate?.some((d) => d.url) && (
            <div className="donate">
              <p>☕ 喜歡光脈動的話，可以請無聊的人喝杯咖啡，支持伺服器與資料費用 🙏</p>
              <div className="donate-btns">
                {APP.donate.filter((d) => d.url).map((d) => (
                  <a key={d.url} className="donate-btn" href={d.url} target="_blank" rel="noreferrer">{d.label}</a>
                ))}
              </div>
              {/* 電腦版：顯示 QR Code 讓手機掃描（手機版直接點按鈕即可） */}
              {APP.donate.filter((d) => d.qr).map((d) => (
                <img key={d.qr} className="donate-qr" src={d.qr} alt="贊助 QR Code" />
              ))}
            </div>
          )}
          <p className="fine">
            {tx('本作品為個人獨立作品，與台灣電力公司無關，非官方服務。畫面中的流向與部分數值為推估或模擬，不能取代台電官方電力資訊。介面概念參考「軌島」，程式碼為獨立撰寫。',
              'An independent personal project, not affiliated with Taipower and not an official service. Flows and some values are estimated or simulated and do not replace Taipower’s official information. The interface concept is inspired by 軌島 (Rail Island); the code is written independently.')}
          </p>
        </div>
      )}
    </Panel>
  );
}
