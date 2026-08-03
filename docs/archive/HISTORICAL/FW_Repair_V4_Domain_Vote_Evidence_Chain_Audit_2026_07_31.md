<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Domain_Vote_Evidence_Chain_Audit_2026_07_31.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Domain Vote Evidence Chain & Residual Mechanism Audit

**Date:** 2026-07-31  
**Nature:** READ ONLY · FULL TRACE · PRODUCTION PATH ONLY  
**Scope:** Domain Vote 证据链（FineSpan Candidates → retainedDomains → SameDomain Bucket）+ 残留机制全仓搜索  
**禁止已遵守:** 未改生产代码 / 配置 / 词库 / dialog_200 / 阈值 / 权重 / SameDomain 规则  

**Artifacts:**

| Artifact | Path |
|----------|------|
| Per-case MD/JSON | `docs/tone-v2/_audit_scratch/domain_vote_trace/001.md` … `200.md` (+ `.json`) |
| Aggregate | `docs/tone-v2/_audit_scratch/domain_vote_trace/_aggregate.json` |
| Summary | `docs/tone-v2/_audit_scratch/domain_vote_trace_summary.md` |
| Probe (read-only) | `docs/tone-v2/_audit_scratch/domain-vote-evidence-chain-probe.mjs` |

**SSOT 基准:**

- `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` §9–15
- `electron_node/electron-node/main/src/fw-detector/span-assembly-shared/utterance-domain-vote.ts`

---

## 1. Executive Conclusion

**Verdict: PARTIAL**

主 Vote 生产路径在 dialog_200 全部 200 条上可完整对账：

```text
FineSpan Candidates (active pool)
  → FineSpanDomainSet (union of vote-eligible domains)
  → domainScores[domain] = distinct FineSpan presence count
  → selectRetainedDomains (tie / ratio 0.75)
  → retainedDomains
  → bucketDomains = retainedDomains | [null]
```

- `unreconciled domainScores = 0`
- `Vote ↔ Bucket mismatch = 0`
- 无 Prior / LLM 进入 Vote
- 无 per-span winner → utterance domain 投票路径
- 无 shadow / legacy / detector 并行 Vote

仍存在**不影响当前 retainedDomains 结果**的残留命名与旁路字段（`winnerScore` / `winningFineDomain` / `primaryDomain` 诊断别名；词库 ngram 行上的单值 `domainId` 字段），需后续清理审计，故不能给 PASS。

---

## 2. Frozen Vote Contract

摘自 `Runtime_SSOT_Contract_Freeze.md`（与代码一致处直接引用）：

| § | 规则 |
|---|------|
| 9 | One Span One Vote Per Domain — Set presence；禁止 score mass / domains.length 拆分 / per-span Top1 vote |
| 10 | `base_term` 不投票；Base 进每个 retained bucket 做 Assembly |
| 11 | `domainScores[domain] = number of distinct fine spans that present the domain` |
| 12 | 无票 → insufficientEvidence；并列最高 → 全留；不足领先 → `count >= maxCount * RATIO` |
| 13 | `DOMAIN_BUCKET_RETENTION_RATIO = 0.75` |

代码常量：

```6:6:electron_node/electron-node/main/src/fw-detector/span-assembly-shared/utterance-domain-vote.ts
export const DOMAIN_BUCKET_RETENTION_RATIO = 0.75;
```

---

## 3. Production Call Chain

```text
Production Entry
  fw-detector-orchestrator.ts :: runFwDetectorOrchestrator
→ fw-detector-v4-path.ts :: runFwDetectorV4Path
→ span-assembly-v4-orchestrator.ts :: runSpanAssemblyV4Orchestrator
→ assemble-domain-aware-span-sets.ts :: runDomainAwareAssembly
    → buildFineSpanCandidatePool(activeCandidates, …)
    → voteUtteranceDomainFromPool(pool)          // ONCE per path
    → bucketDomains = retainedDomains | [null]
    → filterDomainCandidatesPerSpan(…, bucketDomain)
    → budgetPerSpanCandidates(…, domainPriors)  // priors ONLY here, NOT in Vote
→ SameDomain Bucket = one bucket per bucketDomain
```

