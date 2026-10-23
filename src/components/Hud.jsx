import { useEffect, useMemo, useState } from 'react';
import { FUELS, THERMAL, LEGEND_ORDER, FILTERS } from '../config/energy.js';
import { APP } from '../config/app.js';
import { sunTimes } from '../engine/daylight.js';
import { useTween, useFrequency, useClock, fmtTime, fmtDate, fmtMw, rgb, Icon } from './widgets.jsx';
import { HighlightsPanel, InfoPanel } from './Panels.jsx';
import { SupplyChip, DemandPanel, BadgePanel, BadgeToast, AlertBanner, ReplayBar } from './Extras.jsx';
import { twHM } from '../data/history.js';
import { HomeCard, HomePanel, AirPanel } from './Life.jsx';
import { PlantPanel } from './Plant.jsx';
import { useT, useLang } from '../i18n.js';
import { UpdatePrompt, RefreshBtn, Tour, DataIssue } from './Guide.jsx';
import { useUpdate } from '../update.js';

/**
 * HUD — 絕對乾淨的排版
 *  左上：品牌 + 資料狀態      上中：能源篩選      右上：綠能 / 火力佔比
 *  左下：時間 · 頻率 · 日出日落 下中：工具列（放空 / 亮點 / 資訊）  右下：圖例 + 來源
 *  桌布模式只保留品牌、佔比、時間、巡航場景名與一行來源。
 */
