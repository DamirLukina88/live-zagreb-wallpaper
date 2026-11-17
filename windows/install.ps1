# Live Zagreb Wallpaper - Windows Installer (bundles Lively Wallpaper setup + wallpaper import)
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ZipPath = Join-Path $ScriptDir "skill-issue-wallpaper-lively.zip"
# From a git clone the package is built into dist\ (npm run build)
if (-not (Test-Path $ZipPath)) {
    $ZipPath = Join-Path (Split-Path -Parent $ScriptDir) "dist\skill-issue-wallpaper-lively.zip"
}

if (-not (Test-Path $ZipPath)) {
    Write-Host "ERROR: Missing $ZipPath" -ForegroundColor Red
    exit 1
}

function Find-LivelyExe {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Lively Wallpaper\Lively.exe"),
        (Join-Path $env:ProgramFiles "Lively Wallpaper\Lively.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Lively Wallpaper\Lively.exe")
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    $cmd = Get-Command "Lively.exe" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

Write-Host "=== Live Zagreb Wallpaper Setup ===" -ForegroundColor Cyan

$LivelyExe = Find-LivelyExe
if (-not $LivelyExe) {
    Write-Host "Lively Wallpaper not found. Installing via winget..." -ForegroundColor Yellow
    $winget = Get-Command "winget" -ErrorAction SilentlyContinue
    if ($winget) {
        winget install --id rocksdanister.LivelyWallpaper -e --silent --accept-package-agreements --accept-source-agreements
        Start-Sleep -Seconds 3
        $LivelyExe = Find-LivelyExe
    }
    if (-not $LivelyExe) {
        Write-Host "Could not auto-install Lively Wallpaper. Opening download page..." -ForegroundColor Yellow
        Start-Process "https://github.com/rocksdanister/lively/releases/latest"
        Write-Host "Install Lively Wallpaper, then re-run Setup-Live-Zagreb-Wallpaper.bat." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Found Lively Wallpaper: $LivelyExe" -ForegroundColor Green

# Ensure Lively is running before importing
$proc = Get-Process -Name "Lively" -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "Starting Lively Wallpaper..."
    Start-Process -FilePath $LivelyExe
    Start-Sleep -Seconds 4
}

# Import and apply the wallpaper package
Write-Host "Importing Live Zagreb Wallpaper..." -ForegroundColor Cyan
Start-Process -FilePath $LivelyExe -ArgumentList "setwp --file `"$ZipPath`""

Write-Host ""
Write-Host "Done! If Lively asks to confirm importing the wallpaper, click OK." -ForegroundColor Green
Write-Host "Updating from an older version: the new package is imported as a new entry." -ForegroundColor Yellow
Write-Host "In Lively's library, right-click the old 'Skill Issue: Zagreb Weather' entry and delete it." -ForegroundColor Yellow
Write-Host "To change City, Language, Quality or the span layout: right-click the wallpaper in Lively -> Customise." -ForegroundColor Gray
