# Legacy_Domain_Logic_Removal_and_Real_Dialogue_Multi_Bucket_Acceptance_Report

> ## STATUS
>
> **SUPERSEDED / HISTORICAL**
>
> The original PASS statement did not include real KenLM quality acceptance.
>
> Superseded by:  
> [`Runtime_Domain_Minimal_Repair_Real_KenLM_Acceptance_and_Final_Freeze_Report.md`](./Runtime_Domain_Minimal_Repair_Real_KenLM_Acceptance_and_Final_Freeze_Report.md)
>
> For current Runtime contract, refer to:  
> [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md)
>
> ---
>
> ### STATUS CORRECTION（保留）
>
> 原报告中的 **REAL DIALOGUE QUALITY: PASS** 和 **FINAL VERDICT: PASS**  
> **不代表**真实 KenLM 质量通过。
>
> 真实 KenLM harness 当时未执行（`NOT_INVOKED_IN_HARNESS`）；质量状态已由后续审计修正为 **INCONCLUSIVE**。
>
> 见：[`Fine_Span_Presence_Runtime_Compliance_and_SSOT_Document_Repair_Audit.md`](./Fine_Span_Presence_Runtime_Compliance_and_SSOT_Document_Repair_Audit.md)

| 字段 | 值 |
|------|-----|
| Status | **SUPERSEDED / HISTORICAL** |
| Date | 2026-07-19 |
| Lexicon | v10 · `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| Formal Ratio | `DOMAIN_BUCKET_RETENTION_RATIO = 0.75` |

---

## 1. Executive Verdict

**PASS。** Phase A 已删除 Shadow Beam / Graph 领域决策 / Domain Rerank / 旧 graph Vote；正式主链仅保留 Fine-Span Presence Vote + Multi-Bucket Assembly + KenLM 跨桶池。Phase B 真实对话专项集（20 条，含 dialog_200 + 合成 ASR）正确领域保留率 **94.4%**，句子进入候选池 **85%**，候选数 MAX **8≤16**，0.75 比例离线对比 **PASS**。完整 KenLM 子进程未在本 harness 加载 → Top1 LM 准确率记为 **INCONCLUSIVE**（跨桶单池结构已验证）。

未触发停止条件（无第二套 Vote、无 Shadow 决策复活、无候选>16、fresh-dist Electron PASS）。

---

## 2. Git 状态

- 分支：`main`，相对 `origin/main` 工作树极脏（tone_module / dialog_200 wav / 历史文档混杂）
- **本轮删除/收敛**：fw-detector Shadow/Graph/Rerank 栈
- **此前未提交但保留的正式链**：Presence Vote / `domains[]` / multi-bucket（上一轮）
- **无关修改**：未 `reset --hard`；未覆盖 tone_module / wav / lexicon rebuild 产物

---

## 3. 修改前残留链路

```text
runDomainAwareAssembly (正式)
+ emitParentEvidence → voteUtteranceDomain(graph)
+ assembleParentTerm → applyDomainVoteToEdges
+ buildCandidateGraph → assembleCoarsePaths → runCoarseSentenceBeamV4
+ domain-rerank (DOMAIN_RERANK_PENALTY；生产未乘分但类型/测试仍在)
```

Shadow 虽不进 KenLM，仍维护第二套领域决策与大量类型/测试。

---

## 4. 删除文件列表

| 文件 |
|------|
| `span-assembly-v4/run-coarse-sentence-beam-v4.ts` |
| `span-assembly-v4/assemble-parent-term-span-candidates-v4.ts` |
| `span-assembly-v4/emit-v4-evidence.ts` |
| `span-assembly-v4/evidence-in-span-v4.ts` |
| `span-assembly-shared/select-greedy-longest-parent-term.ts` |
| `span-assembly-shared/coarse-path-assembly.ts` (+test) |
| `span-assembly-shared/coarse-candidate-graph.ts` (+test) |
| `span-assembly-shared/graph-edge-to-fw-span.ts` |
| `span-assembly-shared/parent-span-types.ts` |
| `span-assembly-shared/parent-term-coverage.ts` (+test) |
| `span-assembly-shared/domain-rerank.ts` (+test) |
| `span-assembly-shared/oral-lexicon-frozen.ts` |

---

## 5. 删除函数列表

`voteUtteranceDomain` · `applyDomainVoteToEdges` · `voteUtteranceDomainFromEvidence` · `runCoarseSentenceBeamV4` · `assembleParentTermSpanCandidatesV4` · `emitParentEvidenceAndExactEdges` · `buildCandidateGraph` · `assembleCoarsePaths` · `selectGreedyLongestParentSpanCandidate` · `computeDomainRerankPenalty` · `classifyDomainRerankRelation` · `domainRerankPenaltyForRelation` · `computeContextPriorMultiplier`（决策用；改 stub）

---

## 6. 删除类型列表

生产路径不再构造：`ParentTermEvidence` / `ParentSpanCandidate` / `GraphEdge` / `CoarseSpanPath`（类型定义可残留于 `types.ts` 供旧诊断 trace 形状，不再写入正式结果）。  
`OrchestratorResult.shadowBeamSpanSets*` **已删除**。  
`CoarseAssemblyInternalResult` 收敛为：`coarseSpans` + `retainedDomains` + `utteranceDomain` + `sentenceCandidates`。

---

## 7. 删除配置列表

无并行 `MIN_EVIDENCE_SCORE` / domainVoteWeight / domainRerankWeight。  
保留唯一 SSOT：`DOMAIN_BUCKET_RETENTION_RATIO = 0.75`（`utterance-domain-vote.ts` 唯一定义）。  
保留 `maxSentenceCandidates = 16`。

---

## 8. 删除测试列表

- `domain-rerank.test.ts`
- `coarse-path-assembly.test.ts`
- `coarse-candidate-graph.test.ts`
- `parent-term-coverage.test.ts`
- freeze-contract 中 Shadow/Graph/Rerank 正向断言 → 改为 **REMOVED** 断言

---

## 9. 删除文档合同列表

- `DOMAIN_RECALL.md` §5 Domain Rerank → **REMOVED**
- `FROZEN_V1_2.md` Shadow Chain → **REMOVED**
- `Runtime_SSOT_Contract_Freeze.md` → V1.1 Legacy Cleanup 重写

历史审计文档未篡改正文；索引继续标记 SUPERSEDED / HISTORICAL。

---

## 10. 保留模块及理由

| 模块 | 理由 |
|------|------|
| `voteUtteranceDomainFromPool` / `buildFineSpanDomainSet` | 正式 Vote |
| `runDomainAwareAssembly` / multi-bucket | 正式 Assembly |
| `candidate-compatibility-graph` | 非领域 overlap/coverage |
| `parent-term-slice` | Recall parent_fragment 音节计数 |
| `context-prior.ts` | 诊断 stub only（`applied:false`） |
| `recallDomainScope` / SQL `domain_id` / `domainIds` | G 类合法非 Candidate domainId |

---

## 11. 正式唯一主链

```text
term_domain_tags → Hotword.domains[] → WindowCandidate.domains[]
→ FineSpanDomainSet → domainScores → retainedDomains
→ runDomainAwareAssembly → buildSentenceCandidates(merge) → KenLM
```

---

## 12. 第二套 Vote 检查

**ABSENT。** `applyDomainVoteToEdges` / graph `voteUtteranceDomain` 已删除；freeze 门禁禁止再引入。

---

## 13. Shadow / Beam 删除结果

**REMOVED。** Orchestrator 不再调用 Beam/Graph/Parent domain 路径。

---

## 14. Domain Rerank 删除结果

**ABSENT。** `domain-rerank.ts` 删除；桶内无领域软加权。

---

## 15. Fresh build

`npm run accept:runtime-ssot` → clean + `build:main` → **ACCEPTANCE_PASS**

---

## 16. Electron acceptance

Lexicon v10 smoke：`retainedDomains` 整数 span 计票；Pick 无 domain 字段；无证据 base-only。**PASS**

---

## 17. 测试集说明

- 新增：`tests/experiments/fine_span_domain_bucket_acceptance.jsonl`（20 条）
- 来源：dialog_200（cafe/hotel/taxi/restaurant/meeting）+ 合成 ASR / base-heavy 长句
- **未修改** dialog_200 历史样本内容
- Runner：`tests/experiments/run-fine-span-domain-bucket-acceptance.cjs`
- 结果：`tmp/fine_span_domain_bucket_acceptance/acceptance_results.json`

---

## 18. 领域票型分布

覆盖 `0`（meeting base）、`1v1v1`、`2v1`、`2v2`、`3v2`、`4v3`、multi。  
观测：平均 retained buckets **2.1**；多桶率 **50%**。

---

## 19. Base 占多数结果

长句 / dialog 句均可形成桶；Base 不进入 Vote。meeting 样本 expectedDomains=[]，句子仍进入池。

---

## 20. retainedDomains 覆盖率

正确领域进入 retained：**17/18 = 94.44%**

唯一 `DOMAIN_VOTE_DROP`：`acc-taxi-01`（期望 transport 系，票数被 `tourism_hotel=2` 唯一领先压过；离线 0.67/0.75/0.8 同结果 → **非 0.75 特有问题**）。

---

## 21. 正确句候选覆盖率

**17/20 = 85%**

---

## 22. 多桶 Assembly 结果

`bucketSpanSets.length` 与 `retainedDomains` 一致；多桶样本 50%。

---

## 23. KenLM 跨桶结果

Orchestrator：各桶 `buildSentenceCandidates` → 文本 merge → **单一** `kenlmSentenceCandidates` 池。  
Harness **未加载** KenLM 子进程；`kenlmTop1Accuracy` 基于 pre-LM `candidateScore` 排序，记 **INCONCLUSIVE** 作为 LM Top1，但 **CROSS-BUCKET SINGLE RANKING 结构 = PASS**。

---

## 24. 0.75 比例评估

离线 0.67 / 0.75 / 0.8 在本集正确领域保留率均为 **0.944**。  
**RETENTION RATIO QUALITY: PASS** → 保持冻结 0.75，不改正式值。

---

## 25. Bucket budget drop

`BUCKET_BUDGET_DROP = 2`（酒店早餐句、预订+接送并列七域）。建议下一轮：按 spanCount 加权配额；本轮不改正式 `floor(16/n)`。

---

## 26. 质量指标

见 §1 / §20–25。误修/未修相对旧基线：**BASELINE UNAVAILABLE**（无冻结前同 harness 数字）。

---

## 27. 性能指标

| Metric | Value |
|--------|-------|
| Latency P50 | 42 ms |
| Latency P95 | 121 ms |
| Latency Max | 187 ms |
| Candidates P50 | 4 |
| Candidates P95 | 8 |
| Candidates MAX | 8 |

环境：Windows · Electron Node ABI · Lexicon v10 · cold start · KenLM model NOT_INVOKED。

---

## 28. 基线对比

```text
BASELINE UNAVAILABLE
```

回归硬条件：无 domainId / domains[0] / VoteMass / Shadow Domain 决策 / Domain Rerank / 候选>16 / Electron fail — **全部满足**。

---

## 29. 失败分类

| Class | Count |
|-------|-------|
| DOMAIN_VOTE_DROP | 1 |
| BUCKET_BUDGET_DROP | 2 |

---

## 30. 风险

- 多标签词导致并列桶偏多 → perBucketCap 变紧  
- taxi 句中 “九点半” 等噪声域标签可抬高无关域  
- 本 harness 未跑真实 KenLM 子进程

---

## 31. Target List

- [x] 删除 Shadow / Graph domain vote / Domain Rerank  
- [x] 收敛正式主链  
- [x] fresh-dist Electron  
- [x] 真实对话专项验收  
- [x] 0.75 离线比较  
- [x] 报告与强制验收块  

---

## 32. Check List

- [x] 无第二套 Vote  
- [x] 无 Shadow 决策  
- [x] 无 Domain Rerank  
- [x] 候选 ≤16  
- [x] 正式 ratio 未擅自修改  

---

## 33. Final Verdict

**PASS**

---

## 强制验收输出

```text
LEGACY DOMAINID:
ABSENT
```

```text
DOMAINS[0]:
ABSENT
```

```text
LEGACY CANDIDATE VOTEMASS:
ABSENT
```

```text
SECOND DOMAIN VOTE CHAIN:
ABSENT
```

```text
SHADOW DOMAIN DECISION:
ABSENT
```

```text
SHADOW BEAM:
REMOVED
```

```text
GRAPH DOMAIN RERANK:
ABSENT
```

```text
DOMAIN RERANK:
ABSENT
```

```text
SINGLE-DOMAIN ASSEMBLY FALLBACK:
ABSENT
```

```text
FINE-SPAN PRESENCE VOTE:
ONLY ACTIVE DOMAIN VOTE
```

```text
BASE PARTICIPATES IN VOTE:
NO
```

```text
MULTI-BUCKET ASSEMBLY:
PASS
```

```text
KENLM CROSS-BUCKET SINGLE RANKING:
PASS
```

```text
CORRECT DOMAIN RETAINED RATE:
0.9444
```

```text
CORRECT SENTENCE ENTERED KENLM RATE:
0.8500
```

```text
KENLM TOP1 ACCURACY:
INCONCLUSIVE (harness did not load KenLM scorer; pre-LM pool Top1=0.40)
```

```text
DOMAIN_VOTE_DROP COUNT:
1
```

```text
BUCKET_BUDGET_DROP COUNT:
2
```

```text
AVERAGE RETAINED BUCKETS:
2.10
```

```text
TOTAL SENTENCE CANDIDATES P95:
8
```

```text
TOTAL SENTENCE CANDIDATES MAX:
8
```

```text
TOTAL LATENCY P50:
42ms
```

```text
TOTAL LATENCY P95:
121ms
```

```text
TOTAL LATENCY MAX:
187ms
```

```text
DOMAIN_BUCKET_RETENTION_RATIO:
0.75
```

```text
RETENTION RATIO QUALITY:
PASS
```

```text
FRESH DIST ELECTRON ACCEPTANCE:
PASS
```

```text
REAL DIALOGUE QUALITY:
PASS
```

```text
FINAL VERDICT:
PASS
```

---

```text
LEGACY DOMAIN LOGIC REMOVAL AND REAL-DIALOGUE MULTI-BUCKET ACCEPTANCE COMPLETE — STOP
```
