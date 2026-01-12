# Semantic Repair ZH Service - All-in-One Startup Script
# 中文语义修复服务 - 一键启动脚本
# 自动执行：启动服务 -> 等待就绪 -> 检查状态 -> 显示诊断信息

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Semantic Repair ZH - All-in-One Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取脚本所在目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceDir = $scriptDir
Set-Location $serviceDir

# 配置
$port = 5013
$serviceHost = "127.0.0.1"
$maxWaitTime = 300  # 最大等待时间（秒）
$checkInterval = 2  # 检查间隔（秒）

# 设置环境变量
$env:PORT = $port
$env:HOST = $serviceHost
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONIOENCODING = "utf-8"

# ==================== 步骤1: 检查环境 ====================
Write-Host "[Step 1/5] Checking environment..." -ForegroundColor Yellow
Write-Host ""

# 检查 Python
try {
    $pythonVersion = python --version 2>&1
    Write-Host "  ✓ Python: $pythonVersion" -ForegroundColor Green
}
catch {
    Write-Host "  ✗ Python not found!" -ForegroundColor Red
    exit 1
}

# 检查端口
$portInUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($portInUse) {
    $existingPid = $portInUse[0].OwningProcess
    Write-Host "  ⚠️  Port $port is already in use (PID: $existingPid)" -ForegroundColor Yellow
    
    # 检查现有服务是否健康
    try {
        $healthCheck = Invoke-WebRequest -Uri "http://${serviceHost}:${port}/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($healthCheck.StatusCode -eq 200) {
            $health = $healthCheck.Content | ConvertFrom-Json
            if ($health.status -eq "healthy" -and $health.warmed -eq $true) {
                Write-Host "  ✓ Existing service is healthy and ready!" -ForegroundColor Green
                Write-Host "  Using existing service (PID: $existingPid)" -ForegroundColor Cyan
                $script:useExistingService = $true
                $script:existingPid = $existingPid
            }
            else {
                Write-Host "  ⚠️  Existing service is not ready (status: $($health.status))" -ForegroundColor Yellow
                Write-Host "  Will start new service..." -ForegroundColor Yellow
                $script:useExistingService = $false
            }
        }
    }
    catch {
        Write-Host "  ⚠️  Cannot connect to existing service, will start new one..." -ForegroundColor Yellow
        $script:useExistingService = $false
    }
}
else {
    Write-Host "  ✓ Port $port is available" -ForegroundColor Green
    $script:useExistingService = $false
}

# 检查模型目录
$modelsDir = Join-Path $serviceDir "models"
$modelPath = Join-Path $modelsDir "qwen2.5-3b-instruct-zh"
if (Test-Path $modelPath) {
    Write-Host "  ✓ Model directory found" -ForegroundColor Green
}
else {
    Write-Host "  ✗ Model directory not found: $modelPath" -ForegroundColor Red
    exit 1
}

Write-Host ""

# ==================== 步骤2: 启动服务 ====================
Write-Host "[Step 2/5] Starting service..." -ForegroundColor Yellow
Write-Host ""

# 如果已有健康服务，跳过启动步骤
if ($script:useExistingService) {
    Write-Host "  ✓ Using existing service (PID: $($script:existingPid))" -ForegroundColor Green
    Write-Host ""
    $serviceProcess = $null
    $script:serviceReady = $true
}
else {
    $serviceProcess = $null
    try {
        # 启动服务进程（后台运行）
        $processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processStartInfo.FileName = "python"
        $processStartInfo.Arguments = "semantic_repair_zh_service.py"
        $processStartInfo.WorkingDirectory = $serviceDir
        $processStartInfo.UseShellExecute = $false
        $processStartInfo.RedirectStandardOutput = $true
        $processStartInfo.RedirectStandardError = $true
        $processStartInfo.CreateNoWindow = $true
    
        $serviceProcess = New-Object System.Diagnostics.Process
        $serviceProcess.StartInfo = $processStartInfo
    
        # 创建输出缓冲区（用于错误时显示）
        $script:outputBuffer = New-Object System.Text.StringBuilder
        $script:errorBuffer = New-Object System.Text.StringBuilder
    
        $outputHandler = {
            if ($EventArgs.Data) {
                $script:outputBuffer.AppendLine($EventArgs.Data) | Out-Null
                # 只显示关键信息，避免刷屏
                if ($EventArgs.Data -match "Starting|loaded|ready|ERROR|WARNING|CRITICAL|Failed|Exception|Traceback") {
                    Write-Host "  [Service] $($EventArgs.Data)" -ForegroundColor Gray
                }
            }
        }
    
        $errorHandler = {
            if ($EventArgs.Data) {
                $script:errorBuffer.AppendLine($EventArgs.Data) | Out-Null
                Write-Host "  [Service Error] $($EventArgs.Data)" -ForegroundColor DarkYellow
            }
        }
    
        $serviceProcess.add_OutputDataReceived($outputHandler)
        $serviceProcess.add_ErrorDataReceived($errorHandler)
    
        $serviceProcess.Start() | Out-Null
        $serviceProcess.BeginOutputReadLine()
        $serviceProcess.BeginErrorReadLine()
    
        Write-Host "  ✓ Service process started (PID: $($serviceProcess.Id))" -ForegroundColor Green
        Write-Host ""
    
    }
    catch {
        Write-Host "  ✗ Failed to start service: $_" -ForegroundColor Red
        exit 1
    }
}

