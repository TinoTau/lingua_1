<!-- Documentation Hierarchy Metadata
Status: **RETIRED**
Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0
Archive Path: docs/archive/RETIRED/FW_Repair_V4_Parent_Fragment_Full_Retirement_Pre_Implementation_Audit_2026_08_01.md
-->

> **RETIRED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0

# FW Repair V4 — Parent Fragment Full Retirement Pre-Implementation Audit

**Date:** 2026-08-01  
**Nature:** READ ONLY · PRE-IMPLEMENTATION · FULL RETIREMENT SCOPE CONFIRMATION  
**禁止已遵守:** 未改代码 / DB / rebuild / 配置 / 测试预期 / JobResult；未建议黑白名单、降权、fallback、双链路、长期开关。

**前序冻结:** `FW_Repair_V4_Legacy_Parent_Fragment_Recall_Retirement_Audit_2026_08_01.md` → **FULL_RETIREMENT_READY**（本轮不重辩）。

---

## 1. Executive Conclusion

**Verdict: READY_WITH_CONTRACT_BOUNDARY**

```text
READY_WITH_CONTRACT_BOUNDARY

内部生产链可以完整删除 fragment，
但存在少量 JobResult / IPC 诊断字段需要单独完成消费者合同确认。

不得因此保留 fragment 生产逻辑。
```

| 层 | 状态 |
|----|------|
| 生产 Recall / Lattice / Vote / Assembly 决策 | **可完整删除** |
| DB / build / patch / manifest | **可完整删除 + clean rebuild** |
| 内部类型 / 配置 / Compatibility PF 支 | **可完整删除** |
| `extra.fw_detector.spanAssemblyV4.parentFragmentHitCount` / `parentTermVoteCount` | **进入 JobResult.extra 展开** → **REQUIRES_SEPARATE_JOBRESULT_CONSUMER_AUDIT** |
| 正式组合词原子化（上线计划等） | **本轮范围外** |

**实施原则：** Phase 1–5 切断并删除 fragment **生产逻辑**；诊断字段从 JobResult 中移除须另开合同审计，**不得**因此保留 `lookupParentFragments` / ngram SQL。

---

## 2. Frozen Retirement Decision

（冻结，不重辩）

1. fragment 本为索引；现误作 `Candidate.word`  
2. 无完整父词边界校验  
3. Lattice = exact Edge + fallback + canonical  
4. 合法长词 = 正式 term exact  
5. 组合 = 多原子 Edge  
6. PF 制造错误 Candidate / 域票 / KenLM  
7. `term_pinyin_ngrams` 无其它合法生产消费者  

禁止：恢复完整父词校验、降权、白名单、留表备用、`enableParentFragment=false`。

---

## 3. Target Architecture

```text
FineSpan/Window → Pinyin+Tone → Formal Term Lookup
  → Complete Term Surface + domains[] → WindowCandidate
  → LexicalEdge → Lattice → Domain Vote → Bucket
  → Assembly → CrossPath → KenLM
```

| 必须 | 禁止 |
|------|------|
| `termId` ∈ base/domain/idiom | `termId = ngram:*` |
| `hitKind = exact_term`（或仅此） | `hitKind = parent_fragment` |
| `word` = 正式 surface | `word = fragment_text` |
| Raw/canonical、fallback edge | 仅有 `parentTermId` 的 fragment Candidate |

---

## 4. Production Call Chain

```text
span-assembly-v4-orchestrator
  → lattice-fine-span-runtime
    → recall-topk-for-windows
      → recallSpanTopKV3
        → recallSpanTopKV2 (exact)          ← KEEP
        → lookupParentFragments             ← DELETE
          → lookupParentFragmentsByNgramKey ← DELETE
            → stmtNgram / term_pinyin_ngrams← DELETE
        → ngramRowToHotword / merge         ← DELETE
      → bindLexiconHitsToWindow (PF map)    ← MODIFY
    → buildLexicalEdges (hasParent)         ← MODIFY
  → Domain Vote / Assembly / diagnostics    ← MODIFY
  → fwDetectorResult → JobResult.extra      ← CONTRACT BOUNDARY
```

