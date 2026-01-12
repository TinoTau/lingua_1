# Rust 推理服务器架构分析与 Faster Whisper 改造方案

## 一、当前架构概览

### 1.1 模块组成

当前 Rust 推理服务器（`node-inference`）由以下模块组成：

#### 核心模块（必需）

| 模块 | 实现方式 | 端口/位置 | 状态 |
|------|---------|----------|------|
| **ASR (Whisper)** | 本地推理 (whisper-rs) | 内置 | ✅ 已实现 |
| **NMT (M2M100)** | HTTP 客户端 | 5008 (Python 服务) | ✅ 已实现 |
| **TTS (Piper)** | HTTP 客户端 | 5006 (Python 服务) | ✅ 已实现 |
| **VAD (Silero)** | 本地推理 (ONNX Runtime) | 内置 | ✅ 已实现 |

#### 可选模块（热插拔）

| 模块 | 实现方式 | 端口/位置 | 状态 |
|------|---------|----------|------|
| **YourTTS** | HTTP 客户端 | 5004 (Python 服务) | ✅ 已实现 |
| **Speaker Identification** | 本地推理 | 内置 | ✅ 已实现 |
| **Voice Cloning** | 本地推理 | 内置 | ✅ 已实现 |
| **Speech Rate Detector** | 本地推理 | 内置 | ✅ 已实现 |
| **Speech Rate Controller** | 本地推理 | 内置 | ✅ 已实现 |
| **Language Detector** | 本地推理 (复用 Whisper) | 内置 | ✅ 已实现 |

#### 辅助模块

| 模块 | 功能 | 状态 |
|------|------|------|
| **Text Filter** | ASR 文本过滤 | ✅ 已实现 |
| **Audio Codec** | Opus 编解码 | ✅ 已实现 |
| **Pipeline Context** | 推理流程上下文 | ✅ 已实现 |
| **Module Manager** | 模块管理和热插拔 | ✅ 已实现 |

### 1.2 模块依赖关系

```
InferenceService (主服务)
├── 核心模块（必需）
│   ├── ASR (Whisper) ──┐
│   ├── NMT (HTTP)      │
│   ├── TTS (HTTP)      │
│   └── VAD (Silero)    │
│                       │
├── 可选模块（热插拔）  │
│   ├── YourTTS (HTTP)  │
│   ├── Speaker ID      │
│   ├── Voice Cloning   │
│   └── Speech Rate     │
│                       │
└── 辅助模块            │
    ├── Text Filter     │
    ├── Audio Codec     │
    ├── Language Detector (复用 ASR)
    └── Module Manager ─┘
```

### 1.3 代码结构

```
node-inference/
├── src/
│   ├── lib.rs              # 模块导出
│   ├── main.rs             # 服务入口
│   ├── inference.rs        # 核心推理服务
│   ├── http_server.rs      # HTTP 服务器
│   ├── asr.rs              # ASR 引擎 (Whisper)
│   ├── nmt.rs              # NMT 引擎 (HTTP 客户端)
│   ├── tts.rs              # TTS 引擎 (HTTP 客户端)
│   ├── vad.rs              # VAD 引擎 (Silero)
│   ├── yourtts.rs          # YourTTS 引擎 (HTTP 客户端)
│   ├── speaker.rs          # 说话者识别/克隆
│   ├── speech_rate.rs      # 语速检测/控制
│   ├── language_detector.rs # 语言检测
│   ├── text_filter/        # 文本过滤
│   ├── audio_codec.rs      # 音频编解码
│   ├── pipeline.rs         # 推理流程上下文
│   └── modules.rs          # 模块管理器
```

## 二、热插拔机制分析

### 2.1 当前热插拔实现

#### 2.1.1 模块级热插拔

**ModuleManager** (`modules.rs`) 提供：
- ✅ 模块注册和状态管理
- ✅ 依赖检查（依赖循环、冲突检查、依赖验证）
- ✅ 模型检查（模型可用性验证）
- ✅ 模块启用/禁用

**代码示例**：
```rust
// 启用模块
pub async fn enable_module(&self, module_name: &str) -> Result<()> {
    // 1. 检查模块元数据
    // 2. 检查依赖循环
    // 3. 检查冲突模块
    // 4. 检查模块依赖
    // 5. 检查所需模型
    // 6. 更新模块状态
}

// 禁用模块
pub async fn disable_module(&self, module_name: &str) -> Result<()> {
    // 更新模块状态
}
```

