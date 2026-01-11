# Redis CLI 安装脚本

Write-Host "=== Redis CLI 安装脚本 ===" -ForegroundColor Cyan
Write-Host ""

# 检查是否已安装 redis-cli
if (Get-Command redis-cli -ErrorAction SilentlyContinue) {
    Write-Host "redis-cli 已安装: $(Get-Command redis-cli | Select-Object -ExpandProperty Source)" -ForegroundColor Green
    exit 0
}

Write-Host "redis-cli 未安装，开始安装..." -ForegroundColor Yellow
Write-Host ""

# 方案 1: 尝试使用 Chocolatey
if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Host "使用 Chocolatey 安装 Redis..." -ForegroundColor Green
    choco install redis-64 -y
    if (Get-Command redis-cli -ErrorAction SilentlyContinue) {
        Write-Host "安装成功！" -ForegroundColor Green
        exit 0
    }
}

# 方案 2: 尝试使用 winget
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "使用 winget 安装 Redis..." -ForegroundColor Green
    Write-Host "注意：需要管理员权限" -ForegroundColor Yellow
    winget install Redis.Redis
    if (Get-Command redis-cli -ErrorAction SilentlyContinue) {
        Write-Host "安装成功！" -ForegroundColor Green
        exit 0
    }
}

# 方案 3: 下载便携版
Write-Host ""
Write-Host "Chocolatey 和 winget 不可用，请手动下载 Redis 便携版：" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. 访问: https://github.com/tporadowski/redis/releases" -ForegroundColor White
Write-Host "2. 下载最新版本的 Redis-x64-*.zip" -ForegroundColor White
Write-Host "3. 解压到目录（如 D:\Programs\redis）" -ForegroundColor White
Write-Host "4. 使用完整路径运行: D:\Programs\redis\redis-cli.exe" -ForegroundColor White
Write-Host ""
Write-Host "或者，安装 Chocolatey（需要管理员权限）：" -ForegroundColor Cyan
Write-Host "  Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" -ForegroundColor White
Write-Host "  choco install redis-64 -y" -ForegroundColor White
