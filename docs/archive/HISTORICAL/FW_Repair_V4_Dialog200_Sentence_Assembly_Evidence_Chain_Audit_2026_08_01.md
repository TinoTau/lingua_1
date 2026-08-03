<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Dialog200_Sentence_Assembly_Evidence_Chain_Audit_2026_08_01.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — dialog_200 Sentence Assembly Evidence Chain Audit

**Date:** 2026-08-01  
**Nature:** READ ONLY · PRODUCTION PATH ONLY · FULL SENTENCE TRACE · dialog_200 ALL 200  
**禁止已遵守:** 未改代码 / 配置 / 词库 / dialog_200 / 阈值 / JobResult / Vote  

**Artifacts:**

| Artifact | Path |
|----------|------|
| Per-case | `docs/tone-v2/_audit_scratch/sentence_assembly_trace/001.md` … `200.md` (+ `.json`) |
| Aggregate | `docs/tone-v2/_audit_scratch/sentence_assembly_trace/_aggregate.json` |
| Summary | `docs/tone-v2/_audit_scratch/sentence_assembly_trace_summary.md` |
| Probe | `docs/tone-v2/_audit_scratch/sentence-assembly-evidence-chain-probe.mjs` |

**上游冻结（本轮不重审）:** Domain Vote 证据链已通过；`retainedDomains` ↔ Bucket 一致。

---

## 1. Executive Conclusion

**Verdict: PARTIAL**

dialog_200 上 Sentence Assembly 主链 **文本 / Raw Range / CrossPath / KenLM Input** 可完整对账：

| 检查 | 结果 |
|------|------|
| A1 Budget 后未进句 | **0** |
| A14 KenLM 无 provenance | **0** |
| A20 Probe≠Production | **0** |
| KenLM untraced / textMismatch | **0 / 0** |
| Path FineSpan 重叠 (A8) | **0** |
| CrossPath 改写文本 (A12) | **0** |

但存在明确诊断缺口：

```text
domainAwarePickToSpanReplacementPick 丢弃 candidateId
→ Sentence.replacements.candidateId 恒为 null（repair picks）
→ 无法仅凭 Candidate ID 反向追踪；需 rawRange+surface 对齐
```

该缺口在 **166/200** Case 触发 A19 标注。未发现旧 Beam 双链路或非法文本生成，故非 FAIL；因 Candidate ID provenance 不完整，故非 PASS。

---

## 2. Audit Scope and Explicit Exclusions

| In | Out |
|----|-----|
| Bucket → Budget → Assembly → CrossPath → KenLM **Input** | Domain Vote 重设计 |
| 全 Path / 全 Bucket | JobResult 字段删除/改名 |
| 异常 A1–A20 客观统计 | 句子语义 / KenLM「是否合理」 |

KenLM **模型质量**不审；仅记录 Input 列表 = CrossPath `combinations`（默认不跑 KenLM 子进程）。

---

## 3. Frozen Assembly Contract（代码真实）

| 项 | 生产值 |
|----|--------|
| per-span limit | `getPerSpanCandidateLimit`: ≤1→**8**, 2→**6**, else→**4** |
| maxSentenceCandidates | **16**（`fw-config`） |
| enum 剪枝 | `maxIntervalEnumNodes=1024`, `maxIntervalRepairPicksPerPath=16` |
| CrossPath | exact text dedup · first-wins · **dedup-before-cap** ≤16 |
| Prior | 仅 `budgetPerSpanCandidates` / `applyDomainPriorQuota`；dialog_200 `domainPriors=[]` |

---

## 4. Production Call Chain

```text
runFwDetectorOrchestrator
→ runFwDetectorV4Path
→ runSpanAssemblyV4Orchestrator
→ runDomainAwareAssembly
    → buildFineSpanCandidatePool
    → voteUtteranceDomainFromPool          // 本轮不重审
    → filterDomainCandidatesPerSpan        // Bucket
    → budgetPerSpanCandidates              // Budget
    → assembleDomainAwareSpanSets          // Grid（此处丢失 candidateId）
→ buildSentenceCandidates                  // 每 Bucket 组句
→ mergeCrossPathSentenceCandidates         // CrossPath
→ kenlmSentenceCandidates.combinations     // KenLM Input
→ runFwSentenceRerankFromPrefilled         // KenLM（本轮仅边界）
```

