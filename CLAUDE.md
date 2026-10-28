# 台灣脈動 Taiwan Grid Flow（舊名：台灣光脈動、台灣光脈搏） — 給 Claude 的交接說明

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
- `.github/workflows/`：`deploy.yml`（push 與每 10 分鐘建置部署，上線前跑 `npm run check` 與冒煙測試）、`health.yml`（每小時健康檢查，有問題才通知）、`rollback.yml`（一鍵回到上一版）、`maintenance.yml`（維護模式：暫停／重新開放）。
- 維護模式（v0.8.70）：`public/maintenance.json`（`{"on":false}`；暫停 `{"on":true,"since":ISO}`）。index.html 先發請求、`src/maintenance.js` 決定顯示維護頁或網頁；開著的網頁每 5 分鐘與切回前景時檢查、維護頁每 3 分鐘重查（恢復自動重新載入）；service worker 不快取這個檔。`?maint=0` 略過（冒煙測試、健康檢查用）。
  - 健康檢查（`scripts/health.mjs`，每小時）：有問題 3 分鐘後重查。**嚴重**（網頁 60 秒打不開、地圖沒出現、總發電 < 5,000 MW、與中繼站 genary 原始加總差 > 10%（同資料時間才比）、用電 > 發電 × 1.3）→ 自動改 maintenance.json、推 main、`gh workflow run deploy.yml`，LINE 用 `/alert?type=maint`（中繼站 v8.11 才有，舊版回 ignored → 改送 site）。其他（資料延遲、面板／今日重播／自動導覽／篩選出錯）只通知。已暫停時不再通知。本機試跑：`HEALTH_DRY=1 HEALTH_SITE=http://127.0.0.1:4177/ node scripts/health.mjs`。
  - 重新開放：Actions「維護模式」→ 重新開放（或改檔推 main）。
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
### 需要使用者決定
- 地圖流向（重力模型 λ=1.3°）與台電各區實測矛盾：例如凌晨北部實測自給 123%（往外送），地圖仍畫南往北。改法：調小 λ 或用各區收支約束模型，會改變「南電北送」主視覺。
- 新資料來源（見下方「可加的資料」），使用者選定後先出預覽圖。
- 「匯入我家用電 CSV」（智慧電表）。
### 中繼站
- v8.1 已部署（2026-10-25，commit 040fbc8，SHA-256 1260d9b6…5190）：推播改名台灣光脈動、`/typhoon.json` 直接回 503。
- v8.2 已部署（2026-10-25，commit 281cf9e，SHA-256 dc6c43b2…8a61）：`/open/unit-history.json`（data.gov.tw 37331 台電各機組過去發電量）。
  查證結果：檔案 196 MB、只有 3 個月、只有台電自有 153 部機組（無民營電廠、購電再生能源；2026-04-15 12:00 合計只有 19,356 MW、太陽能 84 MW）→ 不適合做全台回放 → v0.8.22 用在電廠卡「過去發電量」（`scripts/unit-history.mjs` 手動跑 → `public/unit-history.json`，19 座電廠；原檔 04-01 整天重複，腳本已去重）。台電更新資料時重跑。
