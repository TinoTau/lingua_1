# Service Packaging Script (WITH MODELS)
# Package all services from electron_node/services INCLUDING model files
# Users can download complete service packages (code + models) from Model Hub

$ErrorActionPreference = "Continue"

# Configuration
$ServicesDir = $PSScriptRoot
$ModelHubServicesDir = "$PSScriptRoot\..\..\central_server\model-hub\models\services"
$Version = "1.0.0"
$Platform = "windows-x64"

# Ensure target directory exists
Write-Host "`n=== Service Packaging Script (WITH MODELS) ===" -ForegroundColor Cyan
Write-Host "Target directory: $ModelHubServicesDir" -ForegroundColor Gray
Write-Host "WARNING: This will include model files, packages will be large!" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $ModelHubServicesDir | Out-Null

# Define patterns to exclude (but NOT models/)
$ExcludePatterns = @(
    "venv",
    "__pycache__",
    "*.pyc",
    "*.pyo",
    ".git",
    "logs",
    "target\debug",  # Exclude debug build, but keep release
    "*.log",
    ".pytest_cache",
    ".mypy_cache",
    "*.pdb",
    "*.dll",
    "*.so",
    "*.dylib",
    "Cargo.lock",
    ".cargo"
)

# Track results
$Results = @{
    Success = @()
    Failed = @()
    Skipped = @()
}

function Create-ServiceJson {
    param(
        [string]$ServiceId,
        [string]$ServiceName,
        [string]$ServiceType,
        [int]$DefaultPort,
        [string]$Entrypoint,
        [string]$ExecProgram,
        [array]$ExecArgs,
        [string]$HealthCheckEndpoint = "/health"
    )
    
    $serviceJson = @{
        service_id = $ServiceId
        version = $Version
        platforms = @{
            $Platform = @{
                entrypoint = $Entrypoint
                exec = @{
                    type = "argv"
                    program = $ExecProgram
                    args = $ExecArgs
                    cwd = "."
                }
                default_port = $DefaultPort
                files = @{
                    requires = @("service.json", $Entrypoint)
                    optional = @("venv/")
                }
            }
        }
        health_check = @{
            type = "http"
            endpoint = $HealthCheckEndpoint
            timeout_ms = 3000
            startup_grace_ms = 10000
        }
        env_schema = @{
            SERVICE_PORT = "int"
        }
    }
    
    # Add Python-specific environment variables
    if ($ServiceType -eq "python") {
        $serviceJson.env_schema["PYTHONPATH"] = "string"
        $serviceJson.platforms.$Platform.files.optional += @("venv/")
    }
    
    # Add models to optional files (they are included but marked optional for flexibility)
    if ($ServiceType -eq "rust") {
        $serviceJson.platforms.$Platform.files.optional += @("models/")
    }
    
    return $serviceJson
}