export default function Hud({ snapshot, ui, setUi, highlights, daylight, wallpaper, badges, anomaly, rows, replay, setReplay, onReplayFinish, home, setHome, homeSum, advice, air, hasYesterday, sun, records }) {
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
  // 即時用電：台電 loadpara「目前用電量」（= 北中南東四區用電加總），每 10 分鐘更新
  const loadMw = snapshot?.supply?.load ?? (snapshot?.regions?.evidence === 'live'
    ? Object.values(snapshot.regions.byKey).reduce((a, r) => a + r.load, 0) : null);
  const load = useTween(loadMw ?? 0);
  const live = snapshot?.source === 'live';
  const t = useT();
  const [lang, setLang] = useLang();
  const charge = (snapshot?.charging?.pump || 0) + (snapshot?.charging?.battery || 0);
  const upd = useUpdate();
  const hasIssue = (snapshot?.diag || []).some((d) => !d.ok);

  return (
    <div className={`hud ${wallpaper ? 'is-wallpaper' : ''}`}>
      <header className="brand">
        <div className="brand-zh">台灣光脈搏</div>
        <div className="brand-en">TAIWAN GRID FLOW</div>
        <div className={`badge ${live ? 'live' : 'sim'}`}>
          <i />
          {replay?.on && snapshot ? `REPLAY · ${snapshot.yesterday ? t('昨天') : t('回放')} ${twHM(snapshot.t)}` : snapshot ? (snapshot.cached ? `${t('更新中 · 上次')} ${twHM(snapshot.t)}` : t(live ? 'LIVE · 台電即時' : 'SIMULATED · 模擬資料')) : 'CONNECTING'}
        </div>
        {!wallpaper && (
          <button className="lang-btn" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} aria-label="切換語言 / Language">
            {lang === 'en' ? '中文' : 'EN'}
          </button>
        )}
        {!wallpaper && <RefreshBtn />}
        {!wallpaper && <DataIssue snapshot={snapshot} air={air} onOpen={() => setUi({ panel: 'info', infoTab: 'diag' })} />}
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
              <i />{t(f.label)}
            </button>
          ))}
        </nav>
      )}

      <section className="mix">
        <div className="mix-row">
          <span className="mix-label">{t('綠能')}</span>
          <span className="mix-value green">{green.toFixed(1)}<small>%</small></span>
        </div>
        <div className="mix-row">
          <span className="mix-label">{t('火力')}</span>
          <span className="mix-value thermal">{thermal.toFixed(1)}<small>%</small></span>
        </div>
        <div className="mix-bar">
          {stats?.bars.map((b) => (
            <span key={b.f} style={{ flexGrow: b.share, background: rgb(FUELS[b.f].color) }} title={t(FUELS[b.f].label)} />
          ))}
        </div>
        <div className="mix-total">{fmtMw(total)} <small>{t('MW · 全台發電')}</small></div>
        {loadMw ? <div className="mix-total">{fmtMw(load)} <small>{t('MW · 全台用電')}</small></div> : null}
        {charge > 20 ? <div className="mix-total charge">⇢ {fmtMw(charge)} <small>{t('MW · 儲能充電中')}</small></div> : null}
        <SupplyChip supply={snapshot?.supply} />
        {!wallpaper && <HomeCard className="hc-desktop" sum={homeSum} advice={advice} onOpen={() => setUi({ panel: ui.panel === 'home' ? null : 'home' })} />}
      </section>

      {/* 手機：「可以用電」小卡放在右下（時鐘對面），不壓在台灣上 */}
      {!wallpaper && !replay?.on && <HomeCard className="hc-mobile" sum={homeSum} advice={advice} onOpen={() => setUi({ panel: ui.panel === 'home' ? null : 'home' })} />}

      <ClockPanel snapshot={snapshot} daylight={daylight} replayT={replay?.on ? snapshot?.t : null} />

      {!wallpaper && <AlertBanner alert={anomaly?.active} onClose={anomaly?.dismiss} />}
      {!wallpaper && <BadgeToast toast={badges?.toast} onDone={badges?.clearToast} />}
      {!wallpaper && replay?.on && <ReplayBar rows={rows} hasYesterday={hasYesterday} replay={replay} setReplay={setReplay} onFinish={onReplayFinish} />}

      {ui.picking && (
        <div className="pick-banner">
          <b>{t('點地圖選擇「我的家」')}</b>
          <button onClick={() => setUi({ cancelPick: true })}>{t('取消')}</button>
        </div>
      )}

      {!wallpaper && (ui.cruise || ui.away) && (
        <button className="reset-view" onClick={() => setUi({ resetView: true })} title="回到全島俯視圖">
          {Icon.globe}<span>{t('全島')}</span>
        </button>
      )}

      <div className={`cruise-caption ${ui.shot ? 'show' : ''}`}>
        <span>{t('放空巡航')}</span>
        <b>{t(ui.shot || '')}</b>
      </div>

      {!wallpaper && (
        <div className="toolbar">
          <button className={ui.cruise ? 'on' : ''} onClick={() => setUi({ toggleCruise: true })}>
            {Icon.cruise}<span>{t('放空')}</span>
          </button>
          <button className={ui.panel === 'home' ? 'on' : ''} onClick={() => setUi({ panel: ui.panel === 'home' ? null : 'home' })}>
            {Icon.home}<span>{t('我的家')}</span>
          </button>
          <button className={ui.panel === 'highlights' ? 'on' : ''} onClick={() => setUi({ panel: ui.panel === 'highlights' ? null : 'highlights' })}>
            {Icon.spark}<span>{t('亮點')}</span>
          </button>
          <button className={ui.panel === 'badges' ? 'on' : ''} onClick={() => setUi({ panel: ui.panel === 'badges' ? null : 'badges' })}>
            {Icon.medal}<span>{t('徽章')}</span>
          </button>
          <button className={replay?.on ? 'on' : ''} onClick={() => setUi({ toggleReplay: true })}>
            {Icon.replay}<span>{t('回放')}</span>
          </button>
          <button className={ui.panel === 'info' ? 'on' : ''} onClick={() => setUi({ panel: ui.panel === 'info' ? null : 'info', infoTab: null })}>
            {Icon.info}<span>{t('資訊')}</span>{hasIssue && <i className="tb-dot" />}
          </button>
          <button className="desktop-only" onClick={toggleFullscreen}>
            {Icon.full}<span>{t('全螢幕')}</span>
          </button>
        </div>
      )}

      {!wallpaper && (
        <ul className="legend">
          {LEGEND_ORDER.map((f) => (
            <li key={f}>
              <i style={{ background: rgb(FUELS[f].color), boxShadow: `0 0 8px ${rgb(FUELS[f].color)}` }} />
              {t(FUELS[f].label)}
            </li>
          ))}
        </ul>
      )}

      <footer className="sourceline">
        {lang === 'en' ? `Data: Taipower${live ? '' : ' (sim)'} · MOENV · CWA · MOI · Mapzen · flows are modeled · Design: ${APP.designer}` : <>資料：台灣電力公司{live ? '即時' : '（模擬）'} · 環境部 · 氣象署 · 內政部 · Mapzen · 流向為模型推估 · 設計：{APP.designer}</>}
        {!wallpaper && APP.donate?.some((d) => d.url) && (
          <> · <button className="donate-link" onClick={() => setUi({ panel: 'info', infoTab: 'about' })}>☕ 贊助</button></>
        )}
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

      {!wallpaper && <UpdatePrompt />}
      {!wallpaper && !(upd.available && !upd.dismissed) && <Tour />}

      {ui.panel === 'highlights' && <HighlightsPanel hl={highlights} records={records} onPlant={(id) => setUi({ panel: 'plant', plantId: id })} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'info' && <InfoPanel key={ui.infoTab || 'x'} initialTab={ui.infoTab} snapshot={snapshot} air={air} sun={sun} onClose={() => setUi({ panel: null, infoTab: null })} />}
      {ui.panel === 'demand' && <DemandPanel snapshot={snapshot} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'home' && <HomePanel onPick={() => setUi({ pickHome: true })} home={home} setHome={setHome} sum={homeSum} advice={advice} snapshot={snapshot} air={air} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'air' && <AirPanel air={air} snapshot={snapshot} home={home} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'plant' && ui.plantId && <PlantPanel key={ui.plantId} id={ui.plantId} snapshot={snapshot} air={air} onClose={() => setUi({ panel: null })} />}
      {ui.panel === 'badges' && <BadgePanel badges={badges} live={live} onClose={() => setUi({ panel: null })} />}
    </div>
  );
}

function ClockPanel({ snapshot, daylight, replayT }) {
  const t = useT();
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
        {t('日出')} {sun.sunrise}　{t('日落')} {sun.sunset}
        {snapshot?.timestamp && <span className="data-time">　{t('資料')} {snapshot.timestamp.slice(-5)}</span>}
      </div>
    </footer>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}
