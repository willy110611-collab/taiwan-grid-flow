import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridFlowMap from './components/GridFlowMap.jsx';
import Hud from './components/Hud.jsx';
import { useGridData } from './data/useGridData.js';
import { useHighlights } from './data/useHighlights.js';
import { useDayHistory } from './data/history.js';
import { useBadges } from './data/badges.js';
import { useAnomalies } from './data/useAnomalies.js';
import { useAir, nearestStation } from './data/useAir.js';
import { useHome, useNotify, townName } from './data/useHome.js';
import { usageAdvice } from './data/advice.js';
import { homeSummary } from './components/Life.jsx';

/**
 * 網址參數
 *  ?mode=wallpaper  桌布模式（Lively Wallpaper 用）：預設鎖定、自動放空巡航、30fps
 *  ?sim=1           強制模擬資料
 *  ?density=2       粒子密度倍率
 *  ?fps=60          強制幀率
 *  ?demo=anomaly    展示機組異常橫幅
 */
const params = new URLSearchParams(location.search);
const WALLPAPER = params.get('mode') === 'wallpaper';
const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DENSITY = Number(params.get('density')) || (REDUCE ? 0.4 : MOBILE ? 0.8 : 1);
// 省電：手機與桌布預設 30fps（仿軌島手機預設省電模式）
const FPS = Number(params.get('fps')) || (WALLPAPER || MOBILE ? 30 : 60);

// 桌布固定視角：解鎖調整後鎖定時存起來，重開機也維持
const VIEW_KEY = 'tgf-wallpaper-view';
const AUTO_LOCK_MS = 2 * 60 * 1000; // 解鎖後 2 分鐘沒動作自動鎖定
function loadView() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY)); } catch { return null; }
}
function saveView(v) {
  try { v ? localStorage.setItem(VIEW_KEY, JSON.stringify(v)) : localStorage.removeItem(VIEW_KEY); } catch { /* 無法儲存時只在本次有效 */ }
}
const SAVED_VIEW = WALLPAPER ? loadView() : null;

