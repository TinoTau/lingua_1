<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_CandidateId_Provenance_Contract_Audit_2026_08_01.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — CandidateId Provenance Contract Audit

**Date:** 2026-08-01  
**Nature:** READ ONLY · CONTRACT AUDIT · PRODUCTION PATH ONLY  
**禁止已遵守:** 未改生产代码 / 类型 / JobResult / IPC / Scheduler / Web / NMT / TTS / 词库 / dialog_200 / Assembly / CrossPath / KenLM；未新增字段 / alias / 双写；未提前透传。

**Artifacts:**

| Artifact | Path |
|----------|------|
| Per-case | `docs/tone-v2/_audit_scratch/candidate_id_provenance/001.json` … `200.json` |
| Aggregate | `docs/tone-v2/_audit_scratch/candidate_id_provenance/_aggregate.json` |
| Summary | `docs/tone-v2/_audit_scratch/candidate_id_provenance/candidate_id_provenance_summary.md` |
| Probe | `docs/tone-v2/_audit_scratch/candidate-id-provenance-probe.mjs` |

**上游基线:** dialog_200 Sentence Assembly Evidence Chain Audit（A1–A18=0, A20=0；A19 = mapper 丢 `candidateId`）。

---

## 1. Executive Conclusion

**Verdict: PARTIAL**

```text
PARTIAL

candidateId 的生成与主要运行链清晰，
但存在明确字段丢失点、内部 provenance 缺口，
或部分跨服务消费者尚未完成合同确认。

实际句子结果不受影响，但开发前仍需限定最小修复范围。
```

| 结论项 | 事实 |
|--------|------|
| 字段起点 | `recall-topk-for-windows.ts`：`` `${windowId}:${candidateSeq}` `` |
| 唯一丢失点（第一次） | `domainAwarePickToSpanReplacementPick`（mapper **漏写**，非显式 null） |
| 业务结果 | KenLM / Vote / Budget / Assembly **不依赖** WindowCandidate.`candidateId` |
| JobResult | `FwDetectorReplacementDiag` **无** `candidateId`；`topCandidates.candidateId` 为合成 `candidate:i`/`raw` |
| 建议合同 | **A. INTERNAL_ONLY** |
| matchKey 碰撞 | **251** 事件 / **123** cases（同 range+surface 多 ID） |

---

## 2. Audit Scope and Exclusions

| In | Out |
|----|-----|
| 生产调用链 `candidateId` 血缘 | 实际透传实现 |
| dialog_200 × 200 只读探针 | JobResult / IPC / 类型修改 |
| 类型合同矩阵（建议状态） | 全局 UUID / lineage DB / candidateIds[] |
| 跨仓库消费者搜索（本仓） | 外部未挂载服务行为推测 |

---

## 3. Existing Provenance Baseline

Sentence Assembly 审计已确认文本链：

```text
Candidate → Bucket → Budget → Assembly → CrossPath → KenLM Input
```

在 `rawStart/rawEnd/surface` 上可对账。正式 ID 链在 mapper 后断裂，探针被迫使用：

```text
matchKey = rawStart:rawEnd:surface
```

---

## 4. Production Call Chain

