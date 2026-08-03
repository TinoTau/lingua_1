<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Runtime_Domain_Presence_Vote_End_to_End_Completeness_Audit.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Runtime Domain Presence Vote End-to-End Completeness Audit

| Field | Value |
|------|-------|
| Status | **COMPLETE (READ-ONLY)** |
| Date | 2026-07-20 |
| Nature | 只读代码 / 文档 / 调用链 / 合同 / 测试覆盖审计 |
| Sole Runtime Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |

---

## 1. Executive Verdict

**FUNCTIONALLY COMPLETE WITH GAPS.**

Presence Vote 端到端主链在生产代码中已闭合：`term_domain_tags → Hotword.domains[] → WindowCandidate.domains[] → FineSpanDomainSet → domainScores → retainedDomains → Multi-Bucket + Base → mergeCrossBucketSentenceCandidates → ≤16 → KenLM prefilled → Apply/fail-open raw`。

```text
FEATURE COMPLETENESS: PASS
QUALITY VALIDATION: NOT COMPLETE
```

功能完整 ≠ 质量已经完成。KenLM Top1、Recall 噪声、dialog_200 全量 E2E 属于外部质量域，不构成 Vote 功能缺失。

**BLOCKING FUNCTIONAL GAPS: NONE**

---

## 2. Scope and Method

- 只读追踪：`fw-detector-step` → orchestrator → V4 path → orchestrator assembly → vote → buckets → merge → KenLM → apply
- 只读阅读：`utterance-domain-vote.ts`、`assemble-domain-aware-span-sets.ts`、`recall-topk-for-windows.ts`、`lexicon-runtime-v2.ts`、`build-sentence-candidates.ts`、`run-fw-sentence-rerank-from-prefilled.ts`
- 全仓关键词分类（生产 TS 为主；历史文档单独标注）
- 词库 sqlite 抽样 + `accept:runtime-ssot` 既有 smoke 证据
- 测试矩阵对照 25 项规则
- **未修改**任何源码 / 文档 / 测试 / 配置 / 词库

---

## 3. Authority and Frozen Baseline

冲突优先级按任务执行：

```text
源码 > Runtime_SSOT_Contract_Freeze.md > 已接受审计 > 执行报告 > 历史文档
```

冻结设计（Presence Vote / 0.75 / Multi-Bucket / ≤16 / KenLM 无领域元数据 / Context Prior diagnostics-only）与源码一致，本审计不重新讨论设计。

禁止恢复项（Shadow Beam / Graph Vote / Domain Rerank / VoteMass / domains[0] 决策等）在生产路径中 **未发现 ACTIVE 实现**。

---

## 4. Production Entry Call Chain

```text
Pipeline STEP_REGISTRY.FW_SPAN_DETECTOR
  → runFwDetectorStep
      (electron_node/.../pipeline/steps/fw-detector-step.ts)
  → runFwDetectorOrchestrator
      (fw-detector/fw-detector-orchestrator.ts)
      → resolveRecallScope → recallDomainScope
      → runFwDetectorV4Path   [唯一生产落点]
  → runSpanAssemblyV4Orchestrator
      (span-assembly-v4/span-assembly-v4-orchestrator.ts)
      → recallTopKForWindows
      → runDomainAwareAssembly
          → voteUtteranceDomainFromPool   [Presence Vote ×1 / utterance]
          → for each retainedDomains|null: filter → select → assemble
      → allocateDomainBucketSentenceBudget (guard)
      → per-bucket buildSentenceCandidates(cap=maxSentenceCandidates)
      → mergeCrossBucketSentenceCandidates
  → runFwSentenceRerankFromPrefilled(prefilledCombinations)
      → rerankFwSentences
  → applyFwSpanReplacements | fail-open raw
  → mergeContextPriorIntoRuntimeDiag(..., { applied: false })
```

| 项 | 证据 |
|----|------|
| 生产 Vote 入口 | `assemble-domain-aware-span-sets.ts` → `runDomainAwareAssembly` → `voteUtteranceDomainFromPool` |
| 实现 SSOT | `span-assembly-shared/utterance-domain-vote.ts` |
| 每句投票次数 | **1**（orchestrator 一次 `runDomainAwareAssembly`；桶循环不再投票） |
| 平行 Vote | 无 `voteUtteranceDomain(` 生产导出；无 `applyDomainVoteToEdges` |

