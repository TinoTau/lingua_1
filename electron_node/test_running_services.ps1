# Test services at their actual running ports

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Testing Running Services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Services are running on these ports:" -ForegroundColor Yellow
Write-Host "  - NMT: 5008 (config shows 5003)" -ForegroundColor Yellow
Write-Host "  - TTS: 5005 (correct)" -ForegroundColor Green
Write-Host "  - Semantic Repair ZH: 5013 (should be semantic-repair-en-zh on 5015)" -ForegroundColor Yellow
Write-Host "  - Faster Whisper VAD: 6007 (config shows 5001)" -ForegroundColor Yellow
Write-Host ""

# Test NMT at actual port 5008
Write-Host "[Test] NMT Health Check at port 5008" -ForegroundColor Cyan
try {
    $nmtHealth = Invoke-RestMethod -Uri "http://localhost:5008/health" -Method GET -TimeoutSec 5
    Write-Host "  SUCCESS: $($nmtHealth | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test NMT translation
Write-Host "[Test] NMT Translation" -ForegroundColor Cyan
try {
    $nmtReq = @{ text = "Hello world"; src_lang = "en"; tgt_lang = "zh"; context_text = "" } | ConvertTo-Json
    $nmtResp = Invoke-RestMethod -Uri "http://localhost:5008/v1/translate" -Method POST -Body $nmtReq -ContentType "application/json" -TimeoutSec 30
    Write-Host "  SUCCESS: ok=$($nmtResp.ok), translated='$($nmtResp.translated_text)'" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test TTS at port 5005
Write-Host "[Test] TTS Health Check" -ForegroundColor Cyan
try {
    $ttsHealth = Invoke-RestMethod -Uri "http://localhost:5005/health" -Method GET -TimeoutSec 5
    Write-Host "  SUCCESS: $($ttsHealth | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test Semantic Repair ZH at port 5013
Write-Host "[Test] Semantic Repair ZH Health Check at port 5013" -ForegroundColor Cyan
try {
    $srHealth = Invoke-RestMethod -Uri "http://localhost:5013/health" -Method GET -TimeoutSec 5
    Write-Host "  SUCCESS: $($srHealth | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test Semantic Repair ZH repair
Write-Host "[Test] Semantic Repair ZH Repair" -ForegroundColor Cyan
try {
    $srReq = @{ text_in = "Test text"; job_id = "test-001"; lang = "zh" } | ConvertTo-Json
    $srResp = Invoke-RestMethod -Uri "http://localhost:5013/repair" -Method POST -Body $srReq -ContentType "application/json" -TimeoutSec 30
    Write-Host "  SUCCESS: decision=$($srResp.decision), text_out='$($srResp.text_out)'" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test Faster Whisper VAD at port 6007
Write-Host "[Test] Faster Whisper VAD Health Check at port 6007" -ForegroundColor Cyan
try {
    $vadHealth = Invoke-RestMethod -Uri "http://localhost:6007/health" -Method GET -TimeoutSec 5
    Write-Host "  SUCCESS: $($vadHealth | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "           Port Configuration Issue" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "PROBLEM: Service ports don't match service.json configuration" -ForegroundColor Red
Write-Host ""
Write-Host "Expected vs Actual:" -ForegroundColor Yellow
Write-Host "  - NMT: 5003 (config) -> 5008 (actual)" -ForegroundColor Yellow
Write-Host "  - TTS: 5005 (config) -> 5005 (actual) OK" -ForegroundColor Green
Write-Host "  - VAD: 5001 (config) -> 6007 (actual)" -ForegroundColor Yellow
Write-Host "  - Semantic Repair: Need to check semantic-repair-en-zh status" -ForegroundColor Yellow
Write-Host ""
Write-Host "ACTION NEEDED:" -ForegroundColor Red
Write-Host "  1. Check why services are running on different ports" -ForegroundColor White
Write-Host "  2. Check if semantic-repair-en-zh is running (user mentioned it)" -ForegroundColor White
Write-Host "  3. Verify service.json port configuration" -ForegroundColor White
Write-Host ""
