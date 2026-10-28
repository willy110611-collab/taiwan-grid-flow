/**
 * 維護模式（暫停網站）
 * ─────────────────────────────────────────────────────────────
 *  public/maintenance.json：{ "on": false }；暫停時 { "on": true, "since": ISO 時間 }
 *  ・每小時健康檢查發現嚴重問題（網頁打不開、數字明顯錯誤，3 分鐘後重查仍成立）會自動改成 on 並重新部署
 *  ・管理者也可以在 GitHub Actions「維護模式」手動暫停／重新開放
 *  ・暫停中：打開網頁只看到維護頁，每 3 分鐘重查，恢復後自動重新載入
 *  ・已開著的網頁：每 5 分鐘與切回前景時檢查，暫停了就重新載入（顯示維護頁）
 *  ・網址加 ?maint=0 可略過（管理者、冒煙測試、健康檢查用來看實際網頁）
 */
const SKIP = /[?&]maint=0\b/.test(location.search);

export async function fetchMaint({ fresh = false } = {}) {
  if (SKIP) return null;
  const early = !fresh && window.__tgfMaint; // index.html 已先發出的請求（只用一次）
  window.__tgfMaint = null;
  try {
    if (early) {
      const j = await Promise.race([early, new Promise((r) => setTimeout(() => r(null), 4000))]);
      return j?.on ? j : null;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), 4000); // 讀不到不能擋住網頁
    const r = await fetch(`./maintenance.json?_=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(id);
    const j = r.ok ? await r.json() : null;
    return j?.on ? j : null;
  } catch { return null; }
}

// 和網頁一樣：預設中文，使用者切過英文（localStorage tgf-lang）才用英文
const en = () => {
  if (/[?&]lang=en\b/.test(location.search)) return true;
  try { return localStorage.getItem('tgf-lang') === 'en'; } catch { return false; }
};

const TAIPOWER = 'https://www.taipower.com.tw/d006/loadGraph/loadGraph/genshx_.html';
const TW = 'M184.6 36.7L177.6 41.3L171.9 50.8L171.1 58.5L173.0 63.4L173.2 69.4L174.8 73.3L177.3 75.0L176.1 75.3L176.0 81.9L173.0 83.8L175.1 86.9L171.3 88.8L169.6 91.6L166.8 104.3L164.2 109.0L156.9 115.6L156.9 121.5L152.8 126.0L152.8 129.7L155.5 134.1L151.8 139.0L150.9 149.3L146.5 163.3L142.2 183.0L143.2 186.3L138.8 202.8L135.8 206.2L134.6 212.4L132.5 214.5L132.8 221.5L135.0 222.4L129.4 225.6L125.8 235.6L120.7 243.9L117.5 248.6L113.7 250.0L114.5 255.4L112.3 259.1L98.5 269.4L86.5 301.5L85.8 322.1L87.2 324.4L87.1 331.7L82.1 336.3L81.6 339.4L84.0 344.9L82.5 345.4L79.9 341.6L74.6 339.1L72.3 343.1L69.6 341.6L70.0 337.1L67.3 332.5L70.1 324.5L63.2 304.4L58.2 298.1L46.6 291.1L44.2 288.2L40.8 287.3L34.4 282.7L34.7 281.6L33.2 283.5L31.0 280.6L34.0 282.2L28.0 273.2L28.7 266.6L24.3 254.6L22.0 253.6L23.6 252.7L19.1 237.5L7.0 228.2L16.6 196.5L18.9 197.0L19.6 195.7L18.3 194.4L18.5 189.5L16.8 189.8L18.8 185.9L20.1 185.8L15.5 185.5L15.5 183.3L17.9 183.2L18.3 181.8L17.2 171.5L16.0 172.9L15.1 171.6L19.8 160.8L18.9 156.5L20.2 154.3L27.9 145.6L30.5 139.5L35.3 133.4L35.7 129.0L39.8 126.2L43.5 116.7L47.5 113.6L52.5 103.4L65.5 86.6L70.1 74.9L75.9 68.7L79.9 67.7L83.0 64.7L86.8 58.5L86.3 55.8L88.2 49.6L90.9 47.8L100.9 30.6L118.1 22.7L126.1 22.6L131.8 20.2L137.6 9.7L145.3 5.0L152.7 7.2L157.5 14.7L160.4 13.2L158.9 16.0L161.0 18.5L170.0 20.1L169.7 21.4L171.8 21.4L171.5 22.9L180.9 22.0L179.9 26.5L181.5 31.4L188.4 33.8L184.6 36.7Z';

/** 台灣時間 MM/DD HH:mm */
const twTime = (iso) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const t = new Date(d.getTime() + 8 * 3600e3).toISOString();
  return `${t.slice(5, 7)}/${t.slice(8, 10)} ${t.slice(11, 16)}`;
};

export function showMaintenance(m) {
  const E = en();
  const L = (zh, e) => (E ? e : zh);
  document.documentElement.lang = E ? 'en' : 'zh-Hant';
  document.title = L('台灣脈動・維護中', 'Taiwan Grid Flow · Maintenance');
  document.getElementById('splash')?.remove();
  const css = document.createElement('style');
  css.textContent = `
.tgf-m{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;box-sizing:border-box;text-align:center;overflow:auto;
 background:radial-gradient(ellipse at 50% 40%,#0a1430 0%,#03050a 70%);color:#e8eefc;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif}
html[lang=en] .tgf-m{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
.tgf-m svg{height:min(30vh,240px);overflow:visible;flex:none}
.tgf-m .tw{fill:rgba(40,60,100,.22);stroke:rgba(160,200,255,.4);stroke-width:2;stroke-linejoin:round}
.tgf-m .flat{fill:none;stroke:#ffd27a;stroke-width:3;stroke-linecap:round;opacity:.55;filter:drop-shadow(0 0 5px rgba(255,210,120,.7));animation:tgfbr 3.2s ease-in-out infinite}
@keyframes tgfbr{50%{opacity:.18}}
@media (prefers-reduced-motion:reduce){.tgf-m .flat{animation:none}}
.tgf-m .zh{font-size:26px;font-weight:300;letter-spacing:.5em;margin-right:-.5em}
.tgf-m .en{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.6em;margin-right:-.6em;color:rgba(200,212,240,.4);margin-top:-8px}
.tgf-m .tag{font-size:13px;letter-spacing:.25em;color:#ffd27a;border:1px solid rgba(255,210,122,.45);border-radius:999px;padding:4px 12px 4px 15px;display:flex;align-items:center;gap:8px}
html[lang=en] .tgf-m .tag{letter-spacing:.12em}
.tgf-m .tag i{width:7px;height:7px;border-radius:50%;background:#ffd27a;box-shadow:0 0 8px #ffd27a}
.tgf-m p{margin:0;max-width:340px;font-size:14.5px;line-height:1.8;color:rgba(220,228,248,.85);font-weight:300}
.tgf-m .when{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;letter-spacing:.12em;color:rgba(200,212,240,.5)}
.tgf-m a{margin-top:6px;display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:999px;border:1px solid rgba(110,240,190,.5);color:#6ef0be;text-decoration:none;font-size:14px;letter-spacing:.08em;background:rgba(110,240,190,.06)}
.tgf-m a:focus-visible{outline:2px solid #6ef0be;outline-offset:3px}
.tgf-m .fine{font-size:11.5px;color:rgba(200,212,240,.45);max-width:320px;line-height:1.7}`;
  document.head.appendChild(css);
  const when = m.since ? twTime(m.since) : '';
  const box = document.createElement('main');
  box.className = 'tgf-m';
  box.innerHTML = `
  <svg viewBox="0 0 196 352" aria-hidden="true"><path class="tw" d="${TW}"/><path class="flat" d="M-30 196 L226 196"/></svg>
  <div class="zh">台灣脈動</div><div class="en">TAIWAN GRID FLOW</div>
  <h1 class="tag" style="margin:0;font-weight:400"><i></i>${L('暫停服務・維護中', 'Paused for maintenance')}</h1>
  <p>${L('我們發現畫面上的資料可能有誤，先暫停顯示，避免造成誤會。修好後會盡快恢復。', 'We found that the data on screen may be wrong, so we’ve paused the site to avoid misleading anyone. It will be back as soon as it’s fixed.')}</p>
  ${when ? `<div class="when">${L('暫停時間', 'Paused since')} ${when}</div>` : ''}
  <a href="${TAIPOWER}" target="_blank" rel="noopener">${L('看台電官方即時資料 ↗', 'Taipower’s official live data ↗')}</a>
  <div class="fine">${L('這個頁面每幾分鐘會自動重新檢查，恢復後會自動打開。', 'This page checks again every few minutes and reopens automatically once we’re back.')}</div>`;
  document.body.appendChild(box);
  // 每 3 分鐘重查；恢復 → 重新載入（回到正常網頁）
  setInterval(async () => { if (!(await fetchMaint({ fresh: true }))) location.reload(); }, 180e3);
}

/** 已開著的網頁：每 5 分鐘、切回前景時檢查；被暫停了就重新載入（改顯示維護頁） */
export function watchMaint() {
  if (SKIP) return;
  let last = 0;
  const check = async () => {
    if (Date.now() - last < 60e3) return;
    last = Date.now();
    if (await fetchMaint({ fresh: true })) location.reload();
  };
  setInterval(check, 300e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
