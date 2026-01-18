# 分析空容器核销日志
# 
# 从节点端和调度服务器日志中提取空容器核销相关信息

param(
    [string]$NodeLog = "logs\node_$(Get-Date -Format 'yyyyMMdd').log",
    [string]$SchedulerLog = "logs\scheduler_$(Get-Date -Format 'yyyyMMdd').log",
    [string]$SessionId = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "空容器核销日志分析" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查日志文件
if (-not (Test-Path $NodeLog)) {
    Write-Host "错误: 节点端日志文件不存在: $NodeLog" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $SchedulerLog)) {
    Write-Host "错误: 调度服务器日志文件不存在: $SchedulerLog" -ForegroundColor Red
    exit 1
}

Write-Host "分析节点端日志: $NodeLog" -ForegroundColor Green
Write-Host "分析调度服务器日志: $SchedulerLog" -ForegroundColor Green
Write-Host ""

# 1. 检查空容器检测
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. 空容器检测" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$emptyContainerDetected = Select-String -Path $NodeLog -Pattern "Empty containers detected" -Context 3
if ($emptyContainerDetected) {
    Write-Host "✓ 检测到空容器:" -ForegroundColor Green
    $emptyContainerDetected | ForEach-Object {
        Write-Host "  $($_.Line)" -ForegroundColor Gray
        if ($_.Context.PreContext) {
            $_.Context.PreContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        if ($_.Context.PostContext) {
            $_.Context.PostContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        Write-Host ""
    }
} else {
    Write-Host "✗ 未检测到空容器" -ForegroundColor Yellow
}
Write-Host ""

# 2. 检查空结果发送
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "2. 空结果发送 (NO_TEXT_ASSIGNED)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$noTextAssigned = Select-String -Path $NodeLog -Pattern "NO_TEXT_ASSIGNED" -Context 5
if ($noTextAssigned) {
    Write-Host "✓ 检测到空结果发送:" -ForegroundColor Green
    $noTextAssigned | ForEach-Object {
        Write-Host "  $($_.Line)" -ForegroundColor Gray
        if ($_.Context.PreContext) {
            $_.Context.PreContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        if ($_.Context.PostContext) {
            $_.Context.PostContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        Write-Host ""
    }
} else {
    Write-Host "✗ 未检测到空结果发送" -ForegroundColor Yellow
}
Write-Host ""

# 3. 检查调度服务器处理
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "3. 调度服务器处理" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$schedulerNoTextAssigned = Select-String -Path $SchedulerLog -Pattern "NO_TEXT_ASSIGNED" -Context 5
if ($schedulerNoTextAssigned) {
    Write-Host "✓ 调度服务器收到空结果:" -ForegroundColor Green
    $schedulerNoTextAssigned | ForEach-Object {
        Write-Host "  $($_.Line)" -ForegroundColor Gray
        if ($_.Context.PreContext) {
            $_.Context.PreContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        if ($_.Context.PostContext) {
            $_.Context.PostContext | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        Write-Host ""
    }
} else {
    Write-Host "✗ 调度服务器未收到空结果" -ForegroundColor Yellow
}
Write-Host ""

# 4. 检查Job状态
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "4. Job状态统计" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 从节点端日志提取job_id
$jobIds = @()
$jobMatches = Select-String -Path $NodeLog -Pattern "job_id.*empty|empty.*job_id" -Context 2
if ($jobMatches) {
    foreach ($match in $jobMatches) {
        if ($match.Line -match "job[_-]?(\w+)") {
            $jobIds += $matches[1]
        }
    }
}

if ($jobIds.Count -gt 0) {
    Write-Host "检测到的空容器Job IDs:" -ForegroundColor Yellow
    $jobIds | Select-Object -Unique | ForEach-Object {
        Write-Host "  - $_" -ForegroundColor Gray
    }
} else {
    Write-Host "未检测到空容器Job IDs" -ForegroundColor Yellow
}
Write-Host ""

# 5. 总结
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "分析总结" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$summary = @{
    "空容器检测" = if ($emptyContainerDetected) { "✓ 已检测" } else { "✗ 未检测" }
    "空结果发送" = if ($noTextAssigned) { "✓ 已发送" } else { "✗ 未发送" }
    "调度服务器处理" = if ($schedulerNoTextAssigned) { "✓ 已处理" } else { "✗ 未处理" }
    "空容器Job数量" = $jobIds.Count
}

$summary.GetEnumerator() | ForEach-Object {
    $color = if ($_.Value -match "✓") { "Green" } else { "Yellow" }
    Write-Host "$($_.Key): $($_.Value)" -ForegroundColor $color
}

Write-Host ""
