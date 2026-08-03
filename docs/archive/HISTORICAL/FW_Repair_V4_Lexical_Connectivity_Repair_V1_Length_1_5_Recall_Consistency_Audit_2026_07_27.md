<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Length_1_5_Recall_Consistency_Audit_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexical Connectivity Repair V1 · Length 1–5 Recall Consistency Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Length 1–5 Recall Contract Alignment + Controlled Single-Character Recall Readiness**（开发前只读） |
| Authority | Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 (+1.0.1) · Phase 1 Closure · Phase 2 Reports · LexicalEdge Quality Audit · Lexicon Import Interface Audit · **当前代码** · **operational SQLite** |
| Evidence | [`_audit_scratch/lattice_v1_length_1_5_consistency/`](./_audit_scratch/lattice_v1_length_1_5_consistency/) |
| Code / 词库 / Contract 修改 | **无** |

---

## 1. Executive Summary

冻结架构已要求 **Window / LexicalEdge 长度 1–5**，Lattice harness **确实生成 length=1 Window**（dialog_200：`singleSyllableWindowCount=4494`）。但召回主链仍停留在历史 **2–5 关键词纠错** 假设：

```text
Window 1..5 ✅
Recall 2..5 ❌  → length=1 恒空命中
Edge Builder 中立 ✅  → 无候选则无边
Path 接受 1..5 ✅
Vote 已隔离 base_term ✅
Full Build 拒单字 ❌
Patch V4 强制 domain_tags ❌（无法写纯 base）
Hard-block 邻接句界误杀 length=1 ❌
```

实证：`singleSyllableRecallHitCount=0`，`singleSyllableLexicalEdgeCount=0`，`lexical-only complete path=0/200`。

**单字在新架构中是连通单元，不是全汉字关键词库。** 在链对齐之前生成单字词表会造成假进度。

---

## 2. Final Verdict

```text
LENGTH 1–5 RECALL CONSISTENCY: CONDITIONAL

MINIMAL CHAIN ALIGNMENT REQUIRED
BEFORE LEXICON GENERATION
```

### 阻塞清单

| 阻塞模块 | 文件 | 函数 | 历史 2–5 规则 | 目标 1–5 规则 | 最小修改 | 新测试 | Change Record？ |
|----------|------|------|---------------|---------------|----------|--------|-----------------|
| Recall API | `recall-span-topk-v2.ts` | `recallSpanTopKV2` L255 | `length < 2` return [] | 允许 1；**仅查 base** | 改闸 + base-only 分支 | exact base hit / 无 domain / 无 fuzzy | **是**（Recall 语义） |
| Local Recall | `local-span-recall.ts` | `MIN_SYLLABLES=2` | 2–5 | 若仍挂 Lattice 则 1–5 | 对齐或明确排除 Lattice | 入口一致测试 | 视接线 |
| Hard-block | `lattice-hard-block-filter.ts` | `hasSentenceBoundary` | 邻接句界即 block | 仅禁跨越/含标点 | 去掉 rawStart-1/rawEnd 邻接误杀 | 「吗？」用例 | **是**（边界语义） |
| Full Build | `v2-classify-row.mjs` | `one_char` / `base_len` | 禁全部 1 字 | 仅显式受控 base 单字 | 白名单/显式标记接受 | 未批准单字拒绝 | **是**（导入契约） |
| Patch V4 | `patch-validator-v4.ts` / `sqlite-applier-v4.ts` | `validateDomainTags` / `addTerm` | 强制 tags→domain | **addBaseTerm → base_lexicon** | 新 op 或 tier=base | 无 tags 导入 | **是** |
| Candidate cap | `recall-topk-for-windows.ts` / `v4-limits` | `exactTopK=2` 共享 | 无长度分流 | len=1 ≤1（硬上限 2） | 长度条件 TopK | cap 测试 | 建议（limits PROBE 可记） |
| Diagnostics | harness / probe | — | 无正式 singleChar* | 区分 lexical/fallback 单字 | 字段补充 | — | 否（诊断） |
| Tests | live harness 等 | — | 假通过 | 锁定对齐 | MODIFY+NEW | §32 | 否 |

**在链对齐前：禁止生成正式单字词库文件并导入。**

---

## 3. Requirement Evolution

