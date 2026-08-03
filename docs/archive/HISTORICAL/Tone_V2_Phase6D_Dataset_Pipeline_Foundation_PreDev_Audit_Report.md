<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase6D_Dataset_Pipeline_Foundation_PreDev_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 6-D — Dataset Pipeline Foundation 开发前代码审计报告

**Date:** 2026-06-29  
**Audit Type:** Read-only Pre-Development Code Audit（**非训练** · **非 Runtime 开发**）  
**Scope:** 审计当前训练数据接入流程是否已具备长期可扩展能力；评估后续接入 AISHELL-3、Baker、企业数据、真实业务数据时，是否**仅需新增数据适配层**而无需改动训练主链 / Artifact / Validation / Runtime  
**禁止项（本轮）：** 训练 `tone_cnn_p3` · 生成新权重 · 修改 Runtime / Loader / Contract / Feature Baseline / Recall / Ranking / Assembly / KenLM / Apply / Service Boundary / Backend Adapter

**依据 SSOT：**

- [Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md)
- [Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_P4_tone_cnn_p1_Model_Freeze_Audit_Report.md](./Tone_V2_P4_tone_cnn_p1_Model_Freeze_Audit_Report.md) · [Tone_V2_Phase6B_tone_cnn_p2_Mainline_Replacement_Report.md](./Tone_V2_Phase6B_tone_cnn_p2_Mainline_Replacement_Report.md)
- [Tone_V2_Phase6A_Model_Iteration_Platform_Cleanup_Development_Report.md](./Tone_V2_Phase6A_Model_Iteration_Platform_Cleanup_Development_Report.md)
- [Tone_V2_Phase6C_Training_Data_Expansion_PreDev_Audit_Report.md](./Tone_V2_Phase6C_Training_Data_Expansion_PreDev_Audit_Report.md)
- **代码锚点：** `tone_module/train_tone_cnn.py` · `contract.py` · `mel.py` · `validate_artifact.py` · `offline_tone_eval.py` · `loader.py` · `test_phase3_contracts.py`

> **Phase 5 说明：** 仓库无独立 Phase 5 冻结文档；本审计将 **P4 Model Freeze + P6-A Tooling Freeze + P6-B p2 主链验收** 视为模型运维与工具链实证基线（与 Phase 6 前置审计一致）。

---

## Executive Summary

| 审计问题 | 结论 |
|----------|------|
| 当前是否已具备长期 Dataset Pipeline 扩展能力？ | **否（尚未成立）** — 数据接入为 `train_tone_cnn.py` **单文件单体实现** |
| TextGrid 是否已抽象为 Alignment Provider？ | **否** — TextGrid 解析与样本发现**写死在** `_collect_samples()` |
| Dataset Contract 是否独立于 AISHELL / data_mini 目录？ | **否** — 下载、marker、发现逻辑均绑定 HF zip + `AISHELL-3` 布局 |
| 职责是否已分离（Index / Discovery / Alignment / Feature / Cache / Train）？ | **部分** — 仅 `SyllableSample` + `split_val_holdout` / `load_val_holdout_features` 可复用；其余耦合同文件 |
| 新增数据源是否仅需 Adapter + Provider？ | **当前不行**；**P6-D 完成后目标成立** |
| 是否改变 Runtime？ | **否**（数据扩展与 P6-D 均属 Training Foundation） |
| 第二训练链路 / 旁路？ | **未发现** |

### Final Verdict: **CONDITIONAL PASS**

**含义：** 冻结的 **训练主链**（`SyllableSample` → 特征 → MLP → npz → `validate_artifact` → 部署 → E2E）**正确且单一**；但 **Dataset Pipeline Foundation 尚未落地**，不具备「仅加 Adapter 即可接所有数据源」的现成能力。**须执行 Phase 6-D 开发**（抽取 Adapter / Alignment Provider / Cache 层）后，方可对问题 6 给出 **PASS**。

---

## Frozen Architecture Verification

### 训练 vs Runtime 边界（审计日代码）