`retainedDomains[0]` 仅用于 `primaryDomain` 诊断写 `fwSpans.domain`（orchestrator L217–224），**不**替代 Multi-Bucket。

---

## 5. Lexicon Domain Fact Pipeline

| 阶段 | 文件 / 函数 | 行为 |
|------|-------------|------|
| DB | `term_domain_tags(term_id, domain_id, weight)` | 一词多行多域 |
| 加载 | `lexicon-runtime-v2.ts` `lookupDomainsByPinyinKeyMulti` | JOIN `domain_lexicon ⋈ term ⋈ term_domain_tags`，**无 GROUP BY 丢标签** |
| 合并 | `mergeDomainTierRows` | 按 `word\|pinyin_key` **Set 并集** `domains[]` |
| 类型 | `hotword-types.ts` | `HotwordEntry.domains?`；空 = Base |

**未发现**生产路径用 `domains[0]` / `domainId` 作决策投影（`v4-types.ts` 明确禁止）。

**非阻断风险（DATA QUALITY / DATA COMPLETENESS 边缘）：**

1. Recall SQL `domainIds IN (recallDomainScope)` — scope 外标签不会加载进该次 Hotword。  
2. SQL `LIMIT` 后截断可能导致同词其它 domain 行未进入 merge（非 Map overwrite）。  
3. Parent fragment (`ngramRowToHotword`) 仅单 `domain_id`，可投票但不进 exact 替换 pick。

在 **全量 availableFineDomains** 与正常 TopK 下，`accept:runtime-ssot` smoke 证明多标签完整到达 Hotword（见 §22）。

```text
DOMAIN FACT PIPELINE: PASS
LEXICON MULTI-DOMAIN FACTS PRESERVED: YES
```

---

## 6. Hotword Domain Propagation

`mergeDomainTierRows`（`lexicon-runtime-v2.ts` L68–92）对同 term 多 `domain_id` 行执行：

```text
domains = Set(existing.domains) ∪ {domainId} → 排序数组
```

`accept:runtime-ssot` 实测（既有日志）：

| sample | DB_tags | Hotword_domains |
|--------|---------|-----------------|
| 中杯 | coffee, food_order, milk_tea | 同左 |
| 少糖 | coffee, food_order, milk_tea | 同左 |
| 菜单 | bakery, coffee, food_order, milk_tea | 同左 |
| 预订 | food_order, tourism_hotel, tourism_route, transport | 同左 |
| 你好 | [] | []（不伪造领域） |

```text
HOTWORD DOMAINS[] COMPLETE: YES
```

---

## 7. WindowCandidate Domain Propagation

`recall-topk-for-windows.ts` L238–264：

```text
domains = hit.hotword.domains?.length
  ? Object.freeze([...hit.hotword.domains])
  : undefined
source = resolveGraphSource(hit.source, domains, weakDomainPlan)
```

| source | 条件 |
|--------|------|
| `base_term` | 无 fine domains |
| `passive_domain_weak` | weak plan 启用且全部 fine 在 weak 列表 |
| `domain_term` | 其余 |

- `candidateScore` 仅乘 `boundaryPenalty` 写 `score`，**不改** `domains[]`。  
- 后期 dedup 保留单候选对象（不跨候选 union）；同词多标签已在 `mergeDomainTierRows` 完成并集。

```text
RECALL DOMAIN PROPAGATION: PASS
WINDOWCANDIDATE DOMAINS[] COMPLETE: YES
```

---

## 8. FineSpanDomainSet Construction

`buildFineSpanDomainSet`（`utterance-domain-vote.ts` L160–187）：

1. 跳过 `isCovered`  
2. 仅 `source ∈ {domain_term, passive_domain_weak}`  
3. 结构去重（parentTermId / candidateId）  
4. `addDomainsToSet`：跳过空 / `general` / `base_term`；多标签全部 `Set.add`  
5. 同 span 同 domain 多候选 → Set 只一次 → **一票**

池构建：`buildFineSpanCandidatePool` 按 coarse span 分组（assembly 文件）；Vote 在 compatibility 标记 `isCovered` 之后。

**未发现：** 粗 span 直接投票、候选逐条加票、CandidateScore/SOURCE_WEIGHT 加权、多标签拆分权重。

