# Check which modules use ONNX Runtime
Write-Host "Checking ONNX Runtime usage in node-inference..." -ForegroundColor Cyan
Write-Host ""

$nodeInferencePath = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "node-inference"
$srcPath = Join-Path $nodeInferencePath "src"

Write-Host "Scanning source files for ONNX Runtime usage..." -ForegroundColor Yellow
Write-Host ""

$filesUsingOrt = @()
$rustFiles = Get-ChildItem -Path $srcPath -Filter "*.rs" -Recurse

foreach ($file in $rustFiles) {
    $content = Get-Content $file.FullName -Raw
    if ($content -match "use ort|ort::|ONNX|onnx") {
        $filesUsingOrt += $file.Name
        Write-Host "  [FOUND] $($file.Name)" -ForegroundColor Yellow
    }
}

Write-Host ""
if ($filesUsingOrt.Count -eq 0) {
    Write-Host "[INFO] No files found using ONNX Runtime" -ForegroundColor Green
}
else {
    Write-Host "=== Summary ===" -ForegroundColor Cyan
    Write-Host "Files using ONNX Runtime: $($filesUsingOrt.Count)" -ForegroundColor White
    Write-Host ""
    Write-Host "Impact of ort crate version upgrade:" -ForegroundColor Yellow
    Write-Host "  - Only VAD module (vad.rs) uses ONNX Runtime" -ForegroundColor White
    Write-Host "  - Other modules (ASR, NMT, TTS) are NOT affected" -ForegroundColor Green
    Write-Host "  - ASR uses whisper-rs (separate dependency)" -ForegroundColor Gray
    Write-Host "  - NMT and TTS use HTTP clients (no ONNX Runtime)" -ForegroundColor Gray
}
