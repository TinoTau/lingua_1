# GPU仲裁器功能测试脚本
# 用于验证GPU仲裁器在实际运行环境中的功能

Write-Host "=== GPU仲裁器功能测试 ===" -ForegroundColor Green

# 检查节点端是否运行
Write-Host "`n1. 检查节点端进程..." -ForegroundColor Yellow
$nodeProcesses = Get-Process | Where-Object { $_.ProcessName -like "*electron*" -or $_.ProcessName -like "*node*" }
if ($nodeProcesses) {
    Write-Host "✓ 找到节点端进程" -ForegroundColor Green
    $nodeProcesses | ForEach-Object {
        Write-Host "  - $($_.ProcessName) (PID: $($_.Id))" -ForegroundColor Cyan
    }
} else {
    Write-Host "✗ 未找到节点端进程，请先启动节点端" -ForegroundColor Red
    exit 1
}

# 检查配置文件
Write-Host "`n2. 检查GPU仲裁器配置..." -ForegroundColor Yellow
$configPath = "$env:APPDATA\electron-node\electron-node-config.json"
if (Test-Path $configPath) {
    Write-Host "✓ 找到配置文件: $configPath" -ForegroundColor Green
    $config = Get-Content $configPath | ConvertFrom-Json
    if ($config.gpuArbiter) {
        Write-Host "  GPU仲裁器配置:" -ForegroundColor Cyan
        Write-Host "    - enabled: $($config.gpuArbiter.enabled)" -ForegroundColor Cyan
        Write-Host "    - gpuKeys: $($config.gpuArbiter.gpuKeys -join ', ')" -ForegroundColor Cyan
        Write-Host "    - defaultQueueLimit: $($config.gpuArbiter.defaultQueueLimit)" -ForegroundColor Cyan
        if ($config.gpuArbiter.policies) {
            Write-Host "    - policies:" -ForegroundColor Cyan
            $config.gpuArbiter.policies.PSObject.Properties | ForEach-Object {
                $policy = $_.Value
                Write-Host "      $($_.Name): priority=$($policy.priority), maxWaitMs=$($policy.maxWaitMs), busyPolicy=$($policy.busyPolicy)" -ForegroundColor Cyan
            }
        }
    } else {
        Write-Host "⚠ 配置文件中未找到gpuArbiter配置" -ForegroundColor Yellow
        Write-Host "  将使用默认配置（enabled=false）" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ 配置文件不存在: $configPath" -ForegroundColor Yellow
    Write-Host "  将使用默认配置" -ForegroundColor Yellow
}

# 检查日志文件
Write-Host "`n3. 检查日志文件..." -ForegroundColor Yellow
$logPaths = @(
    "$env:APPDATA\electron-node\logs",
    "$env:LOCALAPPDATA\electron-node\logs",
    ".\logs"
)

$logFound = $false
foreach ($logPath in $logPaths) {
    if (Test-Path $logPath) {
        Write-Host "✓ 找到日志目录: $logPath" -ForegroundColor Green
        $logFiles = Get-ChildItem -Path $logPath -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
        if ($logFiles) {
            $logFound = $true
            Write-Host "  最近的日志文件:" -ForegroundColor Cyan
            $logFiles | ForEach-Object {
                Write-Host "    - $($_.Name) ($(Get-Date $_.LastWriteTime -Format 'yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan
            }
            
            # 检查最新的日志文件中是否有GPU仲裁器相关日志
            $latestLog = $logFiles[0].FullName
            Write-Host "`n  检查最新日志中的GPU仲裁器相关记录..." -ForegroundColor Yellow
            $gpuArbiterLogs = Select-String -Path $latestLog -Pattern "GpuArbiter|GPU.*arbiter|gpu.*lease" -CaseSensitive:$false | Select-Object -Last 10
            if ($gpuArbiterLogs) {
                Write-Host "  ✓ 找到GPU仲裁器相关日志:" -ForegroundColor Green
                $gpuArbiterLogs | ForEach-Object {
                    Write-Host "    $($_.Line.Trim())" -ForegroundColor Gray
                }
            } else {
                Write-Host "  ⚠ 未找到GPU仲裁器相关日志" -ForegroundColor Yellow
                Write-Host "    可能原因:" -ForegroundColor Yellow
                Write-Host "    1. GPU仲裁器未启用" -ForegroundColor Yellow
                Write-Host "    2. 尚未处理任何GPU任务" -ForegroundColor Yellow
            }
        }
        break
    }
}

if (-not $logFound) {
    Write-Host "⚠ 未找到日志文件" -ForegroundColor Yellow
}

# 测试建议
Write-Host "`n4. 测试建议:" -ForegroundColor Yellow
Write-Host "  1. 确保GPU仲裁器已启用（在配置文件中设置 gpuArbiter.enabled = true）" -ForegroundColor Cyan
Write-Host "  2. 发送一些翻译任务，观察GPU仲裁器是否正常工作" -ForegroundColor Cyan
Write-Host "  3. 检查日志中是否有以下关键词:" -ForegroundColor Cyan
Write-Host "     - 'GpuArbiter: Lease acquired'" -ForegroundColor Gray
Write-Host "     - 'GpuArbiter: Lease released'" -ForegroundColor Gray
Write-Host "     - 'GpuArbiter: GPU busy, skipping'" -ForegroundColor Gray
Write-Host "  4. 观察任务处理延迟是否改善" -ForegroundColor Cyan

Write-Host "`n=== 测试完成 ===" -ForegroundColor Green
