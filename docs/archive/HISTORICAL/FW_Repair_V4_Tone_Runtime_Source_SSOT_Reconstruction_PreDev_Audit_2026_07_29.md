<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Tone_Runtime_Source_SSOT_Reconstruction_PreDev_Audit_2026_07_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Tone Runtime Source SSOT Reconstruction Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-29 |
| Stage | **Pre-Development Audit only** — no production/model/Alignment/Recall changes |
| Problem class | **Tone Runtime Source Provenance Lost** |
| Nature | 只读审计 + 静态/现有探针；未改 `loader_v1.py` / `feature_v2.py` 业务语义（本轮未实施重建） |

---

## 1. Executive Summary

当前 Tone Runtime **可以运行**，但 **不能作为可提交 SSOT**：

1. **`feature_v2.py` 不是真实特征实现**，而是加载 `_bytecode_backup/*.pyc` 的 **Recovery shim** → **UNVERIFIED RECONSTRUCTION**。
2. **`loader_v1.py` 有可读源码**，逻辑与 `contract.py` P1/P2 及 freeze candidate artifact **形状兼容且 Fail Closed**；但其来源是 **对话历史 StrReplace 回放重建**，**不在 Git 历史中可证明** → **UNVERIFIED（实现可用，出处不可信）**。
3. **默认生产模型不是冻结 CNN V2**：`config.TONE_MODEL_PATH` / `P1_RUNTIME_ARTIFACT_NAME` 默认指向 **`tone_cnn_p1_v1_full.npz`（Tiny V1）**；加载 freeze candidate **必须 env override**。
4. **训练入口大量仅剩 `.pyc`**（`run_tone_model_v2_production` / `trainer_v2` / `export_v2` 等）→ 训练端 Feature Owner 可名义定位，但 **源码不可审计**。
5. 训练契约（`p1-frame-mel-f0-v1` / `(64,83)`）与 artifact / 推理名义一致 → **SEMANTIC MATCH**；在 feature 源码丢失下 **不能** 判定 EXACT MATCH。

**结论：必须先完成 Tone Runtime Source SSOT 重建并正式提交 Git，才能进入 Alignment Repair。**

---

## 2. Final Verdict

```text
TONE RUNTIME SOURCE SSOT RECONSTRUCTION AUDIT

SOURCE PROVENANCE:
LOST

CURRENT LOADER SOURCE:
UNVERIFIED

CURRENT FEATURE SOURCE:
UNVERIFIED

TRAINING FEATURE OWNER:
feature_v2.extract_feature (nominal; training entry sources mostly .pyc-only)

INFERENCE FEATURE OWNER:
tone_module.feature_v2.extract_feature → _bytecode_backup/feature_v2.cpython-310.pyc

TRAINING ↔ INFERENCE CONSISTENCY:
SEMANTIC MATCH

ARTIFACT CONTRACT:
PARTIAL

PRODUCTION MODEL SSOT:
MULTIPLE

DEFAULT MODEL:
.../tone_module/models/tone_cnn_p1_v1_full.npz

ENV OVERRIDE REQUIRED:
YES

LEGACY MODEL FALLBACK:
ABSENT

MULTIPLE LOADERS:
YES

MULTIPLE FEATURES:
YES

PROBE / SAMPLE PRODUCTION REACHABLE:
NO (not auto-selected; defaults/Tiny/candidate coexist on disk)

UNVERIFIED RECONSTRUCTION:
PRESENT

REPOSITORY SOURCE INTEGRITY:
FAIL

TONE RUNTIME READY TO COMMIT:
NO

TONE RUNTIME RECONSTRUCTION REQUIRED:
YES

ALIGNMENT REPAIR MAY START:
NO

PRIMARY ROOT CAUSE:
SOURCE_PROVENANCE_LOST
```

---

## 3. Audit Scope

| In | Out |
|----|-----|
| Tone Runtime 目录、模型路径、训练/导出链、冻结文档、artifact | 修改 loader/feature |
| Provenance / KEEP-MODIFY-DELETE | 重训、改 Alignment/Recall、恢复 Plain |
| 静态检查 + 只读加载探针 | 新增生产实现 |

