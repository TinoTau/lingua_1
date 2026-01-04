# 修复 llama-cpp-python GPU 支持
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "修复 llama-cpp-python GPU 支持" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查当前安装
Write-Host "[1/4] 检查当前安装..." -ForegroundColor Yellow
$current = pip show llama-cpp-python 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  当前版本: $($current | Select-String 'Version')" -ForegroundColor Gray
} else {
    Write-Host "  llama-cpp-python 未安装" -ForegroundColor Yellow
}
Write-Host ""

# 检查 CUDA 版本
Write-Host "[2/4] 检查 CUDA 版本..." -ForegroundColor Yellow
$cudaPath = $env:CUDA_PATH
if ($cudaPath) {
    Write-Host "  CUDA 路径: $cudaPath" -ForegroundColor Green
    $cudaVersion = (Get-Item "$cudaPath\version.json" -ErrorAction SilentlyContinue | Get-Content | ConvertFrom-Json).cuda.version
    if ($cudaVersion) {
        Write-Host "  CUDA 版本: $cudaVersion" -ForegroundColor Green
        $majorVersion = $cudaVersion.Split('.')[0]
        $minorVersion = $cudaVersion.Split('.')[1]
        $cudaShort = "$majorVersion$minorVersion"
        Write-Host "  将使用 CUDA $cudaShort 版本" -ForegroundColor Cyan
    }
} else {
    Write-Host "  ⚠️  未找到 CUDA_PATH，将尝试自动检测" -ForegroundColor Yellow
    $cudaShort = "121"  # 默认使用 CUDA 12.1
}
Write-Host ""

# 卸载当前版本
Write-Host "[3/4] 卸载当前版本..." -ForegroundColor Yellow
pip uninstall llama-cpp-python -y 2>&1 | Out-Null
Write-Host "  ✓ 已卸载" -ForegroundColor Green
Write-Host ""

# 安装 CUDA 版本
Write-Host "[4/4] 安装 CUDA 版本..." -ForegroundColor Yellow
Write-Host "  尝试使用预编译 wheel (CUDA $cudaShort)..." -ForegroundColor Cyan

# 尝试安装预编译版本
$installCmd = "pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu$cudaShort"
Write-Host "  执行: $installCmd" -ForegroundColor Gray

$installOutput = Invoke-Expression $installCmd 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ 安装成功！" -ForegroundColor Green
} else {
    Write-Host "  ✗ 预编译版本安装失败，尝试其他方法..." -ForegroundColor Yellow
    Write-Host "  错误: $installOutput" -ForegroundColor Red
    
    Write-Host ""
    Write-Host "  备选方案：" -ForegroundColor Yellow
    Write-Host "  1. 使用 conda: conda install -c conda-forge llama-cpp-python" -ForegroundColor Cyan
    Write-Host "  2. 从源码编译: pip install llama-cpp-python --no-cache-dir" -ForegroundColor Cyan
    Write-Host "     (需要设置: `$env:CMAKE_ARGS='-DLLAMA_CUBLAS=on'; `$env:FORCE_CMAKE=1)" -ForegroundColor Cyan
    exit 1
}
Write-Host ""

# 验证安装
Write-Host "验证 GPU 支持..." -ForegroundColor Yellow
$verifyOutput = python -c "import llama_cpp; print('CUDA available:', hasattr(llama_cpp, 'LlamaGPU'))" 2>&1
Write-Host $verifyOutput

if ($verifyOutput -match "CUDA available: True") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✓ GPU 支持已启用！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步：" -ForegroundColor Cyan
    Write-Host "1. 运行验证脚本: python check_gpu_usage_detailed.py" -ForegroundColor Yellow
    Write-Host "2. 重启服务: python semantic_repair_zh_service.py" -ForegroundColor Yellow
    Write-Host "3. 运行测试: python test_comprehensive.py" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "✗ GPU 支持未启用" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "请尝试其他安装方法（见上方备选方案）" -ForegroundColor Yellow
}