| 项目 | 内容 |
|------|------|
| 文件路径 | `span-assembly-v4/recall-topk-for-windows.ts` |
| 函数名 | bind / recall topk（构造 `WindowCandidate`） |
| 输入类型 | window hit + window |
| 输出类型 | `WindowCandidate` |
| candidateId 输入状态 | ABSENT（生成点） |
| candidateId 输出状态 | **PRESENT**（required string） |
| 是否字段丢失点 | NO |
| 是否跨合同边界 | NO |
| 分类 | PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `assemble-domain-aware-span-sets.ts` |
| 函数名 | `buildFineSpanCandidatePool` |
| 输入/输出 | `WindowCandidate[]` → `FineSpanCandidatePool` |
| candidateId | PRESENT → PRESENT（passthrough） |
| 丢失点 | NO · PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `assemble-domain-aware-span-sets.ts` |
| 函数名 | `filterDomainCandidatesPerSpan` |
| 输入/输出 | pool → `DomainAwareSpanReplacementPick`（via `windowCandidateToDomainAwarePickResult`） |
| candidateId | PRESENT → PRESENT |
| 丢失点 | NO · PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `assemble-domain-aware-span-sets.ts` |
| 函数名 | `budgetPerSpanCandidates` |
| 输入/输出 | DomainAware picks → selected DomainAware picks（+ canonical） |
| candidateId | PRESENT → PRESENT（canonical 为 `canonical:${spanId}`） |
| 丢失点 | NO · PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `assemble-domain-aware-span-sets.ts` → `window-candidate-to-pick.ts` |
| 函数名 | `assembleDomainAwareSpanSets` → **`domainAwarePickToSpanReplacementPick`** |
| 输入类型 | `DomainAwareSpanReplacementPick`（`candidateId: string` required） |
| 输出类型 | `SpanReplacementPick`（`candidateId?: string` optional） |
| candidateId 输入 | PRESENT |
| candidateId 输出 | **ABSENT**（对象键未写入） |
| 是否字段丢失点 | **YES** |
| 是否跨合同边界 | 内部类型边界（DomainAware → SpanReplacement） |
| 分类 | PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `build-sentence-candidates.ts` |
| 函数名 | `buildSentenceCandidates` |
| 输入/输出 | `SpanReplacementPick[][]` → `SentenceCombination` |
| candidateId | ABSENT → ABSENT（gap canonical 构造也不写 ID） |
| 丢失点 | NO（上游已丢；gap 合法无 ID） · PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `merge-cross-path-sentence-candidates.ts` |
| 函数名 | `mergeCrossPathSentenceCandidates` |
| 输入/输出 | `SentenceCombination[]` 引用保留 · exact text first-wins |
| candidateId | ABSENT → ABSENT（不重建、不再生） |
| 丢失点 | NO（无二次丢失） · PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `rerank-fw-sentences.ts` / `run-fw-sentence-rerank-from-prefilled.ts` |
| 函数名 | `rerankFwSentences` / `runFwSentenceRerankFromPrefilled` |
| KenLM | `scoreBatch([rawText, ...candidates.map(c => c.text)])` · **index 对齐** |
| WindowCandidate.candidateId | 不参与评分 |
| topCandidates.candidateId | **重新生成** `raw` / `candidate:${i}`（语义不同） |
| 分类 | PRODUCTION |

| 项目 | 内容 |
|------|------|
| 文件路径 | `pipeline/result-builder-core.ts` |
| 函数名 | `buildCoreResultExtra` |
| 输出 | `extra.fw_detector = { ...FwDetectorResult }` |
| WindowCandidate.candidateId | **不进入** `FwDetectorReplacementDiag` |
| 分类 | PRODUCTION |

---

## 5. CandidateId Generation

回答审计问题：

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否来自数据库？ | **否**。`termId` 另存；ID 为运行时绑定 |
| 2 | 是否由 Recall 运行时生成？ | **是** — `recall-topk-for-windows.ts` |
| 3 | 是否基于 termId/surface/source？ | **否** — `` `${window.windowId}:${candidateSeq}` `` |
| 4 | 每次运行是否稳定？ | **同输入同窗口枚举顺序下稳定**；非跨进程全局 UUID |
| 5 | 同候选跨 Path 是否同 ID？ | **否必然**。各 Path 各自 window bind；`windowId` 常为音节区间串，**不同 Path 可生成相同格式 ID** 指向各自对象 |
| 6 | 同 surface+range 不同来源是否不同 ID？ | **是** — dialog_200 见 C13（251） |
| 7 | 同 term 不同 FineSpan 是否不同 ID？ | **是**（不同 window / seq） |
| 8 | canonical 是否有 candidateId？ | DomainAware 层 **有** `canonical:${spanId}`；mapper 后 **丢失** |
| 9 | raw fallback / gap 是否有？ | `makeGapCanonicalPick` **不写**；DomainAware canonical 有但 mapper 丢 |
| 10 | base/domain 是否同规则？ | **是** — 同一 bind 函数 |

