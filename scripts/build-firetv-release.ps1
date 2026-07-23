# Builds a standalone release APK sized for Fire TV / Android TV.
# Uses one Gradle worker and TV ABIs only to avoid Windows OOM during NDK/clang compiles.
param(
  [ValidateSet('armeabi-v7a', 'arm64-v8a', 'both')]
  [string]$Abi = 'both'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot 'android'
$localProps = Join-Path $androidDir 'local.properties'
$sdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk'

if (-not (Test-Path $localProps)) {
  $sdkForGradle = ($sdkPath -replace '\\', '/')
  "sdk.dir=$sdkForGradle" | Set-Content -Path $localProps -Encoding ASCII
  Write-Host "Wrote $localProps"
}

$arch = switch ($Abi) {
  'armeabi-v7a' { 'armeabi-v7a' }
  'arm64-v8a' { 'arm64-v8a' }
  default { 'armeabi-v7a,arm64-v8a' }
}

Write-Host "Building release APK for: $arch"
Write-Host "Tip: close Chrome/emulator first if clang reports out of memory."

Push-Location $androidDir
try {
  .\gradlew --stop | Out-Null
  .\gradlew assembleRelease `
    --no-daemon `
    --max-workers=1 `
    -PreactNativeArchitectures=$arch
} finally {
  Pop-Location
}

$apk = Join-Path $androidDir 'app\build\outputs\apk\release\app-release.apk'
if (Test-Path $apk) {
  Write-Host ""
  Write-Host "Success: $apk"
  Write-Host "Install: adb install -r `"$apk`""
} else {
  Write-Host "Build finished but APK not found at $apk" -ForegroundColor Yellow
  exit 1
}
