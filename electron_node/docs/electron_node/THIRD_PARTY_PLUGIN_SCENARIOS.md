# 第三方插件接入场景与流程

## 概述

本文档说明在插件化架构下，第三方插件可能的接入场景、类型和流程。**注意**：当前系统使用模块化热插拔体系，插件化架构是未来扩展方案。

## ⚠️ 核心设计理念

**本项目核心目标**：利用个人PC的闲置算力（GPU/CPU）提供翻译服务，而不是作为转接服务调用外部云API。

**设计原则**：
- ✅ **本地算力优先**：所有核心推理工作应在节点本地完成
- ✅ **GPU资源利用**：充分利用节点本地GPU资源
- ✅ **数据隐私保护**：用户数据不离开本地节点
- ❌ **禁止转接服务**：不应将节点变成调用外部云API的转接服务
- ❌ **禁止远程推理**：核心推理工作不应依赖远程服务

**第三方插件必须遵循此设计理念**。

---

## 1. 第三方插件场景

### 1.1 场景分类

#### 场景 A：替代现有服务（本地模型）

**场景描述**：第三方提供更好的本地 ASR/NMT/TTS 模型，希望替换或补充现有服务。

**示例**：
- **ASR 替代**：使用更先进的本地 Whisper 变体或自定义 ASR 模型
- **NMT 替代**：使用更先进的本地翻译模型（如更大的 M2M100 模型、本地部署的 LLM）
- **TTS 替代**：使用更先进的本地 TTS 模型（如更高质量的 VITS 模型）

**适用场景**：
- 第三方有更先进的本地模型文件
- 需要特定语言/方言支持
- 需要更高的准确率
- 模型可以在本地 GPU 上运行

**❌ 不符合设计理念的场景**：
- ~~使用 Google Cloud Speech-to-Text API 替代 Whisper~~（转接服务）
- ~~使用 OpenAI GPT-4 翻译 API 替代 M2M100~~（转接服务）
- ~~使用 Azure Neural TTS 替代 Piper TTS~~（转接服务）

#### 场景 B：扩展新功能（本地处理）

**场景描述**：第三方提供系统当前不支持的新功能模块，使用本地算力处理。

**示例**：
- **情感分析**：使用本地情感分析模型（如 BERT-based 模型）
- **语言检测增强**：使用本地语言检测模型
- **语音增强**：降噪、回声消除、音质提升（本地 DSP 处理）
- **内容审核**：敏感词过滤、内容安全检查（本地规则引擎或模型）
- **多模态处理**：图像识别、视频分析（本地模型处理）

**适用场景**：
- 系统当前不支持的功能
- 功能可以在本地 GPU/CPU 上运行
- 使用本地模型或算法处理

**❌ 不符合设计理念的场景**：
- ~~使用 IBM Watson Tone Analyzer API 进行情感分析~~（转接服务）
- ~~使用 Google Language Detection API~~（转接服务）
- ~~调用远程内容审核服务~~（转接服务）

#### 场景 C：集成外部服务（非核心推理）

**场景描述**：第三方提供外部服务集成，用于数据持久化、通知等辅助功能，**不参与核心推理流程**。

**示例**：
- **云存储**：将翻译结果自动保存到 AWS S3、Azure Blob（可选，用户选择）
- **数据库**：将历史记录保存到本地数据库或远程数据库（可选）
- **通知服务**：翻译完成后发送邮件、短信、推送通知（可选）
- **分析服务**：集成使用分析（可选，不影响核心功能）

**适用场景**：
- 辅助功能，不参与核心推理
- 用户可选择启用/禁用
- 不影响本地算力利用的核心目标

**⚠️ 注意事项**：
- 这些集成服务是**可选的辅助功能**，不应成为必需
- 核心推理工作仍应在本地完成
- 用户可以选择不启用这些功能，系统仍能正常工作

#### 场景 D：自定义后处理

**场景描述**：第三方提供自定义的后处理逻辑，对翻译结果进行二次处理。

**示例**：
- **术语替换**：根据行业术语库替换翻译结果
- **格式转换**：将文本转换为特定格式（Markdown、HTML、XML）
- **摘要生成**：对长文本进行摘要
- **关键词提取**：提取关键信息

