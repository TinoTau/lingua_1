# Electron Node 单元测试执行脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Electron Node 单元测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# 1. Electron 应用测试
Write-Host "1. 运行 Electron 应用测试 (Jest)..." -ForegroundColor Yellow
Write-Host ""

$electronNodePath = Join-Path $PSScriptRoot "electron-node"
if (Test-Path $electronNodePath) {
    Push-Location $electronNodePath
    try {
        Write-Host "运行阶段 3.1 测试..." -ForegroundColor Gray
        npm run test:stage3.1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Electron 应用测试通过" -ForegroundColor Green
        }
        else {
            Write-Host "✗ Electron 应用测试失败 (退出码: $LASTEXITCODE)" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "✗ Electron 应用测试执行出错: $_" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "✗ 未找到 electron-node 目录" -ForegroundColor Red
}

Write-Host ""

# 2. 节点推理服务测试
Write-Host "2. 运行节点推理服务测试 (Rust)..." -ForegroundColor Yellow
Write-Host ""

$nodeInferencePath = Join-Path $PSScriptRoot "services" "node-inference"
if (Test-Path $nodeInferencePath) {
    Push-Location $nodeInferencePath
    try {
        Write-Host "运行 Rust 单元测试..." -ForegroundColor Gray
        cargo test --lib -- --nocapture
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ 节点推理服务测试通过" -ForegroundColor Green
        }
        else {
            Write-Host "✗ 节点推理服务测试失败 (退出码: $LASTEXITCODE)" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "✗ 节点推理服务测试执行出错: $_" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "✗ 未找到 node-inference 目录" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试执行完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
