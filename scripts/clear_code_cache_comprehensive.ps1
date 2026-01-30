# Comprehensive Code Cache Cleanup Script
# 全面清理节点端和调度服务器的代码缓存

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Comprehensive Code Cache Cleanup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$cleanedCount = 0
$failedCount = 0
$totalSize = 0

# ==================== 1. 调度服务器端缓存 ====================
Write-Host "[1/6] Cleaning Scheduler Server Cache (Rust)..." -ForegroundColor Yellow

# Rust target 目录（编译输出）
$rustTargetDirs = @(
    "central_server\scheduler\target",
    "electron_node\services\node-inference\target"
)

foreach ($dir in $rustTargetDirs) {
    if (Test-Path $dir) {
        try {
            $size = (Get-ChildItem $dir -Recurse -ErrorAction SilentlyContinue | 
                Measure-Object -Property Length -Sum).Sum
            $sizeMB = [math]::Round($size / 1MB, 2)
            
            Remove-Item $dir -Recurse -Force -ErrorAction Stop
            Write-Host "  ✓ Removed: $dir ($sizeMB MB)" -ForegroundColor Green
            $cleanedCount++
            $totalSize += $size
        } catch {
            Write-Host "  ✗ Failed: $dir" -ForegroundColor Red
            $failedCount++
        }
    }
}

# ==================== 2. 节点端 TypeScript 编译缓存 ====================
Write-Host "[2/6] Cleaning Node TypeScript Build Cache..." -ForegroundColor Yellow

$tsBuildDirs = @(
    "electron_node\electron-node\main\electron-node",
    "electron_node\electron-node\dist",
    "electron_node\electron-node\build",
    "electron_node\electron-node\renderer\dist",
    "electron_node\electron-node\renderer\build"
)

foreach ($dir in $tsBuildDirs) {
    if (Test-Path $dir) {
        try {
            $size = (Get-ChildItem $dir -Recurse -ErrorAction SilentlyContinue | 
                Measure-Object -Property Length -Sum).Sum
            $sizeMB = [math]::Round($size / 1MB, 2)
            
            Remove-Item $dir -Recurse -Force -ErrorAction Stop
            Write-Host "  ✓ Removed: $dir ($sizeMB MB)" -ForegroundColor Green
            $cleanedCount++
            $totalSize += $size
        } catch {
            Write-Host "  ✗ Failed: $dir" -ForegroundColor Red
            $failedCount++
        }
    }
}

# TypeScript build info 文件
$tsBuildInfoFiles = Get-ChildItem -Path "." -Recurse -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue
foreach ($file in $tsBuildInfoFiles) {
    try {
        Remove-Item $file.FullName -Force -ErrorAction Stop
        Write-Host "  ✓ Removed: $($file.FullName)" -ForegroundColor Green
        $cleanedCount++
    } catch {
        Write-Host "  ✗ Failed: $($file.FullName)" -ForegroundColor Red
        $failedCount++
    }
}

# ==================== 3. Node.js 缓存 ====================
Write-Host "[3/6] Cleaning Node.js Cache..." -ForegroundColor Yellow

$nodeCacheDirs = @(
    "electron_node\electron-node\node_modules\.cache",
    "webapp\web-client\node_modules\.cache"
)

foreach ($dir in $nodeCacheDirs) {
    if (Test-Path $dir) {
        try {
            $size = (Get-ChildItem $dir -Recurse -ErrorAction SilentlyContinue | 
                Measure-Object -Property Length -Sum).Sum
            $sizeMB = [math]::Round($size / 1MB, 2)
            
            Remove-Item $dir -Recurse -Force -ErrorAction Stop
            Write-Host "  ✓ Removed: $dir ($sizeMB MB)" -ForegroundColor Green
            $cleanedCount++
            $totalSize += $size
        } catch {
            Write-Host "  ✗ Failed: $dir" -ForegroundColor Red
            $failedCount++
        }
    }
}

# ESLint 缓存
$eslintCacheFiles = Get-ChildItem -Path "." -Recurse -Filter ".eslintcache" -ErrorAction SilentlyContinue
foreach ($file in $eslintCacheFiles) {
    try {
        Remove-Item $file.FullName -Force -ErrorAction Stop
        Write-Host "  ✓ Removed: $($file.FullName)" -ForegroundColor Green
        $cleanedCount++
    } catch {
        Write-Host "  ✗ Failed: $($file.FullName)" -ForegroundColor Red
        $failedCount++
    }
}

# ==================== 4. Python 缓存 ====================
Write-Host "[4/6] Cleaning Python Cache..." -ForegroundColor Yellow