| Step | File | Function | Caller | In | Out | Class |
|------|------|----------|--------|-----|-----|-------|
| Entry | `fw-detector-orchestrator.ts` | `runFwDetectorOrchestrator` | IPC/runtime | utterance | detector result | **Production** |
| V4 path | `fw-detector-v4-path.ts` | `runFwDetectorV4Path` | orchestrator | ctx | v4 result | **Production** |
| Orch | `span-assembly-v4-orchestrator.ts` | `runSpanAssemblyV4Orchestrator` | v4-path | raw+lexicon | pathAssemblyResults | **Production** |
| Pool | `assemble-domain-aware-span-sets.ts` | `buildFineSpanCandidatePool` | runDomainAwareAssembly | activeCandidates | FineSpanCandidatePool[] | **Production** |
| Vote | `utterance-domain-vote.ts` | `voteUtteranceDomainFromPool` | runDomainAwareAssembly | pool | UtteranceDomainVoteResult | **Production** |
| Retention | same file | `selectRetainedDomains` (internal) | finalizePresenceVote | domainScores | retainedDomains | **Production** |
| Bucket | `assemble-domain-aware-span-sets.ts` | loop over `bucketDomains` | runDomainAwareAssembly | vote | bucketSpanSets | **Production** |
| Pool-from-coarse | `assemble-domain-aware-span-sets.ts` | `buildFineSpanCandidatePoolFromCoarseSpansForTests` | tests only | — | — | **TEST ONLY** |
| Probe | `_audit_scratch/domain-vote-evidence-chain-probe.mjs` | evidence expand | audit | — | traces | **PROBE ONLY** |

**明确排除：** Probe 仅调用生产 `voteUtteranceDomainFromPool` / `buildFineSpanDomainSet` 对同一 pool 做对账展开，**未**用自建公式替换生产 `assemblyResult.vote`。

---

## 4. Vote Input Contract

**真实输入：** 当前 Path 上 `resolveCompatibilityRelations` 后的 `activeCandidates`，经 `buildFineSpanCandidatePool` 按 PathFineSpan 分桶。

符合冻结前提：

| 规则 | 实现证据 |
|------|----------|
| 同一 FineSpan 多 Candidate 可投票 | `buildFineSpanDomainSet` 遍历全部 eligible；多 cand → Set union |
| Domain / passive_domain_weak 可贡献领域票 | `isDomainVoteSource` |
| Base 不制造具体领域票 | `source === 'base_term'` 被 `isDomainVoteSource` 排除 |
| 非 per-span winner 决定投票 | 无 winner 筛选进入 Vote |
| 非 exact_term 门禁 | `hitKind` 不参与 eligibility；parent_fragment 可投票（结构性 parentTermId 去重） |
| 非 KenLM / Assembly 预筛后投票 | Vote 在 Assembly / KenLM 之前 |

dialog_200 观察：Vote pool 中 **base_term 计数 = 0**（Base 由 Assembly 侧 canonical / baseCandidates 注入，不进本轮 Vote 输入池）。

---

## 5. Candidate Vote Eligibility

真实分支（`buildFineSpanDomainSet`）：

| voteEligible | reasonCode | 代码条件 |
|--------------|------------|----------|
| NO | `COVERED_CANDIDATE_NO_VOTE` | `candidate.isCovered` |
| NO | `BASE_TERM_NO_DOMAIN_VOTE` | `source === 'base_term'` |
| NO | `SOURCE_NOT_DOMAIN_VOTE_ELIGIBLE` | source ∉ {domain_term, passive_domain_weak} |
| YES | `VALID_DOMAIN_CANDIDATE` | 其余 |

另：`hitKind === 'parent_fragment' && parentTermId` 使用 structural key `parent:${parentTermId}` 去重——eligible 但可能 `structuralDedupeSkip=true`（同 span 同 parent 只进 Set 一次）。

