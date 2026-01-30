#!/usr/bin/env pwsh
# 综合服务测试脚本 - 2026-01-20

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "🧪 全面服务测试开始" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$baseUrl = "http://localhost:3001"
$testResults = @()

# 辅助函数
function Test-Endpoint {
    param(
        [string]$Url,
        [string]$Method = "GET",
        [object]$Body = $null,
        [int]$Timeout = 5
    )
    
    try {
        $params = @{
            Uri = $Url
            Method = $Method
            TimeoutSec = $Timeout
            UseBasicParsing = $true
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json)
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-RestMethod @params
        return @{ Success = $true; Data = $response }
    } catch {
        return @{ Success = $false; Error = $_.Exception.Message }
    }
}

function Wait-ForServiceReady {
    param(
        [string]$ServiceId,
        [int]$MaxWaitSeconds = 30
    )
    
    Write-Host "  ⏳ 等待服务就绪（最多${MaxWaitSeconds}秒）..." -ForegroundColor Yellow
    
    for ($i = 0; $i -lt $MaxWaitSeconds; $i++) {
        Start-Sleep -Seconds 1
        
        $result = Test-Endpoint -Url "$baseUrl/api/services/$ServiceId/status"
        if ($result.Success) {
            $status = $result.Data.status
            Write-Host "    [$i 秒] 状态: $status" -ForegroundColor Gray
            
            if ($status -eq "running") {
                Write-Host "  ✅ 服务就绪！" -ForegroundColor Green
                return $true
            }
        }
    }
    
    Write-Host "  ⚠️  等待超时" -ForegroundColor Yellow
    return $false
}

# ============================================
# 测试1: 服务发现
# ============================================
Write-Host "📋 测试1: 服务发现" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray

$result = Test-Endpoint -Url "$baseUrl/api/services"
if ($result.Success) {
    $services = $result.Data
    Write-Host "✅ 发现 $($services.Count) 个服务:" -ForegroundColor Green
    
    foreach ($service in $services) {
        Write-Host "  - $($service.id): $($service.name) (类型: $($service.type))" -ForegroundColor White
    }
    
    $testResults += @{
        Test = "服务发现"
        Result = "通过"
        Details = "发现 $($services.Count) 个服务"
    }
} else {
    Write-Host "❌ 服务发现失败: $($result.Error)" -ForegroundColor Red
    $testResults += @{
        Test = "服务发现"
        Result = "失败"
        Details = $result.Error
    }
}

Start-Sleep -Seconds 2

# ============================================
# 测试2: Python服务测试
# ============================================
Write-Host "`n📋 测试2: Python服务测试" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray

$pythonServices = @(
    @{ Id = "faster_whisper_vad"; Name = "FastWhisperVad"; Port = 8001; Endpoint = "/health" },
    @{ Id = "nmt_m2m100"; Name = "NMT翻译"; Port = 8002; Endpoint = "/health" },
    @{ Id = "piper_tts"; Name = "Piper TTS"; Port = 8003; Endpoint = "/health" }
)

foreach ($svc in $pythonServices) {
    Write-Host "`n🔍 测试: $($svc.Name)" -ForegroundColor Yellow
    
    # 检查初始状态
    Write-Host "  1️⃣ 检查初始状态..." -ForegroundColor White
    $statusResult = Test-Endpoint -Url "$baseUrl/api/services/$($svc.Id)/status"
    
    if ($statusResult.Success) {
        $currentStatus = $statusResult.Data.status
        Write-Host "    当前状态: $currentStatus" -ForegroundColor Gray
        
        # 如果已经在运行，先停止
        if ($currentStatus -eq "running") {
            Write-Host "  ⏹️  服务正在运行，先停止..." -ForegroundColor Yellow
            $stopResult = Test-Endpoint -Url "$baseUrl/api/services/$($svc.Id)/stop" -Method POST
            Start-Sleep -Seconds 2
        }
    }
    
    # 启动服务
    Write-Host "  2️⃣ 启动服务..." -ForegroundColor White
    $startResult = Test-Endpoint -Url "$baseUrl/api/services/$($svc.Id)/start" -Method POST
    
    if ($startResult.Success) {
        Write-Host "    ✅ 启动命令已发送" -ForegroundColor Green
        
        # 等待服务就绪
        $isReady = Wait-ForServiceReady -ServiceId $svc.Id -MaxWaitSeconds 30
        
        if ($isReady) {
            # 测试健康检查端点
            Write-Host "  3️⃣ 测试健康检查端点..." -ForegroundColor White
            $healthResult = Test-Endpoint -Url "http://localhost:$($svc.Port)$($svc.Endpoint)"
            
            if ($healthResult.Success) {
                Write-Host "    ✅ 健康检查通过" -ForegroundColor Green
                $testResults += @{
                    Test = "$($svc.Name) - 启动和健康检查"
                    Result = "通过"
                    Details = "服务正常运行"
                }
            } else {
                Write-Host "    ⚠️  健康检查失败: $($healthResult.Error)" -ForegroundColor Yellow
                $testResults += @{
                    Test = "$($svc.Name) - 健康检查"
                    Result = "警告"
                    Details = $healthResult.Error
                }
            }
        } else {
            Write-Host "    ❌ 服务未能在30秒内就绪" -ForegroundColor Red
            $testResults += @{
                Test = "$($svc.Name) - 启动"
                Result = "失败"
                Details = "超时"
            }
        }
    } else {
        Write-Host "    ❌ 启动失败: $($startResult.Error)" -ForegroundColor Red
        $testResults += @{
            Test = "$($svc.Name) - 启动"
            Result = "失败"
            Details = $startResult.Error
        }
    }
}

