<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Length_1_5_Recall_Chain_Alignment_Pre_Development_Audit_2026_07_27.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Lexical Connectivity Repair V1 · Length 1–5 Recall Chain Alignment Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Development Readiness + Minimal Change Scope + Length-1 Implementation Feasibility**（只读） |
| Prerequisites | Length 1–5 Consistency Audit · Lexicon Import Interface Audit · LexicalEdge Quality Audit · Architecture / Contract V1.0.0 (+1.0.1) |
| Evidence | [`_audit_scratch/lattice_v1_recall_chain_alignment/`](./_audit_scratch/lattice_v1_recall_chain_alignment/) |
| Code / 词库 / Contract 修改 | **无** |

---

## 1. Executive Summary

在已冻结「必须支持受控 length=1」前提下，本轮确认 **可以以最小单链路改动进入开发**，且职责边界清晰：

| 结论 | 内容 |
|------|------|
| Local Recall | **不在** Lattice / V4 Orchestrator 主链 → **不修改**（Legacy） |
| 唯一对齐入口 | `recallSpanTopKV2`（Harness + Production LTR 共用） |
| base SSOT | **`base_lexicon`**（非 `term`） |
| Patch | **`addBaseTerm` → base_lexicon**（禁 domain_tags） |
| Cap | V2 内 `effectiveTopK=1` + call-site `exactTopK=1` |
| Ambiguity | plain 多候选 → **空**；禁止瞎 Top1 |
| Hard-block | 删除邻接句界两处判断；保留窗内标点 / raw gap |
| `repair_target` | 连通单字 = **false** |
| Batch 1 | 可独立用 fixture 开发验收；**不能**因此导入正式词表 |

---

## 2. Final Verdict

```text
LENGTH 1–5 RECALL CHAIN ALIGNMENT:
READY FOR DEVELOPMENT

MINIMAL CHANGE SCOPE CONFIRMED
```

无未解决的架构/数据职责冲突。产品决策项已在本报告内给出唯一推荐（语气歧义、cap、写入路径），开发可按三批执行。

---

## 3. Frozen Requirement（不重开讨论）

```text
Lattice Window/Recall/Edge/Path：1–5
length=1：base-only · exact-first · no fuzzy/alias/homophone_variant · cap≤1 · 不投票
length=2–5：现有 base+domain · Vote · fuzzy min=2 · parent fragment min=2 · LTR 窗 2–5 保留
禁止：全汉字、第二链路、降 minPrior、domain_tags 伪装 base、改 Path 绕过 Recall
```

---

## 4. Current Call Graph

见 [`recall_chain_alignment_call_graph.json`](./_audit_scratch/lattice_v1_recall_chain_alignment/recall_chain_alignment_call_graph.json)。

### 4.1 Lattice Harness

```text
buildLexicalWindowQueries (1..5)
  → latticeHardBlockFilter
  → recallTopKForWindows
  → recallSpanTopKV3
  → recallSpanTopKV2          ← 对齐入口
  → LexiconRuntimeV2
  → WindowCandidate
  → buildLexicalEdges
  → (Phase2) injectFallbackEdges → enumerateCompleteSegmentationPaths
```

### 4.2 Production（当前）

```text
span-assembly-v4-orchestrator
  → runLtrFineSpanGeneration (V4_LIMITS 2..5)
  → blockedFilter (LTR)
  → recallTopKForWindows → V3 → V2   ← 同一 Recall 入口
  → commitBestFormalFineSpan → Vote / Assembly / KenLM
```

Phase 3 前 Production Fine Span 仍为 LTR；**Recall 与 Harness 必须同步对齐**，禁止只改 harness。

---

## 5. Production / Harness Alignment

| 项 | Harness | Production |
|----|---------|------------|
| Window | Lattice 1–5 | LTR 2–5（KEEP） |
| Hard-block | `latticeHardBlockFilter` | LTR `blockedFilter`（本轮不改 LTR，除非共享函数） |
| Recall | V3→V2 | **同一** V3→V2 |
| Edge/Path | harness Path | 尚未 cutover |

**Hard-block：** Lattice 用 `lattice-hard-block-filter.ts`；生产 LTR 用另一 `blockedFilter`。本轮 **只改 Lattice hard-block**（Harness / 未来 Lattice cutover）。若两套逻辑将来合并，另开任务。

---

## 6. Local Recall Ownership

```text
B. 已不属于当前 Lattice / V4 主链
   → 不修改 MIN_SYLLABLES
   → 标记 Legacy（legacy/fw-detector/fw-topk-decision-pipeline 调用）
```

