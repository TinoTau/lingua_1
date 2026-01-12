# Simple error capture script
# 简单的错误捕获脚本

$ErrorActionPreference = "Continue"

$env:PORT = "5013"
$env:HOST = "127.0.0.1"
$env:PYTHONUNBUFFERED = "1"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "Starting service and capturing errors..." -ForegroundColor Yellow
Write-Host "Press Ctrl+C after 30 seconds to stop" -ForegroundColor Gray
Write-Host ""

# 启动进程并重定向输出
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "python"
$psi.Arguments = "semantic_repair_zh_service.py"
$psi.WorkingDirectory = $scriptDir
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi

# 创建输出文件
$outputFile = "startup_output_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
$errorFile = "startup_error_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"

$process.Start() | Out-Null

Write-Host "Process started (PID: $($process.Id))" -ForegroundColor Green
Write-Host "Output will be saved to: $outputFile" -ForegroundColor Cyan
Write-Host "Errors will be saved to: $errorFile" -ForegroundColor Cyan
Write-Host ""

# 读取输出（非阻塞）
$outputReader = $process.StandardOutput
$errorReader = $process.StandardError

$outputLines = New-Object System.Collections.ArrayList
$errorLines = New-Object System.Collections.ArrayList

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$maxWait = 30  # 最多等待30秒

while (-not $process.HasExited -and $timer.Elapsed.TotalSeconds -lt $maxWait) {
    # 读取标准输出
    while ($outputReader.Peek() -ge 0) {
        $line = $outputReader.ReadLine()
        if ($line) {
            [void]$outputLines.Add($line)
            Write-Host $line -ForegroundColor Gray
        }
    }
    
    # 读取错误输出
    while ($errorReader.Peek() -ge 0) {
        $line = $errorReader.ReadLine()
        if ($line) {
            [void]$errorLines.Add($line)
            Write-Host $line -ForegroundColor DarkYellow
        }
    }
    
    Start-Sleep -Milliseconds 100
}

# 保存到文件
$outputLines | Out-File -FilePath $outputFile -Encoding UTF8
$errorLines | Out-File -FilePath $errorFile -Encoding UTF8

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Output lines: $($outputLines.Count)" -ForegroundColor Gray
Write-Host "Error lines: $($errorLines.Count)" -ForegroundColor Gray
Write-Host "Files saved: $outputFile, $errorFile" -ForegroundColor Green

# 显示最后几行错误
if ($errorLines.Count -gt 0) {
    Write-Host ""
    Write-Host "=== Last 20 Error Lines ===" -ForegroundColor Red
    $errorLines | Select-Object -Last 20 | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
}

# 停止进程
if (-not $process.HasExited) {
    Write-Host ""
    Write-Host "Stopping process..." -ForegroundColor Yellow
    $process.Kill()
    $process.WaitForExit(3000)
}

Write-Host ""
Write-Host "Done. Check $outputFile and $errorFile for details." -ForegroundColor Green
