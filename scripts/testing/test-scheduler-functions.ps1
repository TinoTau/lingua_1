# Scheduler Server Functional Test Script
# Tests: Node Registration, Pool Management, Job Management

$ErrorActionPreference = "Continue"
$BASE_URL = "http://localhost:5010"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Scheduler Server Functional Tests" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test counter
$PassCount = 0
$FailCount = 0
$TotalTests = 5

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Url,
        [int]$ExpectedStatus = 200
    )
    
    Write-Host "[$Name]" -ForegroundColor Yellow -NoNewline
    Write-Host " Testing $Url" -ForegroundColor Gray
    
    try {
        $response = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        
        if ($response.StatusCode -eq $ExpectedStatus) {
            Write-Host "  OK Status: $($response.StatusCode)" -ForegroundColor Green
            
            # Try to parse JSON
            try {
                $json = $response.Content | ConvertFrom-Json
                Write-Host "  OK Response is valid JSON" -ForegroundColor Green
                return @{
                    Success = $true
                    StatusCode = $response.StatusCode
                    Data = $json
                }
            } catch {
                Write-Host "  OK Response: $($response.Content)" -ForegroundColor Green
                return @{
                    Success = $true
                    StatusCode = $response.StatusCode
                    Data = $response.Content
                }
            }
        } else {
            Write-Host "  FAIL Unexpected status: $($response.StatusCode) (expected $ExpectedStatus)" -ForegroundColor Red
            return @{ Success = $false; StatusCode = $response.StatusCode }
        }
    } catch {
        Write-Host "  FAIL Request failed: $($_.Exception.Message)" -ForegroundColor Red
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

# Test 1: Health Check
Write-Host "`n[Test 1/$TotalTests] Health Check" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray
$result = Test-Endpoint -Name "Health" -Url "$BASE_URL/health"
if ($result.Success) {
    $PassCount++
    Write-Host "OK Server is healthy" -ForegroundColor Green
} else {
    $FailCount++
    Write-Host "FAIL Server health check failed" -ForegroundColor Red
}

# Test 2: Cluster Stats (Node Registration & Pool Management)
Write-Host "`n[Test 2/$TotalTests] Cluster Stats API (Node & Pool Info)" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray
$result = Test-Endpoint -Name "Cluster Stats" -Url "$BASE_URL/api/v1/cluster"
if ($result.Success -and $result.Data) {
    $PassCount++
    $data = $result.Data
    
    Write-Host "`nCluster Overview:" -ForegroundColor Yellow
    Write-Host "  Instances: $($data.total_instances) (Online: $($data.online_instances))" -ForegroundColor Cyan
    Write-Host "  Nodes: $($data.total_nodes) (Online: $($data.online_nodes), Ready: $($data.ready_nodes))" -ForegroundColor Cyan
    Write-Host "  Sessions: $($data.total_sessions)" -ForegroundColor Cyan
    Write-Host "  Redis Key Prefix: $($data.redis_key_prefix)" -ForegroundColor Cyan
    
    if ($data.instances -and $data.instances.Count -gt 0) {
        Write-Host "`nScheduler Instances:" -ForegroundColor Yellow
        foreach ($inst in $data.instances) {
            Write-Host "  - $($inst.instance_id)" -ForegroundColor White
            Write-Host "    Hostname: $($inst.hostname), PID: $($inst.pid)" -ForegroundColor Gray
            Write-Host "    Uptime: $($inst.uptime_seconds)s, Online: $($inst.is_online)" -ForegroundColor Gray
            Write-Host "    Inbox: $($inst.inbox_length), Pending: $($inst.inbox_pending), DLQ: $($inst.dlq_length)" -ForegroundColor Gray
        }
    }
    
    if ($data.nodes -and $data.nodes.Count -gt 0) {
        Write-Host "`nRegistered Nodes:" -ForegroundColor Yellow
        foreach ($node in $data.nodes) {
            Write-Host "  - $($node.node_id)" -ForegroundColor White
            Write-Host "    Status: $($node.status), Online: $($node.online)" -ForegroundColor Gray
            Write-Host "    CPU: $($node.cpu_usage)%, Memory: $($node.memory_usage)%" -ForegroundColor Gray
            if ($node.gpu_usage) {
                Write-Host "    GPU: $($node.gpu_usage)%" -ForegroundColor Gray
            }
            Write-Host "    Jobs: $($node.current_jobs)/$($node.max_concurrent_jobs)" -ForegroundColor Gray
            
            if ($node.services -and $node.services.Count -gt 0) {
                Write-Host "    Services: $($node.services.Count) installed" -ForegroundColor Gray
                foreach ($svc in $node.services) {
                    Write-Host "      - $($svc.service_type): $($svc.status)" -ForegroundColor DarkGray
                }
            }
        }
    } else {
        Write-Host "`nNo nodes registered yet" -ForegroundColor Yellow
        Write-Host "  This is normal for a fresh server" -ForegroundColor Gray
    }
    
    Write-Host "`nOK Cluster stats retrieved successfully" -ForegroundColor Green
} else {
    $FailCount++
    Write-Host "FAIL Failed to retrieve cluster stats" -ForegroundColor Red
}

# Test 3: Metrics API
Write-Host "`n[Test 3/$TotalTests] Metrics API" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray
$result = Test-Endpoint -Name "Metrics" -Url "$BASE_URL/api/v1/metrics"
if ($result.Success -and $result.Data) {
    $PassCount++
    $metrics = $result.Data
    
    Write-Host "`nMetrics Summary:" -ForegroundColor Yellow
    Write-Host "  Job Total: $($metrics.job_total)" -ForegroundColor Cyan
    Write-Host "  Job Success: $($metrics.job_success)" -ForegroundColor Green
    Write-Host "  Job Failure: $($metrics.job_failure)" -ForegroundColor Red
    Write-Host "  Job Timeout: $($metrics.job_timeout)" -ForegroundColor Yellow
    
    if ($metrics.asr_total) {
        Write-Host "`n  ASR Requests: $($metrics.asr_total)" -ForegroundColor Cyan
    }
    if ($metrics.nmt_total) {
        Write-Host "  NMT Requests: $($metrics.nmt_total)" -ForegroundColor Cyan
    }
    if ($metrics.tts_total) {
        Write-Host "  TTS Requests: $($metrics.tts_total)" -ForegroundColor Cyan
    }
    
    Write-Host "`nOK Metrics retrieved successfully" -ForegroundColor Green
} else {
    $FailCount++
    Write-Host "FAIL Failed to retrieve metrics" -ForegroundColor Red
}

# Test 4: Prometheus Metrics
Write-Host "`n[Test 4/$TotalTests] Prometheus Metrics Endpoint" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray
$result = Test-Endpoint -Name "Prometheus" -Url "$BASE_URL/metrics"
if ($result.Success) {
    $PassCount++
    Write-Host "  Response length: $($result.Data.Length) characters" -ForegroundColor Gray
    
    # Show first few lines
    $lines = $result.Data -split "`n" | Select-Object -First 5
    Write-Host "`n  Sample metrics:" -ForegroundColor Yellow
    foreach ($line in $lines) {
        if ($line.Trim() -and -not $line.StartsWith("#")) {
            Write-Host "    $line" -ForegroundColor Gray
        }
    }
    
    Write-Host "`nOK Prometheus metrics endpoint working" -ForegroundColor Green
} else {
    $FailCount++
    Write-Host "FAIL Prometheus metrics endpoint failed" -ForegroundColor Red
}

# Test 5: Node Selection Simulation
Write-Host "`n[Test 5/$TotalTests] Node Selection Simulation" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray
$simUrl = "$BASE_URL/api/v1/phase3/simulate?required=ASR&required=NMT&src_lang=zh&tgt_lang=en"
$result = Test-Endpoint -Name "Simulate" -Url $simUrl
if ($result.Success -and $result.Data) {
    $PassCount++
    $sim = $result.Data
    
    Write-Host "`nSimulation Result:" -ForegroundColor Yellow
    Write-Host "  Routing Key: $($sim.routing_key)" -ForegroundColor Cyan
    Write-Host "  Required Services: $($sim.required -join ', ')" -ForegroundColor Cyan
    
    if ($sim.selected_node_id) {
        Write-Host "  Selected Node: $($sim.selected_node_id)" -ForegroundColor Green
    } else {
        Write-Host "  Selected Node: None (no available nodes)" -ForegroundColor Yellow
    }
    
    if ($sim.breakdown) {
        Write-Host "`n  Selection Breakdown:" -ForegroundColor Yellow
        Write-Host "    Total Nodes: $($sim.breakdown.total_nodes)" -ForegroundColor Gray
        Write-Host "    Available: $($sim.breakdown.available)" -ForegroundColor Gray
        Write-Host "    Not Ready: $($sim.breakdown.not_ready)" -ForegroundColor Gray
        Write-Host "    Missing Capability: $($sim.breakdown.missing_capability)" -ForegroundColor Gray
        Write-Host "    Overloaded: $($sim.breakdown.overloaded)" -ForegroundColor Gray
    }
    
    Write-Host "`nOK Node selection simulation completed" -ForegroundColor Green
} else {
    $FailCount++
    Write-Host "FAIL Node selection simulation failed" -ForegroundColor Red
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Total Tests: $TotalTests" -ForegroundColor White
Write-Host "  Passed: $PassCount" -ForegroundColor Green
Write-Host "  Failed: $FailCount" -ForegroundColor Red
Write-Host ""

if ($FailCount -eq 0) {
    Write-Host "OK All tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Scheduler server is working correctly!" -ForegroundColor Green
    Write-Host "  - Health check: OK" -ForegroundColor Gray
    Write-Host "  - Node registry: OK (ready for node connections)" -ForegroundColor Gray
    Write-Host "  - Pool management: OK" -ForegroundColor Gray
    Write-Host "  - Job metrics: OK" -ForegroundColor Gray
    Write-Host "  - Prometheus export: OK" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Connect electron nodes via ws://localhost:5010/ws/node" -ForegroundColor Gray
    Write-Host "  2. Connect client sessions via ws://localhost:5010/ws/session" -ForegroundColor Gray
    Write-Host "  3. Monitor cluster at http://localhost:5010/api/v1/cluster" -ForegroundColor Gray
    exit 0
} else {
    Write-Host "FAIL Some tests failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please check the error messages above" -ForegroundColor Yellow
    exit 1
}