| 阶段 | 假设 | 规则 |
|------|------|------|
| 早期 | FW 关键词 2–5 字同音/近音纠错 | `MIN_SYLLABLES=2`；禁单字导入；单字仅 fallback |
| 当前冻结 Lattice | 整句坐标流式细 span；短边连通 | Window/Edge **1–5**；单字=**受控连通单元** |

历史 2–5 **不得**再解释为「当前架构禁止单字召回」。应标记为 **待清理旧需求**，但 **2–5 专业词纠错职责必须保留**。

---

## 4. Frozen New Requirement

```text
Window length：1–5
Recall length：1–5（受控）
LexicalEdge length：1–5

length=1：
  Controlled Single-Character Lexicon
  默认 base_lexicon / base_term
  不投领域票
  禁止全汉字 / Unicode 生成 / 绑全领域
  每窗候选严格封顶
```

2–5 字路径保持：

```text
base + domain 召回 → 专业词纠错 → Domain Vote
```

同一条 Recall / LexicalEdge 主链，**禁止**单字第二链路。

---

## 5. Full Length Constraint Inventory

完整清单见：[`length_constraint_inventory.json`](./_audit_scratch/lattice_v1_length_1_5_consistency/length_constraint_inventory.json)

| 类别 | 代表 | 动作 |
|------|------|------|
| Lattice Window 1–5 | `LATTICE_WINDOW_MIN_SYLLABLES=1` | KEEP |
| LTR / V4_LIMITS 2–5 | `v4-limits.ts`、`ltr-fine-span-generator` | KEEP（Phase 3 前） |
| Recall 拒 &lt;2 | `recall-span-topk-v2`、`local-span-recall` | MODIFY |
| Fuzzy 仍 2–5 | `fuzzy-pinyin-key-builder` | KEEP（单字禁 fuzzy） |
| Full Build `one_char` | `v2-classify-row.mjs` | MODIFY |
| Patch 强制 domain_tags | `patch-validator-v4` | MODIFY |
| Hard-block 邻接句界 | `hasSentenceBoundary` | MODIFY |
| Legacy ASR `[2,3,4,5]` | quality-config / hotword-recall | KEEP（非 Lattice SSOT） |
| Parent fragment &lt;2 | `recall-span-topkv3` L230 | KEEP |
| Edge/Path/Vote | 已支持 1–5 / base 隔离 | KEEP |

---

## 6. Length Contract Matrix

见 [`length_contract_matrix.json`](./_audit_scratch/lattice_v1_length_1_5_consistency/length_contract_matrix.json)。

不一致层（必须修）：Seed、Full Build、Patch、Hard-block、Recall API、Local Recall、Batch（间接受 V2）、Candidate TopK、Diagnostics、Tests。

已一致层：Schema、Lattice Window、Edge Builder、Path、Vote（给定 base_term）、LTR 2–5（刻意保留）。

---

## 7. Window Generator

| 路径 | 长度 | 进入 Recall？ |
|------|------|---------------|
| `buildLexicalWindowQueries`（Phase1/2 harness） | **1–5** | 是（但 V2 对 len=1 空返回） |
| `generateGlobalWindows` / LTR | **2–5** | 生产 LTR；非 Lattice SSOT |

dialog_200（Quality Audit）：

| 指标 | 值 |
|------|-----|
| singleSyllableWindowCount | 4494 |
| positionsWithNoWindow | 0 |
| positionsWithOnlyBlockedWindows | 410 |
| positionsWithRecallableWindows | 4084 |
| singleSyllableRecallHitCount | **0** |
| singleSyllableLexicalEdgeCount | **0** |

**结论：length=1 Window 真实进入 harness Recall 输入，不是仅 diagnostics；被 Recall 闸门清空。**

---

## 8. Hard-block

目标：

```text
禁止跨越句界 / 窗内含标点
允许句界前最后一字、句界后第一字
```

现状 `hasSentenceBoundary`：

```text
slice 含 。！？ → block          ✅
rawStart-1 为句界 → block       ❌ 邻接误杀（？我）
rawEnd 处为句界 → block         ❌ 邻接误杀（吗？）
```

证据：[`single_char_hard_block_cases.jsonl`](./_audit_scratch/lattice_v1_length_1_5_consistency/single_char_hard_block_cases.jsonl)；Quality Audit 9 句 `ALL_WINDOWS_BLOCKED` 均为「吗？」类。

