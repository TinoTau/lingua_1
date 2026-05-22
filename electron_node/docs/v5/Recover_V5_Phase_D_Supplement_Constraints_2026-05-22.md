# Recover V5 Phase D — 代码补充说明与实施约束

**对应方案**：[Recover_V5_Phase_D_Safety_Gates_KenLM_Boundary_2026-05-22.md](./Recover_V5_Phase_D_Safety_Gates_KenLM_Boundary_2026-05-22.md)  
**冻结决策**：[Recover_V5_Frozen_Decisions_2026-05-22.md](./Recover_V5_Frozen_Decisions_2026-05-22.md)（D-03、D-06、D-08）  
**日期**：2026-05-22  
**前置**：Phase B（`no_diff_span`）、Phase C（TopK + candidateScore）

---

## 0. 已确认决策（实施必须遵守）

| 决策 | 对本 Phase 的要求 |
|------|-------------------|
| **D-03** | `maxActiveWindows = maxReplacements = maxWindowsPerSentence = 2`；禁止 `window_multi` |
| **D-06** | `kenlmBaselineTolerance = 0.15`（默认，normalizedScore 空间） |
| **D-08** | 仅对 ≤2 窗组合的 SentenceCandidate 做 KenLM；与双尺度窗产出的多句候选配合 |

---

## 1. 当前 skip / gate 代码基线

### 1.1 句修复 skip（`sentence-repair-step.ts`）

| 常量 | 值 | 触发条件 |
|------|-----|----------|
| `REPAIR_SKIP_NO_HYPOTHESES` | `no_hypotheses` | `!ctx.asrHypotheses?.length` |
| `REPAIR_SKIP_NO_WINDOW_EXPANSION` | `no_window_expansion_candidate` | `filterRerankEligibleCandidates` 为空；或 picked 非 rerank-eligible |

写入：`ctx.recoverLifecycleSkipReason`、`ctx.repairSkipReason`、`recover_skipped: true`。

### 1.2 Lexicon 步骤 skip（`lexicon-recall-step.ts` + `node-config.ts`）

| skipReason | 来源 |
|------------|------|
| `job_use_lexicon_false` | `getLexiconRecallSkipReason` |
| `feature_lexicon_recall_disabled` | 节点 config |
| `unsupported_source_language` | 非 zh/yue |
| `empty_segment` | segment 空 |

**注意**：feature disabled 时步骤 **return**，不一定设置 `no_diff_span`。

### 1.3 Recover lifecycle（`recover-contract.ts`）

`buildRecoverLifecycleFromCtx` 产出：

```typescript
{ executed, gated, skipped, skipReason }
```

当前 skip 示例：`no_window_expansion_candidate`、`recover_not_run`、`lexicon_runtime_error`。

**无** V5 六项：`no_diff_span`、`no_topk_candidate`、`low_candidate_score`、`kenlm_worse_than_baseline`、`replacement_count_exceeded`、`candidate_budget_exceeded`。

### 1.4 Selector 内部拒绝（未统一为 lifecycle skip）

`windowSelector.ts` / `buildLexiconBoundCandidates`：

- `no_candidate`
- `score_below_threshold`（`selectionMinPhoneticScore` 默认 0.85）
- `overlap`
- `max_replacements_reached`

这些在 `expansion_selector_reject` 有部分统计，**未**映射为 V5 `replacement_count_exceeded`。

### 1.5 预算截断（silent 风险）

| 位置 | 行为 |
|------|------|
| `window-recall.ts` | `out.length >= maxCandidates` → `truncated: true` |
| `no-window-bucket.ts` | `window_budget_exceeded` 仅作 **无窗分类**，非 skipReason |
| `sentence-expansion` | `maxSentenceCandidates: 16` 截断组合 |

**约束 D-C1**：Phase D 须将截断转为 `candidate_budget_exceeded` + 写入 JSON。

---

## 2. KenLM 与 baseline 现状

### 2.1 KenLM 调用点（仅句级）

`rerankSentenceCandidates`（`rerank.ts`）：