**适用场景**：
- 需要行业特定处理
- 需要自定义输出格式
- 需要文本后处理

---

## 2. 第三方插件类型

### 2.1 服务插件（Service Plugin）

**定义**：提供核心服务能力（ASR、NMT、TTS）的插件。

**特点**：
- 实现标准的服务接口
- 可以替代或补充现有服务
- 必须实现健康检查、资源管理

**示例**：
```json
{
  "plugin_id": "google-asr-plugin",
  "name": "Google Cloud Speech-to-Text",
  "type": "service",
  "service_type": "asr",
  "version": "1.0.0",
  "executable": "google-asr-service.exe",
  "port": 5011,
  "capabilities": {
    "languages": ["zh", "en", "ja", "ko"],
    "features": ["streaming", "punctuation"]
  }
}
```

**实现要求**：
- 必须实现 HTTP 健康检查接口：`GET /health`
- 必须实现推理接口：`POST /inference`
- 必须支持标准输入/输出格式
- 必须报告资源使用情况

### 2.2 功能插件（Feature Plugin）

**定义**：提供可选功能模块的插件。

**特点**：
- 实现功能模块接口
- 可以动态启用/禁用
- 可以依赖其他模块

**示例**：
```json
{
  "plugin_id": "ibm-emotion-plugin",
  "name": "IBM Watson Emotion Analysis",
  "type": "feature",
  "feature_type": "emotion_detection",
  "version": "1.0.0",
  "executable": "ibm-emotion-service.exe",
  "dependencies": ["asr"],
  "capabilities": {
    "emotions": ["joy", "sadness", "anger", "fear"],
    "confidence_threshold": 0.7
  }
}
```

**实现要求**：
- 必须实现模块接口
- 必须支持动态加载/卸载
- 必须声明依赖关系
- 必须处理依赖缺失的情况

### 2.3 集成插件（Integration Plugin）

**定义**：提供外部服务集成的插件。

**特点**：
- 不直接参与推理流程
- 提供数据持久化、通知、分析等功能
- 可以订阅系统事件

**示例**：
```json
{
  "plugin_id": "aws-s3-storage-plugin",
  "name": "AWS S3 Storage Integration",
  "type": "integration",
  "integration_type": "storage",
  "version": "1.0.0",
  "executable": "aws-s3-service.exe",
  "events": ["translation_complete", "session_end"],
  "config": {
    "bucket": "lingua-translations",
    "region": "us-east-1"
  }
}
```

**实现要求**：
- 必须实现事件订阅接口
- 必须支持配置管理
- 必须处理网络错误
- 必须支持异步处理

### 2.4 UI 插件（UI Plugin）

**定义**：提供 UI 扩展的插件。

**特点**：
- 扩展 Electron 界面
- 可以添加新的设置页面、监控面板
- 可以自定义服务管理界面

**示例**：
```json
{
  "plugin_id": "advanced-monitoring-plugin",
  "name": "Advanced Monitoring Dashboard",
  "type": "ui",
  "version": "1.0.0",
  "ui_components": [
    "monitoring-dashboard",
    "performance-charts"
  ],
  "routes": ["/monitoring", "/performance"]
}
```

**实现要求**：
- 必须实现 React 组件
- 必须遵循 UI 设计规范
- 必须支持主题切换
- 必须支持国际化

---

## 3. 第三方插件接入流程

### 3.1 开发阶段

#### 步骤 1：创建插件项目

```bash
# 使用插件模板创建项目
lingua-plugin create --type service --name my-asr-plugin

# 生成的项目结构
my-asr-plugin/
├── plugin.json          # 插件元数据
├── src/
│   ├── main.rs         # 主程序（Rust）
│   └── service.rs      # 服务实现
├── config/
│   └── default.toml    # 默认配置
└── README.md
```

#### 步骤 2：实现插件接口

