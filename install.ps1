# SkyCode installer for Windows PowerShell
# Usage:
#   irm https://raw.githubusercontent.com/imacul/skycode/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$InstallRoot = Join-Path $env:USERPROFILE ".skycode\app"
$BinDir = Join-Path $env:LOCALAPPDATA "SkyCode\bin"
$ShimPath = Join-Path $BinDir "skycode.cmd"
$Repo = "https://github.com/imacul/skycode.git"

function Write-Step($message) {
    Write-Host "[SkyCode] $message" -ForegroundColor Cyan
}

function Ensure-Command($name, $helpText) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name is required. $helpText"
    }
}

Write-Step "Installer v1.2.0"
Write-Step "Checking requirements..."

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Step "Bun not found. Installing Bun..."
    irm https://bun.sh/install.ps1 | iex
    $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
}

Ensure-Command "bun" "Install Bun from https://bun.sh"
Ensure-Command "git" "Install Git for Windows, then run this installer again."

$MinimumBunVersion = [version]"1.4.0"
$InstalledBunVersion = [version]((bun --version).Trim())
if ($InstalledBunVersion -lt $MinimumBunVersion) {
    Write-Step "Bun $InstalledBunVersion is too old for SkyCode. Upgrading Bun..."
    bun upgrade
    if ($LASTEXITCODE -ne 0) { throw "Failed to upgrade Bun to a compatible version." }
    $InstalledBunVersion = [version]((bun --version).Trim())
}
Write-Step "Using Bun $InstalledBunVersion"

Write-Step "Installing SkyCode to $InstallRoot"

if (Test-Path (Join-Path $InstallRoot ".git")) {
    Push-Location $InstallRoot
    try {
        git fetch origin main
        if ($LASTEXITCODE -ne 0) { throw "Failed to fetch SkyCode updates from GitHub." }

        git checkout main
        if ($LASTEXITCODE -ne 0) { throw "Failed to switch the managed SkyCode install to main." }

        # This directory is fully managed by the installer. Resetting avoids
        # failures when upstream history has been rewritten or the install has
        # generated files such as bun.lock.
        git reset --hard origin/main
        if ($LASTEXITCODE -ne 0) { throw "Failed to synchronize SkyCode with origin/main." }
    }
    finally {
        Pop-Location
    }
} else {
    $parent = Split-Path $InstallRoot -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
    git clone $Repo $InstallRoot
}

Push-Location $InstallRoot
Write-Step "Installing dependencies..."
bun install
Pop-Location

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$shim = @'
@echo off
setlocal

if /I "%~1"=="update" goto :update
if /I "%~1"=="-v" goto :version
if /I "%~1"=="--version" goto :version
if /I "%~1"=="version" goto :version

if exist "%USERPROFILE%\.skycode\app\update.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.skycode\app\update.ps1" --startup
)

bun "%USERPROFILE%\.skycode\app\packages\cli\src\index.tsx" %*
exit /b %ERRORLEVEL%

:update
if exist "%USERPROFILE%\.skycode\app\update.ps1" goto :localupdate
goto :repair

:localupdate
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.skycode\app\update.ps1" %*
exit /b %ERRORLEVEL%

:repair
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$u = 'https://raw.githubusercontent.com/imacul/skycode/main/install.ps1?ts=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); irm $u | iex"
exit /b %ERRORLEVEL%

:version
powershell.exe -NoProfile -Command "$p = Join-Path $env:USERPROFILE '.skycode\app\package.json'; if (Test-Path $p) { $v = (Get-Content $p -Raw | ConvertFrom-Json).version; Write-Output ('SkyCode v' + $v) } else { Write-Output 'SkyCode version unknown' }"
exit /b %ERRORLEVEL%
'@

Set-Content -Path $ShimPath -Value $shim -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathParts = @()
if ($userPath) { $pathParts = $userPath.Split(";") | Where-Object { $_ } }

if ($pathParts -notcontains $BinDir) {
    $newPath = if ($userPath) { "$userPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
}

if (($env:Path.Split(";")) -notcontains $BinDir) { $env:Path = "$env:Path;$BinDir" }

Write-Host ""
Write-Host "SkyCode installed successfully." -ForegroundColor Green
Write-Host "Run:" -ForegroundColor Gray
Write-Host "  skycode" -ForegroundColor White
Write-Host "  skycode resume" -ForegroundColor White
Write-Host "  skycode update" -ForegroundColor White
Write-Host ""
Write-Host "The update/version commands are bootstrap-safe and do not load the SkyCode app, so they can repair a broken release." -ForegroundColor Gray
Write-Host "SkyCode checks for updates automatically. Use 'skycode update --auto' to opt into automatic installation." -ForegroundColor Gray