**唯一生产 fragment SQL 入口：** `LexiconRuntimeV2.lookupParentFragmentsByNgramKey`（无第二生产 SELECT 入口；build/patch 为写路径）。

---

## 5. Phase 1 Recall Cutoff Scope

**目标：** 生产零读 `term_pinyin_ngrams`；PF Candidate = 0（表可暂留）。

| 动作 | 符号 / 位置 |
|------|-------------|
| DELETE 调用 | `recall-span-topkv3.ts`：`lookupParentFragments`、`ngramRowToHotword`、`scoreFragmentHit`、`mergeExactAndFragmentHits`、`classifyFragmentKind`、`fragmentRowAllowed`、`applyToneScoreToFragmentHits` |
| DELETE/空化 | `lookupParentFragmentsByNgramKey`、`stmtNgram` prepare、ngram cache 计数（可 Phase1 删方法，Phase2 删表） |
| MODIFY | `recallSpanTopKV3` → exact-only 包装，或直接改 call-site 用 `recallSpanTopKV2` |
| MODIFY | `recall-topk-for-windows.ts`：去掉 `parentFragmentTopK`/`perParentTermPerWindow` 传参与 PF 计数分支 |
| MODIFY | `utterance-recall-cache.ts`：cache key 去掉 `parentFragmentTopK` |
| KEEP | `exactTopK`、tone-first V2、minPrior、boundaryPenalty |

**验证：** 静态 grep 生产树无 `lookupParentFragments`；runtime `ngramSqlQueries=0`；表存在亦可。

**V2/V3：** 删除 fragment 后 V3 ≈ V2 包装 → **应合并为单一 exact Recall 入口**（见 T4–T5）；不重设计其它 Recall。

---

## 6. Phase 2 Database Removal Scope

| 项 | 动作 |
|----|------|
| `CREATE TABLE term_pinyin_ngrams` | DELETE（`build-v2-shadow-bundle.mjs`） |
| Indexes `idx_term_ngram_*` | DELETE |
| `materializeTermNgrams` / INSERT | DELETE |
| `term-materialize.mjs` rematerialize ngram | DELETE |
| FK / VIEW / TRIGGER | **无**（probe：仅 indexes） |
| Manifest `tables.ngrams` / thresholds | DELETE 或不再要求 |
| Gate `assertTableThresholds` ngrams | MODIFY |
| Patch types `term_pinyin_ngrams` 配额 | DELETE |
| Fixture / e2e `COUNT ngram > 0` | MODIFY→禁止生成 |

**优先：** 新 schema **clean rebuild**，非旧文件 DROP-only。

**建议版本：**

| 字段 | 现 | 建议 |
|------|----|------|
| `schemaVersion` | `lexicon-v3-five-table-v2` | **bump** → `lexicon-v3-five-table-v3`（或等价无 ngram 名） |
| `bundleVersion` | 10（当前生产） | **必须 +1**（新 bundle） |
| checksum / manifest | 现 hash | **全量重算** |

运行时常量 `LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION` 与 gate 同步改名/换值。

---

## 7. Phase 3 Internal Residual Cleanup

| 类别 | 删除 |
|------|------|
| hitKind | `'parent_fragment'`；diagnostics `'parent_span_candidate'`（若无其它写入） |
| Edge evidence | `hasParent` / `parentEdgeCount`（路径排序第 4 键，PF 消失后恒 0 → **删键**） |
| Vote | `parent:${parentTermId}` structural key、`parentTermVoteCount` |
| Compatibility | `parentTermCompletenessScore` PF 支、`sameParentTermOverlapCompatible`（仅 PF） |
| WindowCandidate 字段 | `parentTermId/Term/PinyinKey/SyllableCount`、`matchedTermStart/End`、`fragmentTonePinyinKey`（若仅 PF 写入） |
| Config | `parentFragmentTopK`、`perParentTermPerWindow`、`DEFAULT_NGRAM_SQL_LIMIT` |
| Types | `ParentTermNgramRow`、`RecallHitKind` 联合中的 PF |
| Slice helper | `parent-term-slice.ts`（仅对齐 ngram 切片） |
| 禁止保留 | deprecated 字段、always-zero counter、enable=false |

