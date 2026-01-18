# 检查空容器核销测试结果

param(
    [string]$NodeLog = "",
    [string]$SchedulerLog = ""
)

# 尝试多个可能的日志文件位置
$possibleNodeLogs = @(
    "electron_node\electron-node\logs\electron-main.log",
    "logs\node_$(Get-Date -Format 'yyyyMMdd').log"
)

$possibleSchedulerLogs = @(
    "central_server\scheduler\logs\scheduler*.log",
    "logs\scheduler_$(Get-Date -Format 'yyyyMMdd').log"
)

if (-not $NodeLog) {
    foreach ($log in $possibleNodeLogs) {
        if (Test-Path $log) {
            $NodeLog = $log
            break
        }
    }
}

if (-not $SchedulerLog) {
    foreach ($pattern in $possibleSchedulerLogs) {
        $logs = Get-ChildItem -Path (Split-Path $pattern -Parent) -Filter (Split-Path $pattern -Leaf) -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
        if ($logs) {
            $SchedulerLog = $logs[0].FullName
            break
        }
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "空容器核销功能测试结果检查" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查日志文件
if (-not (Test-Path $NodeLog)) {
    Write-Host "警告: 节点端日志不存在: $NodeLog" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "节点端日志: $NodeLog" -ForegroundColor Green
    Write-Host "文件大小: $((Get-Item $NodeLog).Length) bytes" -ForegroundColor Gray
    Write-Host ""
    
    # 检查空容器检测
    Write-Host "1. 空容器检测:" -ForegroundColor Cyan
    $emptyContainers = Select-String -Path $NodeLog -Pattern "Empty containers detected" -Context 2
    if ($emptyContainers) {
        Write-Host "   ✓ 检测到空容器" -ForegroundColor Green
        $emptyContainers | ForEach-Object {
            Write-Host "   $($_.Line)" -ForegroundColor Gray
        }
    } else {
        Write-Host "   ✗ 未检测到空容器" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 检查NO_TEXT_ASSIGNED
    Write-Host "2. 空结果发送 (NO_TEXT_ASSIGNED):" -ForegroundColor Cyan
    $noTextAssigned = Select-String -Path $NodeLog -Pattern "NO_TEXT_ASSIGNED" -Context 2
    if ($noTextAssigned) {
        Write-Host "   ✓ 检测到空结果发送" -ForegroundColor Green
        $noTextAssigned | ForEach-Object {
            Write-Host "   $($_.Line)" -ForegroundColor Gray
        }
    } else {
        Write-Host "   ✗ 未检测到空结果发送" -ForegroundColor Yellow
    }
    Write-Host ""
}

if (-not (Test-Path $SchedulerLog)) {
    Write-Host "警告: 调度服务器日志不存在: $SchedulerLog" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "调度服务器日志: $SchedulerLog" -ForegroundColor Green
    Write-Host "文件大小: $((Get-Item $SchedulerLog).Length) bytes" -ForegroundColor Gray
    Write-Host ""
    
    # 检查调度服务器处理
    Write-Host "3. 调度服务器处理:" -ForegroundColor Cyan
    $schedulerHandled = Select-String -Path $SchedulerLog -Pattern "NO_TEXT_ASSIGNED" -Context 2
    if ($schedulerHandled) {
        Write-Host "   ✓ 调度服务器收到空结果" -ForegroundColor Green
        $schedulerHandled | ForEach-Object {
            Write-Host "   $($_.Line)" -ForegroundColor Gray
        }
    } else {
        Write-Host "   ✗ 调度服务器未收到空结果" -ForegroundColor Yellow
    }
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试总结" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$results = @{
    "空容器检测" = if ($emptyContainers) { "✓" } else { "✗" }
    "空结果发送" = if ($noTextAssigned) { "✓" } else { "✗" }
    "调度服务器处理" = if ($schedulerHandled) { "✓" } else { "✗" }
}

$results.GetEnumerator() | ForEach-Object {
    $color = if ($_.Value -eq "✓") { "Green" } else { "Yellow" }
    Write-Host "$($_.Key): $($_.Value)" -ForegroundColor $color
}

Write-Host ""
