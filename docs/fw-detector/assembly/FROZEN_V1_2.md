# SameDomain + Base Per-Span Assembly — 冻结合约 V1.2

**状态**：FINAL FROZEN（2026-06-17）  
**代码根**：`electron_node/electron-node/main/src/fw-detector/`

---

## 1. 冻结结论

- Main Chain 已接线：`domainAwareSpanSets` → `buildSentenceCandidates` → KenLM → Apply
- Shadow Chain 独立：Beam 仅 diagnostics/trace，**禁止**进入 KenLM/Apply
- **停止 Assembly / Domain Vote / Beam 主链开发**；变更须新 Contract，禁止 Silent Change

---

## 2. 主链 vs 影子链

### Main Chain

```text
activeCandidates
  → buildFineSpanCandidatePool
  → voteUtteranceDomainFromPool
  → filterDomainCandidatesPerSpan
  → selectPerSpanCandidates
  → assembleDomainAwareSpanSets
  → domainAwareSpanSets
  → buildSentenceCandidates
  → KenLM → Apply
```

### Shadow Chain

```text
Emit → ParentSpanAssembly → Graph → Beam → shadowBeamSpanSets
```

用途：Diagnostics · Trace · Comparison。**禁止**进入 Main Chain。

---

## 3. 核心接口

| 函数 | 输入 | 输出 |
|------|------|------|
| `buildFineSpanCandidatePool` | `WindowCandidate[]` | `FineSpanCandidatePool[]` |
| `voteUtteranceDomainFromPool` | pools | `UtteranceDomainVoteResult` |
| `filterDomainCandidatesPerSpan` | vote + pools | `DomainFilteredSpanSet[]` |
| `selectPerSpanCandidates` | filtered sets | 按优先级选 per-span |
| `assembleDomainAwareSpanSets` | selections | `SpanReplacementPick[][]` |

**Per-span 选择优先级**：`sameDomain > base > fallback > canonical`

---

## 4. 数据结构

```ts
// FineSpanCandidatePool
{ coarseSpanId, candidates }

// DomainFilteredSpanSet
{ sameDomainCandidates, baseCandidates, fallbackCandidates, selectedCandidates }

// DomainAwareSpanReplacementPick
{ word, span, score, recallSource, repairTarget }
```

---

## 5. Orchestrator 合约（H1–H8）

### H1 — Result 语义

```ts
interface SpanAssemblyV4OrchestratorResult {
  spanSets: SpanReplacementPick[][];           // 必须 = domainAwareSpanSets
  shadowBeamSpanSets?: SpanReplacementPick[][];
  shadowBeamSentenceTexts?: string[];
  diagnostics: SpanAssemblyV4Diagnostics;
}
```

**禁止**：`spanSets = beam.spanSets`

### H2 — emptyResult

所有 metrics 字段须显式初始化为 `0`，禁止仅在成功路径赋值。

### H3 — 类型同步

新增 diagnostics 字段须同时出现在 `v4-types.ts`、`types.ts`、`fw-detector-v4-path.ts`。

### H4 — Trace 兼容

新增 `shadowBeamSpanSets`；保留 `beamSpanSets` 一个版本（Option A）。

### H5 — Vote 唯一入口

| 链 | 唯一 Vote 函数 | 用途 |
|----|----------------|------|
| Main | `voteUtteranceDomainFromPool` | 生产决策 |
| Shadow | `voteUtteranceDomain` | Diagnostics only |

### H6 — SpanSets 唯一来源

Main 的 `spanSets` **唯一**来自 `assembleDomainAwareSpanSets` 产出。

### H7 — Beam 退休（主链）

`runCoarseSentenceBeamV4` 产出仅写入 `shadowBeamSpanSets`。

### H8 — buildSentenceCandidates 输入

**禁止**传入 beam spanSets；仅接受 `domainAwareSpanSets`。

---

## 6. 行为合约（B01–B06）

| ID | 约束 |
|----|------|
| B01 | Pool 按 coarseSpanId 分组，不跨 span 混排 |
| B02 | Vote 基于 pool 内 candidate domain 统计，非 beam |
| B03 | Filter 保留 sameDomain/base/fallback 三桶 |
| B04 | Select 同 span 内按 priority + score 排序 |
| B05 | Assemble 输出与 coarse span 顺序对齐 |
| B06 | 空 pool / 无 vote 时返回合法 empty spanSets + 完整 metrics |

---

## 7. Metrics 冻结字段

| 字段 | 含义 |
|------|------|
| `domainCandidateCount` | filter 后 domain 桶总量 |
| `baseCandidateCount` | base 桶总量 |
| `sameDomainCandidateCount` | sameDomain 桶总量 |
| `domainFilteredSpanCount` | 有过滤结果的 span 数 |
| `selectedCandidatesPerSpanAvg` | 每 span 选中候选均值 |
| `domainAssemblyMs` | assembly 耗时 |
| `mainDomainAwareSpanSetsTotal` | Main span 条目总数 |
| `shadowBeamSpanSetsTotal` | Shadow beam 条目总数 |

---

## 8. SSOT 文件

| 类别 | 路径 |
|------|------|
| Assembly | `assemble-domain-aware-span-sets.ts` · `domain-assembly-types.ts` · `window-candidate-to-pick.ts` |
| Vote | `utterance-domain-vote.ts` |
| Orchestrator | `span-assembly-v4-orchestrator.ts` |
| Types | `v4-types.ts` · `types.ts` |
| Tests | `freeze-contract.test.ts` · `assemble-domain-aware-span-sets.test.ts` |

---

## 9. 禁止项（冻结内）

- 修改 Main/Shadow 隔离边界
- 将 Beam spanSets 接入 KenLM / Apply
- 新增 Vote 入口或替换 `voteUtteranceDomainFromPool`
- 静默修改 per-span priority 顺序

---

## 10. 后续阶段

| 模块 | 状态 |
|------|------|
| Assembly / Vote / Beam 主链 | **STOP** |
| Compatibility / Recall | **STOP** |
| KenLM runtime | **FROZEN**（batch-only，见 [kenlm/KENLM_RUNTIME.md](../kenlm/KENLM_RUNTIME.md)） |
