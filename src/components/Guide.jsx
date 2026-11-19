import { useEffect, useRef, useState } from 'react';
import { APP } from '../config/app.js';
import { Icon } from './widgets.jsx';
import { useUpdate, applyUpdate, dismissUpdate, checkUpdate } from '../update.js';
import { useT, tx, isEn, tr } from '../i18n.js';
import { locate, enablePush, pushSupport, pushOn, setQuizPush, relayVapid } from '../data/useHome.js';
import { pushExtra } from '../data/openData.js';

/* ───────────── 新版：詢問視窗 + 左上角 ⟳ ───────────── */
/** 對話框按 Esc 關閉（輸入法選字中不算） */
function useEsc(active, fn) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented) { e.preventDefault(); fn(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [active, fn]);
}

/** 對話框：Tab 只在卡片裡循環（不跑到後面的地圖與按鈕） */
function trapTab(e) {
  if (e.key !== 'Tab') return;
  const items = [...e.currentTarget.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!e.currentTarget.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}

export function UpdatePrompt() {
  const u = useUpdate();
  const t = useT();
  useEsc(!!u.available && !u.dismissed, dismissUpdate);
  if (!u.available || u.dismissed) return null;
  // 英文介面：有英文說明才列（只有中文時不列，避免英文介面出現中文）
  const notes = (isEn() ? u.available.notesEn : u.available.notes) || [];
  return (
    <div className="upd-wrap" role="dialog" aria-modal="true" aria-label={t('有新版本')} onKeyDown={trapTab}>
      <div className="upd-card">
        <div className="upd-title">{t('有新版本')} <b>v{u.available.version}</b></div>
        {notes.length > 0 && (
          <ul className="upd-notes">{notes.slice(0, 4).map((n) => <li key={n}>{n}</li>)}</ul>
        )}
        <div className="upd-btns">
          <button onClick={dismissUpdate}>{t('稍後')}</button>
          <button className="primary" onClick={applyUpdate} autoFocus>{t('立即更新')}</button>
        </div>
        <small className="muted">{t('按「稍後」之後，左上角的 ⟳ 隨時可以更新。')}</small>
      </div>
    </div>
  );
}

/** 左上角的小 ⟳：有新版時亮起（點了直接更新）；沒有時點一下＝檢查一次 */
export function RefreshBtn() {
  const u = useUpdate();
  const t = useT();
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(''), 2600); return () => clearTimeout(id); }, [msg]);
  const onClick = async () => {
    if (u.available) return applyUpdate();
    const j = await checkUpdate({ force: true });
    if (!j) setMsg(`${t('已是最新版')} v${APP.version}`);
  };
  return (
    <span className="refresh-wrap">
      <button
        className={`refresh-btn ${u.available ? 'has' : ''} ${u.checking ? 'spin' : ''}`}
        onClick={onClick}
        title={u.available ? `${t('更新到')} v${u.available.version}` : `${t('檢查新版本')}（v${APP.version}）`}
        aria-label={u.available ? t('更新到新版本') : t('檢查新版本')}
      >
        {Icon.refresh}
      </button>
      {u.available && u.dismissed && <span className="refresh-tip">{t('有新版本')}</span>}
      {msg && <span className="refresh-tip ok">{msg}</span>}
    </span>
  );
}

/* ───────────── 第一次使用：功能導覽（之後在「資訊 → 使用說明」） ───────────── */
const TOUR_KEY = 'tgf-tour-v1';
// 圖示用和工具列同一組線條 SVG（不用 emoji，風格一致）
export const GUIDE = [
  [Icon.globe, '看現在', '光點是發電廠，越亮發電越多；光流從電廠流向城市。右上角是綠能／火力比例與全台發電、用電。', 'Glowing dots are power plants — brighter means more output; light flows from plants to cities. Top-right shows the green/thermal mix and total generation and demand.'],
  [Icon.spark, '點光球', '點地圖上的電廠光球，看每部機組的即時出力、歲修或降載狀態。', 'Tap a plant on the map to see each unit’s live output, maintenance or reduced-load status.'],
  [Icon.search, '電廠', '搜尋電廠或機組並飛過去；也列出今天歲修、故障、降載的機組和出力前五名。', 'Search a plant or unit and fly to it; also lists units under maintenance, faults or derating today, and the top 5 plants.'],
  [Icon.home, '我的家', '設定地點後：計畫性停電提醒、現在適不適合用電、你家 vs 鄉鎮平均用電、附近空氣品質、下風側電廠、電費試算。', 'After setting a location: planned-outage reminders, whether now is a good time to use power, your use vs the township average, nearby air quality, upwind plants, and a bill calculator.'],
  [Icon.plug, '家電', '算一台家電一個月多少度、多付多少電費；電費小手冊整理台電的省電與電價說明，每篇附原始連結。', 'Work out an appliance’s monthly kWh and extra cost; the handbook summarises Taipower’s tips and tariff notes, each linked to the original.'],
  [Icon.store, '店家', '匯入店家智慧電表的用電明細：每月尖峰／離峰圖表、哪種電價最省、把工作移到離峰能再省多少。', 'Import a shop’s smart-meter data: monthly peak/off-peak charts, which tariff is cheapest, and how much more you save by shifting work off-peak.'],
  [Icon.medal, '亮點', '今天太陽能尖峰、綠能最高的時刻、發電組成；今天用電在今年排第幾、去年今天；台灣和各國的碳強度、再生能源比較。', 'Today’s solar peak, greenest moment and generation mix; how today’s demand ranks this year and this day last year; how Taiwan compares with other countries.'],
  [Icon.replay, '今日重播', '把今天（或昨天）一整天快轉播放，看太陽能如何撐起白天。', 'Fast-forward through today (or yesterday) to see solar carry the daytime.'],
  [Icon.cruise, '自動導覽', '鏡頭自動巡覽各地電廠，適合當桌布；按「全島」回到俯視圖。', 'Auto-cruise between plants — great as a wallpaper; tap “Overview” to return to the full view.'],
  [Icon.info, '資訊', '資料來源、準確度、連線狀況、各縣市綠電；資料讀不到時看這裡。', 'Data sources, accuracy, connection status and renewables by county — check here when data won’t load.']
];