#### 2.1.2 服务级热插拔

**PythonServiceManager** (`python-service-manager.ts`) 管理：
- ✅ NMT 服务（端口 5008）
- ✅ TTS 服务（端口 5006）
- ✅ YourTTS 服务（端口 5004）

**功能**：
- 动态启动/停止服务
- 服务状态监控
- 自动端口清理
- 服务偏好保存

### 2.2 热插拔支持情况

| 模块类型 | 热插拔支持 | 实现方式 |
|---------|-----------|---------|
| **ASR (Whisper)** | ❌ 不支持 | 本地推理，启动时加载 |
| **NMT (M2M100)** | ✅ 支持 | HTTP 服务，可动态启动/停止 |
| **TTS (Piper)** | ✅ 支持 | HTTP 服务，可动态启动/停止 |
| **VAD (Silero)** | ❌ 不支持 | 本地推理，启动时加载 |
| **YourTTS** | ✅ 支持 | HTTP 服务，可动态启动/停止 |
| **可选模块** | ✅ 支持 | 通过 ModuleManager 管理 |

## 三、Faster Whisper 改造方案

### 3.1 改造目标

将 ASR 从本地推理（whisper-rs）改为 HTTP 服务（Faster Whisper），实现：
1. ✅ ASR 模块热插拔
2. ✅ 提高识别准确率（文本上下文、束搜索）
3. ✅ 保持与其他模块的兼容性
4. ✅ 支持 Web 端功能模块选择

### 3.2 架构设计

#### 3.2.1 改造后的架构

```
InferenceService (Rust, 端口 5009)
├── ASR (Faster Whisper) ──→ HTTP 服务 (Python, 端口 6006) ✅ 新增
├── NMT (M2M100) ──────────→ HTTP 服务 (Python, 端口 5008) ✅ 已有
├── TTS (Piper) ──────────→ HTTP 服务 (Python, 端口 5006) ✅ 已有
├── VAD (Silero) ─────────→ 本地推理 (ONNX Runtime) ✅ 保留
└── 可选模块
    ├── YourTTS ──────────→ HTTP 服务 (Python, 端口 5004) ✅ 已有
    └── 其他本地模块 ─────→ 本地推理 ✅ 保留
```

#### 3.2.2 模块拆分方案

**方案 A：完全拆分（推荐）**

将所有模块拆分为独立服务：

```
服务架构：
├── ASR Service (Faster Whisper, Python, 端口 6006) ✅ 新增
├── NMT Service (M2M100, Python, 端口 5008) ✅ 已有
├── TTS Service (Piper, Python, 端口 5006) ✅ 已有
├── YourTTS Service (Python, 端口 5004) ✅ 已有
└── Inference Service (Rust, 端口 5009) ──→ 协调服务
    ├── VAD (本地推理) ──→ 保留
    ├── Text Filter ────→ 保留
    ├── Audio Codec ────→ 保留
    └── Module Manager ──→ 保留
```

**优势**：
- ✅ 每个模块独立，可单独启动/停止
- ✅ 支持模块级热插拔
- ✅ 资源隔离，故障隔离
- ✅ 易于扩展和维护

**劣势**：
- ⚠️ 需要管理多个服务进程
- ⚠️ 服务间通信开销（HTTP）

**方案 B：混合方案**

核心模块（ASR、NMT、TTS）拆分为服务，辅助模块保留在 Rust 服务中：

```
服务架构：
├── ASR Service (Faster Whisper, Python, 端口 6006) ✅ 新增
├── NMT Service (M2M100, Python, 端口 5008) ✅ 已有
├── TTS Service (Piper, Python, 端口 5006) ✅ 已有
└── Inference Service (Rust, 端口 5009)
    ├── VAD (本地推理) ──→ 保留
    ├── Text Filter ────→ 保留
    ├── Audio Codec ────→ 保留
    ├── Language Detector ──→ 保留（或改为 HTTP）
    └── Module Manager ──→ 保留
```

**优势**：
- ✅ 平衡了模块化和性能
- ✅ 减少服务数量
- ✅ 辅助模块保持低延迟

