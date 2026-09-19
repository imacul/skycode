param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$UpdateArgs
)

$ErrorActionPreference = "Stop"

$InstallRoot = Join-Path $env:USERPROFILE ".skycode\app"
$BinDir = Join-Path $env:LOCALAPPDATA "SkyCode\bin"
$ShimPath = Join-Path $BinDir "skycode.cmd"
$UpdateSettingsFile = Join-Path $env:USERPROFILE ".skycode\update.json"
$RepoUrl = "https://github.com/imacul/skycode.git"
$RawPackageUrl = "https://raw.githubusercontent.com/imacul/skycode/main/package.json"

function Write-Step($message) {
    Write-Host "[SkyCode] $message" -ForegroundColor Cyan
}

function Require-Command($name, $helpText) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name is required. $helpText"
    }
}

function Get-LocalVersion {
    $packagePath = Join-Path $InstallRoot "package.json"
    if (-not (Test-Path $packagePath)) { return "unknown" }

    try {
        return [string]((Get-Content $packagePath -Raw | ConvertFrom-Json).version)
    }
    catch {
        return "unknown"
    }
}

function Get-RemoteVersion {
    try {
        $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $pkg = Invoke-RestMethod "$RawPackageUrl?ts=$stamp" -Headers @{ "Cache-Control" = "no-cache" }
        if ($pkg.version) { return [string]$pkg.version }
    }
    catch {
        return "unknown"
    }

    return "unknown"
}

function Set-AutoUpdate([bool]$enabled) {
    $parent = Split-Path $UpdateSettingsFile -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    @{ autoUpdate = $enabled } |
        ConvertTo-Json |
        Set-Content -Path $UpdateSettingsFile -Encoding UTF8
}

function Ensure-CompatibleBun {
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Step "Bun not found. Installing Bun..."
        Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
        $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
    }

    Require-Command "bun" "Install Bun from https://bun.sh"

    $minimum = [version]"1.4.0"
    $installed = [version]((bun --version).Trim())

    if ($installed -lt $minimum) {
        Write-Step "Bun $installed is too old. Upgrading Bun..."
        bun upgrade
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to upgrade Bun."
        }

        $installed = [version]((bun --version).Trim())
        if ($installed -lt $minimum) {
            throw "Bun $installed is still too old. SkyCode requires Bun 1.4.0 or newer."
        }
    }
}

function Write-BootstrapShim {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    $shim = @"
@echo off
setlocal

if /I "%~1"=="update" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.skycode\app\update.ps1" %*
  exit /b %ERRORLEVEL%
)

if /I "%~1"=="-v" goto :version
if /I "%~1"=="--version" goto :version
if /I "%~1"=="version" goto :version

bun "%USERPROFILE%\.skycode\app\packages\cli\src\index.tsx" %*
exit /b %ERRORLEVEL%

:version
powershell.exe -NoProfile -Command "$p = Join-Path $env:USERPROFILE '.skycode\app\package.json'; if (Test-Path $p) { $v = (Get-Content $p -Raw | ConvertFrom-Json).version; Write-Output ('SkyCode v' + $v) } else { Write-Output 'SkyCode version unknown' }"
exit /b %ERRORLEVEL%
"@

    Set-Content -Path $ShimPath -Value $shim -Encoding ASCII
}

$cleanArgs = @($UpdateArgs | Where-Object { $_ -and $_.ToLowerInvariant() -ne "update" })
$flags = @{}
foreach ($arg in $cleanArgs) {
    $flags[$arg.ToLowerInvariant()] = $true
}

if ($flags.ContainsKey("--no-auto")) {
    Set-AutoUpdate $false
    Write-Host "Automatic SkyCode updates disabled."
    exit 0
}

if ($flags.ContainsKey("--auto")) {
    Set-AutoUpdate $true
    Write-Host "Automatic SkyCode updates enabled."
}

Require-Command "git" "Install Git for Windows, then retry."

if ($flags.ContainsKey("--check")) {
    try {
        if (-not (Test-Path (Join-Path $InstallRoot ".git"))) {
            Write-Host "SkyCode managed install is missing or incomplete."
            Write-Host "Run the official installer once to repair it."
            exit 1
        }

        $currentSha = (git -C $InstallRoot rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Could not read the installed SkyCode revision." }

        $remoteLine = (git ls-remote $RepoUrl refs/heads/main).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $remoteLine) {
            throw "Could not reach the SkyCode repository."
        }

        $remoteSha = ($remoteLine -split "\s+")[0]
        $localVersion = Get-LocalVersion
        $remoteVersion = Get-RemoteVersion

        if ($currentSha -eq $remoteSha) {
            Write-Host "SkyCode v$localVersion is up to date."
            exit 0
        }

        $label = if ($remoteVersion -ne "unknown") { "v$remoteVersion" } else { $remoteSha.Substring(0, 7) }
        Write-Host "SkyCode update available: $label"
        Write-Host "Run 'skycode update' to install it."
        exit 0
    }
    catch {
        Write-Host "Could not check for updates: $($_.Exception.Message)"
        exit 1
    }
}

try {
    Ensure-CompatibleBun

    $parent = Split-Path $InstallRoot -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null

    if (Test-Path (Join-Path $InstallRoot ".git")) {
        Write-Step "Fetching the latest SkyCode..."
        git -C $InstallRoot fetch origin main
        if ($LASTEXITCODE -ne 0) { throw "Failed to fetch SkyCode updates from GitHub." }

        git -C $InstallRoot checkout main
        if ($LASTEXITCODE -ne 0) { throw "Failed to switch the managed install to main." }

        # The managed install is disposable application code. A hard reset is
        # intentional so a broken source file can always be repaired.
        git -C $InstallRoot reset --hard origin/main
        if ($LASTEXITCODE -ne 0) { throw "Failed to synchronize with origin/main." }
    }
    else {
        Write-Step "Managed install is missing. Recreating it..."
        if (Test-Path $InstallRoot) {
            Remove-Item -Recurse -Force $InstallRoot
        }
        git clone $RepoUrl $InstallRoot
        if ($LASTEXITCODE -ne 0) { throw "Failed to clone SkyCode." }
    }

    Write-Step "Installing dependencies..."
    Push-Location $InstallRoot
    try {
        bun install
        if ($LASTEXITCODE -ne 0) { throw "bun install failed." }
    }
    finally {
        Pop-Location
    }

    # Keep the bootstrap command independent from application parsing. This is
    # what lets future 'skycode update' commands repair a broken release.
    Write-BootstrapShim

    $version = Get-LocalVersion
    Write-Host "SkyCode updated successfully." -ForegroundColor Green
    Write-Host "Current version: v$version"
    exit 0
}
catch {
    Write-Host "SkyCode update failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