# ============================================
# 测试3: 语义修复服务测试
# ============================================
Write-Host "`n📋 测试3: 语义修复服务测试" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray

$semanticServices = @(
    @{ Id = "semantic-repair-zh"; Name = "语义修复-中文"; Port = 8101 },
    @{ Id = "semantic-repair-en-zh"; Name = "语义修复-统一"; Port = 8100 }
)

foreach ($svc in $semanticServices) {
    Write-Host "`n🔍 测试: $($svc.Name)" -ForegroundColor Yellow
    
    # 检查状态
    Write-Host "  1️⃣ 检查服务状态..." -ForegroundColor White
    $statusResult = Test-Endpoint -Url "$baseUrl/api/services/$($svc.Id)/status"
    
    if ($statusResult.Success) {
        $status = $statusResult.Data.status
        Write-Host "    当前状态: $status" -ForegroundColor Gray
        
        if ($status -eq "running") {
            Write-Host "    ✅ 服务正在运行" -ForegroundColor Green
            
            # 测试健康检查
            $healthResult = Test-Endpoint -Url "http://localhost:$($svc.Port)/health"
            if ($healthResult.Success) {
                Write-Host "    ✅ 健康检查通过" -ForegroundColor Green
                $testResults += @{
                    Test = "$($svc.Name)"
                    Result = "通过"
                    Details = "服务正常运行"
                }
            }
        } else {
            Write-Host "    ⚫ 服务未运行（状态: $status）" -ForegroundColor Gray
            $testResults += @{
                Test = "$($svc.Name)"
                Result = "跳过"
                Details = "服务未启动"
            }
        }
    } else {
        Write-Host "    ❌ 无法获取状态: $($statusResult.Error)" -ForegroundColor Red
        $testResults += @{
            Test = "$($svc.Name)"
            Result = "失败"
            Details = $statusResult.Error
        }
    }
}

# ============================================
# 测试4: 刷新功能测试
# ============================================
Write-Host "`n📋 测试4: 刷新功能测试" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray

Write-Host "  1️⃣ 记录当前运行的服务..." -ForegroundColor White
$servicesResult = Test-Endpoint -Url "$baseUrl/api/services"
if ($servicesResult.Success) {
    $runningServices = $servicesResult.Data | Where-Object { $_.status -eq "running" }
    Write-Host "    运行中的服务数量: $($runningServices.Count)" -ForegroundColor Gray
    
    if ($runningServices.Count -gt 0) {
        foreach ($svc in $runningServices) {
            Write-Host "      - $($svc.id) (PID: $($svc.pid))" -ForegroundColor White
        }
        
        # 执行刷新
        Write-Host "  2️⃣ 执行刷新..." -ForegroundColor White
        $refreshResult = Test-Endpoint -Url "$baseUrl/api/services/refresh" -Method POST
        
        if ($refreshResult.Success) {
            Write-Host "    ✅ 刷新命令已发送" -ForegroundColor Green
            Start-Sleep -Seconds 2
            
            # 验证服务仍在运行
            Write-Host "  3️⃣ 验证服务状态..." -ForegroundColor White
            $afterRefreshResult = Test-Endpoint -Url "$baseUrl/api/services"
            
            if ($afterRefreshResult.Success) {
                $stillRunning = $afterRefreshResult.Data | Where-Object { $_.status -eq "running" }
                
                if ($stillRunning.Count -eq $runningServices.Count) {
                    Write-Host "    ✅ 所有服务仍在运行（$($stillRunning.Count)个）" -ForegroundColor Green
                    $testResults += @{
                        Test = "刷新功能"
                        Result = "通过"
                        Details = "刷新未影响运行中的服务"
                    }
                } else {
                    Write-Host "    ❌ 服务数量变化：$($runningServices.Count) → $($stillRunning.Count)" -ForegroundColor Red
                    $testResults += @{
                        Test = "刷新功能"
                        Result = "失败"
                        Details = "刷新影响了运行中的服务"
                    }
                }
            }
        } else {
            Write-Host "    ❌ 刷新失败: $($refreshResult.Error)" -ForegroundColor Red
            $testResults += @{
                Test = "刷新功能"
                Result = "失败"
                Details = $refreshResult.Error
            }
        }
    } else {
        Write-Host "    ⚠️  没有运行中的服务，跳过刷新测试" -ForegroundColor Yellow
        $testResults += @{
            Test = "刷新功能"
            Result = "跳过"
            Details = "无运行中的服务"
        }
    }
}

