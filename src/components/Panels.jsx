import { useState } from 'react';
import { APP } from '../config/app.js';
import { EVIDENCE } from '../config/energy.js';
import { Icon, Sparkline, fmtMw } from './widgets.jsx';

/** 面板外框：桌面為浮動卡片，手機為底部抽屜（CSS 依螢幕寬度切換） */
export function Panel({ title, onClose, children }) {
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
export function HighlightsPanel({ hl, onClose }) {
  return (
    <Panel title="今日亮點" onClose={onClose}>
      {!hl ? (
        <p className="muted">資料讀取中…</p>
      ) : (
        <>
          <ul className="hl-list">
            {hl.topPlant && (
              <li>
                <span className="hl-k">目前出力最大</span>
                <span className="hl-v">{hl.topPlant.name}</span>
                <span className="hl-n">{fmtMw(hl.topPlant.mw)} <small>MW</small></span>
              </li>
            )}
            <li>
              <span className="hl-k">太陽能今日尖峰</span>
              {hl.solarPeak ? (
                <>
                  <span className="hl-v gold">{hl.solarPeak.hm}</span>
                  <span className="hl-n">{fmtMw(hl.solarPeak.solar)} <small>MW</small></span>
                </>
              ) : (
                <span className="hl-v muted">日出後開始累計</span>
              )}
            </li>
            <li>
              <span className="hl-k">綠能佔比最高</span>
              <span className="hl-v green">{hl.greenPeak.hm}</span>
              <span className="hl-n">{hl.greenPeak.greenPct.toFixed(1)} <small>%</small></span>
            </li>
            <li>
              <span className="hl-k">全台負載最高</span>
              <span className="hl-v">{hl.loadPeak.hm}</span>
              <span className="hl-n">{fmtMw(hl.loadPeak.load)} <small>MW</small></span>
            </li>
            {hl.southToNorth != null && (
              <li>
                <span className="hl-k">南電北送 <em className="tag est">模型推估</em></span>
                <span className="hl-v">中南部 → 北部</span>
                <span className="hl-n">≈ {fmtMw(Math.round(hl.southToNorth / 50) * 50)} <small>MW</small></span>
              </li>
            )}
          </ul>
          <div className="hl-chart">
            <div className="hl-k">今日綠能佔比</div>
            <Sparkline values={hl.spark} />
          </div>
          <p className="fine">
            {hl.partial ? `今日紀錄從 ${hl.since} 開始（打開頁面後才開始累計）。` : '統計範圍：今日 00:00 至現在。'}
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

export function InfoPanel({ snapshot, onClose }) {
  const [tab, setTab] = useState('source');
  const live = snapshot?.source === 'live';
  return (
    <Panel title="資訊" onClose={onClose}>
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
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
              台灣電力公司「今日電力資訊 — 各機組發電量」，每 10 分鐘更新。
              <a href={APP.taipowerPage} target="_blank" rel="noreferrer">台電原始頁面 ↗</a>
            </dd>
            <dt>電廠座標與機組對應</dt>
            <dd>本專案整理（src/config/geo.js），以機組名稱比對到 16 個發電節點。</dd>
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
          <p className="fine">
            本作品為個人獨立作品，與台灣電力公司無關，非官方服務。畫面中的流向與部分數值為推估或模擬，
            不能取代台電官方電力資訊。介面概念參考「軌島」，程式碼為獨立撰寫。
          </p>
        </div>
      )}
    </Panel>
  );
}
