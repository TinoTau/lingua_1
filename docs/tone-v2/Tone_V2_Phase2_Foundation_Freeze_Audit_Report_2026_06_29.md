# Tone V2 Phase 2 Foundation — Freeze Audit Report

**Date:** 2026-06-29  
**Type:** 只读冻结审计（非开发）  
**审计目标：** Phase 2 Foundation 是否可长期冻结；后续模型能力开发是否无需再改 Runtime / Contract / Decision Path / Service Boundary  
**依据：** Phase 1 Freeze · Phase 2 Restart Supplement · Addendum · Development Report · Node E2E Test Report · 当前仓库代码  
**排除：** `archive/deprecated/` 内 Registry/Switching 方案及一切废弃 Phase2A 路线

---

## Executive Summary

Phase 2 Foundation（Single Service / Single Model · Feature SSOT · Backend Adapter · Loader Contract · Artifact/Diagnostics 加固）**已在代码与 E2E 中成立**。Runtime Hop、Decision Ownership 与 Phase 1 Freeze **一致**；无 Registry、无第二 Pipeline、无 Assembly Guard 复活。

| 审计域 | 裁决 |
|--------|------|
| Foundation | ✅ 可冻结 |
| Frozen Runtime | ✅ 与 Phase 1 一致 |
| Decision Ownership | ✅ 未迁移 |
| Architecture Drift | ✅ 无 Tone 级漂移 |
| Regression Gate | ✅ Foundation 门禁满足 |
| Documentation | ⚠️ 轻量漂移（见 §11），**不否决 Foundation** |

**Final Verdict：PASS**

Phase 2 Foundation **可以冻结**；可进入下一阶段（**模型能力开发**），且后续开发 **不得** 修改本报告 §12 所列已冻结 Foundation。

---

## 一、Foundation Freeze Verification — Foundation Matrix

| 链路环节 | Expected（冻结设计） | 代码 Actual | Exists | Effective | 裁决 |
|----------|---------------------|-------------|--------|-----------|------|
| 一个 Tone 服务实例 | `faster-whisper-vad` 单进程 | `FW_ASR_SERVICE_ID='faster-whisper-vad'`；单 FW Worker :6007 | ✅ | ✅ | **KEEP** |
| 一个模型 artifact | `TONE_MODEL_PATH` 或默认 npz | `loader.py` `_resolve_default_path()` + env | ✅ | ✅ E2E 0 model_error | **KEEP** |
| 一个 backend adapter | `numpy_p0` 无 registry | `backends/numpy_p0.py`；`classifier` 委托 `infer_batch` | ✅ | ✅ 131/131 toneEnabled | **KEEP** |
| 一个 featureVersion | `p0-v1`（+ legacy 兼容集） | `contract.P0_FEATURE_VERSION`；`P0_COMPATIBLE_FEATURE_VERSIONS` | ✅ | ✅ Loader 校验 | **KEEP** |
| 一个 TonePosterior 输出 | `{t1..t5}` × N slices | `tone_types.py` · `run_tone_inference` | ✅ | ✅ sliceCount>0 | **KEEP** |
| Registry | 禁止 | `tone_module` 无 `get_backend`/registry（仅测试禁止词表） | ❌ | ❌ | **KEEP** |
| Model Switching | 禁止 | 无 `TONE_MODEL_ID`/active model/hot reload | ❌ | ❌ | **KEEP** |
| Backend Switching | 禁止 | 无 dispatch/routing table | ❌ | ❌ | **KEEP** |
| Multi-Model / Runtime Routing | 禁止 | 单例 `get_tone_loader()`；生产 `load(None)` | ❌ | ❌ | **KEEP** |

---

## 二、Frozen Architecture Verification — Frozen Runtime Matrix

