# 语义修复双引擎（INT4 GPU）自适应方案开发文档  
**版本**：v1.0  
**适用阶段**：当前阶段（不实现 GPU 仲裁，仅预留接口）  
**适用场景**：家用 PC 节点端、低并发、语义修复可丢弃（PASS）

---

## 1. 背景与目标

### 1.1 背景
在节点端（家用 PC）场景中：
- GPU 性能差异大（型号 / 显存 / 驱动）
- 高并发几乎不存在
- 语义修复属于 **非主链路、可丢弃能力**
- 系统更关注 **常驻开销与 P95 延迟稳定性**

同时，单一推理引擎（如 llama.cpp 或 ExLlamaV2）在不同硬件上的表现差异明显。

### 1.2 目标
- 同时支持两种 **INT4 GPU 语义修复引擎**：
  - llama.cpp（GGUF 4bit）
  - ExLlamaV2（EXL2 4bit）
- 在 **不实现 GPU 仲裁** 的前提下：
  - 自动选择更适合当前节点性能的引擎
  - 在运行期发生退化或异常时自动切换
- 保证：
  - 不拖慢主翻译链路
  - 不引入复杂的运行时调度逻辑

### 1.3 非目标（当前阶段不做）
- 不实现 GPU 仲裁 / 互斥
- 不做每句动态切换
- 不做高并发吞吐优化
- 不引入 CPU 或 FP16 兜底路径

---

## 2. 总体架构

```
SemanticRepairService
│
├─ EngineManager
│   ├─ EngineSelector
│   ├─ BenchmarkRunner
│   ├─ RuntimeMonitor
│   └─ SwitchController
│
├─ EngineAdapter (Interface)
│   ├─ LlamaCppEngine
│   └─ ExLlamaV2Engine
│
└─ RepairPipeline
    └─ (gated → deadline → PASS)
```

---

## 3. 统一引擎接口设计（必须）

所有推理后端必须实现以下接口，确保可替换性。

```ts
interface SemanticRepairEngine {
  id: "llamacpp" | "exllama";
  warmup(): Promise<void>;
  repair(
    input: RepairRequest,
    deadlineMs: number
  ): Promise<RepairResult>;
  health(): Promise<EngineHealth>;
  stats(): EngineStatsSnapshot;
  shutdown(): Promise<void>;
}
```

### 3.1 RepairRequest（示意）
```ts
interface RepairRequest {
  text_in: string;
  lang_in: "zh" | "en";
  constraints: {
    preserve_numbers: boolean;
    preserve_urls: boolean;
  };
  max_output_tokens: number; // 强限制
  mode: "minimal_edit";
}
```

### 3.2 RepairResult（示意）
```ts
interface RepairResult {
  decision: "REPAIRED" | "PASS";
  text_out?: string;
  reason?: string;
  latency_ms: number;
}
```

---

## 4. 自动选择策略（核心）

### 4.1 阶段 A：启动基准测试（一次性）

#### 触发时机
- 节点首次启动
- 模型或引擎版本变更
- 手动触发（调试）

#### 测试内容
- 固定 10–20 条代表性短句（含常见 ASR 错误）
- 并发：1
- 输出 token 上限：64
- 同一批样本分别跑 llama.cpp / ExLlamaV2

#### 记录指标
- p50_ms / p95_ms
- warmup_ms
- vram_peak_mb
- success_rate
- output_sanity_rate（是否乱码 / 不可解析）

#### 选择规则（推荐）
1. output_sanity_rate == 100%
2. success_rate ≥ 99%
3. vram_peak_mb 更低者优先
4. p95_ms 更低者优先（差异 ≥15% 才视为显著）

#### 产出文件
生成并写入本地：

```json
engine_policy.json
```

---

### 4.2 阶段 B：运行期监控与切换

#### 监控窗口
- 最近 50 次调用
- 或最近 3–5 分钟

#### 触发切换条件（任一满足）
- 连续 3 次调用失败
- 窗口失败率 > 5%
- p95_latency > baseline × 1.8
- 出现一次不可解析输出（安全优先）

#### 切换规则
- 切换后进入冷却期（10–30 分钟）
- 冷却期内禁止回切
- 只在窗口稳定后才允许再次评估

> ⚠️ 明确禁止：每句动态切换

---

## 5. 忙时与超时策略（不依赖 GPU 仲裁）

由于当前阶段不做 GPU 仲裁：

- repair 调用必须设置 **硬 deadline**（如 600ms）
- 超时直接返回：
```json
{ "decision": "PASS", "reason": "TIMEOUT" }
```

> 语义修复始终是“可丢弃”的，不得阻塞主链路。

---

## 6. 两种引擎的实现约束

### 6.1 llama.cpp（GGUF 4bit）
- 建议独立进程（HTTP / 本地 IPC）
- 模型格式：GGUF
- GPU 推理（CUDA）
- 常驻资源低，作为 **默认主引擎**

### 6.2 ExLlamaV2（EXL2 4bit）
- Python 服务或独立进程
- EXL2 量化模型
- 作为 **备用引擎**
- 可配置为按需启动或低频预热

---

## 7. 配置文件示例

### 7.1 engine_policy.json
```json
{
  "preferred_engine": "llamacpp",
  "fallback_engine": "exllama",
  "baseline": {
    "llamacpp": { "p95_ms": 120, "vram_peak_mb": 2400 },
    "exllama":  { "p95_ms": 95,  "vram_peak_mb": 3200 }
  },
  "switch": {
    "fail_consecutive": 3,
    "fail_rate": 0.05,
    "p95_multiplier": 1.8,
    "cooldown_sec": 900
  }
}
```

### 7.2 semantic_repair_runtime.json
```json
{
  "max_output_tokens": 64,
  "deadline_ms": 600,
  "gated": true
}
```

---

## 8. 扩展点（为后续 GPU 仲裁预留）

虽然当前不实现 GPU 仲裁，但需 **预留接口**：

```ts
interface GpuLease {
  acquire(maxWaitMs: number): Promise<boolean>;
  release(): void;
}
```

在 repair 调用前后保留 hook：

```ts
if (gpuLease && !(await gpuLease.acquire(0))) {
  return { decision: "PASS", reason: "GPU_BUSY" };
}
try {
  // repair
} finally {
  gpuLease?.release();
}
```

---

## 9. 测试与验收标准

### 必须通过
- 任一引擎异常不影响主翻译链路
- 自动切换不产生抖动
- 冷却期逻辑生效
- 所有 PASS 路径可观测（日志/指标）

### 验收指标
- 修复服务失败 ≠ 翻译失败
- P95 延迟稳定
- 节点资源占用可预测

---

## 10. 当前阶段的推荐默认值

| 项目 | 推荐值 |
|---|---|
| 默认主引擎 | llama.cpp |
| 并发 | 1 |
| deadline | 600 ms |
| max_output_tokens | 64 |
| 切换冷却期 | 15 分钟 |

---

## 11. 结论

本方案在 **不改造其他服务、不引入 GPU 仲裁** 的前提下：
- 最大化节点端适配性
- 最小化系统开销
- 为未来 GPU 仲裁与统一调度保留清晰扩展点

适合作为当前阶段的 **可落地工程方案**。
