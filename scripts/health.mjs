// G2／G6 每小時健康檢查（GitHub Actions「健康檢查」執行）：用「真實資料」從外部檢查正式網站與中繼站
//  全部正常 → 安靜結束，不通知
//  有問題 → 呼叫中繼站 /alert 讓管理者收到 LINE，並讓這次檢查失敗（GitHub 也會寄 Email）
//  中繼站本身掛掉時 LINE 發不出去 → 只靠 GitHub 的失敗 Email
import { chromium } from 'playwright';

const SITE = 'https://willy110611-collab.github.io/taiwan-grid-flow/';
const RELAY = 'https://taiwan-grid-flow-data.willy110611.workers.dev';
const problems = [];
let alertType = 'site';
const ageMin = (ts) => (Date.now() - new Date(String(ts).replace(/\//g, '-').replace(' ', 'T') + '+08:00').getTime()) / 60e3;
const get = async (url) => { const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };

// 1. 中繼站
try {
  const root = await get(`${RELAY}/`);
  if (!/^OK/.test(root)) problems.push(`中繼站回應異常：${root.slice(0, 60)}`);
  const g = JSON.parse(await get(`${RELAY}/genary.json`));
  const a = ageMin(g['']);
  if (!(a < 60)) { problems.push(`中繼站台電資料 ${Math.round(a)} 分鐘沒更新（${g['']}）`); alertType = 'data'; }
} catch (e) { problems.push(`中繼站連不上：${e.message}`); }

// 2. 網站備份
try {
  const g = JSON.parse(await get(`${SITE}data/genary.json`));
  const a = ageMin(g['']);
  if (!(a < 60)) problems.push(`網站備份資料 ${Math.round(a)} 分鐘沒更新`);
  JSON.parse(await get(`${SITE}version.json`));
} catch (e) { problems.push(`網站讀不到：${e.message}`); }

// 3. 用真實資料打開正式網站（手機尺寸），確認是即時資料、沒有程式錯誤、主要面板打得開
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { localStorage.setItem('tgf-tour-v1', '1'); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${SITE}?density=0.2&fps=10`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.toolbar', { timeout: 60000 });
  await page.waitForTimeout(15000);
  const badge = (await page.locator('.brand .badge').textContent().catch(() => '')) || '';
  if (!/LIVE/.test(badge)) problems.push(`網站沒有顯示即時資料：「${badge.trim()}」`);
  const issue = await page.locator('.data-issue').textContent().catch(() => null);
  if (issue) problems.push(`網站出現資料提示：${issue.trim()}`);
  for (const label of ['我的家', '電廠']) {
    const btn = page.locator('.toolbar button', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
    if (!(await btn.count())) continue;
    await btn.click();
    await page.waitForTimeout(1200);
    if (await page.locator('.guard-card').count()) problems.push(`「${label}」面板顯示錯誤卡片`);
    const close = page.locator('.panel .icon-btn').first();
    if (await close.count()) await close.click();
  }
  if (errs.length) problems.push(`網站程式錯誤：${errs.slice(0, 3).join('；')}`);
} catch (e) {
  problems.push(`打開網站失敗：${e.message}`);
} finally {
  await browser.close();
}

if (!problems.length) { console.log('✓ 正常'); process.exit(0); }
console.error('✗ 健康檢查發現問題：\n' + problems.map((p) => `・${p}`).join('\n'));
try { await fetch(`${RELAY}/alert?type=${alertType}`); } catch { /* 中繼站掛了就只靠 GitHub Email */ }
process.exit(1);