export function Tour({ onDone }) {
  const t = useT();
  const [show, setShow] = useState(() => { try { return !localStorage.getItem(TOUR_KEY); } catch { return false; } });
  const close = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* 略 */ } setShow(false); onDone?.(); };
  useEsc(show, close);
  if (!show) return null;
  return (
    <div className="upd-wrap tour" role="dialog" aria-modal="true" aria-label={t('功能導覽')} onKeyDown={trapTab}>
      <div className="upd-card">
        <div className="upd-title">{t('歡迎來到')} {tx(APP.name, APP.en)}</div>
        <ul className="guide-list">
          {GUIDE.map(([ico, k, v, en]) => (
            <li key={k}><span className="g-ico">{ico}</span><div><b>{t(k)}</b><p>{tx(v, en)}</p></div></li>
          ))}
        </ul>
        <div className="upd-btns"><button className="primary" onClick={close} autoFocus>{t('開始')}</button></div>
        <small className="muted">{t('之後可以在「資訊 → 使用說明」再看一次。')}</small>
      </div>
    </div>
  );
}

/* ───────────── 手機第一次開啟：加入主畫面＋開 App 通知（看完功能導覽之後） ───────────── */
const WELCOME_KEY = 'tgf-welcome-v1';
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvt = null; // Android Chrome：可以直接跳出「安裝」
if (typeof window !== 'undefined') addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
export const tourSeen = () => { try { return !!localStorage.getItem(TOUR_KEY); } catch { return true; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function Welcome({ home, setHome, station, ready, blocked, onShow }) {
  const t = useT();
  const [show, setShow] = useState(false);
  const [air, setAir] = useState(true);
  const [quiz, setQuiz] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [, setTick] = useState(0);
  const stRef = useRef(station);
  stRef.current = station;
  useEffect(() => {
    if (!ready || blocked || show) return undefined;
    let seen = true;
    try { seen = !!localStorage.getItem(WELCOME_KEY); } catch { /* 略 */ }
    const mobile = matchMedia('(pointer: coarse)').matches && innerWidth < 900;
    if (seen || !mobile || (standalone() && pushOn(home))) return undefined;
    const id = setTimeout(() => { setShow(true); onShow?.(true); }, 1500);
    return () => clearTimeout(id);
  }, [ready, blocked]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* 略 */ } setShow(false); onShow?.(false); };
  useEsc(show, close);
  if (!show) return null;
  const ios = isIOS();
  const sa = standalone();
  const sup = pushSupport();
  const install = async () => { try { installEvt.prompt(); await installEvt.userChoice; } catch { /* 略 */ } installEvt = null; setTick((n) => n + 1); };
  const enable = async () => {
    setBusy(true); setMsg('');
    try {
      const vapid = await relayVapid(APP.relayUrl);
      let site = null;
      if (air) {
        if (!home.pos) await locate(setHome).catch(() => { throw new Error(tx('沒有取得位置：空品提醒可以之後在「我的家」設定地點再開。', 'Couldn’t get your location — set a Home location later to turn on air alerts.')); });
        for (let i = 0; i < 16 && !stRef.current; i++) await sleep(500); // 等最近的測站算出來
        site = stRef.current?.site || null;
        if (!site) throw new Error(tx('空品資料還沒讀到，請稍後到「我的家」開啟。', 'Air data hasn’t loaded yet — turn this on later under Home.'));
        const next = { ...home, push: true, quizOff: !quiz, qpush: quiz };
        await enablePush(APP.relayUrl, vapid, site, { extra: pushExtra(next) });
        setHome({ push: true, pushSite: site, quizOff: !quiz, qpush: quiz });
      } else if (quiz) await setQuizPush(true, home, setHome, APP.relayUrl, vapid, { test: true });
      close();
    } catch (err) {
      // 空品失敗但有勾知識題 → 至少開知識題
      if (air && quiz && !pushOn(home)) await setQuizPush(true, home, setHome, APP.relayUrl, await relayVapid(APP.relayUrl), { test: true }).catch(() => {});
      setMsg(tr(err.message));
    }
    setBusy(false);
  };
  return (
    <div className="upd-wrap welcome" role="dialog" aria-modal="true" aria-label={tx('讓台灣脈動更好用', 'Get more from the app')} onKeyDown={trapTab}>
      <div className="upd-card">
        <div className="upd-title">{tx('讓台灣脈動更好用', 'Get more from Taiwan Grid Flow')}</div>
        {!sa && (
          <p className="wl-step"><b>① {tx('加入主畫面', 'Add to Home Screen')}</b>　{ios
            ? tx('點 Safari 下方「分享」→「加入主畫面」，之後從主畫面打開，像 App 一樣全螢幕，也才能收通知（iOS 16.4 以上）。', 'In Safari tap Share → Add to Home Screen, then open it from the Home Screen: full-screen like an app, and needed for notifications (iOS 16.4+).')
            : installEvt ? tx('像 App 一樣從主畫面打開。', 'Open it from your Home Screen like an app.')
              : tx('瀏覽器選單（⋮）→「加到主畫面」或「安裝應用程式」。', 'Browser menu (⋮) → Add to Home screen / Install app.')}</p>
        )}
        {!sa && !ios && installEvt && <div className="upd-btns" style={{ justifyContent: 'flex-start' }}><button onClick={install}>{tx('加入主畫面', 'Add to Home Screen')}</button></div>}
        {sup.ok ? (
          <>
            <p className="wl-step"><b>{sa ? '' : '② '}{tx('開啟 App 通知（免費）', 'Turn on app notifications (free)')}</b></p>
            <label className="switch"><input type="checkbox" checked={air} onChange={(e) => setAir(e.target.checked)} /><span>{tx('空品、供電提醒：你家附近 AQI ≥ 101 或供電非綠燈時（會請你允許定位，找最近的測站；位置只存在這台裝置）', 'Air & supply alerts: when AQI near you hits 101+ or supply isn’t green (asks for your location to find the nearest station; it stays on this device)')}</span></label>
            <label className="switch"><input type="checkbox" checked={quiz} onChange={(e) => setQuiz(e.target.checked)} /><span>{tx('知識題新一期上線（每週一、週四早上 7 點）', 'New quiz round is live (Mon & Thu, 7 am)')}</span></label>
            {msg && <p className="wl-msg">{msg}</p>}
            <div className="upd-btns" style={{ marginTop: 14 }}>
              <button onClick={close}>{msg ? tx('關閉', 'Close') : tx('以後再說', 'Not now')}</button>
              {!msg && <button className="primary" onClick={enable} disabled={busy || (!air && !quiz)} autoFocus>{busy ? tx('設定中…', 'Setting up…') : tx('開啟通知', 'Turn on')}</button>}
            </div>
          </>
        ) : (
          <>
            {ios && !sa && <p className="wl-step">{tx('加入主畫面後，從主畫面打開會再問你要不要開通知（空品、供電、知識題新題）。', 'After adding it, open it from the Home Screen and we’ll ask about notifications (air, supply, new quiz rounds).')}</p>}
            <div className="upd-btns"><button className="primary" onClick={close} autoFocus>{tx('知道了', 'Got it')}</button></div>
          </>
        )}
        <small className="muted">{tx('之後都可以在「我的家 → 提醒」開關。', 'You can change these any time under Home → Alerts.')}</small>
      </div>
    </div>
  );
}

/* ───────────── 資料讀不到：直接提示，點了看是哪一項 ───────────── */
export function DataIssue({ snapshot, air, onOpen }) {
  const t = useT();
  const bad = [
    ...(snapshot?.diag || []).filter((d) => !d.ok).map((d) => d.name),
    ...(air && !air.loading && air.error ? ['空品'] : [])
  ];
  if (!snapshot || (snapshot.cached && !snapshot.stale) || !bad.length) return null;
  if (snapshot.source !== 'live') {
    if (!snapshot.diag?.length || new URLSearchParams(location.search).has('sim')) return null; // 刻意開示範模式（?sim=1）不算問題
    return <button className="data-issue" onClick={onOpen}>⚠ {t('連不到台電資料，目前是模擬畫面')} ›</button>;
  }
  return (
    <button className="data-issue" onClick={onOpen} title={bad.map(t).join('、')}>
      ⚠ {t('部分資料暫時讀不到')}：{bad.slice(0, 2).map(t).join('、')}{bad.length > 2 ? ` ${t('等')} ${bad.length} ${t('項')}` : ''} ›
    </button>
  );
}
