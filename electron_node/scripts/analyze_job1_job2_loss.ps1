# 分析Job1和Job2的丢失问题
$logFile = "d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log"

if (-not (Test-Path $logFile)) {
    Write-Host "日志文件不存在: $logFile"
    exit 1
}

Write-Host "分析Job1和Job2的处理流程..."
Write-Host "=" * 80

# 读取日志文件
$logContent = Get-Content $logFile -Raw

# 查找所有job相关的日志
$jobPattern = 'utteranceIndex["\s:]*([0-9]+)'
$jobMatches = [regex]::Matches($logContent, $jobPattern)

Write-Host "`n找到的utteranceIndex:"
$uniqueIndices = $jobMatches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$uniqueIndices | ForEach-Object { Write-Host "  - Job $_" }

# 分析Job0和Job1
Write-Host "`n" + "=" * 80
Write-Host "分析Job0的处理流程:"
Write-Host "=" * 80

$job0Pattern = '(?s).*?"utteranceIndex"\s*:\s*0[^}]*?}'
$job0Matches = [regex]::Matches($logContent, $job0Pattern)
Write-Host "找到 $($job0Matches.Count) 条Job0相关日志"

# 提取Job0的关键信息
$job0Lines = $logContent -split "`n" | Where-Object { $_ -match 'utteranceIndex["\s:]*0' }
Write-Host "`nJob0的关键日志（前20条）:"
$job0Lines | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }

Write-Host "`n" + "=" * 80
Write-Host "分析Job1的处理流程:"
Write-Host "=" * 80

$job1Pattern = '(?s).*?"utteranceIndex"\s*:\s*1[^}]*?}'
$job1Matches = [regex]::Matches($logContent, $job1Pattern)
Write-Host "找到 $($job1Matches.Count) 条Job1相关日志"

# 提取Job1的关键信息
$job1Lines = $logContent -split "`n" | Where-Object { $_ -match 'utteranceIndex["\s:]*1' }
Write-Host "`nJob1的关键日志（前20条）:"
$job1Lines | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }

Write-Host "`n" + "=" * 80
Write-Host "分析Job2的处理流程:"
Write-Host "=" * 80

$job2Lines = $logContent -split "`n" | Where-Object { $_ -match 'utteranceIndex["\s:]*2' }
Write-Host "`nJob2的关键日志（前20条）:"
$job2Lines | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }

# 查找ASR结果
Write-Host "`n" + "=" * 80
Write-Host "查找ASR结果:"
Write-Host "=" * 80

$asrPattern = 'ASR.*result|asr.*text|textAsr'
$asrLines = $logContent -split "`n" | Where-Object { $_ -match $asrPattern -and ($_ -match 'utteranceIndex["\s:]*[012]') }
Write-Host "找到 $($asrLines.Count) 条ASR相关日志（Job0-2）:"
$asrLines | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
