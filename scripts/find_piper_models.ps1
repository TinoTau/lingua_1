# Find Piper TTS model files in the project
Write-Host "Searching for Piper TTS model files..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Search paths (priority: node-inference, then model-hub)
$searchPaths = @(
    (Join-Path $projectRoot "node-inference\models\tts"),
    (Join-Path $projectRoot "model-hub\models\tts"),
    (Join-Path $projectRoot "services\piper_tts\models"),
    "$env:USERPROFILE\piper_models"
)

Write-Host ""
Write-Host "Searching in the following directories:" -ForegroundColor Yellow
foreach ($path in $searchPaths) {
    Write-Host "  - $path" -ForegroundColor Gray
}

Write-Host ""
$foundModels = @()

foreach ($searchPath in $searchPaths) {
    if (Test-Path $searchPath) {
        Write-Host "Checking: $searchPath" -ForegroundColor Cyan
        
        # Find .onnx files (excluding venv and package files)
        # Look for Piper models: zh_CN-*.onnx, en_US-*.onnx, or files in piper/zh/, piper/en/ subdirectories
        $onnxFiles = Get-ChildItem -Path $searchPath -Recurse -Filter "*.onnx" -ErrorAction SilentlyContinue | Where-Object {
            $_.FullName -notmatch "venv|site-packages|tashkeel|__pycache__" -and (
                $_.Name -match "(zh_CN|en_US|piper)" -or 
                $_.Directory.Name -match "(piper|zh|en)" -or
                $_.Directory.Parent.Name -match "(piper|zh|en)"
            )
        }
        
        if ($onnxFiles.Count -gt 0) {
            Write-Host "  Found $($onnxFiles.Count) .onnx file(s):" -ForegroundColor Green
            foreach ($file in $onnxFiles) {
                $relativePath = $file.FullName.Replace($projectRoot + "\", "")
                $sizeMB = [math]::Round($file.Length / 1MB, 2)
                Write-Host "    - $relativePath ($sizeMB MB)" -ForegroundColor White
                
                # Check for corresponding .json file
                $jsonFile = $file.FullName + ".json"
                if (Test-Path $jsonFile) {
                    Write-Host "      + Config file found" -ForegroundColor Gray
                } else {
                    Write-Host "      ! Config file (.onnx.json) not found" -ForegroundColor Yellow
                }
                
                $foundModels += $file
            }
        } else {
            Write-Host "  No .onnx files found" -ForegroundColor Gray
        }
    } else {
        Write-Host "  Directory does not exist" -ForegroundColor Gray
    }
    Write-Host ""
}

# Summary
Write-Host "Summary:" -ForegroundColor Cyan
if ($foundModels.Count -eq 0) {
    Write-Host "  No Piper TTS model files found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To download Piper models:" -ForegroundColor Yellow
    Write-Host "  1. Visit: https://huggingface.co/rhasspy/piper-voices" -ForegroundColor White
    Write-Host "  2. Download models (e.g., zh_CN-huayan-medium, en_US-lessac-medium)" -ForegroundColor White
    Write-Host "  3. Place them in: $($searchPaths[0])" -ForegroundColor White
    Write-Host "     Recommended structure:" -ForegroundColor White
    Write-Host "       $($searchPaths[0])\zh\zh_CN-huayan-medium.onnx" -ForegroundColor Gray
    Write-Host "       $($searchPaths[0])\zh\zh_CN-huayan-medium.onnx.json" -ForegroundColor Gray
} else {
    Write-Host "  Found $($foundModels.Count) Piper TTS model file(s)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Model directory will be set to: $($searchPaths[0])" -ForegroundColor Green
}
