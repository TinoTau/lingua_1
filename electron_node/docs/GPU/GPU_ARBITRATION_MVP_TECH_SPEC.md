# GPU 仲裁（Arbitration）MVP 技术方案（交付开发部门确认）

## 0. 目标与非目标

### 0.1 目标
在 **Node 端单机多服务共享 GPU**（ASR / NMT / TTS / Semantic Repair 等）的情况下，提供一个**最小但可靠**的 GPU 仲裁模块，解决以下问题：

- 避免多服务同时抢占 GPU 导致 **P95 延迟长尾、OOM、偶发失败、抖动**
- 为“可丢弃”任务（如 Semantic Repair）提供 **忙时降级（PASS/CPU fallback）**
- 通过统一接口实现 **互斥 / 限流 / 队列上限 / 超时**
- 输出可观测性：等待时间、占用时间、丢弃率、超时率、OOM 事件统计

### 0.2 非目标（本轮不做）
- 不做跨机器 / 集群级 GPU 调度
- 不做抢占式调度（preemption）与显存分片管理（MIG/MPS）
- 不做按租户计费与配额系统
- 不强依赖特定推理框架（torch/vLLM/onnxruntime/whisper 等）

---

## 1. 适用范围与核心假设

### 1.1 适用范围
- Node 端存在多个 GPU 推理工作负载：
  - ASR（faster-whisper / whisper）
  - NMT（Marian / M2M100 / NLLB）
  - TTS（Vocoder/Acoustic）
  - Semantic Repair（LLM INT4/GPTQ）
- 多个服务可能在同一 GPU 上运行（或同进程/多进程）

### 1.2 核心假设
- 业务更关注 **实时稳定性** 而非极致吞吐
- 允许对部分低优先级任务做：
  - 超时回退
  - 忙时跳过（PASS）
  - 走 CPU 兜底
- 可接受：同一块 GPU 上的重推理任务串行化（MVP）

---

## 2. 设计总览

### 2.1 组件划分
新增模块：`GpuArbiter`（GPU 仲裁器）  
对外提供一个统一的“GPU 资源租约（lease）”接口，所有 GPU 重推理必须通过它获取许可。

```
[JobProcessor / Pipeline]
   ├─ ASR Stage ──┐
   ├─ NMT Stage ──┼──>  [GpuArbiter]  ──>  [GPU]
   ├─ TTS Stage ──┤
   └─ Repair Stage┘
```

### 2.2 MVP 策略
- **同一 GPU 同时只允许一个“重推理任务”进入关键区**（互斥锁 + 可选队列）
- 任务按“优先级”与“可丢弃性”进行区分：
  - 高优：ASR / NMT / TTS（通常不可丢弃）
  - 低优：Semantic Repair（可丢弃，可回退）
- 提供：
  - `max_wait_ms`：最大等待时间
  - `queue_limit`：队列长度上限
  - `busy_policy`：忙时策略（WAIT / SKIP / FALLBACK_CPU）

---

## 3. 数据结构与接口契约

### 3.1 术语
- **GPU Key**：GPU 设备标识（单卡可用固定 `gpu:0`，多卡为 `gpu:0, gpu:1`）
- **Lease**：GPU 使用租约（持有期间可执行推理）
- **Critical Section**：GPU 重推理关键区（必须持有 lease 才能进入）

### 3.2 Task 类型（建议枚举）
```ts
type GpuTaskType = "ASR" | "NMT" | "TTS" | "SEMANTIC_REPAIR" | "OTHER";
```

### 3.3 请求参数
```ts
interface GpuLeaseRequest {
  gpuKey: string;                 // e.g. "gpu:0"
  taskType: GpuTaskType;
  priority: number;               // 0..100 (higher = more important)
  maxWaitMs: number;              // hard wait limit
  holdMaxMs: number;              // safety cap for execution (watchdog)
  queueLimit: number;             // maximum pending requests
  busyPolicy: "WAIT" | "SKIP" | "FALLBACK_CPU";
  trace: {
    jobId?: string;
    sessionId?: string;
    utteranceIndex?: number;
    stage?: string;
  };
}
```

### 3.4 返回结果
```ts
type GpuLeaseAcquireResult =
  | { status: "ACQUIRED"; leaseId: string; acquiredAt: number; queueWaitMs: number; }
  | { status: "SKIPPED"; reason: "GPU_BUSY" | "QUEUE_FULL" | "TIMEOUT"; }
  | { status: "FALLBACK_CPU"; reason: "GPU_BUSY" | "QUEUE_FULL" | "TIMEOUT"; };
```

