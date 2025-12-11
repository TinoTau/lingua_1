# 复制原项目的模型到新项目
# 用法: .\scripts\copy_models.ps1
# 说明: 脚本会从原项目复制模型到 model-hub/models 和 node-inference/models
# 注意: 默认源路径为 D:\Programs\github\lingua\core\engine\models，如需修改请编辑第 10 行

$ErrorActionPreference = "Stop"

Write-Host "开始复制模型文件..." -ForegroundColor Green

# 原项目路径
$sourcePath = "D:\Programs\github\lingua\core\engine\models"
# 新项目路径
$projectRoot = Split-Path -Parent $PSScriptRoot

# 检查源路径是否存在
if (-not (Test-Path $sourcePath)) {
    Write-Host "错误: 源路径不存在: $sourcePath" -ForegroundColor Red
    Write-Host "请修改脚本中的源路径" -ForegroundColor Yellow
    exit 1
}

# 1. 复制到 model-hub/models (公司模型库)
Write-Host "`n[1/2] 复制到 model-hub/models (公司模型库)..." -ForegroundColor Cyan
$modelHubPath = Join-Path $projectRoot "model-hub\models"
New-Item -ItemType Directory -Force -Path $modelHubPath | Out-Null

# 复制所有模型
Copy-Item -Path "$sourcePath\*" -Destination $modelHubPath -Recurse -Force
Write-Host "已复制到 model-hub/models" -ForegroundColor Green

# 2. 复制到 node-inference/models (节点本地模型库)
Write-Host "`n[2/2] 复制到 node-inference/models (节点本地模型库)..." -ForegroundColor Cyan
$nodeInferencePath = Join-Path $projectRoot "node-inference\models"
New-Item -ItemType Directory -Force -Path $nodeInferencePath | Out-Null

# 复制所有模型
Copy-Item -Path "$sourcePath\*" -Destination $nodeInferencePath -Recurse -Force
Write-Host "已复制到 node-inference/models" -ForegroundColor Green

# 统计信息
Write-Host "`n复制完成！" -ForegroundColor Green
Write-Host "模型位置:" -ForegroundColor Yellow
Write-Host "  - 公司模型库: $modelHubPath" -ForegroundColor Cyan
Write-Host "  - 节点模型库: $nodeInferencePath" -ForegroundColor Cyan

# 计算总大小
$totalSize = (Get-ChildItem -Path $modelHubPath -Recurse -File | Measure-Object -Property Length -Sum).Sum
$totalSizeGB = [math]::Round($totalSize / 1GB, 2)
Write-Host "`n总大小: $totalSizeGB GB" -ForegroundColor Yellow

Write-Host "`n注意: 模型文件已在 .gitignore 中排除，不会被提交到 Git" -ForegroundColor Yellow