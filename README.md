# 台灣光脈動 · Taiwan Grid Flow

把台電各機組的即時發電量，轉成在夜光地圖上流動的能量。設計者：無聊的人

## 三種用法

| 用法 | 怎麼開 | 說明 |
|---|---|---|
| 電腦瀏覽 | 雙擊 **啟動.bat** | 自動安裝並打開 http://localhost:5173 |
| 桌面即時背景 | 雙擊 **設定桌布.bat**（只需一次） | 開機自動在背景執行，搭配免費的 Lively Wallpaper |
| 手機 App | 開 https://willy110611-collab.github.io/taiwan-grid-flow/ | iPhone：Safari → 分享 → 加入主畫面 |

改完程式碼後，雙擊 **一鍵更新.bat**：會推送到 GitHub（手機版約 2 分鐘後更新），如果有設定桌布也會一起更新。
不想要桌布了就雙擊 **解除桌布.bat**。

## 第一次上 GitHub（只需一次，跟動物戰棋一樣）

1. 到 https://github.com/new 建立儲存庫 `taiwan-grid-flow`，選 **Public**，不要勾任何初始檔案
2. 進儲存庫 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
3. 雙擊 **一鍵更新.bat**，跳出瀏覽器時登入 GitHub

之後 GitHub Actions 每 10 分鐘會自動抓一次台電資料並重新部署，手機版就能顯示即時數字，不受瀏覽器 CORS 限制。
（GitHub 規定：儲存庫 60 天沒有任何更新時，排程會自動暫停，到 Actions 頁面按一下啟用即可。）

## 資料來源（台電「今日電力資訊」政府公開資料，免申請，每 10 分鐘更新）

| 檔案 | 內容 | 用在 |
|---|---|---|
| genary.json | 各機組即時淨發電量 | 電廠光球、粒子數量 |
| genloadareaperc.csv | 北／中／南／東 即時發電與用電 | 區域熱度、自給率、負載點大小 |
| loadpara.json | 目前用電、今日尖峰預估備轉容量率與燈號 | 供電燈號 |
| loadfueltype.csv | 今日依燃料別發電曲線 | 今日亮點、今日回放 |
| loadareas.csv | 今日各區用電曲線 | 今日回放的區域用電 |

網址皆為 `https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/<檔名>`（單位萬瓩，程式自動換算 MW）。
抓不到時「資訊 → 資料來源 → 連線診斷」會列出每個檔案失敗的原因。

## 生活功能（v0.4）

| 功能 | 在哪裡 | 資料 |
|---|---|---|
| 我的家 | 工具列「我的家」、右上小卡 | 沒有預設地點，第一次自己設定；可用目前位置、在地圖上點選、搜尋 368 鄉鎮市區或選空品測站，只存在這台裝置 |
| 用電時機燈號 | 我的家 → 現在用電時機 | 台電時間電價時段＋碳排高低＋供電燈號；昨日曲線推估今天最低碳的 2 小時 |
| 每度電碳排（推估） | 右上小卡、我的家 | 各燃料發電量 × 典型排放係數；對照能源署公告係數 |
| 空品 × 火力 × 風向 | 篩選列「空品」 | 環境部 AQI 測站光點＋火力電廠下風方向扇形（示意） |
| 未來供電預報 | 我的家 | 台電「未來二個月電力供需預測」（每 10 天一筆） |
| 提醒 | 我的家 → 提醒 | 開著 App 時跳通知；App 關閉也要收到 → 設定 LINE（見下方） |
| 電廠煙道 CEMS | 空品面板、滑到火力電廠 | 環境部固定污染源連續自動監測 1 小時值 |
| 離島 | 金門、澎湖、馬祖、綠島、蘭嶼 | 各島獨立電網，電廠直接送到島上；台電未即時公布時標示「推估」 |

## Cloudflare 中繼站 v4（空品、CEMS、預報、LINE 與 App 通知需要）

1. **更新程式**：Cloudflare → Workers & Pages → `taiwan-grid-flow-data` → Edit code → 全選刪除，貼上 `tools/cloudflare-worker.js` 全部內容 → Deploy
2. **環境部金鑰（免費）**：到 https://data.moenv.gov.tw 註冊會員 → 會員專區申請 API 金鑰（Email 收信）
   Worker → Settings → Variables and Secrets → Add → 類型 **Secret**、名稱 `MOENV_KEY`、值貼金鑰 → Deploy
3. 打開 https://taiwan-grid-flow-data.willy110611.workers.dev/ 應顯示「環境部金鑰已設定」；
   再開 `/aqi.json`、`/cems.json`、`/forecast.csv` 確認有資料

**太陽能即時日照（選用）**
- 台電即時資料約 86% 的太陽能是「其它購電太陽能」一整行，沒有位置 → 依台電公布的「各縣市太陽光電裝置容量」（`src/config/geo.js` 的 SOLAR_COUNTY_KW，每年更新一次）分配到各縣市太陽能群
- 想讓陰天的縣市變暗、晴天的變亮：到 https://opendata.cwa.gov.tw 註冊取得授權碼 → Cloudflare 新增 Secret `CWA_KEY`
- 有名字的案場（彰濱光、崙尾光、星崙光、南鹽光）直接用台電即時數字

**LINE 提醒（App 關閉也能收到，開放給朋友加好友）**

1. LINE 官方帳號管理後台建立帳號 → 設定 → Messaging API → 啟用
2. LINE Developers（https://developers.line.biz/console/）點進這個 channel：
   - Basic settings → **Channel secret** → Cloudflare Secret `LINE_SECRET`
   - Messaging API → **Channel access token** → Issue → Cloudflare Secret `LINE_TOKEN`
   - Messaging API → **Webhook URL** 填 `https://taiwan-grid-flow-data.willy110611.workers.dev/line` → Verify → 打開 **Use webhook**