### 3.5 Lease 生命周期
```ts
interface GpuLease {
  leaseId: string;
  gpuKey: string;
  taskType: GpuTaskType;
  acquiredAt: number;
  release(): void;
}
```

### 3.6 核心 API（建议）
- `acquire(request: GpuLeaseRequest): Promise<GpuLeaseAcquireResult>`
- `release(leaseId: string): void`（通常由 lease.release() 调用）
- `snapshot(): GpuArbiterSnapshot`（用于监控/调试）
- `setConfig(gpuKey, configPatch)`（热更新，非必须）

---

## 4. 调度策略（MVP）

### 4.1 互斥锁模型
- 每个 `gpuKey` 对应一把互斥锁（Mutex/Semaphore(1)）
- 进入 GPU 关键区前必须 `acquire`
- 推理完成后必须 `release`

### 4.2 队列策略
- 同一 `gpuKey` 有一个等待队列（优先级队列）
- 入队前检查 `queueLimit`，超过则按 `busyPolicy` 返回 SKIP/FALLBACK_CPU
- 等待超过 `maxWaitMs` 自动超时移除

### 4.3 优先级（推荐但可简化）
- MVP 可先实现：
  - 高优任务 FIFO（ASR/NMT/TTS）
  - 低优任务只在 GPU 空闲时进入；否则 SKIP/FALLBACK
- 若实现优先级队列：
  - priority 高的先出队
  - 同 priority 按 FIFO

### 4.4 Watchdog（必须）
- 防止异常导致锁不释放：
  - 持有 lease 超过 `holdMaxMs` 记录告警
  - 可选：强制释放（谨慎，默认只告警）

---

## 5. 与现有链路的集成点（建议最小改动）

### 5.1 集成原则
- **只包裹重推理调用**，不要把非 GPU 操作包含进 lease
- “可丢弃任务”应使用短 `maxWaitMs`，并配置 SKIP/FALLBACK_CPU

### 5.2 ASR Stage（示例）
- 在调用 faster-whisper GPU 推理前：
  - `acquire(priority=90, maxWaitMs=3000, busyPolicy=WAIT)`
- 推理后立即 `release`

### 5.3 NMT Stage（示例）
- `acquire(priority=80, maxWaitMs=3000, busyPolicy=WAIT)`
- 若你们已有 NMT Repair（兜底）：
  - Repair 候选翻译属于“重任务”，也必须走 `GpuArbiter`
  - 但建议默认关闭/极少触发

### 5.4 TTS Stage（示例）
- 若 TTS 在 GPU 上：
  - `acquire(priority=70, maxWaitMs=2000, busyPolicy=WAIT)`

### 5.5 Semantic Repair Stage（关键）
- 建议默认策略：
  - `priority=20`
  - `maxWaitMs=200~600ms`
  - `busyPolicy=SKIP` 或 `FALLBACK_CPU`
- 这样确保：GPU 忙时语义修复不会拖慢主链路

---

## 6. “忙时降级”规范（必须明确）

### 6.1 对不同任务的默认 busyPolicy
| 任务 | priority | busyPolicy | maxWaitMs | 备注 |
|---|---:|---|---:|---|
| ASR | 90 | WAIT | 3000 | 不可丢弃 |
| NMT | 80 | WAIT | 3000 | 不可丢弃 |
| TTS | 70 | WAIT | 2000 | 取决于产品策略 |
| Semantic Repair | 20 | SKIP/FALLBACK_CPU | 200–600 | 可丢弃 |

### 6.2 SKIP 的语义
- Semantic Repair：直接 `PASS`（不修复，继续 NMT）
- 需要写入日志：`repair_skipped_reason`

### 6.3 FALLBACK_CPU 的语义
- Semantic Repair：走 CPU 推理（必须有硬超时），否则 PASS
- 注意：CPU fallback 也不能与 ASR/NMT 共用同线程池（建议独立进程/线程池）

---

## 7. 配置项（建议）

### 7.1 全局配置（Node 级）
```json
{
  "gpuArbiterEnabled": true,
  "gpuKeys": ["gpu:0"],
  "defaultQueueLimit": 8,
  "defaultHoldMaxMs": 8000
}
```

### 7.2 按任务类型配置（建议）
```json
{
  "gpuArbiterPolicies": {
    "ASR":            { "priority": 90, "maxWaitMs": 3000, "busyPolicy": "WAIT" },
    "NMT":            { "priority": 80, "maxWaitMs": 3000, "busyPolicy": "WAIT" },
    "TTS":            { "priority": 70, "maxWaitMs": 2000, "busyPolicy": "WAIT" },
    "SEMANTIC_REPAIR":{ "priority": 20, "maxWaitMs": 400,  "busyPolicy": "SKIP" }
  }
}
```

