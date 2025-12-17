# Manual Packaging Commands - Copy and paste each service block one by one

# ============================================
# SETUP (Run this first)
# ============================================
$ServicesDir = "D:\Programs\github\lingua_1\electron_node\services"
$ModelHubDir = "D:\Programs\github\lingua_1\central_server\model-hub\models\services"
$Version = "1.0.0"
$Platform = "windows-x64"

Write-Host "Packaging directory: $ModelHubDir" -ForegroundColor Cyan

# ============================================
# SERVICE 1: NMT M2M100
# ============================================
Write-Host "`n=== Packaging NMT M2M100 Service ===" -ForegroundColor Cyan

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
            files = @{ requires = @("service.json", "nmt_service.py"); optional = @("venv/") }
        }
    }
    health_check = @{ type = "http"; endpoint = "/health"; timeout_ms = 3000; startup_grace_ms = 10000 }
    env_schema = @{ SERVICE_PORT = "int"; PYTHONPATH = "string" }
}
$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8

# Copy files
Write-Host "Copying files..." -ForegroundColor Gray
Copy-Item -Path "$ServicesDir\$ServiceName\*.py" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\*.txt" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

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
Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

# ============================================
# SERVICE 2: PIPER TTS
# ============================================
Write-Host "`n=== Packaging Piper TTS Service ===" -ForegroundColor Cyan

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
            files = @{ requires = @("service.json", "piper_http_server.py"); optional = @("venv/") }
        }
    }
    health_check = @{ type = "http"; endpoint = "/health"; timeout_ms = 3000; startup_grace_ms = 10000 }
    env_schema = @{ SERVICE_PORT = "int"; PYTHONPATH = "string"; PIPER_MODEL_DIR = "string" }
}
$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8

# Copy files
Write-Host "Copying files..." -ForegroundColor Gray
Copy-Item -Path "$ServicesDir\$ServiceName\*.py" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\*.txt" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

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
Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

# ============================================
# SERVICE 3: YOURTTS
# ============================================
Write-Host "`n=== Packaging YourTTS Service ===" -ForegroundColor Cyan

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
            files = @{ requires = @("service.json", "yourtts_service.py"); optional = @("venv/") }
        }
    }
    health_check = @{ type = "http"; endpoint = "/health"; timeout_ms = 3000; startup_grace_ms = 10000 }
    env_schema = @{ SERVICE_PORT = "int"; PYTHONPATH = "string"; MODEL_DIR = "string" }
}
$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8

# Copy files
Write-Host "Copying files..." -ForegroundColor Gray
Copy-Item -Path "$ServicesDir\$ServiceName\*.py" -Destination $TempDir -Force
Copy-Item -Path "$ServicesDir\$ServiceName\*.txt" -Destination $TempDir -Force

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
Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

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
        Write-Host "Copying models directory (~11GB, this will take a LONG time)..." -ForegroundColor Yellow
        Copy-Item -Path $ModelsDir -Destination "$TempDir\models" -Recurse -Force
        Write-Host "Models copied successfully" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] Models directory not found: $ModelsDir" -ForegroundColor Yellow
    }
    
    # Package (this will take a VERY long time)
    Write-Host "Creating ZIP archive (this will take a VERY long time due to models)..." -ForegroundColor Yellow
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
    
    Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green
    
    # Cleanup
    Remove-Item -Recurse -Force $TempDir
    Remove-Item -Force $ZipPath
}

Write-Host "`n=== All Services Packaged ===" -ForegroundColor Cyan

