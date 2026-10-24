import { TAIWAN_BOUNDS } from '../config/geo.js';
import { fitPadding } from './GridFlowEngine.js';

/**
 * 放空巡航 — 鏡頭在幾個「能量場景」之間緩慢飛行，抵達後持續微微旋轉
 * （仿軌島放空模式：每隔幾分鐘自動換視角，適合當桌面背景或第二螢幕）
 */
export const SHOTS = [
  { name: '全島能量網', bounds: TAIWAN_BOUNDS, pitch: 30, bearing: -8 },
  { name: '北部負載中心', center: [121.22, 24.98], zoom: 8.9, pitch: 52, bearing: -24 },
  { name: '中部火力走廊', center: [120.55, 24.2], zoom: 8.7, pitch: 56, bearing: 18 },
  { name: '西部能量動脈', center: [120.5, 23.75], zoom: 7.75, pitch: 58, bearing: -32 },
  { name: '嘉南光電星海', center: [120.2, 23.25], zoom: 8.9, pitch: 50, bearing: 12, day: true }, // 只在白天（晚上太陽能是 0）
  { name: '南部電源基地', center: [120.32, 22.75], zoom: 8.8, pitch: 52, bearing: -18 },
  { name: '彰濱離岸風場', center: [120.38, 24.08], zoom: 9.3, pitch: 55, bearing: 30 },
  { name: '離島微光', center: [119.4, 24.6], zoom: 6.7, pitch: 35, bearing: -10 }
];

export class Cruise {
  /**
   * @param map MapLibre map
   * @param opts.dwell  [最短, 最長] 每個場景停留秒數
   * @param opts.onShot (name|null) => void   場景切換時通知 HUD
   */
  constructor(map, { dwell = [60, 90], onShot, isDay = () => true } = {}) {
    this.isDay = isDay;
    this.map = map;
    this.dwell = dwell;
    this.onShot = onShot;
    this.active = false;
    this.idx = 0;
    this.timer = null;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.idx = Math.floor(Math.random() * SHOTS.length);
    this.next();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    this.map.stop();
    this.onShot?.(null);
  }

  toggle() {
    this.active ? this.stop() : this.start();
    return this.active;
  }

  next() {
    if (!this.active) return;
    let shot = SHOTS[this.idx % SHOTS.length];
    this.idx += 1 + Math.floor(Math.random() * 2); // 偶爾跳過一個，避免順序太規律
    if (shot.day && !this.isDay()) { shot = SHOTS[this.idx % SHOTS.length]; this.idx += 1; }
    this.onShot?.(shot.name);

    const cam = this.camera(shot);
    const fly = 14000;
    // padding 歸零：避免殘留的抽屜留白讓畫面偏到上方
    this.map.flyTo({ ...cam, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: fly, curve: 1.2, essential: true });

    const stay = (this.dwell[0] + Math.random() * (this.dwell[1] - this.dwell[0])) * 1000;
    // 抵達後：極慢速旋轉 + 微推近，像在空中漂浮
    this.timer = setTimeout(() => {
      if (!this.active) return;
      this.map.easeTo({
        bearing: cam.bearing + (Math.random() < 0.5 ? -14 : 14),
        zoom: cam.zoom + 0.25,
        duration: stay,
        easing: (t) => t
      });
      this.timer = setTimeout(() => this.next(), stay);
    }, fly + 200);
  }

  camera(shot) {
    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    if (shot.bounds) {
      // 手機：上下留給 HUD，整座島不被擋住
      const pad = w < 700 ? fitPadding() : Math.min(w, h) * 0.06;
      const c = this.map.cameraForBounds(shot.bounds, { padding: pad });
      return { center: c.center, zoom: c.zoom, pitch: shot.pitch, bearing: shot.bearing };
    }
    // 依螢幕短邊微調縮放：手機直立螢幕不會擠、4K 桌面不會太遠
    const adj = Math.log2(Math.min(w, h) / 820);
    return { center: shot.center, zoom: shot.zoom + adj, pitch: shot.pitch, bearing: shot.bearing };
  }
}
