# Manual Packaging Commands - WITH MODELS
# Copy and paste each service block one by one

# ============================================
# SETUP (Run this first)
# ============================================
$ServicesDir = "D:\Programs\github\lingua_1\electron_node\services"
$ModelHubDir = "D:\Programs\github\lingua_1\central_server\model-hub\models\services"
$Version = "1.0.0"
$Platform = "windows-x64"

Write-Host "Packaging directory: $ModelHubDir" -ForegroundColor Cyan

# ============================================
# SERVICE 1: NMT M2M100 (WITH HuggingFace Models)
# ============================================
Write-Host "`n=== Packaging NMT M2M100 Service (WITH MODELS) ===" -ForegroundColor Cyan

$ServiceId = "nmt-m2m100"
$ServiceName = "nmt_m2m100"
$TempDir = "$env:TEMP\package-$ServiceId"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# Create service.json
$ServiceJson = @{
    service_id = $ServiceId
    version = $Version
    platforms = @{
        $Platform = @{
            entrypoint = "nmt_service.py"
            exec = @{ type = "argv"; program = "python"; args = @("nmt_service.py"); cwd = "." }
            default_port = 5008
            files = @{ requires = @("service.json", "nmt_service.py"); optional = @("venv/", ".cache/") }
        }
    }
    health_check = @{ type = "http"; endpoint = "/health"; timeout_ms = 3000; startup_grace_ms = 10000 }
    env_schema = @{ SERVICE_PORT = "int"; PYTHONPATH = "string"; HF_LOCAL_FILES_ONLY = "string" }
}
$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8

# Copy service files
Write-Host "Copying service files..." -ForegroundColor Gray
Copy-Item -Path "$ServicesDir\$ServiceName\*.py" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\*.txt" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

# Copy HuggingFace model cache (facebook/m2m100_418M)
Write-Host "Copying HuggingFace model cache..." -ForegroundColor Gray
$HFCacheDir = "$env:USERPROFILE\.cache\huggingface\hub"
$M2M100ModelPath = "$HFCacheDir\models--facebook--m2m100_418M"
if (Test-Path $M2M100ModelPath) {
    New-Item -ItemType Directory -Force -Path "$TempDir\.cache\huggingface\hub" | Out-Null
    Copy-Item -Path $M2M100ModelPath -Destination "$TempDir\.cache\huggingface\hub\models--facebook--m2m100_418M" -Recurse -Force
    Write-Host "HuggingFace model cache copied" -ForegroundColor Green
} else {
    Write-Host "[WARNING] HuggingFace model cache not found: $M2M100ModelPath" -ForegroundColor Yellow
    Write-Host "  Model will be downloaded at runtime from HuggingFace Hub" -ForegroundColor Yellow
}

# Package
Write-Host "Creating ZIP..." -ForegroundColor Gray
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

# Deploy
$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

$ZipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "[SUCCESS] NMT M2M100: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

# ============================================
# SERVICE 2: PIPER TTS (WITH Models)
# ============================================
Write-Host "`n=== Packaging Piper TTS Service (WITH MODELS) ===" -ForegroundColor Cyan

$ServiceId = "piper-tts"
$ServiceName = "piper_tts"
$TempDir = "$env:TEMP\package-$ServiceId"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# Create service.json
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
Copy-Item -Path "$ServicesDir\$ServiceName\*.py" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\*.txt" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

# Copy Piper models
Write-Host "Copying Piper models..." -ForegroundColor Gray
$PiperModelDirs = @(
    "$env:USERPROFILE\piper_models",
    "$env:USERPROFILE\.piper_models",
    "$ServicesDir\..\..\central_server\model-hub\models\tts\vits_en"
)
$PiperModelsFound = $false
foreach ($PiperModelDir in $PiperModelDirs) {
    if (Test-Path $PiperModelDir) {
        Write-Host "  Found models at: $PiperModelDir" -ForegroundColor Gray
        Copy-Item -Path $PiperModelDir -Destination "$TempDir\models" -Recurse -Force
        $PiperModelsFound = $true
        Write-Host "  Piper models copied" -ForegroundColor Green
        break
    }
}
if (-not $PiperModelsFound) {
    Write-Host "[WARNING] Piper models not found. Set PIPER_MODEL_DIR environment variable at runtime." -ForegroundColor Yellow
}

# Package
Write-Host "Creating ZIP..." -ForegroundColor Gray
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

# Deploy
$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

$ZipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "[SUCCESS] Piper TTS: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

# ============================================
# SERVICE 3: YOURTTS (WITH Models)
# ============================================
Write-Host "`n=== Packaging YourTTS Service (WITH MODELS) ===" -ForegroundColor Cyan

$ServiceId = "your-tts"
$ServiceName = "your_tts"
$TempDir = "$env:TEMP\package-$ServiceId"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# Create service.json
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
Copy-Item -Path "$ServicesDir\$ServiceName\*.py" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\*.txt" -Destination $TempDir -Force

