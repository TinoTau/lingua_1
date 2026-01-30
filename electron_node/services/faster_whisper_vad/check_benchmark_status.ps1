# 检查基准测试状态的快速脚本
# 运行方式: .\check_benchmark_status.ps1

$terminalFile = "C:\Users\tinot\.cursor\projects\d-Programs-github-lingua-1\terminals\757691.txt"
$logFile = "logs\faster-whisper-vad-service.log"

Write-Host "`n===== ASR 基准测试状态 =====" -ForegroundColor Cyan
Write-Host "检查时间: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# 检查基准测试进度
if (Test-Path $terminalFile) {
    Write-Host "--- 基准测试进度 ---" -ForegroundColor Yellow
    $lastLines = Get-Content $terminalFile -Tail 3
    $lastLines | ForEach-Object { 
        if ($_ -match '\[(\d+)/50\]') {
            $progress = $matches[1]
            $percent = [math]::Round($progress / 50 * 100, 1)
            Write-Host "当前进度: $progress/50 ($percent%)" -ForegroundColor Green
        }
        Write-Host $_
    }
    Write-Host ""
} else {
    Write-Host "基准测试terminal文件未找到" -ForegroundColor Red
    Write-Host ""
}

# 提取最新10次的性能数据
if (Test-Path $logFile) {
    Write-Host "--- 最新10次 segments 转换性能 ---" -ForegroundColor Yellow
    
    $data = @()
    Get-Content $logFile | Select-String "segments_list_done" | Select-Object -Last 10 | ForEach-Object {
        if ($_ -match 't_segments_list=([0-9.]+)s.*worker_uptime=([0-9.]+)s.*job_index=([0-9]+)') {
            $t = [double]$matches[1]
            $uptime = [double]$matches[2]
            $idx = [int]$matches[3]
            
            $data += [PSCustomObject]@{
                JobIndex = $idx
                SegmentsTime = $t
                WorkerUptime = [math]::Round($uptime / 60, 1)
            }
        }
    }
    
    $data | Format-Table @(
        @{Label="Job"; Expression={$_.JobIndex}; Width=5}
        @{Label="t_segments (秒)"; Expression={$_.SegmentsTime}; Width=18}
        @{Label="Worker运行 (分钟)"; Expression={$_.WorkerUptime}; Width=20}
    )
    
    # 统计分析
    if ($data.Count -gt 0) {
        $avg = ($data | Measure-Object -Property SegmentsTime -Average).Average
        $min = ($data | Measure-Object -Property SegmentsTime -Minimum).Minimum
        $max = ($data | Measure-Object -Property SegmentsTime -Maximum).Maximum
        
        Write-Host "统计: 平均=$([math]::Round($avg,2))s  最小=$([math]::Round($min,2))s  最大=$([math]::Round($max,2))s" -ForegroundColor Cyan
        
        # 检查趋势
        $first5 = ($data | Select-Object -First 5 | Measure-Object -Property SegmentsTime -Average).Average
        $last5 = ($data | Select-Object -Last 5 | Measure-Object -Property SegmentsTime -Average).Average
        $trend = $last5 - $first5
        
        if ($trend -gt 2) {
            Write-Host "趋势: 后期变慢 (+$([math]::Round($trend,2))s) [WARN] 检测到退化!" -ForegroundColor Red
        } elseif ($trend -gt 0.5) {
            Write-Host "趋势: 轻微变慢 (+$([math]::Round($trend,2))s)" -ForegroundColor Yellow
        } else {
            Write-Host "趋势: 稳定 ($([math]::Round($trend,2))s)" -ForegroundColor Green
        }
    }
    Write-Host ""
}

# 查看最新生成的结果文件
Write-Host "--- 已生成的结果文件 ---" -ForegroundColor Yellow
Get-ChildItem -Filter "benchmark_results_*.json" -ErrorAction SilentlyContinue | 
    Sort-Object LastWriteTime -Descending | 
    Select-Object -First 3 | 
    ForEach-Object { 
        Write-Host "$($_.Name) ($(Get-Date $_.LastWriteTime -Format 'HH:mm:ss'))"
    }

Get-ChildItem -Filter "benchmark_plot_*.png" -ErrorAction SilentlyContinue | 
    Sort-Object LastWriteTime -Descending | 
    Select-Object -First 3 | 
    ForEach-Object { 
        Write-Host "$($_.Name) ($(Get-Date $_.LastWriteTime -Format 'HH:mm:ss'))"
    }

Write-Host ""
Write-Host "提示: 再次运行此脚本查看最新状态" -ForegroundColor Gray
