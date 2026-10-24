/**
 * 建置前抓台電開放資料 → public/data/*.json（npm run build 會先跑這支）
 *  ・走 Cloudflare 中繼站 /open/…（GitHub 的海外主機直連台電會被擋），失敗再直連台電
 *  ・任何一份抓不到就略過那一份（網頁會顯示「暫時讀不到」），不讓建置失敗
 *  ・設定 SKIP_OPENDATA=1 可跳過（離線建置桌布用）
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { unzip, decode, parseOutages, parseTownKwh, parseSupplyHistory, parseRenew } from './opendata-lib.mjs';

if (process.env.SKIP_OPENDATA) { console.log('略過台電開放資料（SKIP_OPENDATA）'); process.exit(0); }

const RELAY = 'https://taiwan-grid-flow-data.willy110611.workers.dev/open/';
const TP = 'https://service.taipower.com.tw/data/opendata/apply/file/';
const SRC = { // 中繼站名稱 → 台電路徑
  'outage.zip': 'd077004/001.zip',
  'supply-history.csv': 'd006005/001.csv',
  'renew.csv': 'd007011/001.csv'
};
const kwhName = (roc) => `kwh-${roc}.csv`;
const kwhPath = (roc) => `d007025/dist_kwh_${roc}.csv`;
const OUT = new URL('../public/data/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const towns = (() => {
  const t = readFileSync(new URL('../src/config/towns.js', import.meta.url), 'utf8');
  return JSON.parse(t.slice(t.indexOf('= [') + 2, t.lastIndexOf(']') + 1));
})();
const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

async function get(name, path) {
  const tries = [RELAY + name, TP + path];
  let last;
  for (const url of tries) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(40000), headers: { 'User-Agent': 'Mozilla/5.0 taiwan-grid-flow-build' } });
      if (!r.ok) throw new Error(`${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 50) throw new Error('檔案太小');
      return buf;
    } catch (e) { last = e; }
  }
  throw new Error(`${name} 取得失敗（${last?.message}）`);
}
const save = (file, obj) => {
  const body = JSON.stringify({ updated: new Date().toISOString(), ...obj });
  writeFileSync(new URL(file, OUT), body);
  console.log(`✓ ${file}（${(body.length / 1024).toFixed(0)} KB）`);
};
const job = async (label, fn) => { try { await fn(); } catch (e) { console.log(`✗ ${label}：${e.message}`); } };

await Promise.all([
  // D1 計畫性工作停電（今天起 8 天）
  job('outages.json', async () => {
    const files = await unzip(await get('outage.zip', SRC['outage.zip']));
    const { list, rows } = parseOutages(files, towns, twToday(), 8);
    if (rows < 10) throw new Error(`只有 ${rows} 列，格式可能改了`);
    save('outages.json', { source: '台灣電力公司計畫性工作停電資料', sourceUrl: 'https://data.gov.tw/dataset/26144', rows, list });
  }),
  // D3 各鄉鎮市區住宅用電（今年＋去年，最近 12 個月）
  job('towns-kwh.json', async () => {
    const roc = Number(twToday().slice(0, 4)) - 1911;
    const texts = {};
    for (const y of [roc - 1, roc]) {
      try { texts[y] = decode(await get(kwhName(y), kwhPath(y))); } catch (e) { if (y === roc - 1) texts[y - 1] = decode(await get(kwhName(y - 1), kwhPath(y - 1))); }
    }
    const k = parseTownKwh(texts, towns, 12);
    if (Object.keys(k.towns).length < 300) throw new Error(`只對到 ${Object.keys(k.towns).length} 個鄉鎮`);
    save('towns-kwh.json', { source: '台灣電力公司鄉鎮市(郵遞區)別用電統計資料（表燈非營業用）', sourceUrl: 'https://data.gov.tw/dataset/14135', ...k });
  }),
  // D4 過去電力供需（每日）
  job('supply-history.json', async () => {
    const h = parseSupplyHistory(decode(await get('supply-history.csv', SRC['supply-history.csv'])));
    if (h.days.length < 60) throw new Error(`只有 ${h.days.length} 天`);
    save('supply-history.json', { source: '台灣電力公司過去電力供需資訊', sourceUrl: 'https://data.gov.tw/dataset/19995', ...h });
  }),
  // D6 縣市再生能源躉購
  job('renew.json', async () => {
    const r = parseRenew(decode(await get('renew.csv', SRC['renew.csv'])));
    if (r.counties.length < 15) throw new Error(`只有 ${r.counties.length} 個縣市`);
    save('renew.json', { source: '台灣電力公司各縣市再生能源別購入情形', sourceUrl: 'https://data.gov.tw/dataset/29936', ...r });
  })
]);
