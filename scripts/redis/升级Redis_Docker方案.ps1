# Redis 升级脚本 - Docker 方案
# 用途: 用 Docker Redis 7 替换旧的 Redis 3.0.504
# 时间: < 5 分钟

Write-Host "=== Redis 升级到 7.x (Docker 方案) ===" -ForegroundColor Green
Write-Host ""

# 步骤1: 停止旧 Redis
Write-Host "步骤 1/5: 停止旧 Redis 服务..." -ForegroundColor Yellow
try {
    Stop-Service Redis -ErrorAction SilentlyContinue
    Write-Host "✅ 旧 Redis 服务已停止" -ForegroundColor Green
} catch {
    Write-Host "⚠️  旧 Redis 服务未运行或不存在" -ForegroundColor Yellow
}

# 步骤2: 备份数据（可选但推荐）
Write-Host ""
Write-Host "步骤 2/5: 备份现有 Redis 数据..." -ForegroundColor Yellow
$backupDir = "C:\Backup\Redis"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}
$backupFile = "$backupDir\dump.rdb.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"

$redisPaths = @(
    "C:\Program Files\Redis\dump.rdb",
    "C:\Redis\dump.rdb",
    "$env:ProgramData\Redis\dump.rdb"
)

$backed = $false
foreach ($path in $redisPaths) {
    if (Test-Path $path) {
        Copy-Item $path $backupFile
        Write-Host "✅ 已备份: $path -> $backupFile" -ForegroundColor Green
        $backed = $true
        break
    }
}

if (-not $backed) {
    Write-Host "⚠️  未找到 dump.rdb，跳过备份" -ForegroundColor Yellow
}

# 步骤3: 停止可能存在的旧 Docker Redis 容器
Write-Host ""
Write-Host "步骤 3/5: 清理旧的 Docker Redis 容器..." -ForegroundColor Yellow
docker stop lingua-redis 2>$null
docker rm lingua-redis 2>$null
Write-Host "✅ 旧容器已清理" -ForegroundColor Green

# 步骤4: 启动新的 Redis 7 容器
Write-Host ""
Write-Host "步骤 4/5: 启动 Redis 7 Docker 容器..." -ForegroundColor Yellow
docker run -d `
    --name lingua-redis `
    -p 6379:6379 `
    --restart unless-stopped `
    -v redis-data:/data `
    redis:7-alpine redis-server --appendonly yes

Write-Host "✅ Redis 7 容器已启动" -ForegroundColor Green

# 步骤5: 验证
Write-Host ""
Write-Host "步骤 5/5: 验证 Redis 版本和 Streams 支持..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# 验证版本
$version = redis-cli INFO server 2>$null | Select-String "redis_version"
Write-Host "  Redis 版本: $version" -ForegroundColor Cyan

# 验证 Streams 支持
Write-Host "  测试 Streams 命令..." -ForegroundColor Cyan
$testId = redis-cli XADD test-stream "*" field value 2>$null
if ($testId) {
    Write-Host "  ✅ XADD 命令正常" -ForegroundColor Green
    redis-cli DEL test-stream | Out-Null
} else {
    Write-Host "  ❌ XADD 命令失败" -ForegroundColor Red
    exit 1
}

# 测试连接
$ping = redis-cli ping 2>$null
if ($ping -eq "PONG") {
    Write-Host "  ✅ Redis 连接正常" -ForegroundColor Green
} else {
    Write-Host "  ❌ Redis 连接失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== ✅ Redis 升级完成！===" -ForegroundColor Green
Write-Host ""
Write-Host "下一步: 启用 Phase2 并重启调度服务器" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. 编辑 config.toml:" -ForegroundColor Cyan
Write-Host "   [scheduler.phase2]" -ForegroundColor White
Write-Host "   enabled = true  # 改为 true" -ForegroundColor White
Write-Host ""
Write-Host "2. 重启调度服务器:" -ForegroundColor Cyan
Write-Host "   cd D:\Programs\github\lingua_1" -ForegroundColor White
Write-Host "   .\scripts\start_scheduler.ps1" -ForegroundColor White
Write-Host ""
Write-Host "3. 查看日志，应该看到:" -ForegroundColor Cyan
Write-Host "   ✅ INFO Phase2 已启用" -ForegroundColor Green
Write-Host "   ✅ INFO Phase2 consumer group 已创建" -ForegroundColor Green
Write-Host ""
