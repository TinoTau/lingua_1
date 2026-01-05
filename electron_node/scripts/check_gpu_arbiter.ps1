# GPU仲裁器检查脚本
# 用于验证GPU仲裁器在实际运行环境中的状态

Write-Host "=== GPU仲裁器状态检查 ===" -ForegroundColor Green

# 检查节点端进程
Write-Host "`n1. 检查节点端进程..." -ForegroundColor Yellow
$nodeProcesses = Get-Process | Where-Object { $_.ProcessName -like "*electron*" -or $_.ProcessName -like "*node*" }
if ($nodeProcesses) {
    Write-Host "  [OK] 找到节点端进程" -ForegroundColor Green
    $nodeProcesses | ForEach-Object {
        Write-Host "    - $($_.ProcessName) (PID: $($_.Id))" -ForegroundColor Cyan
    }
} else {
    Write-Host "  [WARN] 未找到节点端进程" -ForegroundColor Yellow
}

# 检查配置文件
Write-Host "`n2. 检查GPU仲裁器配置..." -ForegroundColor Yellow
$configPath = "$env:APPDATA\electron-node\electron-node-config.json"
if (Test-Path $configPath) {
    Write-Host "  [OK] 找到配置文件: $configPath" -ForegroundColor Green
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($config.gpuArbiter) {
            Write-Host "  GPU仲裁器配置:" -ForegroundColor Cyan
            Write-Host "    enabled: $($config.gpuArbiter.enabled)" -ForegroundColor Cyan
            if ($config.gpuArbiter.enabled) {
                Write-Host "    [OK] GPU仲裁器已启用" -ForegroundColor Green
            } else {
                Write-Host "    [WARN] GPU仲裁器未启用" -ForegroundColor Yellow
                Write-Host "    提示: 设置 gpuArbiter.enabled = true 以启用" -ForegroundColor Gray
            }
        } else {
            Write-Host "  [WARN] 配置文件中未找到gpuArbiter配置" -ForegroundColor Yellow
            Write-Host "    将使用默认配置（enabled=false）" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  [ERROR] 无法解析配置文件: $_" -ForegroundColor Red
    }
} else {
    Write-Host "  [WARN] 配置文件不存在: $configPath" -ForegroundColor Yellow
    Write-Host "    将使用默认配置" -ForegroundColor Gray
}

# 检查日志
Write-Host "`n3. 检查日志文件..." -ForegroundColor Yellow
$logPaths = @(
    "$env:APPDATA\electron-node\logs",
    "$env:LOCALAPPDATA\electron-node\logs"
)

$logFound = $false
foreach ($logPath in $logPaths) {
    if (Test-Path $logPath) {
        Write-Host "  [OK] 找到日志目录: $logPath" -ForegroundColor Green
        $logFiles = Get-ChildItem -Path $logPath -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3
        if ($logFiles) {
            $logFound = $true
            $latestLog = $logFiles[0].FullName
            Write-Host "    最新日志: $($logFiles[0].Name)" -ForegroundColor Cyan
            
            # 检查GPU仲裁器相关日志
            $gpuArbiterLogs = Select-String -Path $latestLog -Pattern "GpuArbiter|GPU.*lease|gpu.*arbiter" -CaseSensitive:$false | Select-Object -Last 5
            if ($gpuArbiterLogs) {
                Write-Host "  [OK] 找到GPU仲裁器相关日志:" -ForegroundColor Green
                $gpuArbiterLogs | ForEach-Object {
                    $line = $_.Line.Trim()
                    if ($line.Length -gt 100) {
                        $line = $line.Substring(0, 100) + "..."
                    }
                    Write-Host "    $line" -ForegroundColor Gray
                }
            } else {
                Write-Host "  [INFO] 未找到GPU仲裁器相关日志" -ForegroundColor Yellow
                Write-Host "    可能原因: 1) GPU仲裁器未启用 2) 尚未处理GPU任务" -ForegroundColor Gray
            }
        }
        break
    }
}

if (-not $logFound) {
    Write-Host "  [INFO] 未找到日志文件" -ForegroundColor Yellow
}

# 测试建议
Write-Host "`n4. 测试建议:" -ForegroundColor Yellow
Write-Host "  1. 确保GPU仲裁器已启用（gpuArbiter.enabled = true）" -ForegroundColor Cyan
Write-Host "  2. 发送翻译任务，观察日志中的GPU仲裁器记录" -ForegroundColor Cyan
Write-Host "  3. 检查任务处理延迟是否改善" -ForegroundColor Cyan

Write-Host "`n=== 检查完成 ===" -ForegroundColor Green