- v8.3 已部署（2026-10-25，commit fd8e133，SHA-256 66c00aab…d823）：`/bundle.json?x=air` 一起帶 aqi、cems、sun（壓縮後 11 KB → 19 KB）。網頁 `src/data/extras.js`：資料包有帶就用，舊中繼站或失敗時各自退回原網址。
- 用量（2026-10-24）：Workers 一天 5,496 次（免費 10 萬的 5.5%）。v0.8.20 起每個前景分頁每小時約 6 次（原本約 16 次）→ 免費額度約可撐全天平均 690 人同時在線；同時在線 > 400（`BUSY_ONLINE`）時網頁改每 20 分鐘更新。超過免費額度會回 1027 到台灣早上 8 點；要更多就升級 Workers Paid（$5／月含 1,000 萬次，超過每百萬 $0.30）。
- 部署 curl 注意：檔案欄位要寫 `filename=worker.js`，否則回 10021「No such module」。
- v8.5 已部署（2026-10-25，commit c293723，SHA-256 952fca18…441e）：意見回饋 POST /feedback（KV `fb:日期` 存 180 天、全站每天上限 100 則、同 IP 60 秒一則；每天前 10 則 LINE 通知管理者；管理者在 LINE 傳「回饋」看最近 7 天）。
- v8.6 已部署（2026-10-26 01:41，commit 81a3845，SHA-256 d81f0de2…6c9e）：回饋改為每則一個鍵 `fb:日期:時間-亂數`（v8.5 的 `fb:日期` 陣列仍可查）、每日計數 `fbn:日期`、60 秒限制改 KV `fbip:IP雜湊`（60 秒 TTL；workers.dev 上 Cache API 無效）、滿 100 則回 503 `full`、body 非物件回 400。
- v8.7 已部署（2026-10-26 12:26，commit 0e53bb7，SHA-256 3a69e83a…6ff2）：App 通知依訂閱語言發中／英文（訂閱存 `lang`，subscribe 回傳 lang）。
- v8.8 已部署（2026-10-26，commit 073725a，SHA-256 a9cc59ec…3e08）（低碳時段通知）：訂閱存 `lowc`；每天第一次排程用昨日 loadfueltype_1.csv 算 07–22 點最低碳 2 小時存 KV `日期:lowc`，時段內發一次（`日期:plowc`）。係數與網頁 carbon.js EMISSION、欄位與 parseAux FUEL_COLS 要同步。
- v8.9 已部署（2026-10-26，commit 0abc92f，SHA-256 5b304ca4…1047）：`/water/tainan-pipes.json` 固定轉送臺南給水管線（實測 522，臺南伺服器擋 Cloudflare）。
- v8.10 已部署（2026-10-26 23:46，commit a33f4e4，SHA-256 a4eee5ee…2904）：推播、LINE 訊息名稱改「台灣脈動」。
- v8.11 **待部署**（要使用者說「允許部署」）：`/alert?type=maint`「已自動暫停網站」LINE 訊息。未部署前自動暫停時 LINE 會收到一般的「每小時檢查失敗」。
- v8.4 已部署（2026-10-25 19:40，commit 397bd39，SHA-256 ebe9a8f7…7d7d）：訂閱（p:、u:）同時存成 KV list metadata，排程列出時不用逐筆讀（原本約 144×人數 次/天，約 690 人達免費 10 萬上限）。舊資料第一次被讀時補寫 metadata（每筆一次寫入，每次排程最多 100 筆、寫入失敗不影響通知）。已用模擬 KV 測過。另外待辦：字型 Noto Sans TC 300＋400 兩個字重首次約 1 MB，拿掉 300 可省一半但地圖細字會變粗（設計取捨，待使用者決定）。
### 其他
- 英文介面：空品測站名（「我的家」測站選單）仍是中文——環境部 aqx_p_432 沒有英文站名；要英文需中繼站另抓測站基本資料 aqx_p_07 的 siteengname（要部署中繼站）。機組名只在開頭是電廠主名稱時換英文（geo.js `unitName`），水力節點與其他小站照原文。
- loadpara.json 另有 `yday_*`（昨日尖峰用電、備轉）與 `real_hr_maxi_sply_capacity`（今日實際最大供電能力），網頁目前沒用。
- 地圖引擎（v0.8.66，2026-10-27）：maplibre-gl 6.16＋deck.gl 9.4（修 GHSA-jrc7-96c5-q579）。注意：① maplibre 6 的背景執行緒是獨立檔，GridFlowEngine.js 用 `maplibre-gl/dist/maplibre-gl-worker.mjs?url` + `setWorkerUrl` 指定；② maplibre 6 把鏡頭狀態搬到 `map._camera.transform`，deck.gl 9.4 疊圖仍讀 `map.transform` → 在 map 上補 getter（升級 deck.gl 後可檢查是否還需要）；③ `import * as maplibregl`。gzip 比 5.6／9.1 多約 83 KB（maplibre 292、deck 267），worker 另載約 150 KB。package-lock 的 playwright 鎖 1.63（配合本機預裝瀏覽器）。
- 返回鍵（v0.8.62）：App.jsx 用 history.state.tgfDepth 對應層數（面板 1、地圖選點 2）；介面自己關閉時 history.go 退回並略過那次 popstate。Esc 處理器一律 `e.preventDefault()`、其他處理器先看 `e.defaultPrevented`（面板 → 選點 → 對話框 → 回放／放空，一次只做一件事）。
- 時間：亮點、回放、狀態列、我的紀錄、今日曲線重建都用台電資料時間（history.js `rowHM`／`dataMs`），不用收到資料的 `t`。
- 2026-10-27 夜間兩輪無頭瀏覽器 QA（手機直／橫、平板、電腦、鍵盤、英文）問題都已修；剩：手機橫向（高約 400 px）全島視角受地圖邊界 MAX_BOUNDS 限制無法再縮小，島會略壓到篩選列／工具列（v0.8.63 留白已依介面位置計算）。2026-10-27 06:15 日出後用真實資料檢查：太陽能 06:00 起出現、黎明交班徽章、亮點與電廠卡時間都正常。
- v0.8.65 依使用者確認的三份預覽上線：品牌（index.html 開機畫面、`src/components/Logo.jsx`、public 圖示由 Playwright 畫）、首頁精簡（Hud.jsx `FilterChip`、`.mix-sub`、ClockPanel `simple`、HomeCard 膠囊）、電廠卡（Plant.jsx `CapRing`／`TodayChart`）與亮點方塊（純 CSS，styles.css 末段）。
- 首次載入最大宗是字型（Noto Sans TC 300＋400 約 0.9 MB），其次 maplibre 255 KB、deck.gl 221 KB（gzip）。
- 首次載入：4G 模擬約 7 秒才出現地圖（maplibre 255 KB、deck.gl 221 KB gzip）。v0.8.31 地形圖磚 tileSize 改 512（手機首次 1.9 MB → 0.5 MB）。面板程式只佔約 5%，延後載入效益小；回訪有 service worker 快取很快。
- CEMS：中繼站沒有漏資料，環境部 aqx_p_187 本身時常缺台中、興達、麥寮汽電（2026-10-25 02:00 查證）。
- 右下資料來源列與「蘭嶼鄉」地名重疊（已加陰影）。（東部供電區標籤已移到台東外側；電腦版「全島」按鈕在面板打開時移到面板左邊）
- CEMS、日射量一開頁就下載（CEMS 也用在地圖電廠標籤，所以沒改成延後）。
- `index.html` 的 `user-scalable=no`（iPhone 縮放問題當初刻意加的，先保留）。
- 小水力、石門、陸域小風場等對不到節點的機組依比例分配到同燃料電廠（量小）。
- 2026-10-26 資料稽核（逐項比對中繼站原值）：總發電、各燃料、各區、用電、燃料曲線、預報都正確。已修：和平 PLANT_REGION 改 N（台電分區把和平算北部）、鉅工／水里歸 mingtan、碳排分級基準 0.467×0.95（發電端 vs 售電端）。待查：深夜 23 點後 loadpara 的 fore_* 可能已換成隔天預估但 publish_time 仍是今天（網頁標「今日尖峰」）；雲林節點（允能、麥寮）台電可能算南部（2026-10-27 凌晨每 25 分鐘比對：節點出力按 PLANT_REGION 加總，中部一直比台電中部實測多約 1,100–1,300 MW、南部少約 850；允能＋麥寮改南部後中部仍多約 450–700，再把苗栗離岸風場改北部最吻合，但只有夜間資料、也查不到台電官方縣市對照 → 2026-10-27 使用者同意，v0.8.64 已改（允能、麥寮、雲林太陽能 → S；苗栗離岸 formosa1/2、苗栗風場 → N；REGIONS 雲林縣移到南部；通霄留中部）；白天可再比對確認；腳本概念：抓 lastSnapshot.plants 與 regions.byKey.gen 相減）；`public/unit-history.json` 已於 2026-10-27 重跑（鉅工、水里改在 mingtan；台電原檔仍是 03-01～05-31）。
- 2026-10-25 已用 OSM power=plant 交叉核對：火力、核能、離島電廠位置都在 1.3 km 內（綠島 OSM 沒有）；新增豐德、海湖、新桃、國光、星元、星能節點（原本豐德沒對應、海湖／新桃／國光併在大潭、星元併在麥寮、星彰併在彰濱風電）。PLANTS 的 `fuel` 欄位＝電廠主燃料（麥寮 coal、澎湖／金門 oil），電廠卡用來說明主要機組不在資料裡。台電即時資料目前沒有麥寮燃煤機組，麥寮節點只剩雲林風力（CEMS 仍有麥寮汽電煙道資料）。仍對不到的：汽電共生（627 MW）、其它購電太陽能／風力、中威大安、創維風、小水力、電池。
- 詳細待辦另見 claude.ai「APP」專案的《台灣光脈搏_待辦清單》（舊名）。
- 2026-10-26 改名「台灣脈動」（英文仍是 Taiwan Grid Flow）；網頁、manifest、分享圖（public/og-image.jpg 用 PIL 重畫標題）、中繼站推播文字都已改。git 歷史與舊版更新說明保留舊名。

