import { useEffect, useRef, useState } from 'react';
import { BADGES } from '../data/badges.js';
import { REGION_KEYS, PLANTS, plantName } from '../config/geo.js';
import { EVIDENCE } from '../config/energy.js';
import { Panel } from './Panels.jsx';
import { Icon, fmtMw, rgb } from './widgets.jsx';
import { twHM } from '../data/history.js';
import { t, tx, tr, useT } from '../i18n.js';

/* ───────────── 供電燈號 ───────────── */
export function SupplyChip({ supply }) {
  if (!supply) return null;
  const c = rgb(supply.color);
  return (
    <div className="supply" title={supply.evidence === 'live' ? tx('台電公布：今日尖峰預估備轉容量率', 'Taipower: forecast peak reserve margin today') : tx('模擬值', 'simulated')}>
      <i style={{ background: c, boxShadow: `0 0 10px ${c}` }} />
      <span>{t(supply.label)}</span>
      <b>{supply.rate?.toFixed(1)}%</b>
      <small>{t(supply.evidence === 'live' ? '尖峰備轉' : '模擬')}{supply.old && supply.date ? ` ${+supply.date.slice(5, 7)}/${+supply.date.slice(8)}` : ''}</small>
    </div>
  );
}

/* ───────────── 用電面板 ───────────── */
export function DemandPanel({ snapshot, onClose }) {
  const regions = snapshot?.regions;
  const max = regions ? Math.max(...REGION_KEYS.map((k) => Math.max(regions.byKey[k].load, regions.byKey[k].gen))) : 1;
  const ev = regions?.evidence === 'live' && snapshot.source === 'live' ? 'live' : snapshot?.source === 'live' ? 'modeled' : 'simulated';
  return (
    <Panel title="用電" onClose={onClose}>
      {!regions ? <p className="muted">{t('資料讀取中…')}</p> : (
        <>
          <p className="fine">
            <em className={`tag ${ev}`}>{t(EVIDENCE[ev].label)}</em>
            {ev === 'live' ? tx(`台電各區即時發電／用電${regions.time ? `（${regions.time.slice(-5)}）` : ''}`, `Taipower live generation/demand by region${regions.time ? ` (${regions.time.slice(-5)})` : ''}`) : tx('依典型區域比例推估', 'Estimated from typical regional shares')}
          </p>
          <ul className="region-bars">
            {REGION_KEYS.map((k) => {
              const r = regions.byKey[k];
              const absorb = Math.round(r.ratio * 100) < 100;
              return (
                <li key={k}>
                  <div className="rb-head">
                    <b>{tx(r.name, { N: 'North', C: 'Central', S: 'South', E: 'East' }[k])}</b>
                    <span className={absorb ? 'warm' : 'cool'}>
                      {tx('自給', 'Self-supply')} {Math.round(r.ratio * 100)}% · {absorb ? tx('吸能', 'importing') : tx('供能', 'exporting')}
                    </span>
                  </div>
                  <div className="rb-bar"><span className="load" style={{ width: `${(r.load / max) * 100}%` }} /></div>
                  <div className="rb-bar"><span className="gen" style={{ width: `${(r.gen / max) * 100}%` }} /></div>
                  <div className="rb-nums">
                    <span>{tx('用電', 'Demand')} {fmtMw(r.load)} MW</span>
                    <span>{tx('發電', 'Generation')} {fmtMw(r.gen)} MW</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="fine">
            {tx('地圖上的區域底色：', 'Region shading on the map: ')}<span className="warm">{tx('暖色', 'warm')}</span>{tx(' 表示用電大於發電，需要從外區送電進來（吸能）；', ' means demand exceeds generation, so power is imported; ')}
            <span className="cool">{tx('冷色', 'cool')}</span>{tx(' 表示發電有剩，往外送（供能）。都市光暈越大代表用電越多。', ' means surplus generation is exported. Larger city glows mean higher demand.')}
            {tx('分區照台電公布的北、中、南、東四區；台電把花蓮的和平電廠算在北部。', ' Regions follow Taipower’s four areas; Taipower counts the Ho-Ping plant in Hualien as part of the North.')}
            {snapshot.supply?.peakHours && tx(`今日用電尖峰預估 ${snapshot.supply.peakHours}。`, ` Today’s demand peak is expected at ${snapshot.supply.peakHours}.`)}
          </p>
        </>
      )}
    </Panel>
  );
}

/* ───────────── 徽章 ───────────── */
export function Medal({ badge, earned, size = 64 }) {
  const c = badge.color;
  const id = `g-${badge.id}`;
  return (
    <svg className={`medal ${earned ? 'on' : 'off'}`} viewBox="0 0 64 64" width={size} height={size}>
      <defs>
        <radialGradient id={id} cx="50%" cy="38%" r="65%">
          <stop offset="0" stopColor={rgb(c, earned ? 0.38 : 0.06)} />
          <stop offset="1" stopColor="rgba(4,6,12,0.9)" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill={`url(#${id})`} stroke={rgb(c, earned ? 0.9 : 0.18)} strokeWidth="1.2" />
      <circle cx="32" cy="32" r="24.5" fill="none" stroke={rgb(c, earned ? 0.35 : 0.08)} strokeWidth="0.8" strokeDasharray="1.5 2.5" />
      {earned ? (
        <g transform="translate(20 20)" fill="none" stroke={rgb(c)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={badge.glyph} />
        </g>
      ) : (
        <text x="32" y="38" textAnchor="middle" fontSize="16" fill="rgba(200,212,240,0.25)">?</text>
      )}
    </svg>
  );
}

export function BadgePanel({ badges, live, onClose }) {
  useT();
  // 點選：點另一個徽章直接切換；再點同一個才收起。說明直接出現在「被點的徽章那一列」的正下方，徽章與說明同時看得到
  // 滑鼠移過只加亮（不改版面，避免說明跳來跳去）
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const selRef = useRef(null);
  const detailRef = useRef(null);
  useEffect(() => {
    if (!sel) return;
    // 先讓說明進入畫面，再確保徽章本身也在畫面內（說明緊接在徽章那一列下方，兩者會一起出現）
    detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const id = setTimeout(() => selRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 260);
    return () => clearTimeout(id);
  }, [sel]);
  const { earned, progress } = badges;
  const count = BADGES.filter((b) => earned[b.id]).length;
  const toggle = (id) => { setHover(null); setSel((cur) => (cur === id ? null : id)); };
  const groups = [['grid', tx('電網徽章', 'Grid badges'), tx('真實電網出現這個狀態的當下打開才拿得到', 'Earned only when the real grid is in that state while the app is open')], ['explore', tx('探索徽章', 'Explorer badges'), tx('使用台灣脈動的各種方式', 'Ways to use the app')]];
  return (
    <Panel title="徽章簿" meta={`${count} / ${BADGES.length}`} onClose={onClose}>
      {!live && <p className="fine warm">{tx('目前是模擬資料，電網徽章暫停頒發（接上台電即時資料後才會取得）。', 'Simulated data — grid badges are paused until live Taipower data is connected.')}</p>}
      {groups.map(([kind, title, sub]) => (
        <section key={kind} className="badge-group">
          <div className="hl-k">{title}<span className="muted">　{sub}</span></div>
          <ul className="badges">
            {BADGES.filter((b) => b.kind === kind).flatMap((b) => {
              const e = earned[b.id];
              const items = [(
                <li
                  key={b.id}
                  ref={sel === b.id ? selRef : null}
                  className={`${e ? 'on' : ''} ${sel === b.id || hover === b.id ? 'sel' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={sel === b.id}
                  aria-expanded={sel === b.id}
                  onClick={() => toggle(b.id)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(b.id); } }}
                  onPointerEnter={(ev) => { if (ev.pointerType === 'mouse') setHover(b.id); }}
                  onPointerLeave={(ev) => { if (ev.pointerType === 'mouse') setHover(null); }}
                >
                  <Medal badge={b} earned={!!e} size={58} />
                  <b>{tx(b.name, b.nameEn)}</b>
                  <small>{e ? new Date(e.at).toLocaleDateString(tx('zh-TW', 'en-US'), { timeZone: 'Asia/Taipei' }) : b.progress ? b.progress(progress) : t(b.rarity)}</small>
                </li>
              )];
              if (sel === b.id) {
                items.push(
                  <li key={`${b.id}-detail`} className="badge-detail" ref={detailRef} aria-live="polite">
                    <b>{tx(b.name, b.nameEn)}</b>{e && <small>　{tx('已取得', 'Earned')} {new Date(e.at).toLocaleDateString(tx('zh-TW', 'en-US'), { timeZone: 'Asia/Taipei' })}</small>}
                    <p>{tx(b.desc, b.descEn)}</p>
                    {!e && <p className="muted">{tx('提示：', 'Hint: ')}{tx(b.hint, b.hintEn)}</p>}
                  </li>
                );
              }
              return items;
            })}
          </ul>
        </section>
      ))}
      {!sel && <p className="fine">{tx('點一下徽章看說明與取得提示。', 'Tap a badge for its description and hint.')}</p>}
      <p className="fine">{tx('徽章存在這台裝置的瀏覽器裡，清除瀏覽資料會一併清除。', 'Badges are stored in this device’s browser; clearing browsing data removes them.')}</p>
    </Panel>
  );
}

export function BadgeToast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onDone, 6000);
    return () => clearTimeout(id);
  }, [toast, onDone]);
  if (!toast) return null;
  const b = toast.badge;
  return (
    <div className="badge-toast" key={toast.key} role="status" onClick={onDone}>
      <div className="converge" style={{ '--c': rgb(b.color) }}>
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${(i / 14) * 360}deg`, '--d': `${(i % 4) * 0.08}s` }} />)}
        <Medal badge={b} earned size={74} />
      </div>
      <div>
        <small>{tx('取得徽章', 'Badge earned')}</small>
        <b>{tx(b.name, b.nameEn)}</b>
        <span>{tx(b.desc, b.descEn)}</span>
      </div>
    </div>
  );
}

/* ───────────── 機組異常橫幅 ───────────── */
export function AlertBanner({ alert, onClose }) {
  if (!alert) return null;
  return (
    <div className="alert-banner" role="status">
      <i />
      <div>
        <b>{plantName(PLANTS.find((p) => p.id === alert.plantId)) || tr(alert.unit)} {tx('出力驟降', 'output drop')}</b>
        <span>{alert.unit}　{fmtMw(alert.from)} → {fmtMw(alert.to)} MW　{tx(`（${alert.time}，偵測）`, `(${alert.time}, detected)`)}</span>
      </div>
      <button className="icon-btn" onClick={onClose} aria-label={tx('關閉', 'Close')}>{Icon.close}</button>
    </div>
  );
}

/* ───────────── 今日回放 ───────────── */
const SPEEDS = [60, 300, 900];
export function ReplayBar({ rows, hasYesterday, replay, setReplay, onFinish }) {
  useT();
  const raf = useRef();
  const last = useRef(performance.now());
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const n = rows.length;

  useEffect(() => {
    if (!replay.playing || n < 2) return; // 資料不到 2 筆不算播完（避免一按回放就頒「時光旅人」）
    last.current = performance.now();
    const step = (now) => {
      const dt = Math.max(0, (now - last.current) / 1000); // rAF 時間戳可能早於 performance.now() → 不可為負
      last.current = now;
      setReplay((r) => {
        const idx = r.idx + (dt * r.speed) / 600; // 每筆 = 10 分鐘 = 600 秒
        if (idx >= n - 1) { setTimeout(() => finish.current?.(), 0); return { ...r, idx: n - 1, playing: false }; }
        return { ...r, idx };
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [replay.playing, n, setReplay]);

  // Esc 結束回放（有面板開著時先關面板）
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.isComposing || document.querySelector('.panel, .upd-wrap, [role="menu"], .pick-banner')) return;
      setReplay((r) => ({ ...r, on: false, playing: false }));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [setReplay]);

  if (!n) return null;
  const cur = rows[Math.max(0, Math.min(n - 1, Math.floor(replay.idx) || 0))];
  if (!cur) return null;
  return (
    <div className="replay">
      <button className="icon-btn play" aria-label={replay.playing ? tx('暫停', 'Pause') : tx('播放', 'Play')} onClick={() => setReplay((r) => ({ ...r, playing: !r.playing, idx: r.idx >= n - 1 ? 0 : r.idx }))}>
        {replay.playing ? <svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg> : <svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" /></svg>}
      </button>
      <div className="replay-time">
        <b>{twHM(cur.t)}</b>
        <small>{cur.reconstructed ? t('回放 · 電廠出力依燃料曲線推估') : t('回放')}</small>
      </div>
      {hasYesterday && (
        <div className="speeds day-sw">
          {['today', 'yesterday'].map((d) => (
            <button key={d} className={(replay.day || 'today') === d ? 'on' : ''} onClick={() => setReplay((r) => ({ ...r, day: d, idx: 0, playing: true }))}>{t(d === 'today' ? '今天' : '昨天')}</button>
          ))}
        </div>
      )}
      <input
        type="range" min="0" max={n - 1} step="0.01" value={replay.idx}
        onChange={(e) => setReplay((r) => ({ ...r, idx: Number(e.target.value), playing: false }))}
        aria-label={tx('回放時間', 'Replay time')}
      />
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={replay.speed === s ? 'on' : ''} onClick={() => setReplay((r) => ({ ...r, speed: s }))}>{s}×</button>
        ))}
      </div>
      <button className="icon-btn" onClick={() => setReplay((r) => ({ ...r, on: false, playing: false }))} aria-label={tx('結束回放', 'Exit replay')}>{Icon.close}</button>
    </div>
  );
}