**JobResult：** 删除 `SpanAssemblyV4Diagnostics.parentFragmentHitCount|parentTermVoteCount` 会改变 `extra.fw_detector` 展开形状 → **另审后再删字段**；生产逻辑删除不依赖这些字段。

---

## 8. Phase 4 Clean Rebuild Scope

```text
npm run lexicon:build:v2-shadow     # 无 ngram 物化的 shadow
npm run lexicon:prepare:v3-runtime -- --force
npm run lexicon:gate:v3-runtime
```

| 必须 | 禁止 |
|------|------|
| 删旧 `node_runtime/lexicon/v3` 后整目录替换 | 仅 DROP TABLE 继续用旧文件 |
| 新 manifest + checksum | 复用旧 manifest |
| **重启 Node**；确认 `lexiconVersion`/checksum | 旧进程 handle / utterance cache |

Utterance cache：key 含 `lexiconVersion`（manifest schema）；bump 后自然 miss。无磁盘 PF 持久缓存证据（仅进程内 bucketCache）。

---

## 9. Phase 5 Runtime Regression Scope

```text
dialog_200 → Recall → Lattice → Vote → Bucket → Assembly → CrossPath → KenLM Export
```

硬门：R1–R15（§26）。证据：Development/Test Report、Candidate Export、Static Residual Search、新 Manifest+Checksum、Performance before/after。

---

## 10. File and Symbol Inventory

| 文件 | 符号 | 职责 | PF 依赖 | 动作 |
|------|------|------|--------|------|
| `recall-span-topkv3.ts` | `lookupParentFragments`, `ngramRowToHotword`, `scoreFragmentHit`, `mergeExactAndFragmentHits`, `recallSpanTopKV3` | V3 exact+PF | YES | **DELETE PF 半支 / 合并为 exact** |
| `recall-span-topk-v2.ts` | `recallSpanTopKV2` | exact tone-first | NO | **KEEP**（生产 exact SSOT） |
| `lexicon-runtime-v2.ts` | `stmtNgram`, `lookupParentFragmentsByNgramKey`, ngram stats | SQL | YES | **DELETE** |
| `lexicon-types-v2.ts` | `ParentTermNgramRow`, schema const | 类型 | YES | **MODIFY** schema + DELETE 类型 |
| `recall-topk-for-windows.ts` | bind/recall PF TopK | 生产窗召回 | YES | **MODIFY** |
| `utterance-recall-cache.ts` | key `parentFragmentTopK`, hitKind | 缓存 | YES | **MODIFY** |
| `lattice-fine-span-runtime.ts` | `parentFragmentHitCount` | 透传 | YES | **MODIFY** |
| `build-lexical-edges.ts` | `hasParent` | evidence | YES | **DELETE 字段** |
| `enumerate-complete-segmentation-paths.ts` | `parentEdgeCount` ASC | 路径排序 | YES | **DELETE 键** |
| `candidate-span-assembly-eligibility.ts` | matchedTerm 宽度 | 通用+PF | 部分 | **MODIFY**（去掉仅 PF 的 matched 语义或随字段删） |
| `classify-overlap-relation.ts` | parentTerm* | PF overlap | YES | **DELETE PF branch** |
| `utterance-domain-vote.ts` | parent structural / voteCount | Vote | YES | **DELETE PF 专属** |
| `v4-limits.ts` / `limits.ts` | `parentFragmentTopK`, `perParentTermPerWindow` | 配置 | YES | **DELETE** |
| `v4-types.ts` | hitKind, parent* fields, counters | 类型 | YES | **MODIFY** |
| `v4-diagnostics-types.ts` / mappers | hitKind unions | 诊断 | YES | **MODIFY** |
| `types.ts` `SpanAssemblyV4Diagnostics` | PF counters | → JobResult | YES | **REQUIRES_SEPARATE** |
| `span-assembly-v4-orchestrator.ts` | 填 diagnostics | 汇总 | YES | **MODIFY**（字段删前可先恒不写/另审） |
| `window-candidate-to-pick.ts` | 透传 hitKind | pick | 弱 | **MODIFY**（仅 exact） |
| `parent-term-slice.ts` | slice | PF 对齐 | YES | **DELETE** |
| `inject-fallback-edges.ts` | hasParent:false | fallback | 结构 | **MODIFY** 证据形状 |
| `fw-detector-v4-path.ts` | 组装 spanAssemblyV4 | 结果 | 透传 | **MODIFY** |
| `result-builder-core.ts` | `fw_detector: {...ctx.fwDetectorResult}` | JobResult | **展开含 PF 字段** | **KEEP shape 直至合同审计** |
| `build-v2-shadow-bundle.mjs` | CREATE/INSERT ngram | build | YES | **DELETE 步骤** |
| `materialize-term-ngrams.mjs` | 全文件 | 物化 | YES | **DELETE** |
| `term-materialize.mjs` | rematerialize ngrams | patch | YES | **MODIFY** |
| `lexicon-v3-runtime.mjs` | ngrams thresholds | gate | YES | **MODIFY** |
| `manifest-writer.ts` / patch-types | ngrams 统计 | meta | YES | **MODIFY** |
| `run-homophone-variant-cleanup.mjs` | DELETE ngram | 脚本 | YES | **MODIFY/DELETE 支** |
| `run-patch-e2e-runner.mjs` | assert ngram>0 | 测试 | YES | **MODIFY→ADD PF=0** |
| `freeze-contract.test.ts` | V2 禁 PF；GATE ngram | 冻结合约 | 部分 | **MODIFY**（扩展禁生产 PF） |
| `recall-span-topkv3.test.ts` | mock lookup | 单测 | YES | **MODIFY/DELETE** |
| `*parent_fragment*` tests | 多文件 | 行为 | YES | 见 §20 |
| `analyze-*-parentterm-dialog200.mjs` | 读 counters | probe | YES | **DELETE/ARCHIVE** |

