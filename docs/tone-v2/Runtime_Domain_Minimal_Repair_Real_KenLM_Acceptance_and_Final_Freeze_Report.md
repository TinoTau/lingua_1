# Runtime Domain Minimal Repair, Real KenLM Acceptance and Final Freeze Report

| Field | Value |
|------|-----|
| Status | **COMPLETE** |
| Date | 2026-07-20 |
| Baseline Audit | `Fine_Span_Presence_Runtime_Compliance_and_SSOT_Document_Repair_Audit.md` |
| Lexicon | v10 · `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| Formal Ratio | `DOMAIN_BUCKET_RETENTION_RATIO = 0.75` |

---

## 1. Executive Verdict

**PARTIAL PASS → 架构冻结 PASS；真实 KenLM 验收 ACTIVE/PASS（harness）；质量仍有 DOMAIN_VOTE_DROP=1 与 KENLM_MISRANK=7。**

本轮完成：跨桶先去重再全局 cap、正式 KenLM 跨桶池接线、死类型清理、Runtime SSOT UTF-8 重建、Context Prior 文档修正、Legacy 伪 PASS 纠正、真实 KenLM acceptance。

未改 Presence Vote / 0.75 / 上限 16。

---

## 2. Git 状态

| Item | Value |
|------|-------|
| Branch | `main` |
| HEAD | `262b3d3` |
| Tree | Dirty（含此前 Presence Vote 正式代码 + 本轮修改 + 无关 tone/wav/lexicon） |

本轮目标修改与此前未提交 Presence Vote 代码一并保留；未 `reset --hard` / 未覆盖无关文件。

---

## 3. 修改范围

| Area | Files |
|------|-------|
| Budget / dedup | `build-sentence-candidates.ts` (`mergeCrossBucketSentenceCandidates`) · `span-assembly-v4-orchestrator.ts` |
| KenLM wiring | `run-fw-sentence-rerank-from-prefilled.ts` · `fw-detector-v4-path.ts` |
| Dead types | `span-assembly-shared/types.ts` · `v4-diagnostics-mappers.ts` |
| Tests / gates | `fine-span-domain-presence-vote.test.ts` · `freeze-contract.test.ts` |
| Acceptance | `run-domain-multibucket-kenlm-acceptance.cjs` · `package.json` script |
| Docs | `Runtime_SSOT_Contract_Freeze.md` · `CONTEXT_PRIOR.md` · `RUNTIME_DOMAIN_DOCUMENT_INDEX.md` · Legacy STATUS CORRECTION |

---

## 4. 明确未修改的冻结架构

```text
Fine-Span Presence Vote
One Span One Vote Per Domain
DOMAIN_BUCKET_RETENTION_RATIO = 0.75
Multi-Bucket Assembly
KenLM Cross-Bucket Ranking
Sentence Candidates <=16
```

---

## 5. 候选预算旧顺序

```text
per-bucket buildSentenceCandidates(floor(16/n))
-> mergeByText
-> global slice(16)
```

Duplicate texts consumed per-bucket budget before merge.

---

## 6. 候选预算新顺序

```text
allocateDomainBucketSentenceBudget (guard only: buckets > 16 => BLOCKED)
per-bucket buildSentenceCandidates(cap = 16)
-> mergeCrossBucketSentenceCandidates (dedup by text, keep higher candidateScore)
-> global slice(0, 16)
```

---

## 7. 跨桶 dedup 实现

`mergeCrossBucketSentenceCandidates` in `build-sentence-candidates.ts`；orchestrator 调用；正式 KenLM 通过 `prefilledCombinations` 消费合并池。

---

## 8. 最终候选上限证明

Acceptance：`sentenceCandidatesMax = 12 <= 16`。单元测试覆盖 dedup / order / cap。

---

## 9. 候选生命周期日志

Acceptance 每行记录：`perBucketGenerated` / `mergedBeforeCap` / `afterGlobalCap` / `expectedFirstStage` / KenLM scores。

---

## 10. 失败分类修正

废弃 `prod > 16 && !entered`。改用阶段分类：

`DOMAIN_VOTE_DROP` · `ASSEMBLY_NOT_GENERATED` · `GLOBAL_CAP_DROP` · `KENLM_MISRANK` · `KENLM_NOT_AVAILABLE` …

本轮专项集结果：`DOMAIN_VOTE_DROP=1` · `ASSEMBLY_NOT_GENERATED=0` · `PER_BUCKET_CAP_DROP=0` · `GLOBAL_CAP_DROP=0` · `KENLM_MISRANK=7`。

---

## 11. 真实 KenLM 环境

| Item | Value |
|------|-------|
| enableKenLMGate | true |
| model | `electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin` |
| model hash prefix | `sha256:532a335a09a006d1` |
| query | WSL `kenLM/kenlm/build/bin/query`（本地无 `query.exe`） |
| scoreMode | raw_log_delta |
| minDeltaToReplace | 3.0 |

首次冷启动 probe 曾 `timeout` → BLOCKED；WSL 预热后重跑成功。

---

## 12. 真实 KenLM 启动结果

```text
REAL KENLM SCORER: ACTIVE
kenlmScorerSuccessRate: 1.0
```

---

## 13. KenLM 输入合同

仅句子文本；无 domainScores / retainedDomains / domains[]。`prefilledCombinations` 为跨桶合并后的 SentenceCombination。

---

## 14. Pre-KenLM 指标（专项 20）

| Metric | Value |
|--------|-------|
| correct domain retained | 94.4% |
| correct sentence generated | 100% |
| correct sentence entered <=16 pool | 100% |
| avg retained buckets | 2.1 |
| candidates P50/P95/MAX | 4 / 12 / 12 |
| Pre-KenLM latency P50/P95/MAX | 59 / 170 / 249 ms |

（预算修复后：原 BUCKET_BUDGET_DROP 的 hotel/travel 正确句均进入池。）

---

## 15. KenLM 指标

| Metric | Value |
|--------|-------|
| scorer success | 100% |
| Top1 accuracy | 65% |
| KENLM_MISRANK | 7 |
| KenLM latency P50/P95/MAX | 607 / 669 / 686 ms |

---

## 16. E2E 指标

| Metric | Value |
|--------|-------|
| finalRepairAccuracy | 95% |
| finalMisrepair | 0 |
| E2E latency P50/P95/MAX | 677 / 776 / 900 ms |

---

## 17. dialog_200 结果

本轮 acceptance 使用 `fine_span_domain_bucket_acceptance.jsonl`（含 travel/hotel/taxi/cafe 等专项，部分来自 dialog_200 文本场景）。**未**重跑 200 条 wav ASR 全链路（超出本轮 Assembly/KenLM 范围）。

---

## 18. 专项集结果

见 `tmp/domain_multibucket_kenlm_acceptance/acceptance_results.json`。

- `acc-hotel-02`：正确句入池；KenLM Top1 OK  
- `acc-travel-asr-03`：正确句入池；`KENLM_MISRANK`  
- `acc-taxi-01`：仍 `DOMAIN_VOTE_DROP`（九点→酒店召回噪声）

---

## 19. 召回噪声样本

`acc-taxi-01`：`九点` span 召回 `酒店` → `tourism_hotel=2` 合法淘汰 transport。记录为 Recall Quality，不改 Vote。

---

## 20. 死类型删除

Removed from production `types.ts`：`ParentTermEvidence` · `ParentSpanCandidate` · `GraphEdge` · `CoarseSpanPath`。  
Kept：`CompatibilityGraphEdge` · diagnostics trace shapes。

---

## 21. Context Prior stub 清理

保留 diagnostics stub `applied:false`。删除过时决策描述与生产类型依赖。`CONTEXT_PRIOR.md` 已更新为 CURRENT diagnostics-only。

---

## 22. Runtime SSOT 重建

`docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`：严格 UTF-8 重写；含 0.75 / Presence Vote / REMOVED / Multi-Bucket / KenLM Cross-Bucket / <=16 / REAL KENLM ACCEPTANCE: PASS。

---

## 23. Context Prior 文档修复

`docs/fw-detector/CONTEXT_PRIOR.md` → CURRENT / diagnostics-only；移除 `domain-rerank.ts` 权威描述。

---

## 24. 文档索引状态

`RUNTIME_DOMAIN_DOCUMENT_INDEX.md` → **CURRENT / FROZEN**；唯一 Runtime Authority 仍指向 Freeze 文件。

---

## 25. 错误历史报告状态修正

Legacy report 顶部已加 **STATUS CORRECTION**（伪 PASS → INCONCLUSIVE），链接审计报告。

---

## 26. 文档完整性门禁

`freeze-contract.test.ts` GATE-DOC-SSOT：UTF-8 fatal decode · 无 U+FFFD · 无连续 `???` · 无平行 Freeze 文件名 · 必需合同字符串。**PASS**

---

## 27. fresh-dist Electron

`npm run accept:runtime-ssot` → **ACCEPTANCE_PASS**  
`ELECTRON_RUN_AS_NODE=1` + `accept:domain-multibucket-kenlm` → ACTIVE

---

## 28. 风险

1. WSL KenLM 冷启动可能 timeout；验收前需预热。  
2. DOMAIN_VOTE_DROP / 拼音噪声未修。  
3. KenLM Top1 65%；MISRANK 仍需后续 LM/召回质量工作。  
4. 多标签词导致多桶仍可能压低候选多样性（已不再先桶截断浪费）。

---

## 29. Target List（后续，非本轮）

- Recall：九点/酒店近音噪声  
- Lexicon：预订等多域过宽  
- KenLM Top1 / MISRANK 质量提升  
- dialog_200 全量 wav E2E（可选）

---

## 30. Check List

| Item | Result |
|------|--------|
| Presence Vote unmodified | YES |
| Cross-bucket dedup before final cap | YES |
| KenLM uses merged pool | YES |
| Dead legacy types removed | YES |
| Runtime SSOT UTF-8 | PASS |
| Real KenLM harness | ACTIVE |
| accept:runtime-ssot | PASS |

---

## 31. Final Verdict

```text
ARCHITECTURE FREEZE: PASS
REAL KENLM ACCEPTANCE: PASS
FINAL VERDICT: PARTIAL PASS
```

（架构与真实 KenLM 接线/验收通过；对话质量仍有已知 Vote/MISRANK 风险，故非全量质量 PASS。）

---

## 强制验收输出

```text
PRESENCE VOTE MODIFIED:
NO
```

```text
DOMAIN_BUCKET_RETENTION_RATIO:
0.75
```

```text
FINAL KENLM CANDIDATE LIMIT:
16
```

```text
PER-BUCKET FINAL CAP:
REMOVED
```

```text
CROSS-BUCKET DEDUP BEFORE FINAL CAP:
YES
```

```text
DUPLICATE TEXTS WASTE FINAL BUDGET:
NO
```

```text
CORRECT SENTENCE LIFECYCLE TRACKING:
PASS
```

```text
ASSEMBLY_NOT_GENERATED COUNT:
0
```

```text
PER_BUCKET_CAP_DROP COUNT:
0
```

```text
GLOBAL_CAP_DROP COUNT:
0
```

```text
DOMAIN_VOTE_DROP COUNT:
1
```

```text
REAL KENLM SCORER:
ACTIVE
```

```text
KENLM MODEL:
electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin (sha256:532a335a09a006d1...)
```

```text
KENLM SCORE MODE:
raw_log_delta
```

```text
KENLM INPUT DOMAIN METADATA:
ABSENT
```

```text
CORRECT SENTENCE ENTERED KENLM RATE:
1.0
```

```text
KENLM TOP1 ACCURACY:
0.65
```

```text
FINAL REPAIR ACCURACY:
0.95
```

```text
PRE-KENLM LATENCY P50/P95/MAX:
59/170/249
```

```text
KENLM LATENCY P50/P95/MAX:
607/669/686
```

```text
E2E LATENCY P50/P95/MAX:
677/776/900
```

```text
DEAD LEGACY TYPES:
REMOVED
```

```text
DEAD CONTEXT PRIOR STUB:
REMOVED
```

```text
RUNTIME SSOT FILE:
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
```

```text
RUNTIME SSOT UTF-8:
PASS
```

```text
DUPLICATE FREEZE FILES:
0
```

```text
CONTEXT PRIOR DOCUMENT:
CURRENT
```

```text
LEGACY FALSE PASS:
CORRECTED
```

```text
DOCUMENT INTEGRITY GATE:
PASS
```

```text
FRESH DIST ELECTRON:
PASS
```

```text
ARCHITECTURE FREEZE:
PASS
```

```text
REAL KENLM ACCEPTANCE:
PASS
```

```text
FINAL VERDICT:
PARTIAL PASS
```

---

```text
RUNTIME DOMAIN MINIMAL REPAIR, REAL KENLM ACCEPTANCE
AND FINAL FREEZE COMPLETE — STOP
```