---

## 4. Active SSOT Documents

| 文件 | 日期 | 状态 | 约束内容 |
|------|------|------|----------|
| `docs/tone-v2/Tone_Model_V2_CNN_Freeze.md` | 2026-07-13 | **ACTIVE / FROZEN** | `(64,83)`、`p1-frame-mel-f0-v1`、`npz-p1-v1`/`numpy_p1`、P9-B `conv1d_production_v2` + candidate artifact |
| `tone_module/contract.py` | 代码 | **ACTIVE 代码契约** | P1 Feature/Artifact；P2 Production CNN keys/shapes |
| `Tone V2 P8-C — Feature Contract Specification.md` | P8-C | **ACTIVE 数值 Feature 契约** | DSP/Tensor；以 `P1_*` 为准 |
| P8-C Foundation Spec / Addendum | 2026-07 | **ACTIVE 架构规格** | 单 Extractor、WordInfo SSOT |
| P8-C / P9 / P10 Development & Audit Reports | 2026-07 | **HISTORY_ONLY** | 交付证据；部分「Runtime 仍 p0」已过时 |
| `Tone_Project_Final_Freeze_and_SSOT_Acceptance_2026_07_13.md` | 2026-07-13 | **ACTIVE 旁证** | 工程冻结 PASS；文档 SSOT CONDITIONAL |

**优先级：** 冻结文档 + `contract.py` + artifact **高于** 当前未提交源码。源码不能反向定义架构。

---

## 5. Current Source Inventory

| 文件 | 用途 | 生产可达 | 被 import | 唯一入口? | 重复/旧链 | Verdict |
|------|------|----------|-----------|-----------|-----------|---------|
| `feature_v2.py` | **Shim** → pyc `extract_feature` | Yes | `inference.py` | 名义唯一 | 真实逻辑在 backup pyc | **MODIFY**（恢复源码后 DELETE shim） |
| `loader_v1.py` | P1/P2 npz loader | Yes | `classifier.py` | 生产唯一 loader | 与 `loader.py` 并存 | **MODIFY**（provenance + 默认路径） |
| `loader.py` | P0 MLP loader | No（主链） | tests / p0 | 否 | 旧链 | **HISTORY_ONLY / DELETE 生产可达性=0 保持** |
| `inference.py` | `run_tone_inference` | Yes | `api_routes` | Yes | 无 mel | **KEEP** |
| `classifier.py` | ToneClassifier | Yes | inference | Yes | 仅 loader_v1 | **KEEP** |
| `backends/numpy_p1.py` | V1/V2 infer | Yes | classifier | Yes | — | **KEEP** |
| `backends/numpy_p0.py` | P0 | No | p0 | — | 旧 | **HISTORY_ONLY** |
| `models/cnn_p1.py` | Tiny CNN | Yes if Tiny loaded | numpy_p1 | — | 非 freeze | **MODIFY**（不得作默认生产） |
| `models/cnn_production_v2.py` | Freeze arch infer | Yes if V2 loaded | numpy_p1 | — | — | **KEEP** |
| `mel.py` | P0 mel | No 主链 | train_tone_cnn / shard v1 | — | 旧 feature | **HISTORY_ONLY** |
| `contract.py` | SSOT constants | Yes | 全链 | Yes | — | **KEEP** |
| `tone_types.py` | DTO | Yes | inference | Yes | — | **KEEP** |
| `config.py` `TONE_MODEL_PATH` | 默认 Tiny | Yes | loader | Decision Owner 之一 | 与 Freeze 冲突 | **MODIFY** |
| `training/gpu/trainer.py` | 有源 | 训练 | — | — | Tiny 路径 | **HISTORY_ONLY / KEEP 工具** |
| `run_tone_model_v2_production.py` | V2 训练入口 | — | — | — | **仅 pyc** | **RESTORE** |
| `training/gpu/trainer_v2.py` | V2 trainer | — | — | — | **仅 pyc** | **RESTORE** |
| `training/gpu/export_v2.py` | V2 export | — | — | — | **仅 pyc** | **RESTORE** |
| `_bytecode_backup/*` | 孤儿实现 | 经 shim | feature_v2 | — | 临时 | **KEEP 直至恢复；后 DELETE** |
| `_audit_scratch/_recovered_loader_v1.py` | 草稿 | No | — | — | 调查 | **HISTORY_ONLY** |
| `test-tone-fixtures.ts` | Jest fixture | Node tests | tests | — | 路径曾修 | **KEEP**（测试夹具） |
| probe/audit scripts | 离线审计 | No 生产 | — | — | 硬编码 Tiny | **MODIFY/DELETE 生产暗示** |

