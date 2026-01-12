# 集成测试运行脚本 (PowerShell)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "平台化模型管理功能集成测试" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Model Hub 是否运行
Write-Host "检查 Model Hub 服务..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5000/" -Method Get -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✅ Model Hub 正在运行" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Model Hub 未运行，某些测试可能会失败" -ForegroundColor Yellow
    Write-Host "   请先启动 Model Hub: cd ../../../central_server/model-hub && python src/main.py" -ForegroundColor Yellow
    Write-Host ""
}

# 编译 TypeScript
Write-Host "编译 TypeScript..." -ForegroundColor Yellow
npm run build:main

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 编译失败!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ 编译成功" -ForegroundColor Green
Write-Host ""

# 运行集成测试
Write-Host "运行集成测试..." -ForegroundColor Yellow
Write-Host ""

node tests/stage3.2/integration-test.js

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "✅ 所有测试通过" -ForegroundColor Green
} else {
    Write-Host "❌ 部分测试失败" -ForegroundColor Red
}

exit $exitCode

