# Tone V2 — Contract Freeze（SSOT）

**状态：** FROZEN  
**Phase 1：** CLOSED（2026-06-29）  
**Phase 2 Foundation：** CLOSED / FROZEN（2026-06-29）  
**冻结审计：** [Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md) · [Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md)  
**架构详述：** [docs/tone-module/ARCHITECTURE.md](../tone-module/ARCHITECTURE.md)  
**文档索引：** [docs/tone-v2/README.md](./README.md)  
**运维：** [Tone_V2_Phase2_Deployment_Runbook.md](./Tone_V2_Phase2_Deployment_Runbook.md)  
**术语 SSOT：** [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md) · [TONE_V2_DOCUMENTATION_STYLE_GUIDE.md](./TONE_V2_DOCUMENTATION_STYLE_GUIDE.md)

> **后续模型能力开发** 仅可依据本文档 + `ARCHITECTURE.md` + Runbook + **TERMINOLOGY**。修改 Runtime · Required Schema · Decision Ownership · Service Boundary 须重新走冻结流程。

---

## 0. 验收术语（四级体系 · 冻结）

完整定义见 [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)。**不得**使用 Smoke / Deployment Smoke 作为验收类型名。

| Level | 名称 | 范围 |
|-------|------|------|
| 1 | Unit Test | 模块 · Contract · Parser |
| 2 | Dataset Probe | Adapter · Alignment · manifest · join · Fixture Test |
| 3 | Runtime Validation | `TONE_MODEL_PATH` → FW Restart → Node E2E |
| 4 | Architecture Verification | Frozen Architecture · Drift |

**Dataset Probe 不得替代 Runtime Validation。**

---

## 1. Runtime 主链（Effective · 冻结）

```text
FW Worker → run_tone_inference → UtteranceResponse.tone
→ ASRResult.tone → ctx.acousticToneSlices
→ Recall → Ranking → Assembly → KenLM → Apply
```

**Effective 止于 Recall / Ranking。** KenLM 与 Apply **intentionally tone-free**。

**禁止：** Node Pipeline 独立声学 Tone Step · 第二 HTTP tone 出口 · Assembly Tone Guard · KenLM tone 参数 · **Historical Issue（已关闭）：** Shadow / Offline / Bootstrap / Compatibility Runtime 替代主链。

---

## 2. Required Data Contract（不可 breaking change）

| 结构 | 字段 |
|------|------|
| `TonePosterior` | `{ t1, t2, t3, t4, t5 }` |
| `AcousticToneSlice` | `{ start, end, tonePosterior, confidence }` |
| `UtteranceAcousticTonePayload` | `{ toneEnabled, acousticToneSlices, sliceCount, toneConfidenceAvg?, skippedReason? }` |

### HTTP `skippedReason`（Utterance 级，四值）

```text
no_audio | no_timestamps | non_zh | model_error
```

### `toneReason`（Window Candidate 级，Recall 打分 SSOT）

```text
match | mismatch | no_pattern
```

**不是** `toneReason`：`tone_exact` · `plain_fallback` · `plain_only_no_pattern`（属 `toneLookupStage` / SQL 观测）。

---

## 3. Feature Baseline（P0 · SSOT）

```text
featureVersion = p0-v1
sampleRate     = 16000
nMels          = 80
nFft           = 512
hopLength      = 160
fMin           = 50
fMax           = 7600
minSliceSec    = 0.02
```

**唯一 Feature Baseline SSOT：** `tone_module/contract.py`（`P0_*` · `ToneFeatureBaseline`）。

**引用方（不得硬编码重复 baseline）：**

- `tone_module/mel.py` — Mel 提取；常量自 `contract.py` 导入  
- `tone_module/inference.py` — `MIN_SLICE_SEC` ← `P0_MIN_SLICE_SEC`

非 16kHz 输入：Runtime 防御性 resample，**不** bump `featureVersion`。

npz 缺 `featureVersion`：解释为 `p0-v1`，diagnostics 可选 `metadataWarning=featureVersion_missing`。

