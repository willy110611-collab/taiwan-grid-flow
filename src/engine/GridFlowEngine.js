import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, IconLayer, PathLayer, TextLayer, PolygonLayer } from '@deck.gl/layers';
import { aqiLevel, nearestWind } from '../data/useAir.js';
import { THERMAL } from '../config/energy.js';

import { PLANTS, LOADS, TAIWAN_BOUNDS, REGIONS, REGION_KEYS, LOAD_REGION } from '../config/geo.js';
import { FUELS, FUEL_KEYS, FILTERS, EVIDENCE } from '../config/energy.js';
import { createBaseStyle } from '../map/baseStyle.js';
import { solveFlows } from './flowModel.js';
import { ParticleSystem } from './ParticleSystem.js';
import { createGlowSprite } from './glowSprite.js';
import { Cruise } from './cruise.js';
import { NUCLEAR, NUCLEAR_IDS } from '../config/nuclear.js';
import { isEn, tx } from '../i18n.js';
import { solarSun } from '../data/parseGenary.js';
import { daylightState, daylightPalette, applyDaylight } from './daylight.js';

/** 加法混合：光疊光會更亮，是「發光感」的關鍵 */
const ADDITIVE = {
  depthCompare: 'always',
  depthWriteEnabled: false,
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha'
};
const NO_DEPTH = { depthCompare: 'always', depthWriteEnabled: false };
const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const BREATH_PERIOD = 7.5; // 秒；約每分鐘 8 次，接近人放鬆時的呼吸
/** 供電燈號 → 呼吸週期（越吃緊呼吸越急促）與負載點色調 */
const TENSION = [
  { period: 7.5, tint: [235, 242, 255] },
  { period: 5.6, tint: [255, 226, 160] },
  { period: 4.3, tint: [255, 176, 110] },
  { period: 3.2, tint: [255, 110, 100] },
  { period: 3.2, tint: [255, 110, 100] }
];

/**
 * GridFlowEngine — 地圖 + deck.gl + 粒子系統的協調者
 * ─────────────────────────────────────────────────────────────
 * 動畫迴圈完全在 React 之外跑（requestAnimationFrame → overlay.setProps），
 * React 只負責 HUD。這樣高幀率更新不會觸發任何 React re-render。
 *
 * 選項
 *  mode     'app'（可互動）| 'wallpaper'（桌布：不可互動、自動巡航）
 *  fps      幀率上限；手機與桌布預設 30（省電，仿軌島手機預設省電模式）
 *  onStats  每次資料更新後回報推估統計（南電北送量等）
 *  onShot   放空巡航切換場景時回報場景名稱
 *  onDaylight 日夜狀態改變時回報（給 HUD 調整天空色）
 */
