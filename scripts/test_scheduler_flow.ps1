# 调度服务器流程测试脚本

$SCHEDULER_URL = if ($env:SCHEDULER_URL) { $env:SCHEDULER_URL } else { "http://localhost:5010" }
$passCount = 0
$failCount = 0

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "调度服务器流程测试" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "调度服务器地址: $SCHEDULER_URL" -ForegroundColor Gray
Write-Host ""

function Test-Endpoint {
    param (
        [string]$Name,
        [string]$Url,
        [int]$ExpectedStatus = 200,
        [switch]$ShowContent
    )
    
    try {
        $response = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($response.StatusCode -eq $ExpectedStatus) {
            Write-Host "✓ $Name" -ForegroundColor Green
            if ($ShowContent) {
                $content = $response.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($content) {
                    Write-Host "  响应内容:" -ForegroundColor Gray
                    $content | ConvertTo-Json -Depth 3 | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
                } else {
                    Write-Host "  响应: $($response.Content)" -ForegroundColor White
                }
            }
            $script:passCount++
            return $true
        } else {
            Write-Host "✗ $Name - 状态码: $($response.StatusCode), 期望: $ExpectedStatus" -ForegroundColor Red
            $script:failCount++
            return $false
        }
    } catch {
        Write-Host "✗ $Name - 错误: $($_.Exception.Message)" -ForegroundColor Red
        $script:failCount++
        return $false
    }
}

# 1. 健康检查
Write-Host "1. 测试健康检查端点..." -ForegroundColor Yellow
Test-Endpoint "健康检查 (/health)" "$SCHEDULER_URL/health" -ShowContent
Write-Host ""

# 2. 统计信息
Write-Host "2. 测试统计信息端点..." -ForegroundColor Yellow
Test-Endpoint "统计信息 (/api/v1/stats)" "$SCHEDULER_URL/api/v1/stats" -ShowContent
Write-Host ""

# 3. 指标信息
Write-Host "3. 测试指标端点..." -ForegroundColor Yellow
Test-Endpoint "指标信息 (/api/v1/metrics)" "$SCHEDULER_URL/api/v1/metrics" -ShowContent
Write-Host ""

# 4. Phase3 Pool 状态
Write-Host "4. 测试 Phase3 Pool 状态..." -ForegroundColor Yellow
Test-Endpoint "Phase3 Pool 状态 (/api/v1/phase3/pools)" "$SCHEDULER_URL/api/v1/phase3/pools" -ShowContent
Write-Host ""

# 5. 集群状态
Write-Host "5. 测试集群状态..." -ForegroundColor Yellow
Test-Endpoint "集群状态 (/api/v1/cluster)" "$SCHEDULER_URL/api/v1/cluster" -ShowContent
Write-Host ""

# 6. Prometheus 指标
Write-Host "6. 测试 Prometheus 指标..." -ForegroundColor Yellow
Test-Endpoint "Prometheus 指标 (/metrics)" "$SCHEDULER_URL/metrics"
Write-Host ""

# 7. 模拟调度（zh -> en）
Write-Host "7. 测试调度模拟（zh -> en）..." -ForegroundColor Yellow
$simulateUrl = "$SCHEDULER_URL/api/v1/phase3/simulate?routing_key=test`&src_lang=zh`&tgt_lang=en`&required=asr`&required=nmt`&required=tts"
Test-Endpoint "调度模拟 (zh -> en)" $simulateUrl -ShowContent
Write-Host ""

# 8. 模拟调度（auto -> en）
Write-Host "8. 测试调度模拟（auto -> en）..." -ForegroundColor Yellow
$simulateUrlAuto = "$SCHEDULER_URL/api/v1/phase3/simulate?routing_key=test`&src_lang=auto`&tgt_lang=en`&required=asr`&required=nmt`&required=tts"
Test-Endpoint "调度模拟 (auto -> en)" $simulateUrlAuto -ShowContent
Write-Host ""

# 9. 检查日志中的 Pool 信息
Write-Host "9. 检查调度服务器日志中的 Pool 信息..." -ForegroundColor Yellow
$schedulerLogPath = "central_server\scheduler\logs"
if (Test-Path $schedulerLogPath) {
    $latestLog = Get-ChildItem -Path $schedulerLogPath -Filter "*.log" -ErrorAction SilentlyContinue | 
                 Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestLog) {
        Write-Host "  最新日志文件: $($latestLog.Name)" -ForegroundColor Gray
        $poolLogs = Get-Content $latestLog.FullName -Tail 100 -ErrorAction SilentlyContinue | 
                    Select-String -Pattern "Pool|pool|语言|language|auto_generate|自动生成|find_pools" -Context 0,1
        if ($poolLogs) {
            Write-Host "  找到 Pool 相关日志:" -ForegroundColor Green
            $poolLogs | Select-Object -First 10 | ForEach-Object { 
                Write-Host "  $_" -ForegroundColor White 
            }
        } else {
            Write-Host "  未找到 Pool 相关日志" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  未找到日志文件" -ForegroundColor Yellow
    }
} else {
    Write-Host "  日志目录不存在: $schedulerLogPath" -ForegroundColor Yellow
}
Write-Host ""

# 10. 检查 Redis 连接
Write-Host "10. 检查 Redis 连接状态..." -ForegroundColor Yellow
try {
    $redisTest = redis-cli ping 2>&1
    if ($redisTest -match "PONG") {
        Write-Host "✓ Redis 连接正常" -ForegroundColor Green
        $script:passCount++
        
        # 检查 Redis 中的 Pool 信息
        Write-Host "  检查 Redis 中的 Pool 配置..." -ForegroundColor Gray
        $poolKeys = redis-cli KEYS "lingua:phase3:pool:*" 2>&1
        if ($poolKeys -and $poolKeys.Count -gt 0) {
            Write-Host "  找到 $($poolKeys.Count) 个 Pool 配置键" -ForegroundColor Green
            $poolKeys | Select-Object -First 5 | ForEach-Object {
                Write-Host "    $_" -ForegroundColor White
            }
        } else {
            Write-Host "  未找到 Pool 配置键" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✗ Redis 连接异常: $redisTest" -ForegroundColor Red
        $script:failCount++
    }
} catch {
    Write-Host "✗ Redis 未安装或未启动" -ForegroundColor Red
    Write-Host "  错误: $_" -ForegroundColor Red
    $script:failCount++
}
Write-Host ""

# 测试总结
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "测试总结" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "通过: $passCount" -ForegroundColor Green
Write-Host "失败: $failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($failCount -eq 0) {
    Write-Host "✓ 所有测试通过！" -ForegroundColor Green
} else {
    Write-Host "✗ 部分测试失败，请检查：" -ForegroundColor Red
    Write-Host "  1. 调度服务器是否正常运行" -ForegroundColor Yellow
    Write-Host "  2. Redis 是否正常运行" -ForegroundColor Yellow
    Write-Host "  3. 配置文件中 Phase3 是否启用" -ForegroundColor Yellow
    Write-Host "  4. 是否有节点已注册" -ForegroundColor Yellow
}

Write-Host ""
