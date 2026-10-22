import { useEffect, useMemo, useState } from 'react';
import { FUELS, THERMAL, LEGEND_ORDER, FILTERS } from '../config/energy.js';
import { APP } from '../config/app.js';
import { sunTimes } from '../engine/daylight.js';
import { useTween, useFrequency, useClock, fmtTime, fmtDate, fmtMw, rgb, Icon } from './widgets.jsx';
import { HighlightsPanel, InfoPanel } from './Panels.jsx';
import { SupplyChip, DemandPanel, BadgePanel, BadgeToast, AlertBanner, ReplayBar } from './Extras.jsx';
import { twHM } from '../data/history.js';

/**
 * HUD — 絕對乾淨的排版
 *  左上：品牌 + 資料狀態      上中：能源篩選      右上：綠能 / 火力佔比
 *  左下：時間 · 頻率 · 日出日落 下中：工具列（放空 / 亮點 / 資訊）  右下：圖例 + 來源
 *  桌布模式只保留品牌、佔比、時間、巡航場景名與一行來源。
 */
export default function Hud({ snapshot, ui, setUi, highlights, daylight, wallpaper, badges, anomaly, rows, replay, setReplay, onReplayFinish }) {
  const stats = useMemo(() => {
    if (!snapshot) return null;
    const totals = snapshot.totals;
    const all = Object.entries(totals).filter(([f]) => f !== 'storage').reduce((a, [, v]) => a + v, 0) || 1;
    const green = Object.entries(totals).filter(([f]) => FUELS[f]?.green).reduce((a, [, v]) => a + v, 0);
    const thermal = Object.entries(totals).filter(([f]) => THERMAL.has(f)).reduce((a, [, v]) => a + v, 0);
    const bars = LEGEND_ORDER.concat(['cogen', 'otherRe', 'oil'])
      .map((f) => ({ f, share: (totals[f] || 0) / all }))
      .filter((b) => b.share > 0.002);
    return { total: all, green: (green / all) * 100, thermal: (thermal / all) * 100, bars };
  }, [snapshot]);

  const green = useTween(stats?.green);
  const thermal = useTween(stats?.thermal);
  const total = useTween(stats?.total);
  const live = snapshot?.source === 'live';

  return (
    <div className={`hud ${wallpaper ? 'is-wallpaper' : ''}`}>
      <header className="brand">
        <div className="brand-zh">台灣光脈搏</div>
        <div className="brand-en">TAIWAN GRID FLOW</div>
        <div className={`badge ${live ? 'live' : 'sim'}`}>
          <i />
          {replay?.on && snapshot ? `REPLAY · 回放 ${twHM(snapshot.t)}` : snapshot ? (live ? 'LIVE · 台電即時' : 'SIMULATED · 模擬資料') : 'CONNECTING'}
        </div>
      </header>

      {!wallpaper && (
        <nav className="filters" aria-label="能源篩選">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={ui.filter === f.id ? 'on' : ''}
              onClick={() => setUi({ filter: f.id })}
              style={{ '--dot': rgb(f.dot) }}
            >
              <i />{f.label}
            </button>
          ))}
        </nav>
      )}

      <section className="mix">
        <div className="mix-row">
          <span className="mix-label">綠能</span>
          <span className="mix-value green">{green.toFixed(1)}<small>%</small></span>
        </div>
        <div className="mix-row">
          <span className="mix-label">火力</span>
          <span className="mix-value thermal">{thermal.toFixed(1)}<small>%</small></span>
        </div>
        <div className="mix-bar">
          {stats?.bars.map((b) => (
            <span key={b.f} style={{ flexGrow: b.share, background: rgb(FUELS[b.f].color) }} title={FUELS[b.f].label} />
          ))}
        </div>
        <div className="mix-total">{fmtMw(total)} <small>MW · 全台發電</small></div>
        <SupplyChip supply={snapshot?.supply} />
      </section>

      <ClockPanel snapshot={snapshot} daylight={daylight} replayT={replay?.on ? snapshot?.t : null} />

      {!wallpaper && <AlertBanner alert={anomaly?.active} onClose={anomaly?.dismiss} />}
      {!wallpaper && <BadgeToast toast={badges?.toast} onDone={badges?.clearToast} />}
      {!wallpaper && replay?.on && <ReplayBar rows={rows} replay={replay} setReplay={setReplay} onFinish={onReplayFinish} />}

      <div className={`cruise-caption ${ui.shot ? 'show' : ''}`}>
        <span>放空巡航</span>
        <b>{ui.shot || ''}</b>
      </div>

      {!wallpaper && (
        <div className="toolbar">
          <button className={ui.cruise ? 'on' : ''} onClick={() => setUi({ toggleCruise: true })}>
            {Icon.cruise}<span>放空</span>
          </button>
          <button className={ui.panel === 'highlights' ? 'on' : ''} onClick={() => setUi({ panel: ui.panel === 'highlights' ? null : 'highlights' })}>
            {Icon.spark}<span>亮點</span>
          </button>
          <button className={ui.panel === 'badges' ? 'on' : ''} onClick={() => setUi({ panel: ui.panel === 'badges' ? null : 'badges' })}>
            {Icon.medal}<span>徽章</span>
          </button>
          <button className={replay?.on ? 'on' : ''} onClick={() => setUi({ toggleReplay: true })}>
            {Icon.replay}<span>回放</span>
          </button>
          <button className={ui.panel === 'info' ? 'on' : ''} onClick={() => setUi({ panel: ui.panel === 'info' ? null : 'info' })}>
            {Icon.info}<span>資訊</span>
          </button>
          <button className="desktop-only" onClick={toggleFullscreen}>
            {Icon.full}<span>全螢幕</span>
          </button>
        </div>
      )}

      {!wallpaper && (
        <ul className="legend">
          {LEGEND_ORDER.map((f) => (
            <li key={f}>
              <i style={{ background: rgb(FUELS[f].color), boxShadow: `0 0 8px ${rgb(FUELS[f].color)}` }} />
              {FUELS[f].label}
            </li>
          ))}
        </ul>
      )}

      <footer className="sourceline">
        資料：台灣電力公司{live ? '即時' : '（模擬）'} · 內政部 · Mapzen · 流向為模型推估 · 設計：{APP.designer}
      </footer>

      {wallpaper && (
        <>
          <button
            className={`lock-btn ${ui.locked ? '' : 'open'}`}
            onClick={() => setUi(ui.locked ? { unlock: true } : { lock: true })}
            title={ui.locked ? '解鎖以調整畫面' : '鎖定並固定這個畫面'}
          >
            {ui.locked ? Icon.lock : Icon.unlock}
          </button>
          {!ui.locked && (
            <div className="adjust-banner">
              <b>調整模式</b>
              <span>拖曳移動 · 滾輪縮放 · 右鍵拖曳旋轉與傾斜</span>
              <div className="adjust-actions">
                <button className="primary" onClick={() => setUi({ lock: true })}>{Icon.lock}固定這個畫面</button>
                <button onClick={() => setUi({ resumeCruise: true })}>{Icon.cruise}恢復自動巡航</button>
              </div>
              <small>2 分鐘沒有操作會自動固定並鎖定</small>
            </div>
          )}
        </>
      )}

      {ui.panel === 'highlights' && <HighlightsPanel hl={highlights} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'info' && <InfoPanel snapshot={snapshot} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'demand' && <DemandPanel snapshot={snapshot} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'badges' && <BadgePanel badges={badges} live={live} onClose={() => setUi({ panel: null })} />}
    </div>
  );
}

function ClockPanel({ snapshot, daylight, replayT }) {
  const clock = useClock();
  const now = replayT ? new Date(replayT) : clock;
  const freq = useFrequency();
  const [sun, setSun] = useState(() => sunTimes());
  useEffect(() => {
    const id = setInterval(() => setSun(sunTimes()), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const isDay = daylight ? daylight.elev > -0.8 : true;
  return (
    <footer className="clock">
      <div className="clock-time">{fmtTime(now)}</div>
      <div className="clock-meta">
        <span className="freq">{freq.toFixed(2)} Hz</span>
        <span className="dot">·</span>
        <span>{fmtDate(now)}</span>
      </div>
      <div className="clock-sun">
        <span className="sun-ico">{isDay ? Icon.sun : Icon.moon}</span>
        日出 {sun.sunrise}　日落 {sun.sunset}
        {snapshot?.timestamp && <span className="data-time">　資料 {snapshot.timestamp.slice(-5)}</span>}
      </div>
    </footer>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}
