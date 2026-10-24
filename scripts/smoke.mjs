// 上線前冒煙測試：用無頭瀏覽器開建置好的網站（模擬資料），手機與電腦、中英文各開一次，
// 依序打開每個工具列面板；出現未處理的程式錯誤就讓部署失敗。
// 用法：npm run build && node scripts/smoke.mjs   （會自己啟動 vite preview）
import { spawn } from 'child_process';
import { chromium } from 'playwright';

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* 等伺服器 */ } await sleep(500); }

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [];
const LABELS = { zh: ['電廠', '我的家', '家電', '店家', '亮點', '徽章', '資訊'], en: ['Plants', 'Home', 'Appliances', 'Shop', 'Peaks', 'Badges', 'Info'] };
try {
  for (const [vp, lang] of [[{ width: 402, height: 874 }, 'zh'], [{ width: 402, height: 874 }, 'en'], [{ width: 1440, height: 900 }, 'zh']]) {
    const tag = `${vp.width}/${lang}`;
    const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    await ctx.addInitScript((l) => { localStorage.setItem('tgf-lang', l); localStorage.setItem('tgf-tour-v1', '1'); }, lang);
    const page = await ctx.newPage();
    // SMOKE_OFFLINE=1：本機沒有外網時擋掉外部請求（地圖圖磚、中繼站），只測程式本身
    if (process.env.SMOKE_OFFLINE) await page.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
    page.on('pageerror', (e) => errors.push(`${tag} 程式錯誤：${e.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/?sim=1&density=0.2&fps=10`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.toolbar', { timeout: 30000 });
    await sleep(3000);
    for (const label of LABELS[lang]) {
      let btn = page.locator('.toolbar > button', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
      if (!(await btn.count())) {
        // 收在「更多」選單裡
        const more = page.locator('.toolbar > button', { hasText: /^\s*(更多|More)\s*$/ }).first();
        if (await more.count()) { await more.click(); await sleep(300); }
        btn = page.locator('.more-menu button', { hasText: new RegExp(label) }).first();
      }
      if (!(await btn.count())) { errors.push(`${tag} 找不到按鈕「${label}」`); continue; }
      await btn.click();
      await sleep(700);
      if (!(await page.locator('.panel').count())) errors.push(`${tag}「${label}」沒有打開面板`);
      if (await page.locator('.guard-card').count()) errors.push(`${tag}「${label}」顯示錯誤卡片`);
      const close = page.locator('.panel .icon-btn').first();
      if (await close.count()) { await close.click(); await sleep(300); }
    }
    console.log(`✓ ${tag}`);
    await ctx.close();
  }
} catch (e) {
  errors.push(`測試中斷：${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error('✗ 冒煙測試失敗：\n' + errors.join('\n')); process.exit(1); }
console.log('✓ 冒煙測試通過');
