<#
  Offerta Vinted Timing - build locale dell'APK Android (Windows 10/11).
  Lanciato da start.bat. Idempotente: puoi rilanciarlo quante volte vuoi.

  Fasi:
    1. Node.js LTS            (winget: OpenJS.NodeJS.LTS)
    2. Java 17                (winget: Microsoft.OpenJDK.17)
    3. Android SDK            (command-line tools in %LOCALAPPDATA%\Android\Sdk + licenze + platform-tools)
    4. npm install + copia del motore condiviso
    5. expo prebuild          (genera la cartella android\)
    6. gradlew assembleRelease
    7. copia dell'APK in dist\OffertaVintedTiming.apk

  Opzioni: -SkipInstall (non tenta installazioni), -DebugApk (APK di debug, piu' veloce).
#>
param(
  [switch]$SkipInstall,
  [switch]$DebugApk
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $PSScriptRoot 'ultimo-build.log'
Start-Transcript -Path $LogFile -Force | Out-Null

function Write-Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user;$env:Path"
}
function Has-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Winget-Install($id, $label) {
  if ($SkipInstall) { throw "$label non trovato e -SkipInstall attivo." }
  if (-not (Has-Command 'winget')) { throw "$label non trovato e winget non disponibile. Installa $label a mano e rilancia start.bat." }
  Write-Host "    installo $label con winget (puo' chiedere conferma UAC)..."
  & winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "winget non e' riuscito a installare $label (codice $LASTEXITCODE). Installalo a mano e rilancia start.bat." }
  Refresh-Path
}

