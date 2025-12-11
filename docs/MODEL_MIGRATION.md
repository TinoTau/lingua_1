# 模型迁移指南

本文档说明如何将原项目的模型文件复制到新项目中。

## 模型目录结构

### 原项目模型位置
```
D:\Programs\github\lingua\core\engine\models\
├── asr/
│   └── whisper-base/
├── nmt/
│   ├── m2m100-en-zh/
│   └── m2m100-zh-en/
├── tts/
│   ├── vits_en/
│   ├── vits-zh-aishell3/
│   └── your_tts/
├── vad/
│   └── silero/
├── emotion/
│   └── xlm-r/
├── persona/
│   └── embedding-default/
└── speaker_embedding/
    └── cache/
```

### 新项目模型位置

#### 1. 公司模型库 (model-hub/models)
用于模型库服务，提供模型下载和管理。

```
model-hub/models/
├── asr/
├── nmt/
├── tts/
├── vad/
├── emotion/
├── persona/
└── speaker_embedding/
```

#### 2. 节点本地模型库 (node-inference/models)
用于 Electron Node 客户端，本地存储已安装的模型。

```
node-inference/models/
├── asr/
├── nmt/
├── tts/
├── vad/
├── emotion/
├── persona/
└── speaker_embedding/
```

## 复制方法

### 方法一：使用 PowerShell 脚本（Windows）

```powershell
# 在项目根目录执行
.\scripts\copy_models.ps1
```

**注意**: 脚本中的源路径默认为 `D:\Programs\github\lingua\core\engine\models`，如果您的路径不同，请修改脚本。

### 方法二：使用 Bash 脚本（Linux/macOS）

```bash
# 在项目根目录执行
chmod +x scripts/copy_models.sh
./scripts/copy_models.sh
```

**注意**: 脚本中的源路径默认为 `../lingua/core/engine/models`，如果您的路径不同，请修改脚本。

### 方法三：手动复制

#### Windows (PowerShell)

```powershell
# 复制到公司模型库
Copy-Item -Path "D:\Programs\github\lingua\core\engine\models\*" -Destination "model-hub\models\" -Recurse -Force

# 复制到节点模型库
Copy-Item -Path "D:\Programs\github\lingua\core\engine\models\*" -Destination "node-inference\models\" -Recurse -Force
```

#### Linux/macOS (Bash)

```bash
# 复制到公司模型库
cp -r ../lingua/core/engine/models/* model-hub/models/

# 复制到节点模型库
cp -r ../lingua/core/engine/models/* node-inference/models/
```

## 模型文件说明

### ASR 模型 (asr/whisper-base)
- **用途**: 语音识别
- **格式**: ONNX, GGML
- **大小**: ~147 MB

### NMT 模型 (nmt/)
- **m2m100-en-zh**: 英文→中文翻译
- **m2m100-zh-en**: 中文→英文翻译
- **格式**: ONNX
- **大小**: 每个约 1-2 GB

### TTS 模型 (tts/)
- **vits_en**: 英文语音合成
- **vits-zh-aishell3**: 中文语音合成
- **your_tts**: 多语言语音合成
- **格式**: ONNX, PyTorch
- **大小**: 每个约 100-500 MB

### VAD 模型 (vad/silero)
- **用途**: 语音活动检测
- **格式**: ONNX
- **大小**: ~1 MB

### Emotion 模型 (emotion/xlm-r)
- **用途**: 情感分析
- **格式**: ONNX
- **大小**: ~500 MB

### Persona 模型 (persona/embedding-default)
- **用途**: 个性化适配
- **格式**: ONNX
- **大小**: ~100 MB

### Speaker Embedding 模型 (speaker_embedding/)
- **用途**: 音色识别和生成
- **格式**: PyTorch checkpoint
- **大小**: ~50 MB

## 验证复制结果

复制完成后，检查以下目录：

```powershell
# 检查公司模型库
Get-ChildItem -Path "model-hub\models" -Recurse -Directory | Select-Object FullName

# 检查节点模型库
Get-ChildItem -Path "node-inference\models" -Recurse -Directory | Select-Object FullName
```

## 注意事项

1. **文件大小**: 模型文件总大小可能达到 5-10 GB，复制需要一些时间
2. **Git 忽略**: 模型文件已在 `.gitignore` 中排除，不会被提交到 Git
3. **路径配置**: 确保各服务的配置文件指向正确的模型路径
4. **权限问题**: 如果遇到权限问题，请以管理员身份运行脚本

## 配置更新

复制完成后，需要更新相关配置：

### 1. 调度服务器配置 (scheduler/config.toml)

```toml
[model_hub]
storage_path = "./model-hub/models"  # 或绝对路径
```

### 2. 节点推理服务配置

在 `node-inference` 中，模型路径通过环境变量或配置文件设置：

```bash
export MODELS_DIR="./models"  # 相对于 node-inference 目录
```

### 3. Electron Node 客户端

模型路径在 `electron-node/main/src/model-manager/model-manager.ts` 中配置，默认使用用户数据目录。

## 后续步骤

1. ✅ 复制模型文件
2. ⏳ 创建模型元数据文件 (metadata.json)
3. ⏳ 更新模型库服务的元数据管理
4. ⏳ 测试模型加载和推理

## 故障排除

### 问题：源路径不存在

**解决方案**: 修改脚本中的 `$sourcePath` 变量为正确的路径。

### 问题：磁盘空间不足

**解决方案**: 检查可用磁盘空间，模型文件需要至少 10 GB 空间。

### 问题：复制速度慢

**解决方案**: 这是正常的，模型文件较大，请耐心等待。