**唯一性范围:** `path × window × bind-sequence`（**runtime object / path-local**），**非** global / utterance-global。

---

## 6. ID Stability and Uniqueness（dialog_200）

| 指标 | 值 |
|------|-----|
| totalCandidates（pool 活跃） | 1143 |
| candidateIdsAtPool | 1143（C1=0） |
| candidateIdsAfterBucket | 940 |
| candidateIdsAfterBudget / DomainAwarePick | 6616（含多 Path×Bucket×canonical） |
| candidateIdsAtSpanReplacement | **0** |
| candidateIdsAtSentenceReplacement | **0** |
| candidateIdsAtCrossPath / KenLM input | **0** |
| candidateIdsAtJobResult（WindowCandidate 语义） | **0** |
| lostAtMapper | **6616**（200/200 cases） |
| nullAtSentence | 11694 |
| matchKeyCollisions / sameRangeSurfaceDifferentId | **251**（123 cases） |
| sameIdDifferentRange / Surface | **0** |
| C2 / C3（Bucket/Budget 改 ID） | **0** |
| C11 / C12 | **0** |

检测结论：

| 异常 | 结果 |
|------|------|
| ID_COLLISION（同 ID 异候选） | **未检出**（本探针范围） |
| ID_REGENERATED（Bucket/Budget） | **否** |
| ID_DROPPED | **是 — mapper** |
| ID_NULLIFIED | **否**（未写键 → ABSENT，非 `null`） |
| ID_REUSED_ACROSS_DIFFERENT_CANDIDATES | 未检出跨表面复用 |
| ID_CHANGED_AFTER_BUDGET/BUCKET | **否** |

---

## 7. Field Lineage Matrix

| Stage | Type | Field | Writer | Value Source | Reader | Status |
|-------|------|-------|--------|--------------|--------|--------|
| Recall bind | `WindowCandidate` | `candidateId: string` | `recall-topk-for-windows` | `` `${windowId}:${seq}` `` | pool/compat/vote | PRESENT |
| Pool | `FineSpanCandidatePool.candidates` | same | passthrough | upstream | Bucket filter | PRESENT |
| Bucket | `DomainAwareSpanReplacementPick` | `candidateId: string` | `windowCandidateToDomainAwarePickResult` | `candidate.candidateId` | Budget | PRESENT |
| Budget | `DomainAwareSpanReplacementPick` | same + `canonical:*` | budget / `domainAwareCanonicalFromPathFineSpan` | upstream / synthetic | Grid | PRESENT |
| Grid map | `SpanReplacementPick` | `candidateId?` | **`domainAwarePickToSpanReplacementPick`** | **dropped** | Assembly | **LOST** |
| Sentence | `SentenceCombination.replacements` | `candidateId?` | copy picks / gap ctor | ABSENT | CrossPath/KenLM | ABSENT |
| CrossPath | same object ref | — | first-wins text | ABSENT | KenLM | ABSENT |
| KenLM score | string[] | — | `c.text` | n/a | scorer | N/A |
| KenLM diag | `topCandidates[].candidateId` | **new** | `rerankFwSentences` | `candidate:${i}`/`raw` | JobResult diag | PRESENT（**异义**） |
| Approved | `FwApprovedReplacement` | — | mapSentenceToApproved | 无 ID 字段 | apply | ABSENT |
| JobResult.replacements | `FwDetectorReplacementDiag` | — | result builder | 无 ID 字段 | 外部 | ABSENT |

---

## 8. Exact Loss Point

### 8.1 Mapper 逐字段

**Input: `DomainAwareSpanReplacementPick`**

```text
{
  span, word,
  candidateId: string,     // PRESENT
  domains?, graphSource, hitKind, score, repairTarget, recallSource
}
```

**Output: `SpanReplacementPick`（当前生产）**

```text
{
  span, word, source: recallSource,
  priorScore, repairTarget, candidateScore
  // candidateId: 未映射 → ABSENT（类型允许 optional，调用方未传）
}
```