---

## 6. Source Provenance Status

| 对象 | 创建方 | 何时 | 材料 | Provenance |
|------|------|------|------|------------|
| `loader_v1.py`（当前） | 本会话从 **agent transcript** 回放 Write+StrReplace（止于 P2，排除 P3） | 2026-07-29 | 历史工具调用，非 Git | **UNVERIFIED RECONSTRUCTION** |
| `feature_v2.py` | 本会话写 **bytecode shim** | 2026-07-29 | `_bytecode_backup/feature_v2.cpython-310.pyc` | **UNVERIFIED RECONSTRUCTION** |
| backup pyc | 更早本地编译产物 | ~2026-07-24 | 无 Git | **UNVERIFIED BINARY** |
| `test-tone-fixtures.ts` | 1.1C 开发 + 本会话修 import | 2026-07-28/29 | 测试需要 | 可解释测试夹具 |

**Git：** `loader_v1.py` / `feature_v2.py` **不在 HEAD 可证明历史中作为持续受控源码**（此前即 Provenance Lost；本轮恢复未改变该定性）。

即使：能启动 / posterior 合法 / shape 对齐 → **仍不得标记 VERIFIED。**

---

## 7. loader_v1 Audit

### 7.1 模型选择

| 项 | 事实 |
|----|------|
| 解析顺序 | 显式 `model_path` → **`config.TONE_MODEL_PATH`（含 env）** → 本地 `models/tone_cnn_p1_v1_full.npz` |
| 默认 | **Tiny full**（非 freeze candidate） |
| env override | **是** — 加载 V2 candidate 必须设 `TONE_MODEL_PATH` |
| 多路径磁盘 | full / production Tiny / **candidate V2** / CRNN / p0 / smoke **共存** |
| 自动换模型 | **无**「找不到 V2 就换旧模型」循环 |
| 静默降级 | **无**；加载失败 `ready=False`。但 **默认成功加载错误（非 Freeze）模型** 比 fallback 更危险 |

### 7.2 Artifact Contract 验证

| 验证项 | 有? |
|--------|-----|
| formatVersion / featureVersion / backend | Yes |
| inputShape [64,83] / outputShape [5] | Yes |
| modelArchitecture ∈ {Tiny V1, production V2} | Yes |
| P0 keys 拒绝 | Yes |
| P1/P2 weight keys + shapes | Yes |
| feature_mean/std shape | Yes |
| model hash 写入 metadata | Yes（load 时算 SHA256） |
| Tone class **语义顺序** 文档校验 | **No**（仅维数=5） |
| feature version ↔ 训练脚本绑定证明 | **No** |
| 强制 architecture == freeze production_v2 | **No**（Tiny 合法） |

缺失 → 标记 **ARTIFACT CONTRACT 使用侧 PARTIAL**（artifact 自身 metadata 较全，见 §13）。

### 7.3 加载行为

| 条件 | 行为 |
|------|------|
| 文件不存在 | Fail Closed `model_not_found` |
| metadata/shape/version 不匹配 | Fail Closed；`ready=False`；warning 日志 |
| 成功 | ready=true |

### 7.4 多后端

| 后端 | 角色 |
|------|------|
| numpy_p1 | **生产推理** |
| torch（training/gpu） | **训练工具**（源码部分缺失） |
| numpy_p0 / loader.py | **历史** |
| ONNX | 非 Tone CNN 主链 |

