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
  constructor(container, { density = 1, mode = 'app', fps = 60, initialView = null, onStats, onShot, onDaylight, onUserMove, onPlantVisit } = {}) {
    this.onPlantVisit = onPlantVisit;
    this.breathPhase = 0;
    this.tension = 0;
    this.demandView = false;
    this.demandMix = 0;
    this.airView = false;
    this.airMix = 0;
    this.stations = [];
    this.home = null;
    this.clockOverride = null;
    this.regions = null;
    this.mode = mode;
    this.frameMs = 1000 / fps;
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
    this.map.on('moveend', (e) => { if (e.originalEvent) { this.userMoved = true; onUserMove?.(); } });
    if (!wallpaper) this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // 地形圖磚載不到（離線）時只會少了山影，其餘照常；這裡吞掉錯誤避免洗版
    this.map.on('error', (e) => {
      if (e?.sourceId !== 'dem') console.warn('[map]', e?.error?.message || e);
    });
    this.map.on('style.load', () => this.updateDaylight(true));

    this.overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      onHover: (info) => this.setHover(info.layer?.id === 'pick' ? info.object?.id : null),
      onClick: (info) => this.setHover(info.layer?.id === 'pick' ? info.object?.id : null),
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : this.map?.dragPan.isEnabled() ? 'grab' : 'default')
    });
    this.map.addControl(this.overlay);

    // 放空巡航：桌布模式場景停留 3–5 分鐘；App 模式 60–90 秒
    this.cruise = new Cruise(this.map, { dwell: wallpaper ? [180, 300] : [60, 90], onShot });
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
      L.targetLoadMw = rl ? rl * share : L.demand * snapshot.total;
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
    this.particles.setFlows(flows, sources, this.loads);

    const top = [...this.plants].sort((a, b) => b.targetMw - a.targetMw)[0];
    this.onStats?.({
      southToNorthMw: this.particles.southToNorth(sources, this.loads),
      topPlant: top ? { name: top.name, mw: top.targetMw } : null
    });
  }

  /** 能源篩選：'all' | 'green' | 'thermal' | 'nuclear' */
  setFilter(id) {
    const f = FILTERS.find((x) => x.id === id) || FILTERS[0];
    this.demandView = !!f.demand;
    this.airView = !!f.air;
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

  /** HUD 高度改變後（資料載入、出現小卡）重新把全島放進可見區域；使用者動過地圖或在巡航就不動 */
  refitIfIdle() {
    if (this.userMoved || this.cruise.active || this.sheetSaved || this.mode === 'wallpaper') return;
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
    const onClick = (e) => { done(); cb([e.lngLat.lng, e.lngLat.lat]); };
    const done = () => { this.map.off('click', onClick); canvas.style.cursor = prev; };
    this.map.on('click', onClick);
    return done;
  }

  /** 我的家（地圖上的小光環） */
  setHome(home) {
    this.home = home;
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
      return mw > 1 ? 2 * (2600 + Math.sqrt(mw) * 620) * (0.96 + 0.08 * breath) : 0;
    };
    const solarVis = this.particles.fuelVis[FUEL_KEYS.indexOf('solar')];

    const layers = [];

    // ① 光纖：極淡的流線骨架，粗細對應流量
    {
      layers.push(new PathLayer({
        id: 'fibers',
        data: this.particles.fibers(),
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
      layers.push(new TextLayer({
        id: 'aqi-num',
        data: st,
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
        getText: (d) => `我的家 · ${d.name}`,
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
      data: this.loads,
      getPosition: (d) => d.pos,
      getText: (d) => (dm > 0.5 ? `${d.name}\n約 ${Math.round(d.mw / 10) * 10 > 0 ? (Math.round(d.mw / 10) * 10).toLocaleString() : '—'} MW` : d.name),
      getColor: [190 + 50 * dm, 205 + 30 * dm, 235, 70 + 150 * dm],
      getSize: 11 + dm,
      getPixelOffset: [0, 16 + 4 * dm],
      getAlignmentBaseline: 'top',
      fontFamily: FONT,
      fontWeight: 300,
      lineHeight: 1.35,
      characterSet: 'auto',
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
      outlineWidth: 3 * dm,
      outlineColor: [3, 5, 10, 180],
      updateTriggers: { getText: [dm > 0.5, Math.round(this.time)], getColor: dm, getSize: dm, getPixelOffset: dm },
      parameters: NO_DEPTH
    }));

    // 用電視角：四大供電區的自給率標籤
    if (dm > 0.02 && this.regions && window.innerWidth >= 700) {
      const rows = REGION_KEYS.map((k) => {
        const r = this.regions.byKey[k];
        const pct = Math.round(r.ratio * 100);
        return {
          pos: REGIONS[k].label,
          anchor: REGIONS[k].anchor,
          head: `${r.name}  用電 ${Math.round(r.load).toLocaleString()} MW`,
          sub: `發電 ${Math.round(r.gen).toLocaleString()} MW · 自給 ${pct}% · ${r.ratio >= 1 ? '供能 ↗' : '吸能 ↙'}`,
          color: r.ratio >= 1 ? [120, 210, 255] : [255, 160, 110]
        };
      });
      layers.push(new TextLayer({
        id: 'region-labels',
        data: rows.flatMap((r) => [
          { pos: r.pos, anchor: r.anchor, text: r.head, size: 13, off: [0, -9], color: [235, 240, 255] },
          { pos: r.pos, anchor: r.anchor, text: r.sub, size: 10.5, off: [0, 9], color: r.color }
        ]),
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
        updateTriggers: { getColor: dm, getText: Math.round(this.time / 5) },
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
        .map(([f, mw]) => `${FUELS[f]?.label ?? f} ${Math.round((mw / (hp.targetMw || 1)) * 100)}%`)
        .join(' · ');
      const label = [
        { pos: hp.pos, text: hp.name, size: 15, off: [22, -10], font: FONT, color: [240, 244, 255], weight: 400 },
        { pos: hp.pos, text: hp.en.toUpperCase(), size: 9, off: [22, 7], font: MONO, color: [150, 165, 195], weight: 300 },
        {
          pos: hp.pos,
          text: hp.targetMw > 1 ? `${Math.round(hp.mw).toLocaleString()} MW${fuelText ? '   ' + fuelText : ''}` : '— 停機 · 0 MW',
          size: 12, off: [22, 23], font: MONO, color: hp.color, weight: 400
        },
        { pos: hp.pos, text: evidenceText(hp, this.source), size: 9.5, off: [22, 39], font: FONT, color: [150, 165, 195], weight: 300 },
        ...(this.cems?.[hp.id] ? [{ pos: hp.pos, text: cemsText(this.cems[hp.id]), size: 9.5, off: [22, 54], font: FONT, color: [225, 190, 160], weight: 300 }] : [])
      ];
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
        updateTriggers: { getColor: a, getPixelOffset: a, getText: Math.round(hp.mw) },
        parameters: NO_DEPTH
      }));
    }

    return layers;
  }

  setHover(id) {
    if (this.mode === 'wallpaper' && this.map.dragPan && !this.map.dragPan.isEnabled()) return;
    if (id && id !== this.hover.id) this.onPlantVisit?.(id);
    this.hover.id = id;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cruise.stop();
    this.map.removeControl(this.overlay);
    this.overlay.finalize();
    this.map.remove();
  }
}

/** hover 標籤第 5 行：煙道排放（環境部 CEMS 1 小時值，取該廠最高的一根煙囪） */
function cemsText(c) {
  const parts = ['硫氧化物', '氮氧化物', '粒狀物', '不透光率']
    .filter((k) => c.items[k])
    .slice(0, 3)
    .map((k) => {
      const it = c.items[k];
      const short = { 硫氧化物: 'SOx', 氮氧化物: 'NOx', 粒狀物: '粒狀物', 不透光率: '不透光' }[k];
      return `${short} ${Math.round(it.max * 10) / 10}${it.std ? `/${it.std}` : ''}`;
    });
  return parts.length ? `煙道 ${parts.join(' · ')}（CEMS 值/標準）` : '';
}

/** hover 標籤第 4 行：這個數字的可信度（仿軌島「即時 / 推估」標示） */
function evidenceText(p, source) {
  if (source !== 'live') return `● ${EVIDENCE.simulated.label}資料`;
  if (p.estimated) return '◐ 推估（台電未即時公布離島出力）';
  if (p.targetMw < 1) return `● ${EVIDENCE.live.label} · 停機`;
  const liveShare = p.liveMw / p.targetMw;
  if (liveShare > 0.95) return `● ${EVIDENCE.live.label}`;
  if (liveShare < 0.05) return `◐ ${EVIDENCE.allocated.label}`;
  return `● 即時 ${Math.round(liveShare * 100)}% ＋ ◐ 推估分配 ${Math.round((1 - liveShare) * 100)}%`;
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
  const bottoms = ['.clock', '.filters', '.toolbar'].map(box).filter(visible).map((r) => r.top);
  const top = (tops.length ? Math.max(...tops) : 180) + 10;
  const bottom = h - (bottoms.length ? Math.min(...bottoms) : h - 200) + 10;
  return { top, bottom, left: 16, right: 16 };
}

function mixRgb(a, b, t) {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
}