```text
[Training — 允许演进 Dataset 层]
Dataset → SyllableSample[] → mel features → MLP → npz
       → validate_artifact → offline_tone_eval (optional)
       → TONE_MODEL_PATH + FW 重启 → Node E2E

[Runtime — 冻结]
FW → run_tone_inference → UtteranceResponse.tone → acousticToneSlices → Recall → … → Apply
```

| 检查项 | Expected | Actual | Exists | Effective | Severity | Action |
|--------|----------|--------|--------|-----------|----------|--------|
| 单训练入口 | 仅 `train_tone_cnn.py` | 仅一文件；无 `train_tone_crnn` 等 | ✓ | ✓ | — | **KEEP** |
| 训练不 import Decision | 禁止 Recall/Ranking/… | 仅 `mel` · `contract` · `validate_artifact` | ✓ | ✓ | — | **KEEP** |
| Artifact 为唯一桥梁 | Loader 只读 npz | `loader.py` 不读数据集 | ✓ | ✓ | — | **KEEP** |
| Validation 与数据源解耦 | 仅验 weights + adapter | `validate_artifact` 无 dataset import | ✓ | ✓ | — | **KEEP** |
| Offline 与数据源弱耦合 | 可 `--eval-json` 跳过重建 | `offline_tone_eval` 支持预计算数组 | ✓ | ✓ | — | **KEEP** |
| Runtime 不读 dataset 字段做决策 | `datasetVersion` 仅 diagnostics | Loader 不校验 dataset | ✓ | ✓ | — | **KEEP** |
| 第二训练链路 | 禁止 | 未发现 | ✗ | ✗ | — | **KEEP** |
| Dataset 层可插拔 | P6-D 目标 | **未实现** Adapter 接口 | ✗ | ✗ | **HIGH** | **MODIFY** |

**Material Runtime Drift：无**

---

## Dataset Contract Matrix

**隐式契约（代码中存在，未独立模块化）：**

```python
@dataclass
class SyllableSample:
    wav_path: str
    start: float      # seconds
    end: float        # seconds
    label: int        # 0..4 => t1..t5
```

| 契约项 | Expected（P6-D 目标） | Actual（当前） | Impact | Severity | Action |
|--------|----------------------|----------------|--------|----------|--------|
| 统一训练样本类型 | `SyllableSample` 或等价 | **有** `SyllableSample` | 可作为稳定边界 | — | **KEEP** |
| 与 AISHELL 目录解耦 | Contract 不引用路径 | Contract **未独立文件**；逻辑绑在 `train_tone_cnn` | 换源必改训练文件 | **HIGH** | **MODIFY** 抽出 `dataset_contract.py` |
| 标签语义 | t1–t5 · `contract.P0_N_CLASSES` | `PINYIN_TONE_RE` + `tone_num-1` | 与 Runtime 五类一致 | — | **KEEP** 语义 |
| 最小时长 | `contract.P0_MIN_SLICE_SEC` | `_collect_samples` 使用 | 与 Feature SSOT 一致 | — | **KEEP** |
| 特征维数 | 80-d mel | `_build_feature_matrix` → `extract_mel_features` | 与 Runtime 一致 | — | **KEEP** |
| Dataset 元数据契约 | 描述 source/license/alignment | **无** 结构化 `DatasetManifest` | 追溯不足 | **MED** | **MODIFY** |

**结论：** **中间样本契约（SyllableSample）已稳定**；**数据集清单契约（Manifest / Index）未建立**。

---

## Dataset Pipeline Matrix