每条 Case 的 eligibility 见 `domain_vote_trace/NNN.md` §6.4。

---

## 6. Vote Contribution Formula

**真实公式（非加权因子）：**

```text
FineSpanDomainSet(span) = ∪ domains(c) for vote-eligible, structurally-deduped c in span
domainScores[d] = |{ span | d ∈ FineSpanDomainSet(span) }|
```

代码：

```144:154:electron_node/electron-node/main/src/fw-detector/span-assembly-shared/utterance-domain-vote.ts
function accumulateSpanDomainSets(
  spanDomainSets: Iterable<ReadonlySet<string>>
): Record<string, number> {
  const domainScores: Record<string, number> = {};
  for (const domainSet of spanDomainSets) {
    for (const domain of domainSet) {
      domainScores[domain] = (domainScores[domain] ?? 0) + 1;
    }
  }
  return domainScores;
}
```

**未使用：** candidateScore / toneFactor / priorFactor / llmFactor / domains.length 权重拆分。

每票贡献值恒为 **presence +1 / (span, domain)**，由进入 FineSpanDomainSet 的 Candidate 的 `domainTags[]` 提供标签证据。

dialog_200：`scoreReconcileOk` 全路径 **200/200 × all paths = 0 unreconciled**。

---

## 7. Multi-Domain Candidate Handling

- Candidate `domains` 来自 `hit.hotword.domains` 全量拷贝（`recall-topk-for-windows.ts`），注释明确 **never domains[0] projection**。
- 词库 SSOT：`term_domain_tags` → `Hotword.domains[]`。
- `addDomainsToSet` 对 `domains[]` **逐个 add**，无归一化、无拆分权重、无 top1 截断。
- 同一 span 多 domain 标签 → 各 domain 各得 **一次** presence（仍是 One Span One Vote **Per Domain**）。

dialog_200 多领域词实例（voteEligible=YES）：**91** 条；去重表面词包括：`中杯` `少糖` `预订` `打包` `带走` `发票` `机场` `高速` `蓝莓` `马芬` 等。

示例（Case 001「中杯」）：tags=`[coffee,food_order,milk_tea]` → 三领域均进入该 FineSpanDomainSet。

---

## 8. Base Candidate Handling

| 问题 | dialog_200 事实 | 代码合同 |
|------|-----------------|----------|
| 是否进入 Vote 输入池 | **否**（baseInTotal=0） | 若出现 `base_term`，会进 pool 但被 eligibility 排除 |
| 是否贡献具体 Domain 票 | **否**（baseVoteTotal=0） | `isDomainVoteSource` 排除 |
| 是否影响 insufficientEvidence | 仅通过「无领域证据」间接 | 无票 → insufficientEvidence |
| 是否进入 Assembly buckets | 是（Vote 之后） | Base enters every retained bucket |

**不得混为一谈：** 进入候选池（Assembly）≠ 贡献领域票（Vote）。

---

## 9. Prior Domain Handling

- `voteUtteranceDomainFromPool(pool)` **无** `domainPriors` 参数。
- `domainPriors` 仅传入 `budgetPerSpanCandidates` → `applyDomainPriorQuota`（Vote **之后**）。
- dialog_200 probe：`domainPriors: []` → 每 Case 写明 **`No domain priors provided`**。
- Counterfactual：Vote 内无法做 with/without prior 排名差（Prior 不进入 Vote）；P5 测试 `p5-prior-vote-isolation.test.ts` 合同一致。

| 问题 | 答案 |
|------|------|
| 是否弱先验？ | Vote 层：**不参与** |
| 是否凭空创建无 Candidate 证据的 Domain？ | Vote：**否** |
| 是否覆盖句内 Vote？ | Vote：**否** |
| 是否锁死 retainedDomains？ | Vote：**否** |
| 隐藏全局状态污染？ | 未观察到（每 Case 独立 orchestrator 调用） |

---

## 10. CPU LLM Handling

Vote 路径无 LLM / Summary / Domain Detector 输入。