| 步骤 | 文件 | 函数 | 改 Candidate? | 改 Sentence? | Class |
|------|------|------|---------------|--------------|-------|
| Pool | `assemble-domain-aware-span-sets.ts` | `buildFineSpanCandidatePool` | 组织 | 否 | PRODUCTION |
| Bucket | same | `filterDomainCandidatesPerSpan` | YES | 否 | PRODUCTION |
| Budget | same | `budgetPerSpanCandidates` | YES | 否 | PRODUCTION |
| Grid | same | `assembleDomainAwareSpanSets` | 投影（丢 id） | 否 | PRODUCTION |
| Assembly | `build-sentence-candidates.ts` | `buildSentenceCandidates` | 否 | YES | PRODUCTION |
| CrossPath | `merge-cross-path-sentence-candidates.ts` | `mergeCrossPathSentenceCandidates` | 否 | YES（去重/截断） | PRODUCTION |
| Probe | `_audit_scratch/sentence-assembly-evidence-chain-probe.mjs` | — | 否 | 否 | PROBE ONLY |

---

## 5. Path and Bucket Input Contract

每 Path 独立：`retainedDomains` → `bucketDomains`（或 `[null]` base-only）。

Bucket 输入（真实实现）：

```text
sameDomainCandidates  // domain_term|passive_domain_weak ∧ domains.includes(bucket)
+ baseCandidates      // base_term（dialog_200 Recall 池中常为 0）
+ fallbackCandidates  // 仅 base-only 桶
+ canonical           // Budget 阶段注入的 PathFineSpan 原文保底
```

Cross-domain：`DROP_CROSS_DOMAIN_FOR_BUCKET`（故意排除，非 eligibility fail）。

---

## 6. Candidate Inventory

dialog_200 聚合（bucket-scoped evaluations）：

| 指标 | 值 |
|------|-----|
| totalCases | 200 |
| totalPaths | 248 |
| totalBuckets | 321 |
| candidates tracked | 1432 |
| bucket sentences | 550 |
| CrossPath / KenLM inputs | 337 |

---

## 7. Bucket Eligibility Trace

真实 reasonCode（映射自代码分支）：

| reasonCode | 条件 |
|------------|------|
| `KEEP_DOMAIN_MATCH` | sameDomain |
| `KEEP_BASE_FOR_ALL_BUCKETS` | base_term |
| `KEEP_FALLBACK_BASE_ONLY_BUCKET` | base-only 桶 |
| `KEEP_CANONICAL_PRESERVATION` | Budget 注入 canonical |
| `DROP_CROSS_DOMAIN_FOR_BUCKET` | 他域 domain 候选 |
| eligibility drops | `DROP_COVERED_*` / `DROP_RANGE_MISMATCH` / …（`isCandidateEligibleForSpanAssembly`） |

每 Case 见 `sentence_assembly_trace/NNN.md`。

---

## 8. Per-Span Budget Trace

```text
ordered = sameDomain → base → fallback（score↓, id↑）
+ canonical
→ dedupeByIdentity → dedupeBySurface
→ slice(0, perSpanLimit)   // domainPriors=[] 时无 prior quota
```

| 问题 | 答案 |
|------|------|
| dialog_200 是否触发 Budget DROP？ | **是**：306 candidate-drop 事件，235 span 触发，**109** Case |
| 隐藏 winner / exact_term 门控？ | **否**（eligibility 已非 exact_term） |
| domainPriors 影响？ | 仅 Budget；本轮未传入 |
| 同分排序 | `score desc, candidateId asc` |

---

## 9. Sentence Assembly Algorithm

真实伪代码（对应 `build-sentence-candidates.ts`）：

```text
spanSets[slot] = SpanReplacementPick[]   // 每 FineSpan 一槽
for each slot:
  repairs = picks where repairTarget===true
  subsets = all non-overlapping subsets of repairs  // 含 ∅
DFS slots:
  choose one subset per slot; reject if overlaps prior chosen
  if enumNodes > 1024: PRUNED_DURING_GENERATION (capped)
  if total repairs > 16: skip
  path = chosen repairs + gap canonical fills for uncovered raw in coarse/slot ranges
  text = applyReplacementsRightToLeft(rawText, path)
score = sum(candidateScore); sort desc
uniqueByText first-wins
slice(0, maxSentenceCandidates=16)
```

**问答摘要：**

| # | 答案 |
|---|------|
| 1 初始状态 | `rawText` + 空 chosen |
| 2 FineSpan 顺序 | PathFineSpan 生产枚举顺序（pool/index） |
| 3 写入 | RTL splice `raw[start:end]←word` |
| 4 未覆盖 | `buildGapCanonicalPicks` 填 RAW/canonical |
| 5–6 相邻/重叠 | 同 path 内 `rawOverlap` 互斥；同槽多 cand 同 range → 只能单选（subset 单元素） |
| 8 跨 span | 若 range 不重叠可同句并存 |
| 9 多版本 | 同槽多 cand → 多 subset → 多句 |
| 10–11 爆炸控制 | non-overlap subsets + enum node cap + repair cap + text dedupe + 16 |
| 12 排序 | combinationScore 降序；tie 保留先插入 unique map 顺序 |

