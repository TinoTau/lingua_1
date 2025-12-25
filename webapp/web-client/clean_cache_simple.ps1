# Web客户端缓存清理脚本（简化版）
# 用于清理构建缓存、node_modules和旧代码

Write-Host "开始清理Web端缓存..." -ForegroundColor Cyan

# 1. 删除构建输出目录
if (Test-Path "dist") {
    Write-Host "  删除 dist 目录..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "dist"
    Write-Host "  dist 目录已删除" -ForegroundColor Green
}

# 2. 删除node_modules
if (Test-Path "node_modules") {
    Write-Host "  删除 node_modules 目录..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "node_modules"
    Write-Host "  node_modules 目录已删除" -ForegroundColor Green
}

# 3. 清理Vite缓存
$viteCachePaths = @("node_modules\.vite", ".vite", "$env:USERPROFILE\.vite")
foreach ($path in $viteCachePaths) {
    if (Test-Path $path) {
        Write-Host "  删除 Vite 缓存: $path..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
    }
}

# 4. 清理TypeScript编译缓存
if (Test-Path ".tsbuildinfo") {
    Write-Host "  删除 TypeScript 编译缓存..." -ForegroundColor Yellow
    Remove-Item -Force ".tsbuildinfo"
}

Write-Host ""
Write-Host "清理完成！" -ForegroundColor Green
Write-Host ""
Write-Host "下一步操作：" -ForegroundColor Cyan
Write-Host "  1. 重新安装依赖: npm install"
Write-Host "  2. 重新构建: npm run build"
Write-Host "  3. 在浏览器中硬刷新 (Ctrl+Shift+R 或 Ctrl+F5)"