| 阶段 | Expected（职责分离） | Actual（`train_tone_cnn.py`） | 分离？ | Impact | Severity | Action |
|------|---------------------|------------------------------|--------|--------|----------|--------|
| **Dataset Index** | 可版本化的 manifest（id · version · license） | 无；仅 `dataset_repo` 字符串 | **否** | 多源共存困难 | **HIGH** | **MODIFY** |
| **Sample Discovery** | Adapter 发现 wav/utterance | `_index_wavs()` 全局 walk | **否** | 绑 wav 扩展名与树形遍历 | **MED** | **MODIFY** |
| **Alignment** | Provider 产出 `(start,end,token)` | `_parse_textgrid_intervals` + `.TextGrid` only | **否** | 非 TextGrid 源无法接入 | **HIGH** | **MODIFY** |
| **Slice Generation** | 从对齐生成 `SyllableSample` | `_collect_samples` 内联 | **部分** | 与 Alignment 耦合 | **MED** | **MODIFY** 抽出 |
| **Feature Extraction** | 独立 `FeatureExtractor` | `_build_feature_matrix` | **部分** | 已用 `mel.extract_mel_features` | **LOW** | **KEEP** 调用点；可薄封装 |
| **Cache** | 按 datasetId/version 分区 | `_data_cache/extracted/dataset` 单槽 | **否** | 换源需手工清缓存 | **HIGH** | **MODIFY** |
| **Download / Materialize** | Dataset Adapter 负责 | `_ensure_dataset` HF zip + `AISHELL-3` marker | **否** | 绑 HF + AISHELL 路径 | **HIGH** | **MODIFY** |
| **Train/Val Split** | 可配置策略 | `split_val_holdout_samples` utterance 级 | **是** | P6-A 已导出供 offline 复用 | — | **KEEP**；扩展 speaker-stratified |
| **Training** | 与数据解耦 | `_train_mlp` / `train_and_save` | **是** | 仅吃 `(X,y)` | — | **KEEP** |
| **Artifact Write** | 与数据解耦 | `np.savez` + metadata | **是** | `datasetVersion` 仅字符串 | — | **KEEP** schema；**MODIFY** metadata 丰富度 |
| **Validation** | 与数据解耦 | `validate_artifact` 后置 | **是** | Phase 3 冻结 | — | **KEEP** |

**管线图（当前实际）：**

```text
_ensure_dataset [HF zip + AISHELL marker]
       ↓
_collect_samples [walk TextGrid + wav_map + parse + label]
       ↓
split_val_holdout_samples
       ↓
_build_feature_matrix [sf.read + slice + extract_mel_features]
       ↓
_train_mlp → np.savez → validate_artifact → offline_tone_eval
```

**目标图（P6-D 不偏离冻结架构）：**

```text
DatasetAdapter.materialize() → dataset_root / manifest
       ↓
AlignmentProvider.align() → Iterable[AlignedSyllable]
       ↓
SyllableSampleBuilder → List[SyllableSample]   # 保持现有类型
       ↓
[不变] split → feature → train → artifact → validate → E2E
```

---

## Alignment Provider Matrix

### 问题 1–2：TextGrid 是否写死？是否应视为 Alignment Provider？

| 项 | Expected | Actual | Impact | Severity | Action |
|----|----------|--------|--------|----------|--------|
| 对齐源可插拔 | TextGrid 为一种 Provider | **唯一**实现：`.TextGrid` + Praat interval 正则 | 新对齐格式必须改 `_collect_samples` | **HIGH** | **MODIFY** |
| TextGrid 非冻结架构 | 实现细节，非 SSOT | 与 AISHELL mini 打包格式**焊死** | 误把 TextGrid 当永久架构 | **MED** | **KEEP** 为默认 Provider；**不冻结** |
| 拼音+调号解析 | Provider 输出 token | `_tone_label_from_pinyin` 在训练文件内 | 可复用为共享 util | **LOW** | **KEEP** 逻辑；迁入 provider 模块 |
| MFA / CTM / JSON 对齐 | 未来 Provider | **不存在** | Baker/企业数据需新 Provider | **HIGH** | **MODIFY** P6-D |
| 企业 ASR 时间戳 | 未来 Provider | **不存在** | 业务数据需独立 Provider | **HIGH** | **MODIFY** P6-D |

**裁决：**