---

## 11. SQL and Repository Inventory

| SQL | 分类 | 动作 |
|-----|------|------|
| `SELECT … FROM term_pinyin_ngrams WHERE ngram_pinyin_key=?` | **PRODUCTION_READ** | **DELETE** |
| `SELECT COUNT(*) FROM term_pinyin_ngrams`（runtime load stats） | PRODUCTION_READ/meta | **DELETE** |
| `INSERT INTO term_pinyin_ngrams`（shadow build / rematerialize） | **BUILD_WRITE / PATCH_WRITE** | **DELETE** |
| `DELETE FROM term_pinyin_ngrams WHERE parent_term_id=?` | PATCH_WRITE | **DELETE** |
| `DELETE … fragment_text/parent_word IN`（homophone cleanup） | AUDIT/ops | **DELETE 支** |
| `COUNT` in patch e2e / alias audit | TEST_ONLY / AUDIT_ONLY | **MODIFY** |
| INDEX create ×4 | BUILD | **DELETE** |

确认：**无** hidden UNION、无 alternate repository、无测试 flag 重开生产 PF（仅 spy/assert）。

---

## 12. Type and Field Contract Inventory

| 字段/类型 | 写 | 读 | 仅 PF？ | JobResult？ | 分类 |
|-----------|----|----|---------|-------------|------|
| `ParentTermNgramRow` | SQL map | V3 | YES | NO | **DELETE_INTERNAL** |
| `hitKind: parent_fragment` | V3/bind | Vote/Edge/elig/diag | YES | pick 在内部；diag 可进 fw_detector | **DELETE_INTERNAL**；字面值若进 extra → 另审 |
| `parentTermId/Term/…` | bind from PF | Vote/compat | YES（生产） | 否直接 | **DELETE_INTERNAL** |
| `hasParent` / `parentEdgeCount` | build edges / enum | path sort | YES | NO | **DELETE_INTERNAL** |
| `parentFragmentHitCount` | recall→lattice→orch | diagnostics | YES | **YES**（`extra.fw_detector.spanAssemblyV4`） | **REQUIRES_SEPARATE_JOBRESULT_CONSUMER_AUDIT** |
| `parentTermVoteCount` | vote→orch | diagnostics | YES | **YES**（同上） | **REQUIRES_SEPARATE_JOBRESULT_CONSUMER_AUDIT** |
| `parent_span_candidate` | 类型联合 | ? | 残留 | 诊断 | **DEAD / DELETE_INTERNAL** |
| `matchedTermStart/End` | PF | eligibility/compat | 生产仅 PF | NO | **DELETE_INTERNAL** |
| `fragmentText` | DB/row | mapper | YES | NO | **DELETE_INTERNAL** |