---

## 10. Raw Range and Segment Ownership

- Repair pick：`type=DOMAIN_OR_BASE`（`repairTarget=true`）
- Gap / canonical：`canonical_exact` / RAW 保底
- 证明：`applyReplacementsRtl(raw, replacements) === finalText`（A4=0）

---

## 11. Overlap Resolution

| 层级 | 规则 |
|------|------|
| PathFineSpan | 合同非重叠（`assertPathFineSpansNonOverlapping`）；dialog_200 A8=0 |
| 同句 repairs | `pickOverlapsAny` → 拒绝 |
| 同槽多候选 | 同 range 互斥 → 每次选至多一个 repair |

---

## 12. Base / Raw / Canonical Handling

| 类型 | dialog_200 |
|------|------------|
| Base Recall | 常 0；不进 Vote |
| Canonical | Budget 注入；surface 与 domain 相同时 surface-dedupe 常保留 domain |
| Gap RAW | Assembly 填未覆盖区间 |
| 双插 | A16=0 |

---

## 13. Candidate-to-Sentence Trace

因 **candidateId 被剥离**，Probe 使用：

```text
matchKey = `${rawStart}:${rawEnd}:${surface}`
```

对齐 `Sentence.replacements`。

| finalStatus | count |
|-------------|-------|
| USED_IN_SENTENCE | 792 |
| USED_IN_MULTIPLE_SENTENCES | 478 |
| DROPPED_BUCKET_MISMATCH | 162 |
| A1 NOT_SELECTED after budget | **0** |

说明：surface-dedupe 丢掉的「同 range+surface」第二候选，会因 matchKey 仍显示 USED（与保留者共享键）——此为 ID 剥离后的对齐局限，记入 A19 语境。

---

## 14. Per-Bucket Sentence Trace

每 Bucket 独立 `buildSentenceCandidates`；多 Bucket Case **52**（path 级），句子按桶分离。

---

## 15. Sentence Limits and Pruning

| 限制 | 触发方式 |
|------|----------|
| enum nodes 1024 | `PRUNED_DURING_GENERATION` |
| repair picks/path 16 | skip 扩展 |
| uniqueByText | bucket 内 exact text |
| maxSentenceCandidates 16 | bucket 输出 cap；再经 CrossPath 全局 cap |
| A10 超限 | **0** |

---

## 16. Bucket Deduplication

`uniqueByText` · first-wins · key=`combo.text`（exact）。A11=0。

---

## 17. CrossPath Merge and Deduplication

```text
order: path → bucket → sentence
dedupeKey: exact_text
retention: first_wins
cap: after dedup, ≤16
```

- 不修改文本（A12=0）
- 不重新生成 / 不混 Path 片段进单句（A15=0）
- 输入 550 bucket 句 → 输出 337 KenLM 句

---

## 18. KenLM Input Provenance

```text
kenlmSentenceCandidates.combinations
  === mergeCrossPathSentenceCandidates(...).combinations
```

| 指标 | 值 |
|------|-----|
| traced | 337 |
| untraced | 0 |
| textMismatch | 0 |

每句可追：`sourcePathId / sourceBucketId / sourceSentenceId` + replacements（range/surface/score）。

---

## 19. KenLM Output Alignment

本轮 **未强制** KenLM 子进程（与既有 Pre-KenLM 审计一致）。  
Input 列表已证明 = CrossPath 输出。Rerank 分数留待质量验收轮。

---

## 20. dialog_200 Aggregate Findings

见 `sentence_assembly_trace_summary.md`。

| 节 | 摘要 |
|----|------|
| A 全局 | 200 / 248 paths / 321 buckets / 550 bucket 句 / 337 KenLM |
| B 去向 | USED 792 + MULTI 478 + BUCKET_DROP 162 |
| C 删除 | Budget 事件 306；Bucket mismatch 162；A1=0 |
| D 多 Path | 30 Case |
| E 多 Bucket | 52 path-bucket 组 |
| I KenLM | traced 全覆盖 |
| J 异常 | 仅 A19=166；其余 A1–A18,A20 = 0 |

---

## 21. Anomaly Inventory

| ID | Count | 说明 |
|----|-------|------|
| A1–A18, A20 | **0** | — |
| **A19** | **166** | `candidateId` 在 Grid 投影丢失；同 Case 级标注 |

---

## 22. Residual / Legacy Mechanism Search

