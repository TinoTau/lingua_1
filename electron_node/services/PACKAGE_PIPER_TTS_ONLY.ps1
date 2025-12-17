# Piper TTS Service Packaging (Complete, ready to run)

# ============================================
# SETUP - MUST RUN FIRST
# ============================================
$ServicesDir = "D:\Programs\github\lingua_1\electron_node\services"
$ModelHubDir = "D:\Programs\github\lingua_1\central_server\model-hub\models\services"
$Version = "1.0.0"
$Platform = "windows-x64"

Write-Host "=== Packaging Piper TTS Service ===" -ForegroundColor Cyan
Write-Host "Services directory: $ServicesDir" -ForegroundColor Gray
Write-Host "Model Hub directory: $ModelHubDir" -ForegroundColor Gray

# ============================================
# PACKAGE PIPER TTS
# ============================================
$ServiceId = "piper-tts"
$ServiceName = "piper_tts"
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
            entrypoint = "piper_http_server.py"
            exec = @{ type = "argv"; program = "python"; args = @("piper_http_server.py", "--host", "127.0.0.1", "--port", "5005"); cwd = "." }
            default_port = 5005
            files = @{ requires = @("service.json", "piper_http_server.py"); optional = @("venv/", "models/") }
        }
    }
    health_check = @{ type = "http"; endpoint = "/health"; timeout_ms = 3000; startup_grace_ms = 10000 }
    env_schema = @{ SERVICE_PORT = "int"; PYTHONPATH = "string"; PIPER_MODEL_DIR = "string" }
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
Copy-Item -Path "$SourceDir\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

# Copy Piper models
Write-Host "Checking for Piper models..." -ForegroundColor Gray
$PiperModelDirs = @(
    "$env:USERPROFILE\piper_models",
    "$env:USERPROFILE\.piper_models",
    "$ServicesDir\..\..\central_server\model-hub\models\tts\vits_en"
)
$PiperModelsFound = $false
foreach ($PiperModelDir in $PiperModelDirs) {
    if (Test-Path $PiperModelDir) {
        Write-Host "Found Piper models at: $PiperModelDir" -ForegroundColor Gray
        Write-Host "Copying Piper models (this may take a while)..." -ForegroundColor Gray
        Copy-Item -Path $PiperModelDir -Destination "$TempDir\models" -Recurse -Force
        $PiperModelsFound = $true
        Write-Host "Piper models copied successfully" -ForegroundColor Green
        break
    }
}
if (-not $PiperModelsFound) {
    Write-Host "[WARNING] Piper models not found in any of these locations:" -ForegroundColor Yellow
    foreach ($PiperModelDir in $PiperModelDirs) {
        Write-Host "  - $PiperModelDir" -ForegroundColor Yellow
    }
    Write-Host "  Set PIPER_MODEL_DIR environment variable at runtime to point to model directory." -ForegroundColor Yellow
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
Write-Host "[SUCCESS] Piper TTS packaged: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

Write-Host "Done!" -ForegroundColor Green

