@echo off
REM Web客户端缓存清理脚本
REM 用于清理构建缓存、node_modules和旧代码

echo 🧹 开始清理Web端缓存...

REM 1. 删除构建输出目录
if exist "dist" (
    echo   删除 dist 目录...
    rmdir /s /q "dist"
    echo   ✅ dist 目录已删除
) else (
    echo   ℹ️  dist 目录不存在，跳过
)

REM 2. 删除node_modules
if exist "node_modules" (
    echo   删除 node_modules 目录...
    rmdir /s /q "node_modules"
    echo   ✅ node_modules 目录已删除
) else (
    echo   ℹ️  node_modules 目录不存在，跳过
)

REM 3. 清理Vite缓存
if exist "node_modules\.vite" (
    echo   删除 Vite 缓存: node_modules\.vite...
    rmdir /s /q "node_modules\.vite"
    echo   ✅ Vite 缓存已删除
)

if exist ".vite" (
    echo   删除 Vite 缓存: .vite...
    rmdir /s /q ".vite"
    echo   ✅ Vite 缓存已删除
)

REM 4. 清理TypeScript编译缓存
if exist ".tsbuildinfo" (
    echo   删除 TypeScript 编译缓存...
    del /f /q ".tsbuildinfo"
    echo   ✅ TypeScript 编译缓存已删除
)

echo.
echo ✨ 清理完成！
echo.
echo 下一步操作：
echo   1. 重新安装依赖: npm install
echo   2. 重新构建: npm run build
echo   3. 在浏览器中硬刷新 (Ctrl+Shift+R 或 Ctrl+F5)
echo.
pause