```text
FINE SPAN DOMAIN SET: PASS
SAME-SPAN DUPLICATE DOMAIN VOTES: 0
```

---

## 9. Presence Vote Algorithm

正式函数：`voteUtteranceDomainFromPool`（`utterance-domain-vote.ts` L189–216）。

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 每 span 先建 Set | YES | `buildFineSpanDomainSet` |
| 同 span 同 domain ≤1 | YES | Set |
| 跨 span 累加 | YES | `accumulateSpanDomainSets` +1 |
| domainScores 整数 | YES | presence count |
| 读 candidateScore | **NO** | 字段存在于类型，算法未读 |
| 读 source weight / VoteMass | **NO** | 源码无；freeze 禁止 |
| 读 context prior | **NO** | vote 文件无引用 |
| 读 LLM primaryDomain 加票 | **NO** | 不进入 `domainScores` |

```text
PRESENCE VOTE ALGORITHM: PASS
CANDIDATE SCORE AFFECTS VOTE: NO
CONTEXT PRIOR AFFECTS VOTE: NO
BASE VOTES: 0
```

---

## 10. domainScores Semantics

```text
domainScores[domain] = |{ fine spans | domain ∈ FineSpanDomainSet(span) }|
```

实现：`accumulateSpanDomainSets` L144–154。别名 `winnerScore`/`runnerUpScore` 仅为 metrics 兼容，**不是**加权 mass。

```text
DOMAIN_BUCKET_RETENTION_RATIO: 0.75
```

唯一定义：`utterance-domain-vote.ts` L6；`v4-limits.ts` 仅 re-export。无 env / config 覆盖生产值。

---

## 11. retainedDomains Rules

`selectRetainedDomains` L69–119：

| 场景 | 行为 |
|------|------|
| 无票 | `retained=[]`，`insufficientEvidence=true` |
| 并列最高 | 保留全部 `atMax`（不套 0.75） |
| 唯一最高 | 保留 `count >= maxCount * 0.75` |
| 排序 | 票数降序 + `localeCompare`（确定性） |

`allocateDomainBucketSentenceBudget(17, 16)` → **显式 throw**  
`FINE-SPAN DOMAIN PRESENCE VOTE REPAIR BLOCKED — retained domain buckets exceed sentence candidate budget`  
**非**静默截断 / 只取前 16 / 回退单领域。

```text
RETAINED DOMAINS: PASS
```

---

## 12. Multi-Bucket Consumption

`runDomainAwareAssembly` L210–224：

```text
bucketDomains =
  insufficientEvidence || retained.length===0
    ? [null]          // base-only 单桶
    : [...retainedDomains]  // 每个 retained domain 一桶
```

| 反模式 | 生产状态 |
|--------|----------|
| 只用 `retainedDomains[0]` 建桶 | **否** |
| primaryDomain shortcut 替代 Multi-Bucket | **否**（仅诊断） |
| 单领域正式 fallback | **否**（无票时是 base-only `null` 桶） |

KenLM 池来自 **全部** `bucketSpanSets` merge，不是第一桶 alone。

```text
MULTI-BUCKET CONSUMPTION: PASS
RETAINED DOMAINS CONSUMED: YES
MULTI-BUCKET FORMAL PATH: ACTIVE
```

---

## 13. Base Candidate Behavior

`filterDomainCandidatesPerSpan` L85–110 + `isSameDomainCandidate` / `isBaseCandidate`：

```text
same-domain: (domain_term|passive_domain_weak) && domains.includes(bucketDomain)
base:        graphSource === 'base_term'  → 进入每个非 base-only 桶的 baseCandidates
```

- Base **不**进入 `domainScores`（source 过滤）。  
- 无票时 `bucketDomain=null` → base-only / fallback 模式。

```text
BASE ENTERS EVERY BUCKET: YES
```

（源码合同成立；专项“domain 桶 + base 同现”单测见测试矩阵 PARTIAL。）

---

## 14. Candidate Budget and Dedup

正式顺序（orchestrator L227–241 + `mergeCrossBucketSentenceCandidates`）：

```text
per-bucket buildSentenceCandidates(cap = maxSentenceCandidates)  // 默认 16
→ mergeCrossBucketSentenceCandidates
→ text dedup（同 text 保留更高 candidateScore）
→ global slice(0, maxSentenceCandidates)
```

