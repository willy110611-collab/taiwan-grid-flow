# 台灣光脈搏 Taiwan Grid Flow — 給 Claude 的交接說明

即時台電發電／用電視覺化網頁（React 18 + Vite 6 + MapLibre + deck.gl），GitHub Pages 部署，手機版是 PWA。
設計者：無聊的人。回覆一律用**繁體中文**，精簡。

## 工作規則（使用者指定）
- 使用者同意要做的功能：寫程式 → 測試 → commit → push main → 部署，一路做完，不用每步再問。
- **新畫面先出預覽圖**（手機以 iPhone 16 Pro 402×874 為準，電腦版也要看），使用者確認後才實作。
- 模擬各種使用者操作（點、滑、鍵盤、英文介面），確認都直觀、沒有錯誤。
- 每份資料都要有確切來源；不確定的不要寫。
- **Cloudflare 中繼站正式部署**：需要使用者在對話中明確說「允許部署」。
- 不要上傳 `gemini/`（個人筆記）、`Claude outputs/`（預覽圖）；不要公開銀行帳號或付款碼（`src/config/app.js` 的 donate 保持註解）。

## 架構
- `src/` 網頁；`src/i18n.js`：`t(zh)` 查英文字典、`tx(zh,en)` 兩種語言寫在一起、`tr()` 逐段翻譯。新增 `t()` 字串要加字典（`npm run check` 會檢查）。
- `tools/cloudflare-worker.js`：中繼站（`taiwan-grid-flow-data.willy110611.workers.dev`，module `worker.js`，KV 綁定 NOTIFY，Cron `*/10 * * * *`）。台電擋海外 IP，所以網頁、GitHub Actions 都經中繼站拿台電資料。
- `scripts/opendata.mjs`（`npm run build` 會先跑）：建置時從中繼站 `/open/…` 抓台電開放資料 → `public/data/*.json`（計畫停電、鄉鎮用電、歷年供需、縣市綠電）。`SKIP_OPENDATA=1` 可略過。
- `.github/workflows/`：`deploy.yml`（push 與每 10 分鐘建置部署，上線前跑 `npm run check` 與冒煙測試）、`health.yml`（每小時健康檢查，有問題才通知）、`rollback.yml`（一鍵回到上一版）。
- 版本號：`package.json`、`public/sw.js` 的 CACHE、`src/config/changelog.json` 三處一起改。

## 測試
- `npm run check`（英文翻譯）、`npm run build`、`npm run smoke`（無頭瀏覽器，用模擬資料開每個面板）。
- 網址參數：`?sim=1&density=0.2&fps=10&debug=1`（模擬資料、`window.tgf`＝地圖引擎）。

## 中繼站部署（要使用者允許）
Cloudflare 帳號 `4bd497adc004887645c3ff9cad913f31`，Worker 名稱 `taiwan-grid-flow-data`。
使用者在 Claude 內建瀏覽器登入 Cloudflare 後，從 dash.cloudflare.com 頁面：
`PUT /api/v4/accounts/{帳號}/workers/scripts/taiwan-grid-flow-data/content`，FormData：`metadata`＝`{"main_module":"worker.js","keep_bindings":["secret_text","plain_text","kv_namespace"]}`、檔案 `worker.js`（`application/javascript+module`），標頭 `x-atok: window.bootstrap.atok`。程式碼用 raw.githubusercontent 指定 commit 取得並核對 SHA-256。

## 目前待辦
- 中繼站 v7 修正版（台電「停電資訊」psvs1 加逾時與換標頭重試）已在 main，**尚未部署**：部署後測 `/typhoon.json`；若仍逾時，代表 psvs1 不讓海外主機讀，需另想辦法。
- 「匯入我家用電 CSV」（智慧電表）— 使用者未決定。
- 詳細待辦另見 claude.ai「APP」專案的《台灣光脈搏_待辦清單》。