export class GridFlowEngine {
  constructor(container, { density = 1, mode = 'app', fps = 60, initialView = null, onStats, onShot, onDaylight, onUserMove, onPlantVisit, onAway, onPlantSelect } = {}) {
    this.onAway = onAway;
    this.onPlantSelect = onPlantSelect;
    this.onPlantVisit = onPlantVisit;
    this.breathPhase = 0;
    this.tension = 0;
    this.demandView = false;
    this.demandMix = 0;
    this.airView = false;
    this.airMix = 0;
    this.nukeView = false;
    this.nukeMix = 0;
    this.stations = [];
    this.home = null;
    this.clockOverride = null;
    this.regions = null;
    this.mode = mode;
    this.frameMs = 1000 / fps;
    this.baseFrameMs = this.frameMs;
    this.baseDensity = density;
    this.onStats = onStats;
    this.onDaylight = onDaylight;
    this.sprite = createGlowSprite();
    this.time = 0;
    this.source = 'simulated';
    this.hover = { id: null, alpha: 0, shownId: null };
    this.fuelVisTarget = new Float32Array(FUEL_KEYS.length).fill(1);

    // 節點狀態（顯示值會 tween 到目標值，資料刷新時平滑過渡）
    this.plants = PLANTS.map((p, i) => ({
      ...p, idx: i, mw: 0, targetMw: 0, liveMw: 0, mix: {}, color: [255, 255, 255], vis: 1,
      phase: Math.random() * Math.PI * 2, sparkles: makeSparkles(p.pos, 260)
    }));
    this.loads = LOADS.map((l, i) => ({ ...l, idx: i, energy: 0, pulse: 0, mw: 0, targetLoadMw: 0 }));
    this.puffs = [];

    this.particles = new ParticleSystem({
      density,
      onArrive: (targetIdx, _p, r, g, b) => {
        const L = this.loads[targetIdx];
        if (!L) return;
        L.pulse += 1;
        if (this.puffs.length < 420 && Math.random() < 0.35) {
          const j = 0.012;
          this.puffs.push({
            pos: [L.pos[0] + (Math.random() - 0.5) * j, L.pos[1] + (Math.random() - 0.5) * j],
            age: 0, color: [r, g, b]
          });
        }
      }
    });

    const wallpaper = mode === 'wallpaper';
    this.map = new maplibregl.Map({
      container,
      style: createBaseStyle(),
      // 有存過的桌布固定視角就直接用，否則顯示全島
      ...(initialView || { bounds: TAIWAN_BOUNDS, fitBoundsOptions: { padding: fitPadding() }, pitch: 28, bearing: -8 }),
      maxPitch: 65,
      minZoom: 4.8,
      maxZoom: 12,
      maxBounds: MAX_BOUNDS,
      attributionControl: false,
      fadeDuration: 0
    });
    // 桌布模式預設鎖定：點擊、滾輪、拖曳都無效，避免在桌面上誤觸縮放（按鎖頭才解鎖）
    if (wallpaper) this.setLocked(true);
    this.userMoved = false;
    this.map.on('moveend', (e) => { if (e.originalEvent) { this.userMoved = true; this.onAway?.(true); onUserMove?.(); } });
    if (!wallpaper) this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // 地形圖磚載不到（離線）時只會少了山影，其餘照常；這裡吞掉錯誤避免洗版
    this.map.on('error', (e) => {
      if (e?.sourceId !== 'dem') console.warn('[map]', e?.error?.message || e);
    });
    this.map.on('style.load', () => this.updateDaylight(true));

    // 畫面尺寸變動（iPhone 鍵盤收合、從背景回來、轉向、網址列伸縮）時，地圖畫布一定跟著重算，
    // 避免畫布停在一半高度 →「電力網只顯示一半在最上方」
    const fix = () => {
      const c = this.map.getContainer();
      const cv = this.map.getCanvas();
      if (Math.abs(cv.clientHeight - c.clientHeight) > 1 || Math.abs(cv.clientWidth - c.clientWidth) > 1) this.map.resize();
    };
    this.resizeObs = new ResizeObserver(() => { this.map.resize(); });
    this.resizeObs.observe(container);
    this.onVis = () => { if (!document.hidden) setTimeout(() => { fix(); this.refitIfIdle?.(); }, 250); };
    document.addEventListener('visibilitychange', this.onVis);
    addEventListener('pageshow', this.onVis);
    window.visualViewport?.addEventListener('resize', fix);
    this.fixSize = fix;
    this.sizeCheck = setInterval(fix, 2000); // 保險：每 2 秒檢查一次畫布是否和容器一樣大

    this.overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      onHover: (info) => this.setHover(info.layer?.id === 'pick' ? info.object?.id : null),
      onClick: (info) => {
        const id = info.layer?.id === 'pick' ? info.object?.id : null;
        this.setHover(id);
        if (id && this.mode !== 'wallpaper') this.onPlantSelect?.(id); // 點電廠 → 打開電廠詳細卡
      },
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : this.map?.dragPan.isEnabled() ? 'grab' : 'default')
    });
    this.map.addControl(this.overlay);

    // 放空巡航：桌布模式場景停留 3–5 分鐘；App 模式 60–90 秒
    this.cruise = new Cruise(this.map, { dwell: wallpaper ? [180, 300] : [60, 90], onShot, isDay: () => (this.lastDay?.elev ?? 10) > 3 });
    if (wallpaper && !initialView) setTimeout(() => this.cruise.start(), 5000);
    else {
      // 使用者一碰地圖就停止巡航，把鏡頭還給使用者
      const userStop = (e) => { if (e.originalEvent) this.cruise.stop(); };
      ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((ev) => this.map.on(ev, userStop));
    }

    this.lastDraw = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 新的電網快照進來：更新節點目標值、重算流向矩陣 */
  setSnapshot(snapshot) {
    this.lastSnapshot = snapshot;
    this.source = snapshot.source;
    const byId = Object.fromEntries(snapshot.plants.map((p) => [p.id, p]));
    for (const p of this.plants) {
      const s = byId[p.id];
      p.targetMw = s?.mw || 0;
      p.liveMw = s?.liveMw || 0;
      p.estimated = !!s?.estimated;
      p.mix = s?.mix || {};
      p.dominant = Object.entries(p.mix).sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    // 用電端：各區用電（台電即時或推估）分配到負載點 → 負載點的引力（需求權重）與光暈大小
    this.regions = snapshot.regions || null;
    for (const L of this.loads) {
      if (L.island) {
        // 離島：用電 ≈ 島上電廠的發電（獨立電網）
        L.targetLoadMw = this.plants.filter((p) => p.island === L.island).reduce((a, p) => a + p.targetMw, 0);
        L.demand = L.targetLoadMw;
        continue;
      }
      const [rk, share] = LOAD_REGION[L.id] || ['N', 0];
      const rl = this.regions?.byKey?.[rk]?.load;
      L.targetLoadMw = rl ? rl * share : LOADS[L.idx].demand * snapshot.total; // 用設定的比例（L.demand 下一行會被改成 MW）
      L.demand = L.targetLoadMw;
    }
    this.tension = snapshot.supply?.level ?? 0;
    this.updateRegionHeat(true);

    const sources = this.plants.map((p) => ({ pos: p.pos, mw: p.targetMw, mix: p.mix }));
    // 本島：重力模型分配；離島：獨立電網，電廠直接送到島上的城鎮
    const mainP = this.plants.filter((p) => !p.island);
    const mainL = this.loads.filter((l) => !l.island);
    const flows = solveFlows(mainP.map((p) => sources[p.idx]), mainL).map((f) => ({
      ...f, source: mainP[f.source].idx, target: mainL[f.target].idx
    }));
    for (const p of this.plants) {
      if (!p.island || p.targetMw < 0.5) continue;
      const L = this.loads.find((l) => l.island === p.island);
      if (L) flows.push({ source: p.idx, target: L.idx, mw: p.targetMw, island: true });
    }
    // 抽蓄抽水（儲能負載）：電從各電廠「流進」明潭／大觀二，依各電廠出力比例分攤
    const pumpMw = snapshot.charging?.pump || 0;
    const pumpPlant = this.plants.find((p) => p.id === 'mingtan');
    const targets = [...this.loads];
    if (pumpMw > 5 && pumpPlant) {
      const tIdx = targets.push({ id: 'pump', pos: pumpPlant.pos }) - 1;
      const sumMw = mainP.reduce((a, p) => a + p.targetMw, 0) || 1;
      for (const p of mainP) {
        if (p.id === 'mingtan' || p.targetMw < 50) continue;
        flows.push({ source: p.idx, target: tIdx, mw: (pumpMw * p.targetMw) / sumMw });
      }
    }
    this.charging = snapshot.charging || null;
    this.particles.setFlows(flows, sources, targets);

    const top = [...this.plants].sort((a, b) => b.targetMw - a.targetMw)[0];
    this.onStats?.({
      southToNorthMw: this.particles.southToNorth(sources, targets),
      topPlant: top ? { name: top.name, mw: top.targetMw } : null
    });
  }

  /** 能源篩選：'all' | 'green' | 'thermal' | 'nuclear' */
  setFilter(id) {
    const f = FILTERS.find((x) => x.id === id) || FILTERS[0];
    this.demandView = !!f.demand;
    this.airView = !!f.air;
    const wasNuke = this.nukeView;
    this.nukeView = f.id === 'nuclear';
    // 電腦版：核三在全島視角最南端，常被底部工具列蓋住 → 切到核能時把全島放在工具列上方、右側面板左邊
    if (this.nukeView && window.innerWidth >= 700 && !this.userMoved && !this.cruise.active && this.mode !== 'wallpaper') {
      this.map.fitBounds(TAIWAN_BOUNDS, { padding: { top: 100, bottom: 190, left: 60, right: 440 }, pitch: this.map.getPitch(), bearing: this.map.getBearing(), duration: 1000 });
    } else if (wasNuke && !this.nukeView && window.innerWidth >= 700) this.refitIfIdle(); // 離開核能：回到原本的全島視角
    FUEL_KEYS.forEach((k, i) => {
      // 用電視角：發電粒子全部保留但調暗，讓注意力回到「誰在吸能」
      this.fuelVisTarget[i] = f.demand ? 0.5 : f.air ? (THERMAL.has(k) ? 0.55 : 0.25) : !f.fuels || f.fuels.includes(k) ? 1 : 0;
    });
  }

  /** 鎖定 / 解鎖地圖互動（桌布模式用） */
  setLocked(locked) {
    for (const h of ['scrollZoom', 'boxZoom', 'dragRotate', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch']) {
      locked ? this.map[h].disable() : this.map[h].enable();
    }
    this.map.getCanvas().style.cursor = locked ? 'default' : 'grab';
  }

  /** 目前鏡頭（存成桌布固定視角） */
  getView() {
    const m = this.map;
    const c = m.getCenter();
    return { center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
  }

  toggleCruise() {
    return this.cruise.toggle();
  }

  /** 回到一開始的全島俯視圖（停止巡航、清除手動移動） */
  resetView() {
    this.cruise.stop();
    this.sheetSaved = null;
    this.userMoved = false;
    this.map.setMaxBounds(MAX_BOUNDS);
    clearPadding(this.map);
    this.map.fitBounds(TAIWAN_BOUNDS, { padding: fitPadding(), pitch: 28, bearing: -8, duration: 1800, essential: true });
    this.onAway?.(false);
  }

  /** HUD 高度改變後（資料載入、出現小卡）重新把全島放進可見區域；使用者動過地圖或在巡航就不動 */
  refitIfIdle() {
    if (this.userMoved || this.cruise.active || this.sheetSaved || this.mode === 'wallpaper') return;
    clearPadding(this.map);
    this.map.fitBounds(TAIWAN_BOUNDS, { padding: fitPadding(), pitch: this.map.getPitch(), bearing: this.map.getBearing(), duration: 800 });
  }

  /** 手機底部抽屜打開：讓台灣（或我的家附近）落在抽屜上方的可見區域 */
  fitAboveSheet({ sheetPx, topPx, focus }) {
    const m = this.map;
    this.sheetSaved ||= { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
    // 可見區域很矮時需要拉得比平常遠，暫時解除地圖邊界限制（關閉抽屜時恢復）
    m.setMaxBounds(null);
    const padding = { top: topPx, bottom: sheetPx, left: 12, right: 12 };
    if (focus) {
      const visible = m.getContainer().clientHeight - sheetPx - topPx;
      m.easeTo({ center: focus, zoom: 7.8 + Math.log2(Math.max(160, visible) / 420), pitch: 25, bearing: 0, padding, duration: 1100 });
    } else {
      m.fitBounds(TAIWAN_BOUNDS, { padding, pitch: 0, bearing: 0, duration: 1100 });
    }
  }

  /**
   * 手機底部抽屜打開「電廠卡」：保持目前的縮放、傾斜與角度，只平移讓電廠落在抽屜上方
   *  電廠本來就在看得到的地方 → 完全不動；關閉抽屜時 restoreSheetView 回到原畫面
   */
  panAboveSheet({ sheetPx, topPx, pos }) {
    const m = this.map;
    this.sheetSaved ||= { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
    const H = m.getContainer().clientHeight, W = m.getContainer().clientWidth;
    const pt = m.project(pos);
    const margin = 36;
    // 只平移「剛好讓電廠露出來」的距離，不把它移到正中央（例如核三在最南端，置中會空出一大片海）
    const dy = pt.y > H - sheetPx - margin ? pt.y - (H - sheetPx - margin * 2) : pt.y < topPx + margin ? pt.y - (topPx + margin * 2) : 0;
    const dx = pt.x < margin ? pt.x - margin * 2 : pt.x > W - margin ? pt.x - (W - margin * 2) : 0;
    if (!dx && !dy) return;
    m.setMaxBounds(null);
    m.panBy([dx, dy], { duration: 700 });
  }

  /** 搜尋或分享連結選到電廠：飛過去（至少拉近到看得清楚的距離），right/bottom 留給面板 */
  focusPlant(pos, { padding = {}, minZoom = 8.6 } = {}) {
    const m = this.map;
    this.cruise.stop();
    this.userMoved = true;
    this.onAway?.(true);
    m.setMaxBounds(null);
    m.easeTo({ center: pos, zoom: Math.max(m.getZoom(), minZoom), padding: { top: 0, bottom: 0, left: 0, right: 0, ...padding }, duration: 1200 });
    m.once('moveend', () => m.setMaxBounds(MAX_BOUNDS));
  }

  /** 省電：降低幀率與粒子量（電池低、使用者開啟省電模式） */
  setPowerSave(on) {
    if (this.powerSave === on) return;
    this.powerSave = on;
    this.frameMs = on ? Math.max(this.baseFrameMs, 1000 / 20) : this.baseFrameMs;
    this.particles.density = this.baseDensity * (on ? 0.5 : 1);
    if (this.lastSnapshot) this.setSnapshot(this.lastSnapshot);
  }

  /** 抽屜關閉：回到原本的視角 */
  restoreSheetView() {
    if (!this.sheetSaved) return;
    const v = this.sheetSaved;
    this.sheetSaved = null;
    this.map.easeTo({ ...v, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1100 });
    this.map.once('moveend', () => { if (!this.sheetSaved) this.map.setMaxBounds(MAX_BOUNDS); });
  }

  /** 在地圖上點一下選位置（我的家）；回傳取消函式 */
  pickPoint(cb) {
    const canvas = this.map.getCanvas();
    const prev = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    this.picking = true;
    const onClick = (e) => { done(); cb([e.lngLat.lng, e.lngLat.lat]); };
    const done = () => { this.map.off('click', onClick); canvas.style.cursor = prev; this.picking = false; };
    this.map.on('click', onClick);
    return done;
  }

  /** 我的家（地圖上的小光環） */
  setHome(home) {
    this.home = home;
  }

  /** D1 計畫性停電地點（null＝不顯示） */
  setOutages(list) {
    this.outages = list?.length ? list : null;
  }

  /** 空品測站（環境部 AQI）與電廠煙道監測（CEMS） */
  setAir(stations, cems) {
    this.stations = stations || [];
    this.cems = cems || {};
  }

  /** 回放時用回放時間計算日夜色調；null = 現在 */
  setClock(date) {
    this.clockOverride = date;
    this.updateDaylight(true);
  }

  /**
   * 區域用電熱度：用電 > 發電（吸能）→ 暖色，越缺越紅；發電 > 用電（供能）→ 冷色
   * 用 MapLibre 圖層 paint 屬性更新（約每秒 8 次，含呼吸）
   */
  updateRegionHeat(force = false) {
    if (!this.regions || !this.map.getLayer('region-heat')) return;
    const breath = 0.5 + 0.5 * Math.sin(this.breathPhase);
    const colors = ['match', ['get', 'region']];
    const opac = ['match', ['get', 'region']];
    for (const k of REGION_KEYS) {
      const r = this.regions.byKey[k];
      const d = Math.max(-1, Math.min(1, (r.ratio - 1) * 1.4)); // <0 吸能、>0 供能
      const c = d < 0
        ? mixRgb([255, 150, 70], [255, 70, 90], Math.min(1, -d * 1.3))
        : mixRgb([80, 170, 255], [90, 240, 255], d);
      const strength = Math.min(1, Math.abs(d) + 0.15);
      const base = (d < 0 ? 0.05 : 0.035) + 0.09 * strength;
      const boost = 1 + this.demandMix * 2.6;
      colors.push(k, `rgb(${c.map(Math.round).join(',')})`);
      opac.push(k, base * boost * (0.82 + 0.18 * breath));
    }
    colors.push('#000000');
    opac.push(0);
    try {
      this.map.setPaintProperty('region-heat', 'fill-color', colors);
      this.map.setPaintProperty('region-heat', 'fill-opacity', opac);
    } catch { /* 樣式尚未載入 */ }
  }

  updateDaylight(force = false) {
    const st = daylightState(this.clockOverride || new Date());
    if (!force && this.lastDay && Math.abs(st.elev - this.lastDay.elev) < 0.4) return;
    this.lastDay = st;
    const pal = daylightPalette(st);
    applyDaylight(this.map, pal);
    this.onDaylight?.({ ...st, sky: pal.sky });
  }

  frame = (now) => {
    this.raf = requestAnimationFrame(this.frame);
    // 幀率上限（省電模式）
    if (now - this.lastDraw < this.frameMs - 2) return;
    const dt = Math.min(0.05, (now - this.lastDraw) / 1000);
    this.lastDraw = now;
    this.time += dt;

    // 每 30 秒檢查一次日夜色調
    if (Math.floor(this.time / 30) !== Math.floor((this.time - dt) / 30)) this.updateDaylight();
    // 呼吸：以相位累加，供電燈號改變週期時不會跳動
    this.breathPhase += (dt * 2 * Math.PI) / TENSION[this.tension].period;
    this.demandMix += ((this.demandView ? 1 : 0) - this.demandMix) * (1 - Math.exp(-dt / 0.3));
    this.airMix += ((this.airView ? 1 : 0) - this.airMix) * (1 - Math.exp(-dt / 0.3));
    this.nukeMix += ((this.nukeView ? 1 : 0) - this.nukeMix) * (1 - Math.exp(-dt / 0.3));
    if (Math.floor(this.time * 8) !== Math.floor((this.time - dt) * 8)) this.updateRegionHeat();

    // 能源篩選：各燃料可見度平滑淡入淡出（約 0.6 秒）
    const kv = 1 - Math.exp(-dt / 0.22);
    const vis = this.particles.fuelVis;
    for (let i = 0; i < vis.length; i++) vis[i] += (this.fuelVisTarget[i] - vis[i]) * kv;

    // tween 節點出力（約 2.5 秒到位）＋ 依篩選計算節點可見比例與顏色
    const k = 1 - Math.exp(-dt / 0.8);
    for (const p of this.plants) {
      p.mw += (p.targetMw - p.mw) * k;
      let tot = 0, shown = 0;
      const c = [0, 0, 0];
      for (const [f, mw] of Object.entries(p.mix)) {
        const fi = FUEL_KEYS.indexOf(f);
        if (fi < 0 || mw <= 0) continue;
        const w = mw * vis[fi];
        tot += mw;
        shown += w;
        for (let j = 0; j < 3; j++) c[j] += FUELS[f].color[j] * w;
      }
      p.vis = tot > 0 ? shown / tot : 0;
      if (shown > 0) p.color = c.map((v) => v / shown);
    }
    for (const L of this.loads) {
      L.mw += (L.targetLoadMw - L.mw) * k;
      L.energy += (L.pulse - L.energy) * (1 - Math.exp(-dt / 0.35));
      L.pulse *= Math.exp(-dt / 0.6);
    }
    for (const f of this.puffs) f.age += dt;
    this.puffs = this.puffs.filter((f) => f.age < 1.6);

    // hover 標籤淡入淡出
    const h = this.hover;
    if (h.id) h.shownId = h.id;
    h.alpha += ((h.id ? 1 : 0) - h.alpha) * (1 - Math.exp(-dt / 0.18));

    this.particles.update(dt, this.time);
    this.overlay.setProps({ layers: this.buildLayers() });
  };

  buildLayers() {
    const t = this.time;
    const breath = 0.5 + 0.5 * Math.sin(this.breathPhase);
    const dm = this.demandMix; // 用電視角：發電端變暗、用電端放大
    const tint = TENSION[this.tension].tint;
    const frame = Math.floor(t * 60);

    const glowAlpha = (p) => {
      let a = 0.9;
      if (p.dominant === 'wind') {
        // 風力：冷色調的呼吸閃爍（兩個不相關頻率疊加 → 不規則但柔和）
        a *= 0.62 + 0.24 * Math.sin(t * 1.9 + p.phase) + 0.14 * Math.sin(t * 4.7 + p.phase * 2);
      }
      return a * (0.85 + 0.15 * breath);
    };
    const glowSize = (p) => {
      const mw = p.mw * p.vis;
      if (p.island) return mw > 0.5 ? (7000 + Math.sqrt(mw) * 700) * (0.96 + 0.08 * breath) : 0; // 離島：最小光暈
      if (p.offshore) return mw > 1 ? (2200 + Math.sqrt(mw) * 380) * (0.96 + 0.08 * breath) : 0; // 離岸風場：小光點，避免彰化外海擠成一團
      return mw > 1 ? 2 * (2600 + Math.sqrt(mw) * 620) * (0.96 + 0.08 * breath) : 0;
    };
    const solarVis = this.particles.fuelVis[FUEL_KEYS.indexOf('solar')];

    const layers = [];

    // ① 光纖：極淡的流線骨架，粗細對應流量
    {
      layers.push(new PathLayer({
        id: 'fibers',
        data: this.particles.fibers().filter((d) => d.mw > 1), // 篩選掉的燃料不畫（widthMinPixels 會讓 0 寬的線仍留一條細線）
        getPath: (d) => d.path,
        getColor: (d) => [...d.color, 255],
        getWidth: (d) => (d.mw > 1 ? 0.4 + Math.sqrt(d.mw) * 0.035 : 0),
        widthUnits: 'pixels',
        widthMinPixels: 0.4,
        capRounded: true,
        jointRounded: true,
        opacity: 0.07 + 0.05 * breath,
        parameters: ADDITIVE
      }));
    }

    // ② 太陽能星光：出力越大，點亮越多顆，各自閃爍
    const stars = [];
    for (const p of this.plants) {
      const solar = (p.mix.solar || 0) * (p.targetMw ? p.mw / p.targetMw : 0);
      if (solar < 10) continue;
      const n = Math.min(p.sparkles.length, Math.floor(Math.sqrt(solar) * 4.2));
      for (let i = 0; i < n; i++) stars.push(p.sparkles[i]);
    }
    layers.push(new ScatterplotLayer({
      id: 'solar-stars',
      data: stars,
      getPosition: (d) => d.pos,
      getRadius: (d) => d.r,
      getFillColor: (d) => {
        const tw = 0.5 + 0.5 * Math.sin(t * d.speed + d.phase);
        return [255, 206, 110, (40 + 170 * tw * tw) * solarVis];
      },
      radiusUnits: 'pixels',
      updateTriggers: { getFillColor: frame },
      parameters: ADDITIVE
    }));

    // ③ 電廠光暈（外層霧 + 內層核心）
    const lit = this.plants.filter((p) => (p.mw > 1 || p.targetMw > 1) && p.vis > 0.01);
    layers.push(new IconLayer({
      id: 'plant-haze',
      data: lit,
      iconAtlas: this.sprite.atlas,
      iconMapping: this.sprite.mapping,
      getIcon: () => 'glow',
      getPosition: (d) => d.pos,
      getSize: (d) => glowSize(d) * 1.9,
      sizeUnits: 'meters',
      sizeMinPixels: 8,
      getColor: (d) => [...d.color, 70 * glowAlpha(d)],
      updateTriggers: { getSize: frame, getColor: frame },
      parameters: ADDITIVE
    }));
    layers.push(new IconLayer({
      id: 'plant-glow',
      data: lit,
      iconAtlas: this.sprite.atlas,
      iconMapping: this.sprite.mapping,
      getIcon: () => 'glow',
      getPosition: (d) => d.pos,
      getSize: (d) => glowSize(d),
      sizeUnits: 'meters',
      sizeMinPixels: 6,
      getColor: (d) => [...d.color, 255 * glowAlpha(d)],
      updateTriggers: { getSize: frame, getColor: frame },
      parameters: ADDITIVE
    }));

    // ④ 能量粒子（binary attributes，每幀直接上傳 TypedArray）
    layers.push(new ScatterplotLayer({
      id: 'particles',
      data: this.particles.getBuffers(),
      radiusUnits: 'pixels',
      radiusScale: 1,
      parameters: ADDITIVE
    }));

    // ⑤ 抵達光暈：粒子在都市化為一圈漸散的微光
    layers.push(new ScatterplotLayer({
      id: 'puffs',
      data: this.puffs,
      getPosition: (d) => d.pos,
      getRadius: (d) => 2 + d.age * 9,
      getFillColor: (d) => [...d.color, 70 * (1 - d.age / 1.6) ** 2],
      radiusUnits: 'pixels',
      updateTriggers: { getRadius: frame, getFillColor: frame },
      parameters: ADDITIVE
    }));

    // ⑥ 都市負載點：白色暖光，接收越多能量越亮
    layers.push(new IconLayer({
      id: 'load-glow',
      data: this.loads,
      iconAtlas: this.sprite.atlas,
      iconMapping: this.sprite.mapping,
      getIcon: () => 'glow',
      getPosition: (d) => d.pos,
      // 光暈大小 = 該負載點用電量（越耗電越大）＋ 粒子抵達的脈動
      getSize: (d) => (5000 + Math.sqrt(d.mw) * 150 * (1 + dm * 0.7)) + Math.sqrt(d.energy) * 4200 + breath * 1500 * (1 + dm),
      sizeUnits: 'meters',
      sizeMinPixels: 10,
      getColor: (d) => [...mixRgb(tint, [255, 140, 90], dm * 0.6), Math.min(255, (70 + Math.sqrt(d.energy) * 60) * (1 + dm * 0.6))],
      updateTriggers: { getSize: frame, getColor: frame },
      parameters: ADDITIVE
    }));

    // ⑥-b 空品視角：測站 AQI 光點 + 火力電廠「下風方向」示意扇形
    const am = this.airMix;
    if (am > 0.02 && this.stations.length) {
      const plumes = [];
      for (const p of this.plants) {
        if (p.island) continue;
        const thermal = Object.entries(p.mix).filter(([f]) => THERMAL.has(f)).reduce((a, [, v]) => a + v, 0);
        if (thermal < 80) continue;
        const w = nearestWind(this.stations, p.pos);
        if (!w || w.d > 45 || w.speed < 0.3) continue;
        const toward = ((w.dir + 180) % 360) * (Math.PI / 180); // 風向是「從哪裡吹來」，煙往反方向飄
        const len = (0.06 + Math.sqrt(thermal) * 0.0028) * Math.min(1.6, 0.6 + w.speed * 0.18);
        for (const [k, half, alpha] of [[1, 0.33, 26], [0.62, 0.22, 34]]) {
          const pts = [p.pos];
          for (let a = -half; a <= half + 1e-6; a += half / 6) {
            const ang = toward + a;
            pts.push([p.pos[0] + (Math.sin(ang) * len * k) / Math.cos((p.pos[1] * Math.PI) / 180), p.pos[1] + Math.cos(ang) * len * k]);
          }
          plumes.push({ poly: pts, alpha });
        }
      }
      layers.push(new PolygonLayer({
        id: 'plumes',
        data: plumes,
        getPolygon: (d) => d.poly,
        getFillColor: (d) => [225, 190, 160, d.alpha * am * (0.85 + 0.15 * breath)],
        stroked: false,
        updateTriggers: { getFillColor: [am, frame] },
        parameters: ADDITIVE
      }));
      const st = this.stations.filter((s) => s.aqi != null);
      layers.push(new IconLayer({
        id: 'aqi-glow',
        data: st,
        iconAtlas: this.sprite.atlas,
        iconMapping: this.sprite.mapping,
        getIcon: () => 'glow',
        getPosition: (d) => [d.lng, d.lat],
        getSize: (d) => 5000 + Math.min(200, d.aqi) * 70,
        sizeUnits: 'meters',
        sizeMinPixels: 8,
        getColor: (d) => [...aqiLevel(d.aqi).color, 150 * am],
        updateTriggers: { getColor: am },
        parameters: ADDITIVE
      }));
      // 數字太密會疊成一團：依螢幕位置挑，AQI 高的優先，彼此至少隔 26 像素（顏色光點仍全部畫）
      const c = this.map.getCenter();
      if (this.stationsRef !== this.stations) { this.aqiGen = (this.aqiGen || 0) + 1; this.stationsRef = this.stations; } // 測站資料換新就重算
      const viewKey = `${this.aqiGen}|${this.map.getCanvas().width}x${this.map.getCanvas().height}|${st.length}|${c.lng.toFixed(3)},${c.lat.toFixed(3)}|${this.map.getZoom().toFixed(2)}|${this.map.getBearing().toFixed(0)}|${this.map.getPitch().toFixed(0)}`;
      const nums = this.memo('aqiNums', viewKey, () => {
        const picked = [];
        for (const s of [...st].sort((a, b) => b.aqi - a.aqi)) {
          const q = this.map.project([s.lng, s.lat]);
          if (picked.every((o) => (o.x - q.x) ** 2 + (o.y - q.y) ** 2 >= 26 * 26)) picked.push({ s, x: q.x, y: q.y });
        }
        return picked.map((o) => o.s);
      });
      layers.push(new TextLayer({
        id: 'aqi-num',
        data: nums,
        getPosition: (d) => [d.lng, d.lat],
        getText: (d) => String(d.aqi),
        getSize: 10,
        getColor: [235, 240, 255, 200 * am],
        fontFamily: MONO,
        characterSet: '0123456789',
        outlineWidth: 3,
        outlineColor: [3, 5, 10, 200 * am],
        fontSettings: { sdf: true, fontSize: 40, buffer: 6 },
        updateTriggers: { getColor: am },
        parameters: NO_DEPTH
      }));
    }

    // ⑥-c 我的家
    if (this.home) {
      layers.push(new ScatterplotLayer({
        id: 'home',
        data: [this.home],
        getPosition: (d) => d.pos,
        getRadius: 7 + breath * 3,
        radiusUnits: 'pixels',
        stroked: true,
        filled: false,
        getLineColor: [110, 240, 190, 220],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.4,
        updateTriggers: { getRadius: frame },
        parameters: NO_DEPTH
      }));
      layers.push(new TextLayer({
        id: 'home-label',
        data: [this.home],
        getPosition: (d) => d.pos,
        getText: (d) => `${tx('我的家', 'Home')} · ${d.name}`,
        getSize: 11,
        getPixelOffset: [0, -18],
        getColor: [150, 245, 205, 230],
        fontFamily: FONT,
        characterSet: 'auto',
        outlineWidth: 3,
        outlineColor: [3, 5, 10, 200],
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
        parameters: NO_DEPTH
      }));
    }

    // ⑥-d 計畫性停電（我的家面板打開時）：同一鄉鎮合併成一個圈，標最早的日期
    if (this.outages) {
      const by = new Map();
      for (const g of this.outages) {
        const k = g.pos.join(',');
        const x = by.get(k) || by.set(k, { pos: g.pos, town: g.town || g.county, date: g.date, n: 0 }).get(k);
        x.n++; if (g.date < x.date) x.date = g.date;
      }
      const pts = [...by.values()];
      layers.push(new ScatterplotLayer({
        id: 'outages',
        data: pts,
        getPosition: (d) => d.pos,
        getRadius: (d) => 9 + Math.min(10, d.n * 1.5),
        radiusUnits: 'pixels',
        stroked: true,
        getFillColor: [255, 140, 60, 60],
        getLineColor: [255, 160, 90, 230],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        parameters: NO_DEPTH
      }));
      // 點太多時只畫圈（避免文字疊在一起），5 個以內才標日期
      if (pts.length <= 5) layers.push(new TextLayer({
        id: 'outage-labels',
        data: pts,
        getPosition: (d) => d.pos,
        getText: (d) => `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))} ${d.town}`,
        getSize: 11,
        getPixelOffset: [0, 22],
        getColor: [255, 190, 130, 240],
        fontFamily: FONT,
        characterSet: 'auto',
        outlineWidth: 3,
        outlineColor: [3, 5, 10, 220],
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
        parameters: NO_DEPTH
      }));
    }

    // ⑥-d 核能分類：三座核電廠（目前都停機，沒有光球）畫冰白圓圈與狀態，提示可以點
    if (this.nukeMix > 0.01) {
      const nm = this.nukeMix;
      const en = isEn();
      const sites = this.plants.filter((p) => NUCLEAR_IDS.includes(p.id));
      layers.push(new ScatterplotLayer({
        id: 'nuke-sites',
        data: sites,
        getPosition: (d) => d.pos,
        getRadius: 8,
        radiusUnits: 'pixels',
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        getLineColor: [214, 228, 255, 220 * nm],
        getFillColor: [214, 228, 255, 40 * nm],
        updateTriggers: { getLineColor: nm, getFillColor: nm },
        parameters: NO_DEPTH
      }));
      // 核一、核二很近：核一的字放左邊、其他放右邊
      const left = (d) => d.id === 'chinshan';
      const lines = this.memo('nukeLines', `${en}|${this.hover.id}|${sites.map((d) => Math.round(d.mix?.nuclear || 0)).join()}`, () => sites.filter((d) => d.id !== this.hover.id).flatMap((d) => { // 被選取的那座已有電廠標籤，不重複
        const n = NUCLEAR[d.id];
        const nmw = d.mix?.nuclear || 0; const mw = nmw > 1 ? ` · ${Math.round(nmw)} MW` : ''; // 只算核能（核二、核三廠內的 Gas 是燃油）
        return [
          { d, text: (en ? n.shortEn : n.short) + mw, size: 12, dy: -7, color: [214, 228, 255] },
          { d, text: en ? n.mapStatusEn || n.statusEn : n.mapStatus || n.status, size: 10, dy: 8, color: [160, 175, 205] }
        ];
      }));
      layers.push(new TextLayer({
        id: 'nuke-labels',
        data: lines,
        getPosition: (x) => x.d.pos,
        getText: (x) => x.text,
        getSize: (x) => x.size,
        getColor: (x) => [...x.color, 255 * nm],
        getPixelOffset: (x) => [left(x.d) ? -14 : 14, x.dy],
        getTextAnchor: (x) => (left(x.d) ? 'end' : 'start'),
        getAlignmentBaseline: 'center',
        fontFamily: FONT,
        characterSet: 'auto',
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
        outlineWidth: 3,
        outlineColor: [3, 5, 10, 200 * nm],
        updateTriggers: { getColor: nm, getText: [en, lines.map((x) => x.text).join()] },
        parameters: NO_DEPTH
      }));
    }

    // ⑦ 互動拾取層（透明圓，專門負責 hover / tap）
    layers.push(new ScatterplotLayer({
      id: 'pick',
      data: this.plants,
      getPosition: (d) => d.pos,
      getRadius: (d) => 14 + Math.min(18, Math.sqrt(d.mw) * 0.25),
      radiusUnits: 'pixels',
      getFillColor: [0, 0, 0, 1],
      pickable: true,
      parameters: NO_DEPTH
    }));

    // ⑧ 融入地圖的文字：負載點名稱（極淡） + hover 電廠標籤（淡入）
    layers.push(new TextLayer({
      id: 'load-names',
      // 手機的用電視角只標主要城市（離島與小負載點只留名字），避免數字擠成一團
      data: window.innerWidth < 700 && dm > 0.5 ? this.loads.filter((l) => !l.island && (l.demand || 0) >= 0.1) : this.loads,
      getPosition: (d) => d.pos,
      getText: (d) => { const nm = isEn() ? (window.innerWidth < 700 && d.enShort) || d.en : d.name; /* 手機英文用短名，避免互相重疊 */ return dm > 0.5 && Math.round(d.mw / 10) * 10 > 0 ? `${nm}\n${tx('約', '~')} ${(Math.round(d.mw / 10) * 10).toLocaleString()} MW` : nm; },
      getColor: [190 + 50 * dm, 205 + 30 * dm, 235, 70 + 150 * dm],
      getSize: 11 + dm,
      getPixelOffset: (d) => (dm > 0.5 && d.side ? [d.side === 'right' ? 14 : -14, -10] : [0, 16 + 4 * dm]),
      getTextAnchor: (d) => (dm > 0.5 && d.side ? (d.side === 'right' ? 'start' : 'end') : 'middle'),
      getAlignmentBaseline: 'top',
      fontFamily: FONT,
      fontWeight: 300,
      lineHeight: 1.35,
      characterSet: 'auto',
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
      outlineWidth: 3 * dm,
      outlineColor: [3, 5, 10, 180],
      updateTriggers: { getText: [dm > 0.5, Math.round(this.time), isEn()], getColor: dm, getSize: dm, getPixelOffset: dm, getTextAnchor: dm > 0.5, data: dm > 0.5 },
      parameters: NO_DEPTH
    }));

    // 彰化外海離岸風場群：一個總量標籤（各風場細節點光點看）
    {
      const ow = this.plants.filter((p) => p.offshore && p.pos[1] < 24.35);
      const owMw = ow.reduce((a, p) => a + (p.mw || 0), 0);
      if (ow.length && dm < 0.5) {
        const c = [Math.min(...ow.map((p) => p.pos[0])) - 0.05, ow.reduce((a, p) => a + p.pos[1], 0) / ow.length];
        layers.push(new TextLayer({
          id: 'offshore-cluster',
          data: [{ pos: c, text: `${tx('彰化外海風場群', 'Offshore wind')}\n${owMw >= 1 ? `${Math.round(owMw).toLocaleString()} MW` : tx('目前風小', 'Light wind')}` }],
          getPosition: (d) => d.pos, getText: (d) => d.text,
          getColor: [150, 235, 255, 150], getSize: 10.5, getTextAnchor: 'end', getAlignmentBaseline: 'center',
          fontFamily: FONT, fontWeight: 300, lineHeight: 1.35, characterSet: 'auto',
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 }, outlineWidth: 3, outlineColor: [3, 5, 10, 180],
          updateTriggers: { getText: [Math.round(owMw), isEn()] }, parameters: NO_DEPTH
        }));
      }
    }

    // 用電視角：四大供電區的自給率標籤
    if (dm > 0.02 && this.regions && window.innerWidth >= 700) {
      const regionData = this.memo('regionLabels', `${isEn()}|${REGION_KEYS.map((k) => `${Math.round(this.regions.byKey[k].load)},${Math.round(this.regions.byKey[k].gen)}`).join('|')}`, () => REGION_KEYS.map((k) => {
        const r = this.regions.byKey[k];
        const pct = Math.round(r.ratio * 100);
        return {
          pos: REGIONS[k].label,
          anchor: REGIONS[k].anchor,
          head: isEn() ? `${REGIONS[k].en}  demand ${Math.round(r.load).toLocaleString()} MW` : `${r.name}  用電 ${Math.round(r.load).toLocaleString()} MW`,
          sub: isEn() ? `gen ${Math.round(r.gen).toLocaleString()} MW · self-supply ${pct}% · ${r.ratio >= 1 ? 'exporting ↗' : 'importing ↙'}` : `發電 ${Math.round(r.gen).toLocaleString()} MW · 自給 ${pct}% · ${r.ratio >= 1 ? '供能 ↗' : '吸能 ↙'}`,
          color: r.ratio >= 1 ? [120, 210, 255] : [255, 160, 110]
        };
      }).flatMap((r) => [
        { pos: r.pos, anchor: r.anchor, text: r.head, size: 13, off: [0, -9], color: [235, 240, 255] },
        { pos: r.pos, anchor: r.anchor, text: r.sub, size: 10.5, off: [0, 9], color: r.color }
      ]));
      layers.push(new TextLayer({
        id: 'region-labels',
        data: regionData,
        getPosition: (d) => d.pos,
        getText: (d) => d.text,
        getSize: (d) => d.size,
        getPixelOffset: (d) => d.off,
        getTextAnchor: (d) => d.anchor || 'middle',
        getColor: (d) => [...d.color, 255 * dm],
        fontFamily: FONT,
        characterSet: 'auto',
        fontSettings: { sdf: true, fontSize: 56, buffer: 8 },
        outlineWidth: 4,
        outlineColor: [3, 5, 10, 220 * dm],
        updateTriggers: { getColor: dm, getText: [Math.round(this.time / 5), isEn()] },
        parameters: NO_DEPTH
      }));
    }

    const hp = this.hover.shownId && this.plants.find((p) => p.id === this.hover.shownId);
    if (hp && this.hover.alpha > 0.01) {
      const a = this.hover.alpha;
      const fuelText = Object.entries(hp.mix)
        .filter(([, mw]) => mw > 0.5)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([f, mw]) => `${(isEn() ? FUELS[f]?.en : FUELS[f]?.label) ?? f} ${Math.round((mw / (hp.targetMw || 1)) * 100)}%`)
        .join(' · ');
      const label = this.memo('hoverLabel', `${hp.id}|${Math.round(hp.mw)}|${fuelText}|${isEn()}|${this.source}|${this.cems?.[hp.id]?.time || ''}|${Object.values(this.cems?.[hp.id]?.items || {}).map((it) => it.max).join()}|${!!solarSun()}|${hp.color.map(Math.round).join()}|${Math.round(hp.liveMw)}`, () => [
        { pos: hp.pos, text: isEn() ? hp.en : hp.name, size: 15, off: [22, -10], font: FONT, color: [240, 244, 255], weight: 400 },
        { pos: hp.pos, text: isEn() ? hp.name : hp.en.toUpperCase(), size: 9, off: [22, 7], font: isEn() ? FONT : MONO, color: [150, 165, 195], weight: 300 },
        {
          pos: hp.pos,
          text: hp.targetMw > 1 ? `${Math.round(hp.mw).toLocaleString()} MW${fuelText ? '   ' + fuelText : ''}` : tx('— 停機 · 0 MW', '— offline · 0 MW'),
          size: 12, off: [22, 23], font: MONO, color: hp.color, weight: 400
        },
        { pos: hp.pos, text: evidenceText(hp, this.source), size: 9.5, off: [22, 39], font: FONT, color: [150, 165, 195], weight: 300 },
        ...(this.cems?.[hp.id] ? [{ pos: hp.pos, text: cemsText(this.cems[hp.id]), size: 9.5, off: [22, 54], font: FONT, color: [225, 190, 160], weight: 300 }] : []),
        // 滑鼠裝置：提示可以點開電廠卡（手機點一下就直接開，不需要提示）
        ...(CAN_HOVER ? [{ pos: hp.pos, text: tx('點一下看各機組 ›', 'Click for units ›'), size: 9.5, off: [22, this.cems?.[hp.id] ? 69 : 54], font: FONT, color: [110, 240, 190], weight: 300 }] : [])
      ]);
      layers.push(new TextLayer({
        id: 'hover-label',
        data: label,
        getPosition: (d) => d.pos,
        getText: (d) => d.text,
        getSize: (d) => d.size,
        getPixelOffset: (d) => [d.off[0] + (1 - a) * -6, d.off[1]],
        getColor: (d) => [...d.color, 255 * a],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: FONT,
        characterSet: 'auto',
        fontSettings: { sdf: true, fontSize: 64, buffer: 8 },
        outlineWidth: 4,
        outlineColor: [3, 5, 10, 200 * a],
        updateTriggers: { getColor: a, getPixelOffset: a, getText: [Math.round(hp.mw), isEn()] },
        parameters: NO_DEPTH
      }));
    }

    return layers;
  }

  /** 小快取：key 沒變就回傳上次的結果（讓每幀重建的圖層拿到同一個 data 陣列，deck.gl 就不用重新排版文字） */
  memo(name, key, fn) {
    const c = (this.memoCache ||= {})[name];
    if (c && c.key === key) return c.val;
    const val = fn();
    this.memoCache[name] = { key, val };
    return val;
  }

  setHover(id) {
    if (this.mode === 'wallpaper' && this.map.dragPan && !this.map.dragPan.isEnabled()) return;
    if (id && id !== this.hover.id) this.onPlantVisit?.(id);
    if (CAN_HOVER && !this.picking && this.mode !== 'wallpaper' && !!id !== !!this.hover.id) {
      const c = this.map.getCanvas();
      if (id) { this.cursorPrev = c.style.cursor; c.style.cursor = 'pointer'; } else c.style.cursor = this.cursorPrev || '';
    }
    this.hover.id = id;
  }

  /** 地圖第一次畫好時呼叫（用來收起開機畫面） */
  onFirstDraw(cb) {
    const done = () => requestAnimationFrame(() => requestAnimationFrame(cb));
    if (this.map.isStyleLoaded()) done(); else this.map.once('style.load', done);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    clearInterval(this.sizeCheck);
    document.removeEventListener('visibilitychange', this.onVis);
    removeEventListener('pageshow', this.onVis);
    window.visualViewport?.removeEventListener('resize', this.fixSize);
    this.cruise.stop();
    this.map.removeControl(this.overlay);
    this.overlay.finalize();
    this.map.remove();
  }
}

const CAN_HOVER = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;

/** hover 標籤第 5 行：煙道排放（環境部 CEMS 1 小時值，取該廠最高的一根煙囪） */
function cemsText(c) {
  const parts = ['硫氧化物', '氮氧化物', '粒狀物', '不透光率']
    .filter((k) => c.items[k])
    .slice(0, 3)
    .map((k) => {
      const it = c.items[k];
      const short = { 硫氧化物: 'SOx', 氮氧化物: 'NOx', 粒狀物: tx('粒狀物', 'PM'), 不透光率: tx('不透光', 'Opacity') }[k];
      return `${short} ${Math.round(it.max * 10) / 10}${it.std ? `/${it.std}` : ''}`;
    });
  return parts.length ? `煙道 ${parts.join(' · ')}（CEMS 值/標準）` : '';
}

/** hover 標籤第 4 行：這個數字的可信度（仿軌島「即時 / 推估」標示） */
function evidenceText(p, source) {
  if (source !== 'live') return tx(`● ${EVIDENCE.simulated.label}資料`, '● Simulated data');
  if (p.estimated) return tx('◐ 推估（依季節與時段；台電未即時公布離島出力）', '◐ Estimated (Taipower does not publish live island output)');
  if (p.targetMw < 1) return tx(`● ${EVIDENCE.live.label} · 停機`, '● Taipower live · offline');
  const liveShare = p.liveMw / p.targetMw;
  if (liveShare > 0.95) return tx(`● ${EVIDENCE.live.label}`, '● Taipower live');
  if (liveShare < 0.05) return p.solar ? tx(`◐ 依台電各縣市裝置容量分配${solarSun() ? '＋即時日照' : ''}`, `◐ Allocated by county capacity${solarSun() ? ' + live sunshine' : ''}`) : tx(`◐ ${EVIDENCE.allocated.label}`, '◐ Allocated');
  return tx(`● 即時 ${Math.round(liveShare * 100)}% ＋ ◐ 推估分配 ${Math.round((1 - liveShare) * 100)}%`, `● Live ${Math.round(liveShare * 100)}% + ◐ allocated ${Math.round((1 - liveShare) * 100)}%`);
}

function makeSparkles(center, n) {
  // 以黃金角螺旋散佈，靠近中心較密 → 像一片光電板陣列的星海
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = 0.075 * Math.sqrt((i + 0.5) / n) * (0.75 + Math.random() * 0.5);
    const th = i * 2.39996 + Math.random() * 0.3;
    out.push({
      pos: [center[0] + (r * Math.cos(th)) / Math.cos((23.7 * Math.PI) / 180), center[1] + r * Math.sin(th) * 0.9],
      r: 0.6 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 2.2
    });
  }
  return out;
}

const MAX_BOUNDS = [[117.5, 20.2], [124.5, 27.0]];

/** 抽屜用過的鏡頭留白若沒清掉，之後的視角會整個偏上 → 回全島前先歸零 */
function clearPadding(map) {
  const p = map.getPadding();
  if (p.top || p.bottom || p.left || p.right) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
}

/**
 * 全島視角的留白：手機依畫面上「實際的」HUD 位置計算（iPhone 瀏海、狀態列、右上小卡都會改變高度），
 * 讓整座島落在上方數字與下方時鐘／篩選列之間，不被擋住。
 */
export function fitPadding() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w >= 700) return { top: 20, bottom: 20, left: 40, right: 40 };
  const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
  const visible = (r) => r && r.height > 0;
  const tops = ['.mix', '.brand'].map(box).filter(visible).map((r) => r.bottom);
  const bottoms = ['.clock', '.home-card.hc-mobile', '.filters', '.toolbar'].map(box).filter(visible).map((r) => r.top);
  const top = (tops.length ? Math.max(...tops) : 180) + 10;
  const bottom = h - (bottoms.length ? Math.min(...bottoms) : h - 200) + 10;
  return { top, bottom, left: 16, right: 16 };
}

function mixRgb(a, b, t) {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
}