| 符号 | 分类 |
|------|------|
| `shadowBeamSpanSets` | 生产禁止（freeze 断言） |
| `beamEnabled: false` | diagnostics 合同字段 |
| IME `beam` | **PRODUCTION_ACTIVE** 但属拼音解码，非 Sentence Assembly |
| `selectedCandidates` | Budget 多候选集（非 Top1 winner） |
| `topCandidates` | KenLM **rerank 输出**诊断 |
| `selectedCandidateIndex` | KenLM apply 后写回 spans |
| `legacyAssembly` / `safeReplacement` / `fallbackSentence` | **未发现**并行主链 |
| `cartesian` / `permutation` | Assembly 用 non-overlap subset DFS，非全排列 |

**无**「旧 Beam + 新 Assembly」双链路并行输出。

---

## 23. Ownership Matrix

| 产物 | Owner | 非 Owner |
|------|-------|----------|
| Bucket Candidate Set | `filterDomainCandidatesPerSpan` | Vote 公式、KenLM |
| Per-Span Budget | `budgetPerSpanCandidates` | Assembly 文本、KenLM |
| Sentence Segments/Text | `buildSentenceCandidates` | CrossPath、Vote |
| CrossPath 去重/截断 | `mergeCrossPathSentenceCandidates` | KenLM 打分 |
| KenLM Input List | CrossPath merge 结果 | Vote |
| JobResult 封装 | Result Builder | **本轮未改合同** |

**冲突点：** Grid 投影丢失 `candidateId` → Segment→Candidate ID Owner 断裂（诊断层）。

---

## 24. Target List

| ID | 答案 |
|----|------|
| T1 | sameDomain + base + fallback(+canonical in budget) |
| T2 | KEEP_* / DROP_CROSS_DOMAIN / eligibility drops（见 §7） |
| T3 | Budget **触发**；306 drop 事件 / 109 Case |
| T4 | PathFineSpan 生产顺序 |
| T5 | RTL raw splice |
| T6 | gap canonical / RAW |
| T7 | rawOverlap 互斥；同槽同 range 单选 |
| T8 | 每槽 subset 枚举 → 多句 |
| T9 | non-overlap + enum/repair cap + text dedupe + 16 |
| T10 | **Range+surface+score 可追；candidateId 生产丢失** |
| T11 | **否**（A1=0） |
| T12 | **否**（A18=0） |
| T13 | **否**（A5–A7=0） |
| T14 | **否** 旧 Assembly 双链路 |
| T15 | 见每桶 `generatedSentenceCount` / enum / unique / cap |
| T16 | Bucket `slice(16)` + CrossPath 全局 `slice(16)` |
| T17 | exact_text first-wins + 全局 cap |
| T18 | **否** |
| T19 | **是**（路径/桶/句/range）；ID 需 matchKey |
| T20 | **否** |
| T21 | **否** |
| T22 | **是** |
| T23 | **否**（A16=0） |
| T24 | 去向可对账；ID 层有 A19 缺口 |
| T25 | **是**（未改 JobResult） |

---

## 25. Check List

```text
[x] 真实生产 Assembly 路径
[x] 未用 Probe 结果替代生产句（A20=0）
[x] dialog_200 200 条
[x] 全部 Path
[x] 全部 Bucket
[x] Candidate provenance（range+surface；ID 缺口已标 A19）
[x] Candidate 最终去向
[x] Bucket/Budget 前后可对账
[x] Sentence → Segments
[x] Segment Raw Range / Owner
[x] 重叠展开
[x] Base/Raw/Canonical 区分
[x] 数量限制展开
[x] Bucket/CrossPath 去重展开
[x] KenLM 输入可追溯
[x] KenLM 文本 = CrossPath
[x] 无 Human Judgment
[x] 未重做 Vote / 未改 JobResult / 未改代码数据
[x] A1–A20 统计
```

---

## 26. Final Audit Conclusion

```text
PARTIAL

主 Sentence Assembly 证据链基本可对账，
但仍存在未触发分支、诊断缺口、无法解释的剪枝、
残留旧机制或部分 Candidate 去向无法证明。
```

**本轮具体含义：**

- 主链（Bucket→Budget→Assembly 文本→CrossPath→KenLM Input）**完整可对账**，A1–A18/A20 清零。
- **诊断缺口 A19：** 生产 `domainAwarePickToSpanReplacementPick` 不写入 `candidateId`，导致「Candidate ID → Sentence」正式字段断裂；只能靠 rawRange+surface 对齐。
- 无旧 Beam/Safe Replacement 双链路；Budget 真实触发但非隐藏 winner。

**建议后续（不在本轮执行）：** 在 `domainAwarePickToSpanReplacementPick` 透传 `candidateId`（非兼容双写、非本轮范围），以便 JobResult/诊断无需启发式 matchKey。
