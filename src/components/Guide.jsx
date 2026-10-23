import { useEffect, useState } from 'react';
import { APP } from '../config/app.js';
import { Icon } from './widgets.jsx';
import { useUpdate, applyUpdate, dismissUpdate, checkUpdate } from '../update.js';
import { useT } from '../i18n.js';

/* ───────────── 新版：詢問視窗 + 左上角 ⟳ ───────────── */
export function UpdatePrompt() {
  const u = useUpdate();
  const t = useT();
  if (!u.available || u.dismissed) return null;
  return (
    <div className="upd-wrap" role="dialog" aria-label="有新版本">
      <div className="upd-card">
        <div className="upd-title">✨ {t('有新版本')} <b>v{u.available.version}</b></div>
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
export const GUIDE = [
  ['🔆', '看現在', '光點是發電廠，越亮發電越多；光流從電廠流向城市。右上角是綠能／火力比例與全台發電、用電。'],
  ['👆', '點光球', '點地圖上的電廠光球，看每部機組的即時出力、歲修或降載狀態。'],
  ['🏠', '我的家', '設定地點後：現在適不適合用電、附近空氣品質、下風側電廠、電費試算。'],
  ['✨', '亮點', '今天太陽能尖峰、綠能最高的時刻，以及你看過的最高紀錄。'],
  ['⏪', '回放', '把今天（或昨天）一整天快轉播放，看太陽能如何撐起白天。'],
  ['〰', '放空', '自動巡航各地電廠，適合當桌布；按「全島」回到俯視圖。'],
  ['ℹ', '資訊', '資料來源、準確度、連線狀況；資料讀不到時看這裡。']
];

export function Tour({ onDone }) {
  const t = useT();
  const [show, setShow] = useState(() => { try { return !localStorage.getItem(TOUR_KEY); } catch { return false; } });
  if (!show) return null;
  const close = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* 略 */ } setShow(false); onDone?.(); };
  return (
    <div className="upd-wrap tour" role="dialog" aria-label="功能導覽">
      <div className="upd-card">
        <div className="upd-title">{t('歡迎來到')} {APP.name}</div>
        <ul className="guide-list">
          {GUIDE.map(([ico, k, v]) => (
            <li key={k}><span className="g-ico">{ico}</span><div><b>{t(k)}</b><p>{v}</p></div></li>
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
    ...(air && !air.loading && air.error ? ['空氣品質'] : [])
  ];
  if (!snapshot || snapshot.cached || !bad.length) return null;
  if (snapshot.source !== 'live') {
    if (!snapshot.diag?.length) return null; // 刻意開模擬模式（?sim=1）不算問題
    return <button className="data-issue" onClick={onOpen}>⚠ {t('連不到台電資料，目前是模擬畫面')} ›</button>;
  }
  return (
    <button className="data-issue" onClick={onOpen} title={bad.join('、')}>
      ⚠ {t('部分資料暫時讀不到')}：{bad.slice(0, 2).join('、')}{bad.length > 2 ? ` ${t('等')} ${bad.length} ${t('項')}` : ''} ›
    </button>
  );
}