**丢失性质:**

```text
类型存在但调用方未传（UNMAPPED_ABSENT）
≠ 显式置 null
≠ 类型不存在
≠ 后续 clone 二次丢失
```

### 8.2 唯一性

| 问题 | 答案 |
|------|------|
| 这是唯一第一次丢失点吗？ | **是**（DomainAware → SpanReplacement） |
| 后续第二次丢失吗？ | **否** — CrossPath 保留对象引用；无字段可丢 |
| canonical DomainAware 是否同 mapper？ | **是** — `assembleDomainAwareSpanSets` 对所有 selected 调同一函数 |
| gap pick | `makeGapCanonicalPick` **从不写** candidateId（合法 ABSENT） |
| repair vs gap 类型 | 同为 `SpanReplacementPick`；靠 `source` / `repairTarget` 区分 |

代码位置：

```69:79:electron_node/electron-node/main/src/fw-detector/span-assembly-v4/window-candidate-to-pick.ts
export function domainAwarePickToSpanReplacementPick(
  pick: DomainAwareSpanReplacementPick
): SpanReplacementPick {
  return {
    span: pick.span,
    word: pick.word,
    source: pick.recallSource,
    priorScore: pick.score,
    repairTarget: pick.repairTarget,
    candidateScore: pick.score,
  };
}
```

---

## 9. Type Contract Matrix

| Type | candidateId | Required? | Producer | Consumer | 建议状态 |
|------|-------------|----------:|----------|----------|----------|
| `WindowCandidate` | `string` | YES | recall bind | Vote/compat/assembly | **KEEP** |
| `FineSpanCandidatePool` | via candidates | YES | pool builder | Bucket | **KEEP** |
| `DomainAwareSpanReplacementPick` | `string` | YES | window→pick / canonical | Budget/Grid | **KEEP** |
| `DomainAwarePick`（同 DomainAware） | `string` | YES | 同上 | mapper | **KEEP** |
| `SpanReplacementPick` | `string?` | NO | mapper / gap | Sentence | **KEEP 类型；MODIFY mapper 写入** |
| `SentenceCombination` / SentenceReplacement | via picks | NO | Assembly | CrossPath/KenLM | **KEEP；透传后 PRESENT for repair** |
| `SentenceCandidate`（无独立类型；即 Combination） | — | — | — | — | — |
| KenLM input | 无（text[]） | — | rerank | scorer | **DO NOT ADD** |
| `topCandidates[].candidateId` | `string` | YES | rerank **合成** | diag/JobResult | **KEEP（勿与 Window ID 混用）** |
| `FwSpan` / span candidates | `candidateIndex` | — | prefilled | selected apply | **KEEP** |
| `FwDetectorReplacementDiag` | **无字段** | — | diag builder | JobResult | **DO NOT ADD（本轮）** |
| `FwApprovedReplacement` | **无字段** | — | map approved | apply text | **DO NOT ADD** |
| JobResult.extra.fw_detector | 见上 | — | result-builder | 跨服务 | **DO NOT ADD 新字段；INTERNAL_ONLY** |

null vs undefined：mapper 后为 **键缺失（undefined）**；JSON 序列化时字段不出现。`null` 混用未在生产 mapper 出现。

spread 风险：若未来 `{ ...pick }` 从 DomainAware 展开到 SpanReplacement，需注意 `domains`/`graphSource` 不得泄漏进 KenLM/JobResult 合同；当前最小修复应 **显式只加 `candidateId`**。

---

## 10. Repair / Canonical / Raw ID Semantics

| Replacement 种类 | DomainAware 层 | SpanReplacement 层（当前） | 合同建议 |
|------------------|----------------|----------------------------|----------|
| Recall-derived repair | MUST PRESENT | 当前 ABSENT（bug） | **MUST PRESENT** after fix |
| Canonical preservation (`canonical:*`) | PRESENT synthetic | ABSENT after mapper | 可 **PRESENT** 透传或保持 ABSENT+`source=canonical_exact` |
| Gap fill (`makeGapCanonicalPick`) | n/a | ABSENT | **MUST ABSENT** 合法 |
| Raw fallback | 同上 | ABSENT | 合法 ABSENT |

