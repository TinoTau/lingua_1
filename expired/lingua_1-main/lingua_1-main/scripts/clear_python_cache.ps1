# Clear Python Cache Script
# 清理Python字节码缓存，确保使用最新代码

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Clear Python Cache Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$servicesDir = "electron_node\services"

if (-not (Test-Path $servicesDir)) {
    Write-Host "Error: Services directory not found: $servicesDir" -ForegroundColor Red
    exit 1
}

Write-Host "[1/2] Scanning for Python cache files..." -ForegroundColor Yellow

# 查找所有 __pycache__ 目录
$pycacheDirs = Get-ChildItem -Path $servicesDir -Recurse -Filter "__pycache__" -Directory -ErrorAction SilentlyContinue

# 查找所有 .pyc 文件
$pycFiles = Get-ChildItem -Path $servicesDir -Recurse -Filter "*.pyc" -ErrorAction SilentlyContinue

# 查找所有 .pyo 文件（优化字节码）
$pyoFiles = Get-ChildItem -Path $servicesDir -Recurse -Filter "*.pyo" -ErrorAction SilentlyContinue

$totalItems = $pycacheDirs.Count + $pycFiles.Count + $pyoFiles.Count

if ($totalItems -eq 0) {
    Write-Host "  No Python cache files found" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "  Found:" -ForegroundColor Cyan
Write-Host "    - __pycache__ directories: $($pycacheDirs.Count)" -ForegroundColor Gray
Write-Host "    - .pyc files: $($pycFiles.Count)" -ForegroundColor Gray
Write-Host "    - .pyo files: $($pyoFiles.Count)" -ForegroundColor Gray
Write-Host "    - Total items: $totalItems" -ForegroundColor Yellow
Write-Host ""

Write-Host "[2/2] Cleaning Python cache..." -ForegroundColor Yellow

$cleanedCount = 0
$failedCount = 0

# 删除 __pycache__ 目录
foreach ($dir in $pycacheDirs) {
    try {
        Remove-Item -Path $dir.FullName -Recurse -Force -ErrorAction Stop
        $cleanedCount++
        Write-Host "  Removed: $($dir.FullName)" -ForegroundColor Gray
    } catch {
        Write-Host "  Failed to remove: $($dir.FullName) - $($_.Exception.Message)" -ForegroundColor Red
        $failedCount++
    }
}

# 删除 .pyc 文件
foreach ($file in $pycFiles) {
    try {
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $cleanedCount++
    } catch {
        Write-Host "  Failed to remove: $($file.FullName) - $($_.Exception.Message)" -ForegroundColor Red
        $failedCount++
    }
}

# 删除 .pyo 文件
foreach ($file in $pyoFiles) {
    try {
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $cleanedCount++
    } catch {
        Write-Host "  Failed to remove: $($file.FullName) - $($_.Exception.Message)" -ForegroundColor Red
        $failedCount++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleanup Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Successfully cleaned: $cleanedCount item(s)" -ForegroundColor Green
if ($failedCount -gt 0) {
    Write-Host "  Failed to clean: $failedCount item(s)" -ForegroundColor Red
}

# 验证清理结果
$remainingPycache = (Get-ChildItem -Path $servicesDir -Recurse -Filter "__pycache__" -Directory -ErrorAction SilentlyContinue).Count
$remainingPyc = (Get-ChildItem -Path $servicesDir -Recurse -Filter "*.pyc" -ErrorAction SilentlyContinue).Count
$remainingPyo = (Get-ChildItem -Path $servicesDir -Recurse -Filter "*.pyo" -ErrorAction SilentlyContinue).Count

if ($remainingPycache -eq 0 -and $remainingPyc -eq 0 -and $remainingPyo -eq 0) {
    Write-Host "  All Python cache files have been cleaned" -ForegroundColor Green
} else {
    Write-Host "  Remaining cache files:" -ForegroundColor Yellow
    if ($remainingPycache -gt 0) { Write-Host "    - __pycache__ directories: $remainingPycache" -ForegroundColor Yellow }
    if ($remainingPyc -gt 0) { Write-Host "    - .pyc files: $remainingPyc" -ForegroundColor Yellow }
    if ($remainingPyo -gt 0) { Write-Host "    - .pyo files: $remainingPyo" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Note: Restart the semantic repair services to use the latest code." -ForegroundColor Cyan
Write-Host ""
