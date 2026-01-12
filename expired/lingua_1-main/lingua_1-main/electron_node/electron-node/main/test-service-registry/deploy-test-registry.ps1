# 部署测试服务注册表脚本 (PowerShell)
# 
# 将测试用的服务注册表文件部署到 Electron 应用的 userData 目录
# 
# 使用方法:
#   .\deploy-test-registry.ps1

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 获取 Electron userData 目录
function Get-UserDataPath {
    # 方法1: 从环境变量读取
    if ($env:USER_DATA) {
        return $env:USER_DATA
    }

    # 方法2: 使用默认的 Electron userData 路径
    $appDataPath = $env:APPDATA
    if (-not $appDataPath) {
        $appDataPath = Join-Path $env:USERPROFILE "AppData\Roaming"
    }

    # Electron 应用的默认 userData 目录名（根据实际应用名称调整）
    $appName = if ($env:ELECTRON_APP_NAME) { $env:ELECTRON_APP_NAME } else { "electron-node" }
    return Join-Path $appDataPath $appName
}

Write-Host "开始部署测试服务注册表...`n" -ForegroundColor Cyan

try {
    # 读取测试文件
    $installedJsonPath = Join-Path $ScriptDir "installed.json"
    $currentJsonPath = Join-Path $ScriptDir "current.json"

    if (-not (Test-Path $installedJsonPath) -or -not (Test-Path $currentJsonPath)) {
        Write-Host "错误: 找不到测试注册表文件" -ForegroundColor Red
        Write-Host "请确保 installed.json 和 current.json 文件存在" -ForegroundColor Red
        exit 1
    }

    $installedJson = Get-Content $installedJsonPath -Raw -Encoding UTF8
    $currentJson = Get-Content $currentJsonPath -Raw -Encoding UTF8

    # 获取目标路径
    $userData = Get-UserDataPath
    $servicesDir = Join-Path $userData "services"
    $registryDir = Join-Path $servicesDir "registry"

    Write-Host "目标目录: $registryDir" -ForegroundColor Gray
    Write-Host "用户数据目录: $userData" -ForegroundColor Gray

    # 确保目录存在
    New-Item -ItemType Directory -Force -Path $registryDir | Out-Null
    Write-Host "✓ 目录已创建" -ForegroundColor Green

    # 替换路径占位符（Windows 路径使用反斜杠）
    $installedContent = $installedJson -replace '\{SERVICES_DIR\}', ($servicesDir -replace '\\', '/')
    $currentContent = $currentJson -replace '\{SERVICES_DIR\}', ($servicesDir -replace '\\', '/')

    # 备份现有文件（如果存在）
    $installedTarget = Join-Path $registryDir "installed.json"
    $currentTarget = Join-Path $registryDir "current.json"

    if (Test-Path $installedTarget) {
        $backupPath = "$installedTarget.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item $installedTarget $backupPath
        Write-Host "✓ 已备份现有 installed.json 到: $backupPath" -ForegroundColor Yellow
    }

    if (Test-Path $currentTarget) {
        $backupPath = "$currentTarget.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item $currentTarget $backupPath
        Write-Host "✓ 已备份现有 current.json 到: $backupPath" -ForegroundColor Yellow
    }

    # 写入文件
    $installedContent | Out-File -FilePath $installedTarget -Encoding UTF8 -NoNewline
    Write-Host "✓ installed.json 已部署" -ForegroundColor Green

    $currentContent | Out-File -FilePath $currentTarget -Encoding UTF8 -NoNewline
    Write-Host "✓ current.json 已部署" -ForegroundColor Green

    Write-Host "`n✅ 测试服务注册表部署成功！" -ForegroundColor Green
    Write-Host "`n包含的服务:" -ForegroundColor Cyan
    Write-Host "  - nmt-m2m100 (v1.0.0, windows-x64)" -ForegroundColor Gray
    Write-Host "  - node-inference (v1.0.0, windows-x64)" -ForegroundColor Gray
    Write-Host "  - piper-tts (v1.0.0, windows-x64)" -ForegroundColor Gray
    Write-Host "  - your-tts (v1.0.0, windows-x64)" -ForegroundColor Gray
    Write-Host "`n现在可以启动 Electron 应用测试服务管理功能。" -ForegroundColor Cyan

} catch {
    Write-Host "`n❌ 部署失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.Exception.StackTrace -ForegroundColor Red
    exit 1
}