| Hop | Producer | Consumer | Exists | Effective | Final Decision Position | 被覆盖？ |
|-----|----------|----------|--------|-----------|-------------------------|----------|
| FW `run_tone_inference` | `api_routes.process_utterance` | UtteranceResponse | ✅ | ✅ 131/131 ASR toneEnabled | —（Posterior 产出） | 否 |
| `UtteranceResponse.tone` | FW HTTP | Node ASR 解析 | ✅ | ✅ | — | 否 |
| `ASRResult.tone` → `ctx.acousticToneSlices` | `asr-step.ts` | `fw-detector-v4-path` | ✅ | ✅ `acousticSlices: ctx.acousticToneSlices` | — | 否 |
| Recall | `recall-topk-for-windows.ts` | candidate SQL / score | ✅ | ✅ fallback 5511 + compatible 350 | **Tone Decision Owner** | 否 |
| Ranking | `span-assembly-v4-orchestrator` | sentence pick | ✅ | ✅ combinationCount>0 | Sentence Ranking（tone-free 输入语义） | 否 |
| Assembly | V4 apply path | span patches | ✅ | ✅ fw_triggered 100% | Tone Free | N/A |
| KenLM | rerank subprocess | score delta | ✅ | ✅ maxDelta 非零样本 | Tone Free | N/A |
| Apply | `apply-span-replacements` | text 输出 | ✅ | ✅ applied 76 累计 | Tone Free | N/A |

**第二 Runtime / 第二 Pipeline / 第二 Decision：** 未发现。

- `agent/postprocess/tone-stage.ts` 为 **TTS 音色克隆（YourTTS）**，文件注释明确与声学 `acousticToneSlices → Recall` **无关** → 非 Tone V2 决策链，**KEEP**（不同域）。

---

## 三、Decision Ownership Verification — Ownership Matrix

| 角色 | Owner | 职责 | Hidden Owner？ | Metadata 参与决策？ | 裁决 |
|------|-------|------|----------------|---------------------|------|
| Tone Posterior | FW `tone_module` | mel → posterior → slices | 否 | 否 | **KEEP** |
| Tone Decision | **Recall** | `tonePenalty` · SQL fallback/compatible | 否 | 否 | **KEEP** |
| Sentence Ranking | Ranking | KenLM rerank 组合 | 否 | 否 | **KEEP** |
| Span Assembly | Assembly | tone-free apply | 否 | 否 | **KEEP** |
| KenLM | KenLM stage | tone-free 打分 | 否 | 否 | **KEEP** |
| Apply | Apply | tone-free 替换 | 否 | 否 | **KEEP** |
| Diagnostics | 观测 only | `diagnostics.toneModule` / `spanAssemblyV4.tone` | 否 | 否（Recall 无 metadata 引用） | **KEEP** |

**反事实（E2E + Jest）：**

- `toneTimestampOnlyEnabled=false` → tone effective path 关闭（`tone-recall-counterfactual.test.ts` 2/2 PASS）
- 131/131 `effective_chain=true` → Posterior **经 Recall 生效**，非“存在但不决策”

---

## 四、Feature SSOT Verification — Feature SSOT Matrix

| 文件 | Expected | Actual | Duplicate？ | Drift？ | 裁决 |
|------|----------|--------|-------------|---------|------|
| `contract.py` | 唯一 SSOT | `P0_*` 常量 + `ToneFeatureBaseline` | — | — | **KEEP（SSOT）** |
| `mel.py` | 引用 contract | `from contract import P0_SAMPLE_RATE` 等 | 仅别名 re-export | 否 | **KEEP** |
| `inference.py` | 引用 contract | `MIN_SLICE_SEC = P0_MIN_SLICE_SEC` | 否 | 否 | **KEEP** |
| `train_tone_cnn.py` | 离线边界 | 含 `0.02` 硬编码 | 离线工具 | 不进 Runtime | **KEEP**（离线） |

**Runtime 内无 Feature Duplicate / Hardcode Baseline 漂移。**

---

## 五、Backend Adapter Verification — Backend Boundary Matrix

| 边界项 | Expected | Actual | 裁决 |
|--------|----------|--------|------|
| 输入 | `mel_batch` | `numpy_p0.infer_batch(mel_batch, weights)` | **KEEP** |
| 输出 | `ndarray[N,5]` posterior | softmax logits → 5-class | **KEEP** |
| Feature Extraction | 禁止 | 在 `mel.py` / `inference.py` | **KEEP** |
| Recall/Ranking/Assembly | 禁止 import | `numpy_p0.py` 仅 numpy + contract + weights | **KEEP** |
| Registry/Dispatch/Routing | 禁止 | 无 | **KEEP** |
| Metadata Decision | 禁止 | adapter 无 metadata 逻辑 | **KEEP** |