- 输入必须全部 `isRerankEligible`（无 `raw_ctc_baseline`）
- `combinedScore` = acoustic + phonetic + prior + **lm**（`DEFAULT_RERANK_WEIGHTS`）
- **无** 与 baseline 句 KenLM 对比 gate

### 2.2 Baseline 文本

`sentence-repair-step.ts` L79：

```typescript
const baselineText = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
```

rank0 hypothesis 的 `acousticScore` 在 `SentenceCandidate` 上，但 **未** 单独算 baseline KenLM。

### 2.3 raw CTC 隔离（已满足）

| 机制 | 文件 |
|------|------|
| `resolveCandidateSource([])` → raw_ctc_baseline | `candidate-source.ts` |
| rerank throw | `rerank.ts` L23–24 |
| expand 跳过 raw | `sentence-expansion.ts` |
| 契约批测 | `recover-contract-assess.js` |

**Phase D 保持**；`kenlm_worse_than_baseline` 为 **新增** gate，不削弱现有隔离。

### 2.4 写回锁（勿破坏）

`isRecoverWriteLocked(ctx)` ← `ctx.asrRepairApplied === true`（`post-asr-routing.ts` L72–74）

- `applySentenceRepair` 设置 `asrRepairApplied`
- phonetic/semantic 步见 `RECOVER_WRITE_LOCKED`

**约束 D-C2**：gate skip 时 **不得** 调用 `applySentenceRepair`；`asrRepairApplied` 保持 false。

---

## 3. V5 六项 gate 落地映射

建议 **新建** `asr-repair/recover-safety-gates.ts`：

| V5 skipReason | 触发条件（建议） | 接入点 |
|---------------|------------------|--------|
| `no_diff_span` | Phase B：`diffSpans.length===0` | `lexicon-recall-step` 或 `window-recall` 返回后 |
| `no_topk_candidate` | 有窗但 `windowCandidates.length===0` 或 TopK 全空 | `lexicon-recall-step` 末 |
| `low_candidate_score` | 最高 candidateScore < minCandidateScore | TopK 后、进 expansion 前 |
| `kenlm_worse_than_baseline` | picked.kenlmScore 比 baseline KenLM 差超过 tolerance | `rerank` 后、`applySentenceRepair` 前 |
| `replacement_count_exceeded` | selector 需 >maxActiveWindows(2) 才覆盖 | expansion 后 |
| `candidate_budget_exceeded` | 窗/句候选截断发生 | recall 或 expansion 末 |

### 3.1 `kenlm_worse_than_baseline` 实现约束

```typescript
// 伪代码 — 不调 DEFAULT_RERANK_WEIGHTS；tolerance 冻结 0.15（D-06）
const tolerance = getRecoverQualityConfig().kenlmBaselineTolerance; // default 0.15
const baselineLm = await scorer.scoreBatch([baselineText]);
const pickedLm = picked.kenlmScore?.normalizedScore ?? -Infinity;
const baseNorm = baselineLm.scores[0]?.normalizedScore ?? -Infinity;
if (baselineLm.available && pickedLm < baseNorm - tolerance) {
  return skip('kenlm_worse_than_baseline');
}
```

**约束 D-C3**：KenLM 不可用（`kenlmAvailable===false`）时 **不** 因本 gate 误 skip（可配置：缺 KenLM 则跳过本 gate 或整体 skip repair）。

**约束 D-C4**：**禁止** 为通过 gate 而调整 `RerankWeights`。

### 3.2 `replacement_count_exceeded`

- 当前 `maxReplacements` 默认 **2**（`quality-config.ts` / `node-config-defaults.ts`）
- V5 `maxActiveWindows = 2` — 与 `maxReplacements` **统一命名**或 alias
- `maxWindowsPerSentence: 4`（`sentence-expansion/types.ts`）须降为 **2**（Phase D 或 E 配置）

### 3.3 `candidate_budget_exceeded`

触发条件建议（任一）：

