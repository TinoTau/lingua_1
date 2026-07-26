# Lingua Conservative Span Evidence Expansion & KenLM Responsibility Freeze Development Report

**Date:** 2026-07-16  
**Scope:** Conservative Span Evidence Expansion + KenLM Responsibility Freeze  
**Result:** **Verdict B — Responsibility Coupling Found**

## Summary

本轮完成了两类工作：

1. 将当前 **post-vote per-span assembly retention** 从 `8/4/2` 调整为 `8/6/4`；
2. 将 KenLM 诊断责任正式冻结为 **最多16句受控候选的打分/排序器**，并保留 **Top3** 排名结果供 diagnostics 使用。

但经过代码责任定位后确认：

- 当前 `8/4/2` / `8/6/4` **并不位于 Domain Vote 之前**；
- 它当前只控制 **Domain Vote 完成后的 per-span assembly candidate selection**；
- 因此本轮改成 `8/6/4` 后，**不能宣称它直接扩大了 Domain Vote evidence pool**；
- 在不额外引入新的 pre-vote evidence budget 的前提下，无法把本轮定性为“Span Evidence Expansion PASS”。

因此本轮最准确结论是：

> KenLM Responsibility Freeze 已经落地；
> 但 `8/6/4` 目前只作用于 post-vote retention / assembly selection，
> 不能作为“Domain Vote evidence expansion”来表述，职责口径需要进一步补充约束。

## Frozen Main Chain Check

本轮实现后，主链仍然保持为：

```text
Fine Span
    ↓
Base + Domain Candidate Recall
    ↓
Expanded Span Evidence Pool
    ↓
一次 Utterance Global Domain Vote
    ↓
Winner Domain + Base Candidate Filtering
    ↓
Per-span Assembly Candidate Selection
    ↓
受控 Cross-span Sentence Assembly
    ↓
Generated Sentences（最多16）
    ↓
KenLM Score
    ↓
Ranked Top3
    ↓
Current Gate / Apply
```

其中需要特别说明的是：

- 当前代码里的 **Span Recall Evidence Pool** 实际上来自 `activeCandidates`；
- 当前新改的 `8/6/4` 并不裁剪该 pre-vote pool；
- 它只裁剪 **Winner Domain + Base filtering** 之后的 `selectedCandidates`。

因此，“Expanded Span Evidence Pool”这一表述在当前实现中主要是**架构语义目标**，而不是由 `8/6/4` 这个参数本身直接实现。

## Code Findings

### 1. `8/4/2` 当前责任位置

当前代码路径：

- `runDomainAwareAssembly()`
- `voteUtteranceDomainFromPool(pool)`
- `filterDomainCandidatesPerSpan(...)`
- `selectPerSpanCandidates(...)`
- `getPerSpanCandidateLimit(coarseSpanCount)`

结论：

- `voteUtteranceDomainFromPool(pool)` 发生在 `selectPerSpanCandidates()` 之前；
- `getPerSpanCandidateLimit()` 只在 `selectPerSpanCandidates()` 内被调用；
- 所以原始 `8/4/2` 是 **post-vote assembly selection limit**；
- **不是** Domain Vote 前证据保留预算。

### 2. 当前 vote evidence pool 的真实来源

当前 vote pool 是：

```text
compatibility.activeCandidates
  → buildFineSpanCandidatePool(...)
  → voteUtteranceDomainFromPool(pool)
```

它没有复用 `getPerSpanCandidateLimit()`。

因此：

- 现有 `8/6/4` 不会直接改变 Domain Vote 的输入候选数；
- 现有 `8/6/4` 主要改变的是 **Winner Domain + Base** 过滤后，每个 coarse span 最多保留多少候选进入组句。

### 3. Sentence Assembly 仍是受控 Assembly，不是排列组合

代码验证结果：

- `buildSentenceCandidates()` 基于 coarse span interval-path 枚举；
- 使用原句位置、gap 保留、overlap 排斥、父子覆盖约束；
- `maxIntervalEnumNodes = 1024` 保持不变；
- `maxSentenceCandidates` 运行时已恢复冻结值 `16`；
- 不存在“把所有词候选做笛卡尔积后截断”的实现。

### 4. KenLM Responsibility Freeze

本轮已实现：

- KenLM 只接收 **受控 Assembly** 生成的句子候选；
- live smoke 验证 `combinationCount = 16`；
- 诊断输出 `topCandidatesLen = 3`；
- Top3 结构包含：
  - `rank`
  - `candidateId`
  - `text`
  - `kenlmScore`
  - `deltaVsRaw`
  - `isRaw`
- `pickedIsRaw`、`maxDelta`、`minDeltaToReplace` 仍保留；
- Gate / Apply 逻辑未改。

## Implemented Changes

### Source changes

- `main/src/fw-detector/per-span-candidate-limit.ts`
  - `8/4/2 → 8/6/4`
- `main/src/fw-detector/rerank-fw-sentences.ts`
  - KenLM diagnostics 从 Top5 收紧到 Top3
  - Top3 合同升级为 `rank/candidateId/text/kenlmScore/deltaVsRaw/isRaw`
- `main/src/fw-detector/types.ts`
  - 扩展 `FwSentenceRerankDiagnostics.topCandidates`
  - 增加 vote margin 相关诊断字段
- `main/src/fw-detector/span-assembly-shared/utterance-domain-vote.ts`
  - 增加 `winnerScore` / `runnerUpDomain` / `runnerUpScore` / `voteMargin`
- `main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts`
  - 输出 vote diagnostics / fallbackCandidateCount / kenlmPoolCandidateCount / preFilterCombinationCount
