# 快速测试脚本 - 验证调度服务器和基本功能

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "调度服务器快速测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$SCHEDULER_URL = "http://localhost:5010"
$passCount = 0
$failCount = 0

function Test-Endpoint {
    param (
        [string]$Name,
        [string]$Url,
        [int]$ExpectedStatus = 200
    )
    
    try {
        $response = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($response.StatusCode -eq $ExpectedStatus) {
            Write-Host "✓ $Name" -ForegroundColor Green
            $script:passCount++
            return $true
        } else {
            Write-Host "✗ $Name - 状态码: $($response.StatusCode)" -ForegroundColor Red
            $script:failCount++
            return $false
        }
    } catch {
        Write-Host "✗ $Name - 错误: $($_.Exception.Message)" -ForegroundColor Red
        $script:failCount++
        return $false
    }
}

Write-Host "`n1. 测试健康检查端点..." -ForegroundColor Yellow
Test-Endpoint "健康检查 (/health)" "$SCHEDULER_URL/health"

Write-Host "`n2. 测试统计端点..." -ForegroundColor Yellow
Test-Endpoint "统计端点 (/api/stats)" "$SCHEDULER_URL/api/stats"

Write-Host "`n3. 测试指标端点..." -ForegroundColor Yellow
Test-Endpoint "指标端点 (/metrics)" "$SCHEDULER_URL/metrics"

Write-Host "`n4. 测试集群端点..." -ForegroundColor Yellow
Test-Endpoint "集群端点 (/api/cluster/stats)" "$SCHEDULER_URL/api/cluster/stats"

Write-Host "`n5. 编译检查..." -ForegroundColor Yellow
try {
    $output = cargo build --lib 2>&1 | Out-String
    if ($output -match "Finished") {
        Write-Host "✓ 代码编译成功" -ForegroundColor Green
        $passCount++
    } else {
        Write-Host "✗ 代码编译失败" -ForegroundColor Red
        $failCount++
    }
} catch {
    Write-Host "✗ 编译检查失败: $_" -ForegroundColor Red
    $failCount++
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "测试结果" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "通过: $passCount" -ForegroundColor Green
Write-Host "失败: $failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })

if ($failCount -eq 0) {
    Write-Host "`n✓ 所有测试通过！服务器运行正常。" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n✗ 部分测试失败，请检查服务器状态。" -ForegroundColor Red
    exit 1
}
