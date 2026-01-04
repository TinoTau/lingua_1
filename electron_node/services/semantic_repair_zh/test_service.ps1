# 快速测试服务状态和功能
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Semantic Repair ZH Service - Quick Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查端口
Write-Host "[1/4] Checking port 5013..." -ForegroundColor Yellow
$portCheck = netstat -ano | findstr ":5013"
if ($portCheck) {
    Write-Host "  ✓ Port 5013 is in use" -ForegroundColor Green
    $portCheck | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
} else {
    Write-Host "  ✗ Port 5013 is not in use" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 2. 检查健康状态
Write-Host "[2/4] Checking health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:5013/health" -Method Get -TimeoutSec 5
    Write-Host "  ✓ Health check passed" -ForegroundColor Green
    Write-Host "    Status: $($health.status)" -ForegroundColor Cyan
    Write-Host "    Warmed: $($health.warmed)" -ForegroundColor Cyan
    if ($health.status -eq "healthy" -and $health.warmed -eq $true) {
        Write-Host "  ✓ Service is ready!" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Service is not fully ready" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ✗ Health check failed: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 3. 检查诊断信息
Write-Host "[3/4] Getting diagnostics..." -ForegroundColor Yellow
try {
    $diag = Invoke-RestMethod -Uri "http://127.0.0.1:5013/diagnostics" -Method Get -TimeoutSec 5
    Write-Host "  ✓ Diagnostics retrieved" -ForegroundColor Green
    Write-Host "    Device: $($diag.device)" -ForegroundColor Cyan
    if ($diag.llamacpp_engine) {
        Write-Host "    LlamaCpp Engine: $($diag.llamacpp_engine.status)" -ForegroundColor Cyan
        if ($diag.llamacpp_engine.model_path) {
            Write-Host "    Model Path: $($diag.llamacpp_engine.model_path)" -ForegroundColor Cyan
        }
    }
    if ($diag.gpu_memory_allocated_gb) {
        Write-Host "    GPU Memory: $([math]::Round($diag.gpu_memory_allocated_gb, 2)) GB" -ForegroundColor Cyan
    }
} catch {
    Write-Host "  ⚠️  Diagnostics failed: $_" -ForegroundColor Yellow
}
Write-Host ""

# 4. 测试修复功能
Write-Host "[4/4] Testing repair endpoint..." -ForegroundColor Yellow
try {
    $testText = "这是一个测试文本，包含一些错误。"
    $body = @{
        job_id = "test_job_001"
        session_id = "test_session_001"
        text_in = $testText
        lang = "zh"
    } | ConvertTo-Json
    
    $repair = Invoke-RestMethod -Uri "http://127.0.0.1:5013/repair" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 30
    Write-Host "  ✓ Repair test passed" -ForegroundColor Green
    Write-Host "    Input:  $testText" -ForegroundColor Gray
    Write-Host "    Output: $($repair.text_out)" -ForegroundColor Gray
    Write-Host "    Decision: $($repair.decision)" -ForegroundColor Cyan
    Write-Host "    Confidence: $($repair.confidence)" -ForegroundColor Cyan
    Write-Host "    Repair Time: $($repair.repair_time_ms) ms" -ForegroundColor Cyan
    if ($repair.reason_codes) {
        Write-Host "    Reason Codes: $($repair.reason_codes -join ', ')" -ForegroundColor Cyan
    }
} catch {
    Write-Host "  ✗ Repair test failed: $_" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "    Response: $responseBody" -ForegroundColor DarkYellow
    }
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Test completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
