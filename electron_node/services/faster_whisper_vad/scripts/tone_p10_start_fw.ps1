# Test-only FW startup helper (dev fallback — production uses Electron ServiceProcessRunner only)
$ErrorActionPreference = "Stop"
$FwRoot = Split-Path -Parent $PSScriptRoot
$CudaPath = if ($env:CUDA_PATH) { $env:CUDA_PATH } else { "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4" }
$CudnnBase = "C:\Program Files\NVIDIA\CUDNN\v9.6\bin"
$ExtraPaths = @(
  (Join-Path $CudaPath "bin"),
  (Join-Path $CudnnBase "12.6"),
  $CudnnBase,
  (Join-Path $CudaPath "libnvvp")
)
$env:PATH = ($ExtraPaths -join ";") + ";" + $env:PATH
$env:FASTER_WHISPER_VAD_PORT = if ($env:FW_PORT) { $env:FW_PORT } elseif ($env:FASTER_WHISPER_VAD_PORT) { $env:FASTER_WHISPER_VAD_PORT } else { "6007" }
Remove-Item Env:PORT -ErrorAction SilentlyContinue
$env:TONE_P10_VAD_CPU = "1"
$env:ASR_MODEL = "medium"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
Set-Location $FwRoot
& (Join-Path $FwRoot ".venv\Scripts\python.exe") (Join-Path $FwRoot "faster_whisper_vad_service.py")