**劣势**：
- ⚠️ VAD 和 Language Detector 仍无法热插拔

### 3.3 实现步骤

#### 步骤 1：创建 Faster Whisper HTTP 服务

**文件结构**：
```
services/
├── asr-faster-whisper/        # 新增
│   ├── main.py
│   ├── asr_service.py
│   ├── requirements.txt
│   └── README.md
├── nmt-m2m100/                # 已有
├── tts-piper/                 # 已有
└── yourtts/                   # 已有
```

**ASR 服务接口**：
```python
# POST /asr
{
    "audio_b64": "...",           # Base64 编码的 WAV 音频
    "prompt": "...",              # 文本上下文（initial_prompt）
    "language": "zh",            # 语言代码（可选）
    "task": "transcribe",        # 任务类型
    "beam_size": 5,              # 束搜索大小
    "condition_on_previous_text": true  # 条件生成
}

# Response
{
    "text": "...",               # 完整转录文本
    "segments": ["...", "..."],  # 分段文本
    "language": "zh",            # 检测到的语言
    "duration": 2.5              # 音频时长（秒）
}
```

#### 步骤 2：修改 Rust ASR 引擎

**修改 `asr.rs`**：
```rust
pub struct ASREngine {
    // 改为 HTTP 客户端
    http_client: Option<Client>,
    service_url: Option<String>,
    
    // 保留本地推理作为回退（可选）
    whisper_ctx: Option<Arc<WhisperContext>>,
    
    // 文本上下文缓存
    text_context_cache: Arc<tokio::sync::Mutex<Option<String>>>,
}

impl ASREngine {
    /// 创建使用 HTTP 客户端的 ASR 引擎（推荐）
    pub fn new_with_http_client(service_url: Option<String>) -> Result<Self> {
        // ...
    }
    
    /// 创建使用本地推理的 ASR 引擎（回退）
    pub fn new_with_local_inference(model_path: &Path) -> Result<Self> {
        // ...
    }
    
    /// 转录（使用 Faster Whisper）
    pub async fn transcribe_f32(
        &self,
        audio_data: &[f32],
        lang: &str,
    ) -> Result<String> {
        // 1. 获取文本上下文
        let text_context = {
            let cache = self.text_context_cache.lock().await;
            cache.clone()
        };
        
        // 2. 转换为 WAV 字节
        let wav_bytes = self.audio_to_wav_bytes(audio_data)?;
        
        // 3. 调用 Faster Whisper 服务
        let response = self.http_client
            .post(&format!("{}/asr", self.service_url))
            .json(&AsrHttpRequest {
                audio_b64: base64::encode(&wav_bytes),
                prompt: text_context.unwrap_or_default(),
                language: Some(lang.to_string()),
                task: "transcribe".to_string(),
                beam_size: 5,
                condition_on_previous_text: true,
            })
            .send()
            .await?;
        
        // 4. 解析响应
        let asr_response: AsrHttpResponse = response.json().await?;
        
        // 5. 更新文本上下文缓存
        if !asr_response.text.trim().is_empty() {
            let mut cache = self.text_context_cache.lock().await;
            *cache = Some(asr_response.text.clone());
        }
        
        Ok(asr_response.text)
    }
}
```

#### 步骤 3：更新 PythonServiceManager

**修改 `python-service-manager.ts`**：
```typescript
export class PythonServiceManager {
  // 添加 ASR 服务配置
  private getServiceConfig(serviceName: 'asr' | 'nmt' | 'tts' | 'yourtts'): PythonServiceConfig | null {
    switch (serviceName) {
      case 'asr':
        return {
          scriptPath: path.join(__dirname, '../../services/asr-faster-whisper/main.py'),
          port: 6006,
          env: {
            MODEL_PATH: path.join(modelsDir, 'asr', 'faster-whisper'),
            // ...
          },
        };
      // ... 其他服务
    }
  }
  
  async startService(serviceName: 'asr' | 'nmt' | 'tts' | 'yourtts'): Promise<void> {
    // ... 启动逻辑
  }
}
```

#### 步骤 4：更新 ModuleManager