**Legacy 兼容（冻结至全量 artifact 迁移后另走再冻结）：**

```text
P0_COMPATIBLE_FEATURE_VERSIONS = { p0-v1, mel_mean_80_v1 }
```

---

## 4. Single Service / Single Model（Phase 2 Foundation · 冻结）

```text
One service instance
→ One model artifact
→ One backend adapter
→ One featureVersion
→ One TonePosterior output
```

| 约束 | 说明 |
|------|------|
| 服务实例 | 当前：`faster-whisper-vad`（`FW_ASR_SERVICE_ID`） |
| 模型路径 | `TONE_MODEL_PATH` 或 Loader 默认 `tone_cnn_p0.npz`（**代码默认未改**）；进程启动前确定 |
| **Canonical 模型** | **`tone_cnn_p1`**（Phase 4 Model Freeze）；生产部署须 `TONE_MODEL_PATH` 指向该 artifact |
| **Candidate 模型** | `tone_cnn_p2` · `tone_cnn_p3` 等同 schema 权重；须 validate → offline → E2E → Model Freeze 后方可切换 |
| 路径变更 | **必须重启** FW Worker；禁止热切换 |
| 新模型接入 | **新服务实例** + 独立 port/env/`TONE_MODEL_PATH` + 独立 adapter 文件 + Node 新 endpoint |

**禁止（冻结）：** Model Registry · Backend Registry · Model Switching · Backend Switching · Hot Reload · Runtime Routing · Multi-Model · Multi-Backend Dispatch · `TONE_MODEL_ID` · active model · 同一 Worker 内多模型或按请求选模型。

---

## 5. Backend Adapter（Phase 2 Foundation · 冻结）

**实现：** `tone_module/backends/numpy_p0.py` — `infer_batch(mel_batch, weights) → ndarray[N,5]`。

**数据流：**

```text
Audio Slice → inference.py → mel.py → mel_batch → numpy_p0 → TonePosterior
```

| 负责 | 不负责 |
|------|--------|
| 权重推理 · Posterior 输出 | Feature Extraction（`mel.py`） |
| | Recall · Ranking · Assembly · KenLM · Apply |
| | Runtime Routing · Metadata Decision · HTTP/Node Schema |

**禁止：** `get_backend(name)` · backend registry · routing table · runtime backend selection。

**编排：** `tone_module/classifier.py` 经 Loader 取权重并委托 adapter；**非** registry。

---

## 6. Loader / Fail-Closed（冻结）

| 路径 | 职责 |
|------|------|
| `tone_module/contract.py` | Metadata · Feature baseline · 校验 |
| `tone_module/loader.py` | load / unload / ready / metadata |
| `tone_module/classifier.py` | 编排 Loader + adapter |
| `tone_module/inference.py` | 切片 · Mel · 调用 classifier |

### 生产 Runtime（冻结）

```text
get_tone_loader() → load(None) → TONE_MODEL_PATH | default npz
```

**禁止进入生产主链：** `load(path)` · runtime reload · runtime switching · bootstrap · compatibility loader · silent upgrade · 保留旧模型 ready=true · mock weights。

**仅测试允许：** `ToneModelLoader.load(path)` · `ToneClassifier(model_path=...)` · `reset_tone_loader_singleton` · `reset_tone_classifier_singleton`。

Load 失败（missing · corrupt · invalid · shape mismatch · feature mismatch · unsupported adapter）：

```text
ready=false → toneEnabled=false → skippedReason=model_error
```

失败时 `diagnostics.toneModule.loadError` 可选；**不得**进入 Recall / Ranking Decision。

---

## 7. Artifact Contract（冻结）

**单 artifact：** 每 FW 进程绑定一个 `.npz`。

