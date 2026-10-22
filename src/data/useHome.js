import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_HOME } from '../config/geo.js';
import { regionAt } from '../map/baseStyle.js';

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
  const area = regionAt(home.pos);
  return { home: { ...home, region: area?.region || null, county: area?.county || null }, setHome };
}

/** 用目前位置當作「我的家」 */
export function locate(setHome) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('此瀏覽器不支援定位'));
    navigator.geolocation.getCurrentPosition(
      (p) => { setHome({ name: '目前位置', pos: [p.coords.longitude, p.coords.latitude] }); resolve(); },
      (e) => reject(new Error(e.code === 1 ? '定位權限被拒絕' : '無法取得位置')),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });
}

/**
 * 網頁通知：開著光脈搏（含桌布、手機加到主畫面）時，事件發生就跳系統通知。
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
      try { new Notification('台灣光脈搏', { body: ev.text, icon: './icon-192.png', tag: ev.kind }); } catch { /* 部分瀏覽器只允許 Service Worker 通知 */ }
    }
  }, [enabled, events]);
}

export async function requestNotify() {
  if (typeof Notification === 'undefined') throw new Error('此瀏覽器不支援通知（iPhone 需先「加入主畫面」）');
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error('通知權限未允許');
}
