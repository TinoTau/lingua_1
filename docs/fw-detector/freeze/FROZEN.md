# FW Repair V4 — Framework Freeze（SSOT）

**版本：** 2026-07-26 · Multi-Path Lexical Lattice Architecture **V1.0.0** + Ranking Repair V1.2  
**状态：** FROZEN FOR IMPLEMENTATION（Lattice Fine Span）· Maintenance Mode（既有 Recall/KenLM/Apply）  
**门禁：** `freeze-contract.test.ts` · `freeze-config-ssot.test.ts`（Phase 6 将改为 Path-aware）

---

## 1. 冻结裁决

```text
Framework Frozen · Lexicon Continues
Fine Span SSOT = Multi-Path Lexical Lattice Architecture V1.0.0
```

| 子合约 | 版本 |
|--------|------|
| **Multi-Path Lexical Lattice Architecture** | **V1.0.0** · FROZEN FOR IMPLEMENTATION |
| Tone-First Recall | V1.0.1 |
| Ranking / Assembly | **V1.2**（Path-scoped SameDomain；Tone Effective 在 Recall） |
| Diagnostics / Trace | V1.0.2 + Path-aware Trace（Architecture V1.0.0） |
| KenLM Runtime | Batch-Only V1.0.0 · Cross-Path ≤16 |
| Raw Log Delta / Apply Gate | V1.0.0 · Gate **3.0** |
| Domain Source Unification | 2026-06-23 |
| Context Prior | 2026-06-23 |
| Runtime Domain Presence Vote formula | Runtime SSOT · Path-scoped **caller** |
| **Tone Evidence / Tone Mapping** | **FROZEN 2026-07-29** · Real Audio Only · Single SSOT · Half-Open Overlap · Evidence Unavailable Allowed |

