
# 节点端实时音频解码方案（方案 A）
## 基于 Opus Packet 定界传输与节点端直接解码

---

## 1. 文档目的

本文档用于定义并冻结 **方案 A：节点端实时音频解码方案** 的技术设计，
作为开发、评审、实施与验收的唯一权威依据。

目标：
- 最低端到端延迟
- 稳定、确定性的解码行为
- 不依赖外部系统组件（开包即用）
- 可扩展、可维护、可观测

---

## 2. 问题背景

当前系统问题本质为：

- Web 端发送 **raw Opus 字节流**
- 未携带 Opus packet 边界信息
- 节点端只能“猜测”帧边界

直接后果：
- 解码成功率不稳定（0 bytes / 间歇失败）
- 必须缓存等待 → 延迟与抖动
- 用户体验不可控

---

## 3. 方案选择结论

选择 **方案 A**：

> **在传输协议层明确 Opus packet 边界，节点端直接解码 Opus packet 为 PCM16。**

该方案在以下维度综合最优：

| 维度 | 表现 |
|----|----|
| 实时延迟 | ⭐⭐⭐⭐⭐ |
| 稳定性 | ⭐⭐⭐⭐⭐ |
| 用户体验 | ⭐⭐⭐⭐⭐ |
| 工程复杂度 | ⭐⭐⭐⭐ |
| 可维护性 | ⭐⭐⭐⭐ |

---

## 4. 总体架构

```
Web Client
 └─ Opus Encoder
     └─ Opus Packet (20ms)
         └─ length‑prefixed framing
             └─ WebSocket Binary Frame
                 ↓
Node Client
 └─ Packet Parser
     └─ Opus Decoder (stateful)
         └─ PCM16 (16kHz / mono)
             └─ Ring / Jitter Buffer
                 └─ ASR / 下游模块
```

---

## 5. 关键设计原则

1. **协议确定性优先**
2. packet 到达即可解码
3. 解码器常驻复用
4. 不 silent fail，必须可观测
5. 延迟优先于完美音质

---

## 6. 音频协议定义（Web → Node）

### 6.1 传输通道
- WebSocket
- **Binary Frame only**

### 6.2 单 Packet 帧结构

```
| Field        | Size       | Description |
|-------------|------------|-------------|
| packet_len  | uint16_le  | Opus packet 字节长度 |
| packet_data | N bytes    | 单个完整 Opus packet |
| seq (可选)  | uint32_le  | 序号（调试/诊断） |
```

### 6.3 音频参数（强制）
- Sample Rate: 16,000 Hz
- Channels: 1 (mono)
- Frame Duration: 20 ms
- PCM Format: int16 little-endian

---

## 7. 节点端解码设计

### 7.1 Decoder 生命周期
- 每个会话一个 OpusDecoder 实例
- 不允许 per‑packet 重建

### 7.2 解码流程

1. 读取 binary frame
2. 解析 packet_len
3. 读取完整 packet
4. Opus decode → PCM16
5. 写入 jitter buffer

---

## 8. Buffer 与实时策略

### 8.1 Buffer 目标
- 抖动平滑
- 不增加可感知延迟

### 8.2 推荐参数
- 目标缓存：40–60 ms
- 低水位：补静音
- 高水位：丢弃最旧 PCM

---

## 9. 错误处理与降级

### 9.1 错误检测条件
- 连续解码失败 ≥ 3
- packet_len 异常
- 解码输出 0 samples

### 9.2 降级策略
- 请求 Web 切换 PCM16
- 或重建 Opus encoder / decoder

---

## 10. 性能指标（验收）

| 指标 | 目标 |
|----|----|
| 节点端新增延迟 | ≤ 30 ms |
| 解码失败率 | ≈ 0 |
| 连续运行 | ≥ 10 分钟 |
| CPU 占用 | 低且稳定 |

---

## 11. 与其他方案关系

| 方案 | 定位 |
|----|----|
| 方案 A | 主路径（本方案） |
| 方案 B（Ogg+ffmpeg） | 可选回退 |
| 方案 C（opusenc） | 最终兜底 |

---

## 12. 结论

方案 A 的核心价值在于：

> **通过协议定界消除不确定性，使实时音频解码成为可工程化、可优化、可规模化的能力。**

该方案是系统迈向高性能实时语音体验的关键基础设施。

