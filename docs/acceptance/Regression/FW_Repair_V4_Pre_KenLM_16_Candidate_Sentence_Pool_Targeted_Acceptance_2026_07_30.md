<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Pre_KenLM_16_Candidate_Sentence_Pool_Targeted_Acceptance_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Pre-KenLM 16-Candidate Sentence Pool Targeted Acceptance

| 字段 | 值 |
|------|-----|
| Date | 2026-07-30 |
| Nature | TARGETED TEST · TRACE AUDIT · CANDIDATE POOL ACCEPTANCE · PERFORMANCE COMPARISON |
| 生产修改 | **无**（未改 dialog_200 / 算法 / 阈值 / 词库 / KenLM 模型） |
| Entry (阶段1) | `runSpanAssemblyV4Orchestrator` |
| Entry (阶段2) | `runFwSentenceRerankFromPrefilled` + `createKenlmBatchScorer`（仅当 prefilled>1） |
| Artifacts | `docs/tone-v2/_audit_scratch/pre_kenlm_candidate_pool_acceptance/` |

---

## 1. Executive Summary

在**不修改** dialog_200 与生产链路的前提下：

1. **dialog_200 回归**：200/200 仍恒为 `prefilledCount=1`（行为未变）。
2. **词库只读扫描**确认存在大量同拼音不同表面词；但**生产 Recall** 仅对极少窗口返回 surface-distinct（可稳定触发：`di|zhi`、`yi|yuan`、`yi|shi` 等）。
3. Targeted 集 **43** 条中 **31** 条 Recall 触发多表面；**15** 条 dual、**5** 条 triple（prescan `expectedCombinationPotential` 可达 4 或 8）。
4. 进入 Vote/Bucket/Select 后，`theoreticalCombinationCount` **全部坍缩为 1**；`assemblyDistinctTextCount=0` 例有多句；`prefilledGt1=0`。
5. **KenLM 未获得多候选输入** → 无法验证排序/按候选数性能；本机 `isKenlmSubprocessRunnable` 亦因 query 路径 undefined 报错（次要）。

**总判定：`PRE_KENLM_PIPELINE_BLOCKED`**

瓶颈在 **Recall 之后的 SameDomain Bucket / per-span Select**，不是 KenLM。

---

## 2. Test Boundary

| 项 | 本轮 |
|----|------|
| Electron Runtime / ASR / NMT / TTS | 未启动 |
| dialog_200 | 只读回归 |
| 词库 / 阈值 / Assembly 算法 | 未修改 |
| KenLM | 仅在 prefilled>1 时调用；本轮实际 **0 次有效多候选调用** |

---

## 3. Production Entry and Call Chain

```text
runSpanAssemblyV4Orchestrator
  → Lattice Window/Recall/Edge/Path/FineSpan
  → per-path Vote → SameDomain Bucket → buildSentenceCandidates
  → mergeCrossPathSentenceCandidates → prefilledCombinations
  → [if n>1] runFwSentenceRerankFromPrefilled(createKenlmBatchScorer)
```

---

## 4. dialog_200 Regression Results

| 指标 | 值 |
|------|-----|
| casesTotal | 200 |
| prefilledDist | `{ "1": 200 }` |
| prefilledGt1 | **0** |
| orchMs (count pass) p50/p95/max | 68.3 / 116.7 / 137.0 ms |
| cold/warm | 见 `performance.json`（warm p95≈101–122ms） |

结论：与先前 Span Assembly 验收一致；本 probe **未改变** dialog_200 行为。

---

## 5. Targeted Case Construction Method

1. SQLite 扫描 `base/domain/idiom` 同 `pinyin_key` 多 `word` → `lexicon_surface_ambiguity.json`
2. 生产 `recallTopKForWindows` pre-scan 验证真实命中
3. 发现多数词库歧义键在运行时 **不触发**多表面（Tone-First / TopK / 域过滤）
4. 以可触发的 `地址/医院/医师` 家族扩展 ≥30 条；并保留 D/E/F/G 结构组

`targeted_cases.json`：**43** 条。

---

## 6. Lexicon Pre-scan Results

| 项 | 结果 |
|----|------|
| 词库 surface-ambi keys（useful） | 数十～上百（如 `da|bei`→大杯/大悲/达杯） |
| 模板「请确认{word}」可触发 Recall 多表面 | **极少**（构建器仅稳定命中 3 组） |
| 稳定触发族 | `di|zhi`（低脂/地质）、`yi|yuan`（医院/议员）、`yi|shi`（医师/议室） |

