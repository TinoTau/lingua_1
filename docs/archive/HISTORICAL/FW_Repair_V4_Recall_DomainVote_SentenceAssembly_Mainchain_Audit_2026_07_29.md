<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Recall_DomainVote_SentenceAssembly_Mainchain_Audit_2026_07_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Recall → Domain Vote → Sentence Assembly Mainchain Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-29 |
| Nature | **开发前只读审计**（未改代码 / 配置 / 词库 / 测试数据） |
| Prerequisite | Tone Evidence / Mapping **FREEZE_PASS** — [`FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) |
| Verdict | **MAINCHAIN_REPAIR_REQUIRED** |
| Next priority | **SENTENCE_ASSEMBLY** |

---

## 1. Executive Summary

生产主链（V4）已端到端接通：

```text
runFwDetectorOrchestrator
→ runFwDetectorV4Path
→ runSpanAssemblyV4Orchestrator
    → runLtrFineSpanGeneration          ← 当前唯一生产 Fine Span
        → recallTopKForWindows → recallSpanTopKV3 (SQLite)
    → runDomainAwareAssembly
        → voteUtteranceDomainFromPool   ← 整句 Presence Vote
        → SameDomain buckets            ← 生产消费，非仅诊断
    → buildSentenceCandidates × buckets → mergeCrossBucket (≤16)
→ runFwSentenceRerankFromPrefilled      ← KenLM 只评分
→ applyFwSpanReplacements
```

相对本任务冻结目标（句级 Vote · SameDomain · base+domain 组句 · ≤16）：**Recall / Domain Vote / Assembly 均已存在并接线**。  
相对 Lattice Architecture V1.0.0：**生产 Fine Span 仍是 LTR，不是 `SegmentationPath[]`**（`FROZEN.md` 已声明过渡态）。

本轮不开发 Tone / Lattice / KenLM。判定 **MAINCHAIN_REPAIR_REQUIRED**：在进入整链质量冻结前，须先收敛 **Sentence Assembly**（Bucket 真实消费细节、parent_fragment 与组句不一致、预算分配器未驱动截断）并清理确认无生产调用的旧符号。随后批次再处理 Recall L2 批查与 Lattice Path（独立轨）。

Tone 已冻结；**下一主链不得再依赖 Tone 修改**。

---

## 2. Audit Scope

| In | Out |
|----|-----|
| Fine Span / Window → Recall → Domain Vote → SameDomain → Sentence Assembly → KenLM 边界 | Tone / WordTimeSpan / overlap 重开 |
| 调用证据分类 PRODUCTION / LEGACY / TEST_ONLY / DEAD | KenLM 模型 / NMT / 词库扩写 |
| 数据合同与偏差 KEEP/MODIFY/RESTORE/DELETE | 本轮写代码 |

---

## 3. Frozen Target Architecture

```text
FW ASR
→ WordTimeSpan
→ Fine Span / Recall Window
→ Pinyin + Tone Recall Key
→ SQLite Lexicon Recall
→ Candidate Aggregation
→ Sentence-level Domain Vote
→ Winning SameDomain Buckets
→ Domain + Base Sentence Assembly
→ maxSentenceCandidates <= 16
→ KenLM Scoring
```

职责边界：与任务 §3.1–3.6 一致。本任务 Domain Vote = **整句**聚合（非强制本轮落地 Path-scoped；Path-scoped 属 Lattice 轨）。

---

## 4. Production Call Chain

| 顺序 | 文件 | 函数 | 输入 | 输出 | 分类 |
| -: | -- | -- | -- | -- | -- |
| 1 | `pipeline` / ASR | `runAsrStep` | PCM batches | text + `acousticToneSlices` + WTS 原料 | PRODUCTION |
| 2 | `fw-detector-orchestrator.ts` | `runFwDetectorOrchestrator` | Job ctx | V4 path | PRODUCTION |
| 3 | `fw-detector-v4-path.ts` | `runFwDetectorV4Path` | rawText, slices, runtime | assembly + rerank + apply | PRODUCTION |
| 4 | `span-assembly-v4-orchestrator.ts` | `runSpanAssemblyV4Orchestrator` | raw + lexicon + slices | spanSets / sentence candidates | PRODUCTION |
| 5 | `ltr-fine-span-generator.ts` | `runLtrFineSpanGeneration` | syllables, recall callback | `FormalFineSpan[]` + candidates | PRODUCTION |
| 6 | `recall-topk-for-windows.ts` | `recallTopKForWindows` | windows, SQLite runtime | `WindowCandidate[]` | PRODUCTION |
| 7 | `lexicon-v2/recall-span-topkv3.ts` | `recallSpanTopKV3` | RecallKey | SQLite hits | PRODUCTION |
| 8 | `assemble-domain-aware-span-sets.ts` | `runDomainAwareAssembly` | pool + formalSpans | vote + `bucketSpanSets` | PRODUCTION |
| 9 | `utterance-domain-vote.ts` | `voteUtteranceDomainFromPool` | FineSpan pools | retainedDomains | PRODUCTION |
| 10 | `build-sentence-candidates.ts` | `buildSentenceCandidates` / `mergeCrossBucket…` | bucket spanSets | ≤16 texts | PRODUCTION |
| 11 | `kenlm/run-fw-sentence-rerank-from-prefilled.ts` | `runFwSentenceRerankFromPrefilled` | prefilled texts | ranked | PRODUCTION |
| — | `phase1-window-edge-harness.ts` | Lattice harness | edges | TEST_ONLY |
| — | `lexicon/local-span-recall.ts` | legacy recall | — | LEGACY / @deprecated |

---

## 5. Recall Entry and Ownership

- **唯一生产 Recall 入口：** `recallTopKForWindows`（由 LTR `recallForWindows` 回调注入）。
- **无** production shadow / dual Recall pipeline（freeze-contract 断言无 `shadowBeamSpanSets`）。
- Owner：`span-assembly-v4/recall-topk-for-windows.ts` + `lexicon-v2/recall-span-topkv3.ts`。

---

## 6. Recall Key Contract

`CanonicalRecallQuery`（`utterance-recall-cache.ts`）：

| Field | Present |
|-------|---------|
| pinyinKey | Yes |
| toneNorm（可空） | Yes |
| domainScope | Yes |
| exactTopK / parentFragmentTopK | Yes |
| lexiconVersion | Yes |
| surfaceText | Yes（防跨 surface 共享评分） |

窗口字符范围由 window 绑定阶段消费，不单独作为另一套平行 Key 实现。未见第二套生产 Recall Key。

---

## 7. SQLite Lexicon SSOT

| 来源 | 生产候选？ |
|------|-----------|
| SQLite lexicon + `term_domain_tags` via `recallSpanTopKV3` | **是** |
| JSON phraseCandidates / confusionMap / phoneticGroups 作 V4 候选 | **否**（confusionMap 在 `phonetic-correction`，非 V4 assembly 主链） |
| hardcoded 测试样本作生产候选 | **否** |
| legacy `local-span-recall.ts` | **LEGACY**，标注 deprecated |

---

## 8. Multi-Domain Term Handling

- Recall hit / `WindowCandidate` / Hotword 保留 **`domains[]` 全量**（`v4-types`：禁止 `domains[0]` 投影）。
- Vote：`buildFineSpanDomainSet` 对同 span 多候选 **union** 领域；同 domain 在同一 span 只计 **1** 次 presence。
- 多领域 term → 多个 domain 进入该 span 的 DomainSet → 各 domain 各得 1 票（presence），**不是**「一词只留一个 domain」。

词表内容质量（订单/预订/…）本轮只读：不改库；行为以代码合同为准。

---

## 9. Candidate Count Ownership

| 层级 | 控制点 | 值 / 行为 |
|------|--------|-----------|
| Window exact | `V4_LIMITS.exactTopK` | 2 |
| Window parent_fragment | `V4_LIMITS.parentFragmentTopK` | 3 |
| Utterance candidate pool | Compatibility + LTR 提交 | 无第二套爆炸 topK |
| Sentence candidates | `config.maxSentenceCandidates` | **16**（SSOT） |
| Cap 生效位置 | `buildSentenceCandidates` slice · `mergeCrossBucketSentenceCandidates` · rerank config | 多点同 cap，以 runtime config 为唯一数值源 |

未见「先截断再无界扩充」；KenLM 前已 ≤16。

---

## 10. Recall Cache and Batch Query Status

| 层 | 状态 | 证据 |
|----|------|------|
| L1 Utterance 同 Key 缓存 | **已实现且接线** | `createUtteranceRecallContext` → get/set；跨 utterance 新 ctx，不泄漏 |
| L2 同 step 多 Window 真批量 SQL | **未完整** | 仍按 window / key miss 调 `recallSpanTopKV3`；domain multi 内为原子 2-stmt，**不是**多 window 一次 batch |
| L3 Worker 并发 SQLite | **未引入** | 符合「暂不实施」 |

---

## 11. Domain Vote Implementation

- **对象：** 整句所有 Formal Fine Span 的候选池（`voteUtteranceDomainFromPool`）。
- **同 Span 多候选：** 允许；按 DomainSet union，同 domain 一票。
- **base：** `source` 非 `domain_term` / `passive_domain_weak` → **不计票**（`isDomainVoteSource`）。
- **parent_fragment：** 可计票（按 parentTermId 去重）。
- **CPU LLM / Context Prior：** diagnostics / quota 边界；**不**覆写 Vote 计数（`p5-prior-vote-isolation` 等门禁）。
- **保留规则：** 唯一最高 / 并列全留 / `DOMAIN_BUCKET_RETENTION_RATIO=0.75` 接近最高 — 与冻结 Presence Vote 一致。

### 示意投票明细（合同级；非 dialog 单次录音）

| Span | Candidate | Base/Domain | Domain Tags | Vote Contribution |
|------|-----------|-------------|-------------|-------------------|
| S0「中杯」 | 中杯 | domain | milk_tea | milk_tea +1（span presence） |
| S0「中杯」 | （另一 domain 候选） | domain | coffee | coffee +1（同 span 另一标签） |
| S1「奶茶」 | 奶茶 | domain | milk_tea | milk_tea +1 |
| S2「谢谢」 | 谢谢 | base | base_term | **0** |

若 milk_tea=2、coffee=1 → retained ≈ `{milk_tea}`（2 ≥ 0.75×2；coffee=1 < 1.5）。

---

## 12. SameDomain Bucket Implementation

- `runDomainAwareAssembly`：对每个 `retainedDomain`（或证据不足时 `[null]`）生成 `bucketSpanSets`。
- 每桶：`filterDomainCandidatesPerSpan` → `selectPerSpanCandidates`（sameDomain + base）→ `assembleDomainAwareSpanSets`。
- **Orchestrator 对每个 bucket 调用 `buildSentenceCandidates`** → 生产消费，非仅 diagnostics。
- base **不**伪装成虚假领域；进入桶内与 domain 候选并列可选。

---

## 13. Sentence Assembly Implementation

- **机制：** 原句 + 有限 span 替换；`rawOverlap` 区间装配；重叠拒绝计数；按 text 去重；**非**全排列 Beam。
- **混合：** 桶内可选 sameDomain + base → 可生成混合句。
- **≤16：** `kenlmCap = loadFwDetectorRuntimeConfig().maxSentenceCandidates`；每桶生成 cap + 跨桶 merge cap。
- **缺口（MODIFY）：**
  1. `allocateDomainBucketSentenceBudget` 仅 guard，**未**驱动实际 per-bucket 配额分配。
  2. Assembly 侧 pick 构造可见强制 `hitKind: 'exact_term'` 路径 — **parent_fragment 可投票但不一定能以 fragment 身份组句**（Vote/Assembly 语义缝）。
  3. 与 Lattice Architecture「Path-scoped Assembly」文档目标不一致（生产仍 LTR Formal 序列）。

---

## 14. KenLM Input Boundary

KenLM 收到：`runFwSentenceRerankFromPrefilled` 的预填句子列表（raw + assembled texts，已 ≤16）。  
**不**负责 Recall / Domain 决策。符合冻结边界。

---

## 15. Legacy / Duplicate Pipeline Inventory

| Symbol / Module | 调用者 | 分类 | 建议 |
|-----------------|--------|------|------|
| `runLtrFineSpanGeneration` | V4 orchestrator | PRODUCTION（过渡） | KEEP 直至 Lattice Path 替换；**勿**再表述为架构 SSOT |
| Lattice Phase1 harness | tests | TEST_ONLY | KEEP |
| `local-span-recall.ts` | legacy | LEGACY | DELETE（确认无生产 import 后） |
| `confusionMap` / phonetic-correction | 非 V4 assembly | DOC_ONLY / 他链 | 勿接入 V4 候选 |
| `shadowBeamSpanSets` | 已移除 | DEAD | KEEP absent（门禁） |
| `voteUtteranceDomain(` 旧 API | 已移除 | DEAD | KEEP absent |
| `domainId` 旧中间态 | Vote 主链 | 已 Presence domains[] | DELETE 残留引用若有 |
| phraseCandidates 作 V4 候选 | 无生产 | — | DELETE if any leftover generators |

---

## 16. Current Data Contracts

| Type | Owner | Producer | Consumer | Required | Notes |
|------|-------|----------|----------|----------|-------|
| Recall Window (`GlobalWindowDescriptor`) | V4 | LTR / window builders | Recall | text range, syllables | |
| RecallKey (`CanonicalRecallQuery`) | utterance-recall-cache | Recall | Cache + SQL | pinyin, toneNorm, domainScope, topK, surface, lexiconVersion | |
| RecallCandidate (`WindowCandidate`) | V4 | Recall bind | Vote / Assembly | domains[], source, scores, span coords | 全量 domains |
| DomainVoteResult | utterance-domain-vote | Vote | Assembly | retainedDomains, domainScores | base 不计票 |
| SameDomainBucket | `bucketSpanSets` | Assembly | Sentence build | per-domain spanSets | 生产消费 |
| SentenceCandidate | build-sentence-candidates | Assembly | KenLM | text, replacements | ≤16 |
| KenLMInput | rerank-from-prefilled | Orchestrator | KenLM | string[] | 只评分 |

重复字段风险：`domain` vs `domainId`（主链应用 domains[]）；`utteranceDomain` 仅为诊断主键别名，**不**单独驱动 Assembly。

---

## 17. Architecture Deviations

| Finding | Class |
|---------|-------|
| 生产 Fine Span = LTR，架构 SSOT = Lattice Path | **MODIFY**（独立 Lattice 轨；本任务禁直接开发） |
| 句级 Presence Vote + Multi-Bucket + ≤16 | **KEEP**（符合本任务冻结目标） |
| SQLite 唯一候选 SSOT | **KEEP** |
| Utterance Recall Cache L1 | **KEEP** |
| 多 Window 真 Batch SQL L2 未完成 | **DOCUMENT_ONLY** / 可选 MODIFY |
| parent_fragment Vote vs Assembly 不一致 | **MODIFY** |
| Budget allocator 未驱动截断 | **MODIFY** |
| Context Prior 越权 Vote | **未发现**（KEEP 隔离） |
| Tone 再开 | **禁止**（FROZEN） |

---

## 18. KEEP / MODIFY / RESTORE / DELETE List

### KEEP

- `recallTopKForWindows` + SQLite  
- `voteUtteranceDomainFromPool` 句级 Presence  
- SameDomain `bucketSpanSets` 生产消费  
- half-open Tone Mapping（已冻结）  
- `maxSentenceCandidates=16` 配置 SSOT  

### MODIFY

- Sentence Assembly：parent_fragment 与桶内选词一致性；真正使用 bucket budget  
- （后续轨）LTR → Lattice Path 替换 orchestrator 所有权  

### RESTORE

- 无「已实现正确后被改坏」的 Vote 公式需恢复；Presence Vote 保持  

### DELETE

- 确认无引用后删除 `local-span-recall` 等 legacy  
- 禁止恢复 shadow beam / 双写  

### DOCUMENT_ONLY / TEST_ONLY

- Lattice harness  
- Recall L2「循环包装 ≠ 批量」说明  

---

## 19. Target List

| ID | Item | Batch |
|----|------|-------|
| A1 | Assembly：fragment/exact 与 Bucket 选词一致 | **NEXT** SENTENCE_ASSEMBLY |
| A2 | Assembly：budget 分配驱动 ≤16 | NEXT |
| A3 | 清理 legacy recall 符号 | 随 A 或 cleanup |
| R1 | Recall L2 真批量（可选性能） | after A |
| L1 | Lattice Path 替换 LTR（独立轨） | after A；禁本轮 |
| V1 | Path-scoped Vote（依赖 L1） | after L1 |

---

## 20. Check List

- [x] 生产入口追踪完成  
- [x] Recall 单链 + SQLite  
- [x] Vote 整句 + base 不计票  
- [x] Bucket 生产消费  
- [x] Assembly ≤16 / 非 Beam  
- [x] KenLM 边界确认  
- [x] Legacy 分类  
- [x] Tone 不重开  

---

## 21. Recommended Development Batches

```text
Batch 1 (NEXT): SENTENCE_ASSEMBLY
  - parent_fragment ↔ 组句一致性
  - bucket budget 真实生效
  - 重叠/去重/混合句回归（唯一最高 + 并列桶）

Batch 2: RECALL (optional perf)
  - L2 同 step 多 window 批量 SQL（保持 Key 语义）

Batch 3: Lattice Path（独立；非本任务三选一标签）
  - enumerateCompleteSegmentationPaths → 替换 LTR 生产所有权

Batch 4: DOMAIN_VOTE Path-scoped caller
  - 依赖 Batch 3；公式不变，仅调用粒度
```

---

## 22. Final Verdict

### 必须回答

1. Fine Span 唯一生产实现？ → **`runLtrFineSpanGeneration`（LTR）**；Lattice 非生产  
2. Recall 是否只有一条生产链？ → **是**  
3. Candidate 是否全部来自 SQLite？ → **是（V4）**  
4. 配置文件候选来源？ → **生产无**  
5. 多领域词保留全部 domain tags？ → **是**  
6. 每 Window 候选数量谁控制？ → **`V4_LIMITS.exactTopK` / `parentFragmentTopK`**  
7. utterance 级 Recall Cache？ → **是（L1）**  
8. 真实 SQLite Batch Query（多 window）？ → **否（仅 per-key / 内部 2-stmt）**  
9. Domain Vote 整句聚合？ → **是**  
10. 同 Span 多候选参与投票？ → **是（DomainSet union）**  
11. base 错误计票？ → **否**  
12. CPU LLM 越权定领域？ → **否**  
13. SameDomain Bucket 真实生产数据？ → **是**  
14. Sentence Assembly 消费 Bucket？ → **是**  
15. base+domain 混合组句？ → **是（桶内）**；fragment 缝需修  
16. 排列组合或 Beam？ → **否（区间装配 + 去重）**  
17. ≤16 何处控制？ → **runtime `maxSentenceCandidates` + build/merge**  
18. KenLM 真实输入？ → **预填 ≤16 候选句文本**  
19. 旧链路须删除？ → legacy `local-span-recall` 等（确认无引用后）  
20. 须恢复的正确功能？ → 无 Vote 公式回滚；Assembly 缝需对齐  
21. 下一轮先开发？ → **SENTENCE_ASSEMBLY**  
22. 具备整链 dialog_200？ → **可跑测量**；质量冻结前须完成本修复判定  

```text
MAINCHAIN_REPAIR_REQUIRED

NEXT_PRIORITY:
SENTENCE_ASSEMBLY
```
