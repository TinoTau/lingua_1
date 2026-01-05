# GPU仲裁器实时测试脚本
# 用于在节点端运行时测试GPU仲裁器功能

param(
    [switch]$Enable,
    [switch]$CheckOnly
)

Write-Host "=== GPU仲裁器实时测试 ===" -ForegroundColor Green
Write-Host ""

# 检查节点端进程
Write-Host "1. 检查节点端进程..." -ForegroundColor Yellow
$nodeProcesses = Get-Process | Where-Object { $_.ProcessName -like "*electron*" } | Where-Object { $_.MainWindowTitle -like "*Lingua*" -or $_.MainWindowTitle -ne "" }
if ($nodeProcesses) {
    Write-Host "  [OK] 节点端正在运行" -ForegroundColor Green
    $nodeProcesses | ForEach-Object {
        Write-Host "    - PID: $($_.Id), Window: $($_.MainWindowTitle)" -ForegroundColor Cyan
    }
} else {
    Write-Host "  [WARN] 未找到节点端进程" -ForegroundColor Yellow
    if (-not $CheckOnly) {
        Write-Host "  请先启动节点端" -ForegroundColor Red
        exit 1
    }
}

# 检查配置文件
Write-Host "`n2. 检查配置文件..." -ForegroundColor Yellow
$configPath = "$env:APPDATA\electron-node\electron-node-config.json"

if (-not (Test-Path $configPath)) {
    Write-Host "  [INFO] 配置文件不存在，将创建新配置" -ForegroundColor Yellow
    $configDir = Split-Path $configPath -Parent
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    $defaultConfig = @{
        servicePreferences = @{
            rustEnabled = $false
            nmtEnabled = $true
            ttsEnabled = $true
            yourttsEnabled = $false
            fasterWhisperVadEnabled = $true
            speakerEmbeddingEnabled = $false
        }
        scheduler = @{
            url = "ws://127.0.0.1:5010/ws/node"
        }
        modelHub = @{
            url = "http://127.0.0.1:5000"
        }
        gpuArbiter = @{
            enabled = $false
            gpuKeys = @("gpu:0")
            defaultQueueLimit = 8
            defaultHoldMaxMs = 8000
            policies = @{
                ASR = @{
                    priority = 90
                    maxWaitMs = 3000
                    busyPolicy = "WAIT"
                }
                NMT = @{
                    priority = 80
                    maxWaitMs = 3000
                    busyPolicy = "WAIT"
                }
                TTS = @{
                    priority = 70
                    maxWaitMs = 2000
                    busyPolicy = "WAIT"
                }
                SEMANTIC_REPAIR = @{
                    priority = 20
                    maxWaitMs = 400
                    busyPolicy = "SKIP"
                }
            }
        }
    }
    $defaultConfig | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
    Write-Host "  [OK] 已创建默认配置文件" -ForegroundColor Green
}