### 其他國家（2026-10-26 用一次性 Actions 實測；使用者決定暫不做）
- 澳洲 AEMO：`visualisations.aemo.com.au/aemo/apps/api/report/ELEC_NEM_SUMMARY`（5 州需求、價格、互聯線，CORS *，瀏覽器可直接讀）；逐機組 `nemweb.com.au/Reports/Current/Dispatch_SCADA/` 每 5 分鐘一個 ZIP（約 3.7 KB、約 520 個 DUID，無 CORS → 要中繼站解壓）。機組座標要另外對（GEM，CC BY）。
- 英國 Elexon：`data.elexon.co.uk/bmrs/api/v1/datasets/FUELINST`（燃料別 5 分鐘）、`PN/stream`（逐機組計畫值，40 分鐘約 1.1 MB）、`B1610`（實測，約晚 5 天）、`reference/bmunits/all`（有 GSP 區，無座標）；全部 CORS *。NESO `api.carbonintensity.org.uk/regional` 有 14 區發電組成。
- 法國 RTE éCO2mix（odre.opendatasoft.com）CORS *。

### 💧 水模式（v0.8.51 起）
- **2026-10-26 使用者決定先不開放**：`src/config/app.js` 的 `water: false` → 不顯示切換、強制電力模式；開發測試用 `?water=1`（冒煙測試也用它）。要開放就改 `water: true`。
- 切換：上方 `ModeSwitch`（網址 `?mode=water`、localStorage `tgf-mode`）。`engine.setWater(on)` 清空 deck 圖層、停粒子與各區熱度、maxZoom 12→17。水的圖層是 MapLibre 原生圖層：`src/water/waterMap.js`；介面：`src/water/WaterHud.jsx`（右上總覽、圖層開關、圖例、點選卡、水庫清單、停水連結）。
- 靜態資料 `public/water/`（`scripts/water/build-static.py`，由 `.github/workflows/water-static.yml` 在 Actions 跑；手動執行可選 `plants reservoirs taipei`，推到分支只重跑水庫）：
  - `plants.json`：台水淨水場 36602（supp7.csv，TWD97→WGS84），每年。
  - `reservoirs.json`：水利署水庫基本資料 32726（中文欄位、容量有千分位逗號；目前有效容量缺值用設計值）＋ OSM 水庫範圍中心（Overpass 要用專案 User-Agent，會 502 要換站）。對不到：大埔、集集攔河堰、鹿寮溪。
  - `taipei-trunk.json`（管徑 ≥ 300 mm，約 950 km，1.7 MB）＋ `taipei/{x}_{y}.json`（小管 0.02° 一格，76 格約 25 MB，zoom ≥ 14 才載入）：data.taipei 工務局「公共管線圖資＿自來水系統管線」6 個 XML（約 760 MB，轉檔約 25 分鐘），每季更新。service worker 不快取 `/water/`。
