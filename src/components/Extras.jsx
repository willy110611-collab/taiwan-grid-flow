import { useEffect, useRef } from 'react';
import { BADGES } from '../data/badges.js';
import { REGION_KEYS } from '../config/geo.js';
import { EVIDENCE } from '../config/energy.js';
import { Panel } from './Panels.jsx';
import { Icon, fmtMw, rgb } from './widgets.jsx';
import { twHM } from '../data/history.js';

/* ───────────── 供電燈號 ───────────── */
export function SupplyChip({ supply }) {
  if (!supply) return null;
  const c = rgb(supply.color);
  return (
    <div className="supply" title={supply.evidence === 'live' ? '台電公布：今日尖峰預估備轉容量率' : '模擬值'}>
      <i style={{ background: c, boxShadow: `0 0 10px ${c}` }} />
      <span>{supply.label}</span>
      <b>{supply.rate?.toFixed(1)}%</b>
      <small>{supply.evidence === 'live' ? '尖峰備轉' : '模擬'}</small>
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
      {!regions ? <p className="muted">資料讀取中…</p> : (
        <>
          <p className="fine">
            <em className={`tag ${ev}`}>{EVIDENCE[ev].label}</em>
            {ev === 'live' ? `台電各區即時發電／用電${regions.time ? `（${regions.time.slice(-5)}）` : ''}` : '依典型區域比例推估'}
          </p>
          <ul className="region-bars">
            {REGION_KEYS.map((k) => {
              const r = regions.byKey[k];
              const absorb = r.ratio < 1;
              return (
                <li key={k}>
                  <div className="rb-head">
                    <b>{r.name}</b>
                    <span className={absorb ? 'warm' : 'cool'}>
                      自給 {Math.round(r.ratio * 100)}% · {absorb ? '吸能' : '供能'}
                    </span>
                  </div>
                  <div className="rb-bar"><span className="load" style={{ width: `${(r.load / max) * 100}%` }} /></div>
                  <div className="rb-bar"><span className="gen" style={{ width: `${(r.gen / max) * 100}%` }} /></div>
                  <div className="rb-nums">
                    <span>用電 {fmtMw(r.load)} MW</span>
                    <span>發電 {fmtMw(r.gen)} MW</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="fine">
            地圖上的區域底色：<span className="warm">暖色</span> 表示用電大於發電，需要從外區送電進來（吸能）；
            <span className="cool">冷色</span> 表示發電有剩，往外送（供能）。都市光暈越大代表用電越多。
            {snapshot.supply?.peakHours && `今日用電尖峰預估 ${snapshot.supply.peakHours}。`}
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
  const { earned, progress } = badges;
  const count = BADGES.filter((b) => earned[b.id]).length;
  const groups = [['grid', '電網徽章', '真實電網出現這個狀態的當下打開才拿得到'], ['explore', '探索徽章', '使用光脈搏的各種方式']];
  return (
    <Panel title={`徽章簿 ${count} / ${BADGES.length}`} onClose={onClose}>
      {!live && <p className="fine warm">目前是模擬資料，電網徽章暫停頒發（接上台電即時資料後才會取得）。</p>}
      {groups.map(([kind, title, sub]) => (
        <section key={kind} className="badge-group">
          <div className="hl-k">{title}<span className="muted">　{sub}</span></div>
          <ul className="badges">
            {BADGES.filter((b) => b.kind === kind).map((b) => {
              const e = earned[b.id];
              return (
                <li key={b.id} className={e ? 'on' : ''}>
                  <Medal badge={b} earned={!!e} size={58} />
                  <b>{b.name}</b>
                  <small>{e ? new Date(e.at).toLocaleDateString('zh-TW') : b.progress ? b.progress(progress) : b.rarity}</small>
                  <span className="badge-tip">{e ? b.desc : `${b.desc}\n提示：${b.hint}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="fine">徽章存在這台裝置的瀏覽器裡，清除瀏覽資料會一併清除。</p>
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
    <div className="badge-toast" key={toast.key} onClick={onDone}>
      <div className="converge" style={{ '--c': rgb(b.color) }}>
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${(i / 14) * 360}deg`, '--d': `${(i % 4) * 0.08}s` }} />)}
        <Medal badge={b} earned size={74} />
      </div>
      <div>
        <small>取得徽章</small>
        <b>{b.name}</b>
        <span>{b.desc}</span>
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
        <b>{alert.plant || alert.unit} 出力驟降</b>
        <span>{alert.unit}　{fmtMw(alert.from)} → {fmtMw(alert.to)} MW　（{alert.time}，偵測）</span>
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="關閉">{Icon.close}</button>
    </div>
  );
}

/* ───────────── 今日回放 ───────────── */
const SPEEDS = [60, 300, 900];
export function ReplayBar({ rows, replay, setReplay, onFinish }) {
  const raf = useRef();
  const last = useRef(performance.now());
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const n = rows.length;

  useEffect(() => {
    if (!replay.playing) return;
    last.current = performance.now();
    const step = (now) => {
      const dt = (now - last.current) / 1000;
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

  if (!n) return null;
  const cur = rows[Math.min(n - 1, Math.floor(replay.idx))];
  return (
    <div className="replay">
      <button className="icon-btn play" onClick={() => setReplay((r) => ({ ...r, playing: !r.playing, idx: r.idx >= n - 1 ? 0 : r.idx }))}>
        {replay.playing ? <svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg> : <svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" /></svg>}
      </button>
      <div className="replay-time">
        <b>{twHM(cur.t)}</b>
        <small>{cur.reconstructed ? '回放 · 電廠出力依燃料曲線推估' : '回放'}</small>
      </div>
      <input
        type="range" min="0" max={n - 1} step="0.01" value={replay.idx}
        onChange={(e) => setReplay((r) => ({ ...r, idx: Number(e.target.value), playing: false }))}
        aria-label="回放時間"
      />
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={replay.speed === s ? 'on' : ''} onClick={() => setReplay((r) => ({ ...r, speed: s }))}>{s}×</button>
        ))}
      </div>
      <button className="icon-btn" onClick={() => setReplay((r) => ({ ...r, on: false, playing: false }))} aria-label="結束回放">{Icon.close}</button>
    </div>
  );
}
