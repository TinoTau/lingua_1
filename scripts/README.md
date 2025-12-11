# 脚本工具说明

本目录包含项目相关的脚本工具和临时说明文档。

## 脚本文件

### PowerShell 脚本（Windows）

- `copy_models.ps1` - 复制原项目的模型文件到新项目
- `start_scheduler.ps1` - 启动调度服务器
- `start_model_hub.ps1` - 启动模型库服务
- `start_api_gateway.ps1` - 启动 API Gateway 服务
- `start_all.ps1` - 一键启动所有服务

### Bash 脚本（Linux/macOS）

- `copy_models.sh` - 复制原项目的模型文件到新项目

## 使用说明

### 复制模型文件

#### 快速使用

在项目根目录运行：

```powershell
.\scripts\copy_models.ps1
```

#### 模型目录结构

**原项目模型位置**:
```
D:\Programs\github\lingua\core\engine\models\
├── asr/whisper-base/
├── nmt/m2m100-en-zh/, m2m100-zh-en/
├── tts/vits_en/, vits-zh-aishell3/, your_tts/
├── vad/silero/
├── emotion/xlm-r/
├── persona/embedding-default/
└── speaker_embedding/
```

**新项目模型位置**:
- `model-hub/models/` - 公司模型库（用于模型库服务）
- `node-inference/models/` - 节点本地模型库（用于 Electron Node 客户端）

#### 注意事项

- 脚本默认从 `D:\Programs\github\lingua\core\engine\models` 复制模型
- 如果源路径不同，请编辑脚本第 10 行修改 `$sourcePath` 变量
- 模型文件较大（约 5-10 GB），复制需要一些时间
- 模型文件已在 `.gitignore` 中排除，不会被提交到 Git

#### 故障排除

**问题：源路径不存在**
- 解决方案：编辑脚本中的 `$sourcePath` 变量为正确的路径

**问题：执行策略限制**
- 解决方案：以管理员身份运行 PowerShell，执行 `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### 启动服务

```powershell
# 启动所有服务
.\scripts\start_all.ps1

# 单独启动服务
.\scripts\start_scheduler.ps1
.\scripts\start_model_hub.ps1
.\scripts\start_api_gateway.ps1
```

## 注意事项

- 脚本中的路径可能需要根据实际情况修改
- 某些脚本需要管理员权限
- 详细使用说明请参考各脚本的注释或相关文档

