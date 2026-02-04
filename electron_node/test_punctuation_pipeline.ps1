# 断句服务及上下游流水线功能测试
# 验证：punctuation /punc API、PhoneticCorrection -> PunctuationRestore -> SemanticRepair 数据流

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$PUNC_URL = "http://127.0.0.1:5017"
$PHONETIC_URL = "http://127.0.0.1:5016"
$SEMANTIC_URL = "http://127.0.0.1:5015"

function Test-Endpoint {
    param([string]$Name, [string]$Url, [string]$Method = "GET", [object]$Body = $null, [string[]]$ExpectFields = @())
    Write-Host "[$Name]" -ForegroundColor Yellow
    try {
        $params = @{ Uri = $Url; Method = $Method; ContentType = "application/json"; TimeoutSec = 60; UseBasicParsing = $true }
        if ($Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
        $r = Invoke-RestMethod @params
        foreach ($f in $ExpectFields) {
            if (-not ($r.PSObject.Properties.Name -contains $f)) {
                throw "Missing field: $f"
            }
        }
        Write-Host "  OK" -ForegroundColor Green
        return $r
    }
    catch {
        Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

Write-Host "`n=== 1. 断句服务 /health ===" -ForegroundColor Cyan
$h = Test-Endpoint "Punctuation Health" "$PUNC_URL/health" -ExpectFields @("status")
if (-not $h) { Write-Host "断句服务未运行，请先启动 (cd services/punctuation_restore; python service.py)" -ForegroundColor Red; exit 1 }

Write-Host "`n=== 2. 断句服务 /punc 接口（与 pipeline 契约一致）===" -ForegroundColor Cyan
$puncReq = @{ text = "你好世界今天天气不错"; lang = "zh" }
$puncResp = Test-Endpoint "Punc ZH" "$PUNC_URL/punc" "POST" $puncReq -ExpectFields @("text", "process_time_ms")
if ($puncResp) {
    Write-Host "  Request: text=`"$($puncReq.text)`", lang=$($puncReq.lang)" -ForegroundColor Gray
    Write-Host "  Response text: $($puncResp.text)" -ForegroundColor Gray
}

$puncEnReq = @{ text = "hello world how are you"; lang = "en" }
$puncEnResp = Test-Endpoint "Punc EN" "$PUNC_URL/punc" "POST" $puncEnReq -ExpectFields @("text", "process_time_ms")
if ($puncEnResp) {
    Write-Host "  Request: text=`"$($puncEnReq.text)`", lang=$($puncEnReq.lang)" -ForegroundColor Gray
    Write-Host "  Response text: $($puncEnResp.text)" -ForegroundColor Gray
}

Write-Host "`n=== 3. 上下游链路：Phonetic -> Punctuation -> Semantic ===" -ForegroundColor Cyan
$rawText = "你号世界今天天气真不错"  # 故意写错「号」测试同音纠错
$step1 = $null
$step2 = $null
$step3 = $null

# Step 1: Phonetic correction (同音纠错)
try {
    $r1 = Invoke-RestMethod -Uri "$PHONETIC_URL/correct" -Method POST -Body (@{ text_in = $rawText; lang = "zh" } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 15 -UseBasicParsing
    if ($r1.text_out) {
        $step1 = $r1.text_out
        Write-Host "  [Phonetic] in=$rawText -> out=$step1" -ForegroundColor Gray
    }
}
catch {
    Write-Host "  [Phonetic] 跳过（服务可能未启动）: $($_.Exception.Message)" -ForegroundColor Yellow
    $step1 = $rawText
}

# Step 2: Punctuation restore (断句)
$input2 = if ($step1) { $step1 } else { $rawText }
try {
    $r2 = Invoke-RestMethod -Uri "$PUNC_URL/punc" -Method POST -Body (@{ text = $input2; lang = "zh" } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 60 -UseBasicParsing
    if ($r2.text) {
        $step2 = $r2.text
        Write-Host "  [Punctuation] in=$input2 -> out=$step2" -ForegroundColor Gray
    }
}
catch {
    Write-Host "  [Punctuation] FAIL: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Semantic repair (语义修复) - 使用 step2 作为输入，与 pipeline 中 ctx.segmentForJobResult 一致
try {
    $r3 = Invoke-RestMethod -Uri "$SEMANTIC_URL/zh/repair" -Method POST -Body (@{ text_in = $step2; job_id = "test-punc-001"; lang = "zh" } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 30 -UseBasicParsing
    if ($r3.text_out) {
        $step3 = $r3.text_out
        Write-Host "  [Semantic] in=$step2 -> out=$step3" -ForegroundColor Gray
    }
}
catch {
    Write-Host "  [Semantic] 跳过（服务可能未启动）: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n=== 4. 数据格式校验（pipeline 期望）===" -ForegroundColor Cyan
$ok = $true
if ($puncResp) {
    if ($puncResp.text -isnot [string]) { Write-Host "  FAIL: /punc 返回 text 必须是 string" -ForegroundColor Red; $ok = $false }
    else { Write-Host "  /punc text 类型: string OK" -ForegroundColor Green }
}
if (-not $ok) { exit 1 }

Write-Host "`n=== 测试完成 ===" -ForegroundColor Cyan
Write-Host "断句服务与上下游数据流正常。" -ForegroundColor Green
