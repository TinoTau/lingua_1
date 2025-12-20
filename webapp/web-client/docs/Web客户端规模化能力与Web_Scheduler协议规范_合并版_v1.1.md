# Web 客户端规模化能力与 Web ↔ Scheduler 协议规范（合并版）v1.1

> 适用对象：Web 客户端开发团队、Scheduler/Dispatcher 开发团队、架构评审与运维  
> 目标规模：10 万级 Web 用户并发  
> 本文档合并并取代以下两份文档：  
> - Web 客户端规模化能力要求与验收标准 v1.0  
> - Web ↔ Scheduler 协议约束与演进路线 v1.0  

---

## 第一部分：Web 客户端规模化能力要求与验收标准

### 1. 文档目的
明确 Web 客户端在大规模用户场景下必须具备的工程能力与验收标准，
确保在用户规模增长至 10 万级别时，系统仍具备可用性、可运维性与可扩展性。

---

### 2. Web 客户端架构定位

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

### 3. Web 客户端硬性能力要求（Hard Requirements）

#### R1. 静态资源交付
- 支持 CDN / 对象存储托管
- 资源文件带版本号或 hash
- 支持灰度发布与快速回滚

**验收**：新旧版本可并存，回滚无需清缓存。

---

#### R2. WebSocket 连接稳定性
- 自动重连
- 心跳机制
- 重连后重新初始化 session

**验收**：断网恢复后可继续使用，无音频风暴。

---

#### R3. 客户端背压与降级
- 服务端返回 BUSY / PAUSE / SLOW_DOWN 时：
  - 降低发送频率
  - 或暂停发送
  - 或提前 finalize

**验收**：服务端限流时客户端不持续高速发包。

---

#### R4. 静音过滤可配置
- 默认 RMS / 能量阈值
- 支持阈值、窗口配置
- 支持关闭（调试）

**验收**：配置切换行为符合预期。

---

#### R5. 音频上行协议升级预留
- 支持 WebSocket Binary Frame
- 音频消息必须包含：
  - audio_format
  - sequence_no / chunk_id
- 不强依赖 base64 + JSON

---

#### R6. 协议版本协商
- 客户端携带 client_version
- 支持兼容期

---

#### R7. 客户端性能与模型约束
- 若引入 VAD / 去噪模型：
  - 必须可降级
  - 必须限制 CPU 占用
- 低端设备可运行

---

#### R8. 客户端可观测性
- 上报匿名指标：
  - 连接成功率
  - 重连次数
  - 音频发送比例
  - 性能指标（如有）

---

## 第二部分：Web ↔ Scheduler 协议约束与演进路线

### 4. 协议设计原则
- 幂等
- 向前兼容
- 灰度友好
- 客户端异常不放大为系统性风险

---

### 5. 连接初始化（Session Init）

**必须字段：**
- client_version
- audio_format
- sample_rate
- channel_count
- features（bitmask）

**约束：**
- Scheduler 返回协商结果
- 不兼容需显式拒绝

---

### 6. 音频数据帧规范

#### 当前兼容模式
- JSON + base64

#### 必须预留
- Binary Frame
- Header 字段：
  - chunk_id / sequence_no
  - timestamp
  - audio_format

---

### 7. 幂等与乱序容错
- Scheduler 必须容忍：
  - 重复 chunk
  - 乱序 chunk
  - 重连后的重复发送
- 客户端不得假设 exactly-once

---

### 8. Backpressure 协议
- Scheduler 可返回：
  - BUSY
  - PAUSE
  - SLOW_DOWN
- 客户端必须执行降级

---

### 9. 协议演进路线

**Phase 1**
- JSON + base64
- RMS 静音过滤
- 幂等字段齐全

**Phase 2**
- Binary Frame
- Opus 编码

**Phase 3**
- 多路音频 / 多会话（如需要）

---

## 10. 最终结论
Web 客户端规模化能力与 Web ↔ Scheduler 协议规范是系统支撑 10 万级用户的基础设施。
任何未明确定义、不可验收或隐式依赖实现细节的行为，
都会在大规模场景下被放大为系统性风险。
