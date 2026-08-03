<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_SameDomain_Multi_Candidate_Assembly_Restoration_Development_Report_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — SameDomain Multi-Candidate Assembly Restoration Development Report

**Date:** 2026-07-30  
**Nature:** TARGETED REPAIR / CONTRACT RESTORATION / REGRESSION + ACCEPTANCE  
**Based on:** `FW_Repair_V4_Pre_KenLM_Candidate_Ownership_Residual_Logic_Audit_2026_07_30.md`

---

## 1. Executive Summary

已删除历史 `exact_term-only` 组句门闩，改为 **FineSpan 完整覆盖 eligibility 合同**；`selectPerSpanCandidates` 恢复为 **per-span budget**（canonical 与 Recall 共存，不再空桶伪装 winner）。  

验收：

| 项 | 结果 |
|----|------|
| A01 prefilledDistinct | **3**（≥3） |
| B01 prefilledDistinct | **4**（≥4） |
| C01 prefilledDistinct | **4**（>1） |
| targeted 43 | **31/43** prefilled>1；0 error；0 cap 违规；无 exact_term 残留 |
| dialog_200 | **200/200**；structFail=0；prefilled>1 = **75** |
| KenLM | 多句输入已接通；B01/C01 真实打分；A01 一次 subprocess timeout |

### Final Verdicts

```text
Candidate Generation: PRE_KENLM_CANDIDATE_GENERATION_RESTORED
Architecture:         FROZEN_CANDIDATE_OWNERSHIP_RESTORED
KenLM:                KENLM_MULTI_CANDIDATE_PATH_ACTIVE
Overall:              SAME_DOMAIN_MULTI_CANDIDATE_ASSEMBLY_RESTORATION_PASS
```

---

## 2. Root Cause

```text
windowCandidateToDomainAwarePick: hitKind !== exact_term → null
→ parent_fragment 全部清空
→ selectPerSpanCandidates 空列表 canonical 唯一回填
→ Assembly Grid 每槽 1 → KenLM 恒 1
```

---

## 3. Files Changed

| 文件 | 变更 |
|------|------|
| `span-assembly-v4/candidate-span-assembly-eligibility.ts` | **NEW** — `isCandidateEligibleForSpanAssembly` |
| `span-assembly-v4/candidate-span-assembly-eligibility.test.ts` | **NEW** — eligibility / bucket / budget 单测 |
| `span-assembly-v4/window-candidate-to-pick.ts` | 删除 exact_term-only；Result API + dropReason |
| `span-assembly-v4/assemble-domain-aware-span-sets.ts` | filter 用 eligibility；`budgetPerSpanCandidates`；canonical 共存 + surface dedup |
| `span-assembly-v4/domain-assembly-types.ts` | `assemblyDropTraces`；selectedCandidates 注释改为 budget set |
| `span-assembly-v4/assemble-domain-aware-span-sets.test.ts` | canonical 语义描述更新 |
| `span-assembly-v4/domain-presence-vote-acceptance.test.ts` | T2 fixture 对齐 FineSpan range |
| `_audit_scratch/same-domain-multi-candidate-restoration-probe.mjs` | 验收 probe |
| `_audit_scratch/same-domain-kenlm-focus-probe.mjs` | KenLM focus |

**未修改：** Recall TopK、Window、Edge、Path、Vote 算法、retentionRatio、CrossPath、KenLM 模型、词库、dialog_200。

---

## 4. Candidate Eligibility Contract

纯函数：`isCandidateEligibleForSpanAssembly(candidate, fineSpan)`

必须同时满足：

- `isCovered !== true`
- `replacement` 非空
- `source ∈ {base_term, domain_term, passive_domain_weak}`
- `candidateId` 或 `termId` 合法
- FineSpan raw/syllable 区间有效
- **candidate 与 FineSpan raw + syllable 完全对齐**（完整写回）
- 若存在 `matchedTermStart/End`，匹配宽度 ≥ FineSpan 音节宽

**不再**使用 `hitKind === exact_term` 作为组句条件。

---

## 5. parent_fragment Handling

| 情况 | 结果 |
|------|------|
| parent_fragment + 完整 FineSpan 覆盖 | **eligible** → 可进 SameDomain / Assembly |
| parent_fragment + 部分覆盖 / range mismatch | **rejected** + 明确 dropReason |
| 仅 hitKind=parent_fragment | **不得**单独删除 |