try {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    
    if ($Enable) {
        Write-Host "  [INFO] 启用GPU仲裁器..." -ForegroundColor Yellow
        if (-not $config.gpuArbiter) {
            $config | Add-Member -MemberType NoteProperty -Name "gpuArbiter" -Value @{}
        }
        $config.gpuArbiter.enabled = $true
        $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
        Write-Host "  [OK] GPU仲裁器已启用，请重启节点端" -ForegroundColor Green
        exit 0
    }
    
    if ($config.gpuArbiter) {
        Write-Host "  [OK] GPU仲裁器配置:" -ForegroundColor Green
        Write-Host "    enabled: $($config.gpuArbiter.enabled)" -ForegroundColor $(if ($config.gpuArbiter.enabled) { "Green" } else { "Yellow" })
        Write-Host "    gpuKeys: $($config.gpuArbiter.gpuKeys -join ', ')" -ForegroundColor Cyan
        Write-Host "    defaultQueueLimit: $($config.gpuArbiter.defaultQueueLimit)" -ForegroundColor Cyan
        Write-Host "    defaultHoldMaxMs: $($config.gpuArbiter.defaultHoldMaxMs)" -ForegroundColor Cyan
        
        if (-not $config.gpuArbiter.enabled) {
            Write-Host "`n  [WARN] GPU仲裁器未启用" -ForegroundColor Yellow
            Write-Host "  运行此脚本时添加 -Enable 参数以启用: .\test_gpu_arbiter_live.ps1 -Enable" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  [WARN] 配置文件中未找到gpuArbiter配置" -ForegroundColor Yellow
        Write-Host "  运行此脚本时添加 -Enable 参数以启用: .\test_gpu_arbiter_live.ps1 -Enable" -ForegroundColor Cyan
    }
} catch {
    Write-Host "  [ERROR] 无法读取配置文件: $_" -ForegroundColor Red
}

# 检查日志
Write-Host "`n3. 检查日志..." -ForegroundColor Yellow
$logDirs = @(
    "$env:APPDATA\electron-node\logs",
    "$env:LOCALAPPDATA\electron-node\logs"
)

$logFound = $false
foreach ($logDir in $logDirs) {
    if (Test-Path $logDir) {
        $logFiles = Get-ChildItem -Path $logDir -Filter "*.log" -ErrorAction SilentlyContinue | 
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logFiles) {
            $logFound = $true
            $latestLog = $logFiles[0].FullName
            Write-Host "  [OK] 找到日志文件: $($logFiles[0].Name)" -ForegroundColor Green
            Write-Host "    路径: $latestLog" -ForegroundColor Gray
            Write-Host "    最后修改: $(Get-Date $logFiles[0].LastWriteTime -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
            
            # 检查GPU仲裁器相关日志
            Write-Host "`n  检查GPU仲裁器日志..." -ForegroundColor Yellow
            $gpuLogs = Select-String -Path $latestLog -Pattern "GpuArbiter|gpu.*arbiter|GPU.*lease" -CaseSensitive:$false | Select-Object -Last 10
            if ($gpuLogs) {
                Write-Host "  [OK] 找到GPU仲裁器相关日志 ($($gpuLogs.Count) 条):" -ForegroundColor Green
                $gpuLogs | ForEach-Object {
                    $line = $_.Line.Trim()
                    if ($line.Length -gt 100) {
                        $line = $line.Substring(0, 100) + "..."
                    }
                    Write-Host "    $line" -ForegroundColor Gray
                }
            } else {
                Write-Host "  [INFO] 未找到GPU仲裁器相关日志" -ForegroundColor Yellow
                Write-Host "    可能原因:" -ForegroundColor Yellow
                Write-Host "    1. GPU仲裁器未启用" -ForegroundColor Gray
                Write-Host "    2. 尚未处理任何GPU任务" -ForegroundColor Gray
                Write-Host "    3. 日志级别设置较高" -ForegroundColor Gray
            }
            break
        }
    }
}

if (-not $logFound) {
    Write-Host "  [WARN] 未找到日志文件" -ForegroundColor Yellow
}

# 测试建议
Write-Host "`n4. 测试建议:" -ForegroundColor Yellow
if ($config.gpuArbiter -and $config.gpuArbiter.enabled) {
    Write-Host "  [OK] GPU仲裁器已启用，可以进行以下测试:" -ForegroundColor Green
    Write-Host "    1. 发送翻译任务，观察日志中的租约获取/释放记录" -ForegroundColor Cyan
    Write-Host "    2. 发送多个并发任务，观察队列处理" -ForegroundColor Cyan
    Write-Host "    3. 发送大量任务，观察语义修复的SKIP策略" -ForegroundColor Cyan
} else {
    Write-Host "  [INFO] 要启用GPU仲裁器，运行:" -ForegroundColor Yellow
    Write-Host "    .\test_gpu_arbiter_live.ps1 -Enable" -ForegroundColor Cyan
    Write-Host "  然后重启节点端" -ForegroundColor Cyan
}

Write-Host "`n=== 检查完成 ===" -ForegroundColor Green