# ============================================
# 测试5: API兼容性测试
# ============================================
Write-Host "`n📋 测试5: API兼容性测试" -ForegroundColor Cyan
Write-Host "----------------------------------------" -ForegroundColor Gray

# 测试NMT服务API（如果在运行）
Write-Host "  测试 NMT 翻译 API..." -ForegroundColor White
$nmtHealthResult = Test-Endpoint -Url "http://localhost:8002/health" -Timeout 2
if ($nmtHealthResult.Success) {
    $translateBody = @{
        text = "Hello, world!"
        source_lang = "en"
        target_lang = "zh"
    }
    
    $translateResult = Test-Endpoint -Url "http://localhost:8002/translate" -Method POST -Body $translateBody -Timeout 10
    
    if ($translateResult.Success) {
        Write-Host "    ✅ 翻译API正常" -ForegroundColor Green
        Write-Host "    结果: $($translateResult.Data.translated_text)" -ForegroundColor Gray
        $testResults += @{
            Test = "NMT API兼容性"
            Result = "通过"
            Details = "翻译功能正常"
        }
    } else {
        Write-Host "    ❌ 翻译API失败: $($translateResult.Error)" -ForegroundColor Red
        $testResults += @{
            Test = "NMT API兼容性"
            Result = "失败"
            Details = $translateResult.Error
        }
    }
} else {
    Write-Host "    ⚫ NMT服务未运行，跳过API测试" -ForegroundColor Gray
    $testResults += @{
        Test = "NMT API兼容性"
        Result = "跳过"
        Details = "服务未运行"
    }
}

# ============================================
# 测试总结
# ============================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "📊 测试总结" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$passCount = ($testResults | Where-Object { $_.Result -eq "通过" }).Count
$failCount = ($testResults | Where-Object { $_.Result -eq "失败" }).Count
$skipCount = ($testResults | Where-Object { $_.Result -eq "跳过" }).Count
$warnCount = ($testResults | Where-Object { $_.Result -eq "警告" }).Count
$totalCount = $testResults.Count

Write-Host "总测试数: $totalCount" -ForegroundColor White
Write-Host "✅ 通过: $passCount" -ForegroundColor Green
Write-Host "❌ 失败: $failCount" -ForegroundColor Red
Write-Host "⚠️  警告: $warnCount" -ForegroundColor Yellow
Write-Host "⚫ 跳过: $skipCount" -ForegroundColor Gray

Write-Host "`n详细结果:" -ForegroundColor White
Write-Host "----------------------------------------" -ForegroundColor Gray

foreach ($result in $testResults) {
    $icon = switch ($result.Result) {
        "通过" { "✅" }
        "失败" { "❌" }
        "警告" { "⚠️ " }
        "跳过" { "⚫" }
        default { "❓" }
    }
    
    $color = switch ($result.Result) {
        "通过" { "Green" }
        "失败" { "Red" }
        "警告" { "Yellow" }
        "跳过" { "Gray" }
        default { "White" }
    }
    
    Write-Host "$icon $($result.Test): $($result.Result)" -ForegroundColor $color
    Write-Host "   详情: $($result.Details)" -ForegroundColor Gray
}

# 保存结果到文件
$reportPath = "test_results_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
$testResults | ConvertTo-Json -Depth 10 | Out-File $reportPath
Write-Host "`n📄 详细报告已保存: $reportPath" -ForegroundColor Cyan

# 最终评估
Write-Host "`n========================================" -ForegroundColor Cyan
if ($failCount -eq 0 -and $warnCount -eq 0) {
    Write-Host "🎉 所有测试通过！架构统一成功！" -ForegroundColor Green
    exit 0
} elseif ($failCount -eq 0) {
    Write-Host "⚠️  测试完成，有警告项需要关注" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "❌ 有测试失败，需要修复" -ForegroundColor Red
    exit 1
}
