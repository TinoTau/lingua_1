# 运行 TextForwardMergeManager 测试

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "运行 TextForwardMergeManager 测试" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 切换到项目目录
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# 运行测试
Write-Host "运行测试..." -ForegroundColor Yellow
npx jest main/src/agent/postprocess/text-forward-merge-manager.test.ts --config jest.config.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host "所有测试通过！" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Green
}
else {
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Red
    Write-Host "测试失败！" -ForegroundColor Red
    Write-Host "=========================================" -ForegroundColor Red
    exit 1
}
