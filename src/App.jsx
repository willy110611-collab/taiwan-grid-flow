import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridFlowMap from './components/GridFlowMap.jsx';
import Hud from './components/Hud.jsx';
import { useGridData } from './data/useGridData.js';
import { useHighlights } from './data/useHighlights.js';
import { useDayHistory, useYesterday, useRecords } from './data/history.js';
import { useBadges } from './data/badges.js';
import { PLANTS } from './config/geo.js';
import { useAnomalies } from './data/useAnomalies.js';
import { useAir, useSun, nearestStation } from './data/useAir.js';
import { useHome, useNotify, townName, enablePush } from './data/useHome.js';
import { pushExtra } from './data/openData.js';
import { useLang } from './i18n.js';
import { APP } from './config/app.js';
import { usageAdvice } from './data/advice.js';
import { homeSummary } from './components/Life.jsx';
import { getPowerPref } from './power.js';
import { Guard } from './components/Guard.jsx';

/**
 * 網址參數
 *  ?mode=wallpaper  桌布模式（Lively Wallpaper 用）：預設鎖定、自動放空巡航、30fps
 *  ?sim=1           強制模擬資料
 *  ?density=2       粒子密度倍率
 *  ?fps=60          強制幀率
 *  ?demo=anomaly    展示機組異常橫幅
 *  ?plant=taichung  分享連結：打開就飛到這座電廠並打開電廠卡
 *  ?view=經度,緯度,縮放  分享連結：打開就是這個畫面
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
// 光流路線（真實輸電線／示意光纖），引擎也讀同一個鍵
const ROUTE0 = (() => { try { return localStorage.getItem('tgf-route') === 'fiber' ? 'fiber' : 'grid'; } catch { return 'grid'; } })();
// 分享連結帶的畫面位置
const VIEW_PARAM = (() => {
  const v = (params.get('view') || '').split(',').map(Number);
  return v.length >= 3 && v.every(Number.isFinite) ? { center: [v[0], v[1]], zoom: v[2], pitch: v[3] || 0, bearing: v[4] || 0 } : null;
})();
const PLANT_PARAM = params.get('plant');



export default function App() {
  const snapshot = useGridData();
  const rows = useDayHistory(snapshot);
  const yRows = useYesterday(snapshot);
  const records = useRecords(snapshot);
  const anomaly = useAnomalies(snapshot);
  const engine = useRef(null);
  const [stats, setStats] = useState(null);
  const [daylight, setDaylight] = useState(null);
  const [replay, setReplay] = useState({ on: false, idx: 0, playing: false, speed: 300, day: 'today' });
  const rRows = replay.day === 'yesterday' && yRows.length ? yRows : rows;
  const [ui, setUiState] = useState({ route: ROUTE0, filter: 'all', panel: null, cruise: WALLPAPER && !SAVED_VIEW, shot: null, locked: true, fixedView: !!SAVED_VIEW });
  const lockTimer = useRef(null);
  const pickCancel = useRef(null);
  const setHomeRef = useRef(null);

  // 回放中顯示歷史快照，否則顯示即時快照
  const shown = (replay.on && rRows.length ? rRows[Math.max(0, Math.min(rRows.length - 1, Math.floor(replay.idx) || 0))] : null) || snapshot;
  const badges = useBadges(snapshot, rows, { replaying: replay.on });
  const highlights = useHighlights(snapshot, rows, stats, anomaly.list);
  const air = useAir();
  const sun = useSun(); // 太陽能依各地即時日照分配（中繼站需設定 CWA_KEY）
  const { home, setHome } = useHome();
  // App 通知的語言跟著介面：換語言（或舊訂閱還沒記語言）就重新登記一次，不發測試通知
  const [lang] = useLang();
  useEffect(() => {
    if (!(home.push || home.outD3 || home.outD1) || home.pushLang === lang) return undefined;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return undefined;
    const id = setTimeout(async () => {
      const cfg = await fetch(`${APP.relayUrl}/config.json`).then((r) => r.json()).catch(() => null);
      if (!cfg?.vapidPublic) return;
      enablePush(APP.relayUrl, cfg.vapidPublic, home.push ? home.pushSite : null, { test: false, extra: pushExtra(home) })
        .then((j) => { if (j?.lang === lang) setHome({ pushLang: lang }); }).catch(() => {}); // 中繼站 v8.7 起才會記語言（回傳 lang）
    }, 3000);
    return () => clearTimeout(id);
  }, [lang, home.push, home.outD3, home.outD1]); // eslint-disable-line react-hooks/exhaustive-deps
  setHomeRef.current = setHome;
  const advice = useMemo(
    () => usageAdvice(shown, rows, snapshot?.curves?.yesterday, { touUser: home.touUser }),
    [shown, rows, snapshot?.curves?.yesterday, home.touUser]
  );
  const homeSum = useMemo(() => homeSummary({ home, snapshot: shown, air, rows, advice }), [home, shown, air, rows, advice]);
  useEffect(() => { engine.current?.setHome(home.pos ? home : null); }, [home.pos?.[0], home.pos?.[1], home.name, !!engine.current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine.current?.setAir(air.stations, air.cems); }, [air, !!engine.current]); // eslint-disable-line react-hooks/exhaustive-deps
  // D1 計畫停電：只在「我的家」打開時把清單畫到地圖上
  useEffect(() => { engine.current?.setOutages(ui.panel === 'home' ? ui.outageMarks : null); }, [ui.panel, ui.outageMarks, !!engine.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // 提醒（開著 App 時的網頁通知）
  const notifyEvents = useMemo(() => {
    const st = home.pos ? nearestStation(air.stations, home.pos) : null;
    const nowHM = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
    return [
      { kind: 'supply', on: !home.push && snapshot?.source === 'live' && (snapshot?.supply?.level ?? 0) >= 1 && !snapshot?.supply?.old, text: `供電${snapshot?.supply?.label}：備轉容量率 ${snapshot?.supply?.rate}%，建議延後非必要用電` },
      { kind: 'aqi', on: !home.push && (st?.aqi ?? 0) >= 101, text: `${st?.site} AQI ${st?.aqi}，空氣品質不佳，減少戶外活動` },
      { kind: 'anomaly', on: !!anomaly.active, text: anomaly.active ? `${anomaly.active.plant || anomaly.active.unit} 機組出力驟降（${Math.round(anomaly.active.from)}→${Math.round(anomaly.active.to)} MW）` : '' },
      { kind: 'lowcarbon', on: !!advice?.best && nowHM >= advice.best.from && nowHM < advice.best.to, text: `低碳時段開始（到 ${advice?.best?.to}），適合洗衣、烘衣、充電` }
    ];
  }, [snapshot, air.stations, home.pos, home.push, anomaly.active, advice]);
  useNotify(home.notify, notifyEvents);

  const recordRef = useRef(badges.record);
  recordRef.current = badges.record;

  useEffect(() => { if (anomaly.active && !anomaly.active.demo) badges.record('anomaly'); }, [anomaly.active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { engine.current?.setClock(replay.on && shown ? new Date(shown.t) : null); }, [replay.on, shown?.t]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(() => ({
    density: DENSITY,
    fps: FPS,
    mode: WALLPAPER ? 'wallpaper' : 'app',
    onStats: setStats,
    onDaylight: setDaylight,
    initialView: SAVED_VIEW || VIEW_PARAM,
    onUserMove: () => armAutoLock(),
    onPlantVisit: (id) => recordRef.current('plant', id),
    onAway: (away) => setUiState((s) => (s.away === away ? s : { ...s, away })),
    onRoute: (route) => setUiState((s) => ({ ...s, route })), // 真實線路下載失敗 → 選單改顯示示意
    onPlantSelect: (id) => setUiState((s) => ({ ...s, panel: 'plant', plantId: id, fly: false })),
    onShot: (shot) => {
      if (shot) recordRef.current('shot', shot);
      setUiState((s) => ({ ...s, shot, cruise: shot ? true : WALLPAPER ? s.cruise : false }));
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 桌布鎖定 ──
  const lock = useCallback(() => {
    clearTimeout(lockTimer.current);
    const e = engine.current;
    if (!e || !WALLPAPER) return;
    saveView(e.getView());
    e.setLocked(true);
    setUiState((s) => ({ ...s, locked: true, fixedView: true, cruise: false }));
  }, []);
  function armAutoLock() {
    // 自動鎖定只給桌布模式；App／網頁版一旦鎖住就沒有按鈕能解開（曾造成「放大縮小、拖曳全部失效」）
    if (!WALLPAPER) return;
    clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(lock, AUTO_LOCK_MS);
  }

  const setUi = useCallback((patch) => {
    const e = engine.current;
    // 正在「點地圖選家」時改做別的事（開面板、電廠、回放、放空…）→ 先結束選點，避免之後點電廠被當成設定家
    if (pickCancel.current && !patch.pickHome && !patch.cancelPick && (patch.panel !== undefined || patch.openPlant || patch.toggleReplay || patch.toggleCruise || patch.resumeCruise || patch.resetView || patch.filter)) {
      pickCancel.current();
      pickCancel.current = null;
      setUiState((s) => ({ ...s, picking: false }));
    }
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
      // 關閉放空 → 飛回一開始的全島俯視圖
      if (!on) e?.resetView();
      setUiState((s) => ({ ...s, cruise: !!on, away: !!on, panel: on && MOBILE ? null : s.panel }));
      return;
    }
    if (patch.openPlant) {
      // 搜尋、今日異常清單、分享連結：飛到電廠並打開電廠卡（手機先記住原本畫面，關卡片時回去）
      // 沒有 WebGL（引擎沒建起來）時仍可打開電廠卡，只是不飛過去
      const p = (e?.plants || PLANTS).find((x) => x.id === patch.openPlant || x.name === patch.openPlant);
      if (e && p) {
        if (MOBILE) {
          const m = e.map;
          e.sheetSaved ||= { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
        }
        e.focusPlant(p.pos, { padding: MOBILE ? { bottom: Math.round(innerHeight * 0.5), top: 140 } : { right: 420 } });
      }
      if (p) { recordRef.current('plant', p.id); setUiState((s) => ({ ...s, panel: 'plant', plantId: p.id, fly: true, cruise: false })); }
      return;
    }
    if (patch.resetView) {
      e?.resetView();
      setUiState((s) => ({ ...s, cruise: false, away: false }));
      return;
    }
    if (patch.toggleReplay) {
      setReplay((r) => (r.on ? { ...r, on: false, playing: false } : { ...r, on: true, idx: 0, playing: true, day: 'today' }));
      setUiState((s) => ({ ...s, panel: MOBILE ? null : s.panel }));
      return;
    }
    if (patch.route) {
      e?.setRouteMode(patch.route);
      setUiState((s) => ({ ...s, route: patch.route }));
      return;
    }
    if (patch.filter) {
      e?.setFilter(patch.filter);
      // 切到「用電／空品／核能」自動打開對應面板；切走時關掉
      setUiState((s) => ({
        ...s, ...patch,
        panel: ['demand', 'air', 'nuclear'].includes(patch.filter) ? patch.filter : ['demand', 'air', 'nuclear'].includes(s.panel) ? null : s.panel
      }));
      return;
    }
    setUiState((s) => ({ ...s, ...patch }));
  }, [lock]); // eslint-disable-line react-hooks/exhaustive-deps

  // 手機：資料載入後 HUD 變高（供電燈號、右上小卡），重新把全島放進可見區域
  const hasCard = !!homeSum;
  useEffect(() => {
    if (!MOBILE || !hasCard) return;
    const id = setTimeout(() => engine.current?.refitIfIdle(), 400);
    return () => clearTimeout(id);
  }, [hasCard, home.pos?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!MOBILE) return;
    const onResize = () => engine.current?.refitIfIdle();
    addEventListener('orientationchange', onResize);
    return () => removeEventListener('orientationchange', onResize);
  }, []);

  // 從清單、搜尋打開電廠卡時，地圖上的電廠標籤也換成這一座（不要留著上一座的標籤）
  useEffect(() => {
    if (ui.panel === 'plant' && ui.plantId) engine.current?.setHover(ui.plantId);
    else engine.current?.setHover(null); // 關掉電廠卡：標籤一起收（手機沒有「滑出」可以清掉）
  }, [ui.panel, ui.plantId]);

  // 手機：底部抽屜打開時，把地圖移到抽屜上方看得到的區域；關閉時回到原本的視角
  //  電廠卡：保持使用者目前的縮放，只平移讓電廠露出來（電廠本來就看得到就不動）
  useEffect(() => {
    const e = engine.current;
    if (!e || WALLPAPER || !MOBILE) return;
    if (!ui.panel) { e.restoreSheetView(); return; }
    if (ui.panel === 'plant' && ui.fly) return; // 已經飛過去了
    const id = requestAnimationFrame(() => {
      const sheet = document.querySelector('.panel');
      const top = (document.querySelector('.mix .supply') || document.querySelector('.mix'))?.getBoundingClientRect().bottom ?? 120;
      if (!sheet) return;
      e.cruise.stop();
      const sheetPx = sheet.getBoundingClientRect().height;
      const plant = ui.panel === 'plant' ? e.plants.find((p) => p.id === ui.plantId) : null;
      if (plant) e.panAboveSheet({ sheetPx, topPx: top + 8, pos: plant.pos });
      else e.fitAboveSheet({ sheetPx, topPx: top + 8, focus: ui.panel === 'home' && home.pos ? home.pos : null });
    });
    return () => cancelAnimationFrame(id);
  }, [ui.panel, ui.plantId, home.pos?.[0], home.pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // 分享連結 ?plant=：資料到了、地圖準備好就飛過去
  const plantOpened = useRef(false);
  useEffect(() => {
    if (!PLANT_PARAM || plantOpened.current || !snapshot || !engine.current) return;
    plantOpened.current = true;
    const id = setTimeout(() => setUi({ openPlant: PLANT_PARAM }), 600);
    return () => clearTimeout(id);
  }, [snapshot, setUi]);

  // 省電模式
  const [power, setPower] = useState(getPowerPref);
  const [lowBattery, setLowBattery] = useState(false);
  useEffect(() => {
    const onPref = () => setPower(getPowerPref());
    addEventListener('tgf-power', onPref);
    let bat = null;
    const upd = () => setLowBattery(!!bat && bat.level < 0.2 && !bat.charging);
    navigator.getBattery?.().then((b) => { bat = b; upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); }).catch(() => {});
    return () => { removeEventListener('tgf-power', onPref); bat?.removeEventListener('levelchange', upd); bat?.removeEventListener('chargingchange', upd); };
  }, []);
  const saveData = !!navigator.connection?.saveData;
  const powerSave = power === 'on' || (power === 'auto' && (lowBattery || saveData));
  useEffect(() => { engine.current?.setPowerSave(powerSave); }, [powerSave, !!engine.current]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className={`app ${WALLPAPER ? 'wallpaper' : ''}`} style={daylight ? { '--sky': daylight.sky } : undefined}>
      <Guard name="map" full><GridFlowMap snapshot={shown} options={options} onReady={(e) => { engine.current = e; if (params.has('debug')) window.tgf = e; }} /></Guard>
      <div className="sky" style={{ opacity: daylight ? 0.25 + daylight.day * 0.35 + daylight.twilight * 0.4 : 0.3 }} />
      <div className="vignette" />
      <Guard name="hud" full>
      <Hud
        snapshot={shown}
        ui={ui}
        setUi={setUi}
        highlights={highlights}
        daylight={daylight}
        wallpaper={WALLPAPER}
        badges={badges}
        anomaly={anomaly}
        rows={rRows}
        dayRows={rows}
        yRows={yRows}
        hasYesterday={yRows.length > 0}
        records={records}
        sun={sun}
        replay={replay}
        setReplay={setReplay}
        onReplayFinish={() => badges.record('replay')}
        home={home}
        setHome={setHome}
        homeSum={homeSum}
        advice={advice}
        air={air}
        powerSave={powerSave}
        power={power}
        getView={() => engine.current?.getView()}
      />
      </Guard>
    </main>
  );
}
