# 语言能力功能测试脚本 (PowerShell)

$SCHEDULER_URL = if ($env:SCHEDULER_URL) { $env:SCHEDULER_URL } else { "http://localhost:5010" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "语言能力功能测试" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查调度服务器是否运行
Write-Host "1. 检查调度服务器状态..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$SCHEDULER_URL/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✓ 调度服务器运行中" -ForegroundColor Green
} catch {
    Write-Host "✗ 调度服务器未运行，请先启动调度服务器" -ForegroundColor Red
    Write-Host "  错误: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 2. 检查节点注册状态
Write-Host "2. 检查节点注册状态..." -ForegroundColor Yellow
Write-Host "   （需要实现节点查询 API）" -ForegroundColor Gray
Write-Host ""

# 3. 检查 Pool 配置
Write-Host "3. 检查 Pool 配置..." -ForegroundColor Yellow
Write-Host "   （需要实现 Pool 查询 API）" -ForegroundColor Gray
Write-Host ""

# 4. 发送测试任务（zh -> en）
Write-Host "4. 发送测试任务（zh -> en）..." -ForegroundColor Yellow
$testJobZhEn = @{
    src_lang = "zh"
    tgt_lang = "en"
    session_id = "test-session-zh-en"
    utterance_index = 1
    audio_format = "pcm16"
    sample_rate = 16000
    audio = ""
} | ConvertTo-Json

# 如果 API 可用，发送请求
# try {
#     $response = Invoke-WebRequest -Uri "$SCHEDULER_URL/api/jobs" -Method POST `
#         -ContentType "application/json" -Body $testJobZhEn -ErrorAction Stop
#     Write-Host "✓ 任务已发送" -ForegroundColor Green
# } catch {
#     Write-Host "✗ 任务发送失败: $_" -ForegroundColor Red
# }
Write-Host "   （需要实现任务分配 API）" -ForegroundColor Gray
Write-Host ""

# 5. 发送测试任务（en -> zh）
Write-Host "5. 发送测试任务（en -> zh）..." -ForegroundColor Yellow
$testJobEnZh = @{
    src_lang = "en"
    tgt_lang = "zh"
    session_id = "test-session-en-zh"
    utterance_index = 1
    audio_format = "pcm16"
    sample_rate = 16000
    audio = ""
} | ConvertTo-Json

Write-Host "   （需要实现任务分配 API）" -ForegroundColor Gray
Write-Host ""

# 6. 发送测试任务（auto -> en）
Write-Host "6. 发送测试任务（auto -> en）..." -ForegroundColor Yellow
$testJobAutoEn = @{
    src_lang = "auto"
    tgt_lang = "en"
    session_id = "test-session-auto-en"
    utterance_index = 1
    audio_format = "pcm16"
    sample_rate = 16000
    audio = ""
} | ConvertTo-Json

Write-Host "   （需要实现任务分配 API）" -ForegroundColor Gray
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "测试完成" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "请检查：" -ForegroundColor Yellow
Write-Host "1. 调度服务器日志中的 Pool 生成信息" -ForegroundColor White
Write-Host "2. 调度服务器日志中的节点分配信息" -ForegroundColor White
Write-Host "3. 调度服务器日志中的任务分配信息" -ForegroundColor White
Write-Host "4. 节点端日志中的语言能力检测信息" -ForegroundColor White
Write-Host ""