**服务插件示例（Rust）**：
```rust
use lingua_plugin_sdk::{ServicePlugin, InferenceRequest, InferenceResponse};

pub struct MyASRPlugin {
    // 插件状态
}

impl ServicePlugin for MyASRPlugin {
    fn name(&self) -> &str {
        "my-asr-plugin"
    }
    
    fn service_type(&self) -> ServiceType {
        ServiceType::ASR
    }
    
    async fn inference(&self, request: InferenceRequest) -> Result<InferenceResponse> {
        // 实现推理逻辑
        Ok(InferenceResponse {
            text: "识别结果",
            confidence: 0.95,
            // ...
        })
    }
    
    async fn health_check(&self) -> Result<HealthStatus> {
        // 实现健康检查
        Ok(HealthStatus::Healthy)
    }
}
```

**功能插件示例（Python）**：
```python
from lingua_plugin_sdk import FeaturePlugin, FeatureRequest, FeatureResponse

class MyEmotionPlugin(FeaturePlugin):
    def __init__(self, config):
        self.config = config
    
    def name(self) -> str:
        return "my-emotion-plugin"
    
    def feature_type(self) -> str:
        return "emotion_detection"
    
    async def process(self, request: FeatureRequest) -> FeatureResponse:
        # 实现功能逻辑
        return FeatureResponse(
            emotions={"joy": 0.8, "sadness": 0.2},
            confidence=0.9
        )
```

#### 步骤 3：编写插件元数据

**`plugin.json`**：
```json
{
  "plugin_id": "my-asr-plugin",
  "name": "My Custom ASR Plugin",
  "version": "1.0.0",
  "type": "service",
  "service_type": "asr",
  "author": "Third Party Developer",
  "description": "Custom ASR service using proprietary model",
  "executable": {
    "windows": "my-asr-service.exe",
    "linux": "my-asr-service",
    "macos": "my-asr-service"
  },
  "port": 5011,
  "capabilities": {
    "languages": ["zh", "en"],
    "features": ["streaming", "punctuation"],
    "max_audio_length": 60
  },
  "dependencies": [],
  "config_schema": {
    "model_path": {
      "type": "string",
      "required": true,
      "description": "Path to model file"
    },
    "gpu_enabled": {
      "type": "boolean",
      "default": true
    }
  },
  "permissions": {
    "file_system": ["read"],
    "network": ["localhost"]
  }
}
```

### 3.2 测试阶段

#### 步骤 4：本地测试

```bash
# 启动插件开发服务器
lingua-plugin dev

# 在 Electron 中加载插件（开发模式）
# 插件会被加载到 plugins/ 目录
```

#### 步骤 5：集成测试

```bash
# 运行插件测试套件
lingua-plugin test

# 测试插件与系统的集成
lingua-plugin test --integration
```

### 3.3 发布阶段

#### 步骤 6：打包插件

```bash
# 构建插件
lingua-plugin build

# 生成插件包
lingua-plugin package

# 输出：my-asr-plugin-1.0.0.lingua
```

#### 步骤 7：签名和验证

```bash
# 使用私钥签名插件
lingua-plugin sign --key private.key

# 验证插件签名
lingua-plugin verify my-asr-plugin-1.0.0.lingua
```

#### 步骤 8：发布到插件市场

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

### 3.4 安装阶段（用户端）

#### 步骤 9：用户发现插件

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

#### 步骤 10：安装和配置

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

#### 步骤 11：启用插件

**方式 A：自动启用**
- 如果插件是服务插件，系统会自动启动服务
- 如果插件是功能插件，用户需要在 UI 中启用

**方式 B：手动启用**
1. 进入"服务管理"页面
2. 找到新安装的插件
3. 点击"启用"按钮
4. 系统启动插件服务

### 3.5 运行阶段

#### 步骤 12：插件运行

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

#### 步骤 13：监控和管理

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
- ✅ 充分利用闲置算力

### 4.3 示例 3：AWS S3 存储插件（辅助功能）⚠️

**场景**：将翻译结果自动保存到 AWS S3（可选功能）

**插件类型**：集成插件（Integration Plugin）  
**部署模式**：远程服务插件（本地进程 + 远程 API）

**架构**：
```
节点推理服务 → localhost:5016 → S3 存储插件进程 → AWS S3 API
```