- `allocateDomainBucketSentenceBudget` **仅 guard**，返回值不作为每桶最终配额。  
- **未发现**生产仍用 `floor(16/n)` 作最终 per-bucket quota。  
- 其它生产入口：V4 path 是唯一正式 KenLM 接线；prefilled 为空时 `runFwSentenceRerankFromPrefilled` 可回退 `buildSentenceCandidates(spanSets)`（primary 桶），属 KenLM 输入缺失 fail-open，**不是**第二套 Vote。

```text
CROSS-BUCKET CANDIDATE POOL: PASS
CROSS-BUCKET DEDUP: ACTIVE
FINAL SENTENCE CANDIDATE LIMIT: 16
```

---

## 15. KenLM Integration

```text
kenlmSentenceCandidates.combinations
  → fw-detector-v4-path prefilledCombinations
  → runFwSentenceRerankFromPrefilled
  → rerankFwSentences (raw_log_delta)
```

| 检查 | 结果 |
|------|------|
| 消费跨桶 merge 池 | YES（有 prefilled 时） |
| 重建另一套主池 | 仅 prefilled 空时回退 primary spanSets |
| 只消费单 domain 桶 | NO（正式路径） |
| candidateScore 当 KenLM | NO |
| domainScores / retainedDomains 注入 | NO |
| SpanReplacementPick 带 domains | NO（GATE-INT-2 + smoke） |

```text
KENLM INTEGRATION: PASS
KENLM RECEIVES MERGED POOL: YES
KENLM INPUT DOMAIN METADATA: ABSENT
```

Quality：Top1 65% 等 → **不**计入 Integration FAIL。

---

## 16. Final Output and Fail-Open

| 条件 | 输出 |
|------|------|
| KenLM 成功且 delta ≥ minDeltaToReplace | 替换句 → apply |
| Scorer null / 子进程失败 / all-zero | 通常 `pickedIsRaw` → **raw** |
| delta 未达阈值 | **raw** |
| 无 combinations | `pickedIsRaw` |
| 无 fwSpans | `decision=null`，`segmentForJobResult=rawText` |
| 无领域票 | base-only 桶仍可生成句候选进 KenLM |

**未发现** fail-open 回退 Shadow Beam / 单领域强制 / 用 pre-KenLM candidateScore 作最终句选择（最终句选择在 KenLM pick；无 KenLM 时保持 raw）。

---

## 17. CPU LLM / Coarse Domain Boundary

| 用途 | 是否影响 domainScores |
|------|----------------------|
| `profile.primaryDomain` → weakDomainRecallPlan | **否**（只改 source 标签 `passive_domain_weak`；仍同等 presence） |
| Context Prior diag | **否**（`applied:false`） |
| Recall scope | 来自 config/registry，**不读** LLM primary |

```text
CPU LLM AFFECTS VOTE: NO
```

（间接影响召回命中池属于 Recall 质量域，不是 Vote 计票。）

---

## 18. Context Prior Boundary

`fw-detector-v4-path.ts` L277–278 硬编码：

```text
mergeContextPriorIntoRuntimeDiag(..., { applied: false })
```

`context-prior.ts` 为 diagnostics stub。Vote / Assembly / KenLM / CandidateScore **不读** multiplier。

```text
CONTEXT PRIOR AFFECTS VOTE: NO
```

---

## 19. Legacy Chain Search

| 关键词 | 分类 |
|--------|------|
| `voteUtteranceDomainFromPool` / `domainScores` / `retainedDomains` / `FineSpanDomainSet` / `DOMAIN_BUCKET_RETENTION_RATIO` / `mergeCrossBucketSentenceCandidates` / `prefilledCombinations` / `allocateDomainBucketSentenceBudget` | **ACTIVE PRODUCTION** |
| `applied:false` / `contextPrior*` diag 字段 | **ACTIVE DIAGNOSTIC** |
| `primaryDomain`（session/LLM） | **ACTIVE**（召回弱域/诊断；**不进计票**） |
| `shadowBeamSpanSets` 类型 / `pushBeamSpanSet` | **DEAD / UNREACHABLE**（orchestrator 无；freeze 断言） |
| `domain-rerank.ts` / `VoteMass` / `SOURCE_WEIGHT` / `coverageWeight` / `applyDomainVoteToEdges` / `runCoarseSentenceBeamV4` | **DEAD**（文件删除或零生产引用） |
| `domains[0]` | 仅注释禁止 / 测试断言；**非决策** |
| `winnerDomain` | 未见生产决策字段；诊断用 `utteranceDomain`/`winningFineDomain` |
| 历史 docs 中旧名 | **HISTORICAL DOCUMENT** |

