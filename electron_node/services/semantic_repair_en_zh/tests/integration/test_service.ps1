# 统一语义修复服务 - 快速测试
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Unified Semantic Repair Service - Quick Test" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://127.0.0.1:5015"

# 1. 检查端口
Write-Host "[1/5] Checking port 5015..." -ForegroundColor Yellow
$portCheck = netstat -ano | findstr ":5015"
if ($portCheck) {
    Write-Host "  ✓ Port 5015 is in use" -ForegroundColor Green
} else {
    Write-Host "  ✗ Port 5015 is not in use (service may not be running)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 2. 检查健康状态
Write-Host "[2/5] Checking health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 5
    Write-Host "  ✓ Health check passed" -ForegroundColor Green
    Write-Host "    Status: $($health.status)" -ForegroundColor Cyan
    Write-Host "    Processors:" -ForegroundColor Cyan
    foreach ($proc in $health.processors.PSObject.Properties) {
        Write-Host "      - $($proc.Name): $($proc.Value.status)" -ForegroundColor Gray
    }
    if ($health.status -eq "healthy") {
        Write-Host "  ✓ Service is ready!" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Service is not fully ready" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ✗ Health check failed: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 3. 测试中文修复
Write-Host "[3/5] Testing Chinese repair..." -ForegroundColor Yellow
try {
    $testText = "你号，这是一个测试。"
    $body = @{
        job_id = "test_zh_001"
        session_id = "test_session_001"
        text_in = $testText
    } | ConvertTo-Json -Compress
    
    $result = Invoke-RestMethod -Uri "$baseUrl/zh/repair" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    Write-Host "  ✓ Chinese repair test passed" -ForegroundColor Green
    Write-Host "    Input:  $testText" -ForegroundColor Gray
    Write-Host "    Output: $($result.text_out)" -ForegroundColor Gray
    Write-Host "    Decision: $($result.decision)" -ForegroundColor Cyan
    Write-Host "    Time: $($result.process_time_ms) ms" -ForegroundColor Cyan
} catch {
    Write-Host "  ✗ Chinese repair test failed: $_" -ForegroundColor Red
}
Write-Host ""

# 4. 测试英文修复
Write-Host "[4/5] Testing English repair..." -ForegroundColor Yellow
try {
    $testText = "Helo, this is a test."
    $body = @{
        job_id = "test_en_001"
        session_id = "test_session_001"
        text_in = $testText
    } | ConvertTo-Json -Compress
    
    $result = Invoke-RestMethod -Uri "$baseUrl/en/repair" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    Write-Host "  ✓ English repair test passed" -ForegroundColor Green
    Write-Host "    Input:  $testText" -ForegroundColor Gray
    Write-Host "    Output: $($result.text_out)" -ForegroundColor Gray
    Write-Host "    Decision: $($result.decision)" -ForegroundColor Cyan
    Write-Host "    Time: $($result.process_time_ms) ms" -ForegroundColor Cyan
} catch {
    Write-Host "  ✗ English repair test failed: $_" -ForegroundColor Red
}
Write-Host ""

# 5. 测试英文标准化
Write-Host "[5/5] Testing English normalization..." -ForegroundColor Yellow
try {
    $testText = "HELLO  WORLD !!!"
    $body = @{
        job_id = "test_norm_001"
        session_id = "test_session_001"
        text_in = $testText
    } | ConvertTo-Json -Compress
    
    $result = Invoke-RestMethod -Uri "$baseUrl/en/normalize" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    Write-Host "  ✓ English normalization test passed" -ForegroundColor Green
    Write-Host "    Input:  $testText" -ForegroundColor Gray
    Write-Host "    Output: $($result.text_out)" -ForegroundColor Gray
    Write-Host "    Decision: $($result.decision)" -ForegroundColor Cyan
    Write-Host "    Time: $($result.process_time_ms) ms" -ForegroundColor Cyan
} catch {
    Write-Host "  ✗ English normalization test failed: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "✅ Test completed!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
