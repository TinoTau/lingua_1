# YourTTS Service Packaging (Complete, ready to run)

# ============================================
# SETUP - MUST RUN FIRST
# ============================================
$ServicesDir = "D:\Programs\github\lingua_1\electron_node\services"
$ModelHubDir = "D:\Programs\github\lingua_1\central_server\model-hub\models\services"
$Version = "1.0.0"
$Platform = "windows-x64"

Write-Host "=== Packaging YourTTS Service ===" -ForegroundColor Cyan
Write-Host "Services directory: $ServicesDir" -ForegroundColor Gray
Write-Host "Model Hub directory: $ModelHubDir" -ForegroundColor Gray

# ============================================
# PACKAGE YOURTTS
# ============================================
$ServiceId = "your-tts"
$ServiceName = "your_tts"
$TempDir = "$env:TEMP\package-$ServiceId"

# Clean up temp directory if exists
if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir
}
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# Create service.json
Write-Host "Creating service.json..." -ForegroundColor Gray
$ServiceJson = @{
    service_id = $ServiceId
    version = $Version
    platforms = @{
        $Platform = @{
            entrypoint = "yourtts_service.py"
            exec = @{ type = "argv"; program = "python"; args = @("yourtts_service.py", "--host", "127.0.0.1", "--port", "5004"); cwd = "." }
            default_port = 5004
            files = @{ requires = @("service.json", "yourtts_service.py"); optional = @("venv/", "models/") }
        }
    }
    health_check = @{ type = "http"; endpoint = "/health"; timeout_ms = 3000; startup_grace_ms = 10000 }
    env_schema = @{ SERVICE_PORT = "int"; PYTHONPATH = "string"; MODEL_DIR = "string" }
}
$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8

# Copy service files
Write-Host "Copying service files..." -ForegroundColor Gray
$SourceDir = "$ServicesDir\$ServiceName"
if (-not (Test-Path $SourceDir)) {
    Write-Host "[ERROR] Service directory not found: $SourceDir" -ForegroundColor Red
    exit 1
}

Copy-Item -Path "$SourceDir\*.py" -Destination $TempDir -Force -ErrorAction SilentlyContinue
Copy-Item -Path "$SourceDir\*.txt" -Destination $TempDir -Force -ErrorAction SilentlyContinue

# Copy YourTTS models from node-inference/models/tts/your_tts
Write-Host "Checking for YourTTS models..." -ForegroundColor Gray
$YourTTSModelPath1 = "$ServicesDir\node-inference\models\tts\your_tts"
$YourTTSModelPath2 = "$ServicesDir\..\..\central_server\model-hub\models\tts\your_tts"
$YourTTSModelsFound = $false

if (Test-Path $YourTTSModelPath1) {
    Write-Host "Found YourTTS models at: $YourTTSModelPath1" -ForegroundColor Gray
    Write-Host "Copying YourTTS models (this may take a while)..." -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "$TempDir\models\tts" | Out-Null
    Copy-Item -Path $YourTTSModelPath1 -Destination "$TempDir\models\tts\your_tts" -Recurse -Force
    $YourTTSModelsFound = $true
    Write-Host "YourTTS models copied successfully" -ForegroundColor Green
} elseif (Test-Path $YourTTSModelPath2) {
    Write-Host "Found YourTTS models at: $YourTTSModelPath2" -ForegroundColor Gray
    Write-Host "Copying YourTTS models (this may take a while)..." -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "$TempDir\models\tts" | Out-Null
    Copy-Item -Path $YourTTSModelPath2 -Destination "$TempDir\models\tts\your_tts" -Recurse -Force
    $YourTTSModelsFound = $true
    Write-Host "YourTTS models copied successfully" -ForegroundColor Green
} else {
    Write-Host "[WARNING] YourTTS models not found in any of these locations:" -ForegroundColor Yellow
    Write-Host "  - $YourTTSModelPath1" -ForegroundColor Yellow
    Write-Host "  - $YourTTSModelPath2" -ForegroundColor Yellow
    Write-Host "  Service will need models to be provided at runtime." -ForegroundColor Yellow
}

# Package
Write-Host "Creating ZIP archive..." -ForegroundColor Gray
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) {
    Remove-Item -Force $ZipPath
}
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

# Deploy
Write-Host "Deploying to Model Hub..." -ForegroundColor Gray
$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

$ZipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "[SUCCESS] YourTTS packaged: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

Write-Host "Done!" -ForegroundColor Green

