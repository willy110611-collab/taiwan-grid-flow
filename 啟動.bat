@echo off
chcp 65001 >nul
title 台灣光脈搏 Taiwan Grid Flow
setlocal
set "SRC=%~dp0"
set "RUN=%LOCALAPPDATA%\TaiwanGridFlow"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "WP_URL=http://127.0.0.1:5180/?mode=wallpaper"

echo.
echo  ==========================================
echo     台灣光脈搏  Taiwan Grid Flow  啟動器
echo  ==========================================
echo.
rem ---------- 檢查 Node.js（沒有就用 winget 自動安裝） ----------
where node >nul 2>nul
if %errorlevel%==0 goto HAS_NODE
echo  尚未安裝 Node.js，嘗試用 winget 自動安裝 LTS 版...
echo  若跳出「是否允許變更」視窗，請按「是」。
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
where node >nul 2>nul
if %errorlevel%==0 goto HAS_NODE
echo.
echo  [X] 自動安裝 Node.js 失敗，即將打開 nodejs.org，請下載 LTS 版安裝後再執行一次。
start https://nodejs.org
pause
exit /b 1
:HAS_NODE

for /f "delims=" %%v in ('node -v') do echo  [1/4] Node.js 已安裝：%%v
echo  [2/4] 同步程式碼到 %RUN%
rem ---------- 同步程式碼到執行資料夾（Vite 不支援路徑含 # 字元） ----------
robocopy "%SRC%." "%RUN%" /MIR /XD node_modules dist .vite .git /XF "preview-*.png" "*.bat" /NFL /NDL /NJH /NJS /NP >nul
if %errorlevel% geq 8 (
  echo  [X] 複製程式碼失敗。
  pause
  exit /b 1
)
copy /y "%SRC%tools\*.*" "%RUN%\tools\" >nul 2>nul
cd /d "%RUN%"

echo  [3/4] 檢查專案套件（第一次約 1-2 分鐘）...
call npm install --no-audit --no-fund --loglevel=error
if %errorlevel% neq 0 (
  echo  [X] npm install 失敗，請把上面的紅字訊息截圖給 Claude。
  pause
  exit /b 1
)
echo  [4/4] 啟動中... 瀏覽器會自動打開 http://localhost:5173
echo        看地圖時請不要關閉這個視窗；要結束請直接關閉。
echo.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:5173"
call npm run dev
pause
