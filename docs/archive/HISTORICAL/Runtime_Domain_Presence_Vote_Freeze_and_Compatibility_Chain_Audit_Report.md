<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Runtime_Domain_Presence_Vote_Freeze_and_Compatibility_Chain_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Runtime Domain Presence Vote Freeze and Compatibility Chain Audit Report

| Field | Value |
|------|-------|
| Status | **FREEZE AND CLEANUP PASS** |
| Date | 2026-07-20 |
| Acceptance Baseline | [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md) |
| Completeness Baseline | [`Runtime_Domain_Presence_Vote_End_to_End_Completeness_Audit.md`](./Runtime_Domain_Presence_Vote_End_to_End_Completeness_Audit.md) |
| Sole Runtime Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |

---

## 1. Executive Verdict

Presence Vote 验收结论保持成立；本轮完成 Accepted Result Freeze，并删除已确认无生产调用方的兼容分支（尤其是 `prefilledCombinations === undefined → buildSentenceCandidates(spanSets)` legacy rebuild）。

```text
FINAL VERDICT:
FREEZE AND CLEANUP PASS
```

功能冻结 ≠ 质量冻结。Lexicon / KenLM / Recall noise / dialog_200 E2E 明确 OUT OF SCOPE。

---

## 2. Git Status

- Branch: `main` @ `262b3d3`
- 工作树在本轮前已脏（Presence Vote / tone / docs 既有改动）
- 本轮新增/收敛触及（兼容清理 + 冻结门禁 + 文档）：
  - `kenlm/run-fw-sentence-rerank-from-prefilled.ts`（`prefilledCombinations` required）
  - `span-assembly-v4/v4-diagnostics-{types,trace,mappers}.ts`、`types.ts`、`v4-limits.ts`（Shadow/Beam diagnostics 残留清理）
  - `candidate-compatibility-graph.ts`（删除 deprecated wrappers）
  - `span-assembly-shared/matched-domain.ts`（无调用死代码删除）
  - `freeze-contract.test.ts`、`domain-presence-vote-acceptance.test.ts`
  - `Runtime_SSOT_Contract_Freeze.md` + supporting docs 状态行
- 未执行 `git reset --hard`；未提交。

---

## 3. Scope

### In scope

```text
Part A: freeze accepted Presence Vote results + freeze-contract gates + docs
Part B: audit/remove legacy compatibility chains with no ACTIVE PRODUCTION callers
```

### Out of scope (unchanged)

```text
Presence Vote formula
DOMAIN_BUCKET_RETENTION_RATIO (0.75)
Multi-Bucket behavior
Candidate cap 16
KenLM scoring / delta gate
Recall ranking
Lexicon content
Tone / ASR / NMT
```

---

## 4. Accepted Baseline

前置结论未推翻；源码与验收报告一致：

```text
PRESENCE VOTE FUNCTIONAL ACCEPTANCE: PASS
PRESENCE VOTE ARCHITECTURE FREEZE: PASS
BLOCKING FUNCTIONAL GAPS: NONE
```

引用：`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`。

---

## 5. Frozen Components

```text
FROZEN:
Domain Fact propagation
FineSpanDomainSet
One Span One Vote
0.75 retainedDomains
Multi-Bucket Assembly
Base enters every bucket
Cross-bucket dedup
Candidate cap 16
KenLM merged-pool boundary
Context Prior diagnostics-only
prefilledCombinations: required
```

```text
NOT FROZEN:
Lexicon content quality
KenLM ranking quality
Recall noise quality
dialog_200 full E2E quality
```

---

## 6. Freeze Contract Changes

| Change | Location |
|--------|----------|
| Section 0 ACCEPTED AND FROZEN + FROZEN/NOT FROZEN | `Runtime_SSOT_Contract_Freeze.md` |
| `prefilledCombinations: required`；`[]` = fail-open raw | SSOT §20 + KenLM runtime |
| Supporting docs status line citing Final Acceptance | Index / DSU / DOMAIN_RECALL / FROZEN_V1_2 / ARCHITECTURE / KENLM_RUNTIME |
| GATE-FREEZE-PRESENCE + strengthened KenLM prefilled gates | `freeze-contract.test.ts` |
| T10b asserts required prefilled (no undefined rebuild) | `domain-presence-vote-acceptance.test.ts` |

Sole Runtime Authority 未变；supporting docs 不复制整套合同。

---

