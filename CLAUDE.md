# 台灣脈動 Taiwan Grid Flow（舊名：台灣光脈動、台灣光脈搏） — 給 Claude 的交接說明

即時台電發電／用電視覺化網頁（React 18 + Vite 6 + MapLibre + deck.gl），GitHub Pages 部署，手機版是 PWA。
設計者：無聊的人。回覆一律用**繁體中文**，精簡。

## 工作規則（使用者指定）
- **⭐ 第一優先：省 token**（2026-11-04 使用者指定，做任何事都先考慮）：
  - 一件事一個對話；對話長了 `/compact`、換主題 `/clear`；需求一次講完整。
  - 只讀需要的檔案片段（grep／指定行數），不整檔重讀；不重複查已知的事。
  - 少截圖（只在出預覽、驗證畫面時）；等部署只查一次結果，不反覆輪詢。
  - 大範圍搜尋交給子助手，只帶回結論；簡單工作用較小模型。
  - 回覆精簡；CLAUDE.md 只放規則與目前狀態，歷史紀錄放 `docs/紀錄.md`（2026-11-05 已搬）。
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
- `.github/workflows/`：`deploy.yml`（push 與每 10 分鐘建置部署，上線前跑 `npm run check` 與冒煙測試）、`health.yml`（每小時健康檢查，有問題才通知）、`rollback.yml`（一鍵回到上一版）、`maintenance.yml`（維護模式：暫停／重新開放）。
- 知識題（v0.8.71）：`src/config/quizBank.js`（題庫＋出處 SOURCES；**新增題目加在最後、填 since 日期，不改舊題 id**；每題要有確切出處）、`src/data/quiz.js`（週／季計算、選題：從 QUIZ_START 逐週挑最久沒出的題、同分用雜湊；6 種看地圖題依當下台電資料判斷；作答紀錄 localStorage `tgf-quiz`）、`src/components/Quiz.jsx`（面板、去地圖找答案的提示列 QuizPeekBar、主畫面本季前三 QuizTop3）。v0.8.72 起每週一、週四 00:00 各換一期 3 題（2 知識＋1 看地圖；期 id `2026-W46-1`／`-2`，2026-W45 是舊制一期 5 題）；每兩個月一季（依該週星期一月份），補答規則（v0.8.75，使用者指定）：上一期每季可補 3 次、更早截止，第一次加入的那一期可補全季（`canAnswer`，中繼站 v8.14 同樣把關）；未答提醒小視窗 `APP.quizNudge: true`（打開 6 秒後、每期最多一次）；排名＝答對數、同分比作答總時間（單題最多計 30 分鐘）。對錯在裝置端判斷，中繼站只記分（以週記分、每週最多 6 題〔v8.13；v8.12 是 5 題〕、每題只算第一次、只收本季且不晚於本週）。`APP.quiz` 可關。使用者希望題庫持續增加、可偶爾重複。待查：advice.js 時間電價 5.16／2.06 標「114 年 10 月起」，但有文章說是 115 年 4 月起的費率（題庫先不出電價費率題）。
- 維護模式（v0.8.70）：`public/maintenance.json`（`{"on":false}`；暫停 `{"on":true,"since":ISO}`）。index.html 先發請求、`src/maintenance.js` 決定顯示維護頁或網頁；開著的網頁每 5 分鐘與切回前景時檢查、維護頁每 3 分鐘重查（恢復自動重新載入）；service worker 不快取這個檔。`?maint=0` 略過（冒煙測試、健康檢查用）。
  - 健康檢查（`scripts/health.mjs`，每小時）：有問題 3 分鐘後重查。**嚴重**（網頁 60 秒打不開、地圖沒出現、總發電 < 5,000 MW、與中繼站 genary 原始加總差 > 10%（同資料時間才比）、用電 > 發電 × 1.3）→ 自動改 maintenance.json、推 main、`gh workflow run deploy.yml`，LINE 用 `/alert?type=maint`（中繼站 v8.11；回 ignored 時改送 site）。其他（資料延遲、面板／今日重播／自動導覽／篩選出錯）只通知。已暫停時不再通知。本機試跑：`HEALTH_DRY=1 HEALTH_SITE=http://127.0.0.1:4177/ node scripts/health.mjs`。
  - 重新開放：Actions「維護模式」→ 重新開放（或改檔推 main）。