每 Case：`LLM did not participate in this Vote`。

aggregate §F：`count=0`。

---

## 11. Domain Score Accumulation

对账恒等式（全 200 条成立）：

```text
productionVote.domainScores[d]
  == Σ_{span} 1[d ∈ FineSpanDomainSet(span)]
  == replayVote.domainScores[d]
```

无 Prior / LLM adjustment 项（恒为 none）。

---

## 12. Domain Ranking

排名 = `Object.entries(domainScores)` 按 count 降序，同分按 domainId 字典序（`rankDomainCounts`）。

报告区分：

- **Evidence FineSpan Count** = presence 分数本身  
- **Evidence Candidate Count** = 向该 domain 贡献标签并进入 Set 的 cand 数（可 > FineSpan Count，因同 span 多 cand）

---

## 13. Retention Rule

实现：`selectRetainedDomains`

```text
ranked empty → insufficientEvidence, retained=[]
isTie (多个 domain count===maxCount) → retain all at max
else → retain count >= maxCount * 0.75
```

| reasonCode（审计标注） | 条件 |
|------------------------|------|
| `INSUFFICIENT_EVIDENCE` / `NO_DOMAIN_EVIDENCE` | ranked 空 |
| `TIED_TOP` | isTie && score===maxCount |
| `UNIQUE_TOP` | 非并列且仅最高（或仅最高越过阈值）被保留 |
| `WITHIN_RATIO_THRESHOLD` | 非并列 && score>=max*0.75 && score<max 或与最高一同因阈值保留 |
| `BELOW_RATIO_THRESHOLD` | score < max*0.75 |

dialog_200（path 0）：

| 类别 | Count |
|------|-------|
| insufficientEvidence / base-only | 34 |
| multi retained | 45（TIED_TOP=43，WITHIN_RATIO=2：d001/d181） |
| single retained | 121 |

---

## 14. retainedDomains → Bucket Handoff

```345:348:electron_node/electron-node/main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts
  const bucketDomains: Array<string | null> =
    vote.insufficientEvidence || vote.retainedDomains.length === 0
      ? [null]
      : [...vote.retainedDomains];
```

- 无 alias 改写、无 coarse→fine 替换、无 fallback Domain 注入、无单值 domainId 覆盖。
- dialog_200：`bucketMismatch=0`；`bucketSpanSets.length === bucketDomains.length`。

---

## 15. dialog_200 Aggregate Findings

详见 `domain_vote_trace_summary.md`。

| Section | 结果 |
|---------|------|
| A retainedDomains | 200 条 path0 全列出 |
| B 无领域证据 | 34；原因均为 `ranked.length===0` |
| C 多领域保留 | 45；43 并列最高 + 2 比例阈值 |
| D 单领域保留 | 121 |
| E Prior 改排名 | 0（Vote 不读 prior） |
| F LLM 调整 | 0 |
| G 多领域词贡献 | 91 instances |
| H 无法对账 | **0** |
| I Vote≠Bucket | **0** |

多 Path：30/200 Case 存在 >1 path；各 path **独立** Vote（path-local），汇总以 path0 为主表，全 path 写入 per-case JSON。

---

## 16. Residual Mechanism Audit

### 16.1 Winner 残留

| 符号 | 位置 | 分类 | 说明 |
|------|------|------|------|
| `winnerScore` | `utterance-domain-vote.ts` | **RENAME** | 注释写明 Alias of maxCount；不驱动 Assembly |
| `winningFineDomain` | orchestrator / types | **RENAME** | `= retainedDomains[0]` 诊断字段 |
| `primaryDomain` | orchestrator / fwSpans | **KEEP/RENAME** | 同上，诊断 / fwSpan.domain 标签 |
| `utteranceDomain` | vote result | **KEEP** | retained[0] or `general` |
| `winnerDomain` / `domainWinner` / `bestDomain` | Vote 路径 | **未发现** | — |
| per-span winner → utterance domain | — | **未发现** | — |
| top1-only votes | — | **未发现** | — |

