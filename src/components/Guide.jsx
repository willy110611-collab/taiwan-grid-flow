import { useEffect, useState } from 'react';
import { APP } from '../config/app.js';
import { Icon } from './widgets.jsx';
import { useUpdate, applyUpdate, dismissUpdate, checkUpdate } from '../update.js';
import { useT, tx } from '../i18n.js';

/* ───────────── 新版：詢問視窗 + 左上角 ⟳ ───────────── */
export function UpdatePrompt() {
  const u = useUpdate();
  const t = useT();
  if (!u.available || u.dismissed) return null;
  return (
    <div className="upd-wrap" role="dialog" aria-label="有新版本">
      <div className="upd-card">
        <div className="upd-title">{t('有新版本')} <b>v{u.available.version}</b></div>
        {u.available.notes?.length > 0 && (
          <ul className="upd-notes">{u.available.notes.slice(0, 4).map((n) => <li key={n}>{n}</li>)}</ul>
        )}
        <div className="upd-btns">
          <button onClick={dismissUpdate}>{t('稍後')}</button>
          <button className="primary" onClick={applyUpdate}>{t('立即更新')}</button>
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
        aria-label={u.available ? '更新到新版本' : '檢查新版本'}
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
  [Icon.medal, '亮點', '今天太陽能尖峰、綠能最高的時刻、你看過的最高紀錄；今天用電在今年排第幾、每日備轉容量率年曆。', 'Today’s solar peak and greenest moment, your highest records, how today’s demand ranks this year, and a calendar of daily reserve margins.'],
  [Icon.replay, '回放', '把今天（或昨天）一整天快轉播放，看太陽能如何撐起白天。', 'Fast-forward through today (or yesterday) to see solar carry the daytime.'],
  [Icon.cruise, '放空', '自動巡航各地電廠，適合當桌布；按「全島」回到俯視圖。', 'Auto-cruise between plants — great as a wallpaper; tap “Overview” to return to the full view.'],
  [Icon.info, '資訊', '資料來源、準確度、連線狀況、各縣市綠電；資料讀不到時看這裡。', 'Data sources, accuracy, connection status and renewables by county — check here when data won’t load.']
];

export function Tour({ onDone }) {
  const t = useT();
  const [show, setShow] = useState(() => { try { return !localStorage.getItem(TOUR_KEY); } catch { return false; } });
  if (!show) return null;
  const close = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* 略 */ } setShow(false); onDone?.(); };
  return (
    <div className="upd-wrap tour" role="dialog" aria-label="功能導覽">
      <div className="upd-card">
        <div className="upd-title">{t('歡迎來到')} {tx(APP.name, APP.en)}</div>
        <ul className="guide-list">
          {GUIDE.map(([ico, k, v, en]) => (
            <li key={k}><span className="g-ico">{ico}</span><div><b>{t(k)}</b><p>{tx(v, en)}</p></div></li>
          ))}
        </ul>
        <div className="upd-btns"><button className="primary" onClick={close}>{t('開始')}</button></div>
        <small className="muted">{t('之後可以在「資訊 → 使用說明」再看一次。')}</small>
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
    if (!snapshot.diag?.length) return null; // 刻意開模擬模式（?sim=1）不算問題
    return <button className="data-issue" onClick={onOpen}>⚠ {t('連不到台電資料，目前是模擬畫面')} ›</button>;
  }
  return (
    <button className="data-issue" onClick={onOpen} title={bad.map(t).join('、')}>
      ⚠ {t('部分資料暫時讀不到')}：{bad.slice(0, 2).map(t).join('、')}{bad.length > 2 ? ` ${t('等')} ${bad.length} ${t('項')}` : ''} ›
    </button>
  );
}
