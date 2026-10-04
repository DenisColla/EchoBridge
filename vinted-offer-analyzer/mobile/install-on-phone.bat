@echo off
setlocal
cd /d "%~dp0"
title Offerta Vinted Timing - installazione sul telefono
set "APK=%~dp0dist\OffertaVintedTiming.apk"
if not exist "%APK%" (
  echo  APK non trovato in dist\. Esegui prima start.bat.
  pause
  exit /b 1
)
set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if defined ANDROID_HOME if exist "%ANDROID_HOME%\platform-tools\adb.exe" set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
if not exist "%ADB%" (
  echo  adb non trovato. Copia manualmente dist\OffertaVintedTiming.apk sul telefono e aprilo.
  pause
  exit /b 1
)
echo  Collega il telefono via USB con "Debug USB" attivo (Opzioni sviluppatore)
echo  e accetta la richiesta di autorizzazione sullo schermo del telefono.
echo.
"%ADB%" devices
echo.
"%ADB%" install -r "%APK%"
if errorlevel 1 (
  echo.
  echo  Installazione non riuscita. In alternativa copia l'APK sul telefono
  echo  ^(cavo, Drive, Telegram "messaggi salvati"^) e aprilo dal gestore file.
) else (
  echo.
  echo  Installata. Cerca "Offerta Vinted Timing" tra le app.
)
pause