```text
当前 null/absent 对 gap/canonical：合法（source 可区分）
当前 absent 对 repairTarget=true：不合法（诊断缺口）
C17：ID 缺失后仅靠 source/repairTarget 区分；ID 本身不可区分 — 记为可观测风险，非业务分支错误
```

---

## 11. Sentence Provenance

1. Sentence 直接保存 `replacements: SpanReplacementPick[]` — **是**  
2. 当前完整 candidateId — **否**（全 ABSENT）  
3. `uniqueByText` first-wins — 保留**首次** Combination 对象及其 replacements  
4. 同 text 不同结构 — **只保留 first**；其他来源丢弃（文本 provenance，非多源候选 provenance）  
5. 保留句的 candidateId — 当前不足以解释候选来源  
6. 去重丢失其他来源 — **是**（设计如此）  
7. many-to-one provenance — **OUT_OF_SCOPE**（本轮不需要 candidateIds[]）

---

## 12. Bucket Dedup Provenance

Budget 内 `dedupePicksByIdentity` 以 `candidateId`（或 fallback matchKey）去重 — **依赖 DomainAware 层 ID，工作正常**（C3=0）。

Bucket text dedupe 在 Sentence 层（`uniqueByText`）— 丢失等价来源结构，属既有设计，**非本轮 MODIFY**。

---

## 13. CrossPath Provenance

| 问题 | 答案 |
|------|------|
| 是否复制完整 replacements？ | **是** — push 原 `SentenceCombination` 引用 |
| 是否重建导致丢字段？ | **否** |
| first-wins 保留首个来源？ | **是**（含其 replacements 对象） |
| 其他来源？ | **完全丢弃**（仅计 duplicateCount） |
| duplicateSourceSentenceIds？ | **OUT_OF_SCOPE** |
| 本轮修复范围？ | **否** — CrossPath 不改 |

因 mapper 已丢 ID，CrossPath「保留」的也是无 ID 的 replacements → C7=0（无 *额外* 丢失）。

---

## 14. KenLM Input Mapping

| 问题 | 答案 |
|------|------|
| 是否只接收 string[]？ | 评分路径：**是**（`[rawText, ...texts]`） |
| 映射表？ | 内存数组 index：`candidates[i]` ↔ `batch.scores[i+1]` |
| 排序后 index？ | 选优用 `bestIndex` 对**原 candidates 数组**；`topCandidates` 另排序仅诊断 |
| text duplicate？ | CrossPath 已 exact text dedupe |
| candidateId 缺失影响评分？ | **否**（代码证明：仅用 `c.text`） |

---

## 15. KenLM Output and Selected Candidate Mapping

| 问题 | 答案 |
|------|------|
| selectedCandidateIndex | 写在 **coarse/FwSpan.candidates** 上，按 **word** 匹配 picked replacement |
| CrossPath 后重排？ | 合并顺序稳定；KenLM 不重排输入数组 |
| 能否找回 SentenceCombination？ | `picked = candidates[bestIndex]` 直接引用 |
| apply 是否需要 WindowCandidate.candidateId？ | **否** — `mapSentenceToApprovedReplacements` 只用 span/word/repairTarget |
| fwSpan 来源 | overlap + word 匹配 |
| rawRange+surface 再匹配？ | apply 路径用 word/overlap；**诊断探针**才用 matchKey |

---

## 16. JobResult Serialization

