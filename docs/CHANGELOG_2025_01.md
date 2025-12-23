# 更新日志 - 2025年1月

本文档记录了 2025年1月 的主要功能更新和改进。

## 新增 Python 服务（2025-12-23）

### Faster Whisper VAD 服务

**日期**: 2025-12-23

**功能说明**:
- ✅ 新增 Faster Whisper VAD 服务（端口 6007）
- ✅ 整合 Faster Whisper ASR 和 Silero VAD 功能
- ✅ 支持上下文缓冲（音频上下文和文本上下文）
- ✅ 支持 Utterance 任务处理
- ✅ **GPU 加速支持**：自动检测 CUDA，使用 `float16` 计算类型（10-20x 性能提升）
- ✅ 服务独立性：每个服务只在自己的目录下查找模型

**技术实现**:
- Python 服务：`electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`
- 模型转换工具：`electron_node/services/faster_whisper_vad/convert_model.py`
- 使用 `faster-whisper` 库（基于 CTranslate2）
- 使用 `onnxruntime-gpu` 进行 VAD GPU 加速

**GPU 配置**:
- 自动检测 CUDA 可用性
- 如果 CUDA 可用，使用 GPU 和 `float16` 计算类型
- 如果 CUDA 不可用，自动回退到 CPU 和 `float32`
- VAD 模型使用 `CUDAExecutionProvider` 优先

**相关文档**:
- [Faster Whisper VAD 服务 README](../electron_node/services/faster_whisper_vad/README.md)
- [GPU 性能分析](../electron_node/services/faster_whisper_vad/GPU_ANALYSIS.md)
- [GPU 配置指南](../electron_node/services/faster_whisper_vad/GPU_SETUP.md)

### Speaker Embedding 服务 GPU 配置

**日期**: 2025-12-23

**功能说明**:
- ✅ 配置 Speaker Embedding 服务 GPU 加速
- ✅ 自动检测 CUDA 可用性并启用 GPU
- ✅ 性能提升：单次推理 5-10x，批量处理 10-32x

**技术实现**:
- 安装 PyTorch CUDA 版本（2.5.1+cu121）
- 自动添加 `--gpu` 参数启动服务
- 服务自动检测并使用 GPU（如果可用）

**相关文档**:
- [Speaker Embedding 服务 README](../electron_node/services/speaker_embedding/README.md)
- [GPU 性能分析](../electron_node/services/speaker_embedding/GPU_ANALYSIS.md)
- [GPU 配置指南](../electron_node/services/speaker_embedding/GPU_SETUP.md)

### GPU 配置完成

**日期**: 2025-12-23

**配置状态**:
- ✅ Faster Whisper VAD：已安装 `onnxruntime-gpu`，GPU 测试通过
- ✅ Speaker Embedding：已安装 PyTorch CUDA 版本，GPU 测试通过
- ✅ 所有服务使用独立的虚拟环境，无版本冲突

**性能提升**:
- Faster Whisper VAD：整体服务 5-15x 性能提升
- Speaker Embedding：单次 5-10x，批量 10-32x 性能提升

**相关文档**:
- [GPU 配置完成报告](../electron_node/services/GPU_CONFIGURATION_COMPLETE.md)
- [PyTorch 版本分析](../electron_node/services/PYTORCH_VERSION_ANALYSIS.md)

## Node Inference 服务更新

### Speaker Embedding 模块迁移完成

**日期**: 2025-01-XX

**功能说明**:
- ✅ 从原项目迁移完整的 Speaker Embedding 模块
- ✅ Python HTTP 服务（端口 5003），使用 SpeechBrain ECAPA-TDNN 模型
- ✅ Rust HTTP 客户端集成
- ✅ Speaker Identification 模块更新，支持基于 embedding 的说话者识别
- ✅ 支持单人模式和多人模式
- ✅ 热插拔支持，可根据 features 动态启用/禁用
- ✅ 自动服务管理，Node Agent 根据 features 自动启动服务

**技术实现**:
- Python 服务：`electron_node/services/speaker_embedding/speaker_embedding_service.py`
- Rust 客户端：`electron_node/services/node-inference/src/speaker_embedding_client.rs`
- 模块更新：`electron_node/services/node-inference/src/speaker.rs`
- 服务管理：PythonServiceManager 支持启动/停止服务

**相关文档**:
- [Embedding 模块迁移报告](../electron_node/services/node-inference/docs/EMBEDDING_MODULE_MIGRATION.md)
- [Embedding 模块对比分析](../electron_node/services/node-inference/docs/EMBEDDING_MODULE_COMPARISON.md)
- [模块实现方式说明](../electron_node/services/node-inference/docs/MODULE_IMPLEMENTATION_METHODS.md)

### 标点符号过滤功能

### 标点符号过滤功能

**日期**: 2025-01-XX

**功能说明**:
- 新增 `filter_punctuation` 配置项，自动过滤所有包含标点符号的文本
- 语音输入的文本不应该包含任何标点符号，所有带标点符号的文本都会被过滤
- 支持中文和英文标点符号的全面过滤
- 有效防止静音时被误识别为带标点的文本（通常来自视频字幕训练数据）

**配置项**:
```json
{
  "rules": {
    "filter_punctuation": true
  }
}
```

**过滤的标点符号包括**:
- 中文标点：，。！？；：、""''（）【】《》…—·等
- 英文标点：,.!?;:'"()[]{}等
- 其他常见标点：-、_、/、\、|、@、#、$、% 等

**相关文档**:
- [ASR 文本过滤配置文档](../electron_node/services/node-inference/docs/ASR_TEXT_FILTER_CONFIG.md)

**技术细节**:
- 在 `text_filter.rs` 中添加了 `contains_punctuation()` 函数
- 在过滤逻辑中，标点符号检查优先于括号检查
- 如果文本包含任何标点符号，会被过滤并记录日志

