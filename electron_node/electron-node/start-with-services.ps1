# 强制指定services目录并启动应用
# 用于解决services目录查找问题

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  设置services目录环境变量" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$env:SERVICES_DIR = "D:\Programs\github\lingua_1\electron_node\services"

Write-Host "SERVICES_DIR = $env:SERVICES_DIR" -ForegroundColor Green
Write-Host ""

# 检查services目录是否存在
if (Test-Path $env:SERVICES_DIR) {
    $serviceJsonCount = (Get-ChildItem -Path "$env:SERVICES_DIR\*\service.json" -File -ErrorAction SilentlyContinue).Count
    Write-Host "✅ Services目录存在" -ForegroundColor Green
    Write-Host "✅ 找到 $serviceJsonCount 个 service.json 文件" -ForegroundColor Green
} else {
    Write-Host "❌ Services目录不存在！" -ForegroundColor Red
    Write-Host "请检查路径: $env:SERVICES_DIR" -ForegroundColor Red
    Read-Host "按Enter键退出"
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动应用" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 启动应用
npm start
