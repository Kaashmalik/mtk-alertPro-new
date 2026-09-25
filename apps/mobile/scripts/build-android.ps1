# MTK AlertPro Android Build Script
# This script works around pnpm monorepo symlink issues with EAS Build

param(
    [string]$Profile = "preview",
    [switch]$ClearCache,
    [switch]$LocalGradle
)

# Continue on non-critical errors (like npm warnings)
$ErrorActionPreference = "Continue"
$SourceDir = $PSScriptRoot | Split-Path -Parent

Write-Host "[BUILD] MTK AlertPro Android Build" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Source: $SourceDir"
Write-Host "Profile: $Profile"
Write-Host "Local Gradle: $LocalGradle"
Write-Host ""

if ($LocalGradle) {
    Write-Host "[LOCAL] Building APK locally using Gradle..." -ForegroundColor Yellow
    Push-Location "$SourceDir\android"
    try {
        if ($Profile -eq "production") {
            & .\gradlew.bat assembleRelease --no-daemon
        } else {
            & .\gradlew.bat assembleDebug --no-daemon
        }
        $buildExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    
    if ($buildExitCode -eq 0) {
        $apkPath = if ($Profile -eq "production") {
            "$SourceDir\android\app\build\outputs\apk\release\app-release.apk"
        } else {
            "$SourceDir\android\app\build\outputs\apk\debug\app-debug.apk"
        }
        Write-Host ""
        Write-Host "[SUCCESS] Local APK built successfully at: $apkPath" -ForegroundColor Green
        exit 0
    } else {
        Write-Host ""
        Write-Host "[FAILED] Gradle build failed with exit code: $buildExitCode" -ForegroundColor Red
        exit $buildExitCode
    }
}

$BuildDir = "C:\Temp\mtk-build-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Write-Host "Build Dir: $BuildDir"

# Step 1: Create isolated build directory
Write-Host "[1/6] Creating isolated build directory..." -ForegroundColor Yellow
if (Test-Path $BuildDir) {
    Remove-Item -Recurse -Force $BuildDir
}
New-Item -ItemType Directory -Path $BuildDir | Out-Null

# Step 2: Copy source files (excluding node_modules, .expo, etc.)
Write-Host "[2/6] Copying source files..." -ForegroundColor Yellow
$excludes = @("node_modules", ".expo", ".expo-shared", "ios", "android", "dist", "build", ".git", ".npmrc", ".easignore")
Get-ChildItem -Path $SourceDir | Where-Object { $excludes -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $BuildDir -Recurse -Force
}
Write-Host "      Copied $(Get-ChildItem $BuildDir -Recurse -File | Measure-Object | Select-Object -ExpandProperty Count) files"

# Step 3: Install dependencies with npm
Write-Host "[3/6] Installing dependencies with npm..." -ForegroundColor Yellow
Push-Location $BuildDir
try {
    # Create clean .npmrc for npm
    "legacy-peer-deps=true" | Set-Content .npmrc -Encoding ASCII
    
    # Run npm install (ignore warnings)
    $env:npm_config_loglevel = "error"
    npm install --legacy-peer-deps 2>&1 | Where-Object { $_ -notmatch "warn" }
    Write-Host "      Dependencies installed successfully"
} finally {
    Pop-Location
}

# Step 4: Initialize git (required by EAS)
Write-Host "[4/6] Initializing git repository..." -ForegroundColor Yellow
Push-Location $BuildDir
try {
    git init | Out-Null
    git add . | Out-Null
    git commit -m "Build commit" | Out-Null
    Write-Host "      Git repository initialized"
} finally {
    Pop-Location
}

# Step 5: Run EAS Build
Write-Host "[5/6] Running EAS Build..." -ForegroundColor Yellow
Push-Location $BuildDir
try {
    $buildArgs = @("build", "--platform", "android", "--profile", $Profile)
    if ($ClearCache) {
        $buildArgs += "--clear-cache"
    }
    
    & eas @buildArgs
    $buildExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

# Step 6: Cleanup
Write-Host "[6/6] Build finished." -ForegroundColor Yellow
Write-Host "      Build directory: $BuildDir"

if ($buildExitCode -eq 0) {
    Write-Host ""
    Write-Host "[SUCCESS] Build completed successfully!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[FAILED] Build failed with exit code: $buildExitCode" -ForegroundColor Red
    exit $buildExitCode
}