## Web 客户端更新

### UI 布局改进

**日期**: 2025-01-XX

**改进内容**:
- 按钮布局优化，分为两行显示
- 第一行：连接服务器、开始、结束（会话控制按钮）
- 第二行：发送、播放（放大 1.5 倍）、倍速（操作按钮）
- 发送和播放按钮放大 1.5 倍，更加醒目

**相关文件**:
- `webapp/web-client/src/ui/renderers.ts`

### 会话管理增强

**日期**: 2025-01-XX

**改进内容**:

1. **结束会话时丢弃未播放内容**:
   - 清空 TTS 播放缓冲区
   - 清空音频缓冲区
   - 清空 WebSocket 发送队列
   - 清空待显示的翻译结果队列
   - 清空已显示的翻译结果文本

2. **拒绝接收会话结束后的翻译结果**:
   - 会话结束后，即使调度服务器返回新的翻译结果，也会直接丢弃
   - 对 `asr_partial`、`translation`、`translation_result`、`tts_audio` 消息类型进行检查
   - 如果 `isSessionActive` 为 `false`，直接返回，不处理

**相关文件**:
- `webapp/web-client/src/app.ts`
- `webapp/web-client/src/websocket_client.ts`

### 翻译结果显示逻辑改进

**日期**: 2025-01-XX

**改进内容**:
- 收到翻译结果后，不再立即显示，而是缓存到队列中
- 只有在用户点击播放按钮开始播放 TTS 音频时才显示翻译结果
- 如果用户点击结束，未播放的翻译结果会被清空，不会显示

**实现机制**:
- 使用 `pendingTranslationResults` 队列缓存待显示的翻译结果
- 在 `startTtsPlayback()` 中调用 `displayPendingTranslationResults()` 显示所有待显示的结果
- 在 `endSession()` 中清空队列和已显示的文本

**相关文件**:
- `webapp/web-client/src/app.ts`

**相关文档**:
- [UI 改进和功能更新文档](../../webapp/web-client/docs/UI_IMPROVEMENTS_AND_FEATURES.md)

## 文档更新

### 新增文档

1. **UI_IMPROVEMENTS_AND_FEATURES.md**
   - 位置: `webapp/web-client/docs/UI_IMPROVEMENTS_AND_FEATURES.md`
   - 内容: Web 客户端 UI 改进和功能更新的详细说明

### 更新文档

1. **ASR_TEXT_FILTER_CONFIG.md**
   - 位置: `electron_node/services/node-inference/docs/ASR_TEXT_FILTER_CONFIG.md`
   - 更新: 添加标点符号过滤功能说明

2. **Speaker Embedding 相关文档**
   - `electron_node/services/node-inference/docs/EMBEDDING_MODULE_MIGRATION.md` - 迁移报告
   - `electron_node/services/node-inference/docs/EMBEDDING_MODULE_COMPARISON.md` - 对比分析
   - `electron_node/services/node-inference/docs/MODULE_IMPLEMENTATION_METHODS.md` - 更新实现方式说明
   - `docs/electron_node/node-inference/README.md` - 更新节点推理服务文档

3. **文档索引**
   - `docs/DOCUMENTATION_INDEX.md` - 添加 Speaker Embedding 文档链接
   - `docs/web_client/README.md` - 添加 UI 改进文档链接
   - `docs/electron_node/README.md` - 添加 Speaker Embedding 和 ASR 过滤文档链接

## 技术细节

### Node Inference 服务

**文件修改**:
- `src/text_filter/config.rs` - 添加 `filter_punctuation` 字段
- `src/text_filter.rs` - 添加 `contains_punctuation()` 函数和标点符号检查逻辑
- `config/asr_filters.json` - 添加 `filter_punctuation: true` 配置

### Web 客户端

**文件修改**:
- `src/ui/renderers.ts` - 按钮布局调整
- `src/app.ts` - 会话管理增强、翻译结果显示逻辑改进
- `src/websocket_client.ts` - `clearSendQueue()` 方法改为公开方法

## 测试建议

### Node Inference 服务

1. 测试标点符号过滤功能：
   - 验证包含标点符号的文本是否被正确过滤
   - 验证日志是否正确记录过滤操作
   - 验证配置项是否生效

### Web 客户端

1. 测试 UI 布局：
   - 验证按钮布局是否符合设计要求
   - 验证发送和播放按钮是否放大 1.5 倍

2. 测试会话管理：
   - 验证点击"结束"按钮后，所有未播放内容是否被清空
   - 验证会话结束后，新的翻译结果是否被丢弃

3. 测试翻译结果显示：
   - 验证收到翻译结果后，是否不立即显示
   - 验证点击播放后，是否显示所有待显示的结果
   - 验证点击结束后，未播放的翻译结果是否被清空

## 后续计划

1. **批量显示优化**: 如果待显示的结果很多，可以考虑分批显示
2. **显示状态指示**: 添加指示器，显示有多少待显示的翻译结果
3. **自动播放触发**: 在内存压力过高时，自动播放并显示翻译结果

## 相关链接

- [Web 客户端文档索引](./web_client/README.md)
- [Electron Node 文档索引](./electron_node/README.md)
- [节点推理服务文档](./electron_node/node-inference/README.md)
- [ASR 文本过滤配置文档](../electron_node/services/node-inference/docs/ASR_TEXT_FILTER_CONFIG.md)
- [Embedding 模块迁移报告](../electron_node/services/node-inference/docs/EMBEDDING_MODULE_MIGRATION.md)
- [UI 改进和功能更新文档](../../webapp/web-client/docs/UI_IMPROVEMENTS_AND_FEATURES.md)