---

## 六、Loader Contract Verification — Loader Contract Matrix

| 项 | Expected | Actual | 裁决 |
|----|----------|--------|------|
| 生产入口 | `get_tone_loader()` → `load(None)` | `loader.py:233` | **KEEP** |
| 路径来源 | `TONE_MODEL_PATH` / 默认 npz | `_resolve_default_path()` | **KEEP** |
| 生产 `load(path)` | 禁止 | `api_routes`/`inference` 无显式 path；`test_phase2_contracts` Production Scan PASS | **KEEP** |
| `load(path)` 测试 | 仅单元测试 | `test_loader.py` / `ToneClassifier(model_path=...)` | **KEEP** |
| reset singleton | 仅测试 | 生产路径 AST 扫描无调用 | **KEEP** |
| Runtime reload/switching | 禁止 | 无 | **KEEP** |
| Bootstrap / compatibility loader | 禁止 | fail-closed unload-first | **KEEP** |
| Fail-closed | `model_error` | E2E 0 条 model_error | **KEEP** |

---

## 七、Artifact Contract Verification — Artifact Contract Matrix

| 字段 | 设计 | 实现 | 进入 Recall/Ranking/Assembly/KenLM/Apply？ | 裁决 |
|------|------|------|---------------------------------------------|------|
| `formatVersion` | optional npz | `_read_npz_metadata` | 否 | **KEEP** |
| `backend` | `numpy_p0` | `ToneModelMetadata.backend` | 否 | **KEEP** |
| `featureVersion` | required 语义 | Loader 校验 `P0_COMPATIBLE_FEATURE_VERSIONS` | 否（仅 Loader gate） | **KEEP** |
| `modelVersion` | optional | `model_version` → diagnostics | 否 | **KEEP** |
| `toneModelVersion` | 审计清单用词 | 代码为 **`modelVersion`**（非 `toneModelVersion`） | 否 | **KEEP**（命名见 §11） |
| `modelHash` | optional | `_file_sha256` → `model_hash` | 否 | **KEEP** |
| `trainingVersion` / `datasetVersion` / `buildTime` / `notes` | Phase 2 optional | contract + loader 扩展 | 否 | **KEEP** |
| `artifactPath` / `loadMs` | diagnostics optional | metadata + `as_diagnostics_dict` | 否 | **KEEP** |

**Single Artifact Contract 成立：** 单进程单 npz，无 artifact 列表或切换。

---

## 八、Diagnostics Verification — Diagnostics Matrix

| 字段 / 通道 | 用途 | 参与 tonePenalty / candidateScore / Recall SQL？ | 裁决 |
|-------------|------|--------------------------------------------------|------|
| `diagnostics.toneModule` | FW 观测 | 否 | **KEEP** |
| `spanAssemblyV4.tone` | Recall 诊断 | 仅记录；决策已由 Recall 内逻辑完成 | **KEEP** |
| `tone_inference_ms` | 延迟 | 否 | **KEEP** |
| `backendAdapter` / `loadMs` / `artifactPath` | Phase 2 optional | 否 | **KEEP** |
| `metadataWarning` | Loader 观测 | 否 | **KEEP** |

**无“功能存在但实际参与决策”的 Diagnostics 路径。**

---

## 九、Architecture Drift Audit — Architecture Drift Matrix