# ==================== 步骤3: 等待服务就绪 ====================
Write-Host "[Step 3/5] Waiting for service to be ready..." -ForegroundColor Yellow
Write-Host ""

if (-not $script:serviceReady) {
    $serviceReady = $false
    $elapsedTime = 0
    $startTime = Get-Date
}
else {
    $serviceReady = $true
    Write-Host "  ✓ Service is already ready (using existing service)" -ForegroundColor Green
    Write-Host ""
}

while (-not $serviceReady -and $elapsedTime.TotalSeconds -lt $maxWaitTime) {
    Start-Sleep -Seconds $checkInterval
    $elapsedTime = (Get-Date) - $startTime
    
    try {
        $response = Invoke-WebRequest -Uri "http://${serviceHost}:${port}/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $health = $response.Content | ConvertFrom-Json
            if ($health.status -eq "healthy" -and $health.warmed -eq $true) {
                $serviceReady = $true
                Write-Host "  ✓ Service is ready! (took $([math]::Round($elapsedTime.TotalSeconds, 1))s)" -ForegroundColor Green
                break
            }
            elseif ($health.status -eq "loading") {
                Write-Host "  ⏳ Service is loading... (elapsed: $([math]::Round($elapsedTime.TotalSeconds, 1))s)" -ForegroundColor Yellow
            }
            else {
                Write-Host "  ⚠️  Service status: $($health.status)" -ForegroundColor Yellow
            }
        }
    }
    catch {
        # 服务还未启动，继续等待
        if ($elapsedTime.TotalSeconds % 10 -lt $checkInterval) {
            Write-Host "  ⏳ Waiting for service to start... (elapsed: $([math]::Round($elapsedTime.TotalSeconds, 1))s)" -ForegroundColor Gray
        }
    }
}

if (-not $serviceReady) {
    Write-Host "  ✗ Service did not become ready within $maxWaitTime seconds" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Service output (last 50 lines):" -ForegroundColor Yellow
    $outputText = $script:outputBuffer.ToString()
    if ($outputText) {
        $outputLines = $outputText -split "`n" | Select-Object -Last 50
        $outputLines | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    }
    else {
        Write-Host "    (No output captured)" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  Service errors:" -ForegroundColor Yellow
    $errorText = $script:errorBuffer.ToString()
    if ($errorText) {
        $errorLines = $errorText -split "`n" | Select-Object -Last 50
        $errorLines | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
    }
    else {
        Write-Host "    (No errors captured)" -ForegroundColor DarkGray
    }
    Write-Host ""
    if ($serviceProcess -and -not $serviceProcess.HasExited) {
        Write-Host "  Stopping service process..." -ForegroundColor Yellow
        $serviceProcess.Kill()
        $serviceProcess.WaitForExit(5000)
    }
    exit 1
}

Write-Host ""

# ==================== 步骤4: 检查服务状态 ====================
Write-Host "[Step 4/5] Checking service status..." -ForegroundColor Yellow
Write-Host ""

try {
    $statusScript = Join-Path $serviceDir "check_service_status.py"
    if (Test-Path $statusScript) {
        python $statusScript
    }
    else {
        Write-Host "  ⚠️  check_service_status.py not found, skipping..." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "  ⚠️  Failed to run status check: $_" -ForegroundColor Yellow
}

Write-Host ""

# ==================== 步骤5: 显示诊断信息 ====================
Write-Host "[Step 5/5] Getting diagnostics..." -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri "http://${serviceHost}:${port}/diagnostics" -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        $diagnostics = $response.Content | ConvertFrom-Json
        
        Write-Host "  Device: $($diagnostics.device)" -ForegroundColor Cyan
        if ($diagnostics.device_name) {
            Write-Host "  Device Name: $($diagnostics.device_name)" -ForegroundColor Cyan
        }
        if ($diagnostics.gpu_memory_allocated_gb) {
            Write-Host "  GPU Memory Allocated: $([math]::Round($diagnostics.gpu_memory_allocated_gb, 3)) GB" -ForegroundColor Cyan
        }
        if ($diagnostics.gpu_memory_reserved_gb) {
            Write-Host "  GPU Memory Reserved: $([math]::Round($diagnostics.gpu_memory_reserved_gb, 3)) GB" -ForegroundColor Cyan
        }
        if ($diagnostics.model_device) {
            Write-Host "  Model Device: $($diagnostics.model_device)" -ForegroundColor Cyan
        }
        if ($diagnostics.model_dtype) {
            Write-Host "  Model Dtype: $($diagnostics.model_dtype)" -ForegroundColor Cyan
        }
        Write-Host "  Quantization Enabled: $($diagnostics.quantization_enabled)" -ForegroundColor Cyan
        if ($diagnostics.process_memory_mb) {
            Write-Host "  Process Memory: $([math]::Round($diagnostics.process_memory_mb, 2)) MB" -ForegroundColor Cyan
        }
        Write-Host "  CUDA Available: $($diagnostics.cuda_available)" -ForegroundColor Cyan
        
        # 检查潜在问题
        Write-Host ""
        if ($diagnostics.gpu_memory_allocated_gb -and $diagnostics.gpu_memory_allocated_gb -lt 0.1) {
            Write-Host "  ⚠️  WARNING: GPU memory allocated is very low!" -ForegroundColor Yellow
            Write-Host "     This may indicate the model is not loaded on GPU correctly." -ForegroundColor Yellow
        }
        if ($diagnostics.model_device -and $diagnostics.model_device -notlike "*cuda*") {
            Write-Host "  ⚠️  WARNING: Model device is not CUDA!" -ForegroundColor Yellow
            Write-Host "     Expected: cuda:0, Got: $($diagnostics.model_device)" -ForegroundColor Yellow
        }
    }
}
catch {
    Write-Host "  ⚠️  Failed to get diagnostics: $_" -ForegroundColor Yellow
}