证据：`freeze-contract.test.ts` 断言 orchestrator **不得**引用 `fw-topk-decision-pipeline`；`local-span-recall` 仅被 legacy 引用。

修改 `recallSpanTopKV2` 后，legacy 若传入 ≥2 音节行为不变；len=1 仍被 local 自身闸拦截——可接受。

---

## 7. Recall API Change Design

**文件：** `lexicon-v2/recall-span-topk-v2.ts` · `recallSpanTopKV2`  
**辅：** `recall-topk-for-windows.ts`（len=1 时 `exactTopK=1`）  
**V3 parent fragment：** KEEP `length<2` 拒绝。

伪代码（完整见 [`single_char_recall_branch_design.json`](./_audit_scratch/lattice_v1_recall_chain_alignment/single_char_recall_branch_design.json)）：

```text
validate length ∈ [1,5]

if length == 1:
  force fuzzy off
  effectiveTopK = min(topK, 1)
  baseHits = lookupBase only (+ tone composite if pattern)
  apply ambiguity policy (§9)
  return exact_base hits only

else:
  existing 2..5 flow UNCHANGED
```

复用：`lookupBaseByPinyinKey`、scoring、`resolveWindowCandidateSource`。  
禁用：domain/idiom/fuzzy/parent fragment。

真实 Candidate 字段（非草稿 `domain`）：

```json
{
  "replacement": "我",
  "source": "base_term",
  "domains": undefined,
  "hitKind": "exact_term",
  "recallCandidateKind": "exact_base",
  "repairTarget": false,
  "syllableStart": 2,
  "syllableEnd": 3
}
```

`resolveGraphSource(empty domains) → base_term` 已存在——**必须保证** len=1 hit 的 domains 为空且不注入 active domain。

---

## 8. Base-Only Routing

| length | base | domain | idiom | ngram |
|--------|------|--------|-------|-------|
| 1 | ✅ | ❌ | ❌ | ❌ |
| 2–5 | ✅ | ✅ | ✅ | ✅ (V3) |

实现位置：`recallSpanTopKV2` 分支内 **只调用** base lookup；不得走 `collectTierCandidatesToneFirst` 全量（该函数会查 domain）。可抽私有 `collectBaseOnlyLength1(...)` 复用 tone composite SQL。

---

## 9. Tone / Plain Ambiguity Policy（唯一推荐）

| 条件 | 行为 |
|------|------|
| 有 tone → tone_exact 候选 | 取最佳 1 个 |
| 无 tone，surface 与唯一 base 字相同 | 保留该字 |
| 无 tone，plain 过滤后 **唯一** | 保留 |
| 无 tone，plain **>1** | **返回空**（禁止 Top1 猜） |
| fuzzy / alias / homophone_variant | **关** |

这不是「TopK=1」的同义词：TopK 限制数量；歧义规则决定 **能否出候选**。

---

## 10. Candidate Cap（唯一实现）

```text
A. recallSpanTopKV2 内 length==1 → effectiveTopK≤1   ← PRIMARY SSOT
+ recallTopKForWindows 对 len=1 传入 exactTopK=1     ← cache key / 诊断一致
```

拒绝：仅结果后截断（C）。  
2–5：保持 `V4_LIMITS.exactTopK=2`。  
句级 ≤16 / path caps：KEEP。

---

## 11. Cache

当前 key：

```text
v1|kind|pinyinKey|toneNorm|domainScope|exactTopK|parentFragmentTopK|lexiconVersion|surfaceText
```

| 风险 | 处置 |
|------|------|
| len=1 与 len=2+ | pinyinKey 不同 → OK |
| 同字不同 domainScope 重复缓存 | 对 len=1 传入 **空 domainIds** → 提高命中；**不必**新字段 |
| base-only 结果被 domain 查询污染 | V2 分支保证不查 domain → OK |

**结论：KEEP 结构；call-site 对 len=1 使用 `domainIds=[]` + `exactTopK=1`。禁止第二套 cache。**

---

## 12. Batch Recall

`recallTopKForWindows` 按窗循环 + utterance cache 去重。

```text
len=1 进入同一 batch 循环
同批内用参数分流（topK/domainIds），不拆服务
与 2–5 不混合同一 cache key（pinyinKey/exactTopK/domainScope 不同）
```

