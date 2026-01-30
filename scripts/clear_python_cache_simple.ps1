# Simple Python Cache Cleanup - Fast and Direct

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Quick Clear Python Cache" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 清理所有 Python 缓存目录
$dirsToClean = @(
    "electron_node\services",
    "electron_node\electron-node",
    "scripts"
)

$cleanedCount = 0
$failedCount = 0

# 收集所有 __pycache__ 目录
$pycacheDirs = @()
foreach ($dir in $dirsToClean) {
    if (Test-Path $dir) {
        Write-Host "Scanning $dir ..." -ForegroundColor Gray
        $found = Get-ChildItem -Path $dir -Recurse -Filter "__pycache__" -Directory -ErrorAction SilentlyContinue
        $pycacheDirs += $found
    }
}

if ($pycacheDirs.Count -eq 0) {
    Write-Host "No __pycache__ directories found" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "Found $($pycacheDirs.Count) __pycache__ directories to clean" -ForegroundColor Yellow
Write-Host ""

foreach ($dir in $pycacheDirs) {
    try {
        Remove-Item -Path $dir.FullName -Recurse -Force -ErrorAction Stop
        $cleanedCount++
    } catch {
        $failedCount++
    }
}

Write-Host "Cleaned __pycache__ directories: $cleanedCount" -ForegroundColor Green

if ($failedCount -gt 0) {
    Write-Host "Failed: $failedCount" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
