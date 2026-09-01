<#PSScriptInfo
.VERSION 1.0
.GUID 00000000-0000-0000-0000-000000000000
.AUTHOR Imacul
.DESCRIPTION Sky Code installer for Windows PowerShell
#>

# Sky Code - Windows PowerShell Installer
# Run this to install and start Sky Code on Windows

param()

# Colors
$RED = "\e[0;31m"
$GREEN = "\e[0;32m"
$YELLOW = "\e[1;33m"
$BLUE = "\e[0;34m"
$NC = "\e[0m"

# Check if running as admin (not required, but check)
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "$YELLOW⚠️  Not running as administrator (not required)$NC" -ForegroundColor Yellow
}

# Function to check if Bun is installed
function Test-BunInstalled {
    try {
        $bunPath = (Get-Command bun -ErrorAction SilentlyContinue).Source
        return $bunPath -ne $null
    } catch {
        return $false
    }
}

# Function to install Bun
function Install-Bun {
    Write-Host "$YELLOW⚠️  Bun not found. Installing Bun...$NC" -ForegroundColor Yellow
    
    try {
        # Download Bun installer
        $bunInstaller = "$env:TEMP\bun-installer.ps1"
        Invoke-WebRequest -Uri "https://bun.sh/install.ps1" -OutFile $bunInstaller -UseBasicParsing
        
        # Run Bun installer
        & $bunInstaller
        
        # Add Bun to PATH for current session
        $env:Path += ";$env:USERPROFILE\.bun\bin"
        
        Write-Host "$GREEN✅ Bun installed!$NC" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "$RED❌ Failed to install Bun: $_$NC" -ForegroundColor Red
        return $false
    }
}

# Function to check if Git is installed
function Test-GitInstalled {
    try {
        $gitPath = (Get-Command git -ErrorAction SilentlyContinue).Source
        return $gitPath -ne $null
    } catch {
        return $false
    }
}

# Function to install Git
function Install-Git {
    Write-Host "$YELLOW⚠️  Git not found. Installing Git...$NC" -ForegroundColor Yellow
    
    try {
        # Download Git installer
        $gitInstaller = "$env:TEMP\git-installer.exe"
        Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.45.1.windows.1/Git-2.45.1-64-bit.exe" -OutFile $gitInstaller -UseBasicParsing
        
        # Run Git installer silently
        Start-Process -FilePath $gitInstaller -ArgumentList "/SILENT" -Wait
        
        # Add Git to PATH for current session
        $env:Path += ";C:\Program Files\Git\bin"
        
        Write-Host "$GREEN✅ Git installed!$NC" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "$RED❌ Failed to install Git: $_$NC" -ForegroundColor Red
        return $false
    }
}

# Function to install Sky Code
function Install-SkyCode {
    Write-Host "$BLUE🚀 Installing Sky Code...$NC" -ForegroundColor Cyan
    
    # Check if skycode directory exists
    if (Test-Path -Path "skycode") {
        Write-Host "$YELLOW⚠️  skycode directory exists. Updating...$NC" -ForegroundColor Yellow
        Set-Location skycode
        git pull origin main
    } else {
        # Clone repo
        git clone https://github.com/imacul/skycode.git
        Set-Location skycode
    }
    
    # Install dependencies
    Write-Host "$BLUE📦 Installing dependencies...$NC" -ForegroundColor Cyan
    bun install
    
    Write-Host "$GREEN✅ Sky Code installed!$NC" -ForegroundColor Green
}

# Function to run Sky Code
function Run-SkyCode {
    Write-Host "`n$GREEN🎉 Starting Sky Code...$NC" -ForegroundColor Green
    Write-Host "$YELLOW💡 Tip: Use /help for commands, /setup to configure API keys$NC" -ForegroundColor Yellow
    Write-Host "`n" -ForegroundColor Green
    
    # Run Sky Code
    bun run dev:cli
}

# Main function
function Main {
    Write-Host "$BLUE
  🌌 Sky Code - AI Agent Harness$NC" -ForegroundColor Cyan
    Write-Host "$BLUE  ===============================$NC" -ForegroundColor Cyan
    Write-Host "$YELLOW Installing to current directory...$NC`n" -ForegroundColor Yellow
    
    # Check and install Bun
    if (-NOT (Test-BunInstalled)) {
        if (-NOT (Install-Bun)) {
            exit 1
        }
    }
    
    # Check and install Git
    if (-NOT (Test-GitInstalled)) {
        if (-NOT (Install-Git)) {
            exit 1
        }
    }
    
    # Install Sky Code
    Install-SkyCode
    
    # Run Sky Code
    Run-SkyCode
}

# Check for --help or -h
if ($args -contains "--help" -or $args -contains "-h") {
    Write-Host "Usage: .\install.ps1 [options]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  --help, -h    Show this help message" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Quick Start:" -ForegroundColor Cyan
    Write-Host "  .\install.ps1" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Or use:" -ForegroundColor Cyan
    Write-Host "  irm https://raw.githubusercontent.com/imacul/skycode/main/install.ps1 | iex" -ForegroundColor Gray
    exit 0
}

# Run main
Main
