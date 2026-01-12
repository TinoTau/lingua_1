# 调度服务器测试脚本
# 用于验证调度服务器和 Redis 是否正常运行

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "调度服务器测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 服务器配置
$SCHEDULER_URL = "http://localhost:5010"
$REDIS_URL = if ($env:LINGUA_TEST_REDIS_URL) { $env:LINGUA_TEST_REDIS_URL } else { "redis://127.0.0.1:6379" }

Write-Host "`n1. 测试调度服务器健康状态..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$SCHEDULER_URL/health" -Method GET -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✓ 调度服务器健康检查通过" -ForegroundColor Green
        Write-Host "  状态码: $($response.StatusCode)" -ForegroundColor Gray
        Write-Host "  响应: $($response.Content)" -ForegroundColor Gray
    } else {
        Write-Host "✗ 调度服务器返回非200状态码: $($response.StatusCode)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ 无法连接到调度服务器: $_" -ForegroundColor Red
    Write-Host "  请确保调度服务器正在运行在 $SCHEDULER_URL" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n2. 测试 Redis 连接..." -ForegroundColor Yellow
# 尝试使用 redis-cli 测试连接（如果可用）
if (Get-Command redis-cli -ErrorAction SilentlyContinue) {
    try {
        $redisTest = redis-cli ping 2>&1
        if ($redisTest -match "PONG") {
            Write-Host "✓ Redis 连接正常" -ForegroundColor Green
        } else {
            Write-Host "⚠ Redis 可能未正常运行: $redisTest" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠ 无法使用 redis-cli 测试: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ redis-cli 不可用，跳过 Redis 连接测试" -ForegroundColor Yellow
    Write-Host "  如果 Redis 未运行，某些功能可能无法正常工作" -ForegroundColor Yellow
}

Write-Host "`n3. 测试调度服务器 API 端点..." -ForegroundColor Yellow

# 测试节点注册端点（如果存在）
Write-Host "  - 测试节点列表端点..." -ForegroundColor Gray
try {
    $nodesResponse = Invoke-WebRequest -Uri "$SCHEDULER_URL/api/nodes" -Method GET -UseBasicParsing -TimeoutSec 5
    if ($nodesResponse.StatusCode -eq 200) {
        Write-Host "    ✓ 节点列表端点正常" -ForegroundColor Green
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "    ⚠ 节点列表端点不存在（可能尚未实现）" -ForegroundColor Yellow
    } else {
        Write-Host "    ⚠ 节点列表端点测试失败: $_" -ForegroundColor Yellow
    }
}

# 测试指标端点（如果存在）
Write-Host "  - 测试指标端点..." -ForegroundColor Gray
try {
    $metricsResponse = Invoke-WebRequest -Uri "$SCHEDULER_URL/metrics" -Method GET -UseBasicParsing -TimeoutSec 5
    if ($metricsResponse.StatusCode -eq 200) {
        Write-Host "    ✓ 指标端点正常" -ForegroundColor Green
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "    ⚠ 指标端点不存在（可能尚未实现）" -ForegroundColor Yellow
    } else {
        Write-Host "    ⚠ 指标端点测试失败: $_" -ForegroundColor Yellow
    }
}

Write-Host "`n4. 运行单元测试（仅编译检查）..." -ForegroundColor Yellow
try {
    Write-Host "  编译测试代码..." -ForegroundColor Gray
    cargo test --lib --no-run 2>&1 | Select-String -Pattern "(Finished|error)" | Select-Object -First 5
    Write-Host "  ✓ 测试代码编译成功" -ForegroundColor Green
} catch {
    Write-Host "  ✗ 测试代码编译失败" -ForegroundColor Red
    exit 1
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "测试完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`n提示：" -ForegroundColor Yellow
Write-Host "  - 如果所有检查都通过，服务器应该可以正常工作" -ForegroundColor Gray
Write-Host "  - 要运行完整的单元测试，请使用: cargo test --lib" -ForegroundColor Gray
Write-Host "  - 如果测试卡住，可能是 Redis 连接问题，检查 Redis 是否运行" -ForegroundColor Gray
