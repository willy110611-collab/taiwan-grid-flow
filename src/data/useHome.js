import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_HOME } from '../config/geo.js';
import { regionAt } from '../map/baseStyle.js';
import { TOWNS } from '../config/towns.js';
import { isEn } from '../i18n.js';

/** 座標 → 最近的鄉鎮市區名稱（例如「台中市西屯區」） */
export function townName(pos) {
  let best = null, bd = Infinity;
  const k = Math.cos((pos[1] * Math.PI) / 180);
  for (const t of TOWNS) {
    const d = ((t[2] - pos[0]) * k) ** 2 + (t[3] - pos[1]) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best ? `${best[0]}${best[1]}` : '地圖選點';
}
/** 顯示用的地名：英文介面用內政部英文名（townName 是比對停電等資料用的中文鍵，不能改） */
const townLabel = (t) => (isEn() && t[4] ? t[4] : `${t[0]}${t[1]}`);
export function townDisplay(pos) {
  const key = townName(pos);
  const t = TOWNS.find((x) => x[0] + x[1] === key);
  return t ? townLabel(t) : isEn() ? 'Picked on map' : key;
}

/** 我的家的名稱（顯示用）：存的可能是中文或英文（看設定當時的介面語言），依目前語言重新翻成同一個地點的名稱 */
export function homeLabel(home) {
  const name = home?.name || '';
  if (!name || !home.pos) return name;
  const key = townName(home.pos);
  const t = TOWNS.find((x) => x[0] + x[1] === key);
  if (t && (name === key || name === t[4])) return townLabel(t);
  const st = name.match(/^(.+?)(?:測站| station)$/);
  if (st) return isEn() ? `${st[1]} station` : `${st[1]}測站`;
  if (name === '地圖選點' || name === 'Picked on map') return isEn() ? 'Picked on map' : '地圖選點';
  return name;
}

/** 搜尋鄉鎮市區（台/臺 視為相同；英文介面也可用英文搜尋，例如 Xitun） */
export function searchTowns(q, limit = 8) {
  const n = (s) => s.replace(/臺/g, '台');
  const key = n(q.trim());
  if (!key) return [];
  const en = key.toLowerCase();
  return TOWNS.filter((t) => n(t[0] + t[1]).includes(key) || (/[a-z]/.test(en) && t[4]?.toLowerCase().replace(/[^a-z ,]/g, '').includes(en.replace(/[^a-z ,]/g, '')))).slice(0, limit)
    .map((t) => ({ name: townLabel(t), pos: [t[2], t[3]] }));
}

/**
 * 我的家：位置、是否申請時間電價、通知開關（存在這台裝置）
 */
const KEY = 'tgf-home';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

export function useHome() {
  const [home, setHomeState] = useState(() => ({ ...DEFAULT_HOME, touUser: false, notify: false, ...(load() || {}) }));
  const setHome = useCallback((patch) => {
    setHomeState((h) => {
      const n = { ...h, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* 略 */ }
      return n;
    });
  }, []);
  const area = home.pos ? regionAt(home.pos) : null;
  return { home: { ...home, region: area?.region || null, county: area?.county || null }, setHome };
}

/** 用目前位置當作「我的家」 */
export function locate(setHome) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('此瀏覽器不支援定位'));
    navigator.geolocation.getCurrentPosition(
      (p) => { const pos = [p.coords.longitude, p.coords.latitude]; setHome({ name: townDisplay(pos), pos }); resolve(); },
      (e) => reject(new Error(e.code === 1 ? '定位權限被拒絕' : '無法取得位置')),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });
}

/**
 * 網頁通知：開著台灣脈動（含桌布、手機加到主畫面）時，事件發生就跳系統通知。
 * 每種事件每天最多一次。完全關閉 App 後的提醒請用 LINE（Cloudflare 排程）。
 */
export function useNotify(enabled, events) {
  const sent = useRef(new Set());
  useEffect(() => {
    if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    for (const ev of events) {
      if (!ev?.on) continue;
      const key = `${day}:${ev.kind}`;
      let stored = false;
      try { stored = localStorage.getItem(`tgf-notified-${key}`); } catch { /* 略 */ }
      if (sent.current.has(key) || stored) continue;
      sent.current.add(key);
      try { localStorage.setItem(`tgf-notified-${key}`, '1'); } catch { /* 略 */ }
      try { new Notification('台灣脈動', { body: ev.text, icon: './icon-192.png', tag: ev.kind }); } catch { /* 部分瀏覽器只允許 Service Worker 通知 */ }
    }
  }, [enabled, events]);
}

export async function requestNotify() {
  if (typeof Notification === 'undefined') throw new Error('此瀏覽器不支援通知（iPhone 需先「加入主畫面」）');
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error('通知權限未允許');
}

/* ───────── App 通知（Web Push，免費）───────── */
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const urlB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export function pushSupport() {
  if (!('serviceWorker' in navigator)) return { ok: false, why: '此瀏覽器不支援 App 通知' };
  if (isIOS() && !standalone()) return { ok: false, why: 'iPhone 要先用 Safari「分享 → 加入主畫面」，再從主畫面打開台灣脈動開啟（iOS 16.4 以上）', ios: true };
  if (!('PushManager' in window) || typeof Notification === 'undefined') return { ok: false, why: '此瀏覽器不支援 App 通知' };
  return { ok: true };
}

/** 開啟 App 通知：向中繼站登記（site = 我的家最近的空品測站） */
export async function enablePush(relayUrl, vapidPublic, site, { test = true, extra = {} } = {}) {
  const sup = pushSupport();
  if (!sup.ok) throw new Error(sup.why);
  if (!vapidPublic) throw new Error('通知服務暫時無法使用，請稍後再試');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('通知權限未允許（可到手機設定 → 通知 開啟）');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(vapidPublic) }));
  const r = await fetch(`${relayUrl}/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), site, test, lang: isEn() ? 'en' : 'zh', ...extra }) });
  if (!r.ok) throw new Error('通知服務暫時無法使用，請稍後再試'); // 原因（KV 未綁定、格式等）寫在手冊，訪客只需要知道暫時無法使用
  return r.json().catch(() => ({}));
}

export async function disablePush(relayUrl) {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  await fetch(`${relayUrl}/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
