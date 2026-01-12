# 语言能力 Pool 和任务分配测试脚本

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "语言能力 Pool 和任务分配测试" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查调度服务器日志中的 Pool 生成信息
Write-Host "1. 检查调度服务器日志中的 Pool 生成信息..." -ForegroundColor Yellow
$schedulerLogPath = "central_server\scheduler\logs"
if (Test-Path $schedulerLogPath) {
    $latestLog = Get-ChildItem -Path $schedulerLogPath -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "   最新日志文件: $($latestLog.Name)" -ForegroundColor Gray
        $poolLogs = Get-Content $latestLog.FullName -Tail 200 | Select-String -Pattern "Pool|pool|语言对|auto_generate|自动生成" -Context 1
        if ($poolLogs) {
            Write-Host "   找到 Pool 相关日志:" -ForegroundColor Green
            $poolLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   未找到 Pool 相关日志" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   未找到日志文件" -ForegroundColor Yellow
    }
} else {
    Write-Host "   日志目录不存在: $schedulerLogPath" -ForegroundColor Yellow
}
Write-Host ""

# 2. 检查节点端日志中的语言能力检测信息
Write-Host "2. 检查节点端日志中的语言能力检测信息..." -ForegroundColor Yellow
$nodeLogPath = "electron_node\electron-node\logs"
if (Test-Path $nodeLogPath) {
    $latestLog = Get-ChildItem -Path $nodeLogPath -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "   最新日志文件: $($latestLog.Name)" -ForegroundColor Gray
        $capabilityLogs = Get-Content $latestLog.FullName -Tail 200 | Select-String -Pattern "language|Language|capability|语言能力" -Context 1
        if ($capabilityLogs) {
            Write-Host "   找到语言能力相关日志:" -ForegroundColor Green
            $capabilityLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   未找到语言能力相关日志" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   未找到日志文件" -ForegroundColor Yellow
    }
} else {
    Write-Host "   日志目录不存在: $nodeLogPath" -ForegroundColor Yellow
}
Write-Host ""

# 3. 检查节点注册信息
Write-Host "3. 检查节点注册信息..." -ForegroundColor Yellow
if (Test-Path $schedulerLogPath) {
    $latestLog = Get-ChildItem -Path $schedulerLogPath -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        $registerLogs = Get-Content $latestLog.FullName -Tail 200 | Select-String -Pattern "node_register|Node.*registered|注册" -Context 2
        if ($registerLogs) {
            Write-Host "   找到节点注册日志:" -ForegroundColor Green
            $registerLogs | ForEach-Object { Write-Host "   $_" -ForegroundColor White }
        } else {
            Write-Host "   未找到节点注册日志" -ForegroundColor Yellow
        }
    }
}
Write-Host ""

# 4. 使用测试脚本测试语言任务分配
Write-Host "4. 测试语言任务分配..." -ForegroundColor Yellow
$testScriptPath = "electron_node\services\test\test_translation_pipeline.py"
if (Test-Path $testScriptPath) {
    Write-Host "   测试脚本存在: $testScriptPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "   请手动运行以下命令进行测试:" -ForegroundColor Yellow
    Write-Host "   cd electron_node\services\test" -ForegroundColor White
    Write-Host "   python test_translation_pipeline.py --audio chinese.wav --src-lang zh --tgt-lang en" -ForegroundColor White
    Write-Host "   python test_translation_pipeline.py --audio english.wav --src-lang en --tgt-lang zh" -ForegroundColor White
} else {
    Write-Host "   测试脚本不存在: $testScriptPath" -ForegroundColor Yellow
}
Write-Host ""

# 5. 检查调度服务器配置
Write-Host "5. 检查调度服务器配置..." -ForegroundColor Yellow
$configPath = "central_server\scheduler\config.toml"
if (Test-Path $configPath) {
    Write-Host "   配置文件存在: $configPath" -ForegroundColor Green
    $configContent = Get-Content $configPath -Raw
    if ($configContent -match "auto_generate_language_pools\s*=\s*true") {
        Write-Host "   ✓ 自动 Pool 生成已启用" -ForegroundColor Green
    } else {
        Write-Host "   ✗ 自动 Pool 生成未启用" -ForegroundColor Red
        Write-Host "     请在 config.toml 中设置: auto_generate_language_pools = true" -ForegroundColor Yellow
    }
} else {
    Write-Host "   配置文件不存在: $configPath" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "测试检查完成" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步操作:" -ForegroundColor Yellow
Write-Host "1. 检查上述日志输出，确认 Pool 生成和节点注册" -ForegroundColor White
Write-Host "2. 运行测试脚本验证语言任务分配" -ForegroundColor White
Write-Host "3. 观察调度服务器日志中的任务分配信息" -ForegroundColor White
Write-Host ""
