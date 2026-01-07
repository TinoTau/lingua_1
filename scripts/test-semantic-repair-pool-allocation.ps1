# 语义修复服务语言能力检测和 Pool 分配测试脚本

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "语义修复服务语言能力检测和 Pool 分配测试" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查节点端日志中的语义修复服务检测信息
Write-Host "1. 检查节点端日志中的语义修复服务检测信息..." -ForegroundColor Yellow
$nodeLogPath = "electron_node\electron-node\logs"
if (Test-Path $nodeLogPath) {
    $latestLog = Get-ChildItem -Path $nodeLogPath -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "   最新日志文件: $($latestLog.Name)" -ForegroundColor Gray
        Write-Host ""
        
        # 检查语义修复服务检测日志
        Write-Host "   [检查] 语义修复服务检测日志..." -ForegroundColor Cyan
        $semanticLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "语义修复|semantic.*language|semantic.*service|Language capabilities detected" -Context 2
        if ($semanticLogs) {
            Write-Host "   [OK] 找到语义修复服务相关日志:" -ForegroundColor Green
            $semanticLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [FAIL] 未找到语义修复服务相关日志" -ForegroundColor Red
        }
        Write-Host ""
        
        # 检查语言对计算日志
        Write-Host "   [检查] 语言对计算日志..." -ForegroundColor Cyan
        $pairLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "语言对|language.*pair|supported_language_pairs|基于语义修复服务语言能力过滤" -Context 2
        if ($pairLogs) {
            Write-Host "   [OK] 找到语言对相关日志:" -ForegroundColor Green
            $pairLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [FAIL] 未找到语言对相关日志" -ForegroundColor Red
        }
        Write-Host ""
        
        # 检查心跳上报日志
        Write-Host "   [检查] 心跳上报日志..." -ForegroundColor Cyan
        $heartbeatLogs = Get-Content $latestLog.FullName -Tail 200 | Select-String -Pattern "上报语言对列表|Sending heartbeat|node_heartbeat" -Context 1
        if ($heartbeatLogs) {
            Write-Host "   [OK] 找到心跳上报日志:" -ForegroundColor Green
            $heartbeatLogs | Select-Object -First 5 | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [FAIL] 未找到心跳上报日志" -ForegroundColor Red
        }
    } else {
        Write-Host "   [FAIL] 未找到日志文件" -ForegroundColor Red
    }
} else {
    Write-Host "   [FAIL] 日志目录不存在: $nodeLogPath" -ForegroundColor Red
}
Write-Host ""

# 2. 检查调度服务器日志中的 Pool 生成和节点分配信息
Write-Host "2. 检查调度服务器日志中的 Pool 生成和节点分配信息..." -ForegroundColor Yellow
$schedulerLogPath = "central_server\scheduler\logs"
if (Test-Path $schedulerLogPath) {
    $latestLog = Get-ChildItem -Path $schedulerLogPath -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "   最新日志文件: $($latestLog.Name)" -ForegroundColor Gray
        Write-Host ""
        
        # 检查节点注册日志
        Write-Host "   [检查] 节点注册日志..." -ForegroundColor Cyan
        $registerLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "node_register|Node registered|language_capabilities" -Context 2
        if ($registerLogs) {
            Write-Host "   [OK] 找到节点注册日志:" -ForegroundColor Green
            $registerLogs | Select-Object -First 3 | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [FAIL] 未找到节点注册日志" -ForegroundColor Red
        }
        Write-Host ""
        
        # 检查心跳处理日志
        Write-Host "   [检查] 心跳处理日志..." -ForegroundColor Cyan
        $heartbeatLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "node_heartbeat|Processing node heartbeat|Received node message" -Context 1
        if ($heartbeatLogs) {
            Write-Host "   [OK] 找到心跳处理日志:" -ForegroundColor Green
            $heartbeatLogs | Select-Object -First 3 | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [FAIL] 未找到心跳处理日志" -ForegroundColor Red
        }
        Write-Host ""
        
        # 检查 Pool 生成日志
        Write-Host "   [检查] Pool 生成日志..." -ForegroundColor Cyan
        $poolLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "生成精确池|生成混合池|收集到.*个语言对|auto_generate|自动生成|rebuild.*pool" -Context 2
        if ($poolLogs) {
            Write-Host "   [OK] 找到 Pool 生成日志:" -ForegroundColor Green
            $poolLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [FAIL] 未找到 Pool 生成日志" -ForegroundColor Red
        }
        Write-Host ""
        
        # 检查节点分配日志
        Write-Host "   [检查] 节点分配日志..." -ForegroundColor Cyan
        $allocationLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "节点分配到 Pool|节点未匹配到任何现有 Pool|成功为节点动态创建新 Pool|节点从 Pool.*移动到 Pool|语义修复服务语言能力" -Context 1
        if ($allocationLogs) {
            Write-Host "   [OK] 找到节点分配日志:" -ForegroundColor Green
            $allocationLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [FAIL] 未找到节点分配日志" -ForegroundColor Red
        }
        Write-Host ""
        
        # 检查语义修复服务语言能力检查日志
        Write-Host "   [检查] 语义修复服务语言能力检查日志..." -ForegroundColor Cyan
        $semanticCheckLogs = Get-Content $latestLog.FullName -Tail 500 | Select-String -Pattern "节点没有语义修复服务支持的语言|节点语言能力检查|语义修复服务支持|源语言或目标语言不在语义修复服务支持的语言列表中" -Context 1
        if ($semanticCheckLogs) {
            Write-Host "   [OK] 找到语义修复服务语言能力检查日志:" -ForegroundColor Green
            $semanticCheckLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   [WARN] 未找到语义修复服务语言能力检查日志（可能是正常情况）" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   [FAIL] 未找到日志文件" -ForegroundColor Red
    }
} else {
    Write-Host "   [FAIL] 日志目录不存在: $schedulerLogPath" -ForegroundColor Red
}
Write-Host ""

# 3. 测试建议
Write-Host "3. 测试建议:" -ForegroundColor Yellow
Write-Host "   - 检查节点端日志中是否显示语义修复服务支持的语言" -ForegroundColor White
Write-Host "   - 检查节点端日志中是否显示基于语义修复服务过滤后的语言对" -ForegroundColor White
Write-Host "   - 检查调度服务器日志中是否显示 Pool 生成信息" -ForegroundColor White
Write-Host "   - 检查调度服务器日志中是否显示节点分配到 Pool 的信息" -ForegroundColor White
Write-Host "   - 如果节点有语义修复服务，应该能看到语言对列表" -ForegroundColor White
Write-Host "   - 如果节点没有语义修复服务，应该能看到空的语言对列表" -ForegroundColor White
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "测试完成" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
