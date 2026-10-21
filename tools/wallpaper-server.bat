@echo off
rem Taiwan Grid Flow - wallpaper server (started hidden at login by TaiwanGridFlow-wallpaper.vbs)
cd /d "%~dp0.."
node node_modules\vite\bin\vite.js preview > "%~dp0..\wallpaper.log" 2>&1