`punctuation_in_window` / `raw_gap`：**KEEP**（勿为放单字而放宽真跨越）。

---

## 9. Recall Entry Points

见 [`single_char_recall_entrypoints.json`](./_audit_scratch/lattice_v1_length_1_5_consistency/single_char_recall_entrypoints.json)。

| 入口 | length=1 |
|------|----------|
| `recallSpanTopKV2` | **拒** |
| `recallSpanTopKV3`→V2 | **拒** |
| parent fragments | 拒（KEEP） |
| `recallTopKForWindows` | 传入，结果空 |
| `local-span-recall` | **拒** |
| `hotword-recall` | **拒**（legacy） |
| `lookupBaseByPinyinKey(…,1)` | SQL **可**（调用方未到） |
| fuzzy builder | **拒**（KEEP） |

Production LTR 与 Lattice harness **共用** `recallSpanTopKV2/V3`：修闸必须两边一致，禁止只改 harness。

---

## 10. Base vs Domain Recall

| 问题 | 答案 |
|------|------|
| 1. len=1 能否只查 base？ | **目标必须是**；现状未实现分流 |
| 2. 是否必须同时查 domain？ | **否** |
| 3. 可否由 tier 决定？ | 可以：len=1 → base-only；2–5 → 现有 collectTier |
| 4. base 单字是否产生 domain candidate？ | 目标 **否** |
| 5. domain 单字如何区分？ | 仅经显式 tags + domain_term source；首版不鼓励 |
| 6. 多领域单字重复 Candidate？ | 若查 domain 会按 domain 多行；故默认不查 |

**禁止**用 `domain_tags:["coffee"]` / `general` / 全领域伪装 base。

---

## 11. SQLite / Materialization

| 表 | 角色 |
|----|------|
| `term` + `term_domain_tags` | Schema V2 **domain/multidomain SSOT** |
| `base_lexicon` | **通用 base SSOT（含未来受控单字）**；Recall 主查 |
| `domain_lexicon` | 物化层 |
| `term_pinyin_ngrams` | parent fragment；len=1 不需要 |

```text
纯 base 单字：写入 base_lexicon（不必强行双写 term）
Patch：应直接写 base_lexicon（addBaseTerm），不要走「强制 tags 的 rematerialize」
Full Build：base tier writer → base_lexicon
禁止第二套 SSOT
```

Runtime SQL 已支持 `length(word)=1`；operational 当前 **0 行**。

---

## 12. Full Build

```text
charLen===1 → reject('one_char')     // 历史残留，非 Lattice 依赖
base layer → 仅 2–3
```

`rejectStats.one_char=0` ⇒ 种子从未含单字。

新目标 **不是** 删除 `one_char`，而是：

```text
仅当显式受控 base 单字标记成立时 accept('base')
其余 1 字仍 reject
```

可复用字段：`lexiconLayer:"base"` + 建议最小扩展 `singleCharApproved:true` 或 `source` 前缀约定（**不得新表**）。

---

## 13. Patch Importer — 唯一推荐方案

| 方案 | 评价 |
|------|------|
| A. 扩展 addTerm 允许空 tags / tier=base | 可行；削弱 addTerm「必有 domain」不变量，回归风险较高 |
| **B. 新增 `addBaseTerm`** | **推荐**：语义清晰；不破坏现有 domain addTerm；可 UPDATE/disable 对称扩展 |
| C. 仅 Full Build | 首版可生成词表，但增量/回滚弱；仍须 Recall 对齐 |

**唯一推荐：B（`addBaseTerm` → `base_lexicon`）+ Full Build 受控 base 单字同一数据模型。**

需要 Contract Change Record。禁止 domain_tags workaround。

---

## 14. Recall Cache

```text
key = v1|kind|pinyinKey|tone|domains|topK|…|surface
生命周期 = 单 utterance（create → release）
```

- length 隐含于 `pinyinKey`（单音节 vs 多音节）→ **无键冲突于不同长度**  
- 若实现 base-only，建议将 **scope 标记**（如 `baseOnly=1`）纳入 key，避免日后污染  
- 空结果缓存仅 utterance 内；修复后新进程无旧空值问题  
- **禁止**第二套 cache  

