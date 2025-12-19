# 移除 ONNX 模型文件（保留 PyTorch 模型）

$ErrorActionPreference = "Stop"

$ServiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModelsDir = Join-Path $ServiceDir "models"

Write-Host "=== 移除 ONNX 模型文件 ===" -ForegroundColor Cyan
Write-Host "模型目录: $ModelsDir" -ForegroundColor Gray

if (-not (Test-Path $ModelsDir)) {
    Write-Host "[警告] 模型目录不存在: $ModelsDir" -ForegroundColor Yellow
    exit 0
}

$OnnxFiles = @(
    "m2m100-en-zh\encoder.onnx",
    "m2m100-en-zh\decoder.onnx",
    "m2m100-zh-en\encoder.onnx",
    "m2m100-zh-en\decoder.onnx"
)

$RemovedCount = 0
$TotalSize = 0

foreach ($file in $OnnxFiles) {
    $filePath = Join-Path $ModelsDir $file
    if (Test-Path $filePath) {
        $fileInfo = Get-Item $filePath
        $sizeMB = $fileInfo.Length / (1024 * 1024)
        $TotalSize += $fileInfo.Length
        Remove-Item $filePath -Force
        Write-Host "  [删除] $file ($([math]::Round($sizeMB, 2)) MB)" -ForegroundColor Yellow
        $RemovedCount++
    }
}

if ($RemovedCount -gt 0) {
    $TotalSizeMB = [math]::Round($TotalSize / (1024 * 1024), 2)
    Write-Host "`n[完成] 已删除 $RemovedCount 个 ONNX 文件，释放 $TotalSizeMB MB" -ForegroundColor Green
} else {
    Write-Host "`n[信息] 未找到 ONNX 文件" -ForegroundColor Gray
}