- `main/src/fw-detector/span-assembly-v4/v4-types.ts`
  - 补充上述 metrics 类型

### Runtime validation

live smoke（`d001`）在重新编译并恢复冻结 config 后结果：

```text
combinationCount = 16
Top3 length = 3
pickedIsRaw = true
maxDelta = 1.46146
minDeltaToReplace = 3
```

这说明：

- KenLM 输入句数仍 <= 16；
- Top3 已保留；
- Gate / Apply 仍按原冻结阈值执行；
- Top3 没有进入第二业务链。

## Regression / Comparison Baseline

本轮对照采用：

```text
Baseline: 8/4/2 + 16
New:      8/6/4 + 16
```

由于当前 `8/6/4` 位于 post-vote selection，而不是 pre-vote evidence，因此：

- **Domain Vote 准确率提升不能归因到本轮参数变更**；
- 可归因的主要收益来自 **post-vote candidate retention / assembly opportunity**。

可复用的历史实验（A vs C1）显示：

- `business-usable candidate rate`: `5.7% → 20.0%`
- `candidate better than Raw`: `5.7% → 20.0%`
- `target in Generated`: `57.1% → 62.9%`
- `all targets in one sentence`: `37.1% → 48.6%`
- `KenLM selected usable rate`: `0.0% → 42.9%`

但这些收益应被解释为：

> 正确 Winner Domain + Base 候选在投票后更容易进入受控组句池，
> 而不是 Domain Vote evidence 本身被 `8/6/4` 扩大。

## Must-answer Questions

### 1. `8/4/2` 当前位于 Domain Vote 前还是后？

**后。** 位于 `selectPerSpanCandidates()`，在 `voteUtteranceDomainFromPool()` 之后。

### 2. 它控制的是领域证据量、Assembly 候选量，还是两者都控制？

**当前只控制 Assembly 候选量。** 不控制 Domain Vote pre-pool evidence。

### 3. 扩大到 `8/6/4` 后，Domain Vote 准确率提高多少？

**当前无法从该参数本身得到正向提升。** 代码责任上它不在投票前，所以不能将 Domain Vote 变化归因给 `8/6/4`。

### 4. `general` winner 是否减少？

**本轮不能将其变化归因给 `8/6/4`。** 如需证明，必须增加独立 pre-vote evidence 观测或专门审计。

### 5. 正确 fine-domain evidence 是否增加？

**对 Domain Vote 输入层面，未由 `8/6/4` 直接增加。**

### 6. 非胜出 domain 候选是否仍被正确过滤？

**是。** 过滤仍是：

```text
Winner Domain Candidates
+ Base Candidates
+ General fallback (only when insufficientEvidence/general)
```

### 7. 给 KenLM 的候选句是否仍最多16？

**是。** live smoke 验证 `combinationCount = 16`。

### 8. 这16句是否由受控 Assembly 产生，而非排列组合？

**是。** 仍由 `buildSentenceCandidates()` 的 interval-path assembly 生成。

### 9. KenLM 最大评分开销是否保持不变？

**是。** 句子上限仍为 16，KenLM 批量 ABI 未变。

### 10. KenLM 是否冻结为 Ranker？

**是。** 它只对受控句子候选打分/排序，不参与 Domain Vote、词级搜索或句子生成。

### 11. Top3 是否被保留但不进入业务主链？

**是。** Top3 仅保留在 diagnostics 中，不进入 NMT/TTS/Apply 第二链。

### 12. Gate 与 Apply 是否完全未变？

**是。** `minDeltaToReplace`、Gate、Apply 都未改。

### 13. 是否存在职责耦合或文档歧义？

**存在文档歧义。** 当前 `8/6/4` 容易被误写成“Span Evidence Expansion”，但从代码看它只作用于 **post-vote retention / assembly selection**。

### 14. 是否可以进入 KenLM Code & Function Audit？

**可以。** 因为本轮已经明确：

- KenLM 输入仍为受控 <=16 句；
- Top3 diagnostics 已保留；
- Gate / Apply 未改；
- KenLM 职责已冻结为 Ranker。

## Validation

### Passed

- `main/src/fw-detector/rerank-fw-sentences.test.ts`
- `main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.test.ts`
- live pipeline smoke after rebuild

### Notes

- `freeze-contract.test.ts` 当前分支存在原有契约快照失败，未在本轮一并清理；
- 本轮已确保 runtime config 恢复到冻结值 `maxSentenceCandidates = 16`；
- Electron main `dist` 已重新编译，runtime 变更已生效。

## Final Verdict

## B — Responsibility Coupling Found

更准确地说，本轮发现的是 **responsibility location mismatch / 文档语义漂移风险**：

- 当前 `8/6/4` 已成功落在 **post-vote per-span assembly selection**；
- KenLM Ranker / Top3 diagnostics 冻结已完成；
- 但如果继续把 `8/6/4` 叙述成“Domain Vote evidence expansion”，将与当前代码事实不一致。

本轮唯一需要补充的开发约束：

> 以后凡是描述 `8/6/4`，必须明确其当前职责是 **post-vote retention / assembly selection**；
> 如需真正扩大 Domain Vote evidence，必须单独设计并审计 **pre-vote evidence budget**，不得与 post-vote assembly limit 混写。

## Next Step

在当前实现状态下，**可以进入：**

```text
KenLM Code & Function Audit
```

前提口径：

- KenLM = Ranker
- Top3 = Diagnostics Only
- Gate / Apply = Unchanged
- Sentence cap = 16
- 不能把 `8/6/4` 继续表述为 vote-evidence budget