结论：Cache **基本 KEEP**；若加 base-only 则 key **最小 MODIFY**。

---

## 15. Batch SQL

`lookupBaseByPinyinKey` 使用 `pinyin_key` + `length(word)=?` + `LIMIT` —— **有索引路径**（`idx_base_pinyin`），非全表扫描。

风险：dialog_200 约 4.5k 个 len=1 窗；经 key 去重后 physicalSql 增加，但可控。本轮不做优化；验收须盯 `physicalSqlStatementCount` / latency。

---

## 16. Candidate Control

见 [`single_char_candidate_control_audit.json`](./_audit_scratch/lattice_v1_length_1_5_consistency/single_char_candidate_control_audit.json)。

```text
length=1：每窗最大候选 = 1（硬上限 2）
禁止 fuzzy / homophone_variant / alias 扩展
2–5：保持现有 exactTopK / domain 平衡
```

防止：同音爆炸、全单字进 Path、突破 sentence candidates ≤16。

---

## 17. Pinyin / Tone / Homophone

| 问题 | 答案 |
|------|------|
| 1. 完全无调同音扩展？ | **禁止**（首版） |
| 2. 优先 exact tone？ | **是**；可 plain_fallback 仅对白名单 canonical |
| 3. tone 缺失？ | 仅允许白名单 canonical base |
| 4. 禁 homophone_variant？ | **是** |
| 5. 单字 alias？ | **首版禁止** |

复用 prior / tone evidence；**不**新建单字评分模型。Fuzzy 保持 min=2。

---

## 18. Prior / Whitelist

| 项 | 建议 |
|----|------|
| 受控 canonical 单字 prior | 0.85–0.95（≥ minPrior 0.5） |
| 全局 minPrior | **不降** |
| prior=1 全开 | **禁止** |
| repair_target | 组句/批准门控仍消费；**连通单字默认 false**（非替换目标） |

不得靠抬 prior 解决同音歧义。

---

## 19. Single-Character Governance

| 准入 | 用途 |
|------|------|
| A 功能词表 | 类别骨架 |
| **B dialog_200 first breakpoint** | **首版证据主源** |
| C 节点 fallback 高频 | 扩展 |
| D 口语语料 | 扩展 |
| E 人工白名单 | 最终闸门 |

排除：生僻字、专名拆字、偶发 ASR 错字、易爆同音字、无连通贡献字。

```text
版本：connectivity_base_chars_v1
source：connectivity_base_char_v1
回滚：整包 v3 备份 / 反向 disable / rebuild
增量：小批量 + probe 再扩
```

---

## 20. Spoken 2–3 Character Terms

| 检查 | 状态 |
|------|------|
| Full Build → base（无 domain） | ✅ 可用 |
| Patch 更新已有 canonical | ✅ `updateTermFields` |
| Recall 查 base | ✅（len≥2） |
| prior≥minPrior | 默认 0.85；「麻烦」异常需修正 |
| 勿标 homophone_variant | 合约已禁新增 |
| 不受 domain scope 限制 | base 路径不受 fine domain 限制 |

**必须与单字一并规划**（谢谢/请问/我想/帮我/…），否则只补单字仍缺短口语桥。

---

## 21. Candidate → Edge

`buildLexicalEdges`：**无** `length>=2` 守卫。  
潜在「有候选无边」代码点：**当前仅「无候选」**；对齐后 len=1 只要有 hit 即建边。

`edgeKind` / `boundaryKey` / evidence OR：与长度无关，KEEP。

---

## 22. Diagnostics

现状：Quality probe 有 `singleSyllable*`；harness diagnostics **无**正式 lexical vs fallback 单字拆分。

建议新增（NEW 字段，非新链路）：

```text
singleCharWindowCount
singleCharRecallCount
singleCharHitCount
singleCharLexicalEdgeCount
singleCharLexicalEdgeUsedCount
singleCharFallbackEdgeCount
```

---

## 23. Domain Vote Isolation

见 [`single_char_vote_isolation_audit.json`](./_audit_scratch/lattice_v1_length_1_5_consistency/single_char_vote_isolation_audit.json)。