function Package-Service {
    param(
        [string]$ServiceName,
        [string]$ServiceId,
        [hashtable]$ServiceConfig,
        [switch]$IncludeModels
    )
    
    Write-Host "`n[PACKAGING] $ServiceId ($ServiceName)" -ForegroundColor Cyan
    Write-Host "  Source: $ServiceName" -ForegroundColor Gray
    if ($IncludeModels) {
        Write-Host "  Including models: YES" -ForegroundColor Yellow
    }
    
    $ServiceDir = Join-Path $ServicesDir $ServiceName
    if (-not (Test-Path $ServiceDir)) {
        Write-Host "  [SKIP] Service directory not found: $ServiceDir" -ForegroundColor Yellow
        $Results.Skipped += $ServiceId
        return $false
    }
    
    try {
        # Create temporary package directory
        $TempPackageDir = Join-Path $env:TEMP "service-package-$ServiceId"
        if (Test-Path $TempPackageDir) {
            Write-Host "  Cleaning temp directory..." -ForegroundColor Gray
            Remove-Item -Recurse -Force $TempPackageDir -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Force -Path $TempPackageDir | Out-Null
        
        # Create service.json
        Write-Host "  Creating service.json..." -ForegroundColor Gray
        $ServiceJsonPath = Join-Path $TempPackageDir "service.json"
        $ServiceConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $ServiceJsonPath -Encoding UTF8
        
        # Copy service files (including models if requested)
        Write-Host "  Copying files (this may take a while if including models)..." -ForegroundColor Gray
        $FileCount = 0
        $Items = Get-ChildItem -Path $ServiceDir -Recurse -ErrorAction SilentlyContinue
        
        foreach ($Item in $Items) {
            $RelativePath = $Item.FullName.Substring($ServiceDir.Length + 1)
            $ShouldExclude = $false
            
            # Check if should exclude
            foreach ($Pattern in $ExcludePatterns) {
                if ($RelativePath -like "*$Pattern*" -or $Item.Name -like $Pattern) {
                    $ShouldExclude = $true
                    break
                }
            }
            
            # If not including models, exclude models directory
            if (-not $IncludeModels -and $RelativePath -like "models\*") {
                $ShouldExclude = $true
            }
            
            if (-not $ShouldExclude) {
                try {
                    $DestPath = Join-Path $TempPackageDir $RelativePath
                    $DestDir = Split-Path $DestPath -Parent
                    
                    if (-not (Test-Path $DestDir)) {
                        New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
                    }
                    
                    if (-not $Item.PSIsContainer) {
                        Copy-Item -Path $Item.FullName -Destination $DestPath -Force -ErrorAction SilentlyContinue
                        $FileCount++
                        if ($FileCount % 100 -eq 0) {
                            Write-Host "    Copied $FileCount files..." -ForegroundColor DarkGray
                        }
                    }
                } catch {
                    # Skip files that can't be copied
                }
            }
        }
        
        Write-Host "  Copied $FileCount files" -ForegroundColor Gray
        
        # Create ZIP archive
        Write-Host "  Creating ZIP archive (this may take a while)..." -ForegroundColor Gray
        $ZipPath = Join-Path $env:TEMP "$ServiceId-$Version-$Platform.zip"
        if (Test-Path $ZipPath) {
            Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
        }
        
        Compress-Archive -Path "$TempPackageDir\*" -DestinationPath $ZipPath -Force -ErrorAction Stop
        
        $ZipSize = (Get-Item $ZipPath).Length / 1MB
        Write-Host "  ZIP size: $([math]::Round($ZipSize, 2)) MB" -ForegroundColor Gray
        
        # Deploy to Model Hub
        Write-Host "  Deploying to Model Hub..." -ForegroundColor Gray
        $TargetDir = Join-Path $ModelHubServicesDir "$ServiceId\$Version\$Platform"
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
        
        $TargetZipPath = Join-Path $TargetDir "service.zip"
        Copy-Item -Path $ZipPath -Destination $TargetZipPath -Force -ErrorAction Stop
        
        # Calculate SHA256
        Write-Host "  Calculating SHA256..." -ForegroundColor Gray
        $Hash = (Get-FileHash -Path $TargetZipPath -Algorithm SHA256).Hash.ToLower()
        Write-Host "  SHA256: $Hash" -ForegroundColor Gray
        
        # Cleanup temporary files
        Remove-Item -Recurse -Force $TempPackageDir -ErrorAction SilentlyContinue
        Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
        
        Write-Host "  [SUCCESS] Deployed to: $TargetZipPath" -ForegroundColor Green
        $Results.Success += $ServiceId
        return $true
        
    } catch {
        Write-Host "  [ERROR] Failed to package service: $_" -ForegroundColor Red
        $Results.Failed += $ServiceId
        return $false
    }
}

# Package services

Write-Host "`n=== Starting Service Packaging (WITH MODELS) ===" -ForegroundColor Cyan

# 1. NMT M2M100 Service
# Note: This service uses HuggingFace models, typically downloaded at runtime
# If there are local model files, they will be included
$NmtConfig = Create-ServiceJson `
    -ServiceId "nmt-m2m100" `
    -ServiceName "M2M100 NMT Service" `
    -ServiceType "python" `
    -DefaultPort 5008 `
    -Entrypoint "nmt_service.py" `
    -ExecProgram "python" `
    -ExecArgs @("nmt_service.py") `
    -HealthCheckEndpoint "/health"

Package-Service -ServiceName "nmt_m2m100" -ServiceId "nmt-m2m100" -ServiceConfig $NmtConfig -IncludeModels

# 2. Piper TTS Service
# Note: Piper models are typically in a separate directory, but include if present
$PiperConfig = Create-ServiceJson `
    -ServiceId "piper-tts" `
    -ServiceName "Piper TTS Service" `
    -ServiceType "python" `
    -DefaultPort 5005 `
    -Entrypoint "piper_http_server.py" `
    -ExecProgram "python" `
    -ExecArgs @("piper_http_server.py", "--host", "127.0.0.1", "--port", "5005") `
    -HealthCheckEndpoint "/health"

Package-Service -ServiceName "piper_tts" -ServiceId "piper-tts" -ServiceConfig $PiperConfig -IncludeModels

# 3. YourTTS Service
$YourTtsConfig = Create-ServiceJson `
    -ServiceId "your-tts" `
    -ServiceName "YourTTS Service" `
    -ServiceType "python" `
    -DefaultPort 5004 `
    -Entrypoint "yourtts_service.py" `
    -ExecProgram "python" `
    -ExecArgs @("yourtts_service.py", "--host", "127.0.0.1", "--port", "5004") `
    -HealthCheckEndpoint "/health"

Package-Service -ServiceName "your_tts" -ServiceId "your-tts" -ServiceConfig $YourTtsConfig -IncludeModels

# 4. Node Inference Service (Rust)
# This service MUST include models directory (~11GB)
$ExePathRelease = Join-Path $ServicesDir "node-inference\target\release\inference-service.exe"
$ExePathDebug = Join-Path $ServicesDir "node-inference\target\debug\inference-service.exe"

if (Test-Path $ExePathRelease) {
    Write-Host "`n[PACKAGING] node-inference (Node Inference Service)" -ForegroundColor Cyan
    Write-Host "  Found release executable" -ForegroundColor Gray
    Write-Host "  WARNING: Including models directory (~11GB), this will take a long time!" -ForegroundColor Yellow
    
    $NodeInferenceConfig = Create-ServiceJson `
        -ServiceId "node-inference" `
        -ServiceName "Node Inference Service" `
        -ServiceType "rust" `
        -DefaultPort 5009 `
        -Entrypoint "inference-service.exe" `
        -ExecProgram "inference-service.exe" `
        -ExecArgs @() `
        -HealthCheckEndpoint "/health"
    
    $NodeInferenceConfig.platforms.$Platform.files.requires += @("inference-service.exe")
    
    # For Rust service, we need to copy the executable and models separately
    try {
        $TempPackageDir = Join-Path $env:TEMP "service-package-node-inference"
        if (Test-Path $TempPackageDir) {
            Remove-Item -Recurse -Force $TempPackageDir -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Force -Path $TempPackageDir | Out-Null
        
        # Create service.json
        $ServiceJsonPath = Join-Path $TempPackageDir "service.json"
        $NodeInferenceConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $ServiceJsonPath -Encoding UTF8
        
        # Copy executable
        Write-Host "  Copying executable..." -ForegroundColor Gray
        Copy-Item -Path $ExePathRelease -Destination (Join-Path $TempPackageDir "inference-service.exe") -Force
        
        # Copy source files (excluding target/debug, logs, etc.)
        Write-Host "  Copying source files..." -ForegroundColor Gray
        $ServiceDir = Join-Path $ServicesDir "node-inference"
        $Items = Get-ChildItem -Path $ServiceDir -Recurse -ErrorAction SilentlyContinue
        
        $FileCount = 0
        foreach ($Item in $Items) {
            $RelativePath = $Item.FullName.Substring($ServiceDir.Length + 1)
            $ShouldExclude = $false
            
            foreach ($Pattern in $ExcludePatterns) {
                if ($RelativePath -like "*$Pattern*" -or $Item.Name -like $Pattern) {
                    $ShouldExclude = $true
                    break
                }
            }
            
            if (-not $ShouldExclude -and -not $Item.PSIsContainer) {
                try {
                    $DestPath = Join-Path $TempPackageDir $RelativePath
                    $DestDir = Split-Path $DestPath -Parent
                    if (-not (Test-Path $DestDir)) {
                        New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
                    }
                    Copy-Item -Path $Item.FullName -Destination $DestPath -Force -ErrorAction SilentlyContinue
                    $FileCount++
                    if ($FileCount % 100 -eq 0) {
                        Write-Host "    Copied $FileCount files..." -ForegroundColor DarkGray
                    }
                } catch {
                    # Skip files that can't be copied
                }
            }
        }
        
        Write-Host "  Copied $FileCount source files" -ForegroundColor Gray
        
        # Copy models directory (THIS IS LARGE, ~11GB)
        $ModelsDir = Join-Path $ServiceDir "models"
        if (Test-Path $ModelsDir) {
            Write-Host "  Copying models directory (this will take a LONG time, ~11GB)..." -ForegroundColor Yellow
            $ModelsDest = Join-Path $TempPackageDir "models"
            Copy-Item -Path $ModelsDir -Destination $ModelsDest -Recurse -Force -ErrorAction Stop
            Write-Host "  Models copied successfully" -ForegroundColor Green
        } else {
            Write-Host "  WARNING: Models directory not found: $ModelsDir" -ForegroundColor Yellow
        }
        
        # Create ZIP
        Write-Host "  Creating ZIP archive (this will take a VERY long time due to models)..." -ForegroundColor Yellow
        $ZipPath = Join-Path $env:TEMP "node-inference-$Version-$Platform.zip"
        if (Test-Path $ZipPath) {
            Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
        }
        Compress-Archive -Path "$TempPackageDir\*" -DestinationPath $ZipPath -Force
        
        $ZipSize = (Get-Item $ZipPath).Length / 1MB
        Write-Host "  ZIP size: $([math]::Round($ZipSize, 2)) MB" -ForegroundColor Gray
        
        # Deploy
        $TargetDir = Join-Path $ModelHubServicesDir "node-inference\$Version\$Platform"
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
        $TargetZipPath = Join-Path $TargetDir "service.zip"
        Write-Host "  Copying to Model Hub (this may take a while)..." -ForegroundColor Gray
        Copy-Item -Path $ZipPath -Destination $TargetZipPath -Force
        
        $Hash = (Get-FileHash -Path $TargetZipPath -Algorithm SHA256).Hash.ToLower()
        Write-Host "  [SUCCESS] Deployed to: $TargetZipPath" -ForegroundColor Green
        Write-Host "  SHA256: $Hash" -ForegroundColor Gray
        
        Remove-Item -Recurse -Force $TempPackageDir -ErrorAction SilentlyContinue
        Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
        
        $Results.Success += "node-inference"
    } catch {
        Write-Host "  [ERROR] Failed to package node-inference: $_" -ForegroundColor Red
        $Results.Failed += "node-inference"
    }
} elseif (Test-Path $ExePathDebug) {
    Write-Host "`n[SKIP] node-inference: Only debug executable found, skipping (use release build)" -ForegroundColor Yellow
    $Results.Skipped += "node-inference"
} else {
    Write-Host "`n[SKIP] node-inference: Executable not found, skipping" -ForegroundColor Yellow
    Write-Host "  Run: cd node-inference && cargo build --release" -ForegroundColor Gray
    $Results.Skipped += "node-inference"
}

# Print summary
Write-Host "`n=== Packaging Summary ===" -ForegroundColor Cyan
Write-Host "  Success: $($Results.Success.Count) services" -ForegroundColor Green
if ($Results.Success.Count -gt 0) {
    foreach ($service in $Results.Success) {
        Write-Host "    - $service" -ForegroundColor Green
    }
}

Write-Host "  Failed: $($Results.Failed.Count) services" -ForegroundColor Red
if ($Results.Failed.Count -gt 0) {
    foreach ($service in $Results.Failed) {
        Write-Host "    - $service" -ForegroundColor Red
    }
}

Write-Host "  Skipped: $($Results.Skipped.Count) services" -ForegroundColor Yellow
if ($Results.Skipped.Count -gt 0) {
    foreach ($service in $Results.Skipped) {
        Write-Host "    - $service" -ForegroundColor Yellow
    }
}

Write-Host "`nService packages location: $ModelHubServicesDir" -ForegroundColor Cyan

# Generate services index file
Write-Host "`n=== Generating Services Index ===" -ForegroundColor Cyan
$IndexScript = Join-Path $PSScriptRoot "..\..\central_server\model-hub\scripts\generate_services_index.py"
if (Test-Path $IndexScript) {
    Write-Host "Running index generation script..." -ForegroundColor Gray
    python $IndexScript
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Services index generated successfully" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Failed to generate services index" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  Index generation script not found: $IndexScript" -ForegroundColor Yellow
}

Write-Host "=== Done ===" -ForegroundColor Cyan