---

## 13. JobResult Boundary

```text
result-builder-core.ts
  fw_detector: { ...ctx.fwDetectorResult }
```

`fwDetectorResult.spanAssemblyV4` 含 `parentFragmentHitCount`、`parentTermVoteCount`（`types.ts` / orchestrator 填充）。

| 允许本轮开发 | 禁止本轮 |
|--------------|----------|
| 删除 PF 召回/写回，使计数自然为 0 或不再填充 | 改 JobResult 顶层 shape、重命名、删跨服务字段而未审计 |
| 内部类型收敛 | 假设外部不读 diagnostics |

**开发时：** 生产链先删净；**字段从 JobResult 移除 = 另任务**。

---

## 14. Compatibility / Overlap Cleanup

| 问题 | 答案 |
|------|------|
| 仅服务 PF？ | `sameParentTerm*` / `parentTermCompletenessScore` 的 PF 完整分 **是** |
| exact 依赖？ | **否**（exact 走 range/replacement containment） |
| 可删整支？ | **是**（PF 字段删除后） |
| 其它 LTR compat？ | Step3 COVERAGE 等 **KEEP**；LTR generator 已 DEAD |

---

## 15. Domain Vote Cleanup

删除后 Vote 仅需：`fineSpanId`、`domains[]`、正式 term identity（现有 exact 路径）。

| 确认 | |
|------|--|
| exact 多候选计票 | 保持 |
| domains[] 多域 | 保持（enrichment） |
| `parent:` structural key | **DELETE** |
| 新增替代 dedupe | **禁止** |
| Vote 公式 | **本轮不改** |

---

## 16. Budget / Assembly Impact

| 模块 | PF 直接依赖？ | 动作 |
|------|---------------|------|
| Budget / perSpanLimit | **无** PF 专属 | **KEEP 数值** |
| Assembly eligibility | 不拒 PF hitKind；matched 宽 | 删 PF 后仅 exact+canonical |
| CrossPath / maxSentenceCandidates | **无** | **KEEP** |
| Path sort `parentEdgeCount` | YES | **DELETE 键**（勿改其它排序键权重） |

预期：Candidate 数下降；exact 相对顺序不被故意重排；Raw/canonical 保留。

---

## 17. Cache Impact

| Key 维 | 现 | 动作 |
|--------|----|------|
| `parentFragmentTopK` | utterance Fact key | **DELETE 维** |
| `lexiconVersion` | 含 schema | bump 后失效 |
| `ngram:{key}:{limit}` bucketCache | runtime | **随方法删除** |
| 磁盘持久 PF cache | **未发现** | — |

Node：**必须重启**加载新 SQLite。建议 bump cache namespace 随 schema（已由 lexiconVersion 覆盖）。

---

## 18. Schema and Bundle Version Plan

1. **Clean schema**（无 `term_pinyin_ngrams`），非旧库 DROP-only 作为终态。  
2. 无 FK/view/trigger。  
3. 删全部 `idx_term_ngram_*`。  
4. **`schemaVersion` 必须 bump**（建议 `lexicon-v3-five-table-v3`）。  
5. **`bundleVersion` 必须 bump**。  
6. Manifest：**删除** `ngrams` / `term_pinyin_ngrams` 计数要求。  
7. Patch：rematerialize **不再**写 ngram；e2e 改断言。  
8. Fixture：新建无 ngram 的最小 DB。

---

## 19. Build / Patch / Rebuild Pipeline

```text
source → build-lexicon-v2-shadow / build-v2-shadow-bundle
  → [DELETE] materializeTermNgrams + INSERT ngrams + indexes
  → SQLite + manifest + checksum
  → prepare-lexicon-v3-runtime --force
  → gate:v3-runtime
```

