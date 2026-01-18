# 空容器核销功能测试脚本
# 
# 测试场景：
# 1. 模拟35秒长语音，被拆分成多个job
# 2. 验证空容器是否被正确检测和核销
# 3. 检查调度服务器是否正确处理 NO_TEXT_ASSIGNED 结果

param(
    [string]$SessionId = "test-empty-container-$(Get-Date -Format 'yyyyMMdd-HHmmss')",
    [int]$DurationSeconds = 35,
    [string]$SrcLang = "zh",
    [string]$TgtLang = "en"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "空容器核销功能测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Session ID: $SessionId" -ForegroundColor Yellow
Write-Host "测试时长: ${DurationSeconds}秒" -ForegroundColor Yellow
Write-Host "语言对: $SrcLang -> $TgtLang" -ForegroundColor Yellow
Write-Host ""

# 检查服务是否运行
Write-Host "检查服务状态..." -ForegroundColor Green
$schedulerRunning = Get-Process -Name "scheduler" -ErrorAction SilentlyContinue
$nodeRunning = Get-Process -Name "electron-node" -ErrorAction SilentlyContinue

if (-not $schedulerRunning) {
    Write-Host "错误: 调度服务器未运行" -ForegroundColor Red
    Write-Host "请先启动调度服务器: .\scripts\start_scheduler.ps1" -ForegroundColor Yellow
    exit 1
}

if (-not $nodeRunning) {
    Write-Host "错误: 节点端未运行" -ForegroundColor Red
    Write-Host "请先启动节点端: .\scripts\start_electron_node.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ 调度服务器运行中" -ForegroundColor Green
Write-Host "✓ 节点端运行中" -ForegroundColor Green
Write-Host ""

# 检查日志目录
$logDir = "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$schedulerLog = "$logDir\scheduler_$(Get-Date -Format 'yyyyMMdd').log"
$nodeLog = "$logDir\node_$(Get-Date -Format 'yyyyMMdd').log"

Write-Host "日志文件:" -ForegroundColor Green
Write-Host "  调度服务器: $schedulerLog" -ForegroundColor Gray
Write-Host "  节点端: $nodeLog" -ForegroundColor Gray
Write-Host ""

# 测试说明
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试说明" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. 本测试将模拟一个 ${DurationSeconds}秒的长语音" -ForegroundColor White
Write-Host "2. 长语音会被拆分成多个job（根据MaxDuration配置）" -ForegroundColor White
Write-Host "3. 如果某些job容器没有被分配到batch，应该发送空结果核销" -ForegroundColor White
Write-Host "4. 空结果应该包含 extra.reason = 'NO_TEXT_ASSIGNED'" -ForegroundColor White
Write-Host ""

Write-Host "请按照以下步骤进行测试:" -ForegroundColor Yellow
Write-Host "1. 打开 Web 客户端（如果已启动）" -ForegroundColor White
Write-Host "2. 创建一个新的会话" -ForegroundColor White
Write-Host "3. 连续说话 ${DurationSeconds}秒以上，中间不做手动发送" -ForegroundColor White
Write-Host "4. 等待系统超时自动finalize（或手动发送）" -ForegroundColor White
Write-Host "5. 观察结果，检查是否有空容器被核销" -ForegroundColor White
Write-Host ""

# 提供日志分析命令
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "日志分析命令" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 检查节点端是否检测到空容器:" -ForegroundColor Yellow
Write-Host "   Select-String -Path '$nodeLog' -Pattern 'Empty containers detected'" -ForegroundColor Gray
Write-Host ""
Write-Host "2. 检查节点端是否发送空结果:" -ForegroundColor Yellow
Write-Host "   Select-String -Path '$nodeLog' -Pattern 'NO_TEXT_ASSIGNED' -Context 5" -ForegroundColor Gray
Write-Host ""
Write-Host "3. 检查调度服务器是否收到空结果:" -ForegroundColor Yellow
Write-Host "   Select-String -Path '$schedulerLog' -Pattern 'NO_TEXT_ASSIGNED' -Context 5" -ForegroundColor Gray
Write-Host ""
Write-Host "4. 检查Job状态（使用Redis CLI）:" -ForegroundColor Yellow
Write-Host "   redis-cli KEYS 'scheduler:job:*' | ForEach-Object { redis-cli HGETALL `$_ }" -ForegroundColor Gray
Write-Host ""

# 实时监控日志
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "实时监控日志（按 Ctrl+C 停止）" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$monitoring = $true
$lastNodeLogSize = 0
$lastSchedulerLogSize = 0

# 检查日志文件是否存在
if (Test-Path $nodeLog) {
    $lastNodeLogSize = (Get-Item $nodeLog).Length
}
if (Test-Path $schedulerLog) {
    $lastSchedulerLogSize = (Get-Item $schedulerLog).Length
}

Write-Host "开始监控日志，等待测试开始..." -ForegroundColor Green
Write-Host ""

try {
    while ($monitoring) {
        Start-Sleep -Seconds 2
        
        # 监控节点端日志
        if (Test-Path $nodeLog) {
            $currentSize = (Get-Item $nodeLog).Length
            if ($currentSize -gt $lastNodeLogSize) {
                $newContent = Get-Content $nodeLog -Tail 10 -ErrorAction SilentlyContinue
                foreach ($line in $newContent) {
                    if ($line -match "Empty containers detected|NO_TEXT_ASSIGNED|empty container") {
                        Write-Host "[节点端] $line" -ForegroundColor Cyan
                    }
                }
                $lastNodeLogSize = $currentSize
            }
        }
        
        # 监控调度服务器日志
        if (Test-Path $schedulerLog) {
            $currentSize = (Get-Item $schedulerLog).Length
            if ($currentSize -gt $lastSchedulerLogSize) {
                $newContent = Get-Content $schedulerLog -Tail 10 -ErrorAction SilentlyContinue
                foreach ($line in $newContent) {
                    if ($line -match "NO_TEXT_ASSIGNED|empty result|job_result.*empty") {
                        Write-Host "[调度服务器] $line" -ForegroundColor Magenta
                    }
                }
                $lastSchedulerLogSize = $currentSize
            }
        }
    }
} catch {
    Write-Host "`n监控已停止" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "请检查以下内容:" -ForegroundColor Yellow
Write-Host "1. 节点端日志中是否有 'Empty containers detected' 消息" -ForegroundColor White
Write-Host "2. 节点端日志中是否有 'NO_TEXT_ASSIGNED' 的空结果发送" -ForegroundColor White
Write-Host "3. 调度服务器日志中是否正确处理了空结果" -ForegroundColor White
Write-Host "4. Web客户端是否正确显示了结果" -ForegroundColor White
Write-Host ""