| metadata 字段 | 用途 |
|---------------|------|
| `formatVersion` | optional · diagnostics |
| `backend` | `numpy_p0` · diagnostics |
| `featureVersion` | Loader 校验（兼容集见 §3） |
| `modelVersion` | optional · diagnostics |
| `modelHash` | optional · diagnostics |
| `trainingVersion` · `datasetVersion` · `buildTime` · `notes` | optional · diagnostics |
| `artifactPath` · `loadMs` | optional · diagnostics（加载后填充） |

**metadata 不得进入：** Recall · Ranking · Assembly · KenLM · Apply · Required HTTP/Node schema。

---

## 8. Optional Diagnostics（不进 Decision · 冻结）

**FW HTTP：** `diagnostics.toneModule`  
**Node FW 路径：** `spanAssemblyV4.tone`（Recall 观测；非第二决策）

```text
backend · backendAdapter · featureVersion · modelVersion · modelHash · formatVersion
trainingVersion · datasetVersion · buildTime · notes
artifactPath · loadMs · loadError · metadataWarning
tone_inference_ms · toneSliceCount · toneEnabled · toneConfidenceAvg · skippedReason
```

Diagnostics **仅观测**；不得参与 `tonePenalty` · `candidateScore` · Recall SQL · Ranking · Assembly · KenLM · Apply。

---

## 9. Tone Effective vs Not Effective

| 位置 | Tone |
|------|------|
| Recall `computeToneScoreResult` · `tonePenalty` | **Effective** |
| Ranking 分数排序 | **Effective**（间接，via Recall score） |
| Assembly `selectPerSpanCandidates` | **Not Effective** |
| KenLM · Apply | **Not Effective** |

配置：`toneTimestampOnlyEnabled=false` → Recall 不提取 acoustic pattern → 无 tone penalty。

---

## 10. Ownership Contract（冻结）

| 模块 | Owner | 职责 |
|------|-------|------|
| **Tone** | FW `tone_module` | Posterior Provider |
| **Recall** | `recall-topk-for-windows` · `tone-recall-sort` | **Tone Decision** |
| **Ranking** | sentence combination | Sentence Ranking |
| **Assembly** | `assemble-domain-aware-span-sets` | Tone Free |
| **KenLM** | sentence rerank | Tone Free |
| **Apply** | `apply-span-replacements` | Tone Free |

**禁止：** Hidden Owner · Decision Override · Decision Transfer · Metadata/Diagnostics Decision · 第二 Tone Decision 层。

---

## 11. 已 DELETE（不得恢复）

- `apply-tone-assembly-guard.ts`
- orphan `filter-domain-candidates-per-span.ts`
- `UtteranceTonePayload` / `UtteranceTonePayloadModel` 别名
- `toneGuardBlockedCount` diagnostics
- Model Registry / Backend Registry / Switching 路线（文档见 `archive/deprecated/`）

---

## 12. Regression Gate（冻结后必跑）

| 门禁 | 命令 / 路径 |
|------|-------------|
| Loader contract | `python -m unittest tone_module.test_loader` |
| Classifier fail-closed | `python -m unittest tone_module.test_classifier_fail_closed` |
| Phase 2 contracts | `python -m unittest tone_module.test_phase2_contracts` |
| Phase 3 contracts | `python -m unittest tone_module.test_phase3_contracts` |
| **Dataset Foundation** | `python -m unittest tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3` |
| **Training Engineering** | `python -m unittest tone_module.test_phase7b1_training_io tone_module.test_phase7b2_canonical_feature_shard` |
| Contract / GATE-RANK | `cd electron_node/electron-node && npm run test:fw-detector` |
| Tone counterfactual | `tone-recall-counterfactual.test.ts` |
| Node E2E dialog_200 | `node tests/tone-v2-phase1-dialog200-batch.js` |

### Foundation E2E 验收（冻结证据）

**Phase 1 全量：** 200/200 `tone_effective_chain`（2026-06-29）  
**Phase 2 Foundation：** 131/131 `tone_effective_chain`；`model_error=0`；`assembly_guard_absent_all=true`  
**产物：** `tests/experiments/tone-v2-phase2-dialog200-batch-result.json`