```text
base 单字 → source=base_term → 不投票 ✅（已实现）
Vote 公式 KEEP
杯/票/房… 首版优先当 base；确需领域再多 tags，禁止一词一领域伪装
```

---

## 24. Path / Fallback Semantics

```text
fallbackEdgeCount 仅计 edgeKind===fallback
lexical length=1 不计入 fallback
comparator：fallback ASC 优先 → lexical 单字优于同位置 fallback ✅
非法长度仅 <1 或 >5
```

**Path Comparator KEEP**（无需为单字修改）。

---

## 25. Production / Harness Consistency

| 环境 | Window | Recall |
|------|--------|--------|
| Phase1/2 Harness | 1–5 | 共享 V2 → len=1 空 |
| Production Orchestrator LTR | 2–5 | 共享 V2 |
| Quality Probe | harness 1–5 | 同上 |
| Unit mocks | 各异 | 缺 len=1 锁定 |

对齐 Recall 后：**Harness 与任何调用 V2 的路径同时获得 1–5**；LTR 仍只生成 2–5 窗（刻意）。禁止出现「仅测试支持 1」或「仅生产支持 1」。

---

## 26. Existing Tests

见 [`single_char_test_gap_inventory.json`](./_audit_scratch/lattice_v1_length_1_5_consistency/single_char_test_gap_inventory.json)。

- KEEP：LTR 2–5 limits 测试、vote base 隔离、fallback edgeKind  
- MODIFY：live harness 单字假通过  
- NEW：§32 清单  

不得删除仍保护「受控单字 / 候选上限 / 领域隔离」的测试。

---

## 27. Target Architecture

```text
Controlled Single-Character Seed / addBaseTerm
        ↓
base_lexicon SSOT
        ↓
Length 1 Window (Lattice)
        ↓
Base-only Single-Character Recall（禁 fuzzy/domain）
        ↓
Strict Cap（≤1，硬上限 2）
        ↓
Length 1 LexicalEdge（edgeKind=lexical）
        ↓
Graph Connectivity
        ↓
Fallback only for residual gaps

并行保留：
Length 2–5 → base+domain → 专业词纠错 → Domain Vote
```

禁止：单字专用 pipeline / 第二套 Recall / shadow fallback 链。

---

## 28. Minimal Repair Scope（A–O 最终判定）

| 模块 | 判定 |
|------|------|
| A Full Build classifier | **MODIFY** |
| B Patch Importer V4 | **MODIFY**（addBaseTerm） |
| C SQLite materialization | **MODIFY**（base 写入路径；无新表） |
| D Recall API TopKV2 | **MODIFY** |
| E Local Recall | **MODIFY**（或文档排除 Lattice） |
| F Batch / recallTopKForWindows | **MODIFY**（len=1 base-only + cap） |
| G Cache | **KEEP**（或 key 最小加 baseOnly） |
| H Hard-block | **MODIFY** |
| I Candidate cap | **MODIFY** |
| J Edge Builder | **KEEP** |
| K Diagnostics | **MODIFY**（字段） |
| L Domain Vote | **KEEP** |
| M Path Enumerator | **KEEP** |
| N Tests | **MODIFY** + **NEW TEST ONLY** |
| O Contract / Change Record | **NEW**（必填） |

---

## 29. Recommended Development Order

用户建议顺序 **正确**，依赖证据如下：

```text
1. 冻结 1–5 + 受控单字职责（文档/Change Record）
2. 统一 Recall / Local / Batch 长度 + base-only     ← 否则词表无效
3. Hard-block 邻接误杀修复                           ← 否则「吗」仍断
4–5. addBaseTerm + Full Build 受控单字               ← 依赖 2
6. 单字 Candidate cap                                ← 与 2 同批或紧随
7. Diagnostics + regression
8. 小规模词表 + 口语 2–3 字
9. 重跑 LexicalEdge Quality Probe
10. 再决定扩表
```

**不得**先生成词表再改 Recall。

---

## 30. Risks