# Copy YourTTS models from node-inference/models/tts/your_tts
Write-Host "Copying YourTTS models..." -ForegroundColor Gray
$YourTTSModelPath1 = "$ServicesDir\node-inference\models\tts\your_tts"
$YourTTSModelPath2 = "$ServicesDir\..\..\central_server\model-hub\models\tts\your_tts"
$YourTTSModelsFound = $false

if (Test-Path $YourTTSModelPath1) {
    Write-Host "  Found models at: $YourTTSModelPath1" -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "$TempDir\models\tts" | Out-Null
    Copy-Item -Path $YourTTSModelPath1 -Destination "$TempDir\models\tts\your_tts" -Recurse -Force
    $YourTTSModelsFound = $true
    Write-Host "  YourTTS models copied" -ForegroundColor Green
} elseif (Test-Path $YourTTSModelPath2) {
    Write-Host "  Found models at: $YourTTSModelPath2" -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "$TempDir\models\tts" | Out-Null
    Copy-Item -Path $YourTTSModelPath2 -Destination "$TempDir\models\tts\your_tts" -Recurse -Force
    $YourTTSModelsFound = $true
    Write-Host "  YourTTS models copied" -ForegroundColor Green
} else {
    Write-Host "[WARNING] YourTTS models not found at:" -ForegroundColor Yellow
    Write-Host "  - $YourTTSModelPath1" -ForegroundColor Yellow
    Write-Host "  - $YourTTSModelPath2" -ForegroundColor Yellow
}

# Package
Write-Host "Creating ZIP..." -ForegroundColor Gray
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

# Deploy
$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

$ZipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "[SUCCESS] YourTTS: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

# ============================================
# SERVICE 4: NODE INFERENCE (Rust) - WITH MODELS
# ============================================
Write-Host "`n=== Packaging Node Inference Service (WITH MODELS) ===" -ForegroundColor Cyan
Write-Host "WARNING: This will include ~11GB of models and take a LONG time!" -ForegroundColor Yellow

$ServiceId = "node-inference"
$ServiceName = "node-inference"
$ExePath = "$ServicesDir\$ServiceName\target\release\inference-service.exe"

# Check executable
if (-not (Test-Path $ExePath)) {
    Write-Host "[ERROR] Executable not found: $ExePath" -ForegroundColor Red
    Write-Host "Build it first: cd $ServiceName && cargo build --release" -ForegroundColor Yellow
} else {
    $TempDir = "$env:TEMP\package-$ServiceId"
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
    
    # Create service.json
    $ServiceJson = @{
        service_id = $ServiceId
        version = $Version
        platforms = @{
            $Platform = @{
                entrypoint = "inference-service.exe"
                exec = @{ type = "argv"; program = "inference-service.exe"; args = @(); cwd = "." }
                default_port = 5009
                files = @{ requires = @("service.json", "inference-service.exe"); optional = @("models/") }
            }
        }
        health_check = @{ type = "http"; endpoint = "/health"; timeout_ms = 3000; startup_grace_ms = 10000 }
        env_schema = @{ SERVICE_PORT = "int"; MODELS_DIR = "string" }
    }
    $ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8
    
    # Copy executable
    Write-Host "Copying executable..." -ForegroundColor Gray
    Copy-Item -Path $ExePath -Destination "$TempDir\inference-service.exe" -Force
    
    # Copy source files
    Write-Host "Copying source files..." -ForegroundColor Gray
    Copy-Item -Path "$ServicesDir\$ServiceName\src" -Destination "$TempDir\src" -Recurse -Force
    Copy-Item -Path "$ServicesDir\$ServiceName\Cargo.toml" -Destination $TempDir -Force
    Copy-Item -Path "$ServicesDir\$ServiceName\*.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue
    
    # Copy models directory (THIS IS LARGE - ~11GB)
    $ModelsDir = "$ServicesDir\$ServiceName\models"
    if (Test-Path $ModelsDir) {
        Write-Host "Copying models directory (~11GB, this will take 10-30 minutes)..." -ForegroundColor Yellow
        Copy-Item -Path $ModelsDir -Destination "$TempDir\models" -Recurse -Force
        Write-Host "Models copied successfully" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] Models directory not found: $ModelsDir" -ForegroundColor Yellow
    }
    
    # Package (this will take a VERY long time)
    Write-Host "Creating ZIP archive (this will take 30+ minutes due to models)..." -ForegroundColor Yellow
    $ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
    if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
    Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force
    
    $ZipSize = (Get-Item $ZipPath).Length / 1MB
    Write-Host "ZIP size: $([math]::Round($ZipSize, 2)) MB" -ForegroundColor Gray
    
    # Deploy
    Write-Host "Copying to Model Hub (this may take a while)..." -ForegroundColor Gray
    $TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force
    
    Write-Host "[SUCCESS] Node Inference: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green
    
    # Cleanup
    Remove-Item -Recurse -Force $TempDir
    Remove-Item -Force $ZipPath
}

Write-Host "`n=== All Services Packaged ===" -ForegroundColor Cyan

