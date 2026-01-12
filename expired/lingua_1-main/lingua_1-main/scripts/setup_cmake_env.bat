@echo off
REM CMake 环境变量配置脚本（CMD 版本）
REM 用于设置 CMAKE_POLICY_VERSION_MINIMUM 环境变量

echo 配置 CMake 环境变量...

REM 设置用户级环境变量（永久）
setx CMAKE_POLICY_VERSION_MINIMUM "3.5"

REM 设置当前会话的环境变量（立即生效）
set CMAKE_POLICY_VERSION_MINIMUM=3.5

echo.
echo ✅ 环境变量已设置:
echo    CMAKE_POLICY_VERSION_MINIMUM = 3.5
echo.
echo 注意: 新打开的终端窗口将自动使用此环境变量
echo 当前会话已立即生效，无需重启
echo.

pause