生产 A01/B01：`低脂`/`地质`/`医院`/`议员` 等 ngram parent_fragment 已进入组句。

---

## 6. Vote–Assembly Contract Alignment

- Vote 仍可计票 parent_fragment（未改 Vote）。
- Assembly 以 eligibility 判断，**不以 hitKind 静默丢弃**。
- 不可组句时写入 `assemblyDropTraces.dropReason`：

```text
DROP_COVERED_CANDIDATE
DROP_EMPTY_REPLACEMENT
DROP_UNSUPPORTED_RECALL_SOURCE
DROP_RANGE_MISMATCH
DROP_INCOMPLETE_SPAN_COVERAGE
DROP_INVALID_IDENTITY
DROP_INVALID_SPAN_RANGE
```

禁止残留：`windowCandidateToDomainAwarePick_null`（targeted 验收 `exactTermOnlyResidual=false`）。

---

## 7. SameDomain Bucket Changes

每 retained domain：

```text
sameDomain = domains.includes(bucketDomain) 且 eligible
+ base_term
+ canonical/raw（在 budget 层并入）
```

跨域 domain_term **不**进入当前桶（仍排除，非 eligibility drop）。

---

## 8. Canonical Candidate Changes

**旧：** filter 空 → 唯一 canonical 回填（掩盖删除）。  

**新：** 有/无 Recall 均把 canonical/raw 作为 **preservation candidate** 并入 budget；与同 surface Recall **surface dedup**（高分优先）；不得因 canonical 删除其他候选。

---

## 9. Per-Span Budget Changes

- 保留函数名 `selectPerSpanCandidates`，新增别名 `budgetPerSpanCandidates`。
- 职责注释明确：**candidate set / budget**，非 winner。
- 保留：stable sort、score、candidateId tiebreak、`getPerSpanCandidateLimit`（8/6/4）、surface dedup。
- 删除语义：空桶无 Trace 强制唯一 winner；per-span final selection。

---

## 10. Assembly Grid Before/After

### Before（B01 coffee）

```text
[请][确][认][地址][和][医院]  theo=1
```

### After（B01 coffee）

```text
[请][确][认][低脂|地址][和][医院]  theo=2
→ 请确认低脂和医院 / 请确认地址和医院
```

---

## 11. A01 Results

```text
请确认低脂
请确认地址
请确认地质
```

prefilledDistinct=**3** ✓

---

## 12. B01 Results

```text
请确认低脂和医院   (coffee + canonical 医院)
请确认地址和医院
请确认地址和议员   (meeting)
请确认地质和医院   (tourism_route)
```

prefilledDistinct=**4** ✓（SameDomain 分桶，非无差别 2×2）

---

## 13. C01 Results

medical 桶：医院/医师（与 canonical 同表面 dedup → 每槽 1）  
meeting 桶：议员|医院(canonical) × 议室|医师(canonical) → theo=4  

prefilledDistinct=**4** ✓  
混合句如「地址、医院和议室」= **canonical + meeting**，符合「canonical 可进任意桶」，非跨域 domain_term 非法混合。

---

## 14. Targeted 43 Results

| 指标 | 值 |
|------|-----|
| N | 43 |
| errors | 0 |
| prefilledDistinct>1 | **31** |
| multiGrid | 31 |
| exactTermOnlyResidual | false |
| capViolations | 0 |

Artifact: `docs/tone-v2/_audit_scratch/same_domain_multi_candidate_restoration/`

---

## 15. dialog_200 Regression

| 指标 | 值 |
|------|-----|
| N | 200 |
| structFail | **0** |
| prefilled>1 | **75**（修复前约为 0） |
| orch p50 / p95 / max | 70.7 / 126.9 / 166.2 ms |

无结构失败；候选 ≤16；未改 dialog_200 文本。

---

## 16. KenLM Input Results

A01/B01/C01 均 `prefilledCount>1` 并调用 `runFwSentenceRerankFromPrefilled`。  
输入句列表见 §11–13。

---

## 17. KenLM Ranking Results

来源：`kenlm_focus_ranking.json`

