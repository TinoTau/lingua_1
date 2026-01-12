# node-inference 模块实现方式说明

## 核心模块实现方式

### ✅ ASR（语音识别）- **自带（本地推理）**

**实现方式**：使用 `whisper-rs` 库，直接加载模型进行本地推理

**代码位置**：`src/asr.rs`

**实现细节**：
```rust
// 直接加载 Whisper 模型
let ctx = WhisperContext::new_with_params(
    model_path.to_str()?,
    WhisperContextParameters::default(),
)?;

// 本地推理
state.full(params, &audio_data)?;
```

**模型位置**：`models/asr/whisper-base/ggml-base.bin`

**特点**：
- ✅ 不需要外部服务
- ✅ 直接调用 Rust 库
- ✅ 支持 GPU 加速（CUDA）

---

### ❌ NMT（机器翻译）- **调用外部服务**

**实现方式**：使用 HTTP 客户端，调用 Python M2M100 服务

**代码位置**：`src/nmt.rs`

**实现细节**：
```rust
// 使用 HTTP 客户端
pub fn new_with_http_client(service_url: Option<String>) -> Result<Self> {
    let url = service_url
        .unwrap_or_else(|| "http://127.0.0.1:5008".to_string());
    
    Ok(Self {
        service_url: Some(url),
        http_client: Some(Client::new()),
        model_path: None,
    })
}

// HTTP 请求
let response = client
    .post(&format!("{}/v1/translate", url))
    .json(&request)
    .send()
    .await?;
```

**外部服务**：Python M2M100 服务（端口 5008）

**特点**：
- ❌ 需要外部 Python 服务运行
- ✅ 通过 HTTP 调用
- ⚠️ ONNX 模式未实现（代码中有 `new_with_onnx` 但返回错误）

---

### ❌ TTS（语音合成）- **调用外部服务**

**实现方式**：使用 HTTP 客户端，调用 Python Piper TTS 服务

**代码位置**：`src/tts.rs`

**实现细节**：
```rust
// 使用 HTTP 客户端
pub fn new(config: Option<PiperHttpConfig>) -> Result<Self> {
    let config = config.unwrap_or_else(|| {
        PiperHttpConfig {
            endpoint: "http://127.0.0.1:5006/tts".to_string(),
            // ...
        }
    });
    
    let client = Client::builder()
        .timeout(Duration::from_millis(config.timeout_ms))
        .build()?;
    
    Ok(Self { client, config })
}

// HTTP 请求
let response = self.client
    .post(&self.config.endpoint)
    .json(&http_request)
    .send()
    .await?;
```

**外部服务**：Python Piper TTS 服务（端口 5006）

**特点**：
- ❌ 需要外部 Python 服务运行
- ✅ 通过 HTTP 调用

---

### ✅ VAD（语音活动检测）- **自带（本地推理）**

**实现方式**：使用 `ort` (ONNX Runtime) 库，直接加载模型进行本地推理

**代码位置**：`src/vad.rs`

**实现细节**：
```rust
// 直接加载 ONNX 模型
let session = Session::builder()?
    .with_execution_providers([CUDAExecutionProvider::default().build()])?
    .commit_from_file(model_path)?;

// 本地推理
let outputs = session.run(ort::inputs!["input" => input_tensor]?)?;
```

**模型位置**：`models/vad/silero/silero_vad_official.onnx`

**特点**：
- ✅ 不需要外部服务
- ✅ 直接调用 ONNX Runtime
- ✅ 支持 GPU 加速（CUDA）

---

## 可选模块实现方式

### ❌ Speaker Embedding（说话者特征提取）- **调用外部服务**

**实现方式**：使用 HTTP 客户端，调用 Python Speaker Embedding 服务

**代码位置**：`src/speaker_embedding_client.rs`

**实现细节**：
```rust
// 使用 HTTP 客户端
pub fn new_with_url(service_url: Option<String>) -> Result<Self> {
    let url = service_url
        .or_else(|| std::env::var("SPEAKER_EMBEDDING_SERVICE_URL").ok())
        .unwrap_or_else(|| "http://127.0.0.1:5003".to_string());
    
    let config = SpeakerEmbeddingClientConfig {
        endpoint: url,
        timeout_ms: 5000,
    };
    
    Self::new(config)
}

// HTTP 请求
let response = self.client
    .post(&format!("{}/extract", self.config.endpoint))
    .json(&request_body)
    .send()
    .await?;
```

