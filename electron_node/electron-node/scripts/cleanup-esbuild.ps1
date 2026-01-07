# ESBuild 清理脚本
# 用于清理所有 ESBuild 和 Node 进程，并清理缓存

Write-Host "正在清理 ESBuild 和 Node 进程..." -ForegroundColor Yellow

# 终止所有 esbuild 进程
$esbuildProcesses = Get-Process | Where-Object {$_.ProcessName -eq "esbuild"}
if ($esbuildProcesses) {
    Write-Host "找到 $($esbuildProcesses.Count) 个 ESBuild 进程，正在终止..." -ForegroundColor Yellow
    $esbuildProcesses | Stop-Process -Force
    Write-Host "ESBuild 进程已终止" -ForegroundColor Green
} else {
    Write-Host "未找到 ESBuild 进程" -ForegroundColor Green
}

# 清理 Vite 缓存
Write-Host "正在清理 Vite 缓存..." -ForegroundColor Yellow
$viteCachePaths = @(
    "node_modules\.vite",
    "renderer\node_modules\.vite",
    ".vite"
)

foreach ($path in $viteCachePaths) {
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        Write-Host "已清理: $path" -ForegroundColor Green
    }
}

Write-Host "清理完成！请重新运行 'npm run dev'" -ForegroundColor Green
