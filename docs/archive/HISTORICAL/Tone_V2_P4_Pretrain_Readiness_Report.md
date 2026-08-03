<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_P4_Pretrain_Readiness_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 4 — Pretrain Readiness Report

**Date:** 2026-06-29  
**Type:** 训练前核对（只读审计 · 无代码 / Runtime 修改）  
**目标:** 确认 Phase 3 Training Foundation 是否可直接执行 **`tone_cnn_p1`** 训练  
**依据:** Phase 3 Foundation Freeze · `train_tone_cnn.py` · `validate_artifact.py` · `offline_tone_eval.py` · `contract.py`

---

## Final Verdict

# **CONDITIONAL PASS**

Phase 3 训练管线 **可立即执行训练**（同 P0 架构 · 同 Feature Baseline · 同 `numpy_p0` adapter），但 **`modelVersion` / `trainingVersion` 元数据尚未对齐 P4 `tone_cnn_p1` 命名约定**。这不阻塞离线训练与 artifact 验收，建议在 **开训前** 通过 CLI 参数或一次性训练脚本小改完成元数据对齐（**不触及 Runtime / Contract / Feature Baseline**）。

---

## 核对清单

### 1. `train_tone_cnn.py` 是否引用 `contract.py` P0 Feature SSOT

| 检查项 | 结果 | 证据 |
|--------|------|------|
| import `contract` | **PASS** | L33–34 |
| `P0_MIN_SLICE_SEC` 切片门限 | **PASS** | L133 |
| `P0_N_MELS` / `P0_HIDDEN` / `P0_N_CLASSES` 网络维度 | **PASS** | L180–183 |
| `P0_FEATURE_VERSION` / `P0_BACKEND` artifact 写入 | **PASS** | L306–307 |
| 特征提取 `extract_mel_features`（与 Runtime 同源） | **PASS** | L32, L162 |
| 无硬编码 `HIDDEN=32` / `N_MELS=80` | **PASS** | 源码扫描 |

**结论:** **PASS**

---

### 2. `validate_artifact.py` 是否可用

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 模块可 import | **PASS** | `imports_ok` |
| Schema → Shape → Loader → `infer_batch` 链路 | **PASS** | 源码 L100–138 |
| `train_and_save` 保存后强制调用 | **PASS** | L318–327；失败 `RuntimeError` |
| 单元测试 | **PASS** | `test_phase3_contracts` 16/16（含 loader） |

**结论:** **PASS**

---

### 3. `offline_tone_eval.py` 是否可用

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 模块可 import | **PASS** | `imports_ok` |
| `train_and_save` 训练后调用 | **PASS** | L329–348 |
| 仅 `infer_batch`；无 Decision import | **PASS** | 源码审计 |
| Isolation 测试 | **PASS** | `OfflineEvaluationIsolationTest` |

**结论:** **PASS**

---

### 4. 当前训练数据来源是否可访问

| 项 | 值 |
|----|-----|
| 数据源 | HuggingFace `CS5647Team3/data_mini`（AISHELL-3 wav + TextGrid） |
| 本地缓存 | `tone_module/_data_cache/` |
| 探测结果（2026-06-29） | `AISHELL-3` marker **存在**；**11,820** 音节样本可收集 |
| 最低样本门限 | `len(samples) >= 100`（L263–264） |

**结论:** **PASS**（网络与缓存可用；本轮探测已成功拉取/解压）

---

### 5. 训练输出 Artifact 元数据写入核对

| 字段 | P4 期望 | 当前 `train_tone_cnn.py` 实际写入 | 匹配 |
|------|---------|-----------------------------------|------|
| `featureVersion` | `p0-v1` | `contract.P0_FEATURE_VERSION` → **`p0-v1`** | **✓** |
| `modelVersion` | **`tone_cnn_p1`** | 硬编码 **`tone_cnn_p1`** 否 → **`tone_cnn_p0`**（L309） | **✗** |
| `trainingVersion` | **当前日期** | 硬编码 **`train_tone_cnn`**（L310）；日期在 **`buildTime`** ISO 字段 | **✗** |
| `backend` | `numpy_p0` | `contract.P0_BACKEND` → **`numpy_p0`** | **✓** |
| `formatVersion` | `npz-v1` | **`npz-v1`** | **✓** |
| `buildTime` | （未列但存在） | UTC ISO 时间戳 | ✓ |
| `datasetVersion` | （可选） | `CS5647Team3/data_mini` | ✓ |

**说明:**

- 使用 `--output models/tone_cnn_p1.npz` **可**将文件命名为 p1，但 **npz 内 `modelVersion` 仍为 `tone_cnn_p0`**。
- `trainingVersion` 语义与 P4 期望（日期标识）不一致；**`buildTime` 已记录训练时刻**。

**结论:** **CONDITIONAL** — 4/6 关键字段对齐；**`modelVersion` / `trainingVersion` 需在开训前对齐**（训练脚本 CLI 扩展，属 Phase 4 Model Quality 范围，**非 Runtime 变更**）。