| 问题 | 答案 |
|------|------|
| 是否序列化 Sentence replacements？ | `sentenceRerank.picked` **可能**整对象进入 `extra.fw_detector`（含 replacements） |
| replacements diag 是否有 candidateId？ | **`FwDetectorReplacementDiag` 无此字段** |
| topCandidates.candidateId？ | **有**，值为合成 index ID |
| null / 缺失 / 未定义？ | WindowCandidate ID：**未定义于 replacements diag**；picked.replacements.candidateId：**键缺失** |
| 内部透传是否改变 JobResult JSON？ | **若** `picked` 被序列化且 mapper 写入 `candidateId`，则 **可选字段从缺席变为 string** |
| 是否合同变更？ | 对 `FwDetectorReplacementDiag`：**否（无该字段）**；对 `picked.replacements`：**值/键出现变更 → 需消费者确认，属 P1/P2** |

---

## 17. Cross-Service Consumer Inventory

本仓库搜索结果：

| 位置 | 分类 |
|------|------|
| Node fw-detector 内部（Vote/compat/budget/diag） | **READS_CANDIDATE_ID**（DomainAware / Window 层） |
| `rerank-fw-sentences` topCandidates | **READS** 合成 ID（异义） |
| `result-builder-core` | **SERIALIZES_ONLY** 整个 `fw_detector` |
| `webapp/` | **无匹配** `candidateId` / `sentenceRerank` |
| `central_server/` | **无匹配** |
| dialog_200 / experiments 分析脚本 | 读 `fw_detector` metrics / text；**READS_REPLACEMENT_BUT_NOT_ID**（Window 语义） |
| Scheduler / 独立 NMT / TTS 服务代码 | **NOT AUDITED — EXTERNAL REPOSITORY REQUIRED**（本 monorepo 无独立 scheduler/web 消费实现） |

---

## 18. Compatibility Risk

| Consumer | Current Expected Type | Actual Current Value | Future Real ID Compatible? | Risk |
|----------|----------------------|----------------------|----------------------------|------|
| `FwDetectorReplacementDiag` | 无 candidateId | n/a | N/A（不建议加） | P3 |
| `sentenceRerank.topCandidates.candidateId` | string `raw`/`candidate:i` | 合成 | **勿改为 Window ID** | P0 若混用 |
| `sentenceRerank.picked.replacements.candidateId` | 常缺席 | undefined | optional string 兼容 | **P1**（外部未审）/ **P2** snapshot |
| Vote/Budget | string required | PRESENT | 不变 | P3 |
| KenLM scorer | text | text | 无关 | P3 |
| webapp/central_server（本仓） | 无读者 | — | — | P3 |
| 外部 Scheduler/NMT/TTS | UNKNOWN | UNKNOWN | UNKNOWN | **P1 — REQUIRES_SEPARATE_CONTRACT_AUDIT** |

---

## 19. dialog_200 Runtime Findings

- cases: **200/200**  
- lostAtMapper: **6616**（含 canonical DomainAware picks）  
- repairReplacementsWithoutId: **1071**（C6）  
- gap/canonical without id after sentence: **10623**（C17 计数；多数为合法 gap + source 可分）  
- C9 KenLM 错映: **0**（本探针未跑子进程评分；静态证明 index 映射独立于 ID）  
- C14 业务分支依赖 null candidateId: **0**（生产分支未见）

---

## 20. MatchKey Collision Analysis

| 项 | 值 |
|----|-----|
| 碰撞事件数 | **251** |
| 涉及 Case | **123 / 200** |
| 含义 | 同 `rawStart:rawEnd:surface` 对应 **多个** WindowCandidate.`candidateId`（多 Path / 多 seq / 多 hit） |
| 可否作正式机制？ | **仅 Probe / 启发式**；不能替代 candidateId（歧义） |
| 示例 | d001 `26:28:蓝莓` → ids `22:24:8`,`22:24:9` |

---

## 21. Anomaly Inventory