3. LINE 官方帳號管理後台 → 設定 → 回應設定：**Webhook 開啟、自動回應訊息關閉**
4. 官方帳號 ID（@ 開頭，在管理後台帳號名稱下方）→ Cloudflare Text `LINE_BASIC_ID`（網頁會出現「加 LINE 好友收提醒」按鈕）
5. （選用）Text `LINE_TO` = 自己的 userId、`HOME_SITE` = 自己的測站（預設西屯）：不用傳訊息就自動登記
6. （選用）Text `LINE_MONTHLY_CAP` = 每月主動推播上限，預設 200
7. KV 命名空間綁定 **NOTIFY**；Triggers → Cron `*/10 * * * *`

好友用法：加好友 → 傳測站名稱（例如「西屯」）登記。🆓 免費查詢：「現在」「預報」；設定：「只要供電」「全部通知」「停止」「說明」。

**通知規則（LINE 與 App 通知相同）**
- 空品：登記測站 AQI ≥ 101（對人體有害）；供電：燈號非綠燈或備轉 < 10%
- 每天最多一次；只在 07:00–21:59 發送（夜裡變差的，早上 7 點通知；早上沒達標、下午才達標就下午通知）
- LINE 每推一位好友算 1 則；當月用量達 `LINE_MONTHLY_CAP`（預設 200）的 80% 後只送供電警示，空品改由 App 通知；達 100% 停止推播，不會自動產生費用
- 好友傳訊息、Worker 回覆（「現在」「預報」）不算則數

**App 通知（Web Push，免費、不限次數）**
- 我的家 → 提醒 → 開啟「App 通知」，自動登記我的家最近的空品測站
- iPhone 需 iOS 16.4 以上，先用 Safari「分享 → 加入主畫面」，從主畫面打開再開啟
- 推播金鑰由中繼站第一次使用時自動產生並存在 KV（NOTIFY），不需要另外設定

## 小額贊助

在 `src/config/app.js` 的 `donate` 填入贊助平台網址（可多個），「資訊 → 關於」與電腦版右下角就會出現贊助按鈕；沒填就不顯示。

## 介面（概念參考「軌島」，程式碼為獨立撰寫）

- **用電視角**（篩選列「用電」）：區域底色暖色＝吸能（用電大於發電）、冷色＝供能；顯示各區自給率，都市光暈大小＝用電量
- **供電燈號**：依台電公布的尖峰備轉容量率顯示綠／黃／橘／紅，吃緊時地圖呼吸變急促
- **徽章簿**：12 枚徽章，電網徽章只在台電即時資料出現該狀態時頒發
- **今日回放**：拖動時間軸重播今天，60／300／900 倍速，天色跟著回放時間變化
- **機組異常偵測**：火力或核能機組 10 分鐘內出力驟降 300 MW 以上時跳出提示（偵測，非官方通報）

- **能源篩選**（上中）：全部／綠能／火力／核能，其他能源的粒子會淡出
- **即時／推估標示**：滑到電廠光球，標籤最下方標示「台電即時」「推估分配」或「模擬」
- **放空巡航**：鏡頭自動在 7 個場景間飛行；桌布模式每 3–5 分鐘換一次，App 模式 60–90 秒
- **日夜色調**：依台灣當下的太陽高度角，底圖在夜、晨昏、白晝之間緩慢變化，並顯示日出、日落時間
- **今日亮點**：目前出力最大的電廠、太陽能尖峰、綠能佔比最高、全台負載最高、南電北送量（推估），以及今日綠能曲線
- **資訊面板**：資料來源、準確度分級、關於與免責聲明
- **省電**：手機與桌布預設 30fps

網址參數：`?mode=wallpaper` 桌布模式、`?sim=1` 強制模擬、`?density=2` 粒子加倍、`?fps=60` 指定幀率

## 架構

```
src/
├─ config/   energy.js 色票、篩選、證據分級 │ geo.js 電廠、負載點、骨幹 │ app.js 版本、設計者、網址
├─ data/     parseGenary 解析台電 │ mockGenary 模擬 │ useGridData 抓取輪詢 │ useHighlights 今日亮點
├─ engine/   GridFlowEngine 主迴圈 │ ParticleSystem 粒子池 │ flowModel 重力模型 │ paths 流線
│            cruise 放空巡航 │ daylight 日夜色調 │ glowSprite 柔光貼圖
├─ map/      baseStyle 自建午夜底圖（內政部縣市界，離線可用）
└─ components/ Hud、Panels（亮點／資訊）、widgets
public/      PWA：manifest、sw.js、圖示
tools/       桌布伺服器（開機時由 VBS 在背景啟動）＋ deploy.yml（一鍵更新時複製到 .github/workflows）
```

## 為什麼程式會複製到 %LOCALAPPDATA%\TaiwanGridFlow 執行？

這個資料夾的路徑含有 `#`，而 Vite 不支援路徑中有 `#`。所以 bat 每次執行時，會把原始碼同步到沒有 `#` 的路徑再執行。請一律修改這裡（D 槽）的原始碼。

## 需要知道的事

- 「系統頻率」是模擬值，因為台電沒有公開即時頻率。
- 流向與南電北送量是用重力模型推估的，不是實際的輸電線潮流。
- 核三已在 2025 年 5 月停機，模擬資料把它設為 0 MW。
- 本作品為個人獨立作品，與台灣電力公司無關。
