# Manual Service Packaging Guide

Step-by-step commands to package each service manually.

## Important Notes

**Model Files Handling:**
- Service packages **MUST contain code AND model files** (new requirement)
- Users will download complete service packages (code + models) from Model Hub
- After download, services will be automatically extracted and ready to use
- This enables "unpack and run" workflow

**Expected Package Sizes:**
- Python services: ~0.01 MB (code only, models downloaded at runtime from HuggingFace)
- node-inference: **~11GB** (code + executable + all models)

---

## Prerequisites

```powershell
# Set variables
$ServicesDir = "D:\Programs\github\lingua_1\electron_node\services"
$ModelHubDir = "D:\Programs\github\lingua_1\central_server\model-hub\models\services"
$Version = "1.0.0"
$Platform = "windows-x64"
```

---

## Service 1: NMT M2M100 Service

**Note:** This service uses HuggingFace models, which are downloaded at runtime. No local models needed.

### Step 1: Create service.json

```powershell
$ServiceId = "nmt-m2m100"
$TempDir = "$env:TEMP\package-$ServiceId"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$ServiceJson = @{
    service_id = $ServiceId
    version = $Version
    platforms = @{
        $Platform = @{
            entrypoint = "nmt_service.py"
            exec = @{
                type = "argv"
                program = "python"
                args = @("nmt_service.py")
                cwd = "."
            }
            default_port = 5008
            files = @{
                requires = @("service.json", "nmt_service.py")
                optional = @("venv/")
            }
        }
    }
    health_check = @{
        type = "http"
        endpoint = "/health"
        timeout_ms = 3000
        startup_grace_ms = 10000
    }
    env_schema = @{
        SERVICE_PORT = "int"
        PYTHONPATH = "string"
    }
}

$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8
```

### Step 2: Copy service files

```powershell
$SourceDir = "$ServicesDir\nmt_m2m100"
Copy-Item -Path "$SourceDir\*.py" -Destination $TempDir -Force
Copy-Item -Path "$SourceDir\*.txt" -Destination $TempDir -Force
Copy-Item -Path "$SourceDir\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

# Note: NMT service uses HuggingFace models (downloaded at runtime)
# If there are local model files, include them:
if (Test-Path "$SourceDir\models") {
    Copy-Item -Path "$SourceDir\models" -Destination "$TempDir\models" -Recurse -Force
}
# Exclude: venv, __pycache__, logs
```

### Step 3: Create ZIP and deploy

```powershell
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip" -ForegroundColor Green
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath
```

---

## Service 2: Piper TTS Service

**Note:** This service uses Piper models, which should be downloaded separately or configured via environment variables.

### Step 1: Create service.json

```powershell
$ServiceId = "piper-tts"
$TempDir = "$env:TEMP\package-$ServiceId"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$ServiceJson = @{
    service_id = $ServiceId
    version = $Version
    platforms = @{
        $Platform = @{
            entrypoint = "piper_http_server.py"
            exec = @{
                type = "argv"
                program = "python"
                args = @("piper_http_server.py", "--host", "127.0.0.1", "--port", "5005")
                cwd = "."
            }
            default_port = 5005
            files = @{
                requires = @("service.json", "piper_http_server.py")
                optional = @("venv/")
            }
        }
    }
    health_check = @{
        type = "http"
        endpoint = "/health"
        timeout_ms = 3000
        startup_grace_ms = 10000
    }
    env_schema = @{
        SERVICE_PORT = "int"
        PYTHONPATH = "string"
        PIPER_MODEL_DIR = "string"
    }
}

$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8
```

### Step 2: Copy service files

```powershell
$SourceDir = "$ServicesDir\piper_tts"
Copy-Item -Path "$SourceDir\*.py" -Destination $TempDir -Force
Copy-Item -Path "$SourceDir\*.txt" -Destination $TempDir -Force
Copy-Item -Path "$SourceDir\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue
```

### Step 3: Create ZIP and deploy

```powershell
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip" -ForegroundColor Green
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath
```

---

## Service 3: YourTTS Service

**Note:** This service uses YourTTS models, which should be downloaded from Model Hub separately.

### Step 1: Create service.json

```powershell
$ServiceId = "your-tts"
$TempDir = "$env:TEMP\package-$ServiceId"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$ServiceJson = @{
    service_id = $ServiceId
    version = $Version
    platforms = @{
        $Platform = @{
            entrypoint = "yourtts_service.py"
            exec = @{
                type = "argv"
                program = "python"
                args = @("yourtts_service.py", "--host", "127.0.0.1", "--port", "5004")
                cwd = "."
            }
            default_port = 5004
            files = @{
                requires = @("service.json", "yourtts_service.py")
                optional = @("venv/")
            }
        }
    }
    health_check = @{
        type = "http"
        endpoint = "/health"
        timeout_ms = 3000
        startup_grace_ms = 10000
    }
    env_schema = @{
        SERVICE_PORT = "int"
        PYTHONPATH = "string"
        MODEL_DIR = "string"
    }
}

$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8
```

### Step 2: Copy service files

