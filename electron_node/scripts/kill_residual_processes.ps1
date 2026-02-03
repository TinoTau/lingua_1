# 清理 Lingua 节点/调度器残留进程
# 结束占用以下端口的进程：调度器 5010，语义修复 5015，同音纠错 5016，NMT 5008，Piper TTS 5009，Faster Whisper 6007，Model Hub 5000
# 可选：结束 Electron 主进程（节点端）

param(
    [switch]$IncludeElectron = $false   # 加 -IncludeElectron 时同时结束 Electron 相关进程
)

$ports = @(5010, 5015, 5016, 5008, 5009, 6007, 5000)
$killed = @()
$errors = @()

foreach ($port in $ports) {
    $lines = cmd /c "netstat -ano" 2>$null | Select-String "LISTENING" | Select-String ":$port\s"
    foreach ($line in $lines) {
        if ($line -match '\s+(\d+)\s*$') {
            $pid = $matches[1]
            if ($pid -ne '0' -and $killed -notcontains $pid) {
                try {
                    Stop-Process -Id $pid -Force -ErrorAction Stop
                    $killed += $pid
                    Write-Host "已结束 PID $pid (端口 $port)" -ForegroundColor Green
                }
                catch {
                    $errors += "PID $pid (端口 $port): $($_.Exception.Message)"
                }
            }
        }
    }
}

if ($IncludeElectron) {
    Get-Process -Name "electron" -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction Stop
            $killed += $_.Id
            Write-Host "已结束 Electron PID $($_.Id)" -ForegroundColor Green
        }
        catch {
            $errors += "Electron PID $($_.Id): $($_.Exception.Message)"
        }
    }
    Get-Process -Name "lingua-electron-node*" -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction Stop
            if ($killed -notcontains $_.Id) { $killed += $_.Id }
            Write-Host "已结束节点进程 PID $($_.Id)" -ForegroundColor Green
        }
        catch {
            $errors += "节点 PID $($_.Id): $($_.Exception.Message)"
        }
    }
}

if ($killed.Count -eq 0 -and -not $IncludeElectron) {
    Write-Host "未发现占用端口 $($ports -join ', ') 的进程。" -ForegroundColor Yellow
}
elseif ($killed.Count -eq 0 -and $IncludeElectron) {
    Write-Host "未发现上述端口或 Electron 相关进程。" -ForegroundColor Yellow
}
else {
    Write-Host "共结束 $($killed.Count) 个进程。" -ForegroundColor Cyan
}

if ($errors.Count -gt 0) {
    Write-Host "以下进程结束失败（可能需管理员权限）：" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $_" }
}
