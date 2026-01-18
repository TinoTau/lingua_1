# 模型安装指南

**服务**: semantic-repair-en-zh  
**更新日期**: 2026-01-19

---

## 📋 概述

统一语义修复服务需要在**本服务目录**下准备模型文件，不再使用旧服务目录中的模型。

---

## 📁 目录结构

模型应放置在以下位置：

```
semantic_repair_en_zh/
├── service.py
├── config.py
└── models/                                    # 模型根目录
    ├── qwen2.5-3b-instruct-zh-gguf/          # 中文模型目录
    │   └── qwen2.5-3b-instruct-zh-q4_0.gguf  # 中文模型文件
    └── qwen2.5-3b-instruct-en-gguf/          # 英文模型目录
        └── qwen2.5-3b-instruct-en-q4_0.gguf  # 英文模型文件
```

---

## 🚀 快速安装

### 方式 1: 从旧服务复制（推荐）

如果已有旧服务的模型，可以直接复制：

```powershell
# 创建 models 目录
New-Item -Path "semantic_repair_en_zh\models" -ItemType Directory -Force

# 复制中文模型
Copy-Item -Path "semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf" `
          -Destination "semantic_repair_en_zh\models\" -Recurse

# 复制英文模型
Copy-Item -Path "semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf" `
          -Destination "semantic_repair_en_zh\models\" -Recurse
```

### 方式 2: 创建符号链接（节省空间）

如果希望节省磁盘空间，可以创建符号链接：

```powershell
# 创建 models 目录
New-Item -Path "semantic_repair_en_zh\models" -ItemType Directory -Force

# 创建中文模型符号链接
New-Item -ItemType SymbolicLink `
         -Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf" `
         -Target "..\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf"

# 创建英文模型符号链接
New-Item -ItemType SymbolicLink `
         -Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-en-gguf" `
         -Target "..\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf"
```

**注意**: 创建符号链接需要管理员权限。

### 方式 3: 硬链接（Windows）

```powershell
# 创建目录
New-Item -Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf" -ItemType Directory -Force
New-Item -Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-en-gguf" -ItemType Directory -Force

# 创建硬链接（不需要管理员权限）
New-Item -ItemType HardLink `
         -Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf\qwen2.5-3b-instruct-zh-q4_0.gguf" `
         -Target "..\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf\qwen2.5-3b-instruct-zh-q4_0.gguf"

New-Item -ItemType HardLink `
         -Path "semantic_repair_en_zh\models\qwen2.5-3b-instruct-en-gguf\qwen2.5-3b-instruct-en-q4_0.gguf" `
         -Target "..\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf\qwen2.5-3b-instruct-en-q4_0.gguf"
```

---

## 🔍 验证安装

### 检查目录结构

```bash
# Windows
dir semantic_repair_en_zh\models
dir semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf
dir semantic_repair_en_zh\models\qwen2.5-3b-instruct-en-gguf