**Fine Span / Path 权威：** [Lattice Architecture V1.0.0](../../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md)  
**Tone Evidence / Mapping 权威：** [ToneEvidence Mapping Final Freeze Report](../../tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) · [Runtime SSOT §0A](../../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**架构总览：** [ARCHITECTURE.md](../ARCHITECTURE.md)

---

## 2. 主链（唯一合法架构路径）

```text
FW 整句结果
→ UtteranceSyllableCoordinate
→ 连续 1～5 音节 WindowQuery
→ SQLite Lexicon Recall
→ LexicalEdge[]
→ SegmentationPath[]
→ Path-specific Domain Vote
→ Path-specific SameDomain Assembly
→ Global Candidate Allocation <=16
→ KenLM Cross-Path Scoring
→ Apply Gate (≥3.0) → Writeback → Final Text
```

```text
系统不采用语义 Beam / KenLM Beam
但允许有限完整 SegmentationPath 并行保留
路径限宽 = 资源保护，≠ 语言决策
```

**已废止作为架构 SSOT：** LTR `commitBestFormalFineSpan` · cursor 贪心 · 唯一 FormalFineSpan[] · 全句一次 Vote · 单 Formal 序列 Assembly。

**Tone V2 Phase 1（2026-06-29 关闭）：** Tone Decision **仅** Recall/Ranking；无 Assembly Tone Guard。SSOT：[../../tone-v2/TONE_V2_CONTRACT_FREEZE.md](../../tone-v2/TONE_V2_CONTRACT_FREEZE.md)

**已移除：** V3 assembly · legacy ASR repair 主链 · serial KenLM · normalized delta Gate (0.03) · Recall domainBoost 主分 · 语义 Beam→KenLM/Apply

**入口：** `runFwDetectorOrchestrator` → `runFwDetectorV4Path` · `pipelinePath: 'v4'`

**生产 Fine Span：** `runLatticeFineSpanGeneration`（Multi-Path Lexical Lattice）。LTR / SoftBoundary 源码与恢复入口已删除（Step 6）；不得再表述为可恢复生产路径。

**Step 7 Baseline Closure（2026-07-30）：** 唯一生产架构 = Lattice V1.0.0；唯一 Runtime Vote/Assembly/KenLM = Runtime SSOT V1.2；唯一 Tone = Tone Evidence/Mapping V1.0；Acceptance = `accept:runtime-ssot` + `accept:domain-multibucket-kenlm`。

**FW_V4_FREEZE_2026_08_03（CURRENT RECOVERY BASELINE）：** 日期节点恢复基线（非永久冻结）。权威入口 [`../../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md`](../../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md)。绑定 Lattice + Runtime SSOT + Atomicity Closure + Lexicon（freeze tip v12；同日 Recovery 后正式 Runtime v13）+ dialog_200 硬门；**Recall Subsystem `FROZEN_AT_2026_08_03`**（Supporting：[`../../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md`](../../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md)）。KenLM 仅 Runtime Boundary READY（质量未验收）。Snapshot **不取代**本节 Sole Authorities。
---

## 3. 冻结合约矩阵

| Contract | 核心规则 | 文档 |
|----------|----------|------|
| Tone | timestamp-only · score penalty · 非 hard drop | [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](../recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) |
| Recall | Tone-First · TopK · **domainBoost=0** | [recall/DOMAIN_RECALL.md](../recall/DOMAIN_RECALL.md) |
| Ranking | ED 仅 tie-break · 全路径一套评分 | [assembly/RANKING_V1_2.md](../assembly/RANKING_V1_2.md) |
| Assembly | rank→filter→select | [assembly/FROZEN_V1_2.md](../assembly/FROZEN_V1_2.md) |
| Tone V2 Runtime | FW→Recall hop · Loader · fail-closed | [../../tone-v2/TONE_V2_CONTRACT_FREEZE.md](../../tone-v2/TONE_V2_CONTRACT_FREEZE.md) |
| Domain | RuntimeDomainRegistry · RS-03A | [DOMAIN_SOURCE_UNIFICATION.md](../DOMAIN_SOURCE_UNIFICATION.md) |
| KenLM Runtime | batch-only subprocess | [kenlm/KENLM_RUNTIME.md](../kenlm/KENLM_RUNTIME.md) |
| KenLM Score / Apply | rawDelta pick · Gate 3.0 | [kenlm/SCORE_CONTRACT.md](../kenlm/SCORE_CONTRACT.md) |
| Writeback | 唯一 `applyFwSpanReplacements` | [ARCHITECTURE.md](../ARCHITECTURE.md) §5 |
| Diagnostics | selected ≠ applied ≠ approved | [diagnostics/FROZEN.md](../diagnostics/FROZEN.md) |
| Context Prior | bounded multiplier only | [CONTEXT_PRIOR.md](../CONTEXT_PRIOR.md) |

**冲突优先级：** DSU **>** Context Prior **>** CONFIG / DOMAIN_RECALL 中的域描述

---

## 4. 职责边界（禁止重叠）

| 模块 | 负责 | 不负责 |
|------|------|--------|
| Recall | TopK · pinyin/tone SQL | 域硬约束 · 句级 apply |
| Ranking | 主分 · ED tie-break | domain boost |
| Window / Edge / Path | 1..5 窗 · LexicalEdge · SegmentationPath[] | 领域公式 · KenLM 语言分 |
| Domain Vote | **Path-local** Presence Vote（公式不变） | 改边界 · 跨 Path 票池 |
| Filter / Select | Path 内分桶 · 桶优先级 | 句级写回 · **Tone Decision** |
| Assembly | Path 内 spanSets · 全局 ≤16 | 跨 Path 拼接 · Apply 裁决 |
| KenLM | fluent score · rawDelta · 跨 Path | 域分桶 · Path 裁剪 |
| Apply Gate | pick iff Δ≥3.0 | per-span 独立写回 |
| Writeback | final text | 候选生成 |

| 决策 | 唯一 Owner |
|------|------------|
| per-span 桶归属 | Domain Filter |
| Tone penalty / `toneReason` | **Recall**（非 Assembly） |
| 句级是否替换 | **Apply Gate** |
| final text | **Writeback** |

---

## 5. 回归冻结集

| case | 预期 |
|------|------|
| **d003** | 少冰+小杯 · 无烧饼 · `fw_applied≥1` |
| **d048/d138** | Assembly 少冰 · 无烧饼 · apply 视 Δ（可 `fw_applied=0`） |
| **d001/d002/d047** | cafe repair |
| **d082** | restaurant partial |

**全批不变量：** Dialog200 200/200 · final **0 次「烧饼」** · `minDeltaToReplace=3.0`

### GATE（单元）

| GATE | 断言 |
|------|------|
| GATE-1 | batch-only KenLM |
| GATE-2 | raw delta pick |
| GATE-RANK-01~04 | 分桶 · select · ED · **无** Assembly Tone Guard |

语义 manifest：`tests/fw-ranking-semantics-frozen.json` · `node tests/run-fw-ranking-semantics-test.mjs`

---

## 6. 验证命令

```powershell
cd electron_node/electron-node
npm run build:main
npm run accept:runtime-ssot
npm run accept:domain-multibucket-kenlm
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
```

| 检查 | 状态 |
|------|------|
| 冻结合约测试 | ✅ |
| Acceptance（Runtime SSOT + KenLM integration） | ✅ |
| Dialog200 生产 orchestrator 200/200 | ✅（Step 7） |

---

## 6A. Baseline Manifest（Step 7 · 2026-07-30）

| 项 | 值 |
|----|-----|
| Architecture version | Multi-Path Lexical Lattice **V1.0.0** |
| Runtime SSOT version | Contract **V1.2** |
| Tone contract version | Evidence / Mapping **V1.0** |
| Production entry | `runFwDetectorOrchestrator` → `runFwDetectorV4Path` → `runSpanAssemblyV4Orchestrator` → `runLatticeFineSpanGeneration` |
| Fine Span owner | `segmentation_path` / Lattice runtime |
| Vote scope | `per_path` · `voteUtteranceDomainFromPool` |
| Assembly scope | `per_path` · `runDomainAwareAssembly` |
| Cross-Path owner | `mergeCrossPathSentenceCandidates` |
| Candidate cap | global ≤**16** (`maxSentenceCandidates`) |
| KenLM input owner | `cross_path_merge` · `prefilledCombinations` required |
| Acceptance commands | `accept:runtime-ssot` · `accept:domain-multibucket-kenlm` |
| Required tests | `freeze-contract` · Lattice/Vote/Merge/Tone freeze suites |
| Known risks | Candidate diversity low（often 1 unique text）；Path caps 8/8 PROVISIONAL；diagnostic `retentionRatio: 0.75` literal |
| Not-frozen quality | KenLM ranking quality · Recall noise · dialog_200 semantic accuracy |
| Removed legacy chains | LTR Fine Span · SoftBoundary cursor commit · mergeCrossBucket higher-score · `ltrRuntimeEnabled` field |

---

## 7. 再冻结触发

改主链顺序 · 改 Gate 3.0 · 恢复 domainBoost · 新 writeback 路径 · 删 GATE 测试 · 静默改 diagnostics 核心字段语义

---

## 8. 词库迭代

质量杠杆在 **Lexicon** 层 — 见 [lexicon-v3/LEXICON_OPERATIONS.md](../../lexicon-v3/LEXICON_OPERATIONS.md)

---

## 9. 子模块文档

| 模块 | 路径 |
|------|------|
| Assembly | `assembly/` |
| Recall | `recall/` |
| KenLM | `kenlm/` |
| Diagnostics | `diagnostics/` |
| Compatibility | `compatibility/` |
| 接口类型 | [INTERFACE_FREEZE.md](../INTERFACE_FREEZE.md) |
| Runtime 演进 | [../../tone-v2/Lingua_Runtime_Evolution_Rule.md](../../tone-v2/Lingua_Runtime_Evolution_Rule.md) |
| 配置 | [CONFIG.md](../CONFIG.md) |

*Supersede 2026-06-17 模块级冻结摘要与历史 FINAL_FREEZE 审计稿。*
*Step 7 Baseline Closure 2026-07-30 — Lattice-only production；LTR 不可恢复。*
