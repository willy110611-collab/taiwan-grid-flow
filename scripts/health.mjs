// G2／G6 每小時健康檢查（GitHub Actions「健康檢查」執行）：用「真實資料」從外部檢查正式網站與中繼站
//  全部正常 → 安靜結束，不通知
//  有問題 → 3 分鐘後重查，仍有問題才處理（LINE 主動推播每月只有 200 則，避免偶發延遲誤報）：
//   ・嚴重（網頁打不開、地圖沒出現、畫面數字明顯錯誤）→ 自動暫停網站（public/maintenance.json 改 on、重新部署），
//     LINE 通知管理者「已暫停」；修好後到 Actions「維護模式」按重新開放
//   ・其他（資料延遲、單一功能出錯）→ 只通知，不暫停
//  已在暫停中 → 只記錄結果，不再通知（避免每小時重複）
//  中繼站本身掛掉時 LINE 發不出去 → 只靠 GitHub 的失敗 Email
//  本機試跑：HEALTH_DRY=1 npm run health（不通知、不暫停）
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SITE = process.env.HEALTH_SITE || 'https://willy110611-collab.github.io/taiwan-grid-flow/'; // 本機試跑可指定 http://127.0.0.1:4177/
const RELAY = 'https://taiwan-grid-flow-data.willy110611.workers.dev';
const problems = []; // { msg, severe }
let alertType = 'site';
const ageMin = (ts) => (Date.now() - new Date(String(ts).replace(/\//g, '-').replace(' ', 'T') + '+08:00').getTime()) / 60e3;
const get = async (url) => { const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const add = (msg, severe = false) => problems.push({ msg, severe });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => Number(String(s ?? '').replace(/,/g, ''));

/** 台電原始資料（中繼站 genary.json）的全台淨發電：各機組出力（第 5 欄）正值加總，跳過小計 */
async function relayTotal() {
  const g = JSON.parse((await get(`${RELAY}/genary.json`)).replace(/^﻿/, ''));
  let mw = 0;
  for (const r of g.aaData || []) {
    if (/小計|合計|總計/.test(String(r[2] ?? ''))) continue;
    const v = num(r[4]);
    if (v > 0) mw += v;
  }
  return { ts: String(g[''] || ''), mw };
}

async function check() {
  // 1. 中繼站
  try {
    const root = await get(`${RELAY}/`);
    if (!/^OK/.test(root)) add(`中繼站回應異常：${root.slice(0, 60)}`);
    const g = JSON.parse(await get(`${RELAY}/genary.json`));
    const a = ageMin(g['']);
    if (!(a < 60)) { add(`中繼站台電資料 ${Math.round(a)} 分鐘沒更新（${g['']}）`); alertType = 'data'; }
  } catch (e) { add(`中繼站連不上：${e.message}`); }

  // 2. 網站備份
  try {
    const g = JSON.parse(await get(`${SITE}data/genary.json`));
    const a = ageMin(g['']);
    // GitHub 的排程常延遲（*/10 實際常 30–50 分鐘才跑一次），備份只在中繼站失敗時才用 → 2 小時沒更新才算問題
    if (!(a < 120)) add(`網站備份資料 ${Math.round(a)} 分鐘沒更新`);
    JSON.parse(await get(`${SITE}version.json`));
  } catch (e) { add(`網站讀不到：${e.message}`); }

  // 3. 用真實資料打開正式網站（手機尺寸；maint=0 略過維護頁，看實際網頁）
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('tgf-tour-v1', '1'); localStorage.setItem('tgf-lang', 'zh'); });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${SITE}?density=0.2&fps=10&maint=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try { await page.waitForSelector('.toolbar', { timeout: 60000 }); } catch {
      add(`網頁打不開：60 秒內沒有出現畫面${errs.length ? `（程式錯誤：${errs[0]}）` : ''}`, true);
      return;
    }
    await sleep(15000);
    if (!(await page.locator('.maplibregl-canvas').count())) add('地圖沒有出現', true);

    // 3a. 數字合不合理（只在顯示台電即時資料時檢查）
    const badge = (await page.locator('.brand .badge').textContent().catch(() => '')) || '';
    if (!/LIVE/.test(badge)) add(`網站沒有顯示即時資料：「${badge.trim()}」`);
    else {
      const sub = await page.locator('.mix-sub span').allTextContents().catch(() => []);
      const pick = (re) => { const s = sub.find((x) => re.test(x)); const m = s && s.match(/([\d,]+)\s*MW/); return m ? num(m[1]) : null; };
      const gen = pick(/發電/), load = pick(/用電/);
      const hm = ((await page.locator('.clock-data').textContent().catch(() => '')) || '').match(/\d{2}:\d{2}/)?.[0];
      if (gen == null) add('畫面上找不到總發電數字');
      else if (gen < 5000) add(`畫面總發電只有 ${gen.toLocaleString()} MW（明顯不合理）`, true);
      else {
        // 和台電原始資料比（同一個資料時間才比；剛好跨過 10 分鐘更新就再抓一次）
        let ref = await relayTotal().catch(() => null);
        if (ref && hm && ref.ts.slice(-5) !== hm) { await sleep(5000); ref = await relayTotal().catch(() => null); }
        console.log(`畫面 ${hm} 發電 ${gen} MW、用電 ${load} MW；台電原始 ${ref?.ts} ${Math.round(ref?.mw || 0)} MW`);
        if (ref && hm && ref.ts.slice(-5) === hm && ref.mw > 0) {
          const diff = Math.abs(gen - ref.mw) / ref.mw;
          if (diff > 0.1) add(`畫面總發電 ${gen.toLocaleString()} MW，台電原始資料 ${Math.round(ref.mw).toLocaleString()} MW（差 ${Math.round(diff * 100)}%）`, true);
        }
        if (load != null && load > gen * 1.3) add(`畫面用電 ${load.toLocaleString()} MW 遠大於發電 ${gen.toLocaleString()} MW`, true);
      }
    }
    const issue = await page.locator('.data-issue').textContent().catch(() => null);
    if (issue) add(`網站出現資料提示：${issue.trim()}`);

    // 3b. 各功能（出錯只通知，不暫停）：面板、今日重播、自動導覽、能源篩選
    const tb = (label) => page.locator('.toolbar > button', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
    const closePanel = async () => { const c = page.locator('.panel .icon-btn').first(); if (await c.count()) { await c.click(); await sleep(300); } };
    for (const label of ['我的家', '電廠', '家電', '店家', '亮點', '徽章', '資訊']) {
      let btn = tb(label);
      if (!(await btn.count())) {
        const more = tb('更多');
        if (await more.count()) { await more.click(); await sleep(300); }
        btn = page.locator('.more-menu button', { hasText: new RegExp(label) }).first();
      }
      if (!(await btn.count())) { add(`找不到「${label}」按鈕`); continue; }
      await btn.click();
      await sleep(1200);
      if (!(await page.locator('.panel').count())) add(`「${label}」沒有打開面板`);
      if (await page.locator('.guard-card').count()) add(`「${label}」面板顯示錯誤卡片`);
      await closePanel();
    }
    if (await tb('今日重播').count()) {
      await tb('今日重播').click(); await sleep(1500);
      if (!(await page.locator('.replay').count())) add('「今日重播」沒有出現重播列');
      await tb('今日重播').click(); await sleep(800);
    } else add('找不到「今日重播」按鈕');
    if (await tb('自動導覽').count()) {
      await tb('自動導覽').click(); await sleep(2000);
      if (!(await tb('自動導覽').evaluate((b) => b.classList.contains('on')))) add('「自動導覽」沒有啟動');
      await tb('自動導覽').click(); await sleep(1500);
    } else add('找不到「自動導覽」按鈕');
    const chip = page.locator('.fchip').first();
    if (await chip.count()) {
      await chip.click(); await sleep(300);
      const n = await page.locator('.fmenu [role=menuitemradio]').count();
      if (n < 3) add(`能源篩選選單只有 ${n} 個選項`);
      for (let i = 1; i < n; i++) {
        if (!(await page.locator('.fmenu').count())) { await chip.click(); await sleep(300); }
        await page.locator('.fmenu [role=menuitemradio]').nth(i).click();
        await sleep(1200);
        if (await page.locator('.guard-card').count()) add(`能源篩選第 ${i + 1} 項顯示錯誤卡片`);
        await closePanel(); // 用電、空品、核能會自動打開面板
      }
      await chip.click(); await sleep(300);
      await page.locator('.fmenu [role=menuitemradio]').first().click().catch(() => {});
    } else add('找不到能源篩選按鈕');
    if (errs.length) add(`網站程式錯誤：${[...new Set(errs)].slice(0, 3).join('；')}`);
  } catch (e) {
    add(`檢查網站時出錯：${e.message}`);
  } finally {
    await browser.close();
  }
}

// 現在是不是已經在暫停中
let maintOn = false;
try { maintOn = !!JSON.parse(await get(`${SITE}maintenance.json`)).on; } catch { /* 舊版本沒有這個檔：當作沒暫停 */ }

await check();
if (problems.length) {
  console.log('第一次檢查有問題，3 分鐘後重查：\n' + problems.map((p) => `・${p.severe ? '【嚴重】' : ''}${p.msg}`).join('\n'));
  problems.length = 0; alertType = 'site';
  await sleep(180e3);
  await check();
}

if (!problems.length) { console.log(maintOn ? '✓ 正常（網站目前暫停中：修好了的話到 Actions「維護模式」按重新開放）' : '✓ 正常'); process.exit(0); }
const severe = problems.filter((p) => p.severe);
console.error('✗ 健康檢查發現問題：\n' + problems.map((p) => `・${p.severe ? '【嚴重】' : ''}${p.msg}`).join('\n'));

if (maintOn) { console.log('網站已在暫停中，不再重複通知'); process.exit(0); }

if (process.env.HEALTH_DRY) { console.log('（HEALTH_DRY：試跑，不通知、不暫停）'); process.exit(1); }
const alert = async (type) => { try { return await (await fetch(`${RELAY}/alert?type=${type}`)).text(); } catch { return ''; } };
if (severe.length && process.env.GITHUB_ACTIONS) {
  // 自動暫停：改 maintenance.json → 推上 main → 觸發部署
  try {
    const sh = (c) => execSync(c, { stdio: 'inherit' });
    sh('git config user.name "github-actions[bot]" && git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
    sh('git pull --rebase origin main');
    writeFileSync('public/maintenance.json', JSON.stringify({ on: true, since: new Date().toISOString() }) + '\n');
    sh('git add public/maintenance.json');
    execSync(`git commit -m ${JSON.stringify(`健康檢查：自動暫停網站（${severe.map((p) => p.msg).join('；').slice(0, 200)}）`)}`, { stdio: 'inherit' });
    sh('git push origin HEAD:main');
    sh('gh workflow run deploy.yml --ref main');
    console.log('已自動暫停網站，約 10 分鐘後生效');
  } catch (e) { console.error(`自動暫停失敗：${e.message}`); }
  // 中繼站有「已暫停」通知（maint）就用它；舊版中繼站沒有 → 用一般的檢查失敗通知
  const r = await alert('maint');
  if (!/sent|throttled/.test(r)) await alert('site');
} else await alert(alertType);
process.exit(1);
