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
        $pkg = Invoke-RestMethod "${RawPackageUrl}?ts=$stamp" -Headers @{ "Cache-Control" = "no-cache" }
        if ($pkg.version) { return [string]$pkg.version }
    }
    catch {
        return "unknown"
    }

    return "unknown"
}

function Get-UpdateSettings {
    try {
        if (-not (Test-Path $UpdateSettingsFile)) {
            return [ordered]@{ autoUpdate = $false }
        }

        $parsed = Get-Content $UpdateSettingsFile -Raw | ConvertFrom-Json
        $settings = [ordered]@{ autoUpdate = ($parsed.autoUpdate -eq $true) }

        foreach ($name in @("lastCheckAt", "lastCheckResult", "lastUpdateAt", "lastVersion", "lastUpdateMode")) {
            if ($null -ne $parsed.$name) {
                $settings[$name] = [string]$parsed.$name
            }
        }

        return $settings
    }
    catch {
        return [ordered]@{ autoUpdate = $false }
    }
}

function Save-UpdateSettings($settings) {
    $parent = Split-Path $UpdateSettingsFile -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $settings |
        ConvertTo-Json |
        Set-Content -Path $UpdateSettingsFile -Encoding UTF8
}

function Set-AutoUpdate([bool]$enabled) {
    $settings = Get-UpdateSettings
    $settings.autoUpdate = $enabled
    Save-UpdateSettings $settings
}

function Get-AutoUpdate {
    $settings = Get-UpdateSettings
    return $settings.autoUpdate -eq $true
}

function Record-UpdateCheck([string]$result) {
    $settings = Get-UpdateSettings
    $settings.lastCheckAt = [DateTimeOffset]::UtcNow.ToString("o")
    $settings.lastCheckResult = $result
    Save-UpdateSettings $settings
}

function Record-UpdateSuccess([string]$version, [string]$mode) {
    $settings = Get-UpdateSettings
    $settings.lastUpdateAt = [DateTimeOffset]::UtcNow.ToString("o")
    $settings.lastVersion = $version
    $settings.lastUpdateMode = $mode
    $settings.lastCheckAt = [DateTimeOffset]::UtcNow.ToString("o")
    $settings.lastCheckResult = "updated"
    Save-UpdateSettings $settings
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
}

$cleanArgs = @($UpdateArgs | Where-Object { $_ -and $_.ToLowerInvariant() -ne "update" })
$flags = @{}
foreach ($arg in $cleanArgs) {
    $flags[$arg.ToLowerInvariant()] = $true
}

if ($flags.ContainsKey("--finalize")) {
    Write-BootstrapShim
    $version = Get-LocalVersion
    $mode = if ($flags.ContainsKey("--automatic")) { "automatic" } else { "manual" }
    Record-UpdateSuccess $version $mode
    exit 0
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

if ($flags.ContainsKey("--status")) {
    $settings = Get-UpdateSettings
    $state = if ($settings.autoUpdate -eq $true) { "enabled" } else { "disabled" }
    $lastCheckAt = if ($settings.Contains("lastCheckAt")) { $settings.lastCheckAt } else { "never" }
    $lastCheckResult = if ($settings.Contains("lastCheckResult")) { $settings.lastCheckResult } else { "unknown" }
    $lastUpdateAt = if ($settings.Contains("lastUpdateAt")) { $settings.lastUpdateAt } else { "never" }
    $lastVersion = if ($settings.Contains("lastVersion")) { $settings.lastVersion } else { "unknown" }
    $lastUpdateMode = if ($settings.Contains("lastUpdateMode")) { $settings.lastUpdateMode } else { "unknown" }

    Write-Host "Automatic updates: $state"
    Write-Host "Installed version: v$(Get-LocalVersion)"
    Write-Host "Last check: $lastCheckAt"
    Write-Host "Last check result: $lastCheckResult"
    Write-Host "Last successful update: $lastUpdateAt"
    Write-Host "Last updated version: $lastVersion"
    Write-Host "Last update mode: $lastUpdateMode"
    exit 0
}


Require-Command "git" "Install Git for Windows, then retry."

if ($flags.ContainsKey("--startup")) {
    if (-not (Get-AutoUpdate)) {
        exit 0
    }

    try {
        if (-not (Test-Path (Join-Path $InstallRoot ".git"))) {
            exit 0
        }

        $currentSha = (git -C $InstallRoot rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { exit 0 }

        $remoteLine = (git ls-remote $RepoUrl refs/heads/main).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $remoteLine) { exit 0 }

        $remoteSha = ($remoteLine -split "\s+")[0]
        if ($currentSha -eq $remoteSha) {
            Record-UpdateCheck "up-to-date"
            exit 0
        }

        Record-UpdateCheck "update-available"

        $remoteVersion = Get-RemoteVersion
        $label = if ($remoteVersion -ne "unknown") { "v$remoteVersion" } else { $remoteSha.Substring(0, 7) }
        Write-Step "Automatic update found: $label"
        # Fall through into the normal repair/update path below.
    }
    catch {
        # Startup checks must never prevent SkyCode from opening while offline
        # or when the remote cannot be reached.
        exit 0
    }
}

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
            Record-UpdateCheck "up-to-date"
            Write-Host "SkyCode v$localVersion is up to date."
            exit 0
        }

        Record-UpdateCheck "update-available"

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

    # Re-enter the updater from disk after the reset. The file at this path is
    # now the NEW release's updater, so it rewrites the shim using the latest
    # bootstrap logic instead of the updater version that started this process.
    $modeFlag = if ($flags.ContainsKey("--startup")) { "--automatic" } else { "--manual" }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "update.ps1") --finalize $modeFlag
    if ($LASTEXITCODE -ne 0) {
        throw "The updated SkyCode files were installed, but bootstrap finalization failed."
    }

    $version = Get-LocalVersion
    Write-Host "SkyCode updated successfully." -ForegroundColor Green
    Write-Host "Current version: v$version"
    exit 0
}
catch {
    Write-Host "SkyCode update failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