```powershell
$SourceDir = "$ServicesDir\your_tts"
Copy-Item -Path "$SourceDir\*.py" -Destination $TempDir -Force
Copy-Item -Path "$SourceDir\*.txt" -Destination $TempDir -Force
```

### Step 3: Create ZIP and deploy

```powershell
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip" -ForegroundColor Green
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath
```

---

## Service 4: Node Inference Service (Rust)

**Note:** This service requires models, but models are **NOT included** in the package (too large, ~11GB).
Models should be downloaded separately from Model Hub and placed in `models/` directory at runtime.

### Step 1: Check if executable exists

```powershell
$ExePath = "$ServicesDir\node-inference\target\release\inference-service.exe"
if (-not (Test-Path $ExePath)) {
    Write-Host "[ERROR] Executable not found. Build it first:" -ForegroundColor Red
    Write-Host "  cd node-inference && cargo build --release" -ForegroundColor Yellow
    exit
}
```

### Step 2: Create service.json

```powershell
$ServiceId = "node-inference"
$TempDir = "$env:TEMP\package-$ServiceId"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$ServiceJson = @{
    service_id = $ServiceId
    version = $Version
    platforms = @{
        $Platform = @{
            entrypoint = "inference-service.exe"
            exec = @{
                type = "argv"
                program = "inference-service.exe"
                args = @()
                cwd = "."
            }
            default_port = 5009
            files = @{
                requires = @("service.json", "inference-service.exe")
                optional = @("models/")
            }
        }
    }
    health_check = @{
        type = "http"
        endpoint = "/health"
        timeout_ms = 3000
        startup_grace_ms = 10000
    }
    env_schema = @{
        SERVICE_PORT = "int"
        MODELS_DIR = "string"
    }
}

$ServiceJson | ConvertTo-Json -Depth 10 | Set-Content -Path "$TempDir\service.json" -Encoding UTF8
```

### Step 3: Copy executable, source files, AND models

```powershell
# Copy executable
Copy-Item -Path $ExePath -Destination "$TempDir\inference-service.exe" -Force

# Copy source files (excluding target/debug, logs, etc.)
$SourceDir = "$ServicesDir\node-inference"
Copy-Item -Path "$SourceDir\src" -Destination "$TempDir\src" -Recurse -Force
Copy-Item -Path "$SourceDir\Cargo.toml" -Destination $TempDir -Force
Copy-Item -Path "$SourceDir\*.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

# IMPORTANT: Copy models directory (~11GB, this will take a LONG time!)
Write-Host "Copying models directory (this will take a long time, ~11GB)..." -ForegroundColor Yellow
$ModelsDir = "$SourceDir\models"
if (Test-Path $ModelsDir) {
    Copy-Item -Path $ModelsDir -Destination "$TempDir\models" -Recurse -Force
    Write-Host "Models copied successfully" -ForegroundColor Green
} else {
    Write-Host "WARNING: Models directory not found: $ModelsDir" -ForegroundColor Yellow
}
```

### Step 4: Create ZIP and deploy

```powershell
# WARNING: Creating ZIP with models will take a VERY long time (~11GB)
Write-Host "Creating ZIP archive (this will take a VERY long time due to models)..." -ForegroundColor Yellow
$ZipPath = "$env:TEMP\$ServiceId-$Version-$Platform.zip"
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -Force

$ZipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "ZIP size: $([math]::Round($ZipSize, 2)) MB" -ForegroundColor Gray

Write-Host "Copying to Model Hub (this may take a while)..." -ForegroundColor Gray
$TargetDir = "$ModelHubDir\$ServiceId\$Version\$Platform"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path $ZipPath -Destination "$TargetDir\service.zip" -Force

Write-Host "[SUCCESS] Deployed: $TargetDir\service.zip" -ForegroundColor Green
Write-Host "[NOTE] Package includes models. Users can download and use immediately." -ForegroundColor Green
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath
```

---

## Model Files Handling

### Current Design

1. **Service packages contain code only** (correct for current packages)
2. **Models are stored separately** in Model Hub's `/storage/models/` endpoint
3. **Services download models at runtime** or load from local `models/` directory

### Model Download

Models should be downloaded separately:

```powershell
# Example: Download models from Model Hub
curl http://localhost:5000/storage/models/{model_id}/{version}/{file_path} -o model_file
```

### Service Runtime

- Services will look for models in:
  1. Local `models/` directory (if exists)
  2. Model Hub (via HTTP download)
  3. Environment variable `MODELS_DIR`

---

## Quick Verification

After packaging, verify the services are available:

```powershell
# Check Model Hub API
curl http://localhost:5000/api/services

# Check specific service
curl http://localhost:5000/api/services/nmt-m2m100/1.0.0/windows-x64
```

---

## Summary

✅ **New Requirement: Packages MUST include models**
- Python services: ~0.01 MB (code only, models downloaded at runtime from HuggingFace)
- node-inference: **~11GB** (code + executable + ALL models)

✅ **Workflow:**
1. Package services with models included
2. Upload to Model Hub
3. Users download complete service packages
4. Auto-extract and restart node
5. Services ready to use immediately

⚠️ **Note:**
- Packaging node-inference with models will take a LONG time (~11GB)
- ZIP compression will also take time
- Ensure sufficient disk space
