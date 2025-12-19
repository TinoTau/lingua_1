# 检查 TTS 服务配置和模型路径

Write-Host "=== 检查配置文件 ===" -ForegroundColor Cyan
$configFile = "models\vits-zh-aishell3\vits-aishell3.onnx.json"
if (Test-Path $configFile) {
    Write-Host "[OK] 配置文件存在: $configFile" -ForegroundColor Green
    $config = Get-Content $configFile | ConvertFrom-Json
    Write-Host "  - 采样率: $($config.audio.sample_rate)" -ForegroundColor White
    Write-Host "  - 语言: $($config.language.code)" -ForegroundColor White
    Write-Host "  - Phoneme 数量: $($config.phoneme_id_map.PSObject.Properties.Count)" -ForegroundColor White
} else {
    Write-Host "[错误] 配置文件不存在: $configFile" -ForegroundColor Red
}

Write-Host "`n=== 检查模型文件 ===" -ForegroundColor Cyan
$modelFile = "models\vits-zh-aishell3\vits-aishell3.onnx"
if (Test-Path $modelFile) {
    Write-Host "[OK] 模型文件存在: $modelFile" -ForegroundColor Green
    $size = (Get-Item $modelFile).Length / 1MB
    Write-Host "  - 大小: $([math]::Round($size, 2)) MB" -ForegroundColor White
} else {
    Write-Host "[错误] 模型文件不存在: $modelFile" -ForegroundColor Red
}

Write-Host "`n=== 检查 TTS 服务进程 ===" -ForegroundColor Cyan
$processes = Get-Process | Where-Object {$_.ProcessName -like "*python*"}
$found = $false
foreach ($proc in $processes) {
    $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
    if ($cmd -like "*piper*") {
        Write-Host "[找到] 进程 ID: $($proc.Id)" -ForegroundColor Green
        Write-Host "  命令行: $cmd" -ForegroundColor Gray
        if ($cmd -match "--model-dir\s+([^\s]+)") {
            $modelDir = $matches[1]
            Write-Host "  模型目录: $modelDir" -ForegroundColor $(if ($modelDir -like "*piper_tts*") { "Green" } else { "Red" })
        }
        $found = $true
    }
}
if (-not $found) {
    Write-Host "[未找到] TTS 服务进程" -ForegroundColor Yellow
}

Write-Host "`n=== 检查配置代码 ===" -ForegroundColor Cyan
$configTs = "..\electron-node\main\src\utils\python-service-config.ts"
if (Test-Path $configTs) {
    Write-Host "[检查] TypeScript 配置文件" -ForegroundColor Yellow
    $matches = Select-String -Path $configTs -Pattern "PIPER_MODEL_DIR|piper_tts.*models" -Context 1,1
    foreach ($match in $matches) {
        Write-Host "  $($match.LineNumber): $($match.Line.Trim())" -ForegroundColor White
    }
} else {
    Write-Host "[未找到] TypeScript 配置文件" -ForegroundColor Yellow
}

Write-Host "`n=== 检查编译后的 JavaScript ===" -ForegroundColor Cyan
$configJs = "..\electron-node\main\electron-node\main\src\utils\python-service-config.js"
if (Test-Path $configJs) {
    Write-Host "[检查] JavaScript 配置文件" -ForegroundColor Yellow
    $matches = Select-String -Path $configJs -Pattern "PIPER_MODEL_DIR|piper_tts.*models" -Context 1,1
    foreach ($match in $matches) {
        Write-Host "  $($match.LineNumber): $($match.Line.Trim())" -ForegroundColor White
    }
} else {
    Write-Host "[未找到] JavaScript 配置文件" -ForegroundColor Yellow
}

Write-Host "`n=== 测试 TTS 服务健康检查 ===" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:5006/health" -Method GET -TimeoutSec 5
    Write-Host "[OK] TTS 服务运行正常" -ForegroundColor Green
    Write-Host "  响应: $($response.Content)" -ForegroundColor White
} catch {
    Write-Host "[错误] TTS 服务不可用: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== 完成 ===" -ForegroundColor Cyan