### 16.2 单值 Domain 残留

| 符号 | 分类 | 说明 |
|------|------|------|
| `WindowCandidate.domains[]` | **KEEP** | Vote SSOT 输入 |
| `domains[0]` projection in Vote | **未发现** | 类型注释禁止 |
| `ParentTermNgramRow.domainId` | **DEAD/LEGACY for Vote** | ngram 查询行字段；Vote 不读该字段做投票 |
| test helper `domainId` | **TEST ONLY** | length1 helpers |

### 16.3 粗领域硬门控

`coarseDomain` / `domainGroup` / `parentDomain` / `broadDomain` 在 fw-detector Vote 路径：**无匹配**。  
粗领域不直接禁止细领域投票。

### 16.4 Alias / 配置映射

Vote 路径无 `domain_aliases` / `aliasMap` / 配置文件改写 Candidate domains。  
`enabledDomains` 仅影响 Recall scope（上游），不在 Vote 内 remap tags。

### 16.5 Detector / Shadow Path

| 搜索项 | 结果 |
|--------|------|
| `fallbackVote` / `legacyVote` / `shadowVote` / `voteV1` / `voteV2` | **无生产实现** |
| `applyDomainVoteToEdges` / `voteUtteranceDomain(` | freeze-contract **断言已移除** |
| `shadowBeamSpanSets` | freeze-contract **禁止** |

无「主 Vote + Detector Vote + LLM Vote」隐式合并。

### 16.6 配置开关（影响 Vote 行为者）

| 配置 | 默认/生产 | 读取位置 | 对 Vote 影响 |
|------|-----------|----------|--------------|
| `DOMAIN_BUCKET_RETENTION_RATIO` | **0.75 硬编码** | `utterance-domain-vote.ts` | Retention 阈值 |
| `enabledDomains` | fw-config | Recall scope | **间接**（改变候选池，不改公式） |
| `minPrior` | 0.5 | Recall bind | **间接**（过滤低 prior hit） |
| `maxSentenceCandidates` | 16 | Assembly/KenLM budget | **不改 Vote**；影响 bucket 句子预算 |
| `domainPriors` | []（dialog_200） | budget quota | **不改 Vote** |
| LLM / detector flags | — | — | **不进入 Vote** |

无独立「legacy vote compatibility」开关改变 Vote 公式。

---

## 17. Configuration Ownership

| Owner | 职责 |
|-------|------|
| `utterance-domain-vote.ts` | presence 公式、retention ratio、eligibility source 集合 |
| `assemble-domain-aware-span-sets.ts` | pool 构建、调用 Vote 一次、bucketDomains 直传 |
| `recall-topk-for-windows.ts` | 写入 `domains[]`（词库全量） |
| `fw-config.enabledDomains` | Recall 域范围（上游） |
| `apply-domain-prior-quota.ts` | Vote **之后** prior quota（非 Vote） |

---

## 18. Dead / Legacy / Shadow Code List

| Item | Status |
|------|--------|
| `voteUtteranceDomain(` graph API | Removed（freeze 断言） |
| `applyDomainVoteToEdges` | Removed from orch |
| `buildFineSpanCandidatePoolFromCoarseSpansForTests` | TEST ONLY |
| `winnerScore` / `winningFineDomain` naming | Residual alias（RENAME 候选） |
| Parent ngram `domainId` column mapping | Residual field；Vote 不用 |
| Context Prior / domain-rerank in Vote | **不在 Vote**（assemble 当前亦无 rerank 调用） |

---

## 19. Ownership Matrix

| 产物 | Owner Module | 非 Owner |
|------|--------------|----------|
| domainScores | `voteUtteranceDomainFromPool` | KenLM, Assembly, Prior, LLM |
| retainedDomains | `selectRetainedDomains` | Bucket filter, Prior |
| bucketDomains | `runDomainAwareAssembly` 直传公式 | Alias map |
| FineSpanDomainSet | `buildFineSpanDomainSet` | per-span Top1 |
| Candidate domains[] | Lexicon `term_domain_tags` → Hotword.domains | config alias |

