# 编译所有平台的代码
# 支持 Windows、Linux、macOS 三个平台

param(
    [switch]$Clean = $false,
    [switch]$Release = $true,
    [string[]]$Platforms = @("win", "linux", "mac")
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "开始编译所有平台的代码" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取脚本所在目录（项目根目录）
$RootDir = $PSScriptRoot
if (-not $RootDir) {
    $RootDir = Get-Location
}

Write-Host "项目根目录: $RootDir" -ForegroundColor Green
Write-Host ""

# 1. 编译 Rust 项目
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "1. 编译 Rust 项目" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# 1.1 编译 Node Inference 服务
Write-Host "1.1 编译 Node Inference 服务..." -ForegroundColor Cyan
$NodeInferenceDir = Join-Path $RootDir "electron_node\services\node-inference"
if (Test-Path $NodeInferenceDir) {
    Push-Location $NodeInferenceDir
    try {
        if ($Clean) {
            Write-Host "  清理之前的构建..." -ForegroundColor Gray
            cargo clean
        }
        
        if ($Platforms -contains "win") {
            Write-Host "  编译 Windows 版本..." -ForegroundColor Gray
            if ($Release) {
                cargo build --release
            } else {
                cargo build
            }
            if ($LASTEXITCODE -ne 0) {
                throw "Node Inference Windows 编译失败"
            }
        }
        
        # 注意：Linux 和 macOS 的交叉编译需要安装 cross 工具
        # 这里只编译 Windows 版本，其他平台需要在实际平台上编译或使用 CI/CD
        Write-Host "  ✅ Node Inference 编译完成" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  ⚠️ Node Inference 目录不存在: $NodeInferenceDir" -ForegroundColor Yellow
}

Write-Host ""

# 1.2 编译 Scheduler 服务
Write-Host "1.2 编译 Scheduler 服务..." -ForegroundColor Cyan
$SchedulerDir = Join-Path $RootDir "central_server\scheduler"
if (Test-Path $SchedulerDir) {
    Push-Location $SchedulerDir
    try {
        if ($Clean) {
            Write-Host "  清理之前的构建..." -ForegroundColor Gray
            cargo clean
        }
        
        if ($Platforms -contains "win") {
            Write-Host "  编译 Windows 版本..." -ForegroundColor Gray
            if ($Release) {
                cargo build --release
            } else {
                cargo build
            }
            if ($LASTEXITCODE -ne 0) {
                throw "Scheduler Windows 编译失败"
            }
        }
        
        Write-Host "  ✅ Scheduler 编译完成" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  ⚠️ Scheduler 目录不存在: $SchedulerDir" -ForegroundColor Yellow
}

Write-Host ""

# 1.3 编译 API Gateway 服务
Write-Host "1.3 编译 API Gateway 服务..." -ForegroundColor Cyan
$ApiGatewayDir = Join-Path $RootDir "central_server\api-gateway"
if (Test-Path $ApiGatewayDir) {
    Push-Location $ApiGatewayDir
    try {
        if ($Clean) {
            Write-Host "  清理之前的构建..." -ForegroundColor Gray
            cargo clean
        }
        
        if ($Platforms -contains "win") {
            Write-Host "  编译 Windows 版本..." -ForegroundColor Gray
            if ($Release) {
                cargo build --release
            } else {
                cargo build
            }
            if ($LASTEXITCODE -ne 0) {
                throw "API Gateway Windows 编译失败"
            }
        }
        
        Write-Host "  ✅ API Gateway 编译完成" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  ⚠️ API Gateway 目录不存在: $ApiGatewayDir" -ForegroundColor Yellow
}

Write-Host ""

# 2. 编译 Node.js/TypeScript 项目
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "2. 编译 Node.js/TypeScript 项目" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# 2.1 编译 Electron Node 客户端
Write-Host "2.1 编译 Electron Node 客户端..." -ForegroundColor Cyan
$ElectronNodeDir = Join-Path $RootDir "electron_node\electron-node"
if (Test-Path $ElectronNodeDir) {
    Push-Location $ElectronNodeDir
    try {
        # 检查是否已安装依赖
        if (-not (Test-Path "node_modules")) {
            Write-Host "  安装依赖..." -ForegroundColor Gray
            npm install
            if ($LASTEXITCODE -ne 0) {
                throw "Electron Node 依赖安装失败"
            }
        }
        
        Write-Host "  编译 TypeScript 和构建前端..." -ForegroundColor Gray
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Electron Node 编译失败"
        }
        
        Write-Host "  ✅ Electron Node 编译完成" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  ⚠️ Electron Node 目录不存在: $ElectronNodeDir" -ForegroundColor Yellow
}

Write-Host ""

# 2.2 编译 Web 客户端
Write-Host "2.2 编译 Web 客户端..." -ForegroundColor Cyan
$WebClientDir = Join-Path $RootDir "webapp\web-client"
if (Test-Path $WebClientDir) {
    Push-Location $WebClientDir
    try {
        # 检查是否已安装依赖
        if (-not (Test-Path "node_modules")) {
            Write-Host "  安装依赖..." -ForegroundColor Gray
            npm install
            if ($LASTEXITCODE -ne 0) {
                throw "Web 客户端依赖安装失败"
            }
        }
        
        Write-Host "  编译 TypeScript 和构建前端..." -ForegroundColor Gray
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Web 客户端编译失败"
        }
        
        Write-Host "  ✅ Web 客户端编译完成" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  ⚠️ Web 客户端目录不存在: $WebClientDir" -ForegroundColor Yellow
}

Write-Host ""

# 3. 编译结果总结
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "编译完成总结" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "✅ Rust 项目编译完成（Windows）" -ForegroundColor Green
Write-Host "   - Node Inference: electron_node\services\node-inference\target\release\inference-service.exe" -ForegroundColor Gray
Write-Host "   - Scheduler: central_server\scheduler\target\release\scheduler.exe" -ForegroundColor Gray
Write-Host "   - API Gateway: central_server\api-gateway\target\release\api-gateway.exe" -ForegroundColor Gray
Write-Host ""

Write-Host "✅ Node.js/TypeScript 项目编译完成" -ForegroundColor Green
Write-Host "   - Electron Node: electron_node\electron-node\main (编译后的 JS)" -ForegroundColor Gray
Write-Host "   - Electron Node Renderer: electron_node\electron-node\renderer\dist" -ForegroundColor Gray
Write-Host "   - Web Client: webapp\web-client\dist" -ForegroundColor Gray
Write-Host ""

Write-Host "⚠️ 注意：" -ForegroundColor Yellow
Write-Host "   - Linux 和 macOS 平台的 Rust 项目需要在实际平台上编译或使用交叉编译工具" -ForegroundColor Yellow
Write-Host "   - 可以使用 'cargo install cross' 安装交叉编译工具" -ForegroundColor Yellow
Write-Host "   - 或者使用 CI/CD 在对应平台上编译" -ForegroundColor Yellow
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "所有编译任务完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