指标：`logicalWindowRecallCount`、`uniqueRecallKeyCount`、`physicalSqlStatementCount`、latency。  
4494 单字窗经去重后量级低于窗数；验收盯相对基线增量。

---

## 13. Hard-block

**文件：** `lattice-hard-block-filter.ts` · `hasSentenceBoundary`

| 修改 | 动作 |
|------|------|
| `rawStart-1` 邻接句界 | **DELETE 该判断** |
| `rawEnd` 邻接句界 | **DELETE 该判断** |
| slice 含 。！？ | KEEP |
| `punctuation_in_window` | KEEP |
| `raw_gap_between_spans` | KEEP |

用例见 [`hard_block_change_cases.jsonl`](./_audit_scratch/lattice_v1_recall_chain_alignment/hard_block_change_cases.jsonl)。

---

## 14. Patch V4 `addBaseTerm`

见 [`add_base_term_impact_inventory.json`](./_audit_scratch/lattice_v1_recall_chain_alignment/add_base_term_impact_inventory.json)。

必改：`patch-types-v4.ts`、`patch-validator-v4.ts`、`patch-hash-v4.ts`、`sqlite-applier-v4.ts`、（可选）`term-ref-v4.ts`、fixtures/e2e。

```json
{
  "op": "addBaseTerm",
  "word": "我",
  "pinyin": "wo",
  "tone_pinyin_key": "wo3",
  "prior_score": 0.9,
  "source": "connectivity_base_char_v1",
  "enabled": true,
  "repair_target": false
}
```

约束：拒绝 `domain_tags`；写 `base_lexicon`；PK `(pinyin_key,word)`；走现有 transaction/history/manifest；支持 dry-run。

---

## 15. Base Update / Disable

| Operation | Batch |
|-----------|-------|
| `addBaseTerm` | 2 必须 |
| `updateBaseTermFields`（prior/source/tone/repair_target） | 2 必须 |
| `enableBaseTerm` / `disableBaseTerm` | 2 必须 |
| hard delete | 延后（disable 即可） |

重复 add：碰撞 → FAIL（与 addTerm 一致）。禁止日常手工 SQL。

---

## 16. Full Build

**文件：** `scripts/lexicon/lib/v2-classify-row.mjs`

唯一准入（数据侧，非代码硬编码词表）：

```json
{
  "type": "canonical_term",
  "word": "我",
  "lexiconLayer": "base",
  "singleCharApproved": true,
  "pinyin": "wo",
  "priorScore": 0.9,
  "source": "connectivity_base_char_v1",
  "enabled": true
}
```

```text
charLen===1 && lexiconLayer===base && singleCharApproved===true → accept base
else charLen===1 → keep reject one_char
base 2–3 / domain 2–5 → unchanged
```

解析：`parse-rows.mjs` 透传布尔字段（最小扩展）。

---

## 17. Base SSOT

见 [`base_lexicon_ssot_audit.json`](./_audit_scratch/lattice_v1_recall_chain_alignment/base_lexicon_ssot_audit.json)。

```text
唯一结论：base_lexicon = base / 连通单字 SSOT
term = domain/multidomain SSOT
addBaseTerm 不得只写 term
```

---

## 18. Export / Statistics / Audit Coverage

| 工具 | 覆盖 base？ |
|------|-------------|
| manifest-writer / table-stats | ✅ |
| alias-homophone audit | ✅ 扫 base_lexicon |
| runtime load counts | ✅ |
| V4 source-sync | 偏 domain；base-only patch 可 skip sync 或后续最小扩展（Batch2 文档化） |

---

## 19. `repair_target`

见 [`repair_target_consumer_inventory.json`](./_audit_scratch/lattice_v1_recall_chain_alignment/repair_target_consumer_inventory.json)。

```text
连通型 base 单字 → repair_target = false
影响替换批准 / 组句槽位；不影响 Edge/Path/Vote 创建
历史字段：保留透传，不新增依赖
```

---

## 20. Candidate → Edge

`buildLexicalEdges`：**无**长度守卫。验收路径：

```text
fixture base「我」→ hit → WindowCandidate → LexicalEdge
edgeKind=lexical, end-start=1, 不计 fallbackEdgeCount
```

**Edge Builder：KEEP（不修改）。**

---

## 21. Domain Vote

`source=base_term` / 非 vote domain label → 0 票（已实现）。  
测试：仅 base 单字 → `domainScores` 空；base+domain 双字 → 仅双字投票。  
首版杯/票/房/店/单作 base，不急于单字投票。

**Vote：KEEP。**

---