## 7. Production Call Graph

```text
STEP_REGISTRY.FW_SPAN_DETECTOR
→ fw-detector-step
→ fw-detector-orchestrator
→ fw-detector-v4-path
→ span-assembly-v4-orchestrator
→ voteUtteranceDomainFromPool (Presence Vote, once / utterance)
→ runDomainAwareAssembly (Multi-Bucket; Base in every bucket)
→ mergeCrossBucketSentenceCandidates (cap 16)
→ runFwSentenceRerankFromPrefilled({ prefilledCombinations: combinations ?? [] })
→ rerankFwSentences
→ output
```

旁路检查：

| Path | Result |
|------|--------|
| `runFwDetectorV3Path` / V2 entry | 生产源码无 ACTIVE 入口；freeze gate 禁止引用 |
| Domain Rerank | `domain-rerank.ts` 已删除 |
| Shadow Beam production | orchestrator 无 ACTIVE 调用；本轮清掉 diagnostics 残留 |
| Electron IPC fallback 绕过 V4 | 未发现可绕过正式 Vote→Multi-Bucket→merged prefilled 的 ACTIVE 生产旁路 |

---

## 8. Compatibility Keyword Search

| Keyword | Classification summary |
|---------|------------------------|
| `legacy` / `compat` / `deprecated` | 多为归档路径、config 兼容读、测试断言；领域决策链无 ACTIVE LEGACY |
| `shadow` / `shadowBeam*` | 实验脚本/历史字段读；生产 orchestrator = 0 |
| `prefilledCombinations` | 正式 required；生产始终传入 |
| `buildSentenceCandidates(spanSets)` | Assembly 桶内生成仍用；KenLM rerank 文件内已无 |
| `runFwSentenceRerankFromPrefilled` | 生产仅 `fw-detector-v4-path` |
| `runFwDetectorV3` / `V2` | 无 ACTIVE 生产入口 |
| `domain-rerank` / `VoteMass` / `SOURCE_WEIGHT` | 已删除 / freeze gate |
| `winnerDomain` / `primaryDomain` | diagnostics / weak-plan / fwSpans label；非正式建桶 |
| `domains[0]` / `domainId` | DB/row/IME；非 Vote/retention/bucket 决策 |
| `runCoarseSentenceBeamV4` | 文件已删；orchestrator 无引用 |

---

## 9. Compatibility Chain Inventory

| Chain | File / Function | Caller | Classification | Action | Evidence |
| ----- | --------------- | ------ | -------------- | ------ | -------- |
| Prefillled required path | `runFwSentenceRerankFromPrefilled` | `fw-detector-v4-path.ts` | ACTIVE REQUIRED | KEEP | 始终传 `combinations ?? []` |
| Prefillled acceptance runner | same | `run-domain-multibucket-kenlm-acceptance.cjs` | TEST ONLY | KEEP | 实验验收传入 prefilled |
| Prefillled unit tests | same | `domain-presence-vote-acceptance.test.ts` | TEST ONLY | KEEP | T9/T10/T10b |
| Legacy undefined rebuild | `prefilledCombinations === undefined → buildSentenceCandidates(spanSets)` | none (was internal branch) | DEAD / UNREACHABLE | REMOVE | 生产调用方 0；已删 |
| Shadow Beam production | `runCoarseSentenceBeamV4` / `shadowBeamSpanSets` | none in orchestrator | DEAD / UNREACHABLE | REMOVE | 文件已删；本轮清 diagnostics |
| Domain Rerank | `domain-rerank.ts` / VoteMass | none | DEAD / UNREACHABLE | REMOVE | 文件不存在；freeze gate |
| Deprecated graph wrappers | `dropIncompatibleCandidates` / `findIncompatiblePairs` | tests only | TEST ONLY → DEAD | REMOVE | 本轮删除 + 测例清理 |
| First-domain picker | `matched-domain.ts` | none | DEAD / UNREACHABLE | REMOVE | 本轮删除 |
| `primaryDomain` fwSpans label | `span-assembly-v4-orchestrator` `retainedDomains[0]` | `buildFwSpansFromCoarseAssemblyV4` | ACTIVE REQUIRED (diagnostics) | KEEP | 不建正式桶；桶遍历 `retainedDomains` |
| Context Prior | `context-prior.ts` / v4-path `applied:false` | v4-path | ACTIVE REQUIRED | KEEP | diagnostics-only |
| Archived ASR repair | `legacy/asr-repair/*` | freeze asserts archive exists | DOCUMENT/ARCHIVE | KEEP | 非 Domain Vote 决策链 |
| Experiment shadow field readers | `tests/experiments/*.mjs` | offline scripts | TEST ONLY | NO ACTION | 非生产 |