try {
  Set-Location $ProjectDir
  Write-Host "Cartella progetto: $ProjectDir"
  if ($ProjectDir -match '\s' -or $ProjectDir -match '[^\x00-\x7F]') {
    Write-Warn2 "Il percorso contiene spazi o accenti: la build Android a volte fallisce. Se succede, sposta la cartella in C:\OffertaVinted e rilancia."
  }
  if ($ProjectDir.Length -gt 60) {
    Write-Warn2 "Percorso lungo ($($ProjectDir.Length) caratteri): se Gradle si lamenta dei nomi file, sposta la cartella in C:\OffertaVinted."
  }

  # ---------- 1. Node.js ----------
  Write-Step "Node.js"
  Refresh-Path
  $nodeOk = $false
  if (Has-Command 'node') {
    $nodeVersion = (& node -v).TrimStart('v')
    if ([int]($nodeVersion.Split('.')[0]) -ge 20) { $nodeOk = $true; Write-Ok "Node.js $nodeVersion" }
    else { Write-Warn2 "Node.js $nodeVersion troppo vecchio (serve 20 o superiore)." }
  }
  if (-not $nodeOk) { Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js LTS'; if (-not (Has-Command 'node')) { throw "Node.js installato ma non ancora nel PATH: chiudi e riapri start.bat." }; Write-Ok ("Node.js " + (& node -v)) }

  # ---------- 2. Java 17 ----------
  Write-Step "Java 17 (JDK)"
  function Find-Jdk17 {
    $candidates = @()
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) { $candidates += $env:JAVA_HOME }
    $roots = @("$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Zulu", "$env:ProgramFiles\Android\Android Studio\jbr")
    foreach ($root in $roots) {
      if (Test-Path $root) {
        Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object { if (Test-Path (Join-Path $_.FullName 'bin\javac.exe')) { $candidates += $_.FullName } }
        if (Test-Path (Join-Path $root 'bin\javac.exe')) { $candidates += $root }
      }
    }
    foreach ($c in $candidates) {
      # Read the JDK "release" file instead of running java -version (which prints on stderr and would
      # become a terminating error under $ErrorActionPreference = 'Stop').
      $rel = Join-Path $c 'release'
      if ((Test-Path $rel) -and ((Get-Content $rel -Raw) -match 'JAVA_VERSION="(17|21)[."]')) { return $c }
    }
    return $null
  }
  $jdk = Find-Jdk17
  if (-not $jdk) { Winget-Install 'Microsoft.OpenJDK.17' 'Java 17 (Microsoft OpenJDK)'; $jdk = Find-Jdk17 }
  if (-not $jdk) { throw "Java 17 non trovato dopo l'installazione. Installa Microsoft OpenJDK 17 e rilancia." }
  $env:JAVA_HOME = $jdk
  $env:Path = "$jdk\bin;$env:Path"
  Write-Ok "JAVA_HOME = $jdk"

  # ---------- 3. Android SDK ----------
  Write-Step "Android SDK"
  $sdk = $env:ANDROID_HOME
  if (-not $sdk -or -not (Test-Path $sdk)) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $sdkManager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (-not (Test-Path $sdkManager)) {
    if ($SkipInstall) { throw "Android SDK non trovato in $sdk e -SkipInstall attivo." }
    Write-Host "    scarico gli Android command-line tools in $sdk ..."
    New-Item -ItemType Directory -Force -Path (Join-Path $sdk 'cmdline-tools') | Out-Null
    $zip = Join-Path $env:TEMP 'cmdline-tools.zip'
    $downloaded = $false
    foreach ($build in @('13114758', '12700392', '11076708')) {
      try {
        Invoke-WebRequest -Uri "https://dl.google.com/android/repository/commandlinetools-win-${build}_latest.zip" -OutFile $zip -UseBasicParsing
        $downloaded = $true; break
      } catch { Write-Warn2 "versione $build non disponibile, provo la successiva" }
    }
    if (-not $downloaded) { throw "Download degli Android command-line tools non riuscito. Controlla la connessione." }
    $tmpDir = Join-Path $env:TEMP 'cmdline-tools-extract'
    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmpDir -Force
    $latest = Join-Path $sdk 'cmdline-tools\latest'
    if (Test-Path $latest) { Remove-Item $latest -Recurse -Force }
    Move-Item (Join-Path $tmpDir 'cmdline-tools') $latest
    Remove-Item $zip -Force
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  $env:ANDROID_HOME = $sdk
  $env:ANDROID_SDK_ROOT = $sdk
  $env:Path = "$sdk\platform-tools;$sdk\cmdline-tools\latest\bin;$env:Path"
  Write-Host "    accetto le licenze e installo platform-tools, platform 36 e build-tools 36 (solo la prima volta)..."
  $yes = ("y`n" * 40)
  $yes | & $sdkManager --sdk_root="$sdk" --licenses | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "sdkmanager --licenses non riuscito (codice $LASTEXITCODE). Controlla Java e la connessione." }
  & $sdkManager --sdk_root="$sdk" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "sdkmanager non e' riuscito a installare i componenti Android (codice $LASTEXITCODE)." }
  Write-Ok "ANDROID_HOME = $sdk"

  # ---------- 4. Dipendenze ----------
  Write-Step "Dipendenze del progetto (npm install)"
  $env:CI = '1'
  $env:EXPO_NO_TELEMETRY = '1'
  & npm install --no-audit --no-fund | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm install non riuscito." }
  & node scripts\sync-core.mjs | Out-Host
  Write-Ok "dipendenze pronte"

  # ---------- 5. Prebuild ----------
  Write-Step "Generazione del progetto Android (expo prebuild)"
  & npx expo prebuild --platform android --clean | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "expo prebuild non riuscito." }
  if ($sdk -notmatch '[^\x00-\x7F]') {
    $sdkForProps = $sdk -replace '\\', '\\'
    Set-Content -Path (Join-Path $ProjectDir 'android\local.properties') -Value "sdk.dir=$sdkForProps" -Encoding ASCII
  }
  Write-Ok "cartella android\ generata"

  # ---------- 6. Gradle ----------
  $task = 'assembleRelease'
  $apkRel = 'app\build\outputs\apk\release\app-release.apk'
  if ($DebugApk) { $task = 'assembleDebug'; $apkRel = 'app\build\outputs\apk\debug\app-debug.apk' }
  Write-Step "Compilazione dell'APK (gradlew $task). La prima volta scarica Gradle e le librerie: 10-30 minuti."
  Push-Location (Join-Path $ProjectDir 'android')
  try {
    & .\gradlew.bat $task --no-daemon --console=plain | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Gradle ha restituito errore $LASTEXITCODE." }
  } finally { Pop-Location }

  # ---------- 7. Output ----------
  Write-Step "Copia dell'APK"
  $apk = Join-Path $ProjectDir ("android\" + $apkRel)
  if (-not (Test-Path $apk)) { throw "APK non trovato in $apk" }
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir 'dist') | Out-Null
  $dest = Join-Path $ProjectDir 'dist\OffertaVintedTiming.apk'
  Copy-Item $apk $dest -Force
  Write-Ok "APK pronto: $dest ($([math]::Round((Get-Item $dest).Length / 1MB, 1)) MB)"
  Write-Host ""
  Write-Host "Prossimo passo: copia l'APK sul telefono e aprilo (consenti 'app da origini sconosciute'),"
  Write-Host "oppure collega il telefono via USB con Debug USB attivo e lancia install-on-phone.bat."
  try { Invoke-Item (Join-Path $ProjectDir 'dist') } catch {}
  Stop-Transcript | Out-Null
  exit 0
} catch {
  Write-Host ""
  Write-Host "ERRORE: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log completo: $LogFile"
  Write-Host ""
  Write-Host "Soluzioni frequenti:" -ForegroundColor Yellow
  Write-Host " - Rilancia start.bat: molti errori di download si risolvono al secondo tentativo."
  Write-Host " - Sposta la cartella in C:\OffertaVinted (percorso corto, senza spazi o accenti)."
  Write-Host " - Se winget manca: installa Node.js LTS (nodejs.org) e Microsoft OpenJDK 17, poi rilancia."
  Write-Host " - In alternativa usa build-cloud.bat: la build avviene sui server di Expo."
  Stop-Transcript | Out-Null
  exit 1
}