```text
PARALLEL VOTE CHAINS: 0
LEGACY SHADOW PATHS: 0 ACTIVE
DOMAIN RERANK ACTIVE: NO
PRODUCTION PATH BYPASSES: 0
```

---

## 20. Observability

| 可观察项 | 状态 | 位置 |
|----------|------|------|
| domainScores | YES | orchestrator metrics L319 |
| retainedDomains | YES | metrics + `internal.retainedDomains` |
| bucketSpanSets | YES | result.bucketSpanSets |
| 每桶生成 / merge 前 | YES | `perBucketGenerated` / `mergedBeforeCap` / `dedupReplacedCount` |
| KenLM 输入句 | YES | combinations.text + trace `pushSentenceCandidate` |
| Context Prior applied | YES | runtime diag |
| FineSpanDomainSet 逐 span 导出 | **NO 专用字段**（仅内嵌于计票过程） |
| failure category 完整枚举 | PARTIAL（`v4_no_spans` / `no_candidates` / KenLM error reason） |

```text
OBSERVABILITY: PARTIAL
OBSERVABILITY COMPLETE: PARTIAL
```

---

## 21. Test Coverage Matrix

| # | 规则 | 结论 | 证据 |
|---|------|------|------|
| 1 | 同 span 多候选同 domain 一票 | **PASS** | `fine-span-domain-presence-vote.test.ts` 17.7 |
| 2 | 一候选多 domains 各一票 | **PASS** | 17.9 |
| 3 | 多 span 累计 | **PASS** | 17.8 |
| 4 | Base 不投票 | **PASS** | `base does not participate...` |
| 5 | passive_domain_weak 合同 | **MISSING** | 无专项用例；代码与 domain_term 同等资格 |
| 6 | tied max retain all | **PASS** | 17.2 / 17.5 |
| 7 | unique max clear lead | **PASS** | 17.4 / 17.1 |
| 8 | 0.75 boundary | **PASS** | 17.3 + ratio SSOT |
| 9 | no vote | **PASS** | 17.6 |
| 10 | multiple retained buckets | **PASS** | tied buckets 用例 |
| 11 | Base enters every bucket | **PARTIAL** | 源码成立；缺“domain 桶+base 同现”专项 |
| 12 | domains.includes(bucketDomain) | **PASS** | multi-domain 多桶出现 + `isSameDomainCandidate` |
| 13 | cross-bucket duplicate text | **PASS** | dedup 用例 |
| 14 | higher candidateScore retained | **PASS** | 同上 score=10 |
| 15 | global ≤16 | **PASS** | merge + smoke |
| 16 | retainedDomains >16 BLOCKED | **PASS** | budget allocator 17,16 |
| 17 | KenLM receives merged pool | **PASS** | freeze-contract wiring |
| 18 | KenLM 无 domain metadata | **PASS** | GATE-INT-2 + smoke Pick_keys |
| 19 | Context Prior applied:false | **PASS** | freeze + v4-path 硬编码 |
| 20 | no Shadow / Rerank | **PASS** | freeze GATE |
| 21 | same text / different domains | **MISSING** | 无专项 |
| 22 | lexicon 多 term_domain_tags | **PASS** | `accept:runtime-ssot` smoke |
| 23 | production entry → Vote | **PARTIAL** | 静态接线 + smoke；无全 ASR 句级 call-count 单测 |
| 24 | diagnostics lifecycle | **PARTIAL** | metrics 字段有；逐 span Set 无 |
| 25 | deterministic ordering | **PASS** | retained sort + merge sort/localeCompare |

```text
TEST COVERAGE: PARTIAL
```

---

## 22. Multi-Domain Data Sampling

词库：`node_runtime/lexicon/v3/lexicon.sqlite`（只读）。

### 任务指定词

