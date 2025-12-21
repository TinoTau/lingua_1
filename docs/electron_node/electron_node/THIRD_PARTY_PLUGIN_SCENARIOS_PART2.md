# 第三方插件接入场景与流程（第二部分：接入流程和示例）

> 本文档分为两部分，第一部分介绍概述和场景分类，第二部分介绍接入流程和示例

## 3. 插件接入流程

### 3.1 开发阶段（第三方）

#### 步骤 1：创建插件项目

**项目结构**：
```
my-plugin/
├── plugin.json          # 插件元数据
├── src/                 # 插件源代码
│   ├── main.py         # 主程序
│   └── model.py        # 模型加载和推理
├── models/              # 模型文件
│   └── my-model.onnx
├── requirements.txt     # Python 依赖
└── README.md            # 插件说明
```

**plugin.json 示例**：
```json
{
  "plugin_id": "my-asr-plugin",
  "name": "My ASR Plugin",
  "version": "1.0.0",
  "type": "service",
  "deployment": "local",
  "service_type": "asr",
  "requires_gpu": true,
  "requires_network": false,
  "port": 5011,
  "dependencies": [],
  "config_schema": {
    "model_path": {
      "type": "string",
      "required": true,
      "label": "模型路径"
    },
    "gpu_enabled": {
      "type": "boolean",
      "default": true,
      "label": "启用 GPU"
    }
  }
}
```

#### 步骤 2：实现插件接口

**必须实现的接口**：
- `POST /inference` - 推理接口
- `GET /health` - 健康检查
- `GET /metrics` - 资源监控（可选）

**示例实现**：
```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class InferenceRequest(BaseModel):
    audio_data: str  # base64 编码的音频
    language: str

class InferenceResponse(BaseModel):
    text: str
    confidence: float

@app.post("/inference")
async def inference(request: InferenceRequest):
    # 加载模型（本地 GPU）
    # 处理音频
    # 返回结果
    return InferenceResponse(text="...", confidence=0.95)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

#### 步骤 3：打包插件

**打包格式**：
- ZIP 压缩包
- 包含所有必需文件
- 包含签名文件（可选）

**打包命令**：
```bash
zip -r my-plugin.zip plugin.json src/ models/ requirements.txt
```

### 3.2 发布阶段（第三方）

#### 步骤 4：发布到插件市场

**选项 A：官方插件市场**
```bash
# 上传到官方市场
lingua-plugin publish --marketplace official

# 需要审核流程
```

**选项 B：自托管**
```bash
# 上传到自己的服务器
lingua-plugin publish --url https://my-plugin-server.com
```

### 3.3 安装阶段（用户端）

#### 步骤 5：用户发现插件

**方式 A：通过 Electron UI**
1. 打开 Electron 客户端
2. 进入"插件市场"页面
3. 浏览可用插件
4. 查看插件详情、评分、评论

**方式 B：通过命令行**
```bash
# 搜索插件
lingua-plugin search "ASR"

# 查看插件详情
lingua-plugin info my-asr-plugin

