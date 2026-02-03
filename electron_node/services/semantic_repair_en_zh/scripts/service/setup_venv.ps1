# 一次性创建虚拟环境并安装依赖（安装包解压或首次使用后运行一次）
# 运行后，应用启动语义修复服务时会自动使用本目录 venv 的 Python

$ErrorActionPreference = "Stop"
$ServiceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$venvPath = Join-Path $ServiceDir "venv"
$reqPath = Join-Path $ServiceDir "requirements.txt"

Set-Location $ServiceDir

if (Test-Path $venvPath) {
    Write-Host "venv already exists at: $venvPath" -ForegroundColor Yellow
    Write-Host "To reinstall dependencies, remove venv and run this script again." -ForegroundColor Gray
    & (Join-Path $venvPath "Scripts\pip.exe") install -r $reqPath
    Write-Host "Done. Dependencies updated." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $reqPath)) {
    Write-Error "requirements.txt not found at: $reqPath"
}

Write-Host "Creating venv at: $venvPath" -ForegroundColor Cyan
python -m venv $venvPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Installing dependencies from requirements.txt..." -ForegroundColor Cyan
& (Join-Path $venvPath "Scripts\pip.exe") install -r $reqPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. venv ready. The app will use it when starting this service." -ForegroundColor Green