export default function App() {
  const snapshot = useGridData();
  const rows = useDayHistory(snapshot);
  const anomaly = useAnomalies(snapshot);
  const engine = useRef(null);
  const [stats, setStats] = useState(null);
  const [daylight, setDaylight] = useState(null);
  const [replay, setReplay] = useState({ on: false, idx: 0, playing: false, speed: 300 });
  const [ui, setUiState] = useState({ filter: 'all', panel: null, cruise: WALLPAPER && !SAVED_VIEW, shot: null, locked: true, fixedView: !!SAVED_VIEW });
  const lockTimer = useRef(null);
  const pickCancel = useRef(null);
  const setHomeRef = useRef(null);

  // 回放中顯示歷史快照，否則顯示即時快照
  const shown = replay.on && rows.length ? rows[Math.min(rows.length - 1, Math.floor(replay.idx))] : snapshot;
  const badges = useBadges(snapshot, rows, { replaying: replay.on });
  const highlights = useHighlights(snapshot, rows, stats, anomaly.list);
  const air = useAir();
  const { home, setHome } = useHome();
  setHomeRef.current = setHome;
  const advice = useMemo(
    () => usageAdvice(shown, rows, snapshot?.curves?.yesterday, { touUser: home.touUser }),
    [shown, rows, snapshot?.curves?.yesterday, home.touUser]
  );
  const homeSum = useMemo(() => homeSummary({ home, snapshot: shown, air, rows, advice }), [home, shown, air, rows, advice]);
  useEffect(() => { engine.current?.setHome(home.pos ? home : null); }, [home.pos?.[0], home.pos?.[1], home.name, !!engine.current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine.current?.setAir(air.stations, air.cems); }, [air, !!engine.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // 提醒（開著 App 時的網頁通知）
  const notifyEvents = useMemo(() => {
    const st = home.pos ? nearestStation(air.stations, home.pos) : null;
    const nowHM = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
    return [
      { kind: 'supply', on: snapshot?.source === 'live' && (snapshot?.supply?.level ?? 0) >= 1, text: `供電${snapshot?.supply?.label}：備轉容量率 ${snapshot?.supply?.rate}%，建議延後非必要用電` },
      { kind: 'aqi', on: (st?.aqi ?? 0) >= 101, text: `${st?.site} AQI ${st?.aqi}，空氣品質不佳，減少戶外活動` },
      { kind: 'anomaly', on: !!anomaly.active, text: anomaly.active ? `${anomaly.active.plant || anomaly.active.unit} 機組出力驟降（${Math.round(anomaly.active.from)}→${Math.round(anomaly.active.to)} MW）` : '' },
      { kind: 'lowcarbon', on: !!advice?.best && nowHM >= advice.best.from && nowHM < advice.best.to, text: `低碳時段開始（到 ${advice?.best?.to}），適合洗衣、烘衣、充電` }
    ];
  }, [snapshot, air.stations, home.pos, anomaly.active, advice]);
  useNotify(home.notify, notifyEvents);

  const recordRef = useRef(badges.record);
  recordRef.current = badges.record;

  useEffect(() => { if (anomaly.active) badges.record('anomaly'); }, [anomaly.active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine.current?.setClock(replay.on && shown ? new Date(shown.t) : null); }, [replay.on, shown?.t]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(() => ({
    density: DENSITY,
    fps: FPS,
    mode: WALLPAPER ? 'wallpaper' : 'app',
    onStats: setStats,
    onDaylight: setDaylight,
    initialView: SAVED_VIEW,
    onUserMove: () => armAutoLock(),
    onPlantVisit: (id) => recordRef.current('plant', id),
    onShot: (shot) => {
      if (shot) recordRef.current('shot', shot);
      setUiState((s) => ({ ...s, shot, cruise: shot ? true : WALLPAPER ? s.cruise : false }));
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 桌布鎖定 ──
  const lock = useCallback(() => {
    clearTimeout(lockTimer.current);
    const e = engine.current;
    if (!e) return;
    saveView(e.getView());
    e.setLocked(true);
    setUiState((s) => ({ ...s, locked: true, fixedView: true, cruise: false }));
  }, []);
  function armAutoLock() {
    clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(lock, AUTO_LOCK_MS);
  }

  const setUi = useCallback((patch) => {
    const e = engine.current;
    if (patch.unlock) {
      e?.cruise.stop();
      e?.setLocked(false);
      armAutoLock();
      setUiState((s) => ({ ...s, locked: false, cruise: false }));
      return;
    }
    if (patch.lock) return lock();
    if (patch.resumeCruise) {
      clearTimeout(lockTimer.current);
      saveView(null);
      e?.setLocked(true);
      e?.cruise.start();
      setUiState((s) => ({ ...s, locked: true, fixedView: false, cruise: true }));
      return;
    }
    if (patch.pickHome) {
      e?.cruise.stop();
      pickCancel.current?.();
      pickCancel.current = e?.pickPoint((pos) => {
        pickCancel.current = null;
        setHomeRef.current({ name: townName(pos), pos });
        setUiState((s) => ({ ...s, picking: false, panel: 'home' }));
      });
      setUiState((s) => ({ ...s, picking: true, panel: null, cruise: false }));
      return;
    }
    if (patch.cancelPick) {
      pickCancel.current?.();
      pickCancel.current = null;
      setUiState((s) => ({ ...s, picking: false, panel: 'home' }));
      return;
    }
    if (patch.toggleCruise) {
      const on = e?.toggleCruise();
      setUiState((s) => ({ ...s, cruise: !!on, panel: on && MOBILE ? null : s.panel }));
      return;
    }
    if (patch.toggleReplay) {
      setReplay((r) => (r.on ? { ...r, on: false, playing: false } : { ...r, on: true, idx: 0, playing: true }));
      setUiState((s) => ({ ...s, panel: MOBILE ? null : s.panel }));
      return;
    }
    if (patch.filter) {
      e?.setFilter(patch.filter);
      // 切到「用電」自動打開用電面板；切走時關掉
      setUiState((s) => ({
        ...s, ...patch,
        panel: patch.filter === 'demand' || patch.filter === 'air' ? patch.filter : s.panel === 'demand' || s.panel === 'air' ? null : s.panel
      }));
      return;
    }
    setUiState((s) => ({ ...s, ...patch }));
  }, [lock]); // eslint-disable-line react-hooks/exhaustive-deps

  // 手機：底部抽屜打開時，把地圖移到抽屜上方看得到的區域；關閉時回到原本的視角
  useEffect(() => {
    const e = engine.current;
    if (!e || WALLPAPER || !MOBILE) return;
    if (!ui.panel) { e.restoreSheetView(); return; }
    const id = requestAnimationFrame(() => {
      const sheet = document.querySelector('.panel');
      const top = (document.querySelector('.mix .supply') || document.querySelector('.mix'))?.getBoundingClientRect().bottom ?? 120;
      if (!sheet) return;
      e.cruise.stop();
      e.fitAboveSheet({ sheetPx: sheet.getBoundingClientRect().height, topPx: top + 8, focus: ui.panel === 'home' && home.pos ? home.pos : null });
    });
    return () => cancelAnimationFrame(id);
  }, [ui.panel, home.pos?.[0], home.pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className={`app ${WALLPAPER ? 'wallpaper' : ''}`} style={daylight ? { '--sky': daylight.sky } : undefined}>
      <GridFlowMap snapshot={shown} options={options} onReady={(e) => (engine.current = e)} />
      <div className="sky" style={{ opacity: daylight ? 0.25 + daylight.day * 0.35 + daylight.twilight * 0.4 : 0.3 }} />
      <div className="vignette" />
      <Hud
        snapshot={shown}
        ui={ui}
        setUi={setUi}
        highlights={highlights}
        daylight={daylight}
        wallpaper={WALLPAPER}
        badges={badges}
        anomaly={anomaly}
        rows={rows}
        replay={replay}
        setReplay={setReplay}
        onReplayFinish={() => badges.record('replay')}
        home={home}
        setHome={setHome}
        homeSum={homeSum}
        advice={advice}
        air={air}
      />
    </main>
  );
}