## 22. Path / Fallback

comparator 按 `edgeKind`，lexical 优先于 fallback。  
测试：同位 lexical 1 + fallback 1 → retained 用 lexical。

**Path / Fallback injection：KEEP。**

---

## 23. Diagnostics

| 字段 | Phase1 | Phase2 | Quality probe | Production trace |
|------|--------|--------|---------------|------------------|
| singleCharWindowCount | ✅ | ✅ | ✅ | 可选 |
| singleCharRecallCount | ✅ | ✅ | ✅ | 可选 |
| singleCharHitCount | ✅ | ✅ | ✅ | 可选 |
| singleCharLexicalEdgeCount | ✅ | ✅ | ✅ | 可选 |
| singleCharLexicalEdgeUsedCount | — | ✅ | ✅ | 可选 |
| singleCharFallbackEdgeCount | — | ✅ | ✅ | 可选 |
| singleCharCandidateCount | ✅ | ✅ | ✅ | 可选 |
| singleCharCandidateCapHitCount | ✅ | ✅ | ✅ | 可选 |

落点：`Phase1WindowEdgeDiagnostics` / Phase2 diagnostics / probe summary；production 仅在已有 V4 trace 能力内最小追加，不新建监控系统。

---

## 24. Change Record

在 Implementation Contract 追加 **1.0.2**（接续 1.0.1）：

1. Lattice Recall 长度 1–5（旧 2–5 仅作 LTR/fuzzy/parent 遗留）  
2. length=1 = controlled base connectivity  
3. 限制：base-only、exact-first、no fuzzy/alias/variant、cap、no vote  
4. Hard-block：邻接允许、跨越禁止  
5. Import：`addBaseTerm` + Full Build `singleCharApproved`  

Architecture V1.0.0 主文已写 1–5 Window——**不改含义**；Change Record 对齐实现与导入契约。

---

## 25. Tests

见 [`single_char_test_plan.json`](./_audit_scratch/lattice_v1_recall_chain_alignment/single_char_test_plan.json)（§23 用户清单已覆盖）。

---

## 26. Development Batches

见 [`development_batch_plan.json`](./_audit_scratch/lattice_v1_recall_chain_alignment/development_batch_plan.json)。

```text
Batch1 Recall+Hard-block+Diag+Tests（fixture）→ 可独立验收
Batch2 addBaseTerm + Full Build approved
Batch3 50–100 词表 + 口语 2–3 + 麻烦 + dialog_200
```

**Batch1 完成后不可导入正式词表**（仅可起草白名单文档）。

---

## 27. Excluded Modules（明确不修改）

```text
buildLexicalEdges
enumerateCompleteSegmentationPaths / Path Comparator
injectFallbackEdges 算法
Domain Vote 公式
KenLM / Sentence Assembly / NMT / Tone model
Production Orchestrator cutover / LTR 窗 2–5
fuzzy min=2 / parent fragment min=2
local-span-recall MIN_SYLLABLES（Legacy）
```

无代码证据表明以上需要为本需求修改。

---

## 28. Risks（开发态）

| 风险 | 缓解 |
|------|------|
| 歧义 Top1 误选 | 多候选返回空 |
| SQL 增长 | base-only + topK=1 + cache |
| Vote 污染 | domains 空 + source base_term 测试 |
| Hard-block 过松 | 保留 slice/gap/punct 测试 |
| Build/Patch 不一致 | 统一 base_lexicon + 双路径测试 |
| 正式词表过早导入 | Batch 门禁 |

---

## 29. KEEP

```text
LATTICE_WINDOW 1..5
LTR V4_LIMITS 2..5
Edge/Path/Vote/Fallback 语义
fuzzy & parent fragment min=2
LexiconRuntimeV2 base SQL
utterance cache 结构
local-span-recall（不改）
manifest base 统计
```

---

## 30. MODIFY（文件级）

| 文件 | 函数/点 |
|------|---------|
| `lexicon-v2/recall-span-topk-v2.ts` | `recallSpanTopKV2` 长度分支 |
| `span-assembly-v4/recall-topk-for-windows.ts` | len=1 → exactTopK=1, domainIds=[] |
| `span-assembly-v4/lattice-hard-block-filter.ts` | `hasSentenceBoundary` |
| `span-assembly-v4/phase1-window-edge-harness.ts` | diagnostics 字段 |
| `span-assembly-v4/phase2-path-harness.ts` | diagnostics 字段 |
| `lexicon-patch-v4/patch-types-v4.ts` | ops |
| `lexicon-patch-v4/patch-validator-v4.ts` | validate |
| `lexicon-patch-v4/patch-hash-v4.ts` | hash |
| `lexicon-patch-v4/sqlite-applier-v4.ts` | apply base |
| `scripts/lexicon/lib/v2-classify-row.mjs` | approved 单字 |
| `scripts/lexicon/lib/parse-rows.mjs` | 透传字段 |
| 相关 `*.test.ts` / e2e | 见 test plan |

