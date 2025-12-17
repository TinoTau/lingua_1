# NMT M2M100 Service Packaging (Complete, ready to run)

# ============================================
# SETUP - MUST RUN FIRST
# ============================================
$ServicesDir = "D:\Programs\github\lingua_1\electron_node\services"
$ModelHubDir = "D:\Programs\github\lingua_1\central_server\model-hub\models\services"
$Version = "1.0.0"
$Platform = "windows-x64"

Write-Host "=== Packaging NMT M2M100 Service ===" -ForegroundColor Cyan
Write-Host "Services directory: $ServicesDir" -ForegroundColor Gray
Write-Host "Model Hub directory: $ModelHubDir" -ForegroundColor Gray

# ============================================
# PACKAGE NMT M2M100
# ============================================
$ServiceId = "nmt-m2m100"
$ServiceName = "nmt_m2m100"
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
$SourceDir = "$ServicesDir\$ServiceName"
if (-not (Test-Path $SourceDir)) {
    Write-Host "[ERROR] Service directory not found: $SourceDir" -ForegroundColor Red
    exit 1
}

Copy-Item -Path "$SourceDir\*.py" -Destination $TempDir -Force -ErrorAction SilentlyContinue
Copy-Item -Path "$SourceDir\*.txt" -Destination $TempDir -Force -ErrorAction SilentlyContinue
Copy-Item -Path "$SourceDir\README.md" -Destination $TempDir -Force -ErrorAction SilentlyContinue

# Copy HuggingFace model cache (facebook/m2m100_418M)
Write-Host "Checking for HuggingFace model cache..." -ForegroundColor Gray
$HFCacheDir = "$env:USERPROFILE\.cache\huggingface\hub"
$M2M100ModelPath = "$HFCacheDir\models--facebook--m2m100_418M"
if (Test-Path $M2M100ModelPath) {
    Write-Host "Copying HuggingFace model cache..." -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "$TempDir\.cache\huggingface\hub" | Out-Null
    Copy-Item -Path $M2M100ModelPath -Destination "$TempDir\.cache\huggingface\hub\models--facebook--m2m100_418M" -Recurse -Force
    Write-Host "HuggingFace model cache copied" -ForegroundColor Green
} else {
    Write-Host "[WARNING] HuggingFace model cache not found: $M2M100ModelPath" -ForegroundColor Yellow
    Write-Host "  Model will be downloaded at runtime from HuggingFace Hub" -ForegroundColor Yellow
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
Write-Host "[SUCCESS] NMT M2M100 packaged: $TargetDir\service.zip ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $TempDir
Remove-Item -Force $ZipPath

Write-Host "Done!" -ForegroundColor Green

