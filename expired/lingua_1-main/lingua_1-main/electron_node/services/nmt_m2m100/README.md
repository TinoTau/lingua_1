# M2M100 NMT 服务

M2M100 机器翻译服务，提供 HTTP API 接口，支持上下文翻译和候选生成。

## 功能特性

- ✅ **M2M100 模型**: 使用 Facebook M2M100 多语言翻译模型
- ✅ **GPU 加速**: 自动检测 CUDA，支持 GPU 加速
- ✅ **上下文支持**: 支持上下文文本提升翻译质量
- ✅ **候选生成**: 支持生成多个候选翻译（用于 NMT Repair）
- ✅ **分隔符提取**: 支持从上下文+当前文本中提取当前句翻译
- ✅ **文本过滤**: 支持标点符号过滤
- ✅ **本地模型**: 优先使用本地模型文件，无需网络连接

## 安装

### 1. 创建虚拟环境

```powershell
cd electron_node/services/nmt_m2m100
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 2. 安装依赖

```powershell
pip install -r requirements.txt
```

### 3. 配置 HuggingFace Token（可选）

如果需要从 HuggingFace Hub 下载模型，可以：

- 设置环境变量：`$env:HF_TOKEN = "your_token"`
- 或创建 `hf_token.txt` 文件，将 token 写入其中

如果模型已完全下载到本地，可以设置环境变量：
```powershell
$env:HF_LOCAL_FILES_ONLY = "true"
```

## 运行

### 方式 1: 使用启动脚本

```powershell
.\scripts\start_nmt_service.ps1
```

### 方式 2: 手动启动

```powershell
cd electron_node/services/nmt_m2m100
.\venv\Scripts\Activate.ps1
uvicorn nmt_service:app --host 127.0.0.1 --port 5008
```

## API 接口

### 健康检查

```bash
GET http://127.0.0.1:5008/health
```

**响应**：
```json
{
  "status": "ok",
  "model": "facebook/m2m100_418M",
  "device": "cuda"
}
```

### 翻译接口

```bash
POST http://127.0.0.1:5008/v1/translate
Content-Type: application/json

{
  "src_lang": "zh",
  "tgt_lang": "en",
  "text": "你好",
  "context_text": null,
  "num_candidates": 1
}
```

**请求参数**:
- `src_lang`: 源语言代码（如 "zh", "en"）
- `tgt_lang`: 目标语言代码（如 "zh", "en"）
- `text`: 要翻译的文本
- `context_text`: 上下文文本（可选，用于提升翻译质量）
- `num_candidates`: 候选数量（可选，用于 NMT Repair，默认 1）

**响应**：
```json
{
  "ok": true,
  "text": "Hello",
  "model": "facebook/m2m100_418M",
  "provider": "local-m2m100",
  "extraction_mode": "SINGLE_ONLY",
  "extraction_confidence": "HIGH",
  "candidates": ["Hello"],
  "extra": {
    "elapsed_ms": 150,
    "num_tokens": 10,
    "tokenization_ms": 5,
    "generation_ms": 140,
    "decoding_ms": 5
  }
}
```

**响应字段**:
- `ok`: 是否成功
- `text`: 翻译结果（提取后的当前句翻译）
- `model`: 使用的模型名称
- `provider`: 服务提供者
- `extraction_mode`: 提取模式（SENTINEL, ALIGN_FALLBACK, SINGLE_ONLY, FULL_ONLY）
- `extraction_confidence`: 提取置信度（HIGH, MEDIUM, LOW）
- `candidates`: 候选翻译列表（当 `num_candidates > 1` 时）
- `extra`: 额外信息（性能指标等）

## 配置

### 环境变量

- `HF_TOKEN`: HuggingFace token（可选）
- `HF_LOCAL_FILES_ONLY`: 如果设置为 "true"，只使用本地模型文件，不进行网络请求
- `NMT_FORCE_CPU`: 如果设置为 "true"，强制使用 CPU 模式（用于诊断 CUDA 问题）

### 模型配置

服务优先使用本地模型文件：

- **模型目录**: `models/m2m100-en-zh` 或 `models/m2m100-zh-en`
- **模型文件**: 需要包含 `tokenizer.json` 和 `model.safetensors`（或 `pytorch_model.bin`）
- **自动检测**: 服务启动时自动检测可用的本地模型

### 配置文件

`nmt_config.json` 包含以下配置：

- **分隔符配置**: 用于从上下文+当前文本中提取当前句翻译
- **文本过滤配置**: 标点符号过滤规则

## 实现细节

### 上下文处理

- 如果提供 `context_text`，会使用分隔符拼接：`{context_text}{SEPARATOR}{text}`
- 自动检测并避免重复：如果 `context_text` 和 `text` 相同，只使用 `text`
- 使用分隔符提取机制从翻译结果中提取当前句翻译

### 候选生成

- 支持生成多个候选翻译（用于 NMT Repair）
- 通过 `num_candidates` 参数控制候选数量
- 使用 beam search 生成候选

### GPU 支持

- 自动检测 CUDA 可用性
- 如果 CUDA 测试失败，自动回退到 CPU
- 支持通过环境变量强制使用 CPU 模式

### 分隔符提取

服务支持从上下文+当前文本的翻译结果中提取当前句翻译：

- **SENTINEL 模式**: 使用分隔符标记提取（高置信度）
- **ALIGN_FALLBACK 模式**: 对齐回退提取（中等置信度）
- **SINGLE_ONLY 模式**: 只翻译当前文本（高置信度）
- **FULL_ONLY 模式**: 返回完整翻译（低置信度）

## 故障排除

详见 [故障排除指南](./docs/TROUBLESHOOTING.md)

常见问题：
- 服务崩溃（退出码 3221225477）
- 重复翻译问题
- CUDA 相关问题
- 模型加载失败

## 注意事项

1. **GPU 支持**: 如果系统有 CUDA GPU，服务会自动使用 GPU 加速
2. **模型加载**: 首次启动时模型加载可能需要几分钟时间
3. **内存要求**: 建议至少 8GB 内存，使用 GPU 时建议至少 4GB 显存
4. **本地模型**: 服务优先使用本地模型文件，确保模型文件完整
5. **上下文文本**: `context_text` 应该是上一个 utterance 的翻译文本，不是当前文本

## 相关文档

- [故障排除指南](./docs/TROUBLESHOOTING.md): 详细的故障排除说明
- [配置文件](./nmt_config.json): 配置文件说明

