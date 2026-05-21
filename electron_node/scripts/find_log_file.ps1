# 查找日志文件位置的脚本

Write-Host "=== 查找 electron-main.log 日志文件 ===" -ForegroundColor Green
Write-Host ""

# 可能的日志文件位置
$possiblePaths = @(
    "logs\electron-main.log",
    "electron_node\electron-node\logs\electron-main.log",
    "electron_node\electron-node\main\logs\electron-main.log",
    "electron_node\electron-node\main\electron-node\main\logs\electron-main.log",
    "$env:USERPROFILE\AppData\Local\Programs\lingua_1\logs\electron-main.log",
    "$env:USERPROFILE\AppData\Roaming\lingua_1\logs\electron-main.log"
)

# 从项目根目录开始查找
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $projectRoot

Write-Host "项目根目录: $projectRoot" -ForegroundColor Cyan
Write-Host ""

$found = $false

foreach ($relativePath in $possiblePaths) {
    $fullPath = Join-Path $projectRoot $relativePath
    
    if (Test-Path $fullPath) {
        $fileInfo = Get-Item $fullPath
        Write-Host "找到日志文件:" -ForegroundColor Green
        Write-Host "  路径: $fullPath" -ForegroundColor Yellow
        Write-Host "  大小: $([math]::Round($fileInfo.Length / 1KB, 2)) KB" -ForegroundColor Cyan
        Write-Host "  修改时间: $($fileInfo.LastWriteTime)" -ForegroundColor Cyan
        Write-Host ""
        $found = $true
        break
    }
}

if (-not $found) {
    Write-Host "未找到日志文件" -ForegroundColor Red
    Write-Host ""
    Write-Host "可能的解决方法:" -ForegroundColor Yellow
    Write-Host "1. 确保已经运行过应用，日志文件会在首次运行时创建" -ForegroundColor White
    Write-Host "2. 日志文件位置取决于当前工作目录（process.cwd()）" -ForegroundColor White
    Write-Host ""
    Write-Host "请在应用运行后，查看以下目录:" -ForegroundColor Yellow
    $checkDirs = @(
        Join-Path $projectRoot "logs",
        Join-Path $projectRoot "electron_node\electron-node\logs",
        Join-Path $projectRoot "electron_node\electron-node\main\logs"
    )
    foreach ($dir in $checkDirs) {
        if (Test-Path $dir) {
            Write-Host "  - $dir (目录存在)" -ForegroundColor Cyan
            Get-ChildItem $dir -Filter "*.log" -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "    找到: $($_.Name)" -ForegroundColor Green
            }
        }
    }
    Write-Host ""
    
    # 查找所有.log文件
    Write-Host "正在搜索所有.log文件..." -ForegroundColor Yellow
    $logFiles = Get-ChildItem -Path $projectRoot -Recurse -Filter "*.log" -ErrorAction SilentlyContinue | 
        Where-Object { $_.FullName -notmatch "node_modules|dist|build|\.git" } | 
        Select-Object -First 10 FullName
    
    if ($logFiles) {
        Write-Host "找到以下.log文件:" -ForegroundColor Green
        $logFiles | ForEach-Object {
            Write-Host "  - $_" -ForegroundColor Cyan
        }
    } else {
        Write-Host "未找到任何.log文件" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "如果找到日志文件，运行分析脚本:" -ForegroundColor Yellow
Write-Host "  .\docs\electron_node\analyze_job_issues.ps1 -LogFile log_file_path" -ForegroundColor White