---

## 10. Prefilled Legacy Rebuild Audit

### Callers of `runFwSentenceRerankFromPrefilled`

| File | Function / site | Class | Passes prefilled? | Can be undefined? |
|------|-----------------|-------|-------------------|-------------------|
| `fw-detector-v4-path.ts` | V4 KenLM wiring | PRODUCTION | `?? []` always | No |
| `run-domain-multibucket-kenlm-acceptance.cjs` | acceptance runner | TEST / experiment | yes | No |
| `domain-presence-vote-acceptance.test.ts` | T9/T10 | TEST ONLY | yes / `[]` | No |

```text
ACTIVE PRODUCTION CALLERS USING UNDEFINED PREFILLED: 0
PREFILLED COMBINATIONS REQUIRED: YES
LEGACY PREFILLED REBUILD: REMOVED
```

`[]` 语义：明确无候选 → fail-open raw；禁止重建 primary spanSets。

---

## 11. Shadow / Beam Audit

| Item | Status |
|------|--------|
| `runCoarseSentenceBeamV4.ts` | 已删除（先前轮次） |
| orchestrator Shadow 调用 | 0 |
| diagnostics `pushBeamSpanSet` / Beam types | 本轮删除 |
| Historical reports mentioning Shadow | 保留；标 SUPERSEDED/HISTORICAL 由既有索引约束 |

```text
ACTIVE SHADOW CHAINS: 0
```

---

## 12. Domain Rerank Audit

| Item | Status |
|------|--------|
| `domain-rerank.ts` | 不存在 |
| VoteMass / SOURCE_WEIGHT / applyDomainVoteToEdges | 生产 Vote 源码无；freeze gate |

```text
ACTIVE DOMAIN RERANK CHAINS: 0
```

---

## 13. primaryDomain / winnerDomain Audit

| Use | Role | Verdict |
|-----|------|---------|
| `retainedDomains[0]` → `primaryDomain` → `fwSpans.domain` / diagnostics | diagnostics label | KEEP |
| `profile.primaryDomain` → Context Prior merge | diagnostics | KEEP |
| Multi-Bucket 建桶 | 遍历全部 `retainedDomains` | REQUIRED；非 shortcut |

```text
ACTIVE SINGLE-DOMAIN ASSEMBLY SHORTCUTS: 0
```

---

## 14. domainId / domains[0] Audit

| Location | Role | Verdict |
|----------|------|---------|
| SQL / TierRow / IME TSV `domainId` | 行结构 | KEEP |
| `WindowCandidate.domains[]` | 完整传播 | REQUIRED |
| Vote / retention / bucket / KenLM | 不使用 `domains[0]` 决策投影 | PASS |

---

## 15. V2 / V3 Path Audit

| Item | Verdict |
|------|---------|
| `runFwDetectorV3Path` | 无生产入口；测试禁止引用 |
| 文件名含 v2/v3 的 shared utility（如 lexicon-runtime-v2、recall-span-topkv3） | 仍被 V4 主链使用 → KEEP by call graph，不因文件名删除 |

---

## 16. Removed Code (this round)

1. `run-fw-sentence-rerank-from-prefilled.ts`：optional `prefilledCombinations?` + undefined → `buildSentenceCandidates(spanSets)` 分支  
2. Shadow/Beam diagnostics types、push APIs、相关 mapper helpers、trace 字段限额残留  
3. `dropIncompatibleCandidates` / `findIncompatiblePairs` deprecated exports + 对应测试  
4. `matched-domain.ts`（无调用首域挑选器）

先前轮次已删除且本轮确认仍不存在：`domain-rerank.ts`、`run-coarse-sentence-beam-v4.ts` 等。

---

## 17. Kept Compatibility

| Item | Why KEEP |
|------|----------|
| `primaryDomain` diagnostics label | 非正式建桶；删除需更大范围 diag 合同改动且非本轮目标 |
| Context Prior stub `applied:false` | 正式合同要求 diagnostics-only |
| Archived `legacy/asr-repair` | 非 Domain Vote 双链路；freeze 明确归档存在 |
| Experiment scripts reading historical diag keys | TEST ONLY；非生产 |