1. **当前把 TextGrid 写死为唯一输入 — 是**（L128 `endswith(".TextGrid")`；L58–68 专用解析器）。
2. **当前并未把 TextGrid 视为一种 Alignment Provider — 否**；它是训练脚本内部实现，**不是**可替换插件。
3. **设计立场（P6-D 应采用）：** TextGrid（Praat interval + `pinyin+tone`）= **当前默认 Alignment Provider 实现**；**不是**冻结架构的一部分。冻结的是 **`SyllableSample` + `p0-v1` mel + 5-class label**。

---

## Dataset Metadata Matrix

### Artifact / Loader 可选字段（`loader.py` · `contract.ToneModelMetadata`）

| 字段 | Runtime 读取？ | 当前训练写入？ | P6-D 需要？ | Action |
|------|---------------|---------------|-------------|--------|
| `datasetVersion` | 否（diagnostics） | **是** — HF repo 字符串 | **KEEP** | **KEEP** |
| `trainingVersion` | 否 | 是 | — | **KEEP** |
| `modelVersion` | 否 | 是 | — | **KEEP** |
| `metrics` (dict) | 否 | train/val counts · acc | 可扩展 | **MODIFY** |
| `speakerCount` | 否 | **未写** | 追溯需要 | **MODIFY**（训练侧 npz `notes` 或 metrics） |
| `utteranceCount` | 否 | **未写** | 追溯需要 | **MODIFY** |
| `syllableCount` | 否 | 仅在 `metrics.train_samples` 等 | 部分有 | **MODIFY** 规范化 |
| `alignmentProvider` | 否 | **未写** | 多源必选 | **MODIFY** |
| `license` | 否 | **未写** | 合规 | **MODIFY** |
| `source` | 否 | 隐含于 `datasetVersion` | 企业源需显式 | **MODIFY** |

**是否需改 Runtime Contract？** **否。** 以上均可写入 npz **optional** 字段（`notes` JSON 字符串或扩展 `metrics` dict）；`loader.py` 已支持 `notes` · `datasetVersion` 透传 diagnostics，**不进入 Decision**。

**已知缺陷：** `_train_mlp` 内 `metrics["dataset"]` 硬编码模块常量 `DATASET_REPO`（L271），**忽略** `train_and_save(dataset_repo=...)` 传入值 — 属 **Training Hardcode Bug**（Severity **LOW**；`train_and_save` L331 已正确覆盖外层 metrics）。

---

## Cache Layout Matrix

**当前布局（实测 + 代码）：**

```text
tone_module/_data_cache/
  data_mini.zip                    # HF 下载产物
  extracted/
    dataset/
      AISHELL-3/train/wav/SSB*/   # 音频
      aishell3_alignment_tone/      # TextGrid（与 wav 异目录，basename 匹配）
```

| 能力 | Expected | Actual | Impact | Severity | Action |
|------|----------|--------|--------|----------|--------|
| 多 Dataset 共存 | `cache/{datasetId}/{version}/` | **单槽** `extracted/dataset` | 并行缓存会冲突 | **HIGH** | **MODIFY** |
| 多 Version 共存 | version 子目录 + manifest | 无 version；zip 文件名可变 | 无法并排保留 mini 与 full | **HIGH** | **MODIFY** |
| 多 Alignment Source | 对齐源元数据 + 独立子树 | TextGrid 树与 wav 树并列 | 仅当 basename 对齐时可工作 | **MED** | **MODIFY** |
| 缓存命中逻辑 | 按 manifest 校验 | `AISHELL-3` 目录存在即 **短路返回** | 换 `--dataset-repo` 仍用旧缓存 | **HIGH** | **MODIFY** |
| `--cache-dir` CLI | 可配置根 | **有** | 支持多环境 | — | **KEEP** |
| 特征矩阵缓存 | 可选 `.npy` shard | **无**；每次全量 `sf.read` | 全量 AISHELL 训练慢 | **MED** | **MODIFY**（P6-D 可选） |

---

## Dataset Adapter Matrix

