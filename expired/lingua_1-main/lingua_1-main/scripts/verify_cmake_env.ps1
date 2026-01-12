# 验证 CMake 环境变量配置

Write-Host "`n=== CMake 环境变量配置检查 ===" -ForegroundColor Cyan
Write-Host ""

# 检查用户级环境变量
$userEnv = [System.Environment]::GetEnvironmentVariable("CMAKE_POLICY_VERSION_MINIMUM", "User")
if ($userEnv -eq "3.5") {
    Write-Host "✅ 用户级环境变量: $userEnv" -ForegroundColor Green
} else {
    Write-Host "❌ 用户级环境变量: 未设置" -ForegroundColor Red
}

# 检查当前会话环境变量
$sessionEnv = $env:CMAKE_POLICY_VERSION_MINIMUM
if ($sessionEnv -eq "3.5") {
    Write-Host "✅ 当前会话环境变量: $sessionEnv" -ForegroundColor Green
} else {
    Write-Host "⚠️  当前会话环境变量: 未设置（需要重启终端或运行配置脚本）" -ForegroundColor Yellow
}

# 检查 Cargo 配置文件
$cargoConfig = "electron_node/services/node-inference/.cargo/config.toml"
if (Test-Path $cargoConfig) {
    Write-Host "✅ Cargo 配置文件: 已配置" -ForegroundColor Green
} else {
    Write-Host "⚠️  Cargo 配置文件: 未找到" -ForegroundColor Yellow
}

# 检查 CMake 版本
Write-Host ""
Write-Host "=== CMake 版本 ===" -ForegroundColor Cyan
try {
    $cmakeVersion = cmake --version 2>&1 | Select-String -Pattern "version" | ForEach-Object { $_.Line }
    Write-Host $cmakeVersion -ForegroundColor Green
} catch {
    Write-Host "❌ CMake 未安装或不在 PATH 中" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 配置状态 ===" -ForegroundColor Cyan
if ($userEnv -eq "3.5" -or $sessionEnv -eq "3.5" -or (Test-Path $cargoConfig)) {
    Write-Host "✅ 环境变量已正确配置，可以正常构建 Opus 库" -ForegroundColor Green
} else {
    Write-Host "❌ 环境变量未配置，请运行 scripts\setup_cmake_env.ps1" -ForegroundColor Red
}

Write-Host ""