# 安装插件
lingua-plugin install my-asr-plugin
```

#### 步骤 6：安装和配置

**自动安装流程**：
1. 用户点击"安装"按钮
2. 系统下载插件包
3. 验证插件签名
4. 解压到 `plugins/` 目录
5. 加载插件元数据
6. 检查依赖关系
7. 提示用户配置（如果需要）

**配置界面**：
```typescript
// Electron 自动生成配置界面
{
  "model_path": {
    "label": "模型路径",
    "type": "file",
    "required": true
  },
  "gpu_enabled": {
    "label": "启用 GPU",
    "type": "checkbox",
    "default": true
  }
}
```

#### 步骤 7：启用插件

**方式 A：自动启用**
- 如果插件是服务插件，系统会自动启动服务
- 如果插件是功能插件，用户需要在 UI 中启用

**方式 B：手动启用**
1. 进入"服务管理"页面
2. 找到新安装的插件
3. 点击"启用"按钮
4. 系统启动插件服务

### 3.4 运行阶段

#### 步骤 8：插件运行

**本地服务插件**：
- 插件作为独立进程在本地运行
- 通过 `localhost` HTTP 接口提供服务
- 使用本地 GPU/CPU 资源
- 系统自动监控健康状态
- 自动重启（如果崩溃）

**远程服务插件**：
- 插件作为独立进程在本地运行（包装器）
- 通过 `localhost` HTTP 接口提供服务
- 插件内部调用远程 API
- 处理 API 密钥、错误重试、限流等
- 系统监控插件进程健康状态

**纯远程服务插件**：
- 不启动本地进程
- 直接通过 HTTP/HTTPS 调用远程服务
- 系统监控网络连接状态
- 处理认证和错误重试

#### 步骤 9：监控和管理

**监控**：
- 资源使用情况（CPU、GPU、内存）
- 请求处理统计
- 错误日志
- 性能指标

**管理**：
- 启用/禁用插件
- 更新插件
- 卸载插件
- 查看日志

---

## 4. 第三方插件示例

### 4.1 示例 1：自定义 ASR 模型插件（本地服务插件）✅

**场景**：使用更先进的本地 ASR 模型替代 Whisper

**插件类型**：服务插件（Service Plugin）  
**部署模式**：本地服务插件（完全本地运行）

**架构**：
```
节点推理服务 → localhost:5011 → 自定义 ASR 插件进程（本地 GPU 推理）
```

**实现要点**：
- 插件作为本地进程运行
- 加载本地模型文件（如 ONNX、TensorRT 格式）
- 使用本地 GPU 进行推理
- 通过 HTTP 接口提供服务
- 数据完全本地处理（隐私保护）
- **充分利用本地算力**

**配置**：
```json
{
  "plugin_id": "custom-asr-plugin",
  "deployment": "local",
  "port": 5011,
  "requires_gpu": true,
  "requires_network": false,
  "config": {
    "model_path": "models/asr/custom-model.onnx",
    "gpu_enabled": true,
    "batch_size": 1,
    "language": "zh-CN"
  }
}
```

**为什么符合设计理念？**
- ✅ 使用本地 GPU 资源
- ✅ 数据不离开节点
- ✅ 低延迟（本地处理）
- ✅ 充分利用闲置算力

### 4.2 示例 2：本地情感分析插件（本地服务插件）✅

**场景**：使用本地情感分析模型进行情感分析

**插件类型**：功能插件（Feature Plugin）  
**部署模式**：本地服务插件（完全本地运行）

**架构**：
```
节点推理服务 → localhost:5013 → 情感分析插件进程（本地 GPU 推理）
```

**实现要点**：
- 插件作为本地进程运行
- 依赖 ASR 模块（需要文本输入）
- 加载本地情感分析模型（如 BERT-based 模型）
- 使用本地 GPU 进行推理
- 返回情感分析结果
- **充分利用本地算力**

**配置**：
```json
{
  "plugin_id": "local-emotion-plugin",
  "deployment": "local",
  "port": 5013,
  "dependencies": ["asr"],
  "requires_gpu": true,
  "requires_network": false,
  "config": {
    "model_path": "models/emotion/bert-emotion.onnx",
    "gpu_enabled": true,
    "emotions": ["joy", "sadness", "anger", "fear"],
    "confidence_threshold": 0.7
  }
}
```

**为什么符合设计理念？**
- ✅ 使用本地 GPU 资源
- ✅ 数据不离开节点
- ✅ 低延迟（本地处理）
- ✅ 充分利用闲置算力

### 4.3 示例 3：本地语音增强插件（本地服务插件）✅

**场景**：使用本地模型进行音频降噪和增强

**插件类型**：功能插件（Feature Plugin）  
**部署模式**：本地服务插件（完全本地运行）

**架构**：
```
节点推理服务 → localhost:5014 → 语音增强插件进程（本地 GPU 推理）
```

**实现要点**：
- 插件作为本地进程运行
- 在 ASR 之前处理音频
- 加载本地降噪模型
- 使用本地 GPU 进行推理
- 返回增强后的音频
- **充分利用本地算力**

**配置**：
```json
{
  "plugin_id": "local-audio-enhancement-plugin",
  "deployment": "local",
  "port": 5014,
  "dependencies": [],
  "requires_gpu": true,
  "requires_network": false,
  "config": {
    "model_path": "models/enhancement/denoise.onnx",
    "gpu_enabled": true,
    "noise_reduction": 0.8
  }
}
```

---

## 5. 不符合设计理念的示例 ❌

### 5.1 示例：Google Cloud ASR 插件（转接服务）❌

**场景**：使用 Google Cloud Speech-to-Text API 替代 Whisper

**为什么不符合设计理念？**
- ❌ 数据离开本地节点（隐私风险）
- ❌ 依赖外部服务（网络延迟、可用性）
- ❌ 不利用本地 GPU 资源
- ❌ 需要 API 密钥和费用
- ❌ 违反"本地算力优先"原则

**结论**：此类插件不应被允许。

---

## 6. 插件市场和管理

### 6.1 插件市场

**官方市场**：
- 由 Lingua 团队维护
- 所有插件需要审核
- 确保符合设计理念
- 提供评分和评论

**自托管市场**：
- 第三方可以托管自己的插件市场
- 需要遵循相同的审核标准
- 用户可以选择使用

### 6.2 插件管理

**安装管理**：
- 自动依赖检查
- 版本管理
- 更新通知
- 卸载清理

**运行管理**：
- 自动启动/停止
- 健康监控
- 自动重启
- 资源限制

---

## 相关文档

- [第三方插件接入场景（第一部分）](./THIRD_PARTY_PLUGIN_SCENARIOS_PART1.md) - 概述和场景分类
- [插件架构评估](./PLUGIN_ARCHITECTURE_NECESSITY_ASSESSMENT.md) - 插件架构必要性评估
- [模块化功能文档](../modular/README.md) - 当前模块化热插拔体系