**实现要点**：
- 插件作为本地进程运行（包装器）
- 订阅 `translation_complete` 事件
- 上传翻译结果到 S3（可选，用户可禁用）
- 处理上传失败和重试
- 支持批量上传
- **不参与核心推理流程**

**配置**：
```json
{
  "plugin_id": "aws-s3-storage-plugin",
  "deployment": "local_with_remote_api",
  "port": 5016,
  "type": "integration",
  "optional": true,
  "config": {
    "aws_access_key_id": "YOUR_ACCESS_KEY",
    "aws_secret_access_key": "YOUR_SECRET_KEY",
    "bucket": "lingua-translations",
    "region": "us-east-1",
    "path_prefix": "translations/"
  }
}
```

**为什么可以接受？**
- ✅ 不参与核心推理流程
- ✅ 用户可以选择禁用
- ✅ 不影响本地算力利用
- ✅ 仅用于数据持久化（可选功能）

### 4.4 示例 4：自定义术语替换插件（本地服务插件）

**场景**：根据行业术语库替换翻译结果

**插件类型**：功能插件（Feature Plugin）  
**部署模式**：本地服务插件（完全本地运行）

**架构**：
```
节点推理服务 → localhost:5014 → 术语替换插件进程（本地处理）
```

**实现要点**：
- 插件作为本地进程运行
- 依赖 NMT 模块（需要翻译结果）
- 加载本地术语库文件
- 执行术语替换（本地处理）
- 保持上下文一致性
- 无需网络连接

**配置**：
```json
{
  "plugin_id": "terminology-plugin",
  "deployment": "local",
  "port": 5014,
  "dependencies": ["nmt"],
  "requires_network": false,
  "config": {
    "terminology_file": "path/to/terminology.json",
    "match_mode": "exact",
    "case_sensitive": false
  }
}
```

### 4.5 示例 5：自定义 NMT 模型插件（本地服务插件）✅

**场景**：使用更先进的本地翻译模型替代 M2M100

**插件类型**：服务插件（Service Plugin）  
**部署模式**：本地服务插件（完全本地运行）

**架构**：
```
节点推理服务 → localhost:5015 → 自定义 NMT 插件进程（本地 GPU 推理）
```

**实现要点**：
- 插件作为本地进程运行
- 加载本地模型文件（如更大的 M2M100 模型、本地 LLM）
- 使用本地 GPU 进行推理
- 通过 HTTP 接口提供服务
- 数据完全本地处理（隐私保护）
- **充分利用本地算力**

**配置**：
```json
{
  "plugin_id": "custom-nmt-plugin",
  "deployment": "local",
  "port": 5015,
  "requires_gpu": true,
  "requires_network": false,
  "config": {
    "model_path": "models/nmt/m2m100-large.onnx",
    "gpu_enabled": true,
    "batch_size": 1,
    "max_length": 512
  }
}
```

**为什么符合设计理念？**
- ✅ 使用本地 GPU 资源
- ✅ 数据不离开节点
- ✅ 充分利用闲置算力
- ✅ 可以替代现有服务，但使用本地模型

---

## 5. 插件开发工具和 SDK

### 5.1 插件 SDK

**Rust SDK**：
```toml
[dependencies]
lingua-plugin-sdk = "1.0.0"
tokio = "1.0"
serde = "1.0"
```

**Python SDK**：
```bash
pip install lingua-plugin-sdk
```

**TypeScript SDK**（用于 UI 插件）：
```bash
npm install @lingua/plugin-sdk
```

### 5.2 开发工具

**CLI 工具**：
```bash
# 安装 CLI
npm install -g lingua-plugin-cli

# 创建插件项目
lingua-plugin create --type service --name my-plugin

# 开发模式
lingua-plugin dev

# 构建插件
lingua-plugin build

# 测试插件
lingua-plugin test

# 打包插件
lingua-plugin package
```

### 5.3 文档和示例

- **插件开发指南**：`docs/plugins/DEVELOPMENT_GUIDE.md`
- **API 参考**：`docs/plugins/API_REFERENCE.md`
- **示例插件**：`examples/plugins/`
- **最佳实践**：`docs/plugins/BEST_PRACTICES.md`