生产加载入口：**单一** `get_tone_loader_v1`（但磁盘多 artifact）。

---

## 8. feature_v2 Audit

### 当前文件形态

```text
feature_v2.py = Recovery shim
→ exec _bytecode_backup/feature_v2.cpython-310.pyc
→ re-export extract_feature
```

`extract_feature.__module__ == tone_module._feature_v2_bytecode`  
`inspect.getsource` **不可用** → 无法做行级源码审计。

### 从 bytecode / contract 推断的数据契约（名义）

```text
Input:
- waveform: np.ndarray (processed_audio, float)
- sample_rate: int (contract 16000)
- word_info: WordInfo with start/end (sec)
- expected: slice via word timestamps; short slice skipped upstream

Output:
- shape: (64, 83) float32
- channels: 80 log-mel + log_f0 + delta_log_f0 + voiced
- featureVersion: p1-frame-mel-f0-v1
- normalization of frames: duration_normalized_linear_interp + center crop
- model-side z-score: artifact feature_mean/std (83,)
```

**不能**仅凭函数名认定与训练字节级一致。

---

## 9–11. Training / Validation / Inference Feature Owners

| Role | Owner | 磁盘状态 |
|------|-------|----------|
| Training Feature | `feature_v2.extract_feature`（文档/pyc 链路）；cache `training_features_v2` | Extractor **shim/pyc**；shard/train entry **多仅 pyc** |
| Validation Feature | 同 cache holdout（artifact metrics） | 同左 |
| Inference Feature | `inference.run_tone_inference` → `extract_feature` | shim |
| Artifact Export | `save_artifact_v2` / `export_v2`（pyc） | **源码缺失** |

冻结目标：一个正式 Feature Contract + 一个可提交实现；禁止无法验证的多副本。

---

## 12. Training/Inference Consistency Matrix

| 项目 | 训练端（Freeze + artifact） | 当前推理端 | 一致性 | 证据 |
|------|-----------------------------|------------|--------|------|
| featureVersion | `p1-frame-mel-f0-v1` | 同（contract + loader 校验） | SEMANTIC | contract + npz |
| shape | `(64,83)` | 实测/契约同 | SEMANTIC | contract + load |
| sample_rate | 16000 | P1_SAMPLE_RATE | SEMANTIC | contract |
| mel/f0 参数 | P1_* | bytecode 引用 `P1_FEATURE_BASELINE` | SEMANTIC | co_names |
| channel 顺序 | 80+3 | 契约同 | SEMANTIC | Freeze/P8-C |
| dtype | float32 | float32 | SEMANTIC | loader astype |
| model norm | feature_mean/std (83,) | cnn_production_v2 z-score | SEMANTIC | npz + cnn_v2 |
| Extractor 源码同一性 | 训练时 `.py` | shim←pyc | **UNVERIFIED 行级** | provenance |
| 默认权重 | candidate V2（文档） | **Tiny full** | **MISMATCH（部署）** | config.py |
| 训练入口可复现 | 文档命令 | `.py` 缺失 | **UNVERIFIED** | glob |

**总判：SEMANTIC MATCH**（契约/artifact/名义 API）**≠ EXACT MATCH**（源码 provenance）。

---

## 13. Artifact Contract Audit

**Path:** `tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz`  
**Size:** 1,274,461 · **SHA256:** `aade7b531049204fd7e8601944b3a3429bd3ec16015c550e2c6b3fd27b368723`

| Metadata | Value |
|----------|-------|
| formatVersion | npz-p1-v1 |
| featureVersion | p1-frame-mel-f0-v1 |
| backend | numpy_p1 |
| modelArchitecture | conv1d_production_v2 |
| inputShape / outputShape | [64,83] / [5] |
| trainingVersion | production_cnn_v2_candidate_20260712 |
| conv1_w | (96, 83, 5) |
| fc_w | (96, 5) |
| P2_REQUIRED_WEIGHT_KEYS missing | **[]** |

