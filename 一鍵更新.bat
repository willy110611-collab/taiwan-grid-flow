@echo off
chcp 65001 >nul
title 台灣光脈搏 一鍵更新
setlocal
set "SRC=%~dp0"
set "RUN=%LOCALAPPDATA%\TaiwanGridFlow"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "WP_URL=http://127.0.0.1:5180/?mode=wallpaper"

set "REPO=https://github.com/willy110611-collab/taiwan-grid-flow.git"
set "PAGES=https://willy110611-collab.github.io/taiwan-grid-flow/"
cd /d "%SRC%"

rem ---- 找 git：先找系統安裝的，再找 GitHub Desktop 內建的 ----
set "GIT=git"
where git >nul 2>nul
if errorlevel 1 (
  set "GIT="
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
  )
)
if "%GIT%"=="" (
  echo [錯誤] 找不到 git。請安裝 Git for Windows：https://git-scm.com/download/win
  pause
  exit /b 1
)

echo.
echo ===== 台灣光脈搏 一鍵更新 =====
echo.

rem ---- GitHub Pages 自動部署設定（從 tools 複製到 .github\workflows） ----
if not exist ".github\workflows" mkdir ".github\workflows"
copy /y "tools\deploy.yml" ".github\workflows\deploy.yml" >nul

rem ---- 第一次使用：建立本機儲存庫並連到 GitHub ----
if not exist ".git" (
  echo 第一次使用，建立 git 儲存庫...
  "%GIT%" init -q
  "%GIT%" checkout -q -b main
  "%GIT%" remote add origin %REPO%
)
"%GIT%" config user.email >nul 2>nul || (
  "%GIT%" config user.name "無聊的人"
  "%GIT%" config user.email "willy110611-collab@users.noreply.github.com"
)

"%GIT%" add -A
"%GIT%" diff --cached --quiet
if not errorlevel 1 (
  echo 沒有新的程式碼變更。
  goto WALLPAPER
)

for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set "D=%%a-%%b-%%c"
"%GIT%" commit -q -m "更新 %D% %time:~0,5%"
if errorlevel 1 (
  echo [錯誤] Commit 失敗。
  pause
  exit /b 1
)

echo 正在上傳到 GitHub...
"%GIT%" push -u origin main
if errorlevel 1 (
  echo.
  echo [錯誤] 上傳失敗。第一次使用請先完成：
  echo   1. 到 https://github.com/new 建立名為 taiwan-grid-flow 的儲存庫（Public，不要勾任何初始檔案）
  echo   2. 儲存庫 Settings → Pages → Source 選「GitHub Actions」
  echo   3. 重新執行這個檔案，跳出瀏覽器時登入 GitHub 一次即可
  pause
  exit /b 1
)
echo.
echo 手機版：約 2 分鐘後網址會變成新版
echo %PAGES%

:WALLPAPER
rem ---- 若有設定桌布，順便更新本機桌布 ----
if not exist "%STARTUP%\TaiwanGridFlow-wallpaper.vbs" goto DONE
echo.
echo 更新桌面即時背景...
rem ---------- 同步程式碼到執行資料夾（Vite 不支援路徑含 # 字元） ----------
robocopy "%SRC%." "%RUN%" /MIR /XD node_modules dist .vite .git /XF "preview-*.png" "*.bat" /NFL /NDL /NJH /NJS /NP >nul
if %errorlevel% geq 8 (
  echo  [X] 複製程式碼失敗。
  pause
  exit /b 1
)
copy /y "%SRC%tools\*.*" "%RUN%\tools\" >nul 2>nul
cd /d "%RUN%"

call npm install --no-audit --no-fund --loglevel=error
call npm run build
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vite.+preview' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

wscript "%STARTUP%\TaiwanGridFlow-wallpaper.vbs"
echo 桌布已更新（Lively 會在幾秒內重新載入；若沒有，在 Lively 裡重新套用一次）。

:DONE
echo.
pause