Write-Host ""

# ==================== 完成 ====================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Service is running successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service Information:" -ForegroundColor Yellow
Write-Host "  - URL: http://${serviceHost}:${port}" -ForegroundColor Cyan
Write-Host "  - Health: http://${serviceHost}:${port}/health" -ForegroundColor Cyan
Write-Host "  - Diagnostics: http://${serviceHost}:${port}/diagnostics" -ForegroundColor Cyan
if ($serviceProcess) {
    Write-Host "  - Process ID: $($serviceProcess.Id)" -ForegroundColor Cyan
}
elseif ($script:existingPid) {
    Write-Host "  - Process ID: $($script:existingPid) (existing)" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "Press Ctrl+C to stop the service" -ForegroundColor Yellow
Write-Host ""

# 等待用户中断或进程退出
Write-Host "Service is running. Monitoring for output..." -ForegroundColor Cyan
Write-Host ""

try {
    # 持续监控服务输出（仅当有新启动的进程时）
    if ($serviceProcess) {
        while (-not $serviceProcess.HasExited) {
            Start-Sleep -Seconds 2
            
            # 定期检查服务健康状态
            try {
                $healthResponse = Invoke-WebRequest -Uri "http://${serviceHost}:${port}/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
                if ($healthResponse.StatusCode -eq 200) {
                    $health = $healthResponse.Content | ConvertFrom-Json
                    if ($health.status -ne "healthy") {
                        Write-Host "  ⚠️  Service status changed to: $($health.status)" -ForegroundColor Yellow
                    }
                }
            }
            catch {
                # 服务可能已停止
                if ($serviceProcess.HasExited) {
                    break
                }
            }
        }
        
        Write-Host ""
        if ($serviceProcess.HasExited) {
            Write-Host "Service process exited with code: $($serviceProcess.ExitCode)" -ForegroundColor $(if ($serviceProcess.ExitCode -eq 0) { "Green" } else { "Red" })
        }
    }
    else {
        # 使用现有服务，保持运行
        Write-Host "Monitoring existing service. Press Ctrl+C to exit." -ForegroundColor Cyan
        while ($true) {
            Start-Sleep -Seconds 5
            try {
                $healthResponse = Invoke-WebRequest -Uri "http://${serviceHost}:${port}/health" -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
                if ($healthResponse.StatusCode -ne 200) {
                    Write-Host "  ⚠️  Service is no longer responding" -ForegroundColor Yellow
                    break
                }
            }
            catch {
                Write-Host "  ⚠️  Service connection lost" -ForegroundColor Yellow
                break
            }
        }
    }
}
catch {
    Write-Host ""
    Write-Host "Interrupted. Stopping service..." -ForegroundColor Yellow
    if ($serviceProcess -and -not $serviceProcess.HasExited) {
        $serviceProcess.Kill()
        $serviceProcess.WaitForExit(5000)
        Write-Host "Service stopped." -ForegroundColor Green
    }
}
