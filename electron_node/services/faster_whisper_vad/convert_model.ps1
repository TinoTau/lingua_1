# PowerShell 脚本：转换 Whisper 模型为 CTranslate2 格式

param(
    [string]$Model = "base",
    [string]$Output = "models/asr/whisper-base-ct2",
    [string]$Device = "cpu",
    [string]$ComputeType = "int8",
    [switch]$Local
)

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceDir = $ScriptDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Faster Whisper 模型转换工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查虚拟环境
$VenvPath = Join-Path $ServiceDir "venv"
$PythonExe = Join-Path $VenvPath "Scripts\python.exe"

if (-not (Test-Path $PythonExe)) {
    Write-Host "❌ 虚拟环境不存在: $VenvPath" -ForegroundColor Red
    Write-Host "请先创建虚拟环境并安装依赖:" -ForegroundColor Yellow
    Write-Host "  python -m venv venv" -ForegroundColor Yellow
    Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor Yellow
    Write-Host "  pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}

# 激活虚拟环境并运行转换脚本
Write-Host "正在激活虚拟环境..." -ForegroundColor Green
& $PythonExe -m pip show faster-whisper | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ faster-whisper 未安装" -ForegroundColor Red
    Write-Host "正在安装依赖..." -ForegroundColor Yellow
    & $PythonExe -m pip install -r (Join-Path $ServiceDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 依赖安装失败" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "开始转换模型..." -ForegroundColor Green
Write-Host "  模型: $Model" -ForegroundColor Cyan
Write-Host "  输出: $Output" -ForegroundColor Cyan
Write-Host "  设备: $Device" -ForegroundColor Cyan
Write-Host "  计算类型: $ComputeType" -ForegroundColor Cyan
Write-Host ""

# 构建输出路径（相对于服务目录）
if (-not [System.IO.Path]::IsPathRooted($Output)) {
    $Output = Join-Path $ServiceDir $Output
}

# 运行转换脚本
$ConvertScript = Join-Path $ServiceDir "convert_model.py"
$Arguments = @(
    "--model", $Model,
    "--output", $Output,
    "--device", $Device,
    "--compute-type", $ComputeType
)

if ($Local) {
    $Arguments += "--local"
}

& $PythonExe $ConvertScript $Arguments

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ 转换完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步:" -ForegroundColor Yellow
    Write-Host "  1. 设置环境变量: `$env:ASR_MODEL_PATH='$Output'" -ForegroundColor Cyan
    Write-Host "  2. 或修改配置指向: $Output" -ForegroundColor Cyan
    Write-Host "  3. 重启服务" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "❌ 转换失败" -ForegroundColor Red
    exit 1
}

