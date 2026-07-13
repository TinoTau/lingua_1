# Tone V2 Phase 7-A — Dataset Foundation Freeze Report

**Date:** 2026-06-29  
**Task Type:** Documentation Freeze · Architecture Verification（**非功能开发** · **非代码修改**）  
**Scope:** 正式冻结 Tone V2 **Dataset Foundation** 为唯一数据层 SSOT  
**依据：**

- [Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md](./Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md)
- [Tone_V2_Phase6D_Dataset_Pipeline_Foundation_Development_Report.md](./Tone_V2_Phase6D_Dataset_Pipeline_Foundation_Development_Report.md)
- [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md)
- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) · [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- 当前仓库实际代码（只读审计）

**产出 SSOT：** [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)

---

## Executive Summary

| 项 | 裁决 |
|----|------|
| Dataset Foundation 可冻结为唯一 SSOT | **是** |
| P7-A 全量 AISHELL-3 Level 2 验收 | **PASS**（见 Acceptance Report） |
| 代码逻辑本轮修改 | **无**（仅文档） |
| Runtime / Contract / Training Pipeline 冻结 | **保持** |
| 新 SSOT 文档 | `TONE_V2_DATASET_FOUNDATION_FREEZE.md` |

### Final Verdict: **PASS**

Phase 7-A 关闭：**Dataset Foundation 已冻结**。AISHELL-3 定义为 **Current Canonical Training Dataset**；`data_mini` 定义为 **Regression Fixture**。后续语料仅能通过 **新增 DatasetAdapter + AlignmentProvider** 扩展，**不得**修改已冻结 Framework。

---

## Frozen Scope

| 冻结项 | 锚点 | P7-A 状态 |
|--------|------|-----------|
| Dataset Contract | `dataset/dataset_contract.py` | FROZEN |
| DatasetAdapter 协议 | 同上 + `adapter_*.py` | FROZEN |
| AlignmentProvider 协议 | 同上 + `alignment_textgrid.py` | FROZEN |
| DatasetManifest / DatasetMetadata | `dataset_contract.py` · `cache_layout.py` | FROZEN |
| CacheLayout | `cache_layout.py` | FROZEN |
| Materialize 语义 | Adapter `materialize()` · `.extracted` marker | FROZEN |
| Join Audit | `probe_aishell3.audit_join` | FROZEN |
| Dataset Statistics Probe | `probe_aishell3` `stats` / `accept` | FROZEN |
| Dataset Probe CLI | `probe_aishell3`（含 `accept`） | FROZEN |
| Current Canonical Training Dataset | `openslr_aishell3/v1` · 全量实测 | ACCEPTED |
| Regression Fixture | `CS5647Team3_data_mini/v1` · 基线计数 | FROZEN |

---

## SSOT Update

| 文档 | 变更 |
|------|------|
| **`TONE_V2_DATASET_FOUNDATION_FREEZE.md`** | **新增** — Dataset Foundation **唯一 SSOT** |
| `TONE_V2_CONTRACT_FREEZE.md` | §15 引用 Dataset Foundation SSOT |
| `TONE_V2_TERMINOLOGY.md` | 新增 Canonical Training Dataset · Regression Fixture · Full Dataset Acceptance |
| `README.md` | Phase 7-A CLOSED/FROZEN · SSOT 表 · Regression 门扩展 |
| `docs/tone-module/ARCHITECTURE.md` | §12 Dataset Foundation（Training 数据层） |
| `Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md` | P7-A 冻结脚注 · `accept` · 术语对齐 |
| `TONE_V2_DOCUMENTATION_STYLE_GUIDE.md` | Dataset Foundation SSOT 引用 |
| `Lingua Project Constitution` | Rule 0「一个 Dataset」澄清为 Foundation SSOT |
| `Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md` | 术语对齐（Canonical vs 唯一数据源） |

---

## Documentation Update

### Documentation Alignment Audit

| 检查 | 结果 |
|------|------|
| 「唯一训练数据源」歧义 | **已消除** → **Current Canonical Training Dataset** |
| Dataset Probe vs Runtime Validation | **一致**（TERMINOLOGY Level 2/3） |
| P7-A 验收与 P6-D/E 契约描述 | **一致** |
| Runbook 与 `accept` 子命令 | **已同步** |
| Constitution Rule 0 vs 多语料扩展 | **已澄清**（Foundation 唯一 · 语料槽可扩展） |
| 历史「~2M 音节」粗估 | **标注**为 MFA interval 粗估；Canonical 实测 **997,992** |

### Dataset Foundation Freeze Audit

| 审计项 | Expected | Actual | Action |
|--------|----------|--------|--------|
| Adapter → Provider → SyllableSample | 全量 parity | provider=probe=997,992 | **KEEP** |
| Join rate | ≥ 99% | 100% | **KEEP** |
| Manifest / License validation | PASS | PASS | **KEEP** |
| `train_tone_cnn` 默认 data_mini | 不变 | 不变 | **KEEP** |
| 冻结层 SHA256 | 不变 | `FrozenArchitectureTest` PASS | **KEEP** |
| 第二 Dataset Pipeline | 禁止 | 未发现 | **KEEP** |

---

## Dataset Foundation Freeze

**生效行为：**

1. `dataset_contract.py` · `cache_layout.py` · `alignment_textgrid.py` · `probe_aishell3.py` 框架逻辑 — **不得直接修改**。
2. 新数据集 — **仅**新增 `adapter_*.py`（+ 可选新 Provider）。
3. Canonical 变更（如换对齐供应商）— 新 `version` 槽 + 全量 `accept` + 再冻结文档。
4. Phase 7-B 训练工程 — **仅**修改 `train_tone_cnn` 编排；**不**触碰本 Freeze 范围。

---

## Architecture Compliance

| 边界 | 合规 |
|------|------|
| Dataset Foundation ⊥ Runtime | **是** — dataset 模块无 Decision import |
| Dataset Foundation ⊥ Artifact Validation 语义 | **是** — validate 不读 dataset 树 |
| Training 主链单入口 | **是** — 仅 `train_tone_cnn.py` |
| 扩展模型 | Adapter + Provider **仅** | **是** |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| `contract.py` / `loader.py` / `mel.py` / `inference.py` / `validate_artifact.py` | **未改** |
| `train_tone_cnn.py` 本轮 | **未改** |
| Dataset 模块本轮 | **未改**（冻结轮次零代码 diff） |
| Level 2 Probe 证据 | `phase7a_acceptance.json` · Final **PASS** |
| Level 3 Runtime Validation | **未执行**（符合 P7-A 范围） |

---

## Architecture Drift Audit

| 处置 | 项 |
|------|-----|
| **KEEP** | Dataset Contract · CacheLayout · Materialize · Join Audit · Statistics Probe · `accept` 门禁 |
| **KEEP** | `OpenSlrAishell3DatasetAdapter` · `HuggingFaceZipDatasetAdapter` · `TextGridPinyinAlignmentProvider` |
| **KEEP** | `default_data_mini_pipeline` 为 **Regression Fixture** 默认 |
| **KEEP** | AISHELL-3 槽 `openslr_aishell3/v1` 为 **Current Canonical Training Dataset** |
| **MODIFY** | 文档 SSOT 集合（本轮）— 新增 `TONE_V2_DATASET_FOUNDATION_FREEZE.md` 等 |
| **RESTORE** | — |
| **DELETE** | — |

**Material Drift（冻结轮）：无**

---

## Regression Baseline

### Regression Fixture（`data_mini`）

| 指标 | 基线 |
|------|------|
| syllable_count | 11,820 |
| utterance_count | 466 |
| train / val syllables | 10,012 / 1,808 |
| 类分布 (t1..t5) | 2570 · 2702 · 1716 · 4314 · 518 |

**门：** `test_phase6d_dataset` · `test_phase3_contracts`（训练 smoke）

### Current Canonical Training Dataset（AISHELL-3 · P7-A）

| 指标 | 基线 |
|------|------|
| speaker_count | 218 |
| utterance_count | 88,035 |
| syllable_count | 997,992 |
| wav_join_rate | 1.0000 |
| 类分布 (t1..t5) | 210,316 · 235,097 · 160,857 · 330,934 · 60,788 |

**门：** `probe_aishell3 accept` → PASS · `test_phase6e_aishell3` Fixture

### Unit Test 合计

**38/38 PASS**（1 skipped：`OptionalLocalAishellDatasetProbeTest`）

---

## Remaining Risks

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| Phase 7-B 误改 Dataset Foundation | MED | 本 Freeze SSOT + Code Review 对照 §7 |
| lars76 / OpenSLR 版本漂移 | MED | 新 `version` 槽 + 重跑 `accept` |
| 文档仍写「唯一数据源」 | LOW | TERMINOLOGY + Style Guide 已禁止 |
| 训练 OOM（与 Foundation 无关） | HIGH（7-B） | Feature Shard / Streaming — **不**改 Foundation |

---

## Final Verdict

### **PASS**

Dataset Foundation 已作为 Tone V2 **唯一 Dataset Foundation SSOT** 正式冻结。可进入 **Phase 7-B Training Engineering**，无需再修改 Dataset Foundation Framework。

---

## 终局确认

| # | 问题 | 答案 |
|---|------|------|
| 1 | Dataset Foundation 是否为唯一 SSOT？ | **是** — `TONE_V2_DATASET_FOUNDATION_FREEZE.md` |
| 2 | AISHELL-3 如何定义？ | **Current Canonical Training Dataset**（非「唯一数据源」措辞） |
| 3 | data_mini 如何定义？ | **Regression Fixture** |
| 4 | 未来 Baker / 企业 / 用户数据？ | **新增 Adapter + Provider**；**不得**改 Framework |
| 5 | 直接修改 Contract / CacheLayout / Probe？ | **禁止**（再冻结流程除外） |