| 未来数据源 | 现能否零改 `train_tone_cnn` 接入？ | 条件 | P6-D 后预期 |
|-----------|----------------------------------|------|-------------|
| **CS5647Team3/data_mini**（当前） | **是**（默认路径） | 已打包 wav+TextGrid | **KEEP** 为 regression Dataset Adapter |
| **AISHELL-3 全量** | **否** | OpenSLR tgz ≠ HF zip；需 TextGrid；需新缓存槽 | **DatasetAdapter** + **TextGridAlignmentProvider**；**不改** `_train_mlp` |
| **Baker / biaobei** | **否** | 需 MFA TextGrid 或新 Provider | 新 Adapter + 同 Provider 或 CTM Provider |
| **企业标注数据** | **否** | 自定义目录/格式 | **EnterpriseDatasetAdapter** + 对齐 Provider |
| **真实业务音频** | **否** | 需授权 + 对齐管线 | Adapter + Provider；**Runtime 不变** |
| **Tone Perfect / SCSC** | **否** | 单音节/非 TextGrid | 专用 Adapter（P6-C 已判补充集） |

### 硬编码扫描（`train_tone_cnn.py`）

| 类型 | 位置 / 内容 | Severity | Action |
|------|-------------|----------|--------|
| **Dataset Hardcode** | `DATASET_REPO` · `DATASET_ZIP` 默认常量 L36–37 | MED | **KEEP** 默认；Adapter 覆盖 |
| **AISHELL Hardcode** | `_ensure_dataset` marker `AISHELL-3` L88–90 | **HIGH** | **DELETE** 出核心路径 → Adapter |
| **TextGrid Hardcode** | `_collect_samples` `.TextGrid` L128 | **HIGH** | **MODIFY** → AlignmentProvider |
| **Path Hardcode** | `extracted/dataset` L87 | **HIGH** | **MODIFY** → CacheManager |
| **HF Download Hardcode** | `huggingface_hub.hf_hub_download` L95–103 | MED | **MODIFY** → Adapter.materialize |
| **Speaker Hardcode** | 无显式 speaker 字段；未分层划分 | MED | **MODIFY** split 策略 |
| **Cache Hardcode** | `CACHE_DIR` 默认 `_data_cache` L39 | LOW | **KEEP** 默认 |
| **Training Hardcode** | `_train_mlp` metrics `dataset=DATASET_REPO` L271 | LOW | **MODIFY** bugfix |
| **Training 主链** | MLP 结构 · epochs 默认 | — | **KEEP**（Phase 3 冻结） |

---

## Architecture Drift Audit

| 区域 | Expected | Actual | Impact | Severity | Action |
|------|----------|--------|--------|----------|--------|
| 单训练主链 | 一条 `train_tone_cnn` | 符合 | 无漂移 | — | **KEEP** |
| 训练→Runtime 隔离 | 无 Decision import | `test_phase3_contracts` 门禁 | 无泄漏 | — | **KEEP** |
| Offline 旁路进 Runtime | 禁止 | 无 production import | 无 | — | **KEEP** |
| Dataset 与 Artifact schema 混淆 | 权重 schema 独立 | `validate_artifact` 不读 TextGrid | 正确 | — | **KEEP** |
| TextGrid 进入 Runtime Contract | 禁止 | 未进入 | 正确 | — | **KEEP** |
| 「Adapter 已存在」文档幻觉 | P6-D 应落地 | **代码无 adapter 模块** | 过度宣称风险 | **MED** | **MODIFY** 文档与实现一致 |
| P6-A `--dataset-repo` | 换 HF 源无需改源码 | CLI **有**；discovery 逻辑 **仍 TextGrid+AISHELL 缓存** | 半泛化 | **MED** | **MODIFY** P6-D 补全 |
| 隐藏 Dataset 特判 | 禁止 | 未发现第二特判路径 | 无 | — | **KEEP** |
| 兼容/遗留双链路 | 禁止 | 无 `train_tone_*` 旁路 | 无 | — | **KEEP** |
| 死代码 | 最小化 | 无显著死分支 | 无 | — | **KEEP** |

---

## Required Development Matrix（Phase 6-D 实施清单）