- 即時：`scripts/water-live.mjs`（build 時跑）→ `public/data/water-live.json`：水庫水情 45501（`opendata.wra.gov.tw/api/v2/2be9044c-…`，有效蓄水量單位萬 m³）、枯旱預警 36695（`51ea7202-…`）。水利署要求蓄水率不要用綠黃橙紅（避免和水情燈號混淆）→ 一律藍色。
- 臺南給水管線（122507）：`soa.tainan.gov.tw` 擋海外，Cloudflare 也 522（中繼站 v8.9 `/water/tainan-pipes.json` 已部署但取不到）→ 要在台灣網路下載後放進 repo 再轉檔。桃園（opendata.tycg.gov.tw）下載方式未找到。
- 停水：台水無公開 API（停水地圖用內部介面，不用）→ 只放連結。北水處有官方停水開放資料 128236（ASMX，大台北，每日）→ 下一步可接（要查欄位與 CORS／中繼站）。
- 研究（2026-10-26）可加：北水災時供水 KML 138526、北水各淨水場水質 139258（季）、環境部自來水水質抽驗、每人每日用水量 8316、台水漏水率 103681、地下水即時水位；國外參考：USGS National Water Dashboard、東京都水道局震災通水地圖、Thames Water 維修地圖、芝加哥鉛管地圖、「從水源到水龍頭」導覽（Las Virgenes、Icon Water）。

