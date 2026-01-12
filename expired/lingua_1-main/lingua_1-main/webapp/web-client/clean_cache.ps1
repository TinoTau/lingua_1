# Web Client Cache Cleanup Script
# Clean build cache, node_modules and old code

Write-Host "Starting Web client cache cleanup..." -ForegroundColor Cyan

# 1. Remove build output directory
if (Test-Path "dist") {
    Write-Host "  Removing dist directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "dist"
    Write-Host "  dist directory removed" -ForegroundColor Green
} else {
    Write-Host "  dist directory does not exist, skipping" -ForegroundColor Gray
}

# 2. Remove node_modules
if (Test-Path "node_modules") {
    Write-Host "  Removing node_modules directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "node_modules"
    Write-Host "  node_modules directory removed" -ForegroundColor Green
} else {
    Write-Host "  node_modules directory does not exist, skipping" -ForegroundColor Gray
}

# 3. Clean Vite cache
$viteCachePaths = @(
    "node_modules\.vite",
    ".vite",
    "$env:USERPROFILE\.vite"
)

foreach ($path in $viteCachePaths) {
    if (Test-Path $path) {
        Write-Host "  Removing Vite cache: $path..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        Write-Host "  Vite cache removed: $path" -ForegroundColor Green
    }
}

# 4. Clean npm cache
Write-Host "  Cleaning npm cache..." -ForegroundColor Yellow
npm cache clean --force
Write-Host "  npm cache cleaned" -ForegroundColor Green

# 5. Clean TypeScript compilation cache
if (Test-Path ".tsbuildinfo") {
    Write-Host "  Removing TypeScript compilation cache..." -ForegroundColor Yellow
    Remove-Item -Force ".tsbuildinfo"
    Write-Host "  TypeScript compilation cache removed" -ForegroundColor Green
}

# 6. Clean log files
if (Test-Path "logs") {
    Write-Host "  Removing logs directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "logs"
    Write-Host "  logs directory removed" -ForegroundColor Green
} else {
    Write-Host "  logs directory does not exist, skipping" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Cleanup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Reinstall dependencies: npm install" -ForegroundColor White
Write-Host "  2. Rebuild: npm run build" -ForegroundColor White
Write-Host "  3. Hard refresh in browser (Ctrl+Shift+R or Ctrl+F5)" -ForegroundColor White
