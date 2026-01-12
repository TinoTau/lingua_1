# Web 客户端规模化能力与协议规范

> 目标规模：10 万级 Web 用户并发

## 文档目的

明确 Web 客户端在大规模用户场景下必须具备的工程能力与验收标准，确保在用户规模增长至 10 万级别时，系统仍具备可用性、可运维性与可扩展性。

---

## Web 客户端架构定位

**Web 客户端负责：**
- 音频采集与本地预处理（静音过滤 / VAD）
- WebSocket 连接管理与重连
- 音频与结果数据的上行 / 下行
- UI 展示与本地状态机

**Web 客户端不负责：**
- 会话全局一致性
- 任务调度与算力分配
- 模型推理或训练

---

## 硬性能力要求（Hard Requirements）

### R1. 静态资源交付
- 支持 CDN / 对象存储托管
- 资源文件带版本号或 hash
- 支持灰度发布与快速回滚

**验收**：新旧版本可并存，回滚无需清缓存。

### R2. WebSocket 连接稳定性
- 自动重连
- 心跳机制
- 重连后重新初始化 session

**验收**：断网恢复后可继续使用，无音频风暴。

### R3. 客户端背压与降级 ✅
- 服务端返回 BUSY / PAUSE / SLOW_DOWN 时：
  - 降低发送频率
  - 或暂停发送
  - 或提前 finalize

**验收**：服务端限流时客户端不持续高速发包。

**实现状态**: ✅ 已实现（见 [Phase 3 实现文档](./PHASE3_IMPLEMENTATION.md)）

### R4. 静音过滤可配置 ✅
- 默认 RMS / 能量阈值
- 支持阈值、窗口配置
- 支持关闭（调试）
- 支持 Attack/Release 平滑逻辑

**验收**：配置切换行为符合预期。

**实现状态**: ✅ 已实现

### R5. 音频上行协议升级预留 ✅
- 支持 WebSocket Binary Frame
- 音频消息必须包含：
  - audio_format
  - sequence_no / chunk_id
- 不强依赖 base64 + JSON

**实现状态**: ✅ 已实现（见 [Phase 2 实现文档](./PHASE2_IMPLEMENTATION.md)）

### R6. 协议版本协商 ✅
- 客户端携带 client_version
- 支持兼容期

**实现状态**: ✅ 已实现

### R7. 客户端性能与模型约束
- 若引入 VAD / 去噪模型：
  - 必须可降级
  - 必须限制 CPU 占用
- 低端设备可运行

### R8. 客户端可观测性
- 上报匿名指标：
  - 连接成功率
  - 重连次数
  - 音频发送比例
  - 性能指标（如有）

---

## 协议设计原则

- 幂等
- 向前兼容
- 灰度友好
- 客户端异常不放大为系统性风险

---

## 连接初始化（Session Init）

**必须字段：**
- client_version ✅
- features（bitmask）✅
- trace_id ✅（Phase 3 新增）
- tenant_id ✅（Phase 3 新增，可选）

**注意**: `audio_format`, `sample_rate`, `channel_count` 已在 Phase 3 中从 SessionInit 移除，只在 `Utterance` 消息中使用。

---

## 音频数据帧规范

### 当前兼容模式
- JSON + base64 ✅

### 已实现
- Binary Frame ✅（Phase 2）
- Header 字段：
  - chunk_id / sequence_no ✅
  - timestamp ✅
  - audio_format ✅

---

## 幂等与乱序容错

- Scheduler 必须容忍：
  - 重复 chunk
  - 乱序 chunk
  - 重连后的重复发送
- 客户端不得假设 exactly-once

---

## Backpressure 协议 ✅

- Scheduler 可返回：
  - BUSY ✅
  - PAUSE ✅
  - SLOW_DOWN ✅
- 客户端必须执行降级 ✅

**实现状态**: ✅ 已实现（见 [Phase 3 实现文档](./PHASE3_IMPLEMENTATION.md)）

---

## 协议演进路线

### Phase 1 ✅
- JSON + base64 ✅
- RMS 静音过滤 ✅
- 幂等字段齐全 ✅
- 背压机制 ✅

### Phase 2 ✅
- Binary Frame ✅
- Opus 编码框架 ✅

### Phase 3 ✅
- Opus 编码集成 ✅
- Session Init 协议增强 ✅
- 背压机制完善 ✅

### Phase 4（未来）
- 多路音频 / 多会话
- 更复杂的客户端处理策略
- 针对弱网/低端设备的专项优化

---

## 开发准入与阶段验收

### Phase 1 上线 / 联调阻断项 ✅

#### Blocker 1：客户端背压闭环（R3）✅
- ✅ 服务端可发送 BUSY / PAUSE / SLOW_DOWN
- ✅ 客户端能降低发送速率、暂停发送、在恢复条件满足后继续
- ✅ 压测下服务端 backlog 不持续上升

#### Blocker 2：静音过滤配置化 + 平滑（R4）✅
- ✅ enabled / threshold / window_ms 可配置
- ✅ 支持关闭（调试）
- ✅ 已加入迟滞 / 平滑逻辑，避免频繁启停

#### Blocker 3：Session Init 字段补齐 ✅
- ✅ client_version / features
- ✅ trace_id / tenant_id（Phase 3）
- ✅ Scheduler 返回协商结果并记录日志

---

## 相关文档

- [Phase 2 实现文档](./PHASE2_IMPLEMENTATION.md) - Binary Frame 和 Opus 框架
- [Phase 3 实现文档](./PHASE3_IMPLEMENTATION.md) - 背压机制和 Opus 集成
- [规模化改造总结](./SCALABILITY_REFACTOR_SUMMARY.md) - Phase 1 改造完成情况
- [规模化方案评估](./SCALABILITY_PLAN_EVALUATION.md) - 可行性评估

---

## 总结

Web 客户端规模化能力与协议规范是系统支撑 10 万级用户的基础设施。所有 Phase 1-3 的阻断项已全部完成并测试通过，系统已具备规模化能力。