| 词 | term_domain_tags | 说明 |
|----|------------------|------|
| 订单 | `['food_order']` | 单域 |
| 预订 | 4 域 | **多域** |
| 前台 | `['tourism_hotel']` | 单域 |
| 联调 | `['tech_ai']` | 单域 |
| 上线计划 | `['tech_ai']` | 单域（存在；非“禁止长词缺失”） |
| 接口文档 | `['tech_ai']` | 单域 |

### 额外完整追踪样本（≥5）

| 词 | DB domains | Hotword（smoke） |
|----|------------|------------------|
| 中杯 | coffee, food_order, milk_tea | **一致** |
| 少糖 | coffee, food_order, milk_tea | **一致** |
| 菜单 | bakery, coffee, food_order, milk_tea | **一致** |
| 预订 | food_order, tourism_hotel, tourism_route, transport | **一致** |
| 接送 | tourism_pickup, tourism_transport | **一致** |
| 机场 | tourism_transport, transport | **一致** |
| 你好 | [] | [] |

FineSpanDomainSet：smoke 用 `少糖`+`中杯` 进 `runDomainAwareAssembly`，产出整数 `domainScores` 与 `retainedDomains`（并列多桶）。

**结论：** 不是“DB 多标签正确但加载后只剩一个”——在正式 V2 加载路径上多标签保留。

---

## 23. Document-to-Code Alignment

| 文档 | 对齐结论 |
|------|----------|
| Runtime_SSOT_Contract_Freeze.md | Sole Authority；0.75；≤16；Integration/Quality 拆分；与源码一致 |
| RUNTIME_DOMAIN_DOCUMENT_INDEX.md | Sole / Supporting / Historical 分层正确 |
| DOMAIN_SOURCE_UNIFICATION.md | SOURCE_AND_REGISTRY_ONLY；声明不拥有 Vote |
| DOMAIN_RECALL.md | Recall-only；`applied:false` |
| FROZEN_V1_2.md | Assembly detail only |
| ARCHITECTURE.md | Overview only |
| CONTEXT_PRIOR.md | diagnostics-only |
| KENLM_RUNTIME.md | 跨桶调用链 + Integration≠Quality |

当前合同文档中 **无** Shadow formal / Domain Rerank active / 单一 REAL KENLM PASS。

```text
DOCUMENT ALIGNMENT: PASS
```

**不建议**再次重写文档。

---

## 24. Missing or Partial Items

非阻断：

1. `passive_domain_weak` 专项测试缺失  
2. “Base 进入每个 domain 桶”专项测试 PARTIAL  
3. 同 text 不同 domains 候选合并语义无专项测试  
4. Observability 缺少逐 span FineSpanDomainSet 导出  
5. 全 ASR→NMT call-count 单测 PARTIAL（接线静态证据充分）  
6. Lexicon SQL LIMIT / scope 截断边缘风险  

无阻断功能缺口。

---

## 25. External Quality Risks

| 风险 | 域 | 是否判定 Vote 不完整 |
|------|-----|---------------------|
| 九点→酒店近音 | Recall Noise | **否** |
| KenLM Top1 65% / MISRANK | KenLM Quality | **否** |
| WSL cold-start timeout | Runtime availability | **否** |
| dialog_200 全量未跑 | Quality Validation | **否** |
| 部分 term domain 过宽 | Lexicon data quality | **否** |

---

## 26. Target List

### BLOCKING FUNCTIONAL GAPS

```text
NONE
```

### TEST GAPS

- `passive_domain_weak` 专项用例  
- Base 进入每个 retained domain bucket 专项用例  
- 同 text / 不同 domains 候选行为用例  
- 生产入口 Vote 调用次数集成断言（可选）

### OBSERVABILITY GAPS

- 逐 span FineSpanDomainSet 诊断字段  
- merge 前后数量在 job extra 顶层的统一汇总（部分已在 result 对象）

### DOCUMENT GAPS

```text
NONE（当前合同与代码对齐）
```

### DATA QUALITY GAPS

- 部分业务词仅单域（订单/前台等）——词库事实，非管道丢失  
- Recall scope / SQL LIMIT 边缘截断风险

### KENLM QUALITY GAPS

- Top1 未冻结；MISRANK；cold-start；dialog_200 未全量

### NON-BLOCKING RISKS