| 风险 | 触发 | 现有保护 | 缺失 | 建议测试 |
|------|------|----------|------|----------|
| 1 候选爆炸 | fuzzy/高 TopK | exactTopK=2 | 无 len 分流 | cap=1 |
| 2 同音噪声 | 无调扩展 | fuzzy min=2 | 单字仍可能 plain | 禁 fuzzy |
| 3 Vote 污染 | domain 伪装 base | base_term 过滤 | 误标 source | vote 隔离 |
| 4 Path 增长 | 处处有边 | path caps 8 | — | pathCapHit |
| 5 SQL 增长 | 4.5k len1 窗 | key 去重 | — | physicalSql |
| 6 Cache 污染 | base/domain 混 key | utterance 生命周期 | baseOnly 标记 | key 用例 |
| 7 prior 过高错替换 | repair_target true | 默认 false | — | 批准门控 |
| 8 全汉字误导入 | 删 one_char | — | 白名单 | 未批准拒绝 |
| 9 Build≠Patch | 两套写入 | — | 统一 base 模型 | 双路径对照 |
| 10 Prod≠Harness | 分叉闸门 | 共享 V2 | — | 双环境 |
| 11 Hard-block 过松 | 删错规则 | punct/gap | — | 跨句仍拒 |
| 12 fallback 假改善 | 只看 fb 降 | — | lexical 指标 | completePathRate |

---

## 31. Acceptance Metrics（建议，不冻结）

```text
singleCharWindowCount / RecallCount / HitCount
singleCharLexicalEdgeCount / UsedCount
singleCharFallbackEdgeCount

positionLexiconHitRate / reachablePositionRate
lexicalOnlyCompletePathRate

avgFallback / p95Fallback
firstBreakpointReasonDistribution
orphanEdgeRate

candidateCountPerSingleCharWindow
singleCharCandidateTotal
retainedPathCount / pathCapHitCount
domainVoteContributionFromBaseSingleChars  // 目标 = 0
physicalSqlStatementCount
latency p50/p95
```

**不得**只看 fallback 下降。

---

## 32. Required Tests

### 32.1 Build / Import
受控单字→base；未批准拒绝；无 domain tag；多领域 append 不覆盖；幂等。

### 32.2 Recall
len=1 exact base hit；无词空；不查 domain；无无限同音；2–5 保持。

### 32.3 Boundary
「吗？」中「吗」可召回；跨「？」阻断；句后第一字可召回；raw gap 不放宽。

### 32.4 Candidate / Edge
Candidate→LexicalEdge；坐标正确；lexical≠fallback；lexical 优于 fallback。

### 32.5 Vote
base 单字 0 票；多领域按冻结规则；空 domains 不报错。

### 32.6 Regression
Phase1/2 全过；dialog_200；真实 SQLite probe；2–5 不下降。

---

## 33. Initial Lexicon Size Recommendation

```text
首版：50–100 受控单字
依据：
  - dialog_200 firstBreakpoint 高频（我/能/的/请/点/这/要…）
  - 功能词/介词/助词/语气词骨架
  - 数量规格连接字（杯/个/份…）小集合
  - Candidate cap=1 与 path caps 下的风险可控
禁止首版 2000–3000
长期可扩，但必须 probe 驱动
```

类别示例 **不是** 最终批准词表。

---

## 34. KEEP

```text
LATTICE_WINDOW 1..5
LTR V4_LIMITS 2..5（Phase 3 前）
buildLexicalEdges / Path enum / inject-fallback edgeKind 语义
Domain Vote base_term 隔离
LexiconRuntimeV2 SQL length=?
fuzzy min=2（单字禁模糊）
parent fragment 拒 len<2
Legacy ASR allowedWindowLengths 2-5（非 Lattice）
Schema 无 min-length CHECK
```

---

## 35. MODIFY

```text
recallSpanTopKV2 长度闸 + len=1 base-only
local-span-recall（若仍相关）
recallTopKForWindows len=1 TopK
lattice-hard-block 邻接句界
v2-classify-row 受控单字
Patch V4 addBaseTerm → base_lexicon
Diagnostics singleChar*
过时/假通过测试
```

---

## 36. RESTORE

```text
将 Recall/边界从历史「仅 2–5 关键词」恢复为冻结「1–5 Lattice 连通」语义
将「麻烦」类误伤从 variant 恢复为 canonical（数据，非本轮）
```

---

## 37. DELETE

```text
对 Lattice 路径无效的「绝对禁单字」Full Build 规则（改为受控）
Hard-block 邻接句界误杀逻辑
（保留：受控限制、候选上限、领域隔离、禁全汉字）
```

