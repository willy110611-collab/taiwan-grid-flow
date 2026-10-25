import { useEffect, useRef, useState } from 'react';
import { isEn } from '../i18n.js';

/** 數字緩動：值改變時以 ease-out 平滑滾動 */
export function useTween(value, ms = 1600) {
  const [v, setV] = useState(value ?? 0);
  const from = useRef(v);
  useEffect(() => {
    if (value == null) return;
    // 背景分頁不會跑動畫（rAF 暫停）→ 直接跳到目標值，切回來時不會顯示 0
    if (document.hidden) { from.current = value; setV(value); return; }
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const cur = a + (value - a) * (1 - (1 - p) ** 3);
      from.current = cur;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return v;
}

/**
 * 系統頻率（模擬）
 * 台電沒有公開即時頻率，這裡以多個緩慢正弦 + 濾波雜訊模擬 60 Hz 附近的自然擺動（±0.02 Hz）。
 */
export function useFrequency() {
  const [f, setF] = useState(60);
  useEffect(() => {
    let noise = 0;
    const id = setInterval(() => {
      const t = performance.now() / 1000;
      noise = noise * 0.9 + (Math.random() - 0.5) * 0.004;
      setF(60 + 0.011 * Math.sin((2 * Math.PI * t) / 47) + 0.006 * Math.sin((2 * Math.PI * t) / 13 + 1) + noise);
    }, 500);
    return () => clearInterval(id);
  }, []);
  return f;
}

export function useClock(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export const fmtTime = (d, sec = true) =>
  new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hour12: false
  }).format(d);
export const fmtDate = (d) => {
  if (isEn()) return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).format(d);
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'narrow' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}（${p.weekday}）`;
};
export const fmtMw = (mw) => `${Math.round(mw).toLocaleString()}`;
/** 圖表鍵盤操作：← → 一次一格、Shift 一次 7 格、Home／End 到頭尾（cur＝目前選的索引，n＝總數） */
export const chartKeys = (cur, n, set) => (e) => {
  const step = e.shiftKey ? 7 : 1;
  const next = e.key === 'ArrowLeft' ? cur - step : e.key === 'ArrowRight' ? cur + step : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
  if (next == null) return;
  e.preventDefault();
  set(Math.max(0, Math.min(n - 1, next)));
};
export const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** 線條圖示（不用 emoji，保持高冷科技感） */
export const Icon = {
  globe: (
    <svg viewBox="0 0 24 24"><path d="M12 3.5c-2.6 3-3.6 6-3.6 8.5s1 5.5 3.6 8.5M12 3.5c2.6 3 3.6 6 3.6 8.5s-1 5.5-3.6 8.5" /><circle cx="12" cy="12" r="8.5" /><path d="M3.8 9h16.4M3.8 15h16.4" /></svg>
  ),
  home: (
    <svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v9h11v-9" /><path d="M10.5 19v-4.5h3V19" /></svg>
  ),
  cruise: (
    <svg viewBox="0 0 24 24"><path d="M3 12c3-6 6-6 9 0s6 6 9 0" /><circle cx="12" cy="12" r="1.4" /></svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></svg>
  ),
  info: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
  ),
  sound: (
    <svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>
  ),
  mute: (
    <svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24"><path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z" /><path d="M8 9.5h8M8 12.5h5" /></svg>
  ),
  vibrate: (
    <svg viewBox="0 0 24 24"><rect x="8" y="4" width="8" height="16" rx="1.5" /><path d="M4.5 9v6M19.5 9v6M2 10.5v3M22 10.5v3" /></svg>
  ),
  pylon: (
    <svg viewBox="0 0 24 24"><path d="M12 3 8 21M12 3l4 18M6 8h12M7.5 13h9M9.5 8 14.5 13M14.5 8 9.5 13" /></svg>
  ),
  full: (
    <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
  ),
  unlock: (
    <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></svg>
  ),
  medal: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="6" /><path d="M8.5 9L6 3h4l2 4 2-4h4l-2.5 6M12 11.5v5M10 14h4" /></svg>
  ),
  replay: (
    <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" /><path d="M10 9l5 3-5 3z" /></svg>
  ),
  close: (
    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>
  ),
  store: (
    <svg viewBox="0 0 24 24"><path d="M4 9.5 5.5 5h13L20 9.5" /><path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5" /><path d="M5.5 12v7.5h13V12M10 19.5v-4.5h4v4.5" /></svg>
  ),
  plug: (
    <svg viewBox="0 0 24 24"><path d="M9 3.5v4.5M15 3.5v4.5" /><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z" /><path d="M12 17v3.5" /></svg>
  ),
  more: (
    <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /></svg>
  ),
  search: (
    <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>
  ),
  share: (
    <svg viewBox="0 0 24 24"><path d="M12 3.5v11M8 7.5l4-4 4 4" /><path d="M6 11.5H5v8h14v-8h-1" /></svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /></svg>
  )
};

/** 迷你折線（今日綠能曲線） */
export function Sparkline({ values, color = 'rgb(110,240,190)', w = 220, h = 36 }) {
  if (!values?.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * w,
    h - ((v - min) / (max - min || 1)) * (h - 4) - 2
  ]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={`${d}L${w},${h}L0,${h}Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={color} />
    </svg>
  );
}

/** 資料時間 → 幾分鐘前（台灣時間；可吃「2026-10-24 09:10」「09:10」「ISO」「2026/10/24 09:00」） */
export function minutesAgo(asOf, now = Date.now()) {
  if (!asOf) return null;
  let s = String(asOf).trim().replace(/\//g, '-');
  // 台電 loadpara 的民國日期「115.10.25(日)02:50」→ 2026-10-25 02:50
  const roc = s.match(/^(\d{2,3})\.(\d{1,2})\.(\d{1,2})\D*?(\d{1,2}:\d{2})/);
  if (roc) s = `${+roc[1] + 1911}-${roc[2].padStart(2, '0')}-${roc[3].padStart(2, '0')} ${roc[4].padStart(5, '0')}`;
  let t;
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const tw = new Date(now + 8 * 3600e3);
    const [h, m] = s.split(':').map(Number);
    t = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate(), h, m) - 8 * 3600e3;
    if (t > now + 60e3) t -= 864e5; // 昨天的時間
  } else if (/[T ]\d{1,2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    t = new Date(s.replace(' ', 'T') + '+08:00').getTime();
  } else t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 60e3));
}
