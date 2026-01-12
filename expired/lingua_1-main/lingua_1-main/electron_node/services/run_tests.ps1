# 运行所有服务端单元测试
# Run all service unit tests

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Running Service Unit Tests" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 测试en_normalize服务
Write-Host "Testing en_normalize service..." -ForegroundColor Yellow
Set-Location en_normalize
if (Test-Path "test_normalizer.py") {
    python -m pytest test_normalizer.py -v
    if ($LASTEXITCODE -ne 0) {
        Write-Host "en_normalize tests failed!" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
} else {
    Write-Host "test_normalizer.py not found, skipping..." -ForegroundColor Yellow
}
Set-Location ..

Write-Host ""

# 测试semantic_repair_zh服务
Write-Host "Testing semantic_repair_zh service..." -ForegroundColor Yellow
Set-Location semantic_repair_zh
if (Test-Path "test_prompt_templates.py") {
    python -m pytest test_prompt_templates.py -v
    if ($LASTEXITCODE -ne 0) {
        Write-Host "semantic_repair_zh prompt_templates tests failed!" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
}
if (Test-Path "test_repair_engine.py") {
    python -m pytest test_repair_engine.py -v
    if ($LASTEXITCODE -ne 0) {
        Write-Host "semantic_repair_zh repair_engine tests failed!" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
}
Set-Location ..

Write-Host ""

# 测试semantic_repair_en服务
Write-Host "Testing semantic_repair_en service..." -ForegroundColor Yellow
Set-Location semantic_repair_en
if (Test-Path "test_prompt_templates.py") {
    python -m pytest test_prompt_templates.py -v
    if ($LASTEXITCODE -ne 0) {
        Write-Host "semantic_repair_en prompt_templates tests failed!" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
}
if (Test-Path "test_repair_engine.py") {
    python -m pytest test_repair_engine.py -v
    if ($LASTEXITCODE -ne 0) {
        Write-Host "semantic_repair_en repair_engine tests failed!" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
}
Set-Location ..

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "All tests completed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