| 禁止项 | 代码扫描 | E2E | Severity | 裁决 |
|--------|----------|-----|----------|------|
| Registry / Backend Registry | 无（tone_module） | — | — | **KEEP  absent** |
| Switching / Routing / Multi-Model | 无 | — | — | **KEEP absent** |
| Shadow / Offline / Bootstrap Runtime | 无接入主链 | — | — | **KEEP absent** |
| Assembly Guard / Tone Guard | 文件不存在；无 `toneGuardBlockedCount` | guard_absent 131/131 | — | **KEEP absent** |
| Second Pipeline（声学 Tone） | 无 | — | — | **KEEP absent** |
| Second Decision | 无 | — | — | **KEEP absent** |
| Dead Feature（numpy_p0） | 在 `predict_batch` 主链 | 131/131 effective | — | **KEEP effective** |
| Hidden Gate | 仅 `toneTimestampOnlyEnabled`（冻结门控） | 反事实 Jest 验证 | — | **KEEP** |
| Context Loss | `ctx.acousticToneSlices`  wired | E2E effective_chain | — | **KEEP** |

**并行非 Tone 漂移（不否决 Foundation）：**

| 项 | 说明 | Severity | 建议 |
|----|------|----------|------|
| `freeze-contract` CLEANUP-2 `hardDropCount` | span-assembly-v4，非 Tone | MEDIUM | **MODIFY**（FW 并行） |
| `train_tone_cnn.py` 离线常量 | 不进 Runtime | LOW | **KEEP** |

---

## 十、Regression Gate — Regression Matrix

| Gate | 要求 | 证据 | Foundation 相关 | 裁决 |
|------|------|------|-----------------|------|
| Python Contract Tests | Feature/Loader/Backend/Deployment | 18/18 PASS（`test_loader` · `test_classifier_fail_closed` · `test_phase2_contracts`） | ✅ | **KEEP** |
| Loader Fail-Closed | missing/corrupt/mismatch | 单元测试 + E2E 0 model_error | ✅ | **KEEP** |
| Counterfactual Tests | Recall tone 门控 | `tone-recall-counterfactual.test.ts` 2/2 PASS | ✅ | **KEEP** |
| Node E2E dialog_200 子集 | 主链贯通 + 决策生效 | **131/131** effective_chain；0 HTTP 错误 | ✅ | **KEEP** |
| dialog_200 全量 200 | **不否决 Foundation** | 未在本轮完成 | N/A | **后续模型 QA** |
| 模型识别质量（CER 等） | **本轮不评估** | mean_cer=0.220（观测 only） | N/A | **OUT OF SCOPE** |

---

## 十一、Documentation Alignment Audit — Documentation Alignment Matrix

| 文档 / 代码 | 对齐项 | 状态 | Severity | 建议 |
|-------------|--------|------|----------|------|
| `TONE_V2_CONTRACT_FREEZE.md` | Phase 1 Runtime/Contract | 与代码一致 | — | **KEEP**（Phase 1 SSOT 仍有效） |
| `TONE_V2_CONTRACT_FREEZE.md` | Phase 2 `backends/numpy_p0` · expanded diagnostics | 未写入 | LOW | **MODIFY**（冻结后 SSOT 同步，非 Foundation 缺陷） |
| `README.md` | Phase 2 状态 | 仍标 `IN PROGRESS` | LOW | **MODIFY** → CLOSED |
| `tone-module/ARCHITECTURE.md` | Phase 2 adapter 边界 | 可能未同步 | LOW | **MODIFY** |
| Supplement + Addendum | 与代码 | 一致 | — | **KEEP** |
| Development / E2E Report | 与代码/E2E JSON | 一致 | — | **KEEP** |
| `archive/deprecated/` Registry 审计 | 已隔离 | 已归档 | — | **KEEP** |
| 字段名 `toneModelVersion` vs `modelVersion` | 审计清单 vs 实现 | 实现为 `modelVersion` | LOW | **KEEP**（以代码/diagnostics 为准） |

**无 Contract Drift / Decision Drift；仅 SSOT 索引与架构详述待冻结后同步。**

---

## 十二、Freeze Decision — KEEP / MODIFY / RESTORE / DELETE

### 正式进入 Phase 2 Foundation Freeze（SSOT — 后续模型开发不得修改）