无「为将来可能有用」而 KEEP 的 ACTIVE LEGACY 双链路。

---

## 18. Blocked Items

```text
NONE
```

---

## 19. Document Updates

| Doc | Update |
|-----|--------|
| `Runtime_SSOT_Contract_Freeze.md` | ACCEPTED AND FROZEN；FROZEN/NOT FROZEN；prefilled required |
| `RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | Presence Vote status + Accepted Audits 条目 |
| `DOMAIN_SOURCE_UNIFICATION.md` | status cite |
| `DOMAIN_RECALL.md` | status cite |
| `FROZEN_V1_2.md` | status cite |
| `ARCHITECTURE.md` | status cite |
| `KENLM_RUNTIME.md` | prefilled required + status cite |

未创建第二份 Runtime SSOT。

---

## 20. Test Results

| Command | Result |
|---------|--------|
| `npx tsc --project tsconfig.main.json --noEmit` | PASS |
| `npx jest --testPathPattern=domain-presence-vote` | PASS (35) |
| `npx jest --testPathPattern=fine-span-domain-presence-vote` | PASS (18) |
| `npx jest --testPathPattern=freeze-contract` | PASS (86) |
| `npm run test:fw-detector` | PASS (273) |
| `npm run accept:runtime-ssot` | PASS (`ACCEPTANCE_PASS`) |

---

## 21. Remaining Risks

1. KenLM Top1 / cold-start 质量未冻结  
2. Recall noise 未冻结  
3. dialog_200 全量 wav E2E 未作为本轮门禁  
4. 工作树仍含与本轮无关的既有脏改动（未 commit；未 reset）  
5. `primaryDomain` diagnostics 标签仍取 `retainedDomains[0]`——允许但需继续禁止滑入正式建桶

---

## 22. Target List

| Target | Status |
|--------|--------|
| Freeze accepted Presence Vote | DONE |
| Sole runtime Vote path | DONE |
| Remove legacy prefilled rebuild | DONE |
| Remove dead Shadow/Rerank remnants | DONE |
| Docs ACCEPTED AND FROZEN | DONE |
| Quality freeze | OUT OF SCOPE |

---

## 23. Check List

| Gate | Result |
|------|--------|
| F1 Accepted Contract | PASS |
| F2 Sole Runtime Path | PASS |
| F3 No Parallel Decision Chain | PASS |
| F4 KenLM Input merged prefilled | PASS |
| F5 Legacy Rebuild = 0 | PASS |
| F6 Dead domain compatibility removed | PASS |
| F7 Documents / sole SSOT | PASS |
| F8 Tests | PASS |

---

## 24. Final Verdict

```text
PRESENCE VOTE FUNCTIONAL ACCEPTANCE:
PASS

PRESENCE VOTE ARCHITECTURE FREEZE:
PASS

SOLE RUNTIME AUTHORITY:
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md

PRODUCTION VOTE CHAINS:
1

PARALLEL VOTE CHAINS:
0

ACTIVE SHADOW CHAINS:
0

ACTIVE DOMAIN RERANK CHAINS:
0

ACTIVE SINGLE-DOMAIN ASSEMBLY SHORTCUTS:
0

PREFILLED COMBINATIONS REQUIRED:
YES

LEGACY PREFILLED REBUILD:
REMOVED

ACTIVE PRODUCTION CALLERS USING UNDEFINED PREFILLED:
0

ACTIVE LEGACY COMPATIBILITY CHAINS:
0

DEAD COMPATIBILITY CODE REMOVED:
YES

DOMAIN_BUCKET_RETENTION_RATIO:
0.75

FINAL SENTENCE CANDIDATE LIMIT:
16

CONTEXT PRIOR:
DIAGNOSTICS_ONLY

KENLM NORMAL INPUT:
MERGED_PREFILLED_POOL

RUNTIME DOMAIN DOCUMENTATION:
FROZEN

LEXICON QUALITY:
OUT OF SCOPE

KENLM QUALITY:
OUT OF SCOPE

BLOCKING ISSUES:
NONE

FINAL VERDICT:
FREEZE AND CLEANUP PASS
```

---

```text
RUNTIME DOMAIN PRESENCE VOTE
ACCEPTED RESULT FROZEN
AND LEGACY COMPATIBILITY CHAINS REMOVED — STOP
```