- 光流（v0.8.73）：`flowModel.js` `solveRegionalFlows` ＝ 各區先自給、只有多出來的電才跨區（區間雙限制重力；外送由靠近缺電區的大電廠負責、不套 6% 修剪）。每區要留下的電＝區內電廠加總 −（台電該區 gen − load），所以區間淨流向與右側各區「供能／吸能」一致。2026-11-04 06:10 實測：北 117%、中 112% → 北→南 1,181＋北→東 263、中→南 764＋中→東 76 MW，無南往北交叉流。舊的 `solveFlows`（純重力）保留未用。
- 在線人數（v0.8.73）：資料包 `/bundle.json` 冷啟動實測 9.5 秒 > 原本 9 秒逾時 → 改走個別網址就沒有 online 欄位而消失；現在等 15 秒，失敗時沿用 15 分鐘內的上次人數。
- 版本號：`package.json`、`public/sw.js` 的 CACHE、`src/config/changelog.json` 三處一起改。changelog 的 `notes` 往前累加；`notesEn` 只放最近幾版的英文說明（英文介面的更新提示用，沒有就不列）。

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
- 本週 11/4–11/8 除維護外不處理其他事項（使用者指定）。
- 省 token：2026-11-05 已把 CLAUDE.md 從約 2.7 萬字縮到約 1 萬字（細節搬到 docs/紀錄.md）；舊的長對話（10/24 起，約 11.2 億 token）應結束，之後一件事開一個新對話。
### 需要使用者決定
- **知識題配合新聞／時事**（2026-11-04 使用者提出）：題庫偶爾加入和近期新聞、熱門話題有關的題目（例：電價調整、核電公投／再運轉進度、創用電新高、颱風停電、能源政策），一樣要有確切出處（新聞＋官方來源），`since` 填加入日期；時效性題目可在題目或說明寫明「截至某年某月」。
- **網站錯誤「sw.js load failed」**（2026-11-04 LINE 錯誤通知，v0.8.73 手機 promise 3 次）：已查到原因、尚未修：`src/update.js` `applyUpdate()` 裡 `(await getRegistration())?.upd…（詳見 docs/紀錄.md）
- 新資料來源（見 docs/紀錄.md「可加的資料」），使用者選定後先出預覽圖。
- 「匯入我家用電 CSV」（智慧電表）。
- **每日早報＋每日電力猜謎**（2026-11-02 已出預覽，使用者說「先不改」，存待辦；做之前再出一次預覽確認）。目的：讓一般人每天／每週回來（參考軌島：跟自己有關＋天天有理由打開）。
- **產品功能手冊**：2026-11-02 依程式盤點寫成 Claude Docs「台灣脈動 產品功能手冊」（https://claude.ai/artifact/TQj6gLa1tuBsUnzB6BQ16t），功能有改時要同步更新。
- **石油地圖**（2026-11-02 研究，未決定範圍與放哪）：使用者想要「油田→煉油廠→港口→航線→各國」流向圖。
- **其他國家電力即時程度**（2026-11-02 補查，未實測連線）：美國 EIA-930 每小時各調度區燃料別與區間交換（免費 API，逐電廠只有每月）；日本各電力公司 5 分鐘區域用電 CSV、OCCTO 發電方式（火力不拆煤氣油）與區間聯絡線 5 分鐘潮流（未找到正式 API）；韓國 K…（詳見 docs/紀錄.md）

## 其他資料（需要時才讀，平常不要整檔讀）
`docs/紀錄.md`：待辦細節、中繼站歷次部署（v8.1–v8.14）、已知問題與查證紀錄、其他國家／水模式／石油研究、可加的資料、**管理者手冊**、資料定期更新、備選清單。用 grep 找關鍵字只讀相關段落。
