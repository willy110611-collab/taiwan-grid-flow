@echo off
chcp 65001 >nul
title 台灣光脈搏 解除桌布
setlocal
set "SRC=%~dp0"
set "RUN=%LOCALAPPDATA%\TaiwanGridFlow"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "WP_URL=http://127.0.0.1:5180/?mode=wallpaper"

del "%STARTUP%\TaiwanGridFlow-wallpaper.vbs" >nul 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vite.+preview' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

echo  已關閉桌布伺服器並取消開機自動啟動。
echo  記得在 Lively Wallpaper 裡把桌布換掉。
pause