---

## 6. 插件安全和权限

### 6.1 安全机制

**插件签名**：
- 所有插件必须签名
- 使用 RSA 或 ECDSA 签名
- 验证插件完整性

**沙箱隔离**：
- 插件运行在独立进程
- 限制文件系统访问
- 限制网络访问
- 限制系统资源使用

**权限管理**：
```json
{
  "permissions": {
    "file_system": {
      "read": ["models/", "config/"],
      "write": ["logs/"]
    },
    "network": {
      "allowed_hosts": ["api.example.com"],
      "blocked_hosts": []
    },
    "system": {
      "gpu": true,
      "cpu_limit": "50%",
      "memory_limit": "2GB"
    }
  }
}
```

### 6.2 审核流程

**官方市场审核**：
1. 提交插件到官方市场
2. 自动安全检查（签名、权限、恶意代码）
3. 人工审核（功能、文档、质量）
4. 审核通过后发布

**自托管插件**：
- 用户自行承担风险
- 系统会显示警告
- 建议仅安装信任来源的插件

---

## 7. 总结

### 7.1 第三方插件场景总结

| 场景 | 插件类型 | 部署模式 | 是否符合设计理念 | 典型用途 |
|------|---------|---------|----------------|---------|
| 替代现有服务（本地模型） | 服务插件 | 本地服务插件 | ✅ 符合 | 自定义 ASR/NMT/TTS 模型（本地 GPU） |
| 扩展新功能（本地处理） | 功能插件 | 本地服务插件 | ✅ 符合 | 情感分析、术语替换（本地模型） |
| 集成外部服务（辅助功能） | 集成插件 | 远程服务插件 | ⚠️ 可接受 | 云存储、数据库、通知（可选） |
| ~~替代现有服务（云 API）~~ | ~~服务插件~~ | ~~远程服务插件~~ | ❌ **不符合** | ~~Google ASR、OpenAI NMT~~ |
| ~~扩展新功能（云 API）~~ | ~~功能插件~~ | ~~远程服务插件~~ | ❌ **不符合** | ~~远程情感分析、内容审核~~ |

### 7.2 接入流程总结

1. **开发**：创建项目 → 实现接口 → 编写元数据
2. **测试**：本地测试 → 集成测试
3. **发布**：打包 → 签名 → 发布到市场
4. **安装**：用户发现 → 安装 → 配置 → 启用
5. **运行**：监控 → 管理 → 更新

### 7.3 当前状态

**当前系统**：
- ✅ 使用模块化热插拔体系
- ✅ 支持动态启用/禁用模块
- ✅ 已有本地服务调用模式（NMT/TTS 通过 HTTP 调用本地 Python 进程）
- ⏸️ 插件化架构是未来扩展方案

**当前服务调用方式**：
- **NMT 服务**：`http://127.0.0.1:5008/v1/translate`（本地 Python 进程）
- **TTS 服务**：`http://127.0.0.1:5006/tts`（本地 Python 进程）
- **YourTTS 服务**：`http://127.0.0.1:5004/tts`（本地 Python 进程）

**未来规划**：
- 当需要第三方插件时，再实现插件化架构
- **插件必须遵循"利用本地算力"的设计理念**
- 核心推理服务必须使用本地模型和本地 GPU/CPU
- 远程服务插件仅用于可选的辅助功能（数据存储、通知等）
- 当前模块化体系已足够满足需求

**设计理念重申**：
- ✅ 核心目标：利用个人PC的闲置算力
- ✅ 所有核心推理工作应在本地完成
- ✅ 充分利用本地 GPU/CPU 资源
- ❌ 不应将节点变成转接服务
- ❌ 核心推理不应依赖远程服务

---

## 8. 参考文档

- [架构推荐方案](./ARCHITECTURE_RECOMMENDATION.md)
- [模块热插拔实现](./MODULE_HOT_PLUG_IMPLEMENTATION.md)
- [服务迁移评估](./SERVICE_MIGRATION_ASSESSMENT.md)
