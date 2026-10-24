// 電廠設定檢查（npm run check 會跑）：每座電廠都有供電區、座標在台灣範圍內、
// 台電機組名稱不會同時對到兩座電廠（拿最新一份 genary 測；沒有檔案就只檢查設定）
import fs from 'fs';
import { PLANTS, PLANT_REGION } from '../src/config/geo.js';

const errs = [];
for (const p of PLANTS) {
  if (!PLANT_REGION[p.id]) errs.push(`${p.id} 沒有設定供電區（PLANT_REGION）`);
  const [lng, lat] = p.pos;
  if (!(lng > 118 && lng < 122.1 && lat > 21.8 && lat < 26.4)) errs.push(`${p.id} 座標不在台灣範圍：${p.pos}`);
}
const ids = PLANTS.map((p) => p.id);
ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errs.push(`電廠 id 重複：${id}`));

const file = ['public/data/genary.json', 'dist/data/genary.json'].find((f) => fs.existsSync(f));
if (file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  for (const row of g.aaData || []) {
    const unit = String(row[2] || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s*\(註\s*\d+\)/g, '').trim();
    if (!unit || /小計/.test(unit)) continue;
    const hits = PLANTS.filter((p) => p.match && p.match.test(unit)).map((p) => p.id);
    if (hits.length > 1) errs.push(`機組「${unit}」同時對到 ${hits.join('、')}（只會算到第一個）`);
  }
}

if (errs.length) { console.error('✗ 電廠設定：\n  ' + errs.join('\n  ')); process.exit(1); }
console.log(`✓ 電廠設定：${PLANTS.length} 座都有供電區、座標正常${file ? '、機組對應不重複' : ''}`);
