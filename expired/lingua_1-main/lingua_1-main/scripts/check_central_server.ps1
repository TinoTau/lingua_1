# 检查中央服务器状态

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "检查中央服务器状态" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查端口占用
Write-Host "1. 检查端口占用情况:" -ForegroundColor Yellow
$port5010 = Get-NetTCPConnection -LocalPort 5010 -ErrorAction SilentlyContinue
$port5000 = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue

if ($port5010) {
    $proc = Get-Process -Id $port5010.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "  端口 5010: 被占用 (PID: $($port5010.OwningProcess), 进程: $($proc.ProcessName))" -ForegroundColor Green
} else {
    Write-Host "  端口 5010: 未占用 (调度服务器未运行)" -ForegroundColor Red
}

if ($port5000) {
    $proc = Get-Process -Id $port5000.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "  端口 5000: 被占用 (PID: $($port5000.OwningProcess), 进程: $($proc.ProcessName))" -ForegroundColor Green
} else {
    Write-Host "  端口 5000: 未占用 (Model Hub未运行)" -ForegroundColor Red
}

Write-Host ""

# 检查后台任务
Write-Host "2. 检查后台任务:" -ForegroundColor Yellow
$jobs = Get-Job
if ($jobs) {
    foreach ($job in $jobs) {
        Write-Host "  Job ID: $($job.Id), 状态: $($job.State)" -ForegroundColor Gray
        if ($job.State -eq "Failed") {
            Write-Host "    错误输出:" -ForegroundColor Red
            Receive-Job -Id $job.Id -ErrorAction SilentlyContinue | Select-Object -Last 5 | ForEach-Object {
                Write-Host "      $_" -ForegroundColor Red
            }
        }
    }
} else {
    Write-Host "  没有运行中的后台任务" -ForegroundColor Gray
}

Write-Host ""

# 检查日志文件
Write-Host "3. 检查日志文件:" -ForegroundColor Yellow
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

$schedulerLog = Join-Path (Join-Path $projectRoot "central_server") "scheduler\logs\scheduler.log"
if (Test-Path $schedulerLog) {
    $logInfo = Get-Item $schedulerLog
    Write-Host "  调度服务器日志: $schedulerLog" -ForegroundColor Gray
    Write-Host "    大小: $($logInfo.Length) bytes, 最后修改: $($logInfo.LastWriteTime)" -ForegroundColor Gray
    Write-Host "    最后5行:" -ForegroundColor Gray
    Get-Content $schedulerLog -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "      $_" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  调度服务器日志不存在" -ForegroundColor Yellow
}

Write-Host ""

$modelHubLogs = Join-Path (Join-Path $projectRoot "central_server") "model-hub\logs"
if (Test-Path $modelHubLogs) {
    $latestLog = Get-ChildItem $modelHubLogs -Filter "model-hub_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "  Model Hub日志: $($latestLog.FullName)" -ForegroundColor Gray
        Write-Host "    大小: $($latestLog.Length) bytes, 最后修改: $($latestLog.LastWriteTime)" -ForegroundColor Gray
        Write-Host "    最后5行:" -ForegroundColor Gray
        Get-Content $latestLog.FullName -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "      $_" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  Model Hub log directory not found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "建议操作:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not $port5010) {
    Write-Host "1. 调度服务器未运行，尝试启动:" -ForegroundColor Yellow
    Write-Host "   .\scripts\start_central_server.ps1 --scheduler-only" -ForegroundColor Gray
}

if (-not $port5000) {
    Write-Host "2. Model Hub未运行，尝试启动:" -ForegroundColor Yellow
    Write-Host "   .\scripts\start_central_server.ps1 --model-hub-only" -ForegroundColor Gray
} elseif ($port5000.OwningProcess -ne $null) {
    $proc = Get-Process -Id $port5000.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.Path -notlike "*model-hub*") {
        Write-Host "2. 端口5000被其他进程占用，可能需要停止:" -ForegroundColor Yellow
        Write-Host "   Stop-Process -Id $($port5000.OwningProcess) -Force" -ForegroundColor Gray
    }
}

Write-Host "3. 停止所有后台任务:" -ForegroundColor Yellow
Write-Host "   Get-Job | Stop-Job; Get-Job | Remove-Job" -ForegroundColor Gray

Write-Host ""