| 缺口 | 说明 |
|------|------|
| Tone class 语义标签顺序 | 仅维数 5，无显式 t1…t5 文档字段 |
| 与默认 Runtime 路径绑定 | artifact 未强制为唯一默认 |
| 文档 trainingBackend 字符串 | Freeze 与 metrics 可能漂移 |

→ **ARTIFACT CONTRACT: PARTIAL**（权重+核心 metadata 全；部署 SSOT / class 语义 / 默认绑定不全）

---

## 14. Model Path Resolution

```text
Env TONE_MODEL_PATH (if file exists)
  → else config default = .../models/tone_cnn_p1_v1_full.npz (if exists)
  → else None → model_not_found
```

| Question | Answer |
|----------|--------|
| Decision Owner | **config.TONE_MODEL_PATH + loader_v1._resolve_model_path** |
| 多路径源 | Env + hardcoded default + 磁盘多文件 |
| 不同环境不同模型 | **极易**（未设 env → Tiny） |
| 启动打印 hash/arch/feature | metadata 有；**未强制默认 Freeze** |

冻结目标未满足：**唯一默认生产模型 = freeze candidate**。

---

## 15. Runtime Import Graph

```text
api_routes.process_utterance
  → inference.run_tone_inference
      → feature_v2.extract_feature   [SHIM → pyc]
      → classifier.get_tone_classifier
          → loader_v1.get_tone_loader_v1
              → npz (default Tiny OR env candidate)
          → numpy_p1.infer_batch
              → cnn_p1 | cnn_production_v2
```

P0 `loader.py` / `mel.py`：**不在**该图。

---

## 16–17. Multi-Loader / Multi-Feature

| | 事实 |
|--|------|
| Multiple loaders | **YES** — `loader_v1`（生产）+ `loader`（P0/历史） |
| Multiple features | **YES** — `feature_v2`（生产名义）+ `mel`（P0/旧 shard） |
| 生产双入口推理 | **NO** — 推理仅 feature_v2 + loader_v1 |
| 风险 | 默认 Tiny + 孤儿 pyc feature = **SSOT 分裂** |

---

## 18. Legacy / Probe / Sample Residual

| Symbol | File | 生产可达 | Verdict |
|--------|------|----------|---------|
| `tone_cnn_p1_v1_full` | models/ + config default | **Yes（默认）** | **MODIFY** 移出默认 / DELETE 作生产默认 |
| `tone_cnn_production_v2_candidate` | models/candidate/ | 仅 env | **KEEP** 作为唯一生产目标 |
| `tone_cnn_p1_v1_production_*` | models/production/ | 可选 | **DELETE or HISTORY** 生产选择 |
| p0 / smoke / crnn | models/ | 非自动 | **HISTORY_ONLY** |
| probe scripts 硬编码 full | scripts/ | No | **MODIFY** 文档勿暗示生产 |
| Recovery shim | feature_v2.py | Yes | **DELETE after RESTORE** |
| `_bytecode_backup` | tone_module/ | via shim | **DELETE after RESTORE** |

**LEGACY MODEL FALLBACK（自动换模型）：ABSENT**  
**PROBE/SAMPLE 自动进入生产：NO**（但 Tiny 默认 ≈ 错误生产基线）

---

## 19. Current Runtime Verification

| Check | Result |
|-------|--------|
| 正确加载 freeze candidate（env） | PASS（既有实测） |
| 默认加载 | PASS 但加载 **Tiny**（错误 SSOT） |
| 缺文件 Fail Closed | 代码路径存在 |
| shape/version mismatch Fail Closed | 代码路径存在 |
| 专项负例测试完备性 | **缺口** — 未在本轮扩展测试 |
| 真实音频可执行 | PASS（Full-Chain 报告）≠ 语义 EXACT |

---

## 20. Unverified Reconstruction

**PRESENT**

- `loader_v1.py`：transcript 回放  
- `feature_v2.py`：pyc shim  
- 训练 V2 入口：仅 pyc  

---

## 21. Root Cause

**PRIMARY: SOURCE_PROVENANCE_LOST**

并列加剧因素：

