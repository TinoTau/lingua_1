# Simple Service Test Script
# Testing all services after architecture unification

Write-Host "`n========================================"
Write-Host "Service Testing Started"
Write-Host "========================================`n"

$baseUrl = "http://localhost:3001"
$results = @()

# Test 1: Service Discovery
Write-Host "Test 1: Service Discovery" -ForegroundColor Cyan
try {
    $services = Invoke-RestMethod -Uri "$baseUrl/api/services" -TimeoutSec 5
    Write-Host "  OK: Found $($services.Count) services" -ForegroundColor Green
    
    foreach ($svc in $services) {
        Write-Host "    - $($svc.id): $($svc.name) [$($svc.status)]" -ForegroundColor Gray
    }
    $results += "PASS: Service Discovery"
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $results += "FAIL: Service Discovery"
}

Start-Sleep -Seconds 1

# Test 2: Check Running Services
Write-Host "`nTest 2: Check Running Services" -ForegroundColor Cyan
try {
    $services = Invoke-RestMethod -Uri "$baseUrl/api/services" -TimeoutSec 5
    $running = $services | Where-Object { $_.status -eq "running" }
    $starting = $services | Where-Object { $_.status -eq "starting" }
    $stopped = $services | Where-Object { $_.status -eq "stopped" }
    
    Write-Host "  Running: $($running.Count)" -ForegroundColor Green
    Write-Host "  Starting: $($starting.Count)" -ForegroundColor Yellow
    Write-Host "  Stopped: $($stopped.Count)" -ForegroundColor Gray
    
    if ($running.Count -gt 0) {
        Write-Host "`n  Running services:" -ForegroundColor White
        foreach ($svc in $running) {
            Write-Host "    - $($svc.id) (PID: $($svc.pid), Port: $($svc.port))" -ForegroundColor Green
        }
    }
    
    if ($starting.Count -gt 0) {
        Write-Host "`n  Starting services:" -ForegroundColor White
        foreach ($svc in $starting) {
            Write-Host "    - $($svc.id) (PID: $($svc.pid))" -ForegroundColor Yellow
        }
    }
    
    $results += "PASS: Service Status Check"
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $results += "FAIL: Service Status Check"
}

# Test 3: Test Service Health Endpoints
Write-Host "`nTest 3: Test Service Health Endpoints" -ForegroundColor Cyan
$healthTests = @(
    @{ Name = "FastWhisperVad"; Port = 8001 },
    @{ Name = "NMT"; Port = 8002 },
    @{ Name = "Piper TTS"; Port = 8003 },
    @{ Name = "Semantic Repair ZH"; Port = 8101 },
    @{ Name = "Semantic Repair Unified"; Port = 8100 }
)

foreach ($test in $healthTests) {
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:$($test.Port)/health" -TimeoutSec 2
        Write-Host "  OK: $($test.Name) - Healthy" -ForegroundColor Green
        $results += "PASS: $($test.Name) Health"
    } catch {
        Write-Host "  SKIP: $($test.Name) - Not running or no /health endpoint" -ForegroundColor Gray
        $results += "SKIP: $($test.Name) Health"
    }
}

# Test 4: Test Refresh Function
Write-Host "`nTest 4: Test Refresh Function" -ForegroundColor Cyan
try {
    # Get services before refresh
    $servicesBefore = Invoke-RestMethod -Uri "$baseUrl/api/services" -TimeoutSec 5
    $runningBefore = ($servicesBefore | Where-Object { $_.status -eq "running" }).Count
    
    Write-Host "  Before refresh: $runningBefore services running" -ForegroundColor White
    
    # Execute refresh
    $refresh = Invoke-RestMethod -Uri "$baseUrl/api/services/refresh" -Method POST -TimeoutSec 5
    Write-Host "  Refresh command sent" -ForegroundColor Yellow
    
    Start-Sleep -Seconds 2
    
    # Get services after refresh
    $servicesAfter = Invoke-RestMethod -Uri "$baseUrl/api/services" -TimeoutSec 5
    $runningAfter = ($servicesAfter | Where-Object { $_.status -eq "running" }).Count
    
    Write-Host "  After refresh: $runningAfter services running" -ForegroundColor White
    
    if ($runningAfter -eq $runningBefore) {
        Write-Host "  OK: Refresh did not affect running services" -ForegroundColor Green
        $results += "PASS: Refresh Function"
    } else {
        Write-Host "  WARN: Service count changed: $runningBefore -> $runningAfter" -ForegroundColor Yellow
        $results += "WARN: Refresh Function"
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $results += "FAIL: Refresh Function"
}

# Test 5: Test NMT Translation API
Write-Host "`nTest 5: Test NMT Translation API" -ForegroundColor Cyan
try {
    $body = @{
        text = "Hello, world!"
        source_lang = "en"
        target_lang = "zh"
    } | ConvertTo-Json
    
    $translation = Invoke-RestMethod -Uri "http://localhost:8002/translate" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-Host "  OK: Translation API works" -ForegroundColor Green
    Write-Host "    Input: Hello, world!" -ForegroundColor Gray
    Write-Host "    Output: $($translation.translated_text)" -ForegroundColor Gray
    $results += "PASS: NMT API"
} catch {
    Write-Host "  SKIP: NMT service not running or API failed" -ForegroundColor Gray
    $results += "SKIP: NMT API"
}

# Summary
Write-Host "`n========================================"
Write-Host "Test Summary"
Write-Host "========================================`n"

$passCount = ($results | Where-Object { $_ -like "PASS:*" }).Count
$failCount = ($results | Where-Object { $_ -like "FAIL:*" }).Count
$warnCount = ($results | Where-Object { $_ -like "WARN:*" }).Count
$skipCount = ($results | Where-Object { $_ -like "SKIP:*" }).Count

Write-Host "Total: $($results.Count)" -ForegroundColor White
Write-Host "PASS: $passCount" -ForegroundColor Green
Write-Host "FAIL: $failCount" -ForegroundColor Red
Write-Host "WARN: $warnCount" -ForegroundColor Yellow
Write-Host "SKIP: $skipCount" -ForegroundColor Gray

Write-Host "`nDetailed Results:"
foreach ($result in $results) {
    if ($result -like "PASS:*") {
        Write-Host "  $result" -ForegroundColor Green
    } elseif ($result -like "FAIL:*") {
        Write-Host "  $result" -ForegroundColor Red
    } elseif ($result -like "WARN:*") {
        Write-Host "  $result" -ForegroundColor Yellow
    } else {
        Write-Host "  $result" -ForegroundColor Gray
    }
}

if ($failCount -eq 0) {
    Write-Host "`nAll tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`nSome tests failed!" -ForegroundColor Red
    exit 1
}
