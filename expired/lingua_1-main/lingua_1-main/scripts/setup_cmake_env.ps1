# CMake 环境变量配置脚本
# 用于设置 CMAKE_POLICY_VERSION_MINIMUM 环境变量

Write-Host "配置 CMake 环境变量..." -ForegroundColor Cyan

# 设置用户级环境变量（永久）
[System.Environment]::SetEnvironmentVariable("CMAKE_POLICY_VERSION_MINIMUM", "3.5", "User")

# 设置当前会话的环境变量（立即生效）
$env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"

Write-Host "✅ 环境变量已设置:" -ForegroundColor Green
Write-Host "   CMAKE_POLICY_VERSION_MINIMUM = 3.5" -ForegroundColor Yellow
Write-Host ""
Write-Host "注意: 新打开的终端窗口将自动使用此环境变量" -ForegroundColor Cyan
Write-Host "当前会话已立即生效，无需重启" -ForegroundColor Cyan

# 验证设置
$value = [System.Environment]::GetEnvironmentVariable("CMAKE_POLICY_VERSION_MINIMUM", "User")
if ($value -eq "3.5") {
    Write-Host ""
    Write-Host "✅ 验证成功: 环境变量已永久设置" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "⚠️  警告: 环境变量设置可能失败" -ForegroundColor Yellow
}

