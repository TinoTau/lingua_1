# 方案A 实施 Task List（JIRA 可直接拆分）

> 目标：Web 端按 **Opus packet 定界（length-prefix framing）** 发送；Node/节点端按 packet 直接解码为 PCM16（16kHz/mono），并以低抖动方式喂给 ASR。

## 1. 关键假设（全体对齐）
- 音频参数：**16kHz / mono / 20ms**（推荐）  
- WebSocket：音频使用 **binary frame**  
- 传输格式：`uint16_le packet_len` + `packet_bytes` (+ 可选 `uint32_le seq`)  
- Node 端：解码后输出 **PCM16 little-endian**（int16）

---

## 2. Epic 结构
- **EPIC-A1：协议/传输改造（Web ↔ Node）**
- **EPIC-A2：节点端解码与缓冲（Node）**
- **EPIC-A3：稳定性、降级与可观测性（Web + Node）**
- **EPIC-A4：性能与体验验收（QA/Perf）**

---

## 3. Task 明细（建议按团队拆分）

### EPIC-A1：协议/传输改造（Web ↔ Node）

| Key | Title | Owner | Priority | Estimate | Deliverable / 验收 |
|---|---|---|---|---:|---|
| A1-1 | 定义并冻结 Audio WS Binary 协议（len-prefix + 可选 seq） | Web+Node | P0 | 0.5d | 产出协议说明（字段、字节序、示例包）并评审通过 |
| A1-2 | Web 端 Opus 编码输出改为 **按 packet 发送**（每 packet 前加 uint16_le 长度） | Web | P0 | 1.0d | Node 端可稳定解析 packet_len 与 packet_payload |
| A1-3 | Web 端增加 seq（uint32_le）与 timestamp（可选） | Web | P1 | 0.5d | Node 端日志可看到连续 seq；便于丢包/乱序诊断 |
| A1-4 | Web 端回退模式：支持切换 PCM16（调试/降级） | Web | P1 | 1.0d | Node 端可请求切换；Web 可动态切换编码路径 |
| A1-5 | Web 端协议一致性自检（采样率/声道/帧长） | Web | P1 | 0.5d | 参数不匹配时明确报错，不 silent fail |

---

### EPIC-A2：节点端解码与缓冲（Node）

| Key | Title | Owner | Priority | Estimate | Deliverable / 验收 |
|---|---|---|---|---:|---|
| A2-1 | Node 端 WS 音频接收模块：binary frame 读取 + len-prefix parser | Node | P0 | 1.0d | 给定模拟数据流，100% 正确切包 |
| A2-2 | Opus decoder 常驻实例（stateful reuse），输出 PCM16 | Node | P0 | 1.0d | 连续 10 分钟音频无间歇解码失败；输出 PCM 长度合理 |
| A2-3 | 实现 RingBuffer/JitterBuffer（目标 40–60ms） | Node | P0 | 1.0d | 抖动下无明显卡顿；buffer 高/低水位策略生效 |
| A2-4 | 解码流水线与 ASR 解耦（队列/线程模型） | Node | P0 | 1.0d | ASR 阻塞不影响 WS 接收；无无限堆积 |
| A2-5 | 统一 PCM 数据接口（bytes/int16），适配现有 ASR 输入 | Node | P0 | 0.5d | ASR 模块无需理解 Opus；只消费 PCM16 |
| A2-6 | 解码失败快速检测（连续 N 次失败、0 samples、len 异常） | Node | P0 | 0.5d | 触发降级/重建 decoder；日志可定位原因 |
| A2-7 | 资源与并发策略：每会话一个 decoder + buffer；限制最大堆积 | Node | P1 | 0.5d | 多会话压测不 OOM；CPU 占用稳定 |

---

### EPIC-A3：稳定性、降级与可观测性（Web + Node）

| Key | Title | Owner | Priority | Estimate | Deliverable / 验收 |
|---|---|---|---|---:|---|
| A3-1 | Node 端结构化日志：seq、len、decode_samples、buffer_level、错误码 | Node | P0 | 0.5d | 关键字段齐全；可 grep/可聚合 |
| A3-2 | Node 端指标：decode_fail_rate、avg_buffer_ms、p95_decode_time | Node | P1 | 1.0d | 输出到现有监控/日志系统（或本地 CSV） |
| A3-3 | 协议错误可视化：参数不一致/乱序/超长包明确报错 | Web+Node | P1 | 0.5d | 前端可提示“网络/音频配置问题” |
| A3-4 | 降级策略闭环：Node 端请求 Web 切 PCM16；或重建 Opus encoder | Web+Node | P1 | 1.0d | 人工造故障可恢复（<3s） |

---

### EPIC-A4：性能与体验验收（QA/Perf）

| Key | Title | Owner | Priority | Estimate | Deliverable / 验收 |
|---|---|---|---|---:|---|
| A4-1 | 端到端延迟基线测试（节点端新增延迟） | QA/Perf | P0 | 1.0d | 节点端新增延迟 ≤ 30ms（目标） |
| A4-2 | 抖动/丢包模拟（网络工具或注入器）并验证体验 | QA/Perf | P0 | 1.0d | 无持续卡顿；短时抖动可平滑 |
| A4-3 | 长稳测试（≥10分钟）与内存/CPU Profiling | QA/Perf | P0 | 1.0d | 无内存泄漏；CPU 占用符合预期 |
| A4-4 | 回归：多会话并发与资源上限验证 | QA/Perf | P1 | 1.0d | 不出现堆积/崩溃；降级策略可用 |

---

## 4. “完成定义”（DoD）建议
- P0：必须包含单元测试/集成测试、可复现实验脚本、日志字段齐全
- 所有协议字段写入开发文档并冻结（版本号/向后兼容策略明确：本次为“无兼容历史”可直接替换）
- 关键验收数据（延迟、失败率、buffer_level）能从日志/指标中直接读取

