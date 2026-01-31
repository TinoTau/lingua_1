# Clear Node Client Cache Script
# Usage: powershell -ExecutionPolicy Bypass -File scripts/clear-cache.ps1
#        powershell -ExecutionPolicy Bypass -File scripts/clear-cache.ps1 -ClearLogs   # 同时删除 logs/*.log（默认不删，避免集成测试后找不到日志）

param(
    [switch]$ClearLogs = $false
)

Write-Host "============================================================"
Write-Host "Clearing Node Client Cache"
Write-Host "============================================================"
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# 1. Clear TypeScript build output
Write-Host "[1/5] Clearing TypeScript build output..."
if (Test-Path "main\electron-node") {
    Remove-Item "main\electron-node" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  OK: Removed main\electron-node directory"
} else {
    Write-Host "  Info: main\electron-node directory does not exist"
}

# 2. Clear node_modules cache
Write-Host "[2/5] Clearing node_modules cache..."
if (Test-Path "node_modules\.cache") {
    Remove-Item "node_modules\.cache" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  OK: Removed node_modules\.cache directory"
} else {
    Write-Host "  Info: node_modules\.cache directory does not exist"
}

# 3. Clear Electron app data cache
Write-Host "[3/5] Clearing Electron app data cache..."
$electronCachePaths = @(
    "$env:APPDATA\lingua-electron-node",
    "$env:LOCALAPPDATA\lingua-electron-node",
    "$env:APPDATA\electron",
    "$env:LOCALAPPDATA\electron"
)

$cleared = $false
foreach ($path in $electronCachePaths) {
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  OK: Removed $path"
        $cleared = $true
    }
}
if (-not $cleared) {
    Write-Host "  Info: No Electron app data cache found"
}

# 4. Clear log files（与清缓存一起执行，集成测试前统一清理，确保结果不受干扰）
Write-Host "[4/5] Clearing log files..."
if (Test-Path "logs") {
    $logFiles = Get-ChildItem "logs" -Filter "*.log" -ErrorAction SilentlyContinue
    if ($logFiles) {
        $logFiles | Remove-Item -Force -ErrorAction SilentlyContinue
        Write-Host "  OK: Cleared $($logFiles.Count) log files"
    } else {
        Write-Host "  Info: No log files found"
    }
} else {
    Write-Host "  Info: logs directory does not exist"
}

# 5. Recompile TypeScript
Write-Host "[5/5] Recompiling TypeScript..."
Write-Host ""
npm run build:main
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "  OK: TypeScript compilation successful"
} else {
    Write-Host ""
    Write-Host "  ERROR: TypeScript compilation failed"
    exit 1
}

# Verify compiled file
Write-Host ""
Write-Host "Verifying compiled file..."
$taskRouterFile = "main\electron-node\main\src\task-router\task-router.js"
if (Test-Path $taskRouterFile) {
    $content = Get-Content $taskRouterFile -Raw
    if ($content -match "/v1/translate") {
        Write-Host "  OK: Compiled file contains correct NMT endpoint: /v1/translate"
    } else {
        Write-Host "  ERROR: Compiled file does not contain correct NMT endpoint"
    }
} else {
    Write-Host "  ERROR: Compiled file does not exist"
}

Write-Host ""
Write-Host "============================================================"
Write-Host "Cache clearing completed!"
Write-Host "============================================================"
Write-Host ""
Write-Host "Next step: Restart the node client application"
