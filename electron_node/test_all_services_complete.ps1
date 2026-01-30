# Complete Service API Testing Script
# Tests all 4 running services with correct ports

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Complete Service API Testing" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$totalTests = 0
$passedTests = 0

function Test-Api {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Method = "GET",
        [object]$Body = $null
    )
    
    $global:totalTests++
    
    try {
        Write-Host "[$global:totalTests] Testing: $Name" -ForegroundColor Yellow
        
        $params = @{
            Uri = $Url
            Method = $Method
            ContentType = "application/json"
            TimeoutSec = 30
        }
        
        if ($Body) {
            $params['Body'] = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-RestMethod @params
        Write-Host "    PASSED" -ForegroundColor Green
        Write-Host "    Response: $($response | ConvertTo-Json -Compress -Depth 2)" -ForegroundColor Gray
        $global:passedTests++
        return $response
    } catch {
        Write-Host "    FAILED: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
    finally {
        Write-Host ""
    }
}

Write-Host "Waiting for services to be fully ready..." -ForegroundColor Yellow
Write-Host "(Models may take 5-15 seconds to load)" -ForegroundColor Gray
Write-Host ""
Start-Sleep -Seconds 15

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  1. NMT Translation Service (Port 5008)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

Test-Api -Name "NMT Health Check" -Url "http://localhost:5008/health"

$nmtResult = Test-Api -Name "NMT Translate EN->ZH" -Url "http://localhost:5008/v1/translate" -Method POST -Body @{
    text = "Hello, world"
    src_lang = "en"
    tgt_lang = "zh"
    context_text = ""
}

if ($nmtResult -and $nmtResult.translated_text) {
    Write-Host "[Validation] Translation: '$($nmtResult.translated_text)'" -ForegroundColor Green
    Write-Host ""
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  2. TTS Service (Port 5005)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

Test-Api -Name "TTS Health Check" -Url "http://localhost:5005/health"
Test-Api -Name "TTS List Voices" -Url "http://localhost:5005/voices"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  3. VAD Service (Port 6007)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

Test-Api -Name "VAD Health Check" -Url "http://localhost:6007/health"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  4. Semantic Repair ZH (Port 5013)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

Test-Api -Name "Semantic ZH Health Check" -Url "http://localhost:5013/health"

$zhResult = Test-Api -Name "Semantic ZH Repair" -Url "http://localhost:5013/repair" -Method POST -Body @{
    text_in = "ni hao shi jie"
    job_id = "test-zh-001"
}

if ($zhResult -and $zhResult.text_out) {
    Write-Host "[Validation] Repaired: '$($zhResult.text_out)'" -ForegroundColor Green
    Write-Host ""
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  5. Semantic Repair EN-ZH (Port 5015)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

$healthEnZh = Test-Api -Name "Semantic EN-ZH Health Check" -Url "http://localhost:5015/health"

if ($healthEnZh) {
    Write-Host "[Health Status] $($healthEnZh.status)" -ForegroundColor $(if ($healthEnZh.status -eq 'healthy') {'Green'} else {'Yellow'})
    Write-Host ""
}

$zhRepairResult = Test-Api -Name "Chinese Repair (/zh/repair)" -Url "http://localhost:5015/zh/repair" -Method POST -Body @{
    text_in = "wo xiang qu bei jing"
    job_id = "test-zh-002"
    lang = "zh"
}

if ($zhRepairResult -and $zhRepairResult.text_out) {
    Write-Host "[Validation] Repaired: '$($zhRepairResult.text_out)'" -ForegroundColor Green
    Write-Host ""
}

$enNormResult = Test-Api -Name "English Normalize (/en/normalize)" -Url "http://localhost:5015/en/normalize" -Method POST -Body @{
    text_in = "i want to go to new york"
    job_id = "test-en-003"
    lang = "en"
}

if ($enNormResult -and $enNormResult.text_out) {
    Write-Host "[Validation] Normalized: '$($enNormResult.text_out)'" -ForegroundColor Green
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "           Test Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total Tests: $totalTests" -ForegroundColor Cyan
Write-Host "Passed: $passedTests" -ForegroundColor Green
Write-Host "Failed: $($totalTests - $passedTests)" -ForegroundColor $(if ($totalTests -eq $passedTests) {'Green'} else {'Red'})
Write-Host "Pass Rate: $([Math]::Round($passedTests / $totalTests * 100, 2))%" -ForegroundColor $(if ($totalTests -eq $passedTests) {'Green'} else {'Yellow'})
Write-Host ""

if ($totalTests -eq $passedTests) {
    Write-Host "All services working! Ready for integration tests!" -ForegroundColor Green
} else {
    Write-Host "Some services need attention" -ForegroundColor Yellow
}
Write-Host ""