# 收集所有 __pycache__ 目录
$pycacheDirs = @()
$searchDirs = @(
    "electron_node\services",
    "electron_node\electron-node",
    "scripts",
    "central_server"
)

foreach ($dir in $searchDirs) {
    if (Test-Path $dir) {
        $found = Get-ChildItem -Path $dir -Recurse -Filter "__pycache__" -Directory -ErrorAction SilentlyContinue
        $pycacheDirs += $found
    }
}

foreach ($dir in $pycacheDirs) {
    try {
        $size = (Get-ChildItem $dir.FullName -Recurse -ErrorAction SilentlyContinue | 
            Measure-Object -Property Length -Sum).Sum
        $sizeMB = [math]::Round($size / 1MB, 2)
        
        Remove-Item $dir.FullName -Recurse -Force -ErrorAction Stop
        Write-Host "  ✓ Removed: $($dir.FullName) ($sizeMB MB)" -ForegroundColor Green
        $cleanedCount++
        $totalSize += $size
    } catch {
        Write-Host "  ✗ Failed: $($dir.FullName)" -ForegroundColor Red
        $failedCount++
    }
}

# .pyc 文件
$pycFiles = Get-ChildItem -Path "." -Recurse -Filter "*.pyc" -ErrorAction SilentlyContinue
foreach ($file in $pycFiles) {
    try {
        Remove-Item $file.FullName -Force -ErrorAction Stop
        $cleanedCount++
    } catch {
        $failedCount++
    }
}

# .pyo 文件
$pyoFiles = Get-ChildItem -Path "." -Recurse -Filter "*.pyo" -ErrorAction SilentlyContinue
foreach ($file in $pyoFiles) {
    try {
        Remove-Item $file.FullName -Force -ErrorAction Stop
        $cleanedCount++
    } catch {
        $failedCount++
    }
}

# ==================== 5. Electron 应用数据缓存 ====================
Write-Host "[5/6] Cleaning Electron App Data Cache..." -ForegroundColor Yellow

$electronCachePaths = @(
    "$env:APPDATA\lingua-electron-node",
    "$env:LOCALAPPDATA\lingua-electron-node",
    "$env:APPDATA\electron",
    "$env:LOCALAPPDATA\electron"
)

$electronCleared = $false
foreach ($path in $electronCachePaths) {
    if (Test-Path $path) {
        try {
            $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue | 
                Measure-Object -Property Length -Sum).Sum
            $sizeMB = [math]::Round($size / 1MB, 2)
            
            Remove-Item $path -Recurse -Force -ErrorAction Stop
            Write-Host "  ✓ Removed: $path ($sizeMB MB)" -ForegroundColor Green
            $cleanedCount++
            $totalSize += $size
            $electronCleared = $true
        } catch {
            Write-Host "  ✗ Failed: $path" -ForegroundColor Red
            $failedCount++
        }
    }
}

if (-not $electronCleared) {
    Write-Host "  ℹ No Electron app data cache found" -ForegroundColor Gray
}

# ==================== 6. 其他缓存目录 ====================
Write-Host "[6/6] Cleaning Other Cache Directories..." -ForegroundColor Yellow

$otherCacheDirs = @(
    ".cache",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "docs\_build",
    ".pdm-build"
)

foreach ($dir in $otherCacheDirs) {
    if (Test-Path $dir) {
        try {
            $size = (Get-ChildItem $dir -Recurse -ErrorAction SilentlyContinue | 
                Measure-Object -Property Length -Sum).Sum
            $sizeMB = [math]::Round($size / 1MB, 2)
            
            Remove-Item $dir -Recurse -Force -ErrorAction Stop
            Write-Host "  ✓ Removed: $dir ($sizeMB MB)" -ForegroundColor Green
            $cleanedCount++
            $totalSize += $size
        } catch {
            Write-Host "  ✗ Failed: $dir" -ForegroundColor Red
            $failedCount++
        }
    }
}

# ==================== 总结 ====================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleanup Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$totalSizeMB = [math]::Round($totalSize / 1MB, 2)
Write-Host "Cleaned items: $cleanedCount" -ForegroundColor Green
if ($failedCount -gt 0) {
    Write-Host "Failed items: $failedCount" -ForegroundColor Red
}
Write-Host "Total size freed: $totalSizeMB MB" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Note: This script does NOT clean:" -ForegroundColor Yellow
Write-Host "  - node_modules/ (use 'npm install' to reinstall)" -ForegroundColor Gray
Write-Host "  - Log files (use clear_logs_simple.ps1)" -ForegroundColor Gray
Write-Host "  - Running processes (use cleanup_orphaned_processes_simple.ps1)" -ForegroundColor Gray
Write-Host ""
