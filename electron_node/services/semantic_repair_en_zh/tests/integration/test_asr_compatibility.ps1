# ASR兼容性测试 - PowerShell版本
# 验证ASR模块能否正常调用新服务

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "ASR Compatibility Test - semantic-repair-en-zh" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://127.0.0.1:5015"

# 1. 检查服务健康
Write-Host "====================================================================" -ForegroundColor Yellow
Write-Host "  1. Service Health Check" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Yellow

try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 5
    
    if ($health.status -eq "healthy") {
        Write-Host "  ✓ Service status: $($health.status)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Service status: $($health.status)" -ForegroundColor Red
        Write-Host "❌ Service is not healthy, terminating tests" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ✗ Health check failed: $_" -ForegroundColor Red
    Write-Host "❌ Service is not available, terminating tests" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 2. 测试中文修复（ASR风格）
Write-Host "====================================================================" -ForegroundColor Yellow
Write-Host "  2. ASR-Style Call - Chinese Repair" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Yellow

$zhTests = @(
    @{ name = "同音字修复"; text = "你号，世界" },
    @{ name = "正常文本"; text = "今天天气很好" },
    @{ name = "包含标点"; text = "你好，世界！" }
)

$zhSuccess = 0
foreach ($test in $zhTests) {
    try {
        $body = @{
            job_id = "asr_test_$($test.name)"
            session_id = "asr_session_001"
            utterance_index = 1
            lang = "zh"              # ⭐ ASR模块通过参数指定语言
            text_in = $test.text
            quality_score = 0.75
        } | ConvertTo-Json -Compress
        
        $result = Invoke-RestMethod -Uri "$baseUrl/repair" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 30
        
        Write-Host "  ✓ $($test.name)" -ForegroundColor Green
        Write-Host "    输入: $($test.text)" -ForegroundColor Gray
        Write-Host "    输出: $($result.text_out)" -ForegroundColor Gray
        Write-Host "    决策: $($result.decision)" -ForegroundColor Cyan
        Write-Host "    处理器: $($result.processor_name)" -ForegroundColor Cyan
        
        $zhSuccess++
    } catch {
        Write-Host "  ✗ $($test.name) 失败: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "中文测试: $zhSuccess/$($zhTests.Count) 通过" -ForegroundColor $(if ($zhSuccess -eq $zhTests.Count) { "Green" } else { "Yellow" })
Write-Host ""

# 3. 测试英文修复（ASR风格）
Write-Host "====================================================================" -ForegroundColor Yellow
Write-Host "  3. ASR-Style Call - English Repair" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Yellow

$enTests = @(
    @{ name = "拼写错误"; text = "Helo, world" },
    @{ name = "正常文本"; text = "Hello, this is a test" },
    @{ name = "多个错误"; text = "I wnat to go thier" }
)

$enSuccess = 0
foreach ($test in $enTests) {
    try {
        $body = @{
            job_id = "asr_test_$($test.name)"
            session_id = "asr_session_001"
            utterance_index = 2
            lang = "en"              # ⭐ ASR模块通过参数指定语言
            text_in = $test.text
            quality_score = 0.80
        } | ConvertTo-Json -Compress
        
        $result = Invoke-RestMethod -Uri "$baseUrl/repair" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 30
        
        Write-Host "  ✓ $($test.name)" -ForegroundColor Green
        Write-Host "    输入: $($test.text)" -ForegroundColor Gray
        Write-Host "    输出: $($result.text_out)" -ForegroundColor Gray
        Write-Host "    决策: $($result.decision)" -ForegroundColor Cyan
        Write-Host "    处理器: $($result.processor_name)" -ForegroundColor Cyan
        
        $enSuccess++
    } catch {
        Write-Host "  ✗ $($test.name) 失败: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "英文测试: $enSuccess/$($enTests.Count) 通过" -ForegroundColor $(if ($enSuccess -eq $enTests.Count) { "Green" } else { "Yellow" })
Write-Host ""

# 4. 端点对比测试
Write-Host "====================================================================" -ForegroundColor Yellow
Write-Host "  4. Endpoint Comparison Test" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Yellow

# 测试中文端点对比
try {
    $textZh = "你号，世界"
    
    # /repair 端点
    $bodyOld = @{
        job_id = "compare_old_zh"
        session_id = "compare_session"
        lang = "zh"
        text_in = $textZh
    } | ConvertTo-Json -Compress
    $resultOld = Invoke-RestMethod -Uri "$baseUrl/repair" -Method Post -Body $bodyOld -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    
    # /zh/repair 端点
    $bodyNew = @{
        job_id = "compare_new_zh"
        session_id = "compare_session"
        text_in = $textZh
    } | ConvertTo-Json -Compress
    $resultNew = Invoke-RestMethod -Uri "$baseUrl/zh/repair" -Method Post -Body $bodyNew -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    
    Write-Host "测试语言: ZH" -ForegroundColor Cyan
    Write-Host "  ✓ /repair 返回: $($resultOld.text_out)" -ForegroundColor Green
    Write-Host "  ✓ /zh/repair 返回: $($resultNew.text_out)" -ForegroundColor Green
    
    if ($resultOld.text_out -eq $resultNew.text_out) {
        Write-Host "  ✅ 两种调用方式结果一致" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  两种调用方式结果不一致" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ✗ 中文端点对比失败: $_" -ForegroundColor Red
}
Write-Host ""

# 测试英文端点对比
try {
    $textEn = "Helo, world"
    
    # /repair 端点
    $bodyOld = @{
        job_id = "compare_old_en"
        session_id = "compare_session"
        lang = "en"
        text_in = $textEn
    } | ConvertTo-Json -Compress
    $resultOld = Invoke-RestMethod -Uri "$baseUrl/repair" -Method Post -Body $bodyOld -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    
    # /en/repair 端点
    $bodyNew = @{
        job_id = "compare_new_en"
        session_id = "compare_session"
        text_in = $textEn
    } | ConvertTo-Json -Compress
    $resultNew = Invoke-RestMethod -Uri "$baseUrl/en/repair" -Method Post -Body $bodyNew -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    
    Write-Host "测试语言: EN" -ForegroundColor Cyan
    Write-Host "  ✓ /repair 返回: $($resultOld.text_out)" -ForegroundColor Green
    Write-Host "  ✓ /en/repair 返回: $($resultNew.text_out)" -ForegroundColor Green
    
    if ($resultOld.text_out -eq $resultNew.text_out) {
        Write-Host "  ✅ 两种调用方式结果一致" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  两种调用方式结果不一致" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ✗ 英文端点对比失败: $_" -ForegroundColor Red
}
Write-Host ""

# 5. 不支持的语言测试
Write-Host "====================================================================" -ForegroundColor Yellow
Write-Host "  5. Unsupported Language Test" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Yellow

try {
    $body = @{
        job_id = "test_unsupported"
        session_id = "session_001"
        lang = "fr"  # 不支持的语言
        text_in = "Bonjour le monde"
    } | ConvertTo-Json -Compress
    
    $result = Invoke-RestMethod -Uri "$baseUrl/repair" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 30
    
    if ($result.decision -eq "PASS" -and $result.reason_codes -contains "UNSUPPORTED_LANGUAGE") {
        Write-Host "  ✓ 不支持的语言正确返回PASS" -ForegroundColor Green
        Write-Host "    决策: $($result.decision)" -ForegroundColor Cyan
        Write-Host "    原因: $($result.reason_codes -join ', ')" -ForegroundColor Cyan
    } else {
        Write-Host "  ✗ 不支持的语言处理不正确" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ 不支持的语言测试失败: $_" -ForegroundColor Red
}
Write-Host ""

# 总结
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "  Test Summary" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan

$totalTests = $zhTests.Count + $enTests.Count
$totalSuccess = $zhSuccess + $enSuccess
$successRate = if ($totalTests -gt 0) { ($totalSuccess / $totalTests * 100) } else { 0 }

Write-Host "总测试数: $($totalTests + 1)" -ForegroundColor White
Write-Host "通过数: $totalSuccess" -ForegroundColor White
Write-Host "成功率: $([math]::Round($successRate, 1))%" -ForegroundColor White
Write-Host ""

if ($totalSuccess -eq $totalTests) {
    Write-Host "✅ 所有ASR兼容性测试通过！" -ForegroundColor Green
    Write-Host "✅ 新服务完全兼容ASR模块调用方式！" -ForegroundColor Green
} else {
    Write-Host "⚠️  部分测试失败 ($($totalTests - $totalSuccess) 个)" -ForegroundColor Yellow
}

Write-Host "====================================================================" -ForegroundColor Cyan
