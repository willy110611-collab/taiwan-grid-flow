import { useState } from 'react';
import { APP } from '../config/app.js';
import { EVIDENCE } from '../config/energy.js';
import { Icon, Sparkline, fmtMw } from './widgets.jsx';
import { t, useT } from '../i18n.js';
import { PLANTS, SOLAR_COUNTY_KW } from '../config/geo.js';
import { twHM } from '../data/history.js';

/** 面板外框：桌面為浮動卡片，手機為底部抽屜（CSS 依螢幕寬度切換） */
export function Panel({ title, onClose, children }) {
  useT();
  title = t(title);
  return (
    <section className="panel" role="dialog" aria-label={title}>
      <div className="panel-grip" onClick={onClose} />
      <header className="panel-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="關閉">{Icon.close}</button>
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

export function HighlightsPanel({ hl, records, onClose }) {
  useT();
  return (
    <Panel title="今日亮點" onClose={onClose}>
      {!hl ? (
        <p className="muted">{t('資料讀取中…')}</p>
      ) : (
        <>
          <ul className="hl-list">
            {hl.topPlant && (
              <li>
                <span className="hl-k">{t('目前出力最大')}</span>
                <span className="hl-v">{hl.topPlant.name}</span>
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
            {hl.southToNorth != null && (
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
          <div className="hl-chart">
            <div className="hl-k">{t('今日綠能佔比')}</div>
            <Sparkline values={hl.spark} />
          </div>
          {records && REC_ROWS.some(([k]) => records[k]) && (
            <div className="hl-anom">
              <div className="hl-k">{t('我的紀錄')}<small className="muted">　{t('這台裝置看過的最高值')}{records.since ? `（${md(records.since).split(' ')[0]} 起）` : ''}</small></div>
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
            {hl.partial ? `今日紀錄從 ${hl.since} 開始（打開頁面後才開始累計）。` : t('統計範圍：今日 00:00 至現在。')}
          </p>
        </>
      )}
    </Panel>
  );
}

/* ───────────── 資訊（資料來源 / 準確度 / 關於） ───────────── */
const TABS = [
  ['source', '資料來源'],
  ['accuracy', '準確度'],
  ['about', '關於']
];

export function InfoPanel({ snapshot, air, sun, onClose, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'source');
  const live = snapshot?.source === 'live';
  return (
    <Panel title="資訊" onClose={onClose}>
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t(label)}</button>
        ))}
      </nav>

      {tab === 'source' && (
        <div className="doc">
          <div className="status-row">
            <span className={`dot ${live ? 'live' : 'sim'}`} />
            {live ? '目前顯示台電即時資料' : '目前顯示模擬資料（無法連到台電）'}
            {snapshot?.timestamp && <span className="muted">　資料時間 {snapshot.timestamp}</span>}
          </div>
          <dl>
            <dt>各機組發電量</dt>
            <dd>
              台灣電力公司「今日電力資訊」公開資料，每 10 分鐘更新：各機組發電量、各區發電／用電、
              今日燃料別發電曲線、今日區域用電曲線、供電狀況（備轉容量率與燈號）。
              <a href={APP.taipowerPage} target="_blank" rel="noreferrer">台電原始頁面 ↗</a>
            </dd>
            <dt>電廠座標與機組對應</dt>
            <dd>本專案整理（src/config/geo.js），以機組名稱比對到 {PLANTS.length} 個發電節點（含 9 座離岸風場、12 個縣市太陽能群）。離岸風場座標參考維基百科與開發商公開資料。</dd>
            <dt>太陽能分配</dt>
            <dd>
              台電「各縣市太陽光電裝置容量」（{SOLAR_COUNTY_KW.version}）＋ 交通部中央氣象署「日射量」O-A0091-001（每小時）。
              台電即時資料約 86% 的太陽能沒有位置，依縣市容量 × 當地日照分配。
            </dd>
            <dt>空氣品質、風向風速</dt>
            <dd>環境部「空氣品質指標 AQI」（每小時）；電廠煙道排放為環境部「固定污染源連續自動監測 CEMS」。</dd>
            <dt>未來供電預測</dt>
            <dd>台電「未來兩個月電力供需預測」（每 10 天一筆）。</dd>
            <dt>電價與碳排</dt>
            <dd>
              台電「電價表」（114/10/1 起）住宅非時間電價與簡易型二段式時間電價；
              碳排以經濟部能源署公告電力排碳係數（0.467 kg/度）為基準，依機組類型細分。
              假日依行政院人事行政總處「政府行政機關辦公日曆表」。
            </dd>
            <dt>中繼站</dt>
            <dd>Cloudflare Workers：轉送台電、環境部、氣象署資料（解決跨網域、編碼與金鑰），並負責 LINE／網頁推播通知。</dd>
            <dt>縣市界、海岸線</dt>
            <dd>內政部國土測繪中心開放資料（經 taiwan-atlas 整理）。</dd>
            <dt>山脈陰影</dt>
            <dd>Mapzen Terrain Tiles / AWS Open Data。</dd>
            <dt>日出日落、天色</dt>
            <dd>依台灣經緯度以天文公式計算。</dd>
            <dt>系統頻率</dt>
            <dd>台電未公開即時頻率，畫面上的 60.00 Hz 為模擬值。</dd>
            <dt>技術</dt>
            <dd>MapLibre GL JS、deck.gl、React。</dd>
          </dl>
          {snapshot?.diag?.length > 0 && (
            <>
              <div className="hl-k" style={{ marginTop: 14 }}>連線診斷</div>
              <ul className="diag">
                {snapshot.diag.map((d) => (
                  <li key={d.name} className={d.ok ? 'ok' : 'fail'}>
                    <span className={`dot ${d.ok ? 'live' : 'sim'}`} />
                    <b>{d.name}</b>
                    <small>{d.ok ? '正常' : d.tries.map((t) => `${t.url.replace(/^.*\//, '')}：${t.msg}`).slice(-1)[0] || '未嘗試'}</small>
                  </li>
                ))}
                {[
                  ['環境部 AQI', air?.stations?.length > 0, air?.error],
                  ['環境部 CEMS', air?.cems && Object.keys(air.cems).length > 0, air?.cemsError],
                  ['氣象署日射量', !!sun?.factors, sun?.error]
                ].map(([name, ok, err]) => (
                  <li key={name} className={ok ? 'ok' : 'fail'}>
                    <span className={`dot ${ok ? 'live' : 'sim'}`} />
                    <b>{name}</b>
                    <small>{ok ? t('正常') : err || '讀取中…'}</small>
                  </li>
                ))}
              </ul>
              {!live && (
                <p className="fine">
                  本機版請用「啟動.bat」或桌布伺服器開啟（直接開 HTML 檔無法連到台電）；手機版需等 GitHub Actions 抓到資料。
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'accuracy' && (
        <div className="doc">
          <p>畫面上每個數字都依「證據強度」分級。把滑鼠移到（或點一下）電廠光球，標籤最下方會標示該數值的等級。</p>
          <ul className="evidence">
            {Object.entries(EVIDENCE).map(([k, v]) => (
              <li key={k}>
                <em className={`tag ${k}`}>{v.label}</em>
                <span>{v.desc}</span>
              </li>
            ))}
          </ul>
          <p className="fine">
            粒子數量與發電量成正比（每 100 MW 每秒 1 顆）；粒子的路線是示意，沿西部 345kV 走廊的大致走向，不代表實際輸電線位置。
          </p>
        </div>
      )}

      {tab === 'about' && (
        <div className="doc">
          <p className="about-title">{APP.name} <span>{APP.en}</span></p>
          <p>把台電冷冰冰的發電數字，轉成在夜光地圖上流動的能量。發電廠是光源，都市是引力中心，能量沿著西部走廊往北流動。</p>
          <dl>
            <dt>設計者</dt>
            <dd>{APP.designer}</dd>
            <dt>版本</dt>
            <dd>v{APP.version}</dd>
            <dt>手機版</dt>
            <dd>
              <a href={APP.pagesUrl} target="_blank" rel="noreferrer">{APP.pagesUrl.replace('https://', '')}</a>
              <br />iPhone：Safari 開啟 → 分享 → 加入主畫面
            </dd>
          </dl>
          {APP.donate?.some((d) => d.url) && (
            <div className="donate">
              <p>☕ 喜歡光脈搏的話，可以請無聊的人喝杯咖啡，支持伺服器與資料費用 🙏</p>
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
            本作品為個人獨立作品，與台灣電力公司無關，非官方服務。畫面中的流向與部分數值為推估或模擬，
            不能取代台電官方電力資訊。介面概念參考「軌島」，程式碼為獨立撰寫。
          </p>
        </div>
      )}
    </Panel>
  );
}
