import { feature, mesh, merge } from 'topojson-client';
import counties from 'taiwan-atlas/counties-10t.json';
import { countyRegion } from '../config/geo.js';

/**
 * 底圖：極簡午夜風（完全自建，不依賴任何圖磚商）
 * ─────────────────────────────────────────────────────────────
 *  海 ─ 純夜色
 *  陸地 ─ 內政部縣市界（taiwan-atlas，打包進程式，離線可用）
 *  山脈陰影 ─ AWS Terrain Tiles（Terrarium 編碼，免 Token；離線時自動略過）
 *  縣市界 ─ 極淡細線
 *  海岸線 ─ 兩層描邊（寬模糊 + 細亮線）形成微微發光的輪廓 → 軌島感
 *
 * 繪製順序：陸地底色 → 山影 → 「海洋遮罩」蓋掉海面的地形陰影 → 線條
 */
export const PALETTE = {
  sea: '#02040a',
  land: '#0b1222',
  county: '#23324d',
  coastGlow: '#2b5d8f',
  coast: '#6f9fd6'
};

const land = feature(counties, counties.objects.counties);
// 每個縣市標上所屬供電區（N/C/S/E），給「區域用電熱度」圖層上色
for (const f of land.features) f.properties.region = countyRegion(f.properties.COUNTYNAME) || 'X';
const countyLines = mesh(counties, counties.objects.counties, (a, b) => a !== b);
const coastLines = mesh(counties, counties.objects.counties, (a, b) => a === b);

/** 一個覆蓋整個視野的大矩形，挖掉陸地 → 海洋遮罩
 *  先把所有縣市合併成島嶼輪廓再挖：若每個縣市各挖一個洞，相鄰的洞共用邊界，
 *  三角化時會在縣市交界切出錯誤的深色色塊（例如嘉義、台南交界） */
function buildSeaMask() {
  const merged = merge(counties, counties.objects.counties.geometries);
  const holes = merged.coordinates.map((poly) => poly[0]); // 每座島的外框

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[[60, -20], [180, -20], [180, 60], [60, 60], [60, -20]], ...holes] }
  };
}

export function createBaseStyle({ hillshade = true } = {}) {
  const sources = {
    land: { type: 'geojson', data: land },
    seaMask: { type: 'geojson', data: buildSeaMask() },
    counties: { type: 'geojson', data: countyLines },
    coast: { type: 'geojson', data: coastLines }
  };
  if (hillshade) {
    sources.dem = {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      // 原圖是 256 px；宣告成 512 → 同樣畫面少抓一級（全島約 16 張 → 4–6 張，手機首次載入省約 1.3 MB），山影稍柔和
      tileSize: 512,
      maxzoom: 11,
      attribution: 'Terrain: Mapzen / AWS Open Data · 縣市界: 內政部'
    };
  }

  return {
    version: 8,
    sources,
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': PALETTE.sea } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': PALETTE.land } },
      ...(hillshade
        ? [{
            id: 'hillshade',
            type: 'hillshade',
            source: 'dem',
            paint: {
              'hillshade-exaggeration': 0.5,
              'hillshade-shadow-color': '#000000',
              'hillshade-highlight-color': '#22324f',
              'hillshade-accent-color': '#0b1526',
              'hillshade-illumination-direction': 315
            }
          }]
        : []),
      { id: 'sea-mask', type: 'fill', source: 'seaMask', paint: { 'fill-color': PALETTE.sea, 'fill-antialias': false } },
      // 區域用電熱度：吸能（用電 > 發電）偏暖色、供能偏冷色；顏色與透明度由引擎即時更新
      { id: 'region-heat', type: 'fill', source: 'land', paint: { 'fill-color': '#000000', 'fill-opacity': 0, 'fill-antialias': false } },
      {
        id: 'counties',
        type: 'line',
        source: 'counties',
        paint: { 'line-color': PALETTE.county, 'line-width': 0.6, 'line-opacity': 0.55, 'line-dasharray': [2, 2] }
      },
      {
        id: 'coast-glow',
        type: 'line',
        source: 'coast',
        paint: { 'line-color': PALETTE.coastGlow, 'line-width': 7, 'line-blur': 6, 'line-opacity': 0.32 }
      },
      {
        id: 'coast',
        type: 'line',
        source: 'coast',
        paint: { 'line-color': PALETTE.coast, 'line-width': 0.8, 'line-opacity': 0.6 }
      }
    ]
  };
}

/** 座標落在哪個供電區（射線法判斷點是否在縣市多邊形內） */
export function regionAt([x, y]) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const f of land.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (polys.some((p) => inRing(p[0]))) return { region: f.properties.region, county: f.properties.COUNTYNAME };
  }
  return null;
}