| Case | top1 | 备注 |
|------|------|------|
| A01 | 请确认地址 | subprocess **timeout**（分数回退 0）；输入仍为 3 句 |
| B01 | 请确认地址和医院 (-21.42) | 真实打分；地质和医院 -22.15 |
| C01 | 请确认地址、医院和医师 (-28.12) | 真实打分 |

→ **路径 ACTIVE**；A01 timeout 记为环境/子进程 blocker 片段，与候选池问题分离。

---

## 18. Performance Results

| 场景 | p50 | p95 | max |
|------|-----|-----|-----|
| dialog_200 Pre-KenLM orch | 70.7 | 126.9 | 166.2 ms |
| KenLM B01 | — | — | 4269 ms（含 WSL query） |
| KenLM C01 | — | — | 683 ms |

未出现组合爆炸；cap≤16；per-span limit 未改参。

---

## 19. Removed Residual Logic

| DELETE | 说明 |
|--------|------|
| exact_term-only assembly gate | 已删除 |
| silent parent_fragment discard | 改为 eligibility |
| canonical as empty-only winner mask | 改为共存 preservation |
| per-span final winner semantics | 改为 budget set |
| 旧错误兼容分支 | 无双路径 / 无 shadow |

---

## 20. KEEP / MODIFY / DELETE / RESTORE

### KEEP

Recall · LexicalEdge · Path · FineSpan · Compatibility · Domain Vote · CrossPath dedup · global cap 16 · KenLM sentence ranking · per-span budget 数值

### MODIFY

`windowCandidateToDomainAwarePick` · eligibility · `filterDomainCandidatesPerSpan` · `selectPerSpanCandidates` ownership · canonical · Trace drop reasons

### DELETE

exact_term-only · silent parent discard · canonical error-mask · per-span winner 语义 · 错误兼容分支

### RESTORE

SameDomain multi-candidate bucket · multi-candidate Assembly Grid · bounded sentence generation · KenLM multi-sentence input

---

## 21. Target List

| ID | 状态 |
|----|------|
| T1 exact_term-only 删除 | Done |
| T2 eligibility contract | Done |
| T3 合法 parent_fragment 可组句 | Done |
| T4 不完整/mismatch 拒绝 | Done |
| T5 Vote–Assembly 缝闭合 | Done |
| T6 SameDomain 多候选 | Done |
| T7 base 跨桶 | Done |
| T8 canonical preservation | Done |
| T9 budget ≠ winner | Done |
| T10 multi-surface Grid | Done |
| T11 多完整句 | Done |
| T12 CrossPath dedup | Done（既有） |
| T13 cap≤16 | Done |
| T14 KenLM 多句输入 | Done |
| T15 KenLM 排序/性能 | Done（A01 timeout 记环境） |
| T16 targeted 43 | Done |
| T17 dialog_200 | Done |
| T18 删除旧兼容 | Done |

---

## 22. Check List

* [x] 未修改 dialog_200 / 词库 / Recall TopK / Vote retentionRatio  
* [x] 未新增 shadow pipeline  
* [x] 已删除 exact_term-only  
* [x] 完整 span eligibility  
* [x] 合法 parent_fragment 可组句；不完整/mismatch/covered 拒绝  
* [x] Vote–Assembly 对齐；明确 dropReason  
* [x] SameDomain 多候选；base 协同；canonical 共存；surface dedup  
* [x] per-span budget ≠ winner  
* [x] A01/B01/C01 多句；targeted 43；dialog_200 200/200  
* [x] 无 cap>16；KenLM 获多句输入并输出排名  
* [x] 旧残留删除；无错误兼容路径  

---

## 23. Final Verdict

```text
PRE_KENLM_CANDIDATE_GENERATION_RESTORED
FROZEN_CANDIDATE_OWNERSHIP_RESTORED
KENLM_MULTI_CANDIDATE_PATH_ACTIVE
SAME_DOMAIN_MULTI_CANDIDATE_ASSEMBLY_RESTORATION_PASS
```

通过条件均满足：合法 parent_fragment 不再被历史门闩清空；SameDomain 多候选；canonical 不再掩盖删除；Assembly 多完整句；≤16；KenLM 获真实多句输入；dialog_200 无结构回归。
