@echo off
setlocal
cd /d "%~dp0"
title Offerta Vinted Timing - creazione APK
echo.
echo  ============================================================
echo   Offerta Vinted Timing - creazione dell'APK Android
echo  ============================================================
echo.
echo  Questo script installa i prerequisiti mancanti (Node.js, Java 17,
echo  Android SDK), prepara il progetto e genera l'APK in dist\.
echo  La prima volta scarica circa 3 GB: servono connessione e pazienza.
echo.
where powershell >nul 2>nul
if errorlevel 1 (
  echo  PowerShell non trovato: serve Windows 10 o 11.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-apk.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
if "%EXITCODE%"=="0" (
  echo  Fatto. L'APK e' nella cartella dist\ ^(OffertaVintedTiming.apk^).
) else (
  echo  La creazione si e' fermata con errore %EXITCODE%. Leggi i messaggi qui sopra
  echo  oppure il file tools\ultimo-build.log.
)
echo.
pause
exit /b %EXITCODE%
