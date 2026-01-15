# 全面查找 web-client 日志文件
# 检查多个可能的位置

Write-Host "正在查找 web-client 日志文件..." -ForegroundColor Cyan
Write-Host ""

# 1. 检查下载目录
$downloadPath = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
Write-Host "1. 检查下载目录: $downloadPath" -ForegroundColor Yellow
$downloadLogs = Get-ChildItem -Path $downloadPath -Filter "web-client*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
if ($downloadLogs.Count -gt 0) {
    Write-Host "   找到 $($downloadLogs.Count) 个日志文件" -ForegroundColor Green
        $downloadLogs | Format-Table Name, LastWriteTime, @{Label="Size (KB)"; Expression={[math]::Round($_.Length/1024, 2)}} -AutoSize
} else {
    Write-Host "   未找到日志文件" -ForegroundColor Gray
}

Write-Host ""

# 2. 检查项目 logs 目录
$projectLogsPath = Join-Path $PSScriptRoot "logs"
Write-Host "2. 检查项目 logs 目录: $projectLogsPath" -ForegroundColor Yellow
if (Test-Path $projectLogsPath) {
    $projectLogs = Get-ChildItem -Path $projectLogsPath -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    if ($projectLogs.Count -gt 0) {
        Write-Host "   找到 $($projectLogs.Count) 个日志文件" -ForegroundColor Green
        $projectLogs | Format-Table Name, LastWriteTime, @{Label="Size (KB)"; Expression={[math]::Round($_.Length/1024, 2)}} -AutoSize
    } else {
        Write-Host "   未找到日志文件" -ForegroundColor Gray
    }
} else {
    Write-Host "   目录不存在" -ForegroundColor Gray
}

Write-Host ""

# 3. 检查桌面
$desktopPath = [Environment]::GetFolderPath("Desktop")
Write-Host "3. 检查桌面: $desktopPath" -ForegroundColor Yellow
$desktopLogs = Get-ChildItem -Path $desktopPath -Filter "web-client*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
if ($desktopLogs.Count -gt 0) {
    Write-Host "   找到 $($desktopLogs.Count) 个日志文件" -ForegroundColor Green
    $desktopLogs | Format-Table Name, LastWriteTime, @{Label="Size (KB)"; Expression={[math]::Round($_.Length/1024, 2)}} -AutoSize
} else {
    Write-Host "   未找到日志文件" -ForegroundColor Gray
}

Write-Host ""

# 总结
$allLogs = @()
if ($downloadLogs) { $allLogs += $downloadLogs }
if ($projectLogs) { $allLogs += $projectLogs }
if ($desktopLogs) { $allLogs += $desktopLogs }

if ($allLogs.Count -eq 0) {
    Write-Host "未找到任何日志文件。" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请按照以下步骤导出日志：" -ForegroundColor Cyan
    Write-Host "1. 打开浏览器控制台 (F12)" -ForegroundColor White
    Write-Host "2. 执行: window.logHelper.exportLogs()" -ForegroundColor White
    Write-Host "3. 日志文件会自动下载到下载目录" -ForegroundColor White
    Write-Host ""
    Write-Host "或者启用自动保存（在URL中添加参数）：" -ForegroundColor Cyan
    Write-Host 'http://localhost:9001/?logAutoSave=true&logAutoSaveInterval=30000' -ForegroundColor White
} else {
    Write-Host "总共找到 $($allLogs.Count) 个日志文件" -ForegroundColor Green
    Write-Host ""
    Write-Host "最新的日志文件:" -ForegroundColor Cyan
    $latest = $allLogs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host "  文件名: $($latest.Name)" -ForegroundColor White
    Write-Host "  路径: $($latest.FullName)" -ForegroundColor White
    Write-Host "  修改时间: $($latest.LastWriteTime)" -ForegroundColor White
    Write-Host "  大小: $([math]::Round($latest.Length/1024, 2)) KB" -ForegroundColor White
}
