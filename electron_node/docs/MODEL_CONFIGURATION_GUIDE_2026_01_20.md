# 模型配置指南 - 2026-01-20

## 当前问题

服务启动失败：
```
RuntimeError: Unable to open file 'model.bin' in model 
'D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3'
```

## 快速解决方案

### 方案1: 下载模型到本地（推荐，用于生产环境）

```powershell
# 1. 进入服务目录
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad

# 2. 下载模型（GPU版本）
python download_model.py --device cuda --compute-type float16

# 3. 或下载CPU版本
python download_model.py --device cpu --compute-type float32
```

**下载后重启Electron即可！**

---

### 方案2: 使用HuggingFace自动下载（开发环境）

```powershell
# 1. 删除空的模型目录（让config.py自动切换到HuggingFace模式）
Remove-Item "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3" -Recurse -Force

# 2. 重启Electron
# 服务会自动从HuggingFace下载模型
```

**注意**: 首次启动会较慢（下载~3GB模型）

---

### 方案3: 复用现有模型

如果您已经在其他地方下载过模型，可以：

```powershell
# 1. 找到现有模型目录
# 常见位置：
# - ~/.cache/huggingface/hub/models--Systran--faster-whisper-large-v3/
# - D:\models\faster-whisper-large-v3\
# - 其他自定义路径

# 2. 复制或创建符号链接
# 方法A: 复制（推荐）
Copy-Item -Path "现有模型路径\*" -Destination "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3\" -Recurse

# 方法B: 符号链接（Windows需要管理员权限）
# New-Item -ItemType SymbolicLink -Path "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3" -Target "现有模型路径"

# 3. 验证
Test-Path "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3\model.bin"
# 应该返回 True
```

---

### 方案4: 使用环境变量（灵活配置）

```powershell
# 设置环境变量指向现有模型路径
$env:ASR_MODEL_PATH = "D:\models\faster-whisper-large-v3"

# 或使用HuggingFace标识符（自动下载）
$env:ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"

# 重启Electron
npm start
```

---

## 集成测试配置建议

如果您的集成测试已经通过，可能使用了以下配置之一：

### 配置1: 环境变量
```bash
# 集成测试脚本中设置
export ASR_MODEL_PATH="Systran/faster-whisper-large-v3"  # 自动下载
export WHISPER_CACHE_DIR="/tmp/whisper_models"  # 缓存到临时目录
```

### 配置2: CPU模式（自动下载）
```bash
# 集成测试可能禁用了GPU模式
export FORCE_CPU_MODE=true
```

### 配置3: Mock模式
```bash
# 集成测试可能mock了模型加载
export SKIP_MODEL_LOADING=true
```

---

## 验证步骤

### 1. 检查模型是否正确下载

```powershell
# 应该看到以下文件：
Get-ChildItem "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\models\asr\faster-whisper-large-v3"

# 期望输出：
# - model.bin           (~3GB)
# - config.json         (~1KB)
# - vocabulary.json     (~1MB)
# - (可能还有其他文件)
```

### 2. 测试服务启动

```powershell
# 方法A: 直接启动服务
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
python faster_whisper_vad_service.py

# 期望看到：
# ✅ Faster Whisper model loaded successfully on CUDA
# ✅ Silero VAD model loaded successfully

# 方法B: 通过Electron启动
npm start
# 在Electron UI中点击"启动服务"
```

---

## 配置文件说明

### config.py 的模型选择逻辑

```python
# 1. 首先检查本地路径是否存在
_local_model_path = "models/asr/faster-whisper-large-v3"
if os.path.exists(_local_model_path) and os.path.isdir(_local_model_path):
    # 如果目录存在，使用本地路径
    ASR_MODEL_PATH = _local_model_path
else:
    # 如果目录不存在，使用HuggingFace标识符（自动下载）
    ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"
```

**关键点**：
- ✅ 如果本地目录**存在且不为空**，使用本地模型
- ✅ 如果本地目录**不存在或为空**，从HuggingFace下载

**当前问题**：
- ❌ 本地目录**存在但为空**
- ❌ 导致尝试加载本地模型，但找不到 `model.bin`

**解决**：
- 方案1：填充本地目录（下载模型）
- 方案2：删除本地目录（切换到自动下载模式）

---

## 推荐方案

### 开发环境（您当前情况）

**推荐**: 方案1（下载到本地）

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
python download_model.py --device cuda --compute-type float16
```

**优点**:
- ✅ 一次下载，永久使用
- ✅ 启动速度快
- ✅ 不依赖网络

**缺点**:
- ⏳ 初次下载需要时间（~10分钟）
- 💾 占用磁盘空间（~3GB）

---

### 生产环境

**推荐**: 打包时包含模型文件

在 `electron-builder` 配置中：
```json
{
  "files": [
    "services/*/models/**",
    "..."
  ]
}
```

或使用环境变量指向共享模型目录：
```bash
export ASR_MODEL_PATH="/opt/models/faster-whisper-large-v3"
```

---

### CI/CD环境

**推荐**: 方案2（自动下载）

```yaml
# .github/workflows/test.yml
env:
  ASR_MODEL_PATH: "Systran/faster-whisper-large-v3"
  WHISPER_CACHE_DIR: "${{ runner.temp }}/whisper_models"
```

**优点**:
- ✅ 不需要提交大文件到Git
- ✅ 自动下载最新版本

---

## 常见问题

### Q1: 下载太慢怎么办？

A: 使用国内镜像或代理：
```bash
export HF_ENDPOINT=https://hf-mirror.com
python download_model.py
```

### Q2: 磁盘空间不够怎么办？

A: 使用符号链接指向其他磁盘：
```powershell
New-Item -ItemType SymbolicLink -Path "models\asr\faster-whisper-large-v3" -Target "E:\AI_Models\faster-whisper-large-v3"
```

### Q3: 如何使用CPU模式（不需要GPU）？

A: 修改 `config.py`：
```python
ASR_DEVICE = "cpu"  # 强制使用CPU
```

---

## 联系支持

如果以上方案都无法解决，请提供以下信息：

1. 集成测试的配置文件或脚本
2. 模型文件的实际存储位置
3. 集成测试的环境变量设置

我可以帮您精确配置！

---

**最快解决方案（推荐）**：

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
python download_model.py --device cuda --compute-type float16
```

然后重启Electron即可！ 🚀
