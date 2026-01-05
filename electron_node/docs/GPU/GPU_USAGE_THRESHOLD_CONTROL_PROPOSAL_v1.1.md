# GPU 仲裁器 GPU 使用率控制 —— 修订版技术方案（v1.1）

> 本文档在《GPU仲裁器增加GPU使用率控制功能 - 技术方案建议》基础上进行**补充修订**，目标是在**不降低翻译效率与实时性**的前提下，
> 解决调度服务器因 GPU 使用率阈值（85%）拒单的问题，并引入**可配置滞回线 + 任务感知的动态调节机制**。

---

## 1. 修订目标

### 1.1 解决的问题
- 单个 GPU 任务（如 ASR 长音频）可将 GPU 使用率推至 95%+
- 调度服务器基于 **瞬时 GPU usage** 拒绝新任务
- GPU 仲裁器虽已互斥，但无法影响 scheduler 的 admission 决策

### 1.2 修订原则
- **不在 acquire 热路径中同步调用 getGpuUsage**
- **GPU 使用率阈值不硬编码，全部配置化**
- **允许根据实际任务动态调整滞回线**
- **低优任务优先牺牲，高优任务受保护**
- **不增加 ASR / NMT / TTS 的推理次数**

---

## 2. 总体方案概览（Aʼ 方案）

> 修订后采用：  
> **“监控线程采样 + 缓存判定 + 可配置滞回线 + 任务感知动态调整”**

### 核心思想
- GPU 使用率仅由**后台监控线程**周期采样
- `acquire()` 只读取 **usage cache（O(1)）**
- 使用 **高水位 / 低水位（hysteresis）** 控制 admission
- ASR 在收到长音频时，向 GPU 仲裁器提供 **任务规模提示**，动态调整滞回配置

---

## 3. GPU 使用率采样与缓存机制

### 3.1 采样线程
- 采样周期：`500–1000ms`
- 数据来源：NVML / nvidia-smi（已有实现）
- 写入缓存：
```ts
interface GpuUsageCache {
  usagePercent: number;
  sampledAt: number;
}
```

### 3.2 acquire 行为（只读缓存）
```ts
const usage = gpuUsageCache[gpuKey];
if (now - usage.sampledAt > usageCacheTtlMs) {
  // 视为不可靠数据，走安全策略
}
```

### 默认配置
```json
{
  "usageSampleIntervalMs": 800,
  "usageCacheTtlMs": 2000
}
```

---

## 4. 可配置滞回线（Hysteresis）设计

### 4.1 滞回状态机
```ts
enum GpuAdmissionState {
  NORMAL,
  HIGH_PRESSURE
}
```

### 4.2 滞回配置（基础）
```json
{
  "gpuUsageHighWater": 85,
  "gpuUsageLowWater": 78
}
```

### 4.3 状态切换规则
- `NORMAL → HIGH_PRESSURE`：`usage >= highWater`
- `HIGH_PRESSURE → NORMAL`：`usage <= lowWater`

> 禁止在代码中写死阈值，必须通过配置或运行时更新。

---

## 5. acquire 行为修订（按任务类型）

### 5.1 高优任务（ASR / NMT / TTS）
- `HIGH_PRESSURE` 状态：
  - 允许进入等待队列
  - 严格受 `maxWaitMs` 约束
- 超时返回：
```json
{ "status": "TIMEOUT", "reason": "GPU_USAGE_HIGH" }
```

### 5.2 低优任务（Semantic Repair）
- `HIGH_PRESSURE` 状态：
  - **直接 SKIP / FALLBACK**
  - **不进入队列**

---

## 6. ASR 任务感知的动态滞回调整（新增）

### 6.1 设计动机
- ASR 长音频（如 10–20s）是 GPU usage 拉高的主要来源
- 在该任务期间继续严格限制 admission，会导致 scheduler 长时间拒单

### 6.2 ASR → GPU 仲裁器通知接口
```ts
interface AsrGpuHint {
  estimatedAudioMs: number;
  estimatedGpuHoldMs: number;
}
```

### 6.3 动态调整策略（示例）
当检测到：
- `estimatedAudioMs >= longAudioThresholdMs`（如 8000ms）

GPU 仲裁器可临时调整：
```json
{
  "gpuUsageHighWater": 92,
  "gpuUsageLowWater": 85,
  "adjustmentTtlMs": 15000
}
```

规则：
- 仅影响 **当前 gpuKey**
- TTL 到期后自动回滚至基础配置

---

## 7. admission 兜底规则

即使 `usage >= highWater`，若：
- 当前无 active lease
- 等待队列为空

则允许：
- **最高优任务（ASR）尝试 acquire**

---

## 8. 与调度服务器的协同

### 8.1 新增节点状态上报
```json
{
  "gpu_admission_state": "NORMAL | HIGH_PRESSURE",
  "gpu_usage": 91.2,
  "gpu_usage_cache_age_ms": 300,
  "gpu_queue_len": 2
}
```

---

## 9. 配置汇总（推荐默认）
```json
{
  "gpuUsage": {
    "sampleIntervalMs": 800,
    "cacheTtlMs": 2000,
    "baseHighWater": 85,
    "baseLowWater": 78,
    "dynamicAdjustment": {
      "enabled": true,
      "longAudioThresholdMs": 8000,
      "highWaterBoost": 7,
      "lowWaterBoost": 7,
      "adjustmentTtlMs": 15000
    }
  }
}
```

---

## 10. 实施阶段建议

### Phase 1
- usage cache + hysteresis
- Repair 不入队
- acquire 只读缓存

### Phase 2
- ASR 任务规模提示
- 动态滞回调整

---

## 11. 结论

该修订方案：
- ✅ 解决 scheduler 因 GPU usage 拒单
- ✅ 滞回线与策略完全配置化
- ✅ 翻译实时性不受影响
- ✅ 为后续预测型调度预留接口

**建议作为 GPU 仲裁器 GPU 使用率控制 v1.1 正式方案执行。**
