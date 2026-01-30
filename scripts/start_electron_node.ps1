# Start Electron Node Client

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Lingua Electron Node Client" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$electronNodePath = Join-Path (Join-Path $projectRoot "electron_node") "electron-node"

# Check if directory exists
if (-not (Test-Path $electronNodePath)) {
    Write-Host "Error: Electron node client directory not found: $electronNodePath" -ForegroundColor Red
    exit 1
}

# Switch to electron-node directory
Push-Location $electronNodePath

try {
    # Create logs directory
    $logDir = Join-Path $electronNodePath "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
    }

    # Check if Node.js is installed
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "Error: Node.js not found, please install Node.js 18+" -ForegroundColor Red
        exit 1
    }

    # Check if npm is installed
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "Error: npm not found, please install npm" -ForegroundColor Red
        exit 1
    }

    # Check if node_modules exists
    if (-not (Test-Path "node_modules")) {
        Write-Host "Dependencies not installed, installing..." -ForegroundColor Yellow
        Write-Host "This may take a few minutes..." -ForegroundColor Gray
        npm install
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Dependency installation failed" -ForegroundColor Red
            exit 1
        }
    }

    # Check if main process is built
    $mainBuildPath = Join-Path (Join-Path $electronNodePath "main") "index.js"
    if (-not (Test-Path $mainBuildPath)) {
        Write-Host "Main process not compiled, compiling..." -ForegroundColor Yellow
        npm run build:main
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Main process compilation failed" -ForegroundColor Red
            exit 1
        }
    }

    # Check if renderer is built (optional, will be built by vite in dev mode)
    # But for production, we should build it
    $rendererDistPath = Join-Path (Join-Path $electronNodePath "renderer") "dist"
    if (-not (Test-Path $rendererDistPath)) {
        Write-Host "Renderer not built, building..." -ForegroundColor Yellow
        npm run build:renderer
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Renderer build failed" -ForegroundColor Red
            exit 1
        }
    }

    # Check scheduler URL (can be configured via environment variable)
    $schedulerUrl = if ($env:SCHEDULER_URL) { 
        $env:SCHEDULER_URL 
    }
    else { 
        "ws://localhost:5010/ws/node"
    }

    Write-Host ""
    Write-Host "Configuration:" -ForegroundColor Yellow
    Write-Host "  Scheduler URL: $schedulerUrl" -ForegroundColor Gray
    Write-Host "  Project Root: $projectRoot" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Tip: If scheduler URL is different, set environment variable SCHEDULER_URL" -ForegroundColor Cyan
    Write-Host '  Example: $env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/node"' -ForegroundColor Gray
    Write-Host ""

    # Set log file path
    $logFile = Join-Path $logDir "electron-main.log"
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $logFileWithTimestamp = Join-Path $logDir "electron-main_$timestamp.log"

    Write-Host "Starting Electron application..." -ForegroundColor Yellow
    Write-Host "Logs will be saved to: $logFileWithTimestamp" -ForegroundColor Gray
    Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
    Write-Host ""

    # Set environment variables
    $env:SCHEDULER_URL = $schedulerUrl
    $env:PROJECT_ROOT = $projectRoot
    $env:NODE_ENV = "production"  # 生产环境模式，跳过Vite检查

    # 生产环境模式：不启动Vite，使用已构建的renderer
    Write-Host "Running in production mode (NODE_ENV=production)" -ForegroundColor Green
    Write-Host "Vite dev server will not be started" -ForegroundColor Gray
    Write-Host "Using built renderer from: $rendererDistPath" -ForegroundColor Gray

    # Start Electron application
    # Note: npm start will start Electron, output will go to stdout/stderr
    Write-Host "Starting Electron application..." -ForegroundColor Green
    npm start 2>&1 | Tee-Object -FilePath $logFileWithTimestamp

}
catch {
    Write-Host "Startup failed: $_" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
