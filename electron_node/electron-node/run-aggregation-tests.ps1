# 运行聚合相关测试的脚本

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "运行 Utterance Aggregation 相关测试" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 切换到项目目录
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# 1. 编译 TypeScript 代码
Write-Host "[1/3] 编译 TypeScript 代码..." -ForegroundColor Yellow
npm run build:main
if ($LASTEXITCODE -ne 0) {
    Write-Host "编译失败！" -ForegroundColor Red
    exit 1
}
Write-Host "编译成功！" -ForegroundColor Green
Write-Host ""

# 2. 运行 TextForwardMergeManager 测试
Write-Host "[2/3] 运行 TextForwardMergeManager 测试..." -ForegroundColor Yellow
npx jest main/src/agent/postprocess/text-forward-merge-manager.test.ts --config jest.config.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "TextForwardMergeManager 测试失败！" -ForegroundColor Red
    exit 1
}
Write-Host "TextForwardMergeManager 测试通过！" -ForegroundColor Green
Write-Host ""

# 3. 运行聚合相关测试
Write-Host "[3/3] 运行聚合相关测试..." -ForegroundColor Yellow
npx jest main/src/agent/postprocess --config jest.config.js --testPathPattern="aggregation|deduplication"
if ($LASTEXITCODE -ne 0) {
    Write-Host "聚合相关测试失败！" -ForegroundColor Red
    exit 1
}
Write-Host "聚合相关测试通过！" -ForegroundColor Green
Write-Host ""

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "所有测试完成！" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
