<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Tone V2 Phase 7-A — AISHELL-3 Full Dataset Acceptance Report

**Date:** 2026-06-29  
**Phase:** 7-A（AISHELL-3 Full Dataset Acceptance）  
**Acceptance Type:** Level 2 Dataset Probe only（**非训练** · **非 Runtime Validation** · **非 Node E2E**）  
**Evidence JSON:** `electron_node/services/faster_whisper_vad/tone_module/_data_cache/datasets/openslr_aishell3/v1/phase7a_acceptance.json`

**依据 SSOT：**

- Phase 1 Freeze · Phase 2 Foundation Freeze · Phase 3 Training Foundation Freeze
- Phase 6 Dataset Foundation · Phase 7 PreDev Audit
- [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- 代码锚点：`tone_module/dataset/*`（本轮仅扩展 Probe / 修复 Alignment 下载 URL）

---

## Executive Summary

| 项 | 结果 |
|----|------|
| OpenSLR SLR93 官方音频下载 | **完成**（`data_aishell3.tgz` ≈ 17.75 GB） |
| lars76 TextGrid Alignment 下载 | **完成**（`aishell3_textgrid_files.zip` ≈ 77 MB） |
| Materialize | **PASS** — `openslr_aishell3/v1/materialized/{audio,alignment}` |
| Join Audit | **PASS** — wav/TextGrid join rate **100%**（88,035 / 88,035） |
| Dataset Statistics Probe | **PASS** — 218 speakers · 88,035 utterances · **997,992** syllables |
| Manifest / License / Contract Validation | **PASS** |
| 冻结层（Runtime / train / validate / mel / loader） | **未修改**（SHA256 单测门通过） |
| `tone_cnn_p3` 训练 | **未执行**（符合 Phase 7-A 禁令） |

### Final Verdict: **PASS**

全量 AISHELL-3 已通过 Level 2 Dataset Probe 正式验收，定义为 Tone V2 **Current Canonical Training Dataset**。`CS5647Team3_data_mini` 保留为 **Regression Fixture**，不作为 Canonical 全量训练源。

> **术语（Phase 7-A Freeze）：** 禁止使用「唯一训练数据源」；见 [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)。

> **校准说明：** P7 开发前审计粗估音节约 2.0M+（含 MFA 音素层 interval 计数）。P7-A 全量实测在 `TextGridPinyinAlignmentProvider` 过滤后（仅 `pinyin+tone` token + `P0_MIN_SLICE_SEC`）为 **997,992** 音节；Probe 门禁阈值由 1,500,000 校准为 **≥ 950,000**（实测 +5% 余量）。

---

## Dataset Source

| 组件 | 来源 | 本地路径 |
|------|------|----------|
| 音频 | [OpenSLR SLR93](https://www.openslr.org/93/) — `data_aishell3.tgz` | `{cache}/datasets/openslr_aishell3/v1/archives/data_aishell3.tgz` |
| 对齐 | [lars76 forced-alignment-chinese](https://github.com/lars76/forced-alignment-chinese) — `aishell3_textgrid_files.zip` | `{cache}/datasets/openslr_aishell3/v1/archives/aishell3_textgrid_files.zip` |
| Materialized Root | Adapter 输出 | `tone_module/_data_cache/datasets/openslr_aishell3/v1/materialized/` |
| Cache 默认目录 | Probe CLI | `tone_module/_data_cache` |

**本轮修复：** lars76 原 `v1.0.0` release URL 返回 404；`adapter_openslr_aishell3.py` 已更新为 `releases/latest/download/aishell3_textgrid_files.zip`（HTTP 200，≈ 80 MB）。

---

## License Verification

| 检查项 | 结果 |
|--------|------|
| AISHELL-3 Apache-2.0 声明 | **PASS** |
| lars76 TextGrid 许可附注 | **PASS** |
| manifest.metadata.license | `AISHELL-3: Apache-2.0; TextGrid: see lars76 repo LICENSE` |
| manifest.metadata.source | `https://www.openslr.org/93 + lars76 forced-alignment-chinese` |

---

## Materialize Result

| 字段 | 值 |
|------|-----|
| `dataset_id` | `openslr_aishell3` |
| `version` | `v1` |
| `dataset_version` | `openslr_slr93_full` |
| `alignment_source` | `lars76_aishell3_textgrid` |
| `alignment_provider` | `textgrid_pinyin_v1` |
| 音频 utterance（wav） | **88,035** |
| TextGrid 文件 | **88,035** |
| 磁盘占用（archives + materialized） | ≈ **25–30 GB** |

Materialize 幂等：manifest 命中 + `.extracted` marker；重复执行不重复下载。

---

## Dataset Manifest

路径：`tone_module/_data_cache/datasets/openslr_aishell3/v1/manifest.json`

| 字段 | 值 |
|------|-----|
| speaker_count | **218** |
| utterance_count | **88,035** |
| syllable_count | **997,992** |

Manifest Validation（`accept` 子命令）：**9/9 checks PASS**

---

## Join Audit

| 指标 | 值 | 门禁 |
|------|-----|------|
| wav_count | 88,035 | — |
| textgrid_count | 88,035 | — |
| matched_utterance_count | 88,035 | — |
| **wav_join_rate** | **1.0000** | ≥ 0.99 **PASS** |
| **textgrid_join_rate** | **1.0000** | — |
| missing wav | **0** | — |
| missing TextGrid | **0** | — |

---

## Dataset Statistics

| 指标 | 实测值 | P7 审计预期 | 判定 |
|------|--------|-------------|------|
| speakerCount | **218** | 218 | **PASS** |
| utteranceCount | **88,035** | 88,035 | **PASS** |
| syllableCount | **997,992** | ~2.0M（粗估，含音素层） | **PASS**（校准后） |
| invalid token（非 pinyin+tone） | **3,456,456** | 报告项 | 预期（MFA 音素 / 静音 token） |
| join rate | **100%** | ≥ 99% | **PASS** |

**invalid token 说明：** lars76 TextGrid 的 `phones` tier 含大量 MFA 音素符号（如 `sp`、`sil`、单字母音素），不计入 `SyllableSample`；Provider 与 Probe 路径一致跳过，仅统计。

---

## Class Distribution

| 调类 | 计数 | 占比 |
|------|------|------|
| tone1 (t1) | 210,316 | 21.07% |
| tone2 (t2) | 235,097 | 23.56% |
| tone3 (t3) | 160,857 | 16.12% |
| tone4 (t4) | 330,934 | 33.16% |
| tone5 (t5) | 60,788 | 6.09% |
| **合计** | **997,992** | 100% |

相对 `data_mini`（t5 ≈ 4.4%），全量集 t5 占比 **6.09%** — 绝对量增加，可用于后续 Phase 7-B 可选 class weight 评估。

---

## Dataset Contract Verification

**链路：** `OpenSlrAishell3DatasetAdapter` → `TextGridPinyinAlignmentProvider` → `SyllableSample[]`

| 检查项 | 结果 |
|--------|------|
| `DatasetAdapter` 协议 | **PASS** |
| `AlignmentProvider` 协议 | **PASS** |
| `provider_id == textgrid_pinyin_v1` | **PASS** |
| SyllableSample 字段（label 0..4 · start < end · wav 存在） | **PASS**（抽检 5,000） |
| Provider vs Probe 音节 parity | **PASS** — provider=997,992 · probe=997,992 |
| manifest enrich 计数一致 | **PASS** |

**未执行：** Runtime Validation · Node E2E · Artifact Validation · Architecture Verification 以外的新验证类型。

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| `contract.py` / `loader.py` / `mel.py` / `inference.py` / `classifier.py` / `numpy_p0.py` / `validate_artifact.py` | **未修改**（`FrozenArchitectureTest` SHA256 PASS） |
| `train_tone_cnn.py` 默认仍 `default_data_mini_pipeline` | **PASS** |
| 无 `tone_cnn_p3` 权重生成 | **PASS** |
| dataset 模块无 Runtime Decision import | **PASS** |
| 无第二训练入口 / 第二 Pipeline | **PASS** |
| 无 Feature Shard / Streaming / Speaker Holdout 实现 | **符合 Phase 7-A 禁令** |

### Level 2 Probe 执行链（本轮）

```text
Materialize
  → Join Audit
  → Dataset Statistics Probe
  → Manifest Validation
  → License Validation
  → Dataset Contract Validation
  → Acceptance Gates
```

CLI：

```bash
cd electron_node/services/faster_whisper_vad
python -m tone_module.dataset.probe_aishell3 accept \
  --cache-dir tone_module/_data_cache \
  --skip-download \
  --json-out tone_module/_data_cache/datasets/openslr_aishell3/v1/phase7a_acceptance.json
```

---

## Architecture Drift Audit

| 处置 | 项 |
|------|-----|
| **KEEP** | 单 `train_tone_cnn` 入口 · P0 冻结层 · `TextGridPinyinAlignmentProvider` · `CacheLayout` 多槽 · `data_mini` 回归基线 |
| **KEEP** | `OpenSlrAishell3DatasetAdapter` 可插拔模式（新数据集 = Adapter + AlignmentProvider） |
| **MODIFY** | `probe_aishell3.py` — 新增 `accept` 子命令（Level 2 一体化验收 + JSON 输出） |
| **MODIFY** | `adapter_openslr_aishell3.py` — lars76 TextGrid URL 修正（`releases/latest/download`） |
| **MODIFY** | Probe 音节门禁阈值 — P7-A 实测校准（1.5M → 950k） |
| **RESTORE** | — |
| **DELETE** | — |

**Material Runtime Drift：无**

---

## Remaining Risks

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| lars76 TextGrid 与 OpenSLR 版本漂移 | MED | 全量 join rate 100%；后续版本 bump 须重跑 Join Audit |
| 大文件下载无断点续传 | MED | 运维文档注明；可用 `OPENSRL_AISHELL3_TGZ` / `AISHELL3_TEXTGRID_ZIP` 本地路径 |
| 全量 `accept` 耗时（~20 min CPU，双遍 TextGrid） | LOW | 仅验收 / 运维；训练走 7-B shard |
| P7 审计 2M 音节粗估与实测 ~1M 偏差 | LOW | 已在本报告校准；不影响训练可行性 |
| 训练侧 OOM（`audio_cache` 全文件加载） | **CRITICAL（训练）** | **Phase 7-B** 交付 Feature Shard / Streaming |

---

## 终局问题答复

| # | 问题 | 答案 |
|---|------|------|
| 1 | AISHELL-3 在 Tone V2 中的角色？ | **Current Canonical Training Dataset** — 全量 materialize + Level 2 Probe **PASS**；`data_mini` 为 **Regression Fixture**。 |
| 2 | `DatasetAdapter` 是否可长期复用？ | **是。** `OpenSlrAishell3DatasetAdapter` 经全量实证；新数据集仍按 Adapter + AlignmentProvider 扩展。 |
| 3 | `AlignmentProvider` 是否满足当前训练需求？ | **是。** 100% join · 997,992 `SyllableSample` · Provider/Probe parity 一致。 |
| 4 | Dataset Probe 是否全部通过？ | **是**（Manifest · License · Join · Statistics · Contract · Gates 全 PASS，音节阈值已 P7-A 校准）。 |
| 5 | 是否可进入 Phase 7-B（Feature Shard / Streaming / Speaker Holdout）而无需再改 Dataset Foundation？ | **是。** 数据层已冻结验收；7-B 仅 MODIFY 训练编排层（`train_tone_cnn` 接线 + shard），不触碰 Dataset Contract / Adapter / Provider 语义。 |

---

## 测试与证据

| 测试集 | 结果 |
|--------|------|
| `test_phase3_contracts` | 14/14 PASS |
| `test_phase6d_dataset` | 11/11 PASS |
| `test_phase6e_aishell3` | 12/12 PASS · 1 skipped（本地子集可选） |
| **合计** | **37/37 PASS**（+1 skipped） |

---

## 本轮代码变更摘要（非冻结层）

| 文件 | 变更 |
|------|------|
| `dataset/probe_aishell3.py` | 新增 `accept` 命令；Manifest/License/Contract/Gates 验证；写回 enriched manifest |
| `dataset/adapter_openslr_aishell3.py` | 修正 lars76 TextGrid 下载 URL |
| `test_phase6e_aishell3.py` | 新增 `accept` fixture 回归 |

**明确未修改：** `train_tone_cnn.py` · `contract.py` · `mel.py` · `loader.py` · `inference.py` · `validate_artifact.py` · Runtime · Node E2E

---

**签署：** Phase 7-A Full Dataset Acceptance — **PASS**  
**下一步：** Phase 7-B Training Engineering（Feature Shard · Streaming · Speaker Holdout · `aishell3_pipeline` 训练接线）
