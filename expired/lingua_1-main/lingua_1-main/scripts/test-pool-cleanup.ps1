# Pool 清理机制测试脚本

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Pool 清理机制测试" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查调度服务器是否运行
Write-Host "1. 检查调度服务器状态..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/api/v1/phase3/pools" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    Write-Host "   ✓ 调度服务器正在运行" -ForegroundColor Green
    $poolData = $response.Content | ConvertFrom-Json
    
    Write-Host "   Pool 配置信息:" -ForegroundColor Gray
    Write-Host "   - 自动生成启用: $($poolData.config.auto_generate_language_pools)" -ForegroundColor White
    Write-Host "   - Pool 总数: $($poolData.pools.Count)" -ForegroundColor White
    
    if ($poolData.pools.Count -gt 0) {
        Write-Host "   Pool 列表:" -ForegroundColor Gray
        foreach ($pool in $poolData.pools) {
            Write-Host "   - Pool $($pool.pool_id): $($pool.pool_name) (节点数: $($pool.pool_node_count))" -ForegroundColor White
        }
    } else {
        Write-Host "   ⚠ 未生成任何 Pool" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ✗ 无法连接到调度服务器: $_" -ForegroundColor Red
    Write-Host "   请确认调度服务器是否在运行 (http://localhost:8080)" -ForegroundColor Yellow
}
Write-Host ""

# 2. 检查节点列表
Write-Host "2. 检查节点列表..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/api/v1/nodes" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    $nodesData = $response.Content | ConvertFrom-Json
    $onlineNodes = $nodesData | Where-Object { $_.online -eq $true }
    $offlineNodes = $nodesData | Where-Object { $_.online -eq $false }
    
    Write-Host "   - 在线节点数: $($onlineNodes.Count)" -ForegroundColor White
    Write-Host "   - 离线节点数: $($offlineNodes.Count)" -ForegroundColor White
    
    if ($onlineNodes.Count -gt 0) {
        Write-Host "   在线节点:" -ForegroundColor Gray
        foreach ($node in $onlineNodes) {
            Write-Host "   - $($node.node_id) (状态: $($node.status), Pool: $($node.pool_id))" -ForegroundColor White
        }
    }
    
    if ($offlineNodes.Count -gt 0) {
        Write-Host "   离线节点:" -ForegroundColor Gray
        foreach ($node in $offlineNodes) {
            Write-Host "   - $($node.node_id) (状态: $($node.status), Pool: $($node.pool_id))" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "   ✗ 无法获取节点列表: $_" -ForegroundColor Red
}
Write-Host ""

# 3. 检查调度服务器日志
Write-Host "3. 检查调度服务器日志..." -ForegroundColor Yellow
$schedulerLogPath = "central_server\scheduler\logs"
if (Test-Path $schedulerLogPath) {
    $latestLog = Get-ChildItem -Path $schedulerLogPath -Filter "scheduler.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "   最新日志文件: $($latestLog.Name)" -ForegroundColor Gray
        
        # 检查 Pool 生成日志
        $poolGenLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "自动生成|rebuild_auto|Pool.*生成|pool.*created" -Context 0
        if ($poolGenLogs) {
            Write-Host "   Pool 生成相关日志:" -ForegroundColor Green
            $poolGenLogs | Select-Object -Last 5 | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        }
        
        # 检查节点离线日志
        $offlineLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "mark_node_offline|节点离线|node.*offline|清理|cleanup" -Context 0
        if ($offlineLogs) {
            Write-Host "   节点离线相关日志:" -ForegroundColor Green
            $offlineLogs | Select-Object -Last 5 | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        }
        
        # 检查定期清理任务日志
        $cleanupLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "定期清理|pool.*cleanup|空 Pool|empty.*pool" -Context 0
        if ($cleanupLogs) {
            Write-Host "   Pool 清理相关日志:" -ForegroundColor Green
            $cleanupLogs | Select-Object -Last 5 | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        }
    } else {
        Write-Host "   ⚠ 未找到日志文件" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ⚠ 日志目录不存在: $schedulerLogPath" -ForegroundColor Yellow
}
Write-Host ""

# 4. 测试建议
Write-Host "4. 测试建议..." -ForegroundColor Yellow
Write-Host "   要测试节点离线时的 Pool 清理机制，请执行以下步骤:" -ForegroundColor White
Write-Host "   1. 记录当前 Pool 状态（见上方）" -ForegroundColor White
Write-Host "   2. 停止一个节点（关闭节点端应用）" -ForegroundColor White
Write-Host "   3. 等待 60 秒（定期清理任务执行间隔）" -ForegroundColor White
Write-Host "   4. 再次运行此脚本，检查 Pool 是否被清理" -ForegroundColor White
Write-Host "   5. 检查日志中是否有 '检测到 X 个空 Pool' 和 '触发重建' 的日志" -ForegroundColor White
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "测试检查完成" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