| Code | Count | 说明 |
|------|------:|------|
| C1 | 0 | 源无 ID |
| C2 | 0 | Bucket 改 ID |
| C3 | 0 | Budget 改 ID |
| C4 | 0 | DomainAware 投影丢 ID（Bucket 转换保留） |
| **C5** | **6616** | **mapper 丢失** |
| **C6** | **1071** | Sentence repair 无 ID |
| C7 | 0 | CrossPath 额外丢失 |
| C8 | 7102 | KenLM 输入 replacements 无 Window ID（后果计数） |
| C9 | 0 | KenLM 错句（index 证明无关） |
| C10 | 0 | JobResult 丢掉「已有内部 ID」— 内部 ID 未到达 |
| C11/C12 | 0 | ID 碰撞/双 ID |
| **C13** | **251** | matchKey 碰撞 |
| C14 | 0 | null 作业务分支 |
| C15/C16 | 0 | 消费者假设（本仓未见） |
| C17 | 10623 | ID 层不可分 repair/raw（source 仍可分） |
| C18 | 0 | Probe≠生产对象图 |

---

## 22. Minimum Repair Options

### 方案 A：仅内部透传 — **推荐**

```text
DomainAwarePick.candidateId
→ SpanReplacementPick.candidateId
→ SentenceReplacement
→ internal SentenceCombination
```

| 问题 | 答案 |
|------|------|
| 可行？ | **是** — 类型已有 `candidateId?` |
| 完成 dialog_200 provenance？ | **是**（repair；canonical 可选透传） |
| 改变序列化？ | 若 `picked` 进入 JobResult → replacements 可能多出键；需 strip 或接受 P1/P2 |
| 额外 strip？ | 若坚持 JobResult 不变：在 result-builder **剥离** replacements.candidateId（属另轮合同/实现） |

### 方案 B：修复既有 JobResult 字段值

```text
不适用作为主方案：
FwDetectorReplacementDiag 无 candidateId；
topCandidates.candidateId 是异义合成 ID，禁止「修成」WindowCandidate ID。
```

若仅指 `picked.replacements.candidateId` 从缺席→string：接近 **B 的弱形式**，但字段本可选且常缺席 → 归 **INTERNAL_ONLY + 序列化副作用审计**。

### 方案 C：新增 candidateIds[]

**不必要** — 过度设计；无消费者需求。多来源聚合 **OUT_OF_SCOPE**。

### 方案 D：继续 matchKey

可作 Probe；**不可**作正式唯一键（251 碰撞）。

---

## 23. Ownership Matrix

| 产物 | Owner | 非 Owner |
|------|-------|----------|
| Candidate ID generation | `recall-topk-for-windows` | Assembly |
| Candidate ID passthrough | mappers（尤其 `domainAwarePickToSpanReplacementPick`） | KenLM |
| Sentence text | Assembly | candidateId |
| Sentence provenance | `SentenceCombination.replacements` | CrossPath 不得重建 |
| CrossPath provenance preservation | CrossPath（引用保留） | Vote |
| KenLM index mapping | `rerankFwSentences` | candidateId 生成器 |
| JobResult serialization | Result Builder | Assembly 不得私改合同 |
| Cross-service schema | 各服务合同 Owner | 单一 Node 模块 |

---

## 24. KEEP / MODIFY / DO NOT MODIFY

### KEEP

```text
现有 candidateId 生成规则（windowId:seq）
Sentence 文本逻辑
CrossPath exact text first-wins
KenLM index mapping
topCandidates 合成 candidateId 语义（勿混用）
```

### MODIFY（建议开发轮，本轮不执行）

```text
domainAwarePickToSpanReplacementPick — 显式复制 candidateId
（可选）canonical 透传策略文档化
内部诊断探针改回 ID 主键
```

### DO NOT MODIFY

```text
Vote / Bucket 过滤 / Budget 排序算法
Assembly 文本算法
CrossPath 文本行为
KenLM scoring
JobResult schema（本轮及默认下一轮）
Web / Scheduler / NMT / TTS
```

---

## 25. Requires Separate Contract Audit

```text
- JobResult.extra.fw_detector.sentenceRerank.picked.replacements 出现 candidateId 键
- 任何向 FwDetectorReplacementDiag 新增 candidateId
- 外部 Scheduler / Web / NMT / TTS 对 fw_detector JSON 的 schema / zod / protobuf
- 将 topCandidates.candidateId 与 WindowCandidate.candidateId 统一命名
```

---

## 26. Target List