### 7.3 服务声明（service.json 可扩展字段）
```json
{
  "gpu_required": true,
  "vram_estimate_mb": 4096,
  "max_concurrency": 1,
  "gpu_key": "gpu:0"
}
```

---

## 8. 可观测性（必须）

### 8.1 关键指标（metrics）
按 `gpuKey` + `taskType` 维度统计：
- `gpu_arbiter_acquire_total{status=ACQUIRED|SKIPPED|FALLBACK_CPU}`
- `gpu_arbiter_queue_wait_ms`（P50/P95）
- `gpu_arbiter_hold_ms`（P50/P95）
- `gpu_arbiter_queue_length`（瞬时）
- `gpu_arbiter_timeouts_total`
- `gpu_arbiter_queue_full_total`
- `gpu_arbiter_watchdog_exceeded_total`
- 可选：`gpu_oom_total`（从推理错误上报）

### 8.2 日志字段（每次 acquire）
- `job_id, session_id, utterance_index, stage, taskType`
- `gpuKey, status, waitMs, holdMs, reason`
- `leaseId`（可选，用于串联）

---

## 9. 失败模式与防护

### 9.1 锁泄漏（未 release）
- Watchdog 记录告警
- 进程退出自动释放（进程级锁则天然释放）
- 建议强制：lease 通过 `try/finally` 释放

### 9.2 队列堆积
- `queueLimit` + `maxWaitMs` 必须生效
- Semantic Repair 使用 SKIP/FALLBACK，避免挤占

### 9.3 优先级反转
- MVP 以串行化为主，优先级仅用于出队顺序
- 高优任务必须能抢占队列前部（不需要抢占已持有 lease）

---

## 10. 实现建议（Node/TS 参考）

### 10.1 关键代码形态（伪代码）
```ts
const res = await gpuArbiter.acquire({
  gpuKey: "gpu:0",
  taskType: "SEMANTIC_REPAIR",
  priority: 20,
  maxWaitMs: 400,
  holdMaxMs: 3000,
  queueLimit: 8,
  busyPolicy: "SKIP",
  trace: { jobId, sessionId, utteranceIndex, stage: "SemanticRepair" }
});

if (res.status === "SKIPPED") {
  // PASS
  return { decision: "PASS", reason: res.reason };
}

if (res.status === "FALLBACK_CPU") {
  return await runRepairOnCpuWithTimeout(...);
}

try {
  return await runRepairOnGpu(...);
} finally {
  gpuArbiter.release(res.leaseId);
}
```

### 10.2 最小依赖
- 互斥：Semaphore(1) 或 Mutex
- 队列：priority queue（可先用数组 + 排序）

---

## 11. 测试与验收标准（建议作为开工门槛）

### 11.1 单元测试
- acquire/release 正确性
- timeout 正确性
- queueLimit 生效
- priority 队列出队顺序
- watchdog 触发

### 11.2 集成测试（必须）
- 并发启动 ASR + NMT + Repair：
  - Repair 在 GPU 忙时 SKIP，不影响 ASR/NMT 的 P95
- 语义修复超时回退 PASS 的行为一致
- 服务热插拔（若存在）不导致锁状态异常

### 11.3 验收指标（上线前）
- GPU 仲裁开启后：
  - 主链路（ASR+NMT）P95 延迟下降或不升高
  - OOM/推理失败率下降
  - Repair 的 SKIP 率可观测，且不影响翻译正确性（抽样）

---

## 12. 迭代路线（可选）

### Iteration 1（本轮 MVP）
- 单 GPUKey 互斥 + 队列上限 + 超时 + busyPolicy
- 指标与日志齐全
- Semantic Repair 默认 SKIP

### Iteration 2（增强）
- 多 GPUKey 支持（多卡路由）
- 动态策略（根据 GPU 利用率调整）
- 更细粒度的“任务组”互斥（例如 ASR 与 NMT 可并行，Repair 独占等）

---

## 13. 需要开发部门确认的决策点（请在评审中拍板）

1) Node 端是否存在多 GPU？若有，是否做静态绑定（CUDA_VISIBLE_DEVICES）优先？
2) Semantic Repair 忙时策略：SKIP 还是 FALLBACK_CPU？
3) 主链路最大允许等待：ASR/NMT/TTS 的 maxWaitMs 与 holdMaxMs 默认值
4) 是否需要 priority queue（建议有，但可先简化）
5) 是否在 Windows 环境下实现 CPU fallback 的独立进程/线程池隔离

---

**文件用途**：本方案可直接作为开发评审文档与实现依据。  
