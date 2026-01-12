# 项目重组脚本
# 将expired文件夹中的代码按照产品设计重新组织

$ErrorActionPreference = "Continue"

Write-Host "开始重组项目结构..." -ForegroundColor Green

# 1. 创建主目录
Write-Host "创建主目录..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path "webapp" -Force | Out-Null
New-Item -ItemType Directory -Path "central_server" -Force | Out-Null
New-Item -ItemType Directory -Path "electron_node" -Force | Out-Null

# 2. 复制 Web 客户端
Write-Host "复制 Web 客户端..." -ForegroundColor Yellow
if (Test-Path "expired\web-client") {
    Copy-Item -Path "expired\web-client\*" -Destination "webapp\" -Recurse -Force
    Write-Host "  ✓ Web 客户端已复制" -ForegroundColor Green
}

# 3. 复制中央服务器组件
Write-Host "复制中央服务器组件..." -ForegroundColor Yellow
if (Test-Path "expired\scheduler") {
    Copy-Item -Path "expired\scheduler" -Destination "central_server\scheduler" -Recurse -Force
    Write-Host "  ✓ 调度服务器已复制" -ForegroundColor Green
}
if (Test-Path "expired\api-gateway") {
    Copy-Item -Path "expired\api-gateway" -Destination "central_server\api-gateway" -Recurse -Force
    Write-Host "  ✓ API 网关已复制" -ForegroundColor Green
}
if (Test-Path "expired\model-hub") {
    Copy-Item -Path "expired\model-hub" -Destination "central_server\model-hub" -Recurse -Force
    Write-Host "  ✓ 模型库服务已复制" -ForegroundColor Green
}

# 4. 复制 Electron 节点客户端组件
Write-Host "复制 Electron 节点客户端组件..." -ForegroundColor Yellow
if (Test-Path "expired\electron-node") {
    Copy-Item -Path "expired\electron-node" -Destination "electron_node\electron-node" -Recurse -Force
    Write-Host "  ✓ Electron 应用已复制" -ForegroundColor Green
}
if (Test-Path "expired\node-inference") {
    Copy-Item -Path "expired\node-inference" -Destination "electron_node\node-inference" -Recurse -Force
    Write-Host "  ✓ 节点推理服务已复制" -ForegroundColor Green
}
if (Test-Path "expired\services") {
    Copy-Item -Path "expired\services" -Destination "electron_node\services" -Recurse -Force
    Write-Host "  ✓ Python 服务已复制" -ForegroundColor Green
}

# 5. 创建 docs 目录
Write-Host "创建 docs 目录..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path "webapp\docs" -Force | Out-Null
New-Item -ItemType Directory -Path "central_server\docs" -Force | Out-Null
New-Item -ItemType Directory -Path "electron_node\docs" -Force | Out-Null

# 6. 复制 Web 客户端文档
Write-Host "复制 Web 客户端文档..." -ForegroundColor Yellow
if (Test-Path "expired\docs\webClient") {
    Copy-Item -Path "expired\docs\webClient\*" -Destination "webapp\docs\" -Recurse -Force
    Write-Host "  ✓ Web 客户端文档已复制" -ForegroundColor Green
}

# 7. 复制中央服务器文档
Write-Host "复制中央服务器文档..." -ForegroundColor Yellow
if (Test-Path "expired\docs\scheduler") {
    Copy-Item -Path "expired\docs\scheduler" -Destination "central_server\docs\scheduler" -Recurse -Force
    Write-Host "  ✓ 调度服务器文档已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\api_gateway") {
    Copy-Item -Path "expired\docs\api_gateway" -Destination "central_server\docs\api_gateway" -Recurse -Force
    Write-Host "  ✓ API 网关文档已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\ARCHITECTURE.md") {
    Copy-Item -Path "expired\docs\ARCHITECTURE.md" -Destination "central_server\docs\" -Force
    Write-Host "  ✓ 架构文档已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\ARCHITECTURE_ANALYSIS.md") {
    Copy-Item -Path "expired\docs\ARCHITECTURE_ANALYSIS.md" -Destination "central_server\docs\" -Force
    Write-Host "  ✓ 架构分析文档已复制" -ForegroundColor Green
}
Get-ChildItem "expired\docs\PROTOCOLS*.md" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "central_server\docs\" -Force
    Write-Host "  ✓ $($_.Name) 已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\project_management") {
    Copy-Item -Path "expired\docs\project_management" -Destination "central_server\docs\project_management" -Recurse -Force
    Write-Host "  ✓ 项目管理文档已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\testing") {
    Copy-Item -Path "expired\docs\testing" -Destination "central_server\docs\testing" -Recurse -Force
    Write-Host "  ✓ 测试文档已复制" -ForegroundColor Green
}

# 8. 复制 Electron 节点客户端文档
Write-Host "复制 Electron 节点客户端文档..." -ForegroundColor Yellow
if (Test-Path "expired\docs\electron_node") {
    Copy-Item -Path "expired\docs\electron_node" -Destination "electron_node\docs\electron_node" -Recurse -Force
    Write-Host "  ✓ Electron 应用文档已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\node_inference") {
    Copy-Item -Path "expired\docs\node_inference" -Destination "electron_node\docs\node_inference" -Recurse -Force
    Write-Host "  ✓ 节点推理服务文档已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\node_register") {
    Copy-Item -Path "expired\docs\node_register" -Destination "electron_node\docs\node_register" -Recurse -Force
    Write-Host "  ✓ 节点注册文档已复制" -ForegroundColor Green
}
if (Test-Path "expired\docs\modular") {
    Copy-Item -Path "expired\docs\modular" -Destination "electron_node\docs\modular" -Recurse -Force
    Write-Host "  ✓ 模块化功能文档已复制" -ForegroundColor Green
}

# 9. 复制 scripts 和 shared
Write-Host "复制 scripts 和 shared..." -ForegroundColor Yellow
if (Test-Path "expired\scripts") {
    Copy-Item -Path "expired\scripts" -Destination "scripts" -Recurse -Force
    Write-Host "  ✓ 脚本已复制" -ForegroundColor Green
}
if (Test-Path "expired\shared") {
    Copy-Item -Path "expired\shared" -Destination "shared" -Recurse -Force
    Write-Host "  ✓ 共享代码已复制" -ForegroundColor Green
}

# 10. 复制配置文件
Write-Host "复制配置文件..." -ForegroundColor Yellow
if (Test-Path "expired\observability.json") {
    Copy-Item -Path "expired\observability.json" -Destination "." -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ observability.json 已复制" -ForegroundColor Green
}
if (Test-Path "expired\observability.json.example") {
    Copy-Item -Path "expired\observability.json.example" -Destination "." -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ observability.json.example 已复制" -ForegroundColor Green
}

Write-Host "`n项目重组完成！" -ForegroundColor Green
Write-Host "新的项目结构：" -ForegroundColor Cyan
Write-Host "  - webapp/              # Web 客户端" -ForegroundColor White
Write-Host "  - central_server/      # 中央服务器" -ForegroundColor White
Write-Host "  - electron_node/       # Electron 节点客户端" -ForegroundColor White
Write-Host "  - scripts/             # 启动脚本" -ForegroundColor White
Write-Host "  - shared/              # 共享代码" -ForegroundColor White
