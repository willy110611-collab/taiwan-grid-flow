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
import { StorePanel } from './Store.jsx';
import { FinderPanel } from './Finder.jsx';
import { AppliancePanel, TyphoonBanner, TyphoonPanel } from './OpenData.jsx';
import { useTyphoon } from '../data/openData.js';
import { NuclearPanel } from './Nuclear.jsx';
import { Guard } from './Guard.jsx';
import { useT, useLang, tx } from '../i18n.js';
import { UpdatePrompt, RefreshBtn, Tour, DataIssue } from './Guide.jsx';
import { useUpdate } from '../update.js';

/**
 * HUD — 絕對乾淨的排版
 *  左上：品牌 + 資料狀態      上中：能源篩選      右上：綠能 / 火力佔比
 *  左下：時間 · 頻率 · 日出日落 下中：工具列（放空 / 亮點 / 資訊）  右下：圖例 + 來源
 *  桌布模式只保留品牌、佔比、時間、巡航場景名與一行來源。
 */
export default function Hud({ snapshot, ui, setUi, highlights, daylight, wallpaper, badges, anomaly, rows, replay, setReplay, onReplayFinish, home, setHome, homeSum, advice, air, hasYesterday, sun, records, powerSave, power, getView }) {
  const stats = useMemo(() => {
    if (!snapshot) return null;
    const totals = snapshot.totals;
    const all = Object.entries(totals).reduce((a, [, v]) => a + v, 0) || 1;
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
  // 用電（loadpara）和發電（genary）是台電不同檔案，時間可能差 10 分鐘：不同時在用電那行標出時間
  const useTime = String(snapshot?.supply?.time || '').match(/(\d{1,2}:\d{2})\s*$/)?.[1];
  const live = snapshot?.source === 'live';
  const t = useT();
  const [lang, setLang] = useLang();
  const charge = (snapshot?.charging?.pump || 0) + (snapshot?.charging?.battery || 0);
  const upd = useUpdate();
  const hasIssue = (snapshot?.diag || []).some((d) => !d.ok);
  const [more, setMore] = useState(false);
  const typhoon = useTyphoon(APP.typhoon && !wallpaper);

  return (
    <div className={`hud ${wallpaper ? 'is-wallpaper' : ''}`}>
      <header className="brand">
        <div className="brand-zh">台灣光脈動</div>
        <div className="brand-en">TAIWAN GRID FLOW</div>
        <div className={`badge ${live ? 'live' : 'sim'}`}>
          <i />
          {replay?.on && snapshot ? `REPLAY · ${snapshot.yesterday ? t('昨天') : t('回放')} ${twHM(snapshot.t)}` : snapshot ? (snapshot.stale ? `${t('讀不到最新 · 顯示')} ${twHM(snapshot.t)}` : snapshot.cached ? `${t('更新中 · 上次')} ${twHM(snapshot.t)}` : t(live ? 'LIVE · 台電即時' : 'SIMULATED · 模擬資料')) : 'CONNECTING'}
        </div>
        {!wallpaper && (
          <button className="lang-btn" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} aria-label="切換語言 / Language">
            {lang === 'en' ? '中文' : 'EN'}
          </button>
        )}
        {!wallpaper && <RefreshBtn />}
        {!wallpaper && live && !replay?.on && Number.isFinite(snapshot?.online) && snapshot.online > 0 && (
          <div className="online-count" title={tx('最近 12 分鐘有開著光脈動的分頁數', 'Tabs with Taiwan Grid Flow open in the last 12 minutes')}>
            {snapshot.online === 1 ? tx('目前只有你在線', 'Only you online') : tx(`${snapshot.online.toLocaleString()} 人同時在線`, `${snapshot.online.toLocaleString()} online now`)}
          </div>
        )}
        {!wallpaper && <DataIssue snapshot={snapshot} air={air} onOpen={() => setUi({ panel: 'info', infoTab: 'diag' })} />}
      </header>

      {!wallpaper && (
        <nav className="filters" aria-label={tx('能源篩選', 'Energy filter')}>
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
        {loadMw ? <div className="mix-total">{fmtMw(load)} <small>{t('MW · 全台用電')}{useTime && useTime !== snapshot?.timestamp?.slice(-5) ? ` ${useTime}` : ''}</small></div> : null}
        {charge > 20 ? <div className="mix-total charge">⇢ {fmtMw(charge)} <small>{t('MW · 儲能充電中')}</small></div> : null}
        <SupplyChip supply={snapshot?.supply} />
        {!wallpaper && <HomeCard className="hc-desktop" sum={homeSum} advice={advice} onOpen={() => setUi({ panel: ui.panel === 'home' ? null : 'home' })} />}
      </section>

      {/* 手機：「可以用電」小卡放在右下（時鐘對面），不壓在台灣上 */}
      {!wallpaper && !replay?.on && <HomeCard className="hc-mobile" sum={homeSum} advice={advice} onOpen={() => setUi({ panel: ui.panel === 'home' ? null : 'home' })} />}

      <ClockPanel snapshot={snapshot} daylight={daylight} replayT={replay?.on ? snapshot?.t : null} />

      {!wallpaper && <AlertBanner alert={anomaly?.active} onClose={anomaly?.dismiss} />}
      {APP.typhoon && !wallpaper && !anomaly?.active && <TyphoonBanner data={typhoon.data} onOpen={() => { setMore(false); setUi({ panel: 'typhoon' }); }} />}
      {!wallpaper && <BadgeToast toast={badges?.toast} onDone={badges?.clearToast} />}
      {!wallpaper && replay?.on && <ReplayBar rows={rows} hasYesterday={hasYesterday} replay={replay} setReplay={setReplay} onFinish={onReplayFinish} />}

      {ui.picking && (
        <div className="pick-banner">
          <b>{t('點地圖選擇「我的家」')}</b>
          <button onClick={() => setUi({ cancelPick: true })}>{t('取消')}</button>
        </div>
      )}

      {!wallpaper && (ui.cruise || ui.away) && (
        <button className="reset-view" onClick={() => setUi({ resetView: true })} title={t('回到全島俯視圖')}>
          {Icon.globe}<span>{t('全島')}</span>
        </button>
      )}

      <div className={`cruise-caption ${ui.shot ? 'show' : ''}`}>
        <span>{t('放空巡航')}</span>
        <b>{t(ui.shot || '')}</b>
      </div>

      {!wallpaper && (
        <div className="toolbar">
          <button className={ui.panel === 'home' ? 'on' : ''} onClick={() => { setMore(false); setUi({ panel: ui.panel === 'home' ? null : 'home' }); }}>
            {Icon.home}<span>{t('我的家')}</span>
          </button>
          <button className={ui.panel === 'finder' || ui.panel === 'plant' ? 'on' : ''} onClick={() => { setMore(false); setUi({ panel: ui.panel === 'finder' ? null : 'finder' }); }}>
            {Icon.search}<span>{t('電廠')}</span>
          </button>
          <button className={replay?.on ? 'on' : ''} onClick={() => { setMore(false); setUi({ toggleReplay: true }); }}>
            {Icon.replay}<span>{t('回放')}</span>
          </button>
          <button className={ui.cruise ? 'on' : ''} onClick={() => { setMore(false); setUi({ toggleCruise: true }); }}>
            {Icon.cruise}<span>{t('放空')}</span>
          </button>
          <button className={more || MORE_PANELS.includes(ui.panel) ? 'on' : ''} onClick={() => setMore(!more)} aria-expanded={more}>
            {Icon.more}<span>{t('更多')}</span>{hasIssue && <i className="tb-dot" />}
          </button>
          {more && (
            <div className="more-menu" role="menu">
              {[
                ['appliance', Icon.plug, '家電', '電費試算・小手冊'],
                ['store', Icon.store, '店家', '店家用電試算'],
                ['highlights', Icon.spark, '亮點', '今日紀錄'],
                ['badges', Icon.medal, '徽章', '收集成就'],
                ['info', Icon.info, '資訊', '說明・資料來源'],
              ].map(([id, ico, label, sub]) => (
                <button key={id} role="menuitem" className={ui.panel === id ? 'on' : ''} onClick={() => { setMore(false); setUi({ panel: ui.panel === id ? null : id, infoTab: null }); }}>
                  {ico}<b>{t(label)}</b><small>{t(sub)}</small>{id === 'info' && hasIssue && <i className="tb-dot" />}
                </button>
              ))}
              <button className="desktop-only" role="menuitem" onClick={() => { setMore(false); toggleFullscreen(); }}>
                {Icon.full}<b>{t('全螢幕')}</b><small>{t('電腦版')}</small>
              </button>
            </div>
          )}
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
          <> · <button className="donate-link" onClick={() => setUi({ panel: 'info', infoTab: 'about' })}>☕ {t('贊助')}</button></>
        )}
      </footer>

      {wallpaper && (
        <>
          <button
            className={`lock-btn ${ui.locked ? '' : 'open'}`}
            onClick={() => setUi(ui.locked ? { unlock: true } : { lock: true })}
            title={t(ui.locked ? '解鎖以調整畫面' : '鎖定並固定這個畫面')}
          >
            {ui.locked ? Icon.lock : Icon.unlock}
          </button>
          {!ui.locked && (
            <div className="adjust-banner">
              <b>{t('調整模式')}</b>
              <span>{t('拖曳移動 · 滾輪縮放 · 右鍵拖曳旋轉與傾斜')}</span>
              <div className="adjust-actions">
                <button className="primary" onClick={() => setUi({ lock: true })}>{Icon.lock}{t('固定這個畫面')}</button>
                <button onClick={() => setUi({ resumeCruise: true })}>{Icon.cruise}{t('恢復自動巡航')}</button>
              </div>
              <small>{t('2 分鐘沒有操作會自動固定並鎖定')}</small>
            </div>
          )}
        </>
      )}

      {!wallpaper && <UpdatePrompt />}
      {!wallpaper && !(upd.available && !upd.dismissed) && <Tour />}

      {ui.panel === 'highlights' && <Guard key={'g-highlights'} name="highlights" onClose={() => setUi({ panel: null })}><HighlightsPanel hl={highlights} live={live} records={records} onPlant={(id) => setUi({ panel: 'plant', plantId: id })} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'info' && <Guard key={'g-info'} name="info" onClose={() => setUi({ panel: null })}><InfoPanel key={ui.infoTab || 'x'} initialTab={ui.infoTab} snapshot={snapshot} air={air} sun={sun} power={power} powerSave={powerSave} onClose={() => setUi({ panel: null, infoTab: null })} /></Guard>}
      {ui.panel === 'demand' && <Guard key={'g-demand'} name="demand" onClose={() => setUi({ panel: null })}><DemandPanel snapshot={snapshot} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'home' && <Guard key={'g-home'} name="home" onClose={() => setUi({ panel: null })}><HomePanel onPick={() => setUi({ pickHome: true })} onMarks={(m) => setUi({ outageMarks: m })} home={home} setHome={setHome} sum={homeSum} advice={advice} snapshot={snapshot} air={air} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'nuclear' && <Guard key={'g-nuclear'} name="nuclear" onClose={() => setUi({ panel: null })}><NuclearPanel snapshot={snapshot} onPlant={(id) => setUi({ panel: 'plant', plantId: id })} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'air' && <Guard key={'g-air'} name="air" onClose={() => setUi({ panel: null })}><AirPanel air={air} snapshot={snapshot} home={home} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'plant' && ui.plantId && <Guard key={'g-plant'} name="plant" onClose={() => setUi({ panel: null })}><PlantPanel key={ui.plantId} id={ui.plantId} snapshot={snapshot} air={air} rows={replay?.on ? null : rows} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'finder' && <Guard key={'g-finder'} name="finder" onClose={() => setUi({ panel: null })}><FinderPanel snapshot={snapshot} getView={getView} onOpen={(id) => setUi({ openPlant: id })} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'store' && <Guard key={'g-store'} name="store" onClose={() => setUi({ panel: null })}><StorePanel onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'appliance' && <Guard key={'g-appliance'} name="appliance" onClose={() => setUi({ panel: null })}><AppliancePanel home={home} onClose={() => setUi({ panel: null })} /></Guard>}
      {APP.typhoon && ui.panel === 'typhoon' && <Guard key={'g-typhoon'} name="typhoon" onClose={() => setUi({ panel: null })}><TyphoonPanel data={typhoon.data} home={home} onClose={() => setUi({ panel: null })} /></Guard>}
      {ui.panel === 'badges' && <Guard key={'g-badges'} name="badges" onClose={() => setUi({ panel: null })}><BadgePanel badges={badges} live={live} onClose={() => setUi({ panel: null })} /></Guard>}
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
        <span className="freq" title={tx('台電沒有公開即時頻率，這是模擬值', 'Taipower does not publish live frequency; this is simulated')}>{freq.toFixed(2)} Hz <small>{tx('模擬', 'sim')}</small></span>
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

const MORE_PANELS = ['appliance', 'store', 'highlights', 'badges', 'info'];

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}