---

### 6. 训练产物是否符合 Loader / Posterior 契约

| 契约项 | 期望 | 当前训练输出 | 匹配 |
|--------|------|-------------|------|
| `w1` | `(80, 32)` | `contract.P0_N_MELS × P0_HIDDEN` | **✓** |
| `b1` | `(32,)` | **✓** |
| `w2` | `(32, 5)` | `P0_HIDDEN × P0_N_CLASSES` | **✓** |
| `b2` | `(5,)` | **✓** |
| `mel_mean` / `mel_std` | `(80,)` optional | **✓** |
| Posterior 维数 | **5 类** softmax | `infer_batch` → `(N, 5)` | **✓** |
| `validate_artifact` 门禁 | 必经 | 训练结束强制 | **✓** |

**结论:** **PASS** — 与冻结 P0 架构及 `TonePosterior` 五类输出 **完全兼容**；p1 为 **同结构权重升级**，非新 adapter。

---

### 7. Runtime / Decision 修改风险

| 风险项 | 结果 |
|--------|------|
| `train_tone_cnn` import Recall / Ranking / Assembly / KenLM | **无** |
| `train_tone_cnn` import `inference` / `classifier` / `get_tone_loader` | **无** |
| `validate_artifact` / `offline_tone_eval` 进入 Decision | **无** |
| 训练修改 `contract.py` Feature Baseline | **本轮无修改** |
| 训练自动热加载 / 切换 Runtime 权重 | **无**（部署须 `TONE_MODEL_PATH` + 重启 FW） |
| 训练写 `validationResult` 入 Artifact | **无** |

**结论:** **PASS** — **零 Runtime / Decision 风险**。

---

## 差距汇总（CONDITIONAL 原因）

| ID | Expected | Actual | Impact | Severity | 开训前处理 |
|----|----------|--------|--------|----------|-----------|
| P4-META-01 | `modelVersion=tone_cnn_p1` | 硬编码 `tone_cnn_p0` | 运维/追溯混淆 | LOW | 增加 `--model-version` 或 Phase 4 训练前小改 |
| P4-META-02 | `trainingVersion=<date>` | `trainingVersion=train_tone_cnn` | 版本语义不符 P4 约定 | LOW | 改为日期或复用 `buildTime` 语义说明 |
| P4-OUT-01 | 默认输出 `tone_cnn_p1.npz` | 默认 `tone_cnn_p0.npz` | 易误覆盖 p0 | MED | 开训时 **必须** `--output` 显式指定 |

**不影响:** Feature SSOT · Loader · `numpy_p0` · 5 类 posterior · Validation 门禁。

---

## 回归证据

```text
python -m unittest tone_module.test_phase3_contracts tone_module.test_loader -q
→ 16 tests OK

Dataset probe:
→ sample_count=11820, AISHELL-3 marker=True
```

---

## 下一步（CONDITIONAL PASS 下可执行训练）

在 **不修改 Runtime** 前提下，可 **立即** 执行同架构 p1 权重训练：

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad

python -m tone_module.train_tone_cnn ^
  --output tone_module/models/tone_cnn_p1.npz ^
  --epochs 80 ^
  --batch-size 128 ^
  --lr 0.05 ^
  --val-ratio 0.15 ^
  --seed 42
```

**训练完成后自动执行:**

1. `validate_artifact`（Schema / Loader / `infer_batch` Acceptance）  
2. `offline_tone_eval`（val 集 posterior 质量日志）

**部署（运维 · 非本轮训练步骤）:**

1. 设置 `TONE_MODEL_PATH` → `tone_cnn_p1.npz`  
2. **重启** FW Worker（禁止热切换）  
3. Node E2E Runtime Validation（验证 Runtime 未回归 · 非模型质量唯一依据）

**开训前建议（提升至 FULL PASS）:**

1. 为 `train_tone_cnn.py` 增加 `--model-version tone_cnn_p1` 与 `--training-version <YYYY-MM-DD>`（**Phase 4 首个训练 PR**，不改 Runtime）  
2. 或接受当前 metadata：`modelVersion=tone_cnn_p0` + `buildTime` 作追溯，在 Runbook 注明 p1 文件路径与 p0 元数据差异

---

## 最终问题答复

| 问题 | 答案 |
|------|------|
| Phase 3 Foundation 能否直接训练？ | **能**（CONDITIONAL：元数据命名需对齐） |
| 是否可开训 `tone_cnn_p1`？ | **是** — 使用 `--output tone_module/models/tone_cnn_p1.npz` |
| 是否会改动 Runtime？ | **否** |
| 产物是否兼容现有 Loader + adapter？ | **是**（同 P0 结构 · `featureVersion=p0-v1`） |

---

**签署:** Pretrain Readiness · **CONDITIONAL PASS** · 2026-06-29