- Parent fragment 单 domain_id 投票但不进 exact pick  
- prefilled 空时 KenLM 回退 primary spanSets（fail-open）  
- LLM weak plan 间接改变召回标签（不改变 presence 算法）

---

## 27. Check List

- [x] 生产入口追踪到 Vote / KenLM / output  
- [x] domains[] 全链路抽样  
- [x] Presence Vote 逐规则源码确认  
- [x] retainedDomains 消费为多桶  
- [x] Base / merge / ≤16 / KenLM 边界  
- [x] Legacy 关键词分类  
- [x] 测试矩阵 25 项  
- [x] 文档对齐  
- [x] 未修改任何实现物  

---

## 28. Final Verdict

### Dimension Scores

```text
DOMAIN FACT PIPELINE: PASS
RECALL DOMAIN PROPAGATION: PASS
FINE SPAN DOMAIN SET: PASS
PRESENCE VOTE ALGORITHM: PASS
RETAINED DOMAINS: PASS
MULTI-BUCKET CONSUMPTION: PASS
CROSS-BUCKET CANDIDATE POOL: PASS
KENLM INTEGRATION: PASS
PRODUCTION WIRING: PASS
OBSERVABILITY: PARTIAL
TEST COVERAGE: PARTIAL
DOCUMENT ALIGNMENT: PASS
QUALITY VALIDATION: NOT COMPLETE
```

### Completeness Gate

必要条件全部成立：

```text
DOMAIN FACT PIPELINE != FAIL
RECALL DOMAIN PROPAGATION = PASS
FINE SPAN DOMAIN SET = PASS
PRESENCE VOTE ALGORITHM = PASS
RETAINED DOMAINS = PASS
MULTI-BUCKET CONSUMPTION = PASS
PRODUCTION WIRING = PASS
DOCUMENT ALIGNMENT = PASS
```

```text
FEATURE COMPLETENESS: PASS
```

```text
功能完整 ≠ 质量已经完成
```

```text
FINAL VERDICT: FUNCTIONALLY COMPLETE WITH GAPS
```

缺口集中在测试覆盖、可观测性细化与 KenLM/词库质量，**不是** Presence Vote 主链缺失。

---

## Mandatory Output Block

```text
SOLE RUNTIME AUTHORITY:
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md

PRODUCTION DOMAIN VOTE ENTRY:
electron_node/electron-node/main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts::runDomainAwareAssembly → voteUtteranceDomainFromPool

DOMAIN VOTE EXECUTIONS PER UTTERANCE:
1

LEXICON MULTI-DOMAIN FACTS PRESERVED:
YES

HOTWORD DOMAINS[] COMPLETE:
YES

WINDOWCANDIDATE DOMAINS[] COMPLETE:
YES

SAME-SPAN DUPLICATE DOMAIN VOTES:
0

BASE VOTES:
0

CANDIDATE SCORE AFFECTS VOTE:
NO

CONTEXT PRIOR AFFECTS VOTE:
NO

CPU LLM AFFECTS VOTE:
NO

DOMAIN_BUCKET_RETENTION_RATIO:
0.75

PARALLEL VOTE CHAINS:
0

RETAINED DOMAINS CONSUMED:
YES

MULTI-BUCKET FORMAL PATH:
ACTIVE

BASE ENTERS EVERY BUCKET:
YES

CROSS-BUCKET DEDUP:
ACTIVE

FINAL SENTENCE CANDIDATE LIMIT:
16

KENLM RECEIVES MERGED POOL:
YES

KENLM INPUT DOMAIN METADATA:
ABSENT

PRODUCTION PATH BYPASSES:
0

LEGACY SHADOW PATHS:
0 ACTIVE

DOMAIN RERANK ACTIVE:
NO

OBSERVABILITY COMPLETE:
PARTIAL

TEST COVERAGE:
PARTIAL

DOCUMENT ALIGNMENT:
PASS

BLOCKING FUNCTIONAL GAPS:
NONE

QUALITY VALIDATION:
NOT COMPLETE

FEATURE COMPLETENESS:
PASS

FINAL VERDICT:
FUNCTIONALLY COMPLETE WITH GAPS
```

---

```text
RUNTIME DOMAIN PRESENCE VOTE
END-TO-END COMPLETENESS AUDIT COMPLETE — STOP
```
