# Link YourTTS model to TTS library cache directory
# This ensures TTS library can find the local model when using model name

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Linking YourTTS model to TTS cache directory" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Local model path (priority: node-inference, fallback to model-hub)
$nodeInferenceModelDir = Join-Path $projectRoot "node-inference\models\tts\your_tts"
$modelHubModelDir = Join-Path $projectRoot "model-hub\models\tts\your_tts"

if (Test-Path $nodeInferenceModelDir) {
    $localModelDir = $nodeInferenceModelDir
} elseif (Test-Path $modelHubModelDir) {
    $localModelDir = $modelHubModelDir
} else {
    Write-Host "❌ Error: YourTTS model directory not found in either location:" -ForegroundColor Red
    Write-Host "   - $nodeInferenceModelDir" -ForegroundColor Yellow
    Write-Host "   - $modelHubModelDir" -ForegroundColor Yellow
    exit 1
}

# TTS cache directory (Windows default)
$ttsHome = "$env:USERPROFILE\.local\share\tts"
$cacheModelDir = Join-Path $ttsHome "tts_models--multilingual--multi-dataset--your_tts"

# Check if local model exists
if (-not (Test-Path (Join-Path $localModelDir "model.pth"))) {
    Write-Host "❌ Error: Local model file not found: $localModelDir\model.pth" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Local model file exists: $localModelDir\model.pth" -ForegroundColor Green
Write-Host ""

# Create TTS cache directory
if (-not (Test-Path $ttsHome)) {
    New-Item -ItemType Directory -Path $ttsHome -Force | Out-Null
    Write-Host "Created TTS cache directory: $ttsHome" -ForegroundColor Green
}

# Check if cache directory already exists
if (Test-Path $cacheModelDir) {
    Write-Host "⚠️  Cache directory already exists: $cacheModelDir" -ForegroundColor Yellow
    Write-Host "   This might be a model being downloaded" -ForegroundColor Yellow
    Write-Host ""
    
    $response = Read-Host "Backup existing directory and create link? (y/n)"
    if ($response -eq "y" -or $response -eq "Y") {
        # Backup existing directory
        $backupDir = "${cacheModelDir}_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Write-Host "Backing up existing directory to: $backupDir" -ForegroundColor Yellow
        Move-Item -Path $cacheModelDir -Destination $backupDir -Force
        
        # Create symbolic link
        Write-Host "Creating symbolic link..." -ForegroundColor Yellow
        New-Item -ItemType SymbolicLink -Path $cacheModelDir -Target $localModelDir -Force | Out-Null
        Write-Host "✅ Symbolic link created" -ForegroundColor Green
    }
    else {
        Write-Host "Operation cancelled" -ForegroundColor Yellow
        exit 0
    }
}
else {
    # Create symbolic link directly
    Write-Host "Creating symbolic link: $cacheModelDir -> $localModelDir" -ForegroundColor Yellow
    New-Item -ItemType SymbolicLink -Path $cacheModelDir -Target $localModelDir -Force | Out-Null
    Write-Host "✅ Symbolic link created" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ✅ Complete!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "TTS library will now use the local model directly, no download needed." -ForegroundColor Green
Write-Host ""
Write-Host "Verifying link:" -ForegroundColor Cyan
Get-ChildItem -Path $cacheModelDir -ErrorAction SilentlyContinue | Select-Object -First 5 | Format-Table Name, Length