### 自來水版評估（2026-10-26 用一次性 Actions 實測，待使用者決定）
- 海外（GitHub Actions）可直接讀：台水 `www.water.gov.tw/opendata/*.csv`（淨水場位置與供水轄區 supp7.csv＝data.gov.tw 36602，TWD97；水質 qual9.csv；供水系統月資料 syst8.csv）、data.gov.tw API、水利署 opendata.wra.gov.tw（枯旱預警 36695、曾文 32733、高屏堰 143020 等 `/api/v2/{id}?format=JSON`）。
- 管線真實座標：只有臺南（data.gov.tw 122507 給水管線）、臺北（data.taipei 自來水系統管線）、桃園（opendata.tycg.gov.tw）以開放資料公開，註明「僅供參考」；其他縣市沒有。OSM 台灣：water_works 約 190、水塔約 260、水管 pipeline 131 條。
- 沒有：即時用水量／水壓、停水公告 API（6050 疑似停更）、水情燈號 API。

### 可加的資料（2026-10-25 研究，免費優先；網址待在台灣網路確認）
1. ~~台電各機組過去發電量（37331）~~（只有台電自有機組，v0.8.22 用在電廠卡「過去發電量」）。
2. ~~OSM 超高壓線路與變電所~~（v0.8.19 已做，「更多 → 線路」可切回示意光纖）。
3. 全國部門別用電月資料（161209）→「誰用掉了電」。
4. 縣市住宅／服務業／機關用電（29935）。
5. 氣象署颱風路徑 W-C0034-005（已有 CWA_KEY）→ 補颱風功能。
6. 各類發電量月統計（112650）、再生能源月資料（160060）→ 長期趨勢（能源署擋海外主機；年度趨勢已用 Ember 做在亮點「台灣發電結構 2000–2025」）。
7. ~~Ember 國際比較~~（v0.8.23 已做：亮點「台灣在世界的位置」，`scripts/ember.mjs` → `public/ember.json`，每年 Ember 更新後由一次性 workflow 抓原檔再重跑）。
8. 電力交易平台輔助服務價格（公開網址待確認）。
- 能源署（moeaea.gov.tw，161209／112650／160060）：GitHub Actions 被 Cloudflare 驗證頁擋、這個環境也連不到 → 要經中繼站或在台灣網路抓。台電 29935 需加進中繼站 OPEN_FILES（要部署）。
付費：Electricity Maps 商用約 €6,000／年，資料多半也來自台電 → 不建議。

