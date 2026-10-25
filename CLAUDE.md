# 台灣光脈動 Taiwan Grid Flow（舊名：台灣光脈搏） — 給 Claude 的交接說明

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
- `npm run check`（英文翻譯、電廠設定：供電區、座標、機組對應不重複）、`npm run build`、`npm run smoke`（無頭瀏覽器，用模擬資料開每個面板）。
- 網址參數：`?sim=1&density=0.2&fps=10&debug=1`（模擬資料、`window.tgf`＝地圖引擎）。

## 中繼站部署（要使用者允許）
Cloudflare 帳號 `4bd497adc004887645c3ff9cad913f31`，Worker 名稱 `taiwan-grid-flow-data`。
使用者在 Claude 內建瀏覽器登入 Cloudflare 後，從 dash.cloudflare.com 頁面：
`PUT /api/v4/accounts/{帳號}/workers/scripts/taiwan-grid-flow-data/content`，FormData：`metadata`＝`{"main_module":"worker.js","keep_bindings":["secret_text","plain_text","kv_namespace"]}`、檔案 `worker.js`（`application/javascript+module`），標頭 `x-atok: window.bootstrap.atok`。程式碼用 raw.githubusercontent 指定 commit 取得並核對 SHA-256。

## 中繼站 v8（已部署 2026-10-24，commit a35db2a）
Durable Object `PRESENCE`→`Presence`（SQLite）已建立，migration tag 已是 `v1`，之後部署**不要再帶 migrations**。
注意：`/content` 端點只換程式碼、不會加綁定；要改綁定須用 `PUT /accounts/{帳號}/workers/scripts/taiwan-grid-flow-data`（FormData 同上），metadata：`{"main_module":"worker.js","bindings":[{"type":"durable_object_namespace","name":"PRESENCE","class_name":"Presence"}],"keep_bindings":["secret_text","plain_text","kv_namespace"],"observability":{"enabled":true,"head_sampling_rate":1}}`。
`/config.json` 的 lineFriendUrl 為 null（供電／空品 LINE 推播只發給管理者 LINE_TO；要開放給所有好友就在 Worker 變數加 `LINE_FRIENDS=1`）。

## 目前待辦
### 需要使用者決定
- 地圖流向（重力模型 λ=1.3°）與台電各區實測矛盾：例如凌晨北部實測自給 123%（往外送），地圖仍畫南往北。改法：調小 λ 或用各區收支約束模型，會改變「南電北送」主視覺。
- 新資料來源（見下方「可加的資料」），使用者選定後先出預覽圖。
- 「匯入我家用電 CSV」（智慧電表）。
### 中繼站
- v8.1 已部署（2026-10-25，commit 040fbc8，SHA-256 1260d9b6…5190）：推播改名台灣光脈動、`/typhoon.json` 直接回 503。
- v8.2 已部署（2026-10-25，commit 281cf9e，SHA-256 dc6c43b2…8a61）：`/open/unit-history.json`（data.gov.tw 37331 台電各機組過去發電量）。
  查證結果：檔案 196 MB、只有 3 個月、只有台電自有 153 部機組（無民營電廠、購電再生能源；2026-04-15 12:00 合計只有 19,356 MW、太陽能 84 MW）→ 不適合做全台回放，待使用者決定用途。
