# Copy models from original project to new project
# Usage: .\scripts\copy_models.ps1
# Description: Script copies models from original project to model-hub/models and node-inference/models
# Note: Default source path is D:\Programs\github\lingua\core\engine\models, edit line 10 if needed

$ErrorActionPreference = "Stop"

Write-Host "Starting to copy model files..." -ForegroundColor Green

# Original project path
$sourcePath = "D:\Programs\github\lingua\core\engine\models"
# New project path
$projectRoot = Split-Path -Parent $PSScriptRoot

# Check if source path exists
if (-not (Test-Path $sourcePath)) {
    Write-Host "Error: Source path does not exist: $sourcePath" -ForegroundColor Red
    Write-Host "Please modify the source path in the script" -ForegroundColor Yellow
    exit 1
}

# 1. Copy to model-hub/models (Company model hub)
Write-Host "`n[1/2] Copying to model-hub/models (Company model hub)..." -ForegroundColor Cyan
$modelHubPath = Join-Path $projectRoot "model-hub\models"
New-Item -ItemType Directory -Force -Path $modelHubPath | Out-Null

# Copy all models
Copy-Item -Path "$sourcePath\*" -Destination $modelHubPath -Recurse -Force
Write-Host "Copied to model-hub/models" -ForegroundColor Green

# 2. Copy to node-inference/models (Node local model hub)
Write-Host "`n[2/2] Copying to node-inference/models (Node local model hub)..." -ForegroundColor Cyan
$nodeInferencePath = Join-Path $projectRoot "node-inference\models"
New-Item -ItemType Directory -Force -Path $nodeInferencePath | Out-Null

# Copy all models
Copy-Item -Path "$sourcePath\*" -Destination $nodeInferencePath -Recurse -Force
Write-Host "Copied to node-inference/models" -ForegroundColor Green

# Statistics
Write-Host "`nCopy completed!" -ForegroundColor Green
Write-Host "Model locations:" -ForegroundColor Yellow
Write-Host "  - Company model hub: $modelHubPath" -ForegroundColor Cyan
Write-Host "  - Node model hub: $nodeInferencePath" -ForegroundColor Cyan

# Calculate total size
$totalSize = (Get-ChildItem -Path $modelHubPath -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalSizeGB = [math]::Round($totalSize / 1GB, 2)
Write-Host "`nTotal size: $totalSizeGB GB" -ForegroundColor Yellow

Write-Host "`nNote: Model files are excluded in .gitignore and will not be committed to Git" -ForegroundColor Yellow