**重要结论：** 词库有歧义 ≠ 生产 Recall 返回多表面。

---

## 7. Triggered vs Non-triggered Cases

| 指标 | 值 |
|------|-----|
| triggered | **31 / 43** |
| dualTriggered | **15** |
| tripleTriggered | **5** |
| TARGET_NOT_TRIGGERED | D01–D05, E01–E05, F02, F03 |

---

## 8–11. Recall → Edge → Path → FineSpan

| 层 | 观察 |
|----|------|
| Recall surface-distinct | 31 case 成立；例 C01：`地址→[低脂,地质]` × `医院→[医院,议员]` × `医师→[医师,议室]` |
| Edge 保留 | 与既有验收一致：多候选进入 Edge（身份/表面） |
| Path | 可完整覆盖；重叠组 E 多数未触发多表面 |
| FineSpan | 候选进入 PathFineSpan；后续 Select 收窄 |

---

## 12–13. Domain Vote / SameDomain Bucket

| 项 | 结果 |
|----|------|
| 多 retainedDomains | 常见（如 coffee + tourism_route / medical + meeting） |
| **每 span 槽表面数** | Bucket 后 **恒为 1**（`perSpanSurfaceCounts` 全 1） |
| theoreticalCombinationCount | **恒为 1**（即使 prescan expected=4 或 8） |

例 **B01** `请确认地址和医院`：

- prescan expected = **4**
- bucket theoretical = **1**
- prefilled = `[请确认地址和医院]`（VALID_RAW）

例 **C01** expected=**8** → bucket theoretical=**1** → prefilled 单句原文。

---

## 14–18. Theoretical vs Actual / Combinations

| 目标 | 结果 |
|------|------|
| 2×2 实际生成 ≥4 不同句 | **0**（`combo2x2Achieved=[]`） |
| 2×2×2 ≥8 不同句 | **0** |
| 理论 ≥16 | **0**（Recall 层未形成足够乘积进入 Bucket） |
| assemblyDistinctGt1 | **0** |
| prefilledEq16 | **0** |

**Case Type 1 违规：** 理论合法不同表面组合 ≥4（prescan），实际 distinct=1 → **BLOCKER**（15 条 B/C）。

---

## 19–20. Candidate Validity

| 项 | 结果 |
|----|------|
| invalidTotal | **0** |
| 典型分类 | `VALID_RAW` |
| 可重建 | 是 |
| 非法重叠 / 丢字截断 | 未发现 |

单句质量结构合法，但**池多样性失败**。

---

## 21–22. Cross-Path / Prefill Distribution

| 集 | prefilled |
|----|-----------|
| dialog_200 | 全部 1 |
| targeted | 全部 1 |

exact-text dedup / cap≤16：平凡成立（输入已唯一）。

---

## 23. Candidate Collapse Layer Analysis

```text
collapseLayers: { BUCKET: 31, RECALL: 12 }
```

| 层 | 含义 |
|----|------|
| RECALL (12) | 未触发 surface-distinct |
| **BUCKET (31)** | Recall 已有多表面，但 SameDomain/Select 后每槽 1 表面 |

**不是** CROSS_PATH / KENLM。  
**不是**「同表面多身份」误判（B/C 的 eligible surfaces 明确不同）。

---

## 24–25. KenLM Input / Ranking

| 项 | 结果 |
|----|------|
| kenlmRan（prefilled>1） | **0** |
| 排序质量 | **KENLM_RANKING_INCONCLUSIVE** |
| 本机 KenLM runnable 探测 | 失败（`query` path undefined → `replace` throw）；次要于池坍缩 |

---

## 26–27. Performance

### Pre-KenLM（orchestrator）

| 集 | p50 | p95 | max |
|----|-----|-----|-----|
| dialog_200 warm | ~64–68 ms | ~101–122 ms | ~140 ms |
| targeted | 见 `performance.json` | | |

### KenLM by candidate count

无样本（全部 n=1）→ **KENLM_PERFORMANCE_INCONCLUSIVE**

---

## 28. Bottleneck Attribution

```text
PRE_KENLM_CANDIDATE_GENERATION_BLOCKED
```

满足：

- 合法理论组合（prescan）≥4，但 prefilled 恒为 1  
- 丢失层明确：**BUCKET / per-span Select**（非 KenLM）

```text
KENLM_NOT_CURRENT_BOTTLENECK
```

（因候选池未形成，KenLM 未被压力测试）

---

## 29. Blocking Issues

| ID | 问题 | 位置 | case | 合同 |
|----|------|------|------|------|
| B1 | Recall 多表面未进入 Bucket 多选槽 | `runDomainAwareAssembly` / `selectPerSpanCandidates` / SameDomain filter | B01–B10, C01–C05（及多数 A） | 不改冻结合同即可审计；修复属 **VOTE_BUCKET** |
| B2 | 无法形成 16 池 / 2×2 / 2×2×2 | 同上 | 全部 targeted 多表面案 | — |

最小下一步（**禁止本轮修改**）：

```text
VOTE_BUCKET
→ 追踪 FineSpan 多表面 candidates 在 filterDomainCandidatesPerSpan /
  selectPerSpanCandidates 中被收成 1 的 reason
→ 回归：B01/C01 expected≥4/8 时 assemblyDistinct 应接近理论
```

---

## 30. Non-Blocking Issues

| ID | 说明 |
|----|------|
| N1 | 词库大量拼音歧义在生产 Recall 不触发（Tone/TopK）— LEXICON_DATA / RECALL |
| N2 | KenLM query 路径探测在本环境抛错 — 环境/配置 |
| N3 | D/E 组多域/重叠未触发 surface-distinct — 预期可接受 |
| N4 | 地址窗 Recall 表面为「低脂/地质」而非含「地址」— 噪声/召回质量观察 |

---

## 31. Target List

| ID | 状态 |
|----|------|
| T1 dialog_200 回归 | ✅ |
| T2 词库 surface-distinct | ✅ |
| T3 ≥30 targeted | ✅ (43) |
| T4 单 Span 多候选 | ✅（Recall 层） |
| T5–T7 2×2 / 2×2×2 / ≥16 | ❌ 组装层未达成（Recall 已具备 2×2/2×2×2） |
| T8–T16 传播/合法性/cap | ✅ 结构；多样性失败于 Bucket |
| T17 坍缩层 | ✅ **BUCKET** |
| T18–T19 候选句与分类 | ✅ |
| T20–T22 KenLM | ⚠️ 无 multi-prefill 可测 |
| T23 瓶颈归因 | ✅ Pre-KenLM Bucket/Select |

---

## 32. Check List

* [x] 未改 dialog_200 / 生产 / 词库  
* [x] 未伪造 prefilled  
* [x] targeted≥30；prescan 支撑  
* [x] 区分同表面多身份 vs 不同表面  
* [x] 单/双/三 Span Recall 触发已记录  
* [x] 2×2/2×2×2 **组装失败**已定位  
* [x] theoretical vs actual  
* [x] 重建/合法性  
* [x] cap≤16 / 无重复进 KenLM（平凡）  
* [x] KenLM：因池=1 跳过；环境探测失败已记录  
* [x] 瓶颈归因完成  

---

## 33. Final Verdict

### 22.1 Candidate Generation

```text
PRE_KENLM_CANDIDATE_GENERATION_BLOCKED
```

### 22.2 Candidate Quality

```text
CANDIDATE_SENTENCE_QUALITY_PARTIAL
```

（单句结构合法 VALID_RAW；池多样性与组合句缺失）

### 22.3 KenLM Performance

```text
KENLM_PERFORMANCE_INCONCLUSIVE
```

### 22.4 KenLM Ranking

```text
KENLM_RANKING_INCONCLUSIVE
```

### Overall

```text
PRE_KENLM_PIPELINE_BLOCKED
```

**一句话：** 当 Recall 已给出不同表面候选（含 2×2 / 2×2×2）时，系统在 **SameDomain Bucket / Select** 无理由收成每槽单表面，导致 KenLM 前恒为 1 句；**KenLM 不是当前瓶颈**。

---

## Appendix — 核心问题短答

1. 多表面 Recall → 多整句？**否**（坍缩在 Bucket）。  
2. 多 FineSpan 组合句？**否**（槽位被收成 1）。  
3. 接近 16？**否**。  
4. 现有单句可解释？**是**（VALID_RAW）。  
5. KenLM 前已坍缩？**是**。  
6. KenLM 是否瓶颈？**否（未触达）**。
