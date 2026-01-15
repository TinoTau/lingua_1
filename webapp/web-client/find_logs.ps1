# 查找 web-client 日志文件
# 日志文件通常保存在用户的下载目录中

$downloadPath = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
$logFiles = Get-ChildItem -Path $downloadPath -Filter "web-client*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending

if ($logFiles.Count -eq 0) {
    Write-Host "未找到日志文件。日志文件应该保存在: $downloadPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "请按照以下步骤导出日志：" -ForegroundColor Cyan
    Write-Host "1. 打开浏览器控制台 (F12)" -ForegroundColor White
    Write-Host "2. 执行: window.logHelper.exportLogs()" -ForegroundColor White
    Write-Host "3. 日志文件会自动下载到下载目录" -ForegroundColor White
} else {
    Write-Host "找到 $($logFiles.Count) 个日志文件：" -ForegroundColor Green
    Write-Host ""
    $logFiles | Format-Table Name, LastWriteTime, @{Label="Size (KB)"; Expression={[math]::Round($_.Length/1KB, 2)}} -AutoSize
    
    Write-Host ""
    Write-Host "最新的日志文件: $($logFiles[0].FullName)" -ForegroundColor Cyan
}