- v8.3 已部署（2026-10-25，commit fd8e133，SHA-256 66c00aab…d823）：`/bundle.json?x=air` 一起帶 aqi、cems、sun（壓縮後 11 KB → 19 KB）。網頁 `src/data/extras.js`：資料包有帶就用，舊中繼站或失敗時各自退回原網址。
- 用量（2026-10-24）：Workers 一天 5,496 次（免費 10 萬的 5.5%）。v0.8.20 起每個前景分頁每小時約 6 次（原本約 16 次）→ 免費額度約可撐全天平均 690 人同時在線；同時在線 > 400（`BUSY_ONLINE`）時網頁改每 20 分鐘更新。超過免費額度會回 1027 到台灣早上 8 點；要更多就升級 Workers Paid（$5／月含 1,000 萬次，超過每百萬 $0.30）。
- 部署 curl 注意：檔案欄位要寫 `filename=worker.js`，否則回 10021「No such module」。
- KV 讀取：Cron 每 10 分鐘逐筆讀所有訂閱（約 144×人數 次/天，約 690 人達免費 10 萬上限）→ 改存 list metadata（需部署）。
### 其他
- 首次載入：4G 模擬約 7 秒才出現地圖（maplibre 255 KB、deck.gl 221 KB gzip）。可評估精簡 deck.gl 圖層、延後載入；回訪有 service worker 快取很快。
- CEMS：中繼站沒有漏資料，環境部 aqx_p_187 本身時常缺台中、興達、麥寮汽電（2026-10-25 02:00 查證）。
- 右下資料來源列與「蘭嶼鄉」地名重疊（已加陰影）。（東部供電區標籤已移到台東外側；電腦版「全島」按鈕在面板打開時移到面板左邊）
- CEMS、日射量一開頁就下載（CEMS 也用在地圖電廠標籤，所以沒改成延後）。
- `index.html` 的 `user-scalable=no`（iPhone 縮放問題當初刻意加的，先保留）。
- 小水力、石門、陸域小風場等對不到節點的機組依比例分配到同燃料電廠（量小）。
- 詳細待辦另見 claude.ai「APP」專案的《台灣光脈搏_待辦清單》（舊名）。

### 可加的資料（2026-10-25 研究，免費優先；網址待在台灣網路確認）
1. 台電各機組過去發電量（data.gov.tw 37331）→ 回放任一天。
2. ~~OSM 超高壓線路與變電所~~（v0.8.19 已做，「更多 → 線路」可切回示意光纖）。
3. 全國部門別用電月資料（161209）→「誰用掉了電」。
4. 縣市住宅／服務業／機關用電（29935）。
5. 氣象署颱風路徑 W-C0034-005（已有 CWA_KEY）→ 補颱風功能。
6. 各類發電量月統計（112650）、再生能源月資料（160060）→ 長期趨勢。
7. Ember API（免費，CC BY）→ 國際碳強度比較。
8. 電力交易平台輔助服務價格（公開網址待確認）。
付費：Electricity Maps 商用約 €6,000／年，資料多半也來自台電 → 不建議。

## 資料需定期更新
- `public/grid-lines.json`：OSM 345kV／161kV 線路與超高壓變電所（ODbL，2026-10-25 擷取，Douglas-Peucker 精簡）。這個環境連不到 Overpass：要更新時在分支放一次性 workflow 由 Actions 抓取提交，用完刪掉。光流模式 `localStorage tgf-route`（grid／fiber），引擎 `src/engine/gridNet.js`：只走最大連通網路；路線比直線長超過 2.5 倍＋0.1° 改用示意路線（OSM 缺線段，例如和平→花蓮、德基→花蓮）。
- `src/config/nuclear.js`：核電廠現況（核安會、經濟部）。狀態有變（例如核三再運轉進度、核二送審）要更新，並改 `NUCLEAR_VERIFIED`。

## 備選清單（暫停中）
- **颱風停電（D2）**：2026-10-24 停用（`src/config/app.js` 的 `typhoon: false`，網頁不請求也不顯示）。原因：台電 psvs1（`service.taipower.com.tw/psvs1/`）從 Cloudflare 中繼站讀會逾時（台灣連 Worker 也一樣 502）、從台灣瀏覽器直接讀被 CORS 擋（無 `Access-Control-Allow-Origin`）、GitHub Actions 是海外主機。每月排程會自動搜尋台電是否有新的公開來源（API、開放資料、CORS 開放），有就通知使用者。恢復方式：換資料來源 → 改中繼站 `typhoon()` → `typhoon: true`。中繼站程式碼仍保留 `/typhoon.json`。