- `MODEL_PATH_NOT_UNIFIED`（默认 Tiny ≠ Freeze V2）  
- 训练/导出源码缺失 → 无法关闭 EXACT MATCH  
- LEGACY 残留磁盘模型 + P0 loader/mel 并存（非自动 fallback，但是认知与误配风险）

---

## 22–26. SSOT Reconstruction Architecture（方案，不实施）

### 建议唯一结构

```text
tone_module/
  contract.py                 # KEEP — 唯一数值契约
  feature/
    feature_v2.py             # RESTORE 可读唯一实现（与训练同一模块）
  loader/
    loader_v2.py              # 或重整 loader_v1：仅允许 production_v2
  inference.py
  backends/numpy_p1.py
  models/cnn_production_v2.py
  models/production/
    tone_cnn_production_v2_<frozen>.npz   # 唯一默认
  diagnostics/
```

### Ownership

| Role | Owner |
|------|-------|
| Feature Contract | `contract.py` + Feature Spec doc |
| Feature Implementation | 唯一 `feature_v2.py` 源码 |
| Model Artifact | Freeze doc + production/ 目录 |
| Model Loader | 唯一 loader；默认 = production freeze |
| Inference | `inference.py` |
| Runtime Config | `TONE_MODEL_PATH` 仅测试 override；生产默认写死 freeze |
| Diagnostics | 启动强制 path/hash/arch/featureVersion |

### 删除原则（未上线）

无历史兼容、无旧模型 fallback、无 shadow、无双入口、无自动探测多模型。

---

## 27. KEEP

- `Tone_Model_V2_CNN_Freeze.md` + `contract.py` + P8-C Feature Spec  
- `inference.py` / `classifier.py` / `numpy_p1.py` / `cnn_production_v2.py` / `tone_types.py`  
- freeze candidate npz（内容）  
- Fail Closed 加载语义（概念）  
- 测试禁止 import mel/loader p0 的主线断言  

## 28. MODIFY

- 默认模型路径 → **唯一 freeze production**  
- `loader_v1`：强制/默认 architecture=`conv1d_production_v2`；启动日志 path/hash/arch/feature  
- Artifact / Freeze 文档 metadata 漂移对齐  
- probe/scripts 硬编码 Tiny  
- 文档标明 P10「仍 p0」等 **SUPERSEDED**  

## 29. DELETE

- `feature_v2.py` Recovery shim（源码恢复后）  
- `_bytecode_backup`（验证后）  
- 生产默认对 Tiny full 的依赖  
- 任何「自动选多个 candidate」逻辑（若后续误加）  
- 无法解释的恢复草稿作为生产 SSOT（`_recovered_loader_v1.py` 勿提交为权威）  

## 30. RESTORE（依冻结文档重新实现/恢复可读源，非 git checkout 迷信）

- 可读 `feature_v2.py`（与训练同一实现）  
- `run_tone_model_v2_production.py` / `trainer_v2.py` / `export_v2.py` / feature_shard_v2 等训练链源码  
- 经 decompile+契约测试锁定的 loader 正式版并 **Git 提交**  

## 31. VERIFY

- bytecode feature **逐算子** 是否与 P8-C 数值契约一致（golden vector）  
- 训练 cache 是否仍可复现  
- Tone class 顺序与标签定义  
- Tiny vs V2 在同一音频上的 posterior 差异（证明默认错误的业务影响）  
- `loader_v1` transcript 重建与 backup pyc 行为等价性  

---

## 32. Blocking Issues

1. Feature / Loader **Provenance Lost** → 不可提交。  
2. Feature 仅为 shim → 不可审计。  
3. 默认模型 ≠ Freeze V2。  
4. 训练入口源码缺失 → 无法关闭训练/推理 EXACT。  
5. **Alignment Repair 不得开始**（依赖可信 Tone Runtime SSOT）。

## 33. Non-Blocking Issues

1. P0 loader/mel 仍在树中（主链未引用）。  
2. CRNN/smoke 磁盘残留。  
3. Freeze 文档 trainingBackend 字符串漂移。  

---

## 34. Target List（后续正式开发）