Patch 路径：`term-materialize.mjs::rematerializeTerm` 内 ngram DELETE/INSERT → **DELETE**。  
不得只改 full rebuild 一处。

---

## 20. Test Modification Matrix

| 测试 | 分类 |
|------|------|
| `domain-presence-vote-acceptance` PF cases | **DELETE obsolete** / 改 exact |
| `candidate-span-assembly-eligibility` PF cases | **MODIFY** → exact-only 行为 |
| `assemble-domain-aware-span-sets` parentTermVote | **DELETE/MODIFY** |
| `phase1-window-edge-harness` PF | **MODIFY** |
| `length1-…` parentFragmentTopK=0 / spy ngram | **MODIFY** → 方法不存在 + PF=0 |
| `phase1-utterance-cache` TopK | **MODIFY** |
| `enumerate-*` / `phase2-*` `hasParent:true` | **MODIFY** 去掉 parent 维 |
| `recall-span-topkv3.test.ts` | **MODIFY** exact-only / 或删文件若合并 |
| `freeze-contract` GATE-SV2-5 ngram | **MODIFY** → 禁止生产 ngram API |
| `run-patch-e2e-runner` ngram>0 | **MODIFY** → ngram 表不存在或 0 |
| dialog_200 probes 期望 PF | **MODIFY** 基线 |
| **ADD** | 静态 grep PF=0；可以→科医=0；候选/计划 exact>0 |

---

## 21. Documentation Cleanup Matrix

| 文档 | 分类 |
|------|------|
| `docs/fw-detector/recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md`（exact+fragment） | **UPDATE** → Formal term only；或 **ARCHIVE_HISTORICAL** + 新 SSOT |
| `compatibility/FROZEN.md` Step-4 parentTerm | **UPDATE** |
| 本系列 Retirement / Pollution 审计 | **KEEP**（HISTORICAL 决策记录） |
| 冲突的「必须混排 fragment」现行冻结句 | **不得保留为 CURRENT** |

统一 CURRENT：**Formal term exact/full-pinyin Recall only**。

---

## 22. Commit Plan

```text
Commit 1 — Phase 1
切断生产 Recall fragment（call-site → exact-only；删 lookup/mapper/merge）
不改 DB schema；可选仍加载含表的旧 bundle（验证 PF=0）

Commit 2 — Phase 3（内部）
删 hitKind/hasParent/Vote structural/compat PF 支/limits/cache 维
JobResult 诊断字段：先停止填充或另审后再从类型删除（不阻塞 C1）

Commit 3 — Phase 2+4
删 schema/build/patch/manifest ngram；schemaVersion+bundleVersion bump；
lexicon:build:v2-shadow → prepare:v3-runtime --force → gate；重启 Node

Commit 4 — Phase 5 证据
测试/文档/dialog_200 回归基线与报告
```

每提交单一职责；**不**混入上线计划等正式 term 原子化；**不**混 KenLM/JobResult 重构。

---

## 23. Scope Boundary with Atomicity Cleanup

| 本任务 | 独立任务 |
|--------|----------|
| PF / ngram 表 / fragment Candidate / SQL / 配置 / 诊断生产逻辑 | 删除正式 term「上线计划」「接口文档」等 |
| 验证：科医等归零且 exact 修复仍在 | 另轮验证 Candidate 变化归因 |

---

## 24. Development Target List

