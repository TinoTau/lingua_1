# Rust Toolchain Repair Script
# Fixes "paging file too small" compilation errors

Write-Host "=== Rust Toolchain Repair Script ===" -ForegroundColor Cyan
Write-Host ""

# 1. Clean build cache
Write-Host "[Step 1/5] Cleaning build cache..." -ForegroundColor Yellow
$targetDir = "d:\Programs\github\lingua_1\central_server\scheduler\target"
if (Test-Path $targetDir) {
    Remove-Item -Path $targetDir -Recurse -Force
    Write-Host "Build cache cleaned" -ForegroundColor Green
}

# 2. Clean cargo cache
Write-Host ""
Write-Host "[Step 2/5] Cleaning cargo cache..." -ForegroundColor Yellow
Push-Location "d:\Programs\github\lingua_1\central_server\scheduler"
try {
    cargo clean 2>$null
    Write-Host "Cargo cache cleaned" -ForegroundColor Green
} catch {
    Write-Host "Cargo clean failed, continuing..." -ForegroundColor Yellow
}
Pop-Location

# 3. Update Rust toolchain
Write-Host ""
Write-Host "[Step 3/5] Updating Rust toolchain..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..."
rustup update stable
if ($LASTEXITCODE -eq 0) {
    Write-Host "Rust toolchain updated successfully" -ForegroundColor Green
} else {
    Write-Host "Rust toolchain update failed" -ForegroundColor Red
    exit 1
}

# 4. Reinstall core components
Write-Host ""
Write-Host "[Step 4/5] Reinstalling Rust core components..." -ForegroundColor Yellow
rustup component remove rust-std-x86_64-pc-windows-msvc 2>$null
rustup component add rust-std-x86_64-pc-windows-msvc
if ($LASTEXITCODE -eq 0) {
    Write-Host "Core components reinstalled successfully" -ForegroundColor Green
} else {
    Write-Host "Core component installation failed" -ForegroundColor Red
    exit 1
}

# 5. Verify toolchain
Write-Host ""
Write-Host "[Step 5/5] Verifying Rust toolchain..." -ForegroundColor Yellow
rustc --version
cargo --version

Write-Host ""
Write-Host "=== Repair Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Now try to rebuild:" -ForegroundColor White
Write-Host "  cd central_server\scheduler" -ForegroundColor Gray
Write-Host "  cargo build" -ForegroundColor Gray
Write-Host ""