**修改 `modules.rs`**：
```rust
lazy_static! {
    pub static ref MODULE_TABLE: HashMap<&'static str, ModuleMetadata> = {
        let mut m = HashMap::new();
        
        // ASR 模块（改为可选）
        m.insert("asr", ModuleMetadata {
            name: "asr",
            description: "Automatic Speech Recognition (Faster Whisper)",
            required_models: vec![
                ModelRequirement {
                    model_id: "faster-whisper-base",
                    version: Some("latest".to_string()),
                },
            ],
            dependencies: vec![],
            conflicts: vec![],
            is_optional: true,  // 改为可选
        });
        
        // ... 其他模块
        m
    };
}
```

#### 步骤 5：更新 InferenceService

**修改 `inference.rs`**：
```rust
impl InferenceService {
    pub fn new(models_dir: PathBuf) -> Result<Self> {
        // ASR 改为可选，通过 HTTP 客户端初始化
        let asr_engine = asr::ASREngine::new_with_http_client(
            Some("http://127.0.0.1:6006".to_string())
        )?;
        
        // ... 其他模块
    }
    
    /// 启用 ASR 模块（热插拔）
    pub async fn enable_asr_module(&self) -> Result<()> {
        // 1. 检查 ASR 服务是否运行
        // 2. 如果未运行，启动服务
        // 3. 标记模块为已启用
        self.module_manager.enable_module("asr").await?;
        Ok(())
    }
    
    /// 禁用 ASR 模块（热插拔）
    pub async fn disable_asr_module(&self) -> Result<()> {
        // 1. 标记模块为已禁用
        // 2. 可选：停止 ASR 服务（释放资源）
        self.module_manager.disable_module("asr").await?;
        Ok(())
    }
}
```

## 四、Web 端功能模块选择

### 4.1 当前实现

**Web 端通过 `SessionInitMessage` 发送功能请求**：
```typescript
interface SessionInitMessage {
  features: FeatureFlags;  // 功能标志
  // ...
}

interface FeatureFlags {
  speaker_identification?: boolean;
  voice_cloning?: boolean;
  speech_rate_control?: boolean;
  // ...
}
```

### 4.2 改造后的实现

#### 4.2.1 扩展 FeatureFlags

```typescript
interface FeatureFlags {
  // 核心模块选择
  asr?: 'faster-whisper' | 'whisper-rs' | 'auto';  // 新增
  nmt?: 'm2m100' | 'auto';                         // 已有
  tts?: 'piper' | 'yourtts' | 'auto';             // 已有
  
  // 可选模块
  speaker_identification?: boolean;
  voice_cloning?: boolean;
  speech_rate_control?: boolean;
  // ...
}
```

#### 4.2.2 节点端处理逻辑

**修改 `node-agent.ts`**：
```typescript
async handleJob(job: Job): Promise<void> {
  // 1. 解析功能请求
  const features = job.features || {};
  
  // 2. 根据功能请求启动/停止服务
  if (features.asr === 'faster-whisper') {
    await this.pythonServiceManager.startService('asr');
  }
  
  if (features.nmt === 'm2m100') {
    await this.pythonServiceManager.startService('nmt');
  }
  
  if (features.tts === 'piper') {
    await this.pythonServiceManager.startService('tts');
  }
  
  // 3. 调用推理服务
  const result = await this.inferenceService.process(job);
  
  // ...
}
```

#### 4.2.3 推理服务处理

**修改 `inference.rs`**：
```rust
pub async fn process(&self, request: InferenceRequest) -> Result<InferenceResult> {
    // 1. 根据 features 启用/禁用模块
    if let Some(ref features) = request.features {
        if features.asr == Some("faster-whisper".to_string()) {
            self.enable_asr_module().await?;
        }
        
        if features.speaker_identification == Some(true) {
            self.enable_module("speaker_identification").await?;
        }
        // ...
    }
    
    // 2. 执行推理流程
    // ...
}
```

## 五、热插拔适配性分析

### 5.1 完全适配热插拔的模块

| 模块 | 当前状态 | 改造后状态 | 适配性 |
|------|---------|-----------|--------|
| **ASR (Faster Whisper)** | ❌ 不支持 | ✅ 支持 | ✅ 完全适配 |
| **NMT (M2M100)** | ✅ 支持 | ✅ 支持 | ✅ 完全适配 |
| **TTS (Piper)** | ✅ 支持 | ✅ 支持 | ✅ 完全适配 |
| **YourTTS** | ✅ 支持 | ✅ 支持 | ✅ 完全适配 |
| **可选模块** | ✅ 支持 | ✅ 支持 | ✅ 完全适配 |