| ID | 答案 |
|----|------|
| T1 | `recallSpanTopKV3` → `lookupParentFragments` → `lookupParentFragmentsByNgramKey` |
| T2 | `stmtNgram` SELECT `term_pinyin_ngrams`（及全部调用） |
| T3 | **无**第二生产 SELECT；仅 build/patch 写 |
| T4 | **是**，功能重叠 |
| T5 | **是**，合并单一 exact（保留 V2 实现，去掉 V3 PF 包装） |
| T6 | `ngramRowToHotword`、PF→WindowCandidate 映射支 |
| T7 | `scoreFragmentHit`、`mergeExactAndFragmentHits`、tone-on-fragment |
| T8 | `parent_fragment`；（`parent_span_candidate` 诊断残留） |
| T9 | parentTerm completeness / same-parent fragment compat |
| T10 | `parent:${parentTermId}`、`parentTermVoteCount` |
| T11 | 无 Budget 专属；path `parentEdgeCount`；elig matched 宽 |
| T12 | `parentFragmentTopK`（及 perParent 若入 key） |
| T13 | `parentFragmentHitCount`、`parentTermVoteCount`、`hasParent` |
| T14 | 上述两 counter 经 `fw_detector` 展开 → **另审** |
| T15 | 表+4 index；无 view/trigger/FK |
| T16 | `build-v2-shadow-bundle` + `materializeTermNgrams` |
| T17 | `term-materialize.mjs` rematerialize |
| T18 | manifest ngrams 计数/阈值 |
| T19 | **必须 bump** |
| T20 | **必须 bump** |
| T21 | `lexicon:build:v2-shadow` → `lexicon:prepare:v3-runtime --force` → `lexicon:gate:v3-runtime` |
| T22 | manifest checksum / `getManifestVersion` / runtime state；与文件 hash 比对 |
| T23 | vote/eligibility/assemble/phase1 harness 等（§20） |
| T24 | 凡「必须产生 PF / ngram>0」→ 删或改 PF=0 |
| T25 | `TONE_FIRST_RECALL_FROZEN`；compat Step-4 |
| T26 | **否**（零 fallback/shadow/兼容建议） |
| T27 | **是**（Commit 1–4） |
| T28 | **是** |
| T29 | **是** |
| T30 | **是**（生产逻辑）；JobResult 字段移除单独边界 |

---

## 25. Development Check List

```text
[x] 未修改任何代码
[x] 已确认冻结删除结论
[x] 已列出生产调用点 / SQL / repository / mapper / 类型 / 配置 / 缓存
[x] 已列出 Compatibility / Vote / diagnostics
[x] 已确认 JobResult 边界（READY_WITH_CONTRACT_BOUNDARY）
[x] 已列出表/index；无 FK/view/trigger
[x] 已列出 build/rebuild/patch / manifest / schema
[x] 已列出测试与文档调整
[x] 已设计 commit 顺序
[x] 未建议黑白名单/降权/fallback/双链路/长期开关
[x] 未混入正式 term 原子化 / KenLM 优化
```

---

## 26. Regression Check List

```text
[ ] R1 parent_fragment Candidate = 0
[ ] R2 termId ngram: = 0
[ ] R3 ngram SQL production = 0
[ ] R4 可以→科医 = 0
[ ] R5 衣室→议室(fragment) = 0
[ ] R6 地址→低脂(fragment) = 0
[ ] R7 候选 exact > 0
[ ] R8 计划 exact > 0
[ ] R9 蓝莓/马芬 exact 正常
[ ] R10 蓝莓马芬 exact（若仍为正式 term）
[ ] R11 canonical/raw 仍在
[ ] R12 Lattice uncovered = 0；fallback edge 正常
[ ] R13 Vote 无 fragment-only medical
[ ] R14 Assembly/CrossPath/KenLM 可对账；dialog_200 200/200
[ ] R15 Pre-KenLM p95 不退化；新 hash 已记录；Node 已加载；生产树无 PF 残留
```

---

## 27. Final Implementation Readiness

```text
READY_WITH_CONTRACT_BOUNDARY

内部生产链可以完整删除 fragment，
但存在少量 JobResult / IPC 诊断字段需要单独完成消费者合同确认。

不得因此保留 fragment 生产逻辑。
```

**可立即开工：** Commit 1（切断 Recall）→ 验证 PF=0。  
**并行另开：** JobResult 消费者是否依赖 `parentFragmentHitCount` / `parentTermVoteCount` 字面字段。  
**其后：** Commit 2–4 清残留、clean rebuild、回归证据。

**明确否决清单（开发方案不得出现）：** fragment 黑白名单、penalty、legacy fallback、长期 `parentFragmentTopK=0`、`enableParentFragment=false`、V3/V4 shadow 双召回、deprecated mapper、双写 manifest、旧表备用、KenLM 兜底噪声。
