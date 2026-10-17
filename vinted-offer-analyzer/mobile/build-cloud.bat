@echo off
setlocal
cd /d "%~dp0"
title Offerta Vinted Timing - build nel cloud (EAS)
echo  Alternativa senza Android SDK sul PC: la build avviene sui server di Expo.
echo  Serve un account gratuito su https://expo.dev (ti verra' chiesto di accedere).
echo.
where node >nul 2>nul || (echo  Installa prima Node.js LTS da https://nodejs.org & pause & exit /b 1)
call npm install --no-audit --no-fund || (pause & exit /b 1)
call node scripts\sync-core.mjs
set EAS_NO_VCS=1
call npx eas-cli@latest build --platform android --profile apk
echo.
echo  Al termine EAS mostra un link: da li' scarichi l'APK sul telefono.
pause
