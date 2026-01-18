# 翻译流程测试说明

本目录包含用于测试调度服务器分配任务给electron node，执行任务链并返回翻译后的音频的测试脚本和测试音频文件。

## 测试文件

- `chinese.wav` - 中文测试音频
- `english.wav` - 英文测试音频
- `test_translation_pipeline.py` - 翻译流程测试脚本

## 前置条件

### 1. 安装依赖

测试脚本需要 Python 3.7+ 和 `websockets` 库：

```bash
pip install websockets
```

### 2. 启动服务

在进行测试之前，需要确保以下服务已启动：

1. **调度服务器 (Scheduler)**
   ```powershell
   .\scripts\start_central_server.ps1 --scheduler
   ```
   或
   ```bash
   cd central_server/scheduler
   cargo run --release
   ```
   默认地址: `ws://localhost:5010/ws/session`

2. **Electron Node** 
   ```powershell
   .\scripts\start_electron_node.ps1
   ```
   确保节点已连接到调度服务器（通过 `ws://localhost:5010/ws/node`）

3. **Python 服务**（如果使用HTTP服务）
   - NMT 服务（端口 5008）
   - TTS 服务（端口 5006）

4. **Rust 推理服务**（由 Electron Node 自动启动）
   - 推理服务（端口 5009）

## 使用方法

### 基本用法

测试中文音频翻译为英文：
```bash
cd electron_node/services/test
python test_translation_pipeline.py --audio chinese.wav --src-lang zh --tgt-lang en
```

测试英文音频翻译为中文：
```bash
python test_translation_pipeline.py --audio english.wav --src-lang en --tgt-lang zh
```

### 高级用法

#### 指定调度服务器地址
```bash
python test_translation_pipeline.py \
  --audio chinese.wav \
  --src-lang zh \
  --tgt-lang en \
  --scheduler-url ws://192.168.1.100:5010/ws/session
```

#### 指定方言
```bash
python test_translation_pipeline.py \
  --audio chinese.wav \
  --src-lang zh \
  --tgt-lang en \
  --dialect "zh-CN"
```

#### 指定功能标志（features）
```bash
python test_translation_pipeline.py \
  --audio chinese.wav \
  --src-lang zh \
  --tgt-lang en \
  --features '{"voice_cloning": true}'
```

### 完整参数说明

```
--audio         音频文件路径（相对于脚本目录）
--src-lang      源语言代码（如: zh, en, ja, ko）
--tgt-lang      目标语言代码（如: zh, en, ja, ko）
--scheduler-url 调度服务器WebSocket地址（默认: ws://localhost:5010/ws/session）
--dialect       方言（可选）
--features      功能标志（JSON格式，可选）
```

## 测试流程

1. **创建会话**
   - 连接到调度服务器
   - 发送 `session_init` 消息
   - 接收 `session_init_ack` 确认，获取 `session_id`

2. **发送音频**
   - 加载音频文件
   - 将音频数据编码为 base64
   - 发送 `utterance` 消息到调度服务器

3. **等待处理**
   - 调度服务器分配任务给 electron node
   - electron node 执行任务链：
     - ASR（语音识别）
     - NMT（机器翻译）
     - TTS（语音合成）
   - 可能收到 `asr_partial` 消息（部分ASR结果）

4. **接收结果**
   - 接收 `translation_result` 消息
   - 包含：
     - `text_asr`: 识别的源文本
     - `text_translated`: 翻译后的文本
     - `tts_audio`: 翻译后的音频（base64编码）
   - 自动保存TTS音频到 `output_translated_audio.pcm`

## 输出说明

测试脚本会输出以下信息：

- 会话创建状态
- 分配的节点ID
- 追踪ID（用于全链路追踪）
- ASR部分结果（如果启用流式ASR）
- 最终翻译结果：
  - 源文本
  - 翻译文本
  - TTS音频大小
  - 处理时间

## 故障排除

### 连接失败

如果无法连接到调度服务器：

1. 检查调度服务器是否已启动
   ```powershell
   # 检查端口5010是否在监听
   netstat -an | findstr :5010
   ```

2. 检查防火墙设置

3. 确认调度服务器地址是否正确

### 节点未分配

如果会话创建成功但没有分配节点：

1. 检查 electron node 是否已启动并连接到调度服务器
2. 查看调度服务器日志，确认节点注册状态
3. 确认节点具备所需的模型能力

### 任务处理失败

如果任务处理失败：

1. 查看 electron node 日志
2. 查看调度服务器日志
3. 检查推理服务是否正常运行
4. 检查模型文件是否存在
5. 检查 Python 服务（NMT、TTS）是否正常运行

### 超时错误

如果30秒内未收到翻译结果：

1. 检查音频文件是否过大
2. 检查服务是否正常运行
3. 增加超时时间（修改脚本中的 `timeout=30.0`）

## 示例输出

```
============================================================
翻译流程测试
============================================================
调度服务器: ws://localhost:5010/ws/session
音频文件: chinese.wav
翻译方向: zh -> en
============================================================

✓ 音频文件已加载: chinese.wav
  采样率: 16000 Hz
  声道数: 1
  采样宽度: 2 bytes
  音频数据大小: 32000 bytes

✓ 已发送 session_init: zh -> en
✓ 会话已创建: session_id=sess-abc123
  分配的节点: node-xyz789
  追踪ID: trace-123456

✓ 已发送 utterance (索引: 0)
  音频大小: 32000 bytes (42667 base64字符)

等待翻译结果...

  [ASR部分] 你好 (is_final: False)
  [ASR部分] 你好世界 (is_final: True)

✓ 收到翻译结果 #1
  任务ID: job-123
  源文本 (ASR): 你好世界
  翻译文本: Hello World
  TTS音频格式: pcm16
  TTS音频大小: 24576 bytes
  处理时间: 1234 ms
  追踪ID: trace-123456
  ✓ TTS音频已保存到: output_translated_audio.pcm

============================================================
✓ 测试完成!
============================================================
```

## 相关文档

- [Electron Node 项目完整性报告](../PROJECT_COMPLETENESS.md)
- [节点推理服务测试](../../services/node-inference/tests/README.md)
- [服务热插拔验证文档](../docs/SERVICE_HOT_PLUG_VERIFICATION.md)

