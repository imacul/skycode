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

Write-Step "Checking requirements..."

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Step "Bun not found. Installing Bun..."
    irm https://bun.sh/install.ps1 | iex
    $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
}

Ensure-Command "bun" "Install Bun from https://bun.sh"
Ensure-Command "git" "Install Git for Windows, then run this installer again."

Write-Step "Installing SkyCode to $InstallRoot"

if (Test-Path (Join-Path $InstallRoot ".git")) {
    Push-Location $InstallRoot
    git fetch origin main
    git checkout main
    git pull --ff-only origin main
    Pop-Location
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

$shim = @"
@echo off
bun "%USERPROFILE%\.skycode\app\packages\cli\src\index.tsx" %*
"@

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
Write-Host "SkyCode checks for updates automatically. Use 'skycode update --auto' to opt into automatic installation." -ForegroundColor Gray