# 启动调度服务器
Write-Host "启动 Lingua 调度服务器..." -ForegroundColor Green

Set-Location $PSScriptRoot\..\scheduler

# 检查 Rust 是否安装
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "错误: 未找到 Rust/Cargo，请先安装 Rust" -ForegroundColor Red
    exit 1
}

# 编译并运行
Write-Host "编译调度服务器..." -ForegroundColor Yellow
cargo build --release

if ($LASTEXITCODE -ne 0) {
    Write-Host "编译失败" -ForegroundColor Red
    exit 1
}

Write-Host "启动调度服务器..." -ForegroundColor Green
cargo run --release