# 应该看到 .gguf 文件
```

### 检查模型文件

```bash
# 检查中文模型
ls semantic_repair_en_zh/models/qwen2.5-3b-instruct-zh-gguf/*.gguf

# 检查英文模型
ls semantic_repair_en_zh/models/qwen2.5-3b-instruct-en-gguf/*.gguf
```

### 启动服务验证

```bash
cd semantic_repair_en_zh
python service.py
```

**预期输出**:
```
[Config] Found zh model: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf\qwen2.5-3b-instruct-zh-q4_0.gguf
[Config] Found en model: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-en-gguf\qwen2.5-3b-instruct-en-q4_0.gguf
[Unified SR] Configuration loaded:
[Unified SR]   Host: 127.0.0.1
[Unified SR]   Port: 5015
[Unified SR]   Timeout: 30s
[Unified SR]   Enabled processors:
[Unified SR]     - zh_repair (Chinese Semantic Repair)
[Unified SR]     - en_repair (English Semantic Repair)
[Unified SR]     - en_normalize (English Normalize)
```

---

## ❗ 常见问题

### Q1: 模型未找到错误

**错误信息**:
```
[Config] WARNING: zh model not found at: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf
[Config] Please copy model to: D:\...\semantic_repair_en_zh\models\qwen2.5-3b-instruct-zh-gguf
```

**解决方案**:
1. 检查目录是否存在
2. 检查 `.gguf` 文件是否在正确位置
3. 按照上述方式复制或链接模型

### Q2: 为什么不使用旧服务的模型？

**原因**:
- **独立部署**: 新服务可以独立部署，不依赖旧服务
- **版本隔离**: 避免旧服务更新影响新服务
- **清晰管理**: 每个服务管理自己的资源
- **便于迁移**: 可以整体迁移服务目录

### Q3: 符号链接 vs 硬链接 vs 复制？

| 方式 | 磁盘占用 | 管理员权限 | 说明 |
|------|---------|-----------|------|
| **复制** | 2倍空间 | ❌ 不需要 | 最安全，但占用空间大 |
| **符号链接** | 几乎不占用 | ✅ 需要 | 节省空间，但需要管理员权限 |
| **硬链接** | 几乎不占用 | ❌ 不需要 | 推荐：节省空间且不需要管理员权限 |

**推荐**: 使用**硬链接**，既节省空间又不需要管理员权限。

### Q4: 模型文件有多大？

- 中文模型 (qwen2.5-3b-instruct-zh-q4_0.gguf): ~2GB
- 英文模型 (qwen2.5-3b-instruct-en-q4_0.gguf): ~2GB
- 总计: ~4GB

如果使用符号链接或硬链接，实际只占用 ~4GB 空间。

### Q5: 可以使用不同的模型吗？

可以！只要满足以下条件：
1. 模型文件是 `.gguf` 格式
2. 模型支持 llama.cpp
3. 模型文件放在正确的目录下

修改 `config.py` 中的模型目录名称：
```python
model_dir_name = {
    'zh': '你的中文模型目录名',
    'en': '你的英文模型目录名'
}.get(lang)
```

---

## 📊 磁盘空间规划

### 完整复制（独立部署）

```
semantic_repair_en_zh/
├── models/ (~4GB)
│   ├── qwen2.5-3b-instruct-zh-gguf/ (~2GB)
│   └── qwen2.5-3b-instruct-en-gguf/ (~2GB)
└── 其他文件 (~10MB)

总计: ~4.01GB
```

### 使用链接（共享模型）

```
semantic_repair_en_zh/
├── models/ (~1MB - 仅链接文件)
│   ├── qwen2.5-3b-instruct-zh-gguf/ (链接)
│   └── qwen2.5-3b-instruct-en-gguf/ (链接)
└── 其他文件 (~10MB)

总计: ~11MB（实际模型在旧服务目录）
```

---

## 🛠️ 自动安装脚本

### PowerShell 脚本（推荐硬链接）

```powershell
# setup_models.ps1
$servicePath = "D:\Programs\github\lingua_1\electron_node\services"
$targetService = "$servicePath\semantic_repair_en_zh"

Write-Host "Setting up models for unified semantic repair service..." -ForegroundColor Green

# 创建 models 目录
New-Item -Path "$targetService\models" -ItemType Directory -Force

# 中文模型
$zhModelDir = "$targetService\models\qwen2.5-3b-instruct-zh-gguf"
New-Item -Path $zhModelDir -ItemType Directory -Force

$zhSource = Get-ChildItem -Path "$servicePath\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf\*.gguf" -File | Select-Object -First 1
if ($zhSource) {
    Write-Host "Creating hard link for Chinese model..." -ForegroundColor Yellow
    New-Item -ItemType HardLink `
             -Path "$zhModelDir\$($zhSource.Name)" `
             -Target $zhSource.FullName -Force
    Write-Host "✓ Chinese model linked" -ForegroundColor Green
} else {
    Write-Host "✗ Chinese model not found in old service" -ForegroundColor Red
}

# 英文模型
$enModelDir = "$targetService\models\qwen2.5-3b-instruct-en-gguf"
New-Item -Path $enModelDir -ItemType Directory -Force

$enSource = Get-ChildItem -Path "$servicePath\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf\*.gguf" -File | Select-Object -First 1
if ($enSource) {
    Write-Host "Creating hard link for English model..." -ForegroundColor Yellow
    New-Item -ItemType HardLink `
             -Path "$enModelDir\$($enSource.Name)" `
             -Target $enSource.FullName -Force
    Write-Host "✓ English model linked" -ForegroundColor Green
} else {
    Write-Host "✗ English model not found in old service" -ForegroundColor Red
}

Write-Host "`nSetup complete! Run 'python service.py' to test." -ForegroundColor Green
```

**使用方法**:
```powershell
# 保存为 setup_models.ps1，然后运行
cd semantic_repair_en_zh
.\setup_models.ps1
```

---

## ✅ 安装检查清单

- [ ] 创建 `models` 目录
- [ ] 放置中文模型文件（复制/链接）
- [ ] 放置英文模型文件（复制/链接）
- [ ] 验证目录结构正确
- [ ] 验证 `.gguf` 文件存在
- [ ] 启动服务测试
- [ ] 检查日志确认模型加载成功

---

## 📚 相关文档

- [服务 README](./README.md) - 完整使用指南
- [配置说明](./config.py) - 配置文件详解
- [部署检查清单](./DEPLOYMENT_CHECKLIST.md) - 部署验证步骤

---

**更新**: 2026-01-19 - 新服务现在只使用本地模型  
**状态**: ✅ 配置已更新，需要手动安装模型