### 5.2 部分适配的模块

| 模块 | 当前状态 | 改造后状态 | 适配性 |
|------|---------|-----------|--------|
| **VAD (Silero)** | ❌ 不支持 | ⚠️ 可选支持 | ⚠️ 部分适配 |
| **Language Detector** | ❌ 不支持 | ⚠️ 可选支持 | ⚠️ 部分适配 |

**说明**：
- VAD 和 Language Detector 可以改为 HTTP 服务，但通常不需要热插拔（核心功能）
- 如果改为 HTTP 服务，可以实现完全热插拔

### 5.3 热插拔流程

```
Web 端选择功能
    ↓
SessionInitMessage { features: {...} }
    ↓
调度服务器转发
    ↓
Node Agent 接收
    ↓
PythonServiceManager.startService('asr' | 'nmt' | 'tts' | ...)
    ↓
服务启动（如果未运行）
    ↓
InferenceService.enable_module('asr' | ...)
    ↓
ModuleManager.enable_module()
    ↓
模块启用完成
    ↓
开始处理推理请求
```

## 六、实施建议

### 6.1 优先级

**高优先级（立即实施）**：
1. ✅ 创建 Faster Whisper HTTP 服务
2. ✅ 修改 Rust ASR 引擎为 HTTP 客户端
3. ✅ 更新 PythonServiceManager 支持 ASR 服务

**中优先级（后续优化）**：
4. ⚠️ 扩展 Web 端功能选择
5. ⚠️ 优化模块热插拔流程
6. ⚠️ 添加服务健康检查

**低优先级（长期优化）**：
7. ⚠️ 将 VAD 和 Language Detector 改为 HTTP 服务
8. ⚠️ 实现服务自动重启和故障恢复

### 6.2 兼容性考虑

**向后兼容**：
- 保留本地推理（whisper-rs）作为回退选项
- 支持通过配置选择 ASR 引擎（Faster Whisper 或 whisper-rs）
- 保持现有 API 接口不变

**迁移路径**：
1. 阶段 1：并行支持 Faster Whisper 和 whisper-rs
2. 阶段 2：默认使用 Faster Whisper，whisper-rs 作为回退
3. 阶段 3：完全切换到 Faster Whisper（可选）

## 七、总结

### 7.1 模块拆分可行性

✅ **完全可行**：
- 当前架构已支持模块化设计
- NMT、TTS、YourTTS 已实现 HTTP 服务
- ASR 可以轻松改为 HTTP 服务

### 7.2 热插拔适配性

✅ **完全适配**：
- 核心模块（ASR、NMT、TTS）可热插拔
- 可选模块已支持热插拔
- ModuleManager 提供完整的模块管理功能

### 7.3 Web 端功能选择

✅ **完全支持**：
- 当前已通过 `FeatureFlags` 支持功能选择
- 可以扩展支持模块级选择（ASR、NMT、TTS 引擎选择）
- 节点端可以根据功能请求启动/停止服务

### 7.4 改造优势

1. ✅ **提高识别准确率**：Faster Whisper 支持文本上下文和束搜索
2. ✅ **模块化**：每个模块独立，易于维护和扩展
3. ✅ **热插拔**：支持动态启用/禁用模块
4. ✅ **资源隔离**：服务故障不影响其他模块
5. ✅ **灵活性**：Web 端可以选择功能模块

### 7.5 改造挑战

1. ⚠️ **服务管理**：需要管理多个服务进程
2. ⚠️ **通信开销**：HTTP 通信比本地调用慢
3. ⚠️ **部署复杂度**：需要部署多个服务

**解决方案**：
- 使用 PythonServiceManager 统一管理服务
- 优化 HTTP 通信（连接池、压缩）
- 提供一键启动脚本

## 八、相关文档

- [ASR 准确率对比与改进方案](./ASR_ACCURACY_COMPARISON_AND_IMPROVEMENTS.md)
- [服务热插拔验证](../../docs/SERVICE_HOT_PLUG_VERIFICATION.md)
- [模块管理器实现](./modules.rs)