**外部服务**：Python Speaker Embedding 服务（端口 5003）

**特点**：
- ❌ 需要外部 Python 服务运行
- ✅ 通过 HTTP 调用
- ✅ 使用 SpeechBrain ECAPA-TDNN 模型
- ✅ 支持 GPU 加速（通过服务参数）

**服务位置**：`electron_node/services/speaker_embedding/`

---

## 总结

| 模块 | 实现方式 | 是否需要外部服务 | 外部服务名称 |
|------|---------|----------------|-------------|
| **ASR** | 本地推理 (whisper-rs) | ❌ 不需要 | - |
| **NMT** | HTTP 客户端 | ✅ 需要 | Python M2M100 服务 (端口 5008) |
| **TTS** | HTTP 客户端 | ✅ 需要 | Python Piper TTS 服务 (端口 5006) |
| **VAD** | 本地推理 (ONNX Runtime) | ❌ 不需要 | - |
| **Speaker Embedding** | HTTP 客户端 | ✅ 需要 | Python Speaker Embedding 服务 (端口 5003) |

## 详细说明

### 1. ASR 和 VAD 是自带的

- **ASR**：使用 `whisper-rs` Rust 库，直接加载 GGML 格式的 Whisper 模型
- **VAD**：使用 `ort` (ONNX Runtime) Rust 库，直接加载 ONNX 格式的 Silero VAD 模型

这两个模块**不需要外部服务**，模型文件在 `node-inference` 的 `models/` 目录下，推理在 Rust 进程中完成。

### 2. NMT、TTS 和 Speaker Embedding 是调用外部服务的

- **NMT**：通过 HTTP 请求调用运行在端口 5008 的 Python M2M100 服务
- **TTS**：通过 HTTP 请求调用运行在端口 5006 的 Python Piper TTS 服务
- **Speaker Embedding**：通过 HTTP 请求调用运行在端口 5003 的 Python Speaker Embedding 服务

这三个模块**需要外部 Python 服务运行**，`node-inference` 只作为 HTTP 客户端。

### 3. 代码证据

**NMT 初始化**（`src/inference.rs` 第 96 行）：
```rust
// 使用 HTTP 客户端方式初始化 NMT（推荐）
let nmt_engine = nmt::NMTEngine::new_with_http_client(None)?;
```

**TTS 初始化**（`src/inference.rs` 第 97 行）：
```rust
let tts_engine = tts::TTSEngine::new(None)?;  // 默认使用 HTTP 客户端
```

**ASR 初始化**（`src/inference.rs` 第 94 行）：
```rust
// ASR 模型在 whisper-base 子目录中
let asr_engine = asr::ASREngine::new(models_dir.join("asr").join("whisper-base"))?;
```

**VAD 初始化**（`src/inference.rs` 第 99 行）：
```rust
// VAD 模型在 silero 子目录中
let vad_engine = vad::VADEngine::new(models_dir.join("vad").join("silero"))?;
```

## 结论

**用户的理解有误**：

❌ **错误理解**：所有模块都是自带的
✅ **实际情况**：
- **ASR 和 VAD**：自带（本地推理）
- **NMT 和 TTS**：调用外部服务（HTTP 客户端）

因此，如果要改造成 Faster Whisper：
- **ASR**：可以从本地推理改为 HTTP 服务（类似 NMT、TTS 和 Speaker Embedding）
- **NMT、TTS 和 Speaker Embedding**：已经是 HTTP 服务，无需改动
- **VAD**：可以保持本地推理，或改为 HTTP 服务（可选）

## Speaker Embedding 服务详情

**服务位置**：`electron_node/services/speaker_embedding/`

**服务文件**：
- `speaker_embedding_service.py` - FastAPI HTTP 服务
- `requirements.txt` - Python 依赖
- `README.md` - 服务文档

**模型**：SpeechBrain ECAPA-TDNN
- 输出维度：192
- 输入要求：16kHz 单声道音频，至少 1 秒（16000 样本）

**API 端点**：
- `GET /health` - 健康检查
- `POST /extract` - 提取 speaker embedding

**相关文档**：
- [Embedding 模块迁移报告](./EMBEDDING_MODULE_MIGRATION.md) - 完整的迁移文档
- [Embedding 模块对比分析](./EMBEDDING_MODULE_COMPARISON.md) - 原项目与当前项目对比

