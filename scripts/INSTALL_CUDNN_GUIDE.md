# cuDNN 安装指南

## 快速安装步骤

### 1. 下载 cuDNN

访问 NVIDIA 开发者网站：
- **URL**: https://developer.nvidia.com/cudnn
- **需要**: 免费注册 NVIDIA 开发者账号

### 2. 选择正确的版本

对于 CUDA 12.4，下载：
- **cuDNN 8.9.x for CUDA 12.x**
- 推荐：cuDNN 8.9.7 或更新版本

### 3. 安装方式（二选一）

#### 方式 A：集成到 CUDA 目录（推荐）

下载并解压 cuDNN 后，运行以下 PowerShell 命令：

```powershell
# 设置路径（根据实际解压位置修改）
$cudnnExtractedPath = "C:\Users\YOUR_USERNAME\Downloads\cudnn-windows-x86_64-8.9.x.x_cuda12.x"
$cudaPath = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4"

# 复制文件（需要管理员权限）
Copy-Item -Path "$cudnnExtractedPath\bin\*.dll" -Destination "$cudaPath\bin" -Force
Copy-Item -Path "$cudnnExtractedPath\lib\x64\*.lib" -Destination "$cudaPath\lib\x64" -Force
Copy-Item -Path "$cudnnExtractedPath\include\*.h" -Destination "$cudaPath\include" -Force

Write-Host "cuDNN files copied successfully!" -ForegroundColor Green
```

#### 方式 B：独立目录

```powershell
# 解压到独立目录
$cudnnZipPath = "C:\Users\YOUR_USERNAME\Downloads\cudnn-windows-x86_64-8.9.x.x_cuda12.x.zip"
$cudnnExtractPath = "C:\cudnn"

# 解压（如果还没解压）
Expand-Archive -Path $cudnnZipPath -DestinationPath $cudnnExtractPath -Force

Write-Host "cuDNN extracted to: $cudnnExtractPath" -ForegroundColor Green
Write-Host "The start_node_inference.ps1 script will automatically detect it." -ForegroundColor Cyan
```

### 4. 验证安装

运行验证脚本：

```powershell
.\scripts\install_cudnn.ps1
```

## 完整安装命令（一键执行）

如果你已经下载并解压了 cuDNN，可以使用以下命令：

```powershell
# ============================================
# cuDNN 一键安装脚本
# ============================================

# 1. 设置路径（请根据实际情况修改）
$cudnnExtractedPath = Read-Host "Enter the path to extracted cuDNN folder (e.g., C:\Users\YourName\Downloads\cudnn-windows-x86_64-8.9.7.29_cuda12.4)"
$cudaPath = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4"

# 2. 检查路径
if (-not (Test-Path $cudnnExtractedPath)) {
    Write-Host "Error: cuDNN folder not found: $cudnnExtractedPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $cudaPath)) {
    Write-Host "Error: CUDA path not found: $cudaPath" -ForegroundColor Red
    Write-Host "Please check your CUDA installation path." -ForegroundColor Yellow
    exit 1
}

# 3. 检查管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Warning: Administrator privileges may be required to copy files to CUDA directory." -ForegroundColor Yellow
    Write-Host "If copy fails, please run PowerShell as Administrator." -ForegroundColor Yellow
}

# 4. 复制文件
Write-Host "Copying cuDNN files..." -ForegroundColor Cyan

# 复制 DLL 文件
$binSource = Join-Path $cudnnExtractedPath "bin"
$binDest = Join-Path $cudaPath "bin"
if (Test-Path $binSource) {
    Copy-Item -Path "$binSource\*.dll" -Destination $binDest -Force -ErrorAction Stop
    Write-Host "  ✓ Copied DLL files to: $binDest" -ForegroundColor Green
} else {
    Write-Host "  ✗ bin folder not found in: $cudnnExtractedPath" -ForegroundColor Red
    exit 1
}

# 复制 LIB 文件
$libSource = Join-Path $cudnnExtractedPath "lib\x64"
$libDest = Join-Path $cudaPath "lib\x64"
if (Test-Path $libSource) {
    Copy-Item -Path "$libSource\*.lib" -Destination $libDest -Force -ErrorAction Stop
    Write-Host "  ✓ Copied LIB files to: $libDest" -ForegroundColor Green
} else {
    Write-Host "  ✗ lib\x64 folder not found in: $cudnnExtractedPath" -ForegroundColor Red
    exit 1
}

# 复制头文件
$includeSource = Join-Path $cudnnExtractedPath "include"
$includeDest = Join-Path $cudaPath "include"
if (Test-Path $includeSource) {
    Copy-Item -Path "$includeSource\*.h" -Destination $includeDest -Force -ErrorAction Stop
    Write-Host "  ✓ Copied header files to: $includeDest" -ForegroundColor Green
} else {
    Write-Host "  ✗ include folder not found in: $cudnnExtractedPath" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✓ cuDNN installation completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Cyan
& "$PSScriptRoot\install_cudnn.ps1"
```

## 使用说明

1. **下载 cuDNN**：
   - 访问 https://developer.nvidia.com/cudnn
   - 登录（或注册）NVIDIA 开发者账号
   - 下载 cuDNN 8.9.x for CUDA 12.x

2. **解压下载的 ZIP 文件**

3. **运行安装命令**：
   ```powershell
   # 方式 1：使用上面的完整脚本（需要手动修改路径）
   # 方式 2：手动复制文件后运行验证
   .\scripts\install_cudnn.ps1
   ```

4. **重启 Node Inference 服务**：
   ```powershell
   .\scripts\start_node_inference.ps1
   ```

## 验证 GPU 加速

安装完成后，启动 Node Inference 服务，查看日志：
- ✅ 成功：`"Silero VAD: Using CUDA GPU acceleration"`
- ❌ 失败：`"No execution providers registered successfully. Falling back to CPU."`