> **131/131** 证明 Runtime 主链贯通且 Tone 参与最终决策。  
> **全量 200 条** 属后续**模型质量 / 性能评估**，**不作为** Foundation Freeze 阻塞项。

---

## 13. 允许 / 禁止修改（Freeze 后）

| 允许（模型能力开发阶段） | 禁止（须再冻结） |
|--------------------------|------------------|
| 同 featureVersion 权重升级（换 npz + 重启） | Required Schema · Runtime hop · Recall SQL 语义 |
| 离线训练 · benchmark · 全量 dialog_200 QA | fail-closed 语义 · Decision Ownership |
| npz optional metadata 值填充 | Registry · Switching · Hot Reload · Multi-Model |
| 新 featureVersion / 新 adapter（**新服务实例** + 再冻结） | KenLM/Apply tone · Assembly Guard 恢复 |
| 诊断 optional 字段扩展（不进 Decision） | bootstrap · compatibility runtime · Shadow 主链 |

---

## 14. 历史依据（只读 · 不得改写冻结裁决）

| 文档 | 说明 |
|------|------|
| Phase 1 Development Plan / Supplement / Final Addendum | Phase 1 过程依据 |
| [Phase 2 Restart Supplement](./Tone%20V2%20Phase%202%20Restart%20Supplement%20%E2%80%94%20Single%20Service%20Single%20Model.md) · [Addendum](./Tone%20V2%20Phase%202%20Restart%20Supplement%20Addendum.md) | Phase 2 Foundation 开发依据（已并入本文） |
| [Development Report](./Tone_V2_Phase2_Development_Report.md) · [E2E Report](./Tone_V2_Phase2_Node_E2E_Test_Report.md) | 证据归档 |

**不得作为开发 SSOT：** `archive/deprecated/` · `archive/audit/` 内任何文档。

---

## 15. Dataset Foundation（Phase 7-A · FROZEN）

**唯一 SSOT：** [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)

| 概念 | 定义 |
|------|------|
| **Dataset Foundation** | Training 数据层框架：`DatasetAdapter` → `AlignmentProvider` → `SyllableSample[]` · CacheLayout · Probe |
| **Current Canonical Training Dataset** | 当前规范大规模训练语料：**AISHELL-3**（`openslr_aishell3/v1`） |
| **Regression Fixture** | **`data_mini`**（`CS5647Team3_data_mini/v1`）— CI · 快速回归 |

**扩展新语料：** 仅 **新增** Adapter +（必要时）Provider；**禁止**修改已冻结 Contract / CacheLayout / Probe 框架。

**Dataset Foundation 与 Runtime Contract（本文 §1–§13）正交：** 训练数据层变更 **不得** 修改 Required Schema · Loader · Recall Decision。

---

## 16. Training Engineering（Phase 7-B · FROZEN）

**唯一 SSOT：** [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md) · **运维：** [TONE_V2_TRAINING_ENGINEERING_GUIDE.md](./TONE_V2_TRAINING_ENGINEERING_GUIDE.md)

| 概念 | 定义 |
|------|------|
| **Training Engineering** | Training IO 框架：Feature Shard → Shard Reader → Sequential Feature Reader → Mini-batch Reader → Training |
| **Canonical Feature Shard** | AISHELL-3 全量物化 `training_features/`（997,992 · P7-B2） |
| **Canonical Training Input** | Reader 链 + `fit_norm_stats` — **唯一**正式大规模训练 IO |
| **Training IO Validation** | `probe_feature_shard accept` — **不是** Runtime Validation |

**模型复用：** `tone_cnn` · `tone_crnn` · 未来模型 **全部复用** Training Engineering；修改 IO 须 **Training Engineering 再冻结**。

**Training Engineering 与 Dataset Foundation · Runtime Contract 正交：** IO 层变更 **不得** 修改 Dataset Foundation 冻结体 · Required Schema · Loader · Recall Decision。