| ID | 开发项 | 目的 | 触达 | 改 Runtime？ | 改 `train_and_save` 主链？ | Action |
|----|--------|------|------|--------------|---------------------------|--------|
| RD-D01 | 定义 `DatasetAdapter` 协议 + `DatasetManifest` | 统一 materialize / metadata | 新模块 `tone_module/dataset/` | 否 | **否**（仅换入口） | **MODIFY** |
| RD-D02 | 定义 `AlignmentProvider` 协议 | TextGrid 可替换 | 新模块 | 否 | 否 | **MODIFY** |
| RD-D03 | `TextGridPinyinAlignmentProvider` | 迁移现有 L58–144 逻辑 | 从 `train_tone_cnn` 抽出 | 否 | 否 | **MODIFY** |
| RD-D04 | `HuggingFaceZipDatasetAdapter` | 迁移 `_ensure_dataset` | 替代 HF+AISHELL marker | 否 | 否 | **MODIFY** |
| RD-D05 | `OpenSlrAishell3DatasetAdapter` | 全量 AISHELL tgz | 新 Adapter | 否 | 否 | **MODIFY** |
| RD-D06 | `CacheLayout` 多 dataset/version | 共存与命中 | `_data_cache` 规范 | 否 | 否 | **MODIFY** |
| RD-D07 | `train_tone_cnn` 瘦身为编排器 | `adapter→provider→samples→现有train` | `train_tone_cnn.py` | 否 | **薄 MODIFY**（接线，不重写 MLP） |
| RD-D08 | 扩展训练 metadata | speaker/utt/alignment/license | `np.savez` metrics/notes | 否 | 否 | **MODIFY** |
| RD-D09 | `load_val_holdout_features` 走 Adapter | offline CLI 与训练同源 | `offline_tone_eval.py` | 否 | 否 | **MODIFY** |
| RD-D10 | 单测：Provider _mock_ + mini 回归 | 防回归 | `test_phase3_contracts` 扩展 | 否 | 否 | **MODIFY** |
| RD-D11 | 修复 `_train_mlp` dataset 常量 | metrics 正确 | L271 | 否 | 否 | **MODIFY** |

**明确不修改（KEEP）：**

- `contract.py` Feature Baseline · `mel.py` · `numpy_p0.py`
- `validate_artifact.py` 门禁逻辑
- `loader.py` Required schema
- Runtime Hop · Recall 决策 · Node E2E 脚本语义

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | 训练主链：`SyllableSample` → `extract_mel_features` → MLP → npz → `validate_artifact` → 部署 → E2E |
| **KEEP** | `split_val_holdout_samples` · `load_val_holdout_features`（P6-A 成果） |
| **KEEP** | `validate_artifact` / `offline_tone_eval` 与数据源解耦能力 |
| **KEEP** | 单 `train_tone_cnn.py` 入口；禁止第二训练链路 |
| **KEEP** | TextGrid 作为**默认** Alignment Provider **实现**（非架构 SSOT） |
| **MODIFY** | 抽出 `DatasetAdapter` · `AlignmentProvider` · `CacheLayout` |
| **MODIFY** | AISHELL-3 全量 / Baker / 企业源各自 Adapter |
| **MODIFY** | Dataset metadata（speakerCount · alignmentProvider · license · source） |
| **MODIFY** | 缓存多版本共存与 manifest 命中 |
| **MODIFY** | `_train_mlp` metrics dataset 常量 bug |
| **RESTORE** | — |
| **DELETE** | `_ensure_dataset` 内 `AISHELL-3` marker 短路（迁 Adapter 后） |
| **DELETE** | 任何「已具备 Adapter 层」文档表述（在 P6-D 完成前） |

---

## 最终问题答复

