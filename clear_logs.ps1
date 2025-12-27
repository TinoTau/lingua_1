# 清理所有日志文件脚本
# 使用方法: .\clear_logs.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "开始清理所有日志文件..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$clearedCount = 0
$errorCount = 0

# 清理调度服务器日志
$schedulerLog = "central_server\scheduler\logs\scheduler.log"
if (Test-Path $schedulerLog) {
    try {
        Clear-Content $schedulerLog -ErrorAction Stop
        Write-Host "✅ 已清空调度服务器日志: $schedulerLog" -ForegroundColor Green
        $clearedCount++
    } catch {
        Write-Host "❌ 清空调度服务器日志失败: $_" -ForegroundColor Red
        $errorCount++
    }
} else {
    Write-Host "⚠️  调度服务器日志文件不存在: $schedulerLog" -ForegroundColor Yellow
}

# 清理节点端主进程日志
$nodeMainLog = "electron_node\electron-node\logs\electron-main.log"
if (Test-Path $nodeMainLog) {
    try {
        Clear-Content $nodeMainLog -ErrorAction Stop
        Write-Host "✅ 已清空节点端主进程日志: $nodeMainLog" -ForegroundColor Green
        $clearedCount++
    } catch {
        Write-Host "❌ 清空节点端主进程日志失败: $_" -ForegroundColor Red
        $errorCount++
    }
} else {
    Write-Host "⚠️  节点端主进程日志文件不存在: $nodeMainLog" -ForegroundColor Yellow
}

# 清理各服务日志
$serviceLogs = @(
    "electron_node\services\faster_whisper_vad\logs\faster-whisper-vad-service.log",
    "electron_node\services\nmt_m2m100\logs\nmt-service.log",
    "electron_node\services\piper_tts\logs\tts-service.log",
    "electron_node\services\node-inference\logs\node-inference.log",
    "electron_node\services\speaker_embedding\logs\speaker-embedding-service.log",
    "electron_node\services\your_tts\logs\yourtts-service.log"
)

Write-Host ""
Write-Host "清理各服务日志..." -ForegroundColor Cyan

foreach ($logFile in $serviceLogs) {
    if (Test-Path $logFile) {
        try {
            Clear-Content $logFile -ErrorAction Stop
            $serviceName = Split-Path (Split-Path $logFile -Parent) -Leaf
            Write-Host "✅ 已清空: $serviceName" -ForegroundColor Green
            $clearedCount++
        } catch {
            Write-Host "❌ 清空失败: $logFile - $_" -ForegroundColor Red
            $errorCount++
        }
    } else {
        $serviceName = Split-Path (Split-Path $logFile -Parent) -Leaf
        Write-Host "⚠️  日志文件不存在: $serviceName" -ForegroundColor Yellow
    }
}

# 尝试查找并清理其他可能的日志文件
Write-Host ""
Write-Host "查找其他日志文件..." -ForegroundColor Cyan

$additionalLogs = Get-ChildItem -Path "electron_node\services" -Recurse -Filter "*.log" -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch "faster-whisper-vad-service|nmt-service|tts-service|node-inference|speaker-embedding|yourtts-service"
}

if ($additionalLogs) {
    foreach ($logFile in $additionalLogs) {
        try {
            Clear-Content $logFile.FullName -ErrorAction Stop
            Write-Host "✅ 已清空额外日志: $($logFile.Name)" -ForegroundColor Green
            $clearedCount++
        } catch {
            Write-Host "❌ 清空额外日志失败: $($logFile.FullName) - $_" -ForegroundColor Red
            $errorCount++
        }
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleanup completed!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Successfully cleared: $clearedCount log files" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "Failed to clear: $errorCount log files" -ForegroundColor Red
}
Write-Host ""

