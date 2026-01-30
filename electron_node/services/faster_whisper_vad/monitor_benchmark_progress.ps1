# ASR 基准测试进度监控脚本
# 实时监控基准测试的运行进度和ASR日志中的性能指标

param(
    [int]$RefreshSeconds = 10
)

Write-Host "===== ASR 基准测试进度监控 =====" -ForegroundColor Cyan
Write-Host ""

$terminalFile = "C:\Users\tinot\.cursor\projects\d-Programs-github-lingua-1\terminals\757691.txt"
$logFile = "logs\faster-whisper-vad-service.log"

while ($true) {
    Clear-Host
    Write-Host "===== ASR 基准测试进度监控 =====" -ForegroundColor Cyan
    Write-Host "刷新时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
    Write-Host ""
    
    # 查看基准测试进度
    if (Test-Path $terminalFile) {
        Write-Host "--- 基准测试进度 ---" -ForegroundColor Yellow
        $content = Get-Content $terminalFile -Tail 10
        $content | ForEach-Object { Write-Host $_ }
        Write-Host ""
    }
    
    # 查看最新的segments性能
    if (Test-Path $logFile) {
        Write-Host "--- 最新5次 segments 转换性能 ---" -ForegroundColor Yellow
        Get-Content $logFile | Select-String "segments_list_done" | Select-Object -Last 5 | ForEach-Object {
            if ($_ -match 't_segments_list=([0-9.]+)s.*worker_uptime=([0-9.]+)s.*job_index=([0-9]+)') {
                $t = $matches[1]
                $uptime = $matches[2]
                $idx = $matches[3]
                
                $color = "Green"
                if ([double]$t -gt 15) { $color = "Red" }
                elseif ([double]$t -gt 10) { $color = "Yellow" }
                
                Write-Host "job_index=$idx : t_segments=$t`s (worker_uptime=$uptime`s)" -ForegroundColor $color
            }
        }
        Write-Host ""
    }
    
    Write-Host "按 Ctrl+C 停止监控，每 $RefreshSeconds 秒刷新一次" -ForegroundColor Gray
    Start-Sleep -Seconds $RefreshSeconds
}