- `windowRecallDiagnostics.truncated === true`
- `sentenceCandidates.length` 达 `maxSentenceCandidates` 且仍有未展开组合
- TopK 截断丢弃数 > 0 且配置要求显式报告

必须设置：`recover_skipped: true`，`skipReason: candidate_budget_exceeded`，**禁止**仅 `truncated` 无 skip。

---

## 4. 与 `recover-contract` / extra 字段

### 4.1 当前契约版本

```typescript
RECOVER_CONTRACT_VERSION = 'historical-restore-v1'  // recover-contract.ts L20
```

Phase D **仍用** v1 契约开发；`v5-scored-lexicon-topk` 属 Phase E。

### 4.2 必须写入的 extra 路径

| 字段 | 用途 |
|------|------|
| `recover_lifecycle.skipReason` | 主 skip |
| `repair_skip_reason` | 与 lifecycle 对齐 |
| `sentence_repair.skipReason` | `buildSentenceRepairExtra` 已有可选字段 |
| `recover_skipped: true` | 已有 |

### 4.3 新增分布统计（Phase D 最小）

```typescript
skip_reason_v5: {
  no_diff_span: 0,
  no_topk_candidate: 0,
  // ...
}
```

可放在 `window_recall_diagnostics` 或 `v5_metrics` stub（Phase E 完整化）。

---

## 5. 组合上限与 window_multi

`candidate-source.ts`：

- 3+ replacements → `window_multi`

V5 第一版 **禁止 3+ active windows**：

**约束 D-C5**：`expandSentenceCandidates` / `windowSelector` 在 `maxActiveWindows=2` 时不生成 `window_multi` 进入 rerank 池；若生成则 gate `replacement_count_exceeded`。

---

## 6. 文件修改清单

| 文件 | 变更 |
|------|------|
| **新建** `asr-repair/recover-safety-gates.ts` | 六项判定 + 类型 |
| `pipeline/steps/lexicon-recall-step.ts` | no_diff / no_topk / budget |
| `pipeline/steps/sentence-repair-step.ts` | 统一 markSkip；KenLM gate |
| `asr-repair/sentence-rerank/rerank.ts` | 可选：返回 baseline KenLM 分 |
| `recover-quality/quality-config.ts` | maxActiveWindows、kenlmBaselineTolerance |
| `asr-repair/sentence-expansion/types.ts` | maxWindowsPerSentence → 2 |
| `lexicon/no-window-bucket.ts` | 不与 V5 skip 混用（文档注明） |

---

## 7. 测试约束

| 测试文件 | 覆盖 |
|----------|------|
| **新建** `recover-safety-gates.test.ts` | 六项各 1 case |
| 更新 `sentence-repair-step` 相关测试 | skipReason 字符串 |
| `recover-contract.test.ts` | skip 写入 extra |
| `recover-contract-batch-assess.test.js` | Phase E 再扩 V5 pass |

**现有**：`post-asr-routing.recover-lock.test.ts` — gate skip 后仍须 `asrRepairApplied===false`。

---

## 8. 验收

```text
skip_reason_v5_distribution 六项均可统计
picked_from_raw_ctc_nbest_count = 0
modified_without_replacement_count = 0
candidate_budget_exceeded 出现时 recover_skipped=true 且进 JSON
无 silent truncation（truncated 必有对应 skip 或 diagnostics 标志）
```

---

## 9. 禁止项（Phase D）

| ID | 禁止 |
|----|------|
| D-X1 | 修改 `DEFAULT_RERANK_WEIGHTS` 或 KenLM 模型 |
| D-X2 | 为通过 gate 强制 pick raw_ctc_baseline |
| D-X3 | skip 仅打 logger 不写 extra |
| D-X4 | 无候选时仍 `applySentenceRepair` |
| D-X5 | Phase D 改 `RECOVER_CONTRACT_VERSION` |

---

## 10. 依赖

```text
Phase B → no_diff_span
Phase C → no_topk_candidate, low_candidate_score
Phase D → Phase E（批测统计 skip_reason_v5_distribution）
```
