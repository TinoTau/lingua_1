# Semantic Repair Service Correct API Test
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Semantic Repair Service Testing" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Waiting for models to load..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
Write-Host ""

# Test semantic-repair-zh (Port 5013)
Write-Host "Testing semantic-repair-zh (Port 5013)..." -ForegroundColor Cyan

$zhRequest = @{
    job_id = "test-zh-001"
    session_id = "session-001"        # Required field!
    utterance_index = 0
    text_in = "ni hao shi jie"
    quality_score = 0.8
} | ConvertTo-Json

try {
    $zhResult = Invoke-RestMethod -Uri "http://localhost:5013/repair" -Method POST -Body $zhRequest -ContentType "application/json" -TimeoutSec 30
    Write-Host "  SUCCESS" -ForegroundColor Green
    Write-Host "  Decision: $($zhResult.decision)" -ForegroundColor Gray
    Write-Host "  Text out: $($zhResult.text_out)" -ForegroundColor Gray
    Write-Host "  Confidence: $($zhResult.confidence)" -ForegroundColor Gray
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""

# Test semantic-repair-en-zh (Port 5015)
Write-Host "Testing semantic-repair-en-zh (Port 5015)..." -ForegroundColor Cyan

# Chinese repair test
$zhRepairRequest = @{
    job_id = "test-enzh-zh-001"
    session_id = "session-002"
    utterance_index = 0
    text_in = "wo xiang qu bei jing"
    quality_score = 0.8
} | ConvertTo-Json

try {
    $zhRepairResult = Invoke-RestMethod -Uri "http://localhost:5015/zh/repair" -Method POST -Body $zhRepairRequest -ContentType "application/json" -TimeoutSec 30
    Write-Host "  /zh/repair SUCCESS" -ForegroundColor Green
    Write-Host "  Decision: $($zhRepairResult.decision)" -ForegroundColor Gray
    Write-Host "  Text out: $($zhRepairResult.text_out)" -ForegroundColor Gray
} catch {
    Write-Host "  /zh/repair FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""

# English normalize test
$enNormRequest = @{
    job_id = "test-enzh-en-001"
    session_id = "session-003"
    utterance_index = 0
    text_in = "i want to go to new york"
    quality_score = 0.8
} | ConvertTo-Json

try {
    $enNormResult = Invoke-RestMethod -Uri "http://localhost:5015/en/normalize" -Method POST -Body $enNormRequest -ContentType "application/json" -TimeoutSec 30
    Write-Host "  /en/normalize SUCCESS" -ForegroundColor Green
    Write-Host "  Decision: $($enNormResult.decision)" -ForegroundColor Gray
    Write-Host "  Text out: $($enNormResult.text_out)" -ForegroundColor Gray
} catch {
    Write-Host "  /en/normalize FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "API Model Requirements:" -ForegroundColor White
Write-Host "  - job_id: string (required)" -ForegroundColor Gray
Write-Host "  - session_id: string (required)" -ForegroundColor Yellow
Write-Host "  - text_in: string (required)" -ForegroundColor Gray
Write-Host "  - utterance_index: int (optional, default: 0)" -ForegroundColor Gray
Write-Host "  - quality_score: float (optional)" -ForegroundColor Gray
Write-Host ""