| ID | 答案 |
|----|------|
| T1 | `recall-topk-for-windows`（Recall bind） |
| T2 | path/window bind-sequence（runtime object）；非 global |
| T3 | **是** — 251 碰撞事件 |
| T4 | **是**（不变） |
| T5 | **是**（不变） |
| T6 | `domainAwarePickToSpanReplacementPick` |
| T7 | 类型可选 + **mapper 漏写**（UNMAPPED_ABSENT） |
| T8 | **是** — repair 应有；gap 可无；canonical DomainAware 有、mapper 后无 |
| T9 | Recall-derived repair replacements |
| T10 | gap / 部分 raw preservation（靠 source） |
| T11 | 类型能保留；当前值不能 |
| T12 | Bucket 身份去重不丢 ID；Sentence text dedupe 丢等价来源结构 |
| T13 | 保留对象但不含 ID（上游已丢） |
| T14 | **否** |
| T15 | **是**（对 prefilled combinations 数组） |
| T16 | **只影响诊断 / provenance**；不影响句子选择 |
| T17 | replacements diag：**无**；topCandidates：**有（异义）**；picked.replacements：**可选键常缺席** |
| T18 | Window 语义：无；合成：string；picked：undefined |
| T19 | 本仓无跨服务读者；外部 **NOT AUDITED** |
| T20 | 若仅 picked 可选键：弱兼容；若改 topCandidates 语义：**不兼容** |
| T21 | **是 — INTERNAL_ONLY** |
| T22 | strip at result-builder **或** 单独合同确认后允许键出现 |
| T23 | **251** |
| T24 | **否**（仅 Probe） |
| T25 | 文件：`window-candidate-to-pick.ts`（+ 针对性单测）；类型已具备；勿改 JobResult |
| T26 | JobResult picked 序列化；外部服务 schema；topCandidates 命名 |
| T27 | **否**（不改变 Vote/Budget/Assembly/KenLM 结果） |
| T28 | 单个 ID 足够；**不需要** candidateIds[] |
| T29 | `termId` 存在但语义不同；不可替代；合成 `candidate:i` 不可复用为 Window ID |
| T30 | **A. INTERNAL_ONLY** |

---

## 27. Check List

```text
[x] 未修改任何代码
[x] 未修改任何类型
[x] 未修改 JobResult
[x] 未修改 IPC
[x] 未修改外部服务
[x] 使用真实生产路径
[x] dialog_200 全部 200 条完成
[x] 找到 candidateId 生成点
[x] 找到 candidateId 唯一性范围
[x] 找到所有 mapper / projector
[x] 精确定位第一次丢失点
[x] 区分 repair 与 raw/canonical replacement
[x] 完成 Sentence 层 provenance 审计
[x] 完成 CrossPath provenance 审计
[x] 完成 KenLM index 映射审计
[x] 完成 selected candidate 回写审计
[x] 完成 JobResult 序列化审计
[x] 搜索所有跨服务消费者（本仓）
[x] 无法访问的消费者明确标记
[x] 统计 matchKey collision
[x] 统计 ID collision / regeneration / drop
[x] 输出最小修复边界
[x] 未提出全局 UUID 或复杂 lineage 系统
[x] 未建议删除 JobResult
[x] 所有跨服务改动均列为单独合同审计
```

---

## 28. Final Audit Conclusion

```text
PARTIAL

candidateId 的生成与主要运行链清晰，
但存在明确字段丢失点、内部 provenance 缺口，
或部分跨服务消费者尚未完成合同确认。

实际句子结果不受影响，但开发前仍需限定最小修复范围。
```

**最小修复边界（开发轮，非本轮）：**

1. 仅在 `domainAwarePickToSpanReplacementPick` 写入 `candidateId: pick.candidateId`  
2. 保持 JobResult schema 不变；若 `picked` 序列化带出新键，先做 strip **或** 外部合同审计  
3. 禁止改动 `topCandidates.candidateId` 语义  
4. 禁止引入 `candidateIds[]` / 全局 UUID  

**合同建议标签：`A. INTERNAL_ONLY`**