| # | 问题 | 答案 |
|---|------|------|
| 1 | **当前 Dataset Pipeline 是否已具备长期扩展能力？** | **否。** 具备**可扩展的冻结主链**与**稳定的 `SyllableSample` 中间契约**，但数据接入仍为单体脚本，**不具备** Adapter/Provider 插件化。 |
| 2 | **以后新增 AISHELL-3 是否需要修改 `train_tone_cnn`？** | **当前：需要**（下载格式、缓存 marker、体量工程）。**P6-D 完成后：不应修改训练主链**（`_train_mlp` / `train_and_save` 编排逻辑），仅**新增** `OpenSlrAishell3DatasetAdapter` + 复用 `TextGridPinyinAlignmentProvider`。 |
| 3 | **以后新增 Baker 是否需要修改训练主链？** | **当前：需要**改 `_collect_samples` 或打包布局。**P6-D 完成后：否** — 仅新 `BakerDatasetAdapter`（+ 对齐 Provider）。 |
| 4 | **以后新增企业真实数据是否需要修改 Runtime？** | **否。** 仅需 Training Foundation 侧 Adapter/Provider + metadata；`featureVersion` / Loader / Recall 链不变。 |
| 5 | **是否应把 TextGrid 定义为 Alignment Provider 而非冻结架构？** | **是。** 冻结的是 **音节级 `(wav_path, start, end, t1..t5)` + P0 mel**；TextGrid 是达到该契约的**一种对齐实现**。 |
| 6 | **完成 P6-D 后，是否可仅通过新增 Adapter + Provider 完成所有数据集接入？** | **有条件是。** 凡能提供 **对齐到音节边界 + 五类声调标签** 的数据源，均可插件接入；**不能**承诺「零开发」— 每个新源至少一个 Adapter（及必要时新 Provider），但 **无需再改** Artifact Contract · Validation · Runtime · 训练主链核心。 |

---

## Final Verdict

# **CONDITIONAL PASS**

**通过侧：**

1. **冻结训练主链成立** — 单入口 · 无第二链路 · 无 Runtime 泄漏 · Phase 3 Validation 门禁完整。  
2. **`SyllableSample` 可作为稳定 Dataset Contract 内核** — 与 Runtime `TonePosterior` 五类语义对齐。  
3. **P6-A 已提供 CLI 与 `load_val_holdout_features` 复用点** — P6-D 有明确抽取锚点。  
4. **扩展数据不改变 Runtime** — 与 Phase 1–3、P6-B、P6-C 结论一致。

**条件侧（P6-D 开发阻塞项）：**

1. **TextGrid 写死为唯一对齐路径** — 未 Provider 化。  
2. **Dataset 与 AISHELL/HF 缓存焊死** — 无 Adapter · 无多版本 Cache。  
3. **职责未分离** — Index / Discovery / Alignment / Materialize 均在 `train_tone_cnn.py`。  
4. **Dataset metadata 不足以支撑多源合规追溯** — 须扩展训练侧 optional 字段，**无须**改 Runtime Contract。

**下一步：** 按 Required Development Matrix 实施 **Phase 6-D Dataset Pipeline Foundation**（本轮审计**不执行开发**）；完成后再审计一次，将问题 1 / 6 升级为 **PASS**。

---

## 代码证据索引

| 符号 | 文件 | 行号（约） |
|------|------|-----------|
| `SyllableSample` | `train_tone_cnn.py` | 44–49 |
| `_parse_textgrid_intervals` | `train_tone_cnn.py` | 58–68 |
| `_ensure_dataset` + `AISHELL-3` marker | `train_tone_cnn.py` | 81–108 |
| `_collect_samples` TextGrid only | `train_tone_cnn.py` | 122–144 |
| `split_val_holdout_samples` | `train_tone_cnn.py` | 154–168 |
| `load_val_holdout_features` | `train_tone_cnn.py` | 171–185 |
| `_build_feature_matrix` | `train_tone_cnn.py` | 188–204 |
| `train_and_save` 主链 | `train_tone_cnn.py` | 290–392 |
| CLI `--dataset-repo` | `train_tone_cnn.py` | 399–400 |
| `datasetVersion` optional | `loader.py` | 35, 74–75 |
| Training isolation tests | `test_phase3_contracts.py` | 59–80, 113–126 |

---

**签署：** Phase 6-D Dataset Pipeline Foundation Pre-Development Code Audit · **CONDITIONAL PASS** · 2026-06-29
