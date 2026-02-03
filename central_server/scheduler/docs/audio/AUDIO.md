# 音频处理与 Buffer

**状态**: 当前实现

## 一、调度服务器端

- Scheduler 接收客户端音频消息，按会话维护；在 Finalize 时创建 Job，将对应音频（或引用）随 Job 发往节点。
- 音频缓冲与分段逻辑主要在**节点端**（AudioAggregator、Finalize 触发）；Scheduler 侧有 AudioBufferManager 等用于会话内音频暂存与 Job 关联。

**代码**: `managers/audio_buffer.rs`、`websocket/session_message_handler/audio.rs`、`websocket/session_actor/`。

## 二、节点端（概要）

- 节点收到 Job 后解码音频（如 Opus → PCM16），送入 AudioAggregator。
- **AudioAggregator**：根据 Finalize 类型（MaxDuration / 手动 / Timeout）决定何时将缓冲区的音频送给 ASR、何时清空或合并。
- MaxDuration：按最大时长切片，前 N 秒立即送 ASR，剩余缓存；手动/Timeout：立即处理当前缓冲区并送 ASR。

## 三、与 Finalize 的关系

- 音频分段与 Buffer 清除由 Finalize 类型驱动；详见 [FINALIZE.md](../finalize/FINALIZE.md)。

## 四、代码对照

| 端 | 模块 |
|----|------|
| Scheduler | `managers/audio_buffer.rs`、`websocket/session_message_handler/`、`session_actor/` |
| 节点 | AudioAggregator、Pipeline 与 ASR 步骤（见节点端文档） |