---

## 31. RESTORE

```text
Recall：从「强制 ≥2」恢复为冻结「Lattice 1–5 + 受控单字」
Hard-block：从「邻接即禁」恢复为「仅禁跨越/含标点」
```

---

## 32. DELETE

```text
hasSentenceBoundary 中 rawStart-1 / rawEnd 邻接判断
（Full Build）无条件 one_char 对「已批准 base 单字」的拒绝 → 改为条件拒绝
```

保留：fuzzy/LTR/parent min=2、未批准单字拒绝、cap、领域隔离。

---

## 33. NEW

```text
Contract Change Record 1.0.2
addBaseTerm / updateBaseTermFields / enable|disableBaseTerm
singleCharApproved seed 字段
diagnostics singleChar*
测试与后续词表文件
```

禁止新表、新服务、第二 Recall 链。

---

## 34. Target List

```text
[x] 确认真实 Production / Harness 调用链
[x] 确认 Local Recall 是否仍在主链 → B 不修改
[x] 给出 Recall len=1 伪代码
[x] 给出 base-only routing
[x] 给出 tone / plain ambiguity 规则
[x] 给出 Candidate cap 唯一实现位置 → A
[x] 确认 cache key → KEEP + call-site 参数
[x] 确认 batch recall 分流
[x] 给出 Hard-block 最小条件修改
[x] 确认 addBaseTerm 全部影响文件
[x] 确认 base update/disable 能力
[x] 确认 Full Build approved 单字字段
[x] 确认 base SSOT 边界
[x] 确认 export/statistics/audit 覆盖 base
[x] 确认 repair_target 消费者 → false
[x] 确认 Candidate→Edge 无需修改
[x] 确认 Vote 0 污染
[x] 确认 Path 优先 lexical
[x] 给出 diagnostics 字段落点
[x] 给出 Change Record 范围 → 1.0.2
[x] 给出文件级修改清单
[x] 给出三批开发顺序
[x] 给出完整回归测试范围
```

---

## 35. Check List

```text
[x] 本轮未修改代码/配置/词库/SQLite/Contract
[x] 未继续用历史 2–5 作为 Lattice 现行规则
[x] 未把所有模块改成 1–5
[x] 未放宽 fuzzy 到单字 / 未进 domain / 未污染 Vote
[x] 未建议全汉字 / 降 minPrior / domain_tags workaround / 第二链路
[x] 未修改 Edge / Path / KenLM
[x] 已确认 base SSOT / 歧义 / cap / 回滚 / Prod=Harness Recall 入口
```

---

## 36. Final Recommendation

```text
LENGTH 1–5 RECALL CHAIN ALIGNMENT:
READY FOR DEVELOPMENT

MINIMAL CHANGE SCOPE CONFIRMED
```

### 十二问必答

1. **唯一入口：** `recallSpanTopKV2`（经 `recallTopKForWindows` / V3）  
2. **只查 base？** 是  
3. **无 tone 且多同音？** 返回空；surface 唯一可中；禁止瞎 Top1  
4. **Cap 位置：** V2 内 `effectiveTopK≤1`（+ call-site exactTopK=1）  
5. **Local Recall？** **不修改**（Legacy，非主链）  
6. **base SSOT？** **`base_lexicon`**  
7. **addBaseTerm 文件？** patch-types/validator/hash/applier（+ fixtures/e2e）；见 impact inventory  
8. **repair_target？** **`false`**  
9. **Hard-block？** 删除 `hasSentenceBoundary` 的 rawStart-1 与 rawEnd 邻接判断  
10. **不修改模块？** Edge/Path/Vote/Fallback/KenLM/LTR 窗/fuzzy≥2/parent≥2/local-span-recall  
11. **Batch1 独立？** **可以**（fixture 验收）  
12. **Batch1 后生成正式词表？** **不可以**；须 Batch2 写入能力就绪后才导入  

**建议下一步：** 开 Batch 1 开发（先落 Change Record 1.0.2 草案，再改代码）。
