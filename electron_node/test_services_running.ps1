# Test currently running services with actual ports
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Testing Running Services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Detect actual service ports from netstat
Write-Host "Detecting service ports..." -ForegroundColor Yellow
$ports = netstat -ano | Select-String "LISTENING" | Select-String "python|uvicorn"
Write-Host "Active ports: $ports" -ForegroundColor Gray
Write-Host ""

$testResults = @()

function Test-Service {
    param([string]$Name, [string]$Port, [string]$HealthPath = "/health")
    
    try {
        $url = "http://localhost:$Port$HealthPath"
        Write-Host "[Testing] $Name on port $Port" -ForegroundColor Yellow
        $response = Invoke-RestMethod -Uri $url -TimeoutSec 5
        Write-Host "  SUCCESS - $($response | ConvertTo-Json -Compress)" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  FAILED - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Test common ports
Write-Host "Testing NMT on port 5003..." -ForegroundColor Cyan
Test-Service -Name "NMT (5003)" -Port "5003"

Write-Host "Testing NMT on port 5008..." -ForegroundColor Cyan
Test-Service -Name "NMT (5008)" -Port "5008"

Write-Host ""
Write-Host "Testing TTS on port 5005..." -ForegroundColor Cyan
Test-Service -Name "TTS (5005)" -Port "5005"

Write-Host ""
Write-Host "Testing VAD on port 5001..." -ForegroundColor Cyan
Test-Service -Name "VAD (5001)" -Port "5001"

Write-Host "Testing VAD on port 6007..." -ForegroundColor Cyan
Test-Service -Name "VAD (6007)" -Port "6007"

Write-Host ""
Write-Host "Testing Semantic Repair on port 5015..." -ForegroundColor Cyan
Test-Service -Name "Semantic Repair (5015)" -Port "5015"

Write-Host "Testing Semantic Repair on port 5013..." -ForegroundColor Cyan
Test-Service -Name "Semantic Repair (5013)" -Port "5013"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Quick Functional Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test NMT translation (try both ports)
foreach ($port in @("5003", "5008")) {
    try {
        Write-Host "[Testing] NMT Translation on port $port..." -ForegroundColor Yellow
        $nmtBody = @{
            text = "Hello world"
            src_lang = "en"
            tgt_lang = "zh"
            context_text = ""
        } | ConvertTo-Json
        
        $nmtResult = Invoke-RestMethod -Uri "http://localhost:$port/v1/translate" -Method POST -Body $nmtBody -ContentType "application/json" -TimeoutSec 30
        
        if ($nmtResult.ok) {
            Write-Host "  SUCCESS - Translated: '$($nmtResult.translated_text)'" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "  Port $port not responding" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Memory Usage Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$pythonProcesses = Get-Process | Where-Object { $_.ProcessName -eq "python" }
$totalMemoryMB = ($pythonProcesses | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB

Write-Host "Python processes: $($pythonProcesses.Count)" -ForegroundColor Cyan
Write-Host "Total memory usage: $([Math]::Round($totalMemoryMB, 2)) MB" -ForegroundColor $(if ($totalMemoryMB -gt 8000) { "Red" } else { "Green" })
Write-Host ""

$pythonProcesses | Select-Object Id, @{N='Memory(MB)';E={[Math]::Round($_.WorkingSet64/1MB,2)}}, CPU | Sort-Object 'Memory(MB)' -Descending | Format-Table -AutoSize

Write-Host ""
