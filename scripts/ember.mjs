/**
 * Ember「Yearly Electricity Data」（CC BY 4.0）→ public/ember.json：台灣與鄰近、主要國家的電力碳強度與發電組成
 * ─────────────────────────────────────────────────────────────
 * 原檔：https://storage.googleapis.com/emb-prod-bkt-publicdata/public-downloads/yearly_full_release_long_format.csv
 * 這個環境連不到原檔：在分支用一次性 workflow 讓 GitHub Actions 下載、篩選國家後提交，再跑：
 *   node scripts/ember.mjs 篩選後.csv
 * 每年 Ember 更新後重跑一次即可。
 */
import fs from 'fs';

const AREAS = {
  Taiwan: ['台灣', 'Taiwan'], Japan: ['日本', 'Japan'], 'South Korea': ['南韓', 'South Korea'], China: ['中國', 'China'],
  'United States of America': ['美國', 'US'], Germany: ['德國', 'Germany'], France: ['法國', 'France'], 'United Kingdom': ['英國', 'UK'],
  Singapore: ['新加坡', 'Singapore'], Australia: ['澳洲', 'Australia'], India: ['印度', 'India'], 'Viet Nam': ['越南', 'Vietnam'],
  Philippines: ['菲律賓', 'Philippines'], World: ['全球', 'World']
};

const lines = fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
const head = lines[0].split(',');
const col = (n) => head.indexOf(n);
const [cA, cY, cC, cS, cV, cU, cVal] = ['Area', 'Year', 'Category', 'Subcategory', 'Variable', 'Unit', 'Value'].map(col);
// 欄位裡沒有逗號（國名除外，用引號包起來）→ 簡單切開，處理引號
const split = (l) => l.match(/("([^"]*)"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, ''));

const by = {}; // area → year → key → value
for (const l of lines.slice(1)) {
  const r = split(l);
  if (!AREAS[r[cA]]) continue;
  const key = r[cU] === '%' && r[cC] === 'Electricity generation' ? `pct:${r[cV]}`
    : r[cV] === 'CO2 intensity' ? 'co2'
    : r[cV] === 'Demand per capita' ? 'perCap'
    : r[cV] === 'Total Generation' ? 'twh' : null;
  if (!key || r[cVal] === '') continue;
  ((by[r[cA]] ||= {})[r[cY]] ||= {})[key] = Number(r[cVal]);
}

const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const pick = (y) => ({
  co2: round(y.co2, 0), twh: round(y.twh), perCap: round(y.perCap, 2),
  renew: round(y['pct:Renewables']), windSolar: round(y['pct:Wind and Solar']), fossil: round(y['pct:Fossil']),
  coal: round(y['pct:Coal']), gas: round(y['pct:Gas']), nuclear: round(y['pct:Nuclear'])
});
const areas = Object.entries(AREAS).filter(([k]) => by[k]).map(([k, [zh, en]]) => {
  const years = Object.keys(by[k]).filter((y) => by[k][y].co2 != null).sort();
  const last = years[years.length - 1];
  return { id: k, zh, en, year: +last, ...pick(by[k][last]) };
});
const tw = by.Taiwan;
const series = Object.keys(tw).sort().filter((y) => tw[y].co2 != null).map((y) => ({ year: +y, ...pick(tw[y]) }));

fs.writeFileSync('public/ember.json', JSON.stringify({
  source: 'Ember, Yearly Electricity Data (CC BY 4.0)', url: 'https://ember-energy.org/data/yearly-electricity-data/', areas, taiwan: series
}));
console.log(`✓ ${areas.length} 個國家／地區；台灣 ${series[0].year}–${series[series.length - 1].year}`);
for (const a of areas) console.log(`  ${a.zh} ${a.year}：${a.co2} g/kWh、再生 ${a.renew}%、風光 ${a.windSolar}%、核能 ${a.nuclear}%、燃煤 ${a.coal}%`);
