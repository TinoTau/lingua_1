# 为 asr_sherpa_en、asr_sherpa_lm 创建 venv 并安装 onnxruntime-gpu 等依赖，供节点端 CTC 跑在 GPU 上
# 在 electron_node 目录下执行: .\scripts\setup_ctc_gpu_venv.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$servicesRoot = Join-Path $root "services"
$services = @("asr_sherpa_en", "asr_sherpa_lm")

foreach ($name in $services) {
    $dir = Join-Path $servicesRoot $name
    if (-not (Test-Path $dir)) {
        Write-Warning "Skip (dir not found): $dir"
        continue
    }
    $venv = Join-Path $dir "venv"
    $py = if ($env:OS -match "Windows") { Join-Path $venv "Scripts\python.exe" } else { Join-Path $venv "bin/python" }
    $pip = if ($env:OS -match "Windows") { Join-Path $venv "Scripts\pip.exe" } else { Join-Path $venv "bin/pip" }

    Push-Location $dir
    try {
        if (-not (Test-Path $py)) {
            Write-Host "Creating venv in $name ..."
            python -m venv venv
        }
        Write-Host "Installing requirements in $name ..."
        & $pip install -r requirements.txt
        Write-Host "OK: $name"
    } finally {
        Pop-Location
    }
}
Write-Host "Done. Start the node and run both CTC services; they will use venv and onnxruntime-gpu."