---

## 20. Target List

| ID | 问题 | 答案 |
|----|------|------|
| T1 | Vote 真实输入？ | Path 内 compatibility `activeCandidates` → `buildFineSpanCandidatePool` |
| T2 | 同 FineSpan 多 Candidate 能否都投票？ | **能**（eligible 均进 union；同 domain 同 span 仍只 +1） |
| T3 | 是否仍有 per-span winner / top1-only 投票？ | **否** |
| T4 | Base 是否错误贡献 Domain 票？ | **否**（dialog_200 甚至未进 Vote 池） |
| T5 | 多领域 Candidate 是否保留全部 domainTags？ | **是**（全量 `domains[]`，无 top1 截断） |
| T6 | domainScores 能否逐项对账？ | **是**（0 unreconciled） |
| T7 | retainedDomains 是否由明确阈值证明？ | **是**（tie / 0.75 / empty） |
| T8 | 先验是否弱先验而非主导？ | Vote 层 **完全不参与** |
| T9 | CPU LLM 是否第二条 Vote？ | **否** |
| T10 | Bucket 是否与 retainedDomains 一致？ | **是**（或 `[null]` base-only） |
| T11 | 旧 Detector / legacy / shadow Vote？ | **生产路径无** |
| T12 | 配置 alias / domain map 覆盖词库？ | Vote **无** |
| T13 | 单值 domainId 压缩多领域？ | Vote 输入 **无**；ngram 行残留字段存在但不驱动 Vote |
| T14 | 无法解释分数 / 隐藏加权？ | **未发现** |
| T15 | 符合冻结的 Candidate Evidence 被旧机制提前忽略？ | Vote 前无 winner/exact_term 投票门禁；covered / non-domain source 按合同跳过 |

---

## 21. Check List

```text
[x] 使用真实生产 Vote 调用链
[x] 未用 Probe 自行重建 Vote 结果代替生产结果（仅对账展开）
[x] dialog_200 全部 200 条完成
[x] 每个 Candidate 的 Vote Eligibility 可追溯
[x] 每一票可追溯到 Candidate + FineSpan（presence 模型）
[x] 每个 domainScore 可逐项对账
[x] 多领域 Candidate 未被压缩
[x] Base Candidate 未制造领域票
[x] 先验域影响完全展开（Vote：无）
[x] LLM 影响完全展开（Vote：无）
[x] Retention 阈值代入真实数值（0.75）
[x] retainedDomains 与 Bucket 完全对接
[x] Winner 残留已全仓搜索
[x] 单值 domainId 残留已全仓搜索
[x] Alias / 配置映射残留已全仓搜索
[x] Detector / Shadow Vote 已全仓搜索
[x] 所有配置开关已追踪到代码行为
[x] 未加入任何 Human Judgment 或语义启发式
[x] 未修改生产代码、词库、配置和测试数据
```

---

## 22. Final Audit Conclusion

```text
PARTIAL
主 Vote 可对账，但仍存在不影响当前结果的残留代码、
命名、配置或未触发分支，需要进一步清理审计。
```

**依据摘要：**

- 证据链 `Candidate → FineSpanDomainSet → domainScores → retention → retainedDomains → Bucket` 在 dialog_200 上 **完整可对账**（H=0, I=0）。
- 冻结 Presence Vote / 0.75 retention / Base 不投票 / 多标签 union / 无 Prior·LLM 主导 均成立。
- 残留：`winnerScore` / `winningFineDomain` / `primaryDomain` 命名别名；词库 ngram `domainId` 单值字段（Vote 不消费）。上述均 **未** 成为第二套 Vote Owner，故非 FAIL；因命名/旁路字段未清，故非 PASS。

**Suggested follow-up（非本轮范围）：** 诊断字段 RENAME 清理清单；确认 ngram `domainId` 与 `term_domain_tags` enrichment 无隐藏压缩路径（本轮 Vote 输入已验证为 `domains[]`）。