## 管理者手冊：介面不寫的提醒（2026-10-25 起規則：只給管理者知道的寫這裡，介面只寫使用者有權知道的）
- 空品讀不到、錯誤訊息含「金鑰」：到環境部資料開放平台申請 API 金鑰，設成中繼站 Worker 的 Secret `MOENV_KEY`。日射量要 `CWA_KEY`（氣象署）。
- 中繼站免費額度用完（錯誤 429／1027）：台灣早上 8 點重置；要避免就升級 Workers Paid。介面只說「今天使用人數太多，空品資料暫停更新，早上 8 點恢復」。
- 預報（forecast）、App 通知（需 v4 以上的 vapid 金鑰）都靠中繼站；讀不到時介面只說「暫時讀不到／暫時無法使用」。
- 本機版：用「啟動.bat」或桌布伺服器開（直接開 HTML 檔連不到台電）；GitHub Pages 版的備份資料由 Actions 每 10 分鐘抓。
- 意見回饋：中繼站 `POST /feedback` → KV `fb:日期`（180 天），每天前 10 則 LINE 推播給 LINE_TO；在 LINE 傳「回饋」看最近 7 天。
- 介面的錯誤一律只寫「暫時讀不到／暫時無法使用、何時恢復」。原始原因看中繼站 `/aqi.json`、`/cems.json`、`/sun.json` 的 error 欄位，或 /log 的錯誤紀錄（31 天）；通知開不起來多半是 KV（NOTIFY）沒綁或 `/config.json` 沒有 vapidPublic。
- 連線診斷的檔名、筆數、HTTP 碼只給開發看（本機 `?debug=1`）；`?sim=1` 是示範模式；`/taipower/...` 只有本機 vite 代理才有。
- 計畫停電原始 ZIP 每天存 KV `outage:raw:日期`（沒有期限）累積歷史，注意 KV 容量。
- 回饋的「同 IP 60 秒一則」與每日 100 則計數都用 KV，KV 最終一致（同機房可能 60 秒內讀不到剛寫的值）→ 只是概略限制；被灌爆再改用 Durable Object 計數。
- 中繼站開了 observability（Workers Logs）：尚未確認是否記錄 IP；介面目前寫「IP 位址不會寫入資料庫；送回饋時只暫存 60 秒防重複」。
- 開放 LINE 給所有好友（`LINE_FRIENDS=1`）前，先在「本站伺服器與你的資料」補 LINE 使用者 ID 的保存說明（封鎖即刪）。
- 付款 QR（donate-qr.png）2026-10-26 依使用者決定移出 repo（git 歷史仍有舊檔；要徹底清除需改寫歷史，未做）。
- App 通知語言：訂閱存 `lang`（zh／en，中繼站 v8.7 起）；網頁換語言時自動重新登記（`home.pushLang`，中繼站回傳 lang 才記）。新增通知種類要同時寫中英文。
- 使用者看得到的「本站伺服器與你的資料」（資訊 → 資料來源）要和中繼站實際保存的內容一致：通知訂閱（關閉即刪）、回饋 180 天、在線代碼 12 分鐘、錯誤回報約 30 天、不存 IP。改中繼站保存方式時要一起改這段文字。

## 資料需定期更新
- `public/grid-lines.json`：OSM 345kV／161kV 線路與超高壓變電所（ODbL，2026-10-25 擷取，Douglas-Peucker 精簡）。這個環境連不到 Overpass：要更新時在分支放一次性 workflow 由 Actions 抓取提交，用完刪掉。光流模式 `localStorage tgf-route`（grid／fiber），引擎 `src/engine/gridNet.js`：只走最大連通網路；路線比直線長超過 2.5 倍＋0.1° 改用示意路線（OSM 缺線段，例如和平→花蓮、德基→花蓮）。
- `src/config/nuclear.js`：核電廠現況（核安會、經濟部）。狀態有變（例如核三再運轉進度、核二送審）要更新，並改 `NUCLEAR_VERIFIED`。

## 備選清單（暫停中）
- **颱風停電（D2）**：2026-10-24 停用（`src/config/app.js` 的 `typhoon: false`，網頁不請求也不顯示）。原因：台電 psvs1（`service.taipower.com.tw/psvs1/`）從 Cloudflare 中繼站讀會逾時（台灣連 Worker 也一樣 502）、從台灣瀏覽器直接讀被 CORS 擋（無 `Access-Control-Allow-Origin`）、GitHub Actions 是海外主機。每月排程會自動搜尋台電是否有新的公開來源（API、開放資料、CORS 開放），有就通知使用者。恢復方式：換資料來源 → 改中繼站 `typhoon()` → `typhoon: true`。中繼站程式碼仍保留 `/typhoon.json`。