---

## 38. NEW

```text
Change Record（Recall / Hard-block / Import）
addBaseTerm 契约
connectivity_base_chars_v1 词表文件（对齐后）
口语 2–3 字 base seed / patch
诊断字段
§32 测试
禁止新业务服务 / 第二主链
```

---

## 39. Target List

```text
[x] 全仓长度约束搜索完成
[x] 统一 Length Contract Matrix
[x] Window 1–5 行为确认
[x] Hard-block 单字边界确认
[x] 所有 Recall 入口确认
[x] Base-only 单字 Recall 路径确认
[x] SQLite / materialization 确认
[x] Full Build 单字限制确认
[x] Patch Importer base 单字方案确认
[x] Cache key 一致性确认
[x] Batch SQL 一致性确认
[x] Candidate cap 风险确认
[x] Tone / homophone 单字语义确认
[x] 单字白名单治理规则确认
[x] Candidate → Edge 支持确认
[x] Diagnostics 区分 lexical/fallback 单字
[x] Domain Vote 隔离确认
[x] Path Comparator 兼容确认
[x] Production / Harness 一致
[x] 测试修改范围确认
[x] 最小修复顺序确认
[x] 首版单字规模建议完成
```

---

## 40. Check List

```text
[x] 本轮未修改代码 / 配置 / 词库 / SQLite / Contract
[x] 未把历史 2–5 继续当作当前架构需求
[x] 未建议删除所有单字限制 / 全汉字导入 / 降 minPrior
[x] 未让 base 单字伪装 domain
[x] 未新增单字第二链路
[x] 未改变 2–5 专业词召回职责
[x] 已确认 base 单字不污染 Vote（给定 source）
[x] 已确认候选控制方案
[x] 已确认全部 Recall 入口
[x] 已确认 Prod/Harness 共享闸门
[x] 已给出最小开发与回归范围
```

---

## 41. Final Recommendation

```text
LENGTH 1–5 RECALL CONSISTENCY: CONDITIONAL

MINIMAL CHAIN ALIGNMENT REQUIRED
BEFORE LEXICON GENERATION
```

### 必须明确回答的 8 问

1. **单字是否只走 base recall？** → **是（普通/功能单字）**  
2. **哪些单字允许进入首版？** → 功能/指示/语气/高频动作数量连接字 + **dialog_200 breakpoint 证据**；人工白名单终审；**本轮不批准具体表**  
3. **首版规模？** → **50–100**  
4. **每 Window 最大候选？** → **1（硬上限 2）**  
5. **是否参与 Domain Vote？** → **否（base_term）**  
6. **Full Build 与 Patch 唯一写入？** → **base_lexicon；Patch 用 `addBaseTerm`；Full Build 受控 base tier**  
7. **哪些 2–5 历史逻辑必须保留？** → 专业词 domain 召回、LTR 窗 2–5、fuzzy≥2、parent fragment≥2、Vote 公式、exactTopK 对 2–5  
8. **修复后可否生成正式词库？** → **链对齐 + 测试绿灯后可以**；**现在不可以**

---

## Appendix — 代码锚点

```114:115:electron_node/electron-node/main/src/fw-detector/span-assembly-v4/window-construction-core.ts
export const LATTICE_WINDOW_MIN_SYLLABLES = 1;
export const LATTICE_WINDOW_MAX_SYLLABLES = 5;
```

```255:255:electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts
  if (topK <= 0 || syllables.length < 2 || syllables.length > 5 || !syllables.length) {
```

```46:57:electron_node/electron-node/main/src/fw-detector/span-assembly-v4/lattice-hard-block-filter.ts
function hasSentenceBoundary(...) {
  ...
  if (rawStart > 0 && SENTENCE_BOUNDARY_RE.test(rawText[rawStart - 1] ?? '')) return true;
  if (rawEnd < rawText.length && SENTENCE_BOUNDARY_RE.test(rawText[rawEnd] ?? '')) return true;
}
```

```47:53:electron_node/electron-node/main/src/fw-detector/span-assembly-shared/utterance-domain-vote.ts
function isVoteDomainLabel(domain: string | undefined): domain is string {
  return Boolean(domain) && domain !== 'general' && domain !== 'base_term';
}
```