| 类别 | 冻结内容 |
|------|----------|
| **Service Boundary** | Single Service / Single Model；新模型 = 新服务实例 + 新 `TONE_MODEL_PATH` + 新 adapter 文件（无 registry） |
| **Runtime Hop** | Phase 1 九跳主链不变；`run_tone_inference` pre-dedup |
| **Required Data Contract** | `TonePosterior` · `AcousticToneSlice` · `UtteranceAcousticTonePayload` · 四值 `skippedReason` |
| **Decision Ownership** | Recall = 唯一 Tone Decision Owner；Ranking/Assembly/KenLM/Apply tone-free |
| **Feature SSOT** | `contract.py` 唯一 baseline；`mel.py`/`inference.py` 引用 |
| **Backend Boundary** | `backends/numpy_p0.py`：mel_batch → posterior only |
| **Loader Contract** | 生产 `load(None)` + `TONE_MODEL_PATH`；fail-closed；test-only `load(path)` / `reset_*` |
| **Artifact Contract** | 单 npz；`P0_COMPATIBLE_FEATURE_VERSIONS`；metadata 仅 diagnostics |
| **Diagnostics Contract** | optional 字段仅 `diagnostics.toneModule`；不参与决策 |
| **禁止项** | Registry · Switching · Hot Reload · Assembly Guard · 第二声学 Pipeline |

### RESTORE

无。

### DELETE（保持删除/归档状态）

| 项 | 处理 |
|----|------|
| `apply-tone-assembly-guard.ts` | **DELETE**（保持） |
| Registry Phase2A 方案文档 | **DELETE**（保持 `archive/deprecated/`） |

### MODIFY（冻结后文档/并行项 — **不属于 Foundation 架构变更**）

| 项 | 说明 |
|----|------|
| `TONE_V2_CONTRACT_FREEZE.md` | 增补 Phase 2 Foundation 段落（adapter · diagnostics · loader 生产契约） |
| `README.md` | Phase 2 Foundation → **CLOSED** |
| `tone-module/ARCHITECTURE.md` | 同步 adapter 与 SSOT |
| span-assembly `hardDropCount` | FW 并行清理（非 Tone） |
| dialog_200 全量 200 | **模型能力/QA 阶段**回归，非 Foundation 门禁 |

### 属于后续模型能力开发阶段（可改，但不得触碰上表冻结项）

| 范围 | 允许 |
|------|------|
| 模型权重 | 换 npz（同 featureVersion）+ 重启 |
| 训练 | `train_tone_cnn.py` 离线迭代 |
| 质量 | benchmark · CER · dialog_200 全量 |
| 新模型代际 | 新 featureVersion → **新冻结流程** + 新服务实例 |
| optional metadata 值 | npz 内 `trainingVersion` 等内容填充 |

---

## 十三、Final Verdict — 十问裁决

| # | 问题 | 答案 |
|---|------|------|
| 1 | Phase 2 Foundation 是否可以冻结？ | **是** |
| 2 | Frozen Runtime 是否保持不变？ | **是**（与 Phase 1 一致） |
| 3 | Single Service / Single Model 是否成立？ | **是** |
| 4 | Feature SSOT 是否成立？ | **是** |
| 5 | Backend Boundary 是否成立？ | **是** |
| 6 | Loader Contract 是否成立？ | **是** |
| 7 | Artifact Contract 是否成立？ | **是** |
| 8 | Tone 是否仍真实参与最终决策？ | **是**（131/131 effective_chain + 反事实 Jest） |
| 9 | 是否存在 Architecture Drift？ | **否**（Tone 域无；span-assembly 项并行） |
| 10 | 是否可以进入下一阶段（模型能力开发）？ | **是** |

---

## Final Verdict

```text
PASS
```

**Tone V2 Phase 2 Foundation 准予冻结。**

后续模型能力开发必须在 §12「Foundation Freeze」边界内进行；任何改动 Runtime Hop、Required Schema、Decision Ownership、Service Boundary、Registry 路线，均须 **终止并重新走冻结流程**。

---

**审计类型：** 只读 · 未修改代码、配置、模型、既有 SSOT 文档或测试数据。  
**证据工件：** `tone-v2-phase2-dialog200-batch-result.json` · `test_phase2_contracts.py` · `tone-recall-counterfactual.test.ts` · 当前 `tone_module/` 源码。
