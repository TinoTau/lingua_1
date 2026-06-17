# Diagnostics / Trace Completeness — 冻结合约 V1.0.2

**状态**：FROZEN（2026-06-17）  
**性质**：可观测层（Summary + Trace plumbing），**不**改变 Recall/Assembly/KenLM 业务行为  
**代码根**：`fw-detector-v4-path.ts` · `span-assembly-v4/v4-diagnostics-*` · `recall-topk-for-windows.ts`

---

## 1. 目标

全链路无字段丢失：

```text
Diagnostics Store → V2 Result → V3 Result → PreFilter Trace → RecallHit Trace
→ Pool Trace → Tone Summary → Batch JSON → Analysis Script
```

**机制零 diff**：开启 diagnostics 前后，KenLM 输入与 Apply 结果一致。

---

## 2. Flush 定案（方案 A）

采用 **方案 A**，**禁止**修改 `recall-v2-diagnostics.ts`。

### Wrapper 结构

```text
runWithLexiconRecallContext
  → runWithRecallV2Diagnostics
      → runSpanAssemblyV4Orchestrator
      → runFwSentenceRerankFromPrefilled
  → flush (所有路径)
```

### 必须覆盖的路径

| 路径 | 行为 |
|------|------|
| Path A | Assembly → KenLM → **Flush** |
| Path B | Assembly → fwSpans=0 → **Flush** → Return |

**不要求**：IME dict unavailable 路径产生 spans（未进入 Recall）。

---

## 3. ToneLookupStage SSOT

与 Recall 模块共用：

```ts
import type { ToneLookupStage } from 'tone-first-tier-collector'
```

禁止在 V3 / Diagnostics / Trace / Pool 中定义第四套 union。

---

## 4. V2/V3 Result Contract

### RecallSpanTopKV2Result 新增

```ts
queryTonePinyinKey?: string;
toneExactHitCount?: number;
plainFallbackHitCount?: number;
```

### RecallSpanTopKV3Result

必须完整继承 V2 字段；禁止 V2 有而 V3 丢失。

### 聚合规则

| 层级 | 来源 |
|------|------|
| Window | V2 Result |
| Utterance | sum(window result) |
| 禁止 | 从 trace 反推统计 |

---

## 5. Trace Contract

### PreFilter Trace

必须保留 `toneLookupStage`、`queryTonePinyinKey`，即使 `minPriorRejected`。

### plain_only_no_pattern

必须可见 `toneLookupStage=plain_only_no_pattern`，禁止省略。

### Count Contract

| Stage | 计入 plainFallbackHitCount |
|-------|---------------------------|
| `plain_fallback` | ✅ |
| `plain_only_no_pattern` | ❌ |

---

## 6. Tone Summary Contract

### 新增字段（CoarseAssemblyToneDiagnostics）

```ts
toneExactHitCount: number;
plainFallbackHitCount: number;
```

`createEmptyToneDiagnostics()` 须初始化为 `0`，禁止 `undefined`。

Summary 与 trace 两种 diagnostics level **均输出**上述字段。

### 与既有字段区分

| 字段 | 语义 |
|------|------|
| `recallToneCompatibleCount` / `recallToneFallbackCount` | penalty 兼容/降级次数（既有） |
| `toneExactHitCount` / `plainFallbackHitCount` | SQL lookup stage 计数（V1.0.2 新增） |

---

## 7. Diagnostics Gate

### V2 Diagnostics

批测 / trace 审计须 `recallDiagnosticsEnabled=true`。

### V4 Diagnostics

须同时满足：

```text
spanAssemblyV4DiagnosticsEnabled = true
spanAssemblyV4DiagnosticsLevel = trace
targetIds 匹配当前 case
```

缺一不可。

### Trace Scope（批测 patch）

允许 targetIds：`d001`、`d048`  
禁止 dialog200 全量 trace（性能与 JSON 体积）。

Patch 脚本：`tests/patch-span-assembly-v4-config.mjs`

---

## 8. Trace 数据结构要点

| 层级 | 关键字段 |
|------|----------|
| PreFilter | `toneLookupStage`, `queryTonePinyinKey`, `filterStage` |
| RecallHit | `toneLookupStage`, `toneReason`, `toneCompatible`, `hitKind` |
| Pool | 候选生命周期 + tone 字段 |
| Summary | 全量 metrics + toneExact/plainFallback 计数 |

类型 SSOT：`span-assembly-v4/v4-diagnostics-types.ts` · `v4-types.ts`  
Tone summary 类型：`span-assembly-shared/types.ts`（通过 import 引用，禁止在 `fw-detector/types.ts` 重复定义）

---

## 9. 批测工作流

```powershell
# 1. patch 开启 trace（不改 SSOT 默认文件）
node tests/patch-span-assembly-v4-config.mjs

# 2. 跑 dialog200 批测
node tests/run-dialog200-timed-batch.mjs ".../dialog_200" --max-minutes 15

# 3. 分析
node tests/experiments/analyze-tone-first-recall-dialog200.mjs
```

产物：`tests/experiments/*-dialog200-quality-perf.json` · `trace-d001.json` · `trace-d048.json`

---

## 10. SSOT 文件

| 文件 | 职责 |
|------|------|
| `fw-detector-v4-path.ts` | flush wrapper（方案 A） |
| `recall-span-topk-v2.ts` | result 回传字段 |
| `recall-span-topkv3.ts` | mapV2Hit 透传 |
| `recall-topk-for-windows.ts` | PreFilter/RecallHit/Pool trace + summary 聚合 |
| `v4-diagnostics-types.ts` | trace 类型 |
| `v4-diagnostics-mappers.ts` | Pool trace mapper |
| `v4-diagnostics-config.ts` | enabled/level/targetIds |
| `span-assembly-shared/tone-diagnostics.ts` | summary 初始化 |

---

## 11. 配置（见 CONFIG.md）

| 键 | 生产默认 | 批测 patch |
|----|----------|------------|
| `spanAssemblyV4DiagnosticsEnabled` | `false` | `true` |
| `spanAssemblyV4DiagnosticsLevel` | `summary` | `trace` |
| `spanAssemblyV4DiagnosticsTargetIds` | `[]` | `['d001','d048']` |

**禁止**：将 trace gate 默认开启或接入业务分支。

---

## 12. 冻结边界

**允许**：

- Diagnostics trace 批测复现（patch 脚本）
- 分析脚本口径修正（非机制）

**禁止**：

- 修改 `recall-v2-diagnostics.ts`
- 借 diagnostics 改变 Recall/Assembly/KenLM 行为
- 为通过硬编码 case 期望而改 plumbing

---

## 13. 已知 Low 项（不阻断冻结）

- PreFilter 同一 window 偶发重复行
- 部分 trace 行缺 `toneLookupStage`（plumbing 一致性，非机制）
- 分析脚本 d001 硬编码 `tone_exact` 期望已过时（Stage B 结论：可为 `plain_fallback`）
