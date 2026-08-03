<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase0_Baseline_Report_2026_07_26.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 0 Pre-Refactor Baseline

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Phase | **0** — 隔离与合同（不改运行逻辑） |
| Plan | `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Development_Plan_2026_07_26.md` |
| Pre-audit | `FW_Repair_V4_Multi_Path_Lexical_Lattice_Pre_Development_Audit_2026_07_26.md` |
| Branch | `feature/fw-v4-multi-path-lexical-lattice-v1` |

---

## 1. Baseline Identity

| Item | Value |
|------|-------|
| Git branch | `feature/fw-v4-multi-path-lexical-lattice-v1` |
| Base commit SHA (branch tip at creation) | `262b3d32717db97807fa48103aa44f1ea518361a` |
| Working tree | **Phase 0 时脏** → 已由 Phase 0.5 分类隔离并封存；详见 `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase0_5_Baseline_Seal_Report_2026_07_26.md` |
| Phase Gate | **PHASE 0 INCOMPLETE**（单独 Phase 0 不足以进 Phase 1）→ 以 Phase 0.5 Final Decision 为准 |
| System Node | v24.15.0 |
| Electron | 28.3.3 |
| Electron-as-Node | 18.18.2 |
| better-sqlite3 | 11.10.0 |
| SQLite | **3.49.2** |
| Lexicon schemaVersion | `lexicon-v3-five-table-v2` |
| Lexicon bundleVersion | **10** |
| Lexicon checksum | `sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef` |
| lastPatchId | `lexicon-domain-hierarchy-completion-v1` |
| dialog_200 | `test wav/dialog_200/cases.manifest.json`（200 cases） |
| KenLM | 沿用现网 scorer 工件（本 Phase 不改模型文件） |
| Offline probe (pre-lattice) | `docs/tone-v2/phase0_phase1_utterance_cache_probe.json`（200/200；physicalSql 口径见 Phase2 metrics 修复说明） |

**说明：** 完整 dialog_200 / 内存峰值需在 Phase 1 接线前用同一 Electron ABI 再跑一次并归档到 `_audit_scratch/lattice_v1_baseline/`；本 Phase 0 固定身份与合同，不重复长跑。

---

## 2. Current Call Chain (Baseline)

```text
runFwDetectorOrchestrator
  → runFwDetectorV4Path
    → runSpanAssemblyV4Orchestrator
      → buildUtteranceSyllableCoordinate
      → partitionCoarseSpans
      → runLtrFineSpanGeneration          ← Fine Span SSOT（待 DELETE 生产决策权）
           generateLocalOptionsAtCursor (2..5)
           commitBestFormalFineSpan
           cursor = syllableEnd
      → resolveCompatibilityRelations
      → runDomainAwareAssembly
           voteUtteranceDomainFromPool     ← 整句一次
      → buildSentenceCandidates + merge (≤16)
    → runFwSentenceRerankFromPrefilled
      → KenLM scoreBatch(string[])
```

---

## 3. Modification Whitelist

### ALLOW

```text
span-assembly-v4-orchestrator
ltr-fine-span-generator（替换/掏空生产决策）
window generation（新模块）
recall orchestration（去重 / parent tags 批量）
Fine Span / Path / Edge DTO
domain vote caller
sentence assembly caller
candidate merge / global allocator
KenLM metadata adapter
diagnostics / trace
freeze-contract tests
architecture / interface / data contracts
```

### FORBIDDEN (default)

```text
FW acoustic / timestamp generation
Tone model inference
Domain Vote 计票公式内核
KenLM scorer 内核 / 模型文件
词库 Schema / 导入 / term_domain_tags 语义
NMT / TTS
新增 SQLite 索引 / 临时表 / 持久中间表
feature flag / shadow 双链
```

越界必须停工并出独立变更说明。

---

## 4. §5.5 Decision Confirmations

本开发方案已书面确认（全部 **YES**）：

| # | Decision | Status |
|---|----------|--------|
| 1 | `SegmentationPath[]` = 唯一 Fine Span SSOT | CONFIRMED |
| 2 | 正式窗口 1～5 音节 | CONFIRMED |
| 3 | 正式单字 Edge 必须来自正式词库 | CONFIRMED |
| 4 | fallback 单字与 lexical 单字严格区分 | CONFIRMED |
| 5 | coarse 不再硬切断窗口 | CONFIRMED |
| 6 | coarse 仅软参考 / gap / Trace | CONFIRMED |
| 7 | 不同 boundaryKey 可同时保留 | CONFIRMED |
| 8 | 同 boundaryKey 多 Candidate 不展开 Path | CONFIRMED |
| 9 | 每 Path 独立 Domain Vote | CONFIRMED |
| 10 | 每 Path 独立 SameDomain Assembly | CONFIRMED |
| 11 | 全局候选 ≤16 | CONFIRMED |
| 12 | KenLM 跨 Path 最终评分 | CONFIRMED |
| 13 | 不新增索引 | CONFIRMED |
| 14 | 不使用临时表 | CONFIRMED |
| 15 | 不保留旧新双链 | CONFIRMED |

---

## 5. Delete / Replace Matrix (Draft)

| Symbol / Behavior | Action | Replacement |
|-------------------|--------|-------------|
| `runLtrFineSpanGeneration` 生产 SSOT | REPLACE | `enumerateCompleteSegmentationPaths` 主链 |
| `commitBestFormalFineSpan` | DELETE 决策权 | Path 枚举 |
| `cursor = syllableEnd` 贪心 | DELETE | 全句窗 + Path |
| 局部 cursor 2..5 窗合同 | REPLACE | 全句 1..5 |
| 整句一次 Vote | REPLACE | per-path Vote caller |
| 单 Formal Assembly 假设 | REPLACE | per-path Assembly |
| `generateGlobalWindows` | DELETE | 新 window generator |
| `truncateWindows` 生产 | DELETE | — |
| `lookupTermDomainTagsInScope` 循环 | DELETE (Phase 5) | multi-id tags 装配 |
| LTR-only freeze tests | REPLACE | Path freeze tests |
| shadow / feature flag | NOT INTRODUCE | — |

`FormalFineSpan[]`：**仅**作 `materializeFormalFineSpans(path)` 临时投影，非 SSOT。

---

## 6. Phase 0 Exit Criteria

```text
[x] 独立分支已创建
[x] 版本身份已记录
[x] 修改白名单已冻结
[x] §5.5 决策已确认
[x] Delete/Replace Matrix 草稿已写
[x] Interface / Data / Ownership 合同草稿已写（见 Contract Draft）
[x] Delete/Replace Matrix 草稿已写
[ ] dialog_200 数值基线归档目录（建议 Phase 1 开工前补跑）
[x] 运行逻辑未改（本 Phase 遵守）
```

配套产物：

```text
docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Interface_Data_Contract_Draft_2026_07_26.md
docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Delete_Replace_Matrix_2026_07_26.md
```

**Phase 0 状态：PHASE 0 INCOMPLETE**（数值基线与 clean Git 由 Phase 0.5 完成）。

请改读：`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase0_5_Baseline_Seal_Report_2026_07_26.md`