```text
[ ] 依 Contract 重建唯一可读 feature_v2
[ ] 依 Contract 固化唯一 loader（默认 freeze V2）
[ ] 统一训练/验证/推理 Feature
[ ] 固定唯一 production model 路径
[ ] 删除 shim / 旧默认 / 误导 probe
[ ] artifact metadata + hash 启动日志
[ ] 训练/推理一致性黄金测试
[ ] 正式 Git commit + tag/freeze
[ ] 再进入 Alignment Repair
```

---

## 35. Check List

```text
[x] 当前源码不是反向定义 SSOT
[x] 已找到训练端真实 Feature 定义（名义 + pyc；源码缺口已标）
[x] 已比较训练/验证/推理 Feature
[x] 已核对模型 artifact tensor shape
[x] 已核对 Tone class 维数（语义顺序 VERIFY）
[x] 已核对 feature version
[x] 已审计默认模型路径
[x] 已审计 env override
[x] 已审计旧模型 fallback（无自动换模；有错误默认）
[x] 已审计多 loader / 多 feature
[x] 已审计恢复源码来源
[x] 已标记 UNVERIFIED SOURCE
[x] 已输出 KEEP/MODIFY/DELETE/RESTORE/VERIFY
[x] 未修改生产 Decision / 未改模型 / 未恢复 Plain / 未新增兼容链
```

---

## 36. Final Decision — Answers §19

1. loader 可信？→ **实现可运行，出处 UNVERIFIED → 不可作 SSOT**  
2. feature 可信？→ **否（shim/pyc）**  
3. 与 CNN V2 训练特征完全一致？→ **仅能称 SEMANTIC MATCH，非 EXACT**  
4. 差异？→ 源码不可比；**默认权重 Tiny≠V2**；训练入口不可复现审计  
5. artifact metadata 足够？→ **PARTIAL**（核心全，语义/默认绑定不足）  
6. 默认启动加载冻结生产模型？→ **否**  
7. 依赖 env override？→ **是（要加载 V2）**  
8. 旧模型自动 fallback？→ **无自动换模；有错误默认成功**  
9. 多个 loader？→ **是（P0+P1）**  
10. 多个 feature？→ **是（mel+feature_v2）**  
11. probe/sample 进生产？→ **不自动；Tiny 默认是生产风险**  
12. 必须删除？→ shim、错误默认、恢复后的 backup、非权威草稿  
13. 必须重建？→ 可读 feature、正式 loader+默认路径、训练入口源码  
14. 可直接提交？→ **否**  
15. 必须先重建再提交？→ **是**  
16. 可进 Alignment Repair？→ **否**

---

## Final Block（mandatory）

```text
TONE RUNTIME SOURCE SSOT RECONSTRUCTION AUDIT

SOURCE PROVENANCE:
LOST

CURRENT LOADER SOURCE:
UNVERIFIED

CURRENT FEATURE SOURCE:
UNVERIFIED

TRAINING FEATURE OWNER:
feature_v2.extract_feature (nominal; training scripts mostly pyc-only)

INFERENCE FEATURE OWNER:
tone_module.feature_v2.extract_feature → _bytecode_backup/feature_v2.cpython-310.pyc

TRAINING ↔ INFERENCE CONSISTENCY:
SEMANTIC MATCH

ARTIFACT CONTRACT:
PARTIAL

PRODUCTION MODEL SSOT:
MULTIPLE

DEFAULT MODEL:
D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\tone_cnn_p1_v1_full.npz

ENV OVERRIDE REQUIRED:
YES

LEGACY MODEL FALLBACK:
ABSENT

MULTIPLE LOADERS:
YES

MULTIPLE FEATURES:
YES

PROBE / SAMPLE PRODUCTION REACHABLE:
NO

UNVERIFIED RECONSTRUCTION:
PRESENT

REPOSITORY SOURCE INTEGRITY:
FAIL

TONE RUNTIME READY TO COMMIT:
NO

TONE RUNTIME RECONSTRUCTION REQUIRED:
YES

ALIGNMENT REPAIR MAY START:
NO

PRIMARY ROOT CAUSE:
SOURCE_PROVENANCE_LOST
```
