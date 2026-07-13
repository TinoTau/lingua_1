# Tone V2 Contract Freeze Pre-Audit

**审计日期：** 2026-06-29  
**模式：** 只读 — 不修改代码、不新增设计、不实现 Loader  
**SSOT 依据：** Lingua Project Constitution、`docs/tone-module/ARCHITECTURE.md`、`docs/fw-detector/INTERFACE_FREEZE.md`、历史审计结论、当前仓库代码  
**Run 参考：** `_audit_post_recovery.json`（200/200 utterance PASS，2026-06-29）

**裁决：CONDITIONAL PASS**

---

## Executive Summary

本轮确认：**P0 声学 Tone Runtime 主链已稳定且在生产路径上有效**，有效决策边界止于 **Recall / Ranking**（tone-first SQL + 0.8 penalty）；KenLM / Apply ** intentionally tone-free**。FW Worker → HTTP → Node → `ctx.acousticToneSlices` → Recall 链路经运行态与 `freeze-contract.test.ts`（TONE-PRE-V2-*）验证。

**可进入 Contract Freeze 的 SSOT：**

- Runtime Contract（挂载点、hop 顺序、fail-closed 边界）
- Data Contract（`TonePosterior` / `AcousticToneSlice` / `UtteranceAcousticTonePayload` / `ctx.acousticToneSlices`）
- Ownership Contract（Posterior Provider vs Recall Consumer vs Decision Owner）
- Feature Contract（P0：Mel 提取属 Runtime；模型只消费固定维 Mel）
- Diagnostics Contract（现有 `toneEnabled` / `skippedReason` / Recall diagnostics）
- Backend **边界** Contract（Backend 不得改 Schema / Runtime hop）

**暂不得永久冻结：**

- Loader 实现与 manifest 字段全集（V2 backend registry **未实现**）
- `formatVersion` / `featureVersion` / `modelHash` 等 Metadata **运行时未接线**
- Assembly `toneGuard`（代码存在、**生产未 Effective**）
- KenLM / Apply 层 tone 参数（历史缺口，非 V2 目标）

**进入 `Tone V2 Phase 1 Contract Freeze` 前置条件：**

1. 显式裁决 `applyToneAssemblyGuard` — **KEEP 未接线** 或 **MODIFY 接入**（二选一写入 Freeze 文档）
2. 同步 `docs/fw-detector/assembly/RANKING_V1_2.md` 与代码（toneGuard drift）
3. Loader / Metadata Contract 以 **Phase 1 设计附录** 冻结，而非冒充已运行字段

---

## 1. Runtime Contract Matrix

| Hop | 组件 | 文件 / 符号 | 生成 | 消费 | 稳定 | Exists | Effective |
|-----|------|-------------|------|------|------|--------|-----------|
| 0 | FW VAD+ASR | `utterance_processor` → `perform_asr` | FW Worker | — | ✅ | ✅ | ✅（Tone 前置依赖） |
| 1 | Tone 推理 | `tone_module/inference.py::run_tone_inference` | FW Worker | `api_routes.process_utterance` | ✅ | ✅ | ✅ ASR 成功后 dedup **前** |
| 2 | HTTP 载荷 | `UtteranceResponse.tone` | `api_routes._tone_payload_to_model` | `faster-whisper-asr-strategy.ts` | ✅ | ✅ | ⚠️ 早退路径无 `tone` |
| 3 | ASR 结果 | `ASRResult.tone?` | ASR Strategy | `asr-step.ts` | ✅ | ✅ | ✅ 读 `acousticToneSlices` |
| 4 | Job 上下文 | `ctx.acousticToneSlices` | `asr-step.ts`（normalize+offset） | `fw-detector-v4-path.ts` | ✅ | ✅ | ✅ Recall 唯一声学输入 |
| 5 | 时间对齐 | `wordTimeSpans` / `acousticTonePattern` | `tone-time-align.ts` | `recall-topk-for-windows.ts` | ✅ | ✅ | ⚠️ 音节数须对齐 |
| 6 | Recall | `recallTopKForWindows` | Lexicon SQL + tone-first tier | `WindowCandidate[]` | ✅ 冻结 | ✅ | ✅ **tone_exact + penalty** |
| 7 | Ranking | `sortRecallHitsByToneCompatibility` | `tone-recall-sort.ts` | `candidateScore` | ✅ | ✅ | ✅ ×0.8，不 hard drop |
| 8 | Assembly | `runDomainAwareAssembly` | span sets | per-span pick by `score` | ✅ | ✅ | ⚠️ 仅间接（penalized score） |
| 9 | KenLM | `rerankFwSentences` | sentence combos | approved sentence | ✅ | ✅ | ❌ 不读 tone |
| 10 | Apply | `applyFwSpanReplacements` | KenLM 批准替换 | `segmentForJobResult` | ✅ | ✅ | ❌ 不读 tone |

**Runtime 边界（可 Freeze）：**

```text
FW Worker (ASR 内嵌 Posterior Provider)
  → run_tone_inference
  → UtteranceResponse.tone
  → ASRResult.tone
  → ctx.acousticToneSlices
  → Recall → Ranking → Assembly → KenLM → Apply
```

Tone **不是** Node Pipeline 独立 Step；**不得**在 Freeze 中引入第二条 Tone 链路。

---

## 2. Ownership Matrix

| 对象 | 生成 Owner | 消费 Owner | 最终解释权 | 双 Owner 风险 |
|------|------------|------------|------------|---------------|
| `TonePosterior` | FW `tone_module`（CNN softmax） | Node Recall（pattern 比对） | **Recall 打分 SSOT**（`tone-match-score.ts`） | 无 |
| `AcousticToneSlice` | FW `run_tone_inference` | Node `asr-step` → Recall 对齐 | **FW 负责时间戳+posterior 质量** | 无 |
| `UtteranceAcousticTonePayload` | FW HTTP 层 | ASR Strategy（透传） | **FW fail-closed** | 无 |
| `UtteranceResponse.tone` | FW `api_routes` | Node HTTP 客户端 | FW Schema Owner | 无 |
| `ASRResult.tone` | `faster-whisper-asr-strategy` | `asr-step`（仅 slices） | Node ASR 层 | ⚠️ V4 **不读**整包，读 `ctx.acousticToneSlices` |
| `ctx.acousticToneSlices` | `asr-step`（合并 batch+offset） | `fw-detector-v4-path` / Recall | **Node FW Detector** | 无 — **Recall 唯一声学 SSOT 输入** |
| `ToneScoreResult` | `computeToneScoreResult` | Recall 排序 | **FW Detector** | 无 |
| `WindowCandidate.candidateScore` | Recall+Ranking | Assembly pick | **Recall→Assembly** | penalty 已 baked-in |
| `CoarseAssemblyToneDiagnostics` | Recall 窗口 | `spanAssemblyV4.tone` trace | **Diagnostics only** | 无 |
| KenLM sentence | Assembly 组合 | `rerankFwSentences` | **KenLM** | tone 不参与 |
| Final text | Apply | NMT/TTS | **Apply + 下游** | 无 |

**禁止双 Owner：** Posterior 由 FW 生成；**决策权**在 Recall/Ranking；KenLM/Apply **不得** reinterpret posterior。

---

## 3. Data Contract Matrix

| 结构 / 字段 | Required Contract | Implementation Detail | Freeze 建议 |
|-------------|-------------------|----------------------|-------------|
| `TonePosterior.t1..t5` | ✅ Required | float softmax 五类 | **永久 Freeze** |
| `AcousticToneSlice.start/end` | ✅ Required | 秒，对齐 FW word timestamps | **永久 Freeze** |
| `AcousticToneSlice.tonePosterior` | ✅ Required | — | **永久 Freeze** |
| `AcousticToneSlice.confidence` | ✅ Required | max(probs) | **永久 Freeze** |
| `toneEnabled` | ✅ Required | bool | **永久 Freeze** |
| `acousticToneSlices[]` | ✅ Required（可空数组） | — | **永久 Freeze** |
| `sliceCount` | ✅ Required | int | **永久 Freeze** |
| `toneConfidenceAvg` | Optional | 聚合统计 | Freeze optional |
| `skippedReason` | Optional | enum 4 值 + fail-closed | **Freeze enum** |
| `ASRResult.tone` | Optional 整块 | batch0 保留 | Freeze optional 容器 |
| `ctx.acousticToneSlices` | Optional | Recall 实际输入 | **Freeze 为 Node SSOT 输入名** |
| `WindowCandidate.tonePenalty` 等 | Optional | 诊断+trace | Diagnostics Freeze |
| PCM / raw audio in HTTP | ❌ 不在 Contract | — | **不得 Freeze 导出** |
| `formatVersion` / `modelHash` | ❌ 未运行 | Phase 1 计划 | **暂不 Freeze** |

**skippedReason 冻结枚举：**

`no_audio` | `no_timestamps` | `non_zh` | `model_error`

（配置关闭 `toneTimestampOnlyEnabled` 在 Node 侧产生 `tone_timestamp_disabled` — **Node 诊断，非 HTTP skippedReason**）

---

## 4. Loader Contract Matrix（只确认边界，不设计 Loader）

| 约束 | 必须 / 可选 | 说明 |
|------|-------------|------|
| 输出符合 `TonePosterior` + slice 时间边界 | **必须** | V2 只改 posterior **质量**，不改 Schema |
| `model missing/corrupt/invalid → tone_enabled=false` | **必须** | fail-closed（`classifier.py` 已实现） |
| 不得 silent bootstrap / mock weights | **必须** | 已删除 bootstrap |
| `metadata.formatVersion` | 可选（Phase 1） | **当前 npz 无此字段 — 暂不 Freeze 为 Required** |
| `metadata.featureVersion` | 可选 | 与 Mel 维数绑定，Phase 1 定义 |
| `metadata.backend` | 可选 | 诊断；不得决定 Runtime hop |
| `metadata.modelHash` | 可选 | 审计/回归；**不得进入 Recall 决策** |
| `metadata.modelVersion` | 可选 | 同上 |
| `inputShape` / `outputShape` | 实现 | Backend 内部；**不得暴露为 HTTP Required** |
| `trainingVersion` | 可选 | 离线/metadata only；**不得进入 Runtime** |
| Loader 不得改 `UtteranceResponse` required schema | **必须** | Constitution |
| Loader 不得新增第二 Posterior 出口 | **必须** | 单链路 |

---

## 5. Feature Ownership Matrix

| Feature 能力 | Owner | 说明 |
|--------------|-------|------|
| Mel 提取（80-bin 等） | **Runtime**（`tone_module/mel.py`） | P0 固定；V2 改 feature 须 bump `featureVersion` |
| Normalization（mel_mean/mel_std） | **Model artifact**（npz 可选键） | 缺省则 runtime 默认 |
| Window / MIN_SLICE_SEC | **Runtime**（`inference.py`） | 0.02s gate |
| Sample Rate | **Runtime**（16kHz ASR 对齐） | 来自 processed_audio |
| Word timestamp 对齐 | **Runtime**（FW segments.words） | 无 timestamps → skip |
| CNN 权重 / 架构 | **Backend / Model** | Phase 1 可换 backend，不改输出 Schema |
| tone pattern 提取 | **Node**（`tone-time-align.ts`） | Recall 前置 |
| SQL tone_exact | **Lexicon / Recall** | 已冻结 TONE_FIRST_RECALL |

**Freeze 原则：** Feature 实现可换；**输出 slice+posterior Contract 不可换**。

---

## 6. Backend Contract Matrix

| Backend 允许 | Backend 禁止 |
|--------------|--------------|
| 选择推理引擎（P0 CNN / 未来 CRNN 等） | 决定 `TonePosterior` Schema |
| 内部 tensor shape / 权重格式 | 新增 HTTP 字段为 Required |
| 报告 `loadError` / `ready` | 决定 Recall SQL 语义 |
| 通过 fail-closed 禁用自身 | 绕过 `run_tone_inference` 挂载点 |
| 训练离线产出 artifact | 决定 Node Pipeline Step 顺序 |
| | 新增 Shadow / Offline Runtime |
| | bootstrap / silent fallback |

---

## 7. Metadata Contract Matrix

| 字段 | Contract / Implementation | 必须 | 可进 Runtime 决策 |
|------|---------------------------|------|-------------------|
| `toneEnabled` | Contract | ✅ | ❌（状态位，非决策） |
| `skippedReason` | Contract | optional | ❌ |
| `toneConfidenceAvg` | Contract | optional | ❌ |
| `loadError`（classifier） | Diagnostics | internal | ❌ |
| `modelHash` | 未实现 | — | **禁止** |
| `modelVersion` | 未实现 | — | **禁止** |
| `featureVersion` | 未实现 | Phase 1 | **禁止** |
| `backend` | 未实现 | Phase 1 诊断 | **禁止** |
| `trainingVersion` | Implementation | optional offline | **禁止** |
| `metrics` in npz | Implementation | optional | ❌ |

---

## 8. Diagnostics Matrix

| 字段 | Runtime 依赖 | Diagnostics only | Freeze |
|------|--------------|------------------|--------|
| `toneEnabled` | gate Recall | ✅ | ✅ |
| `skippedReason` | skip 路径解释 | ✅ | ✅ |
| `toneInferenceMs` | ❌ | ✅ (`p0_diagnostics.toneModule`) | ✅ optional |
| `loadError` | fail-closed | ✅ | ✅ |
| `recallToneCompatibleCount` | ❌ | ✅ | ✅ |
| `recallToneFallbackCount` | ❌ | ✅ | ✅ |
| `toneExactHitCount` | ❌ | ✅ | ✅ |
| `tonePenalty` / `toneReason` on candidate | 影响 score | trace | ✅ |
| `modelHash` / `backend` | ❌ | 未接线 | 暂不 Freeze |
| FW `readiness.*` | ❌ | FW ops | 非 Tone Contract |

---

## 9. Drift Matrix

| ID | 类型 | 描述 | Severity | Freeze 前处理 |
|----|------|------|----------|---------------|
| D-01 | Doc/Code | `applyToneAssemblyGuard` 仅单测，未接入 `runDomainAwareAssembly` | MEDIUM | **裁决 KEEP 或 MODIFY** |
| D-02 | Doc/Code | `RANKING_V1_2.md` 描述 toneGuard，生产无 | MEDIUM | 文档对齐 |
| D-03 | Type | Assembly pick 无 `toneReason`，guard 无法接线 | LOW | Phase 1 或显式 DELETE guard |
| D-04 | Hidden Gate | ASR 503/504 → Tone not reached | INFO | 已文档化（FW audit） |
| D-05 | Hidden Gate | 空/无意义 transcript 早退无 `tone` | INFO | Freeze 为 Expected |
| D-06 | Hidden Gate | `toneTimestampOnlyEnabled=false` 关闭全链 | INFO | CONFIG 已冻结 |
| D-07 | Hidden Gate | slice 数 ≠ 音节数 → no pattern | INFO | Freeze 对齐规则 |
| D-08 | Naming | `tone-stage.ts` = TTS clone | INFO | KEEP 注释隔离 |
| D-09 | Shadow | V2 shadow/offline 已清除 | — | KEEP 禁止恢复 |
| D-10 | Responsibility | KenLM 无 tone 参数 | — | **KEEP intentional** |

无 **Runtime Drift**（第二 Tone 链路）；无 **Contract Drift**（required schema 与代码一致）。

---

## 10. Implementation Detail vs Contract

| 层 | Contract（Freeze 后不可 breaking change） | Implementation（可修改） |
|----|-------------------------------------------|---------------------------|
| Runtime hop 顺序 | ✅ | — |
| Data Schema | ✅ | — |
| `run_tone_inference` 签名 / 输出类型 | ✅ | 内部算法 |
| `ToneClassifier` npz 键名 | partial | 新 backend 格式 |
| Mel 维数 / FFT | Feature Contract | 实现优化 |
| CNN 层宽 / 激活 | — | 训练产物 |
| Loader 代码路径 | — | Phase 1 新增 |
| Backend registry | — | Phase 1 新增 |
| 503 recovery | FW ops | 非 Tone Schema |
| 单测 / audit 脚本 | — | 可增 |

---

## 11. Freeze Boundary Matrix

| Contract 域 | 建议 Freeze 时机 | 本轮 |
|-------------|------------------|------|
| **Runtime Contract** | Phase 1 入口 | ✅ **可 Freeze** |
| **Data Contract** | Phase 1 入口 | ✅ **可 Freeze** |
| **Ownership Contract** | Phase 1 入口 | ✅ **可 Freeze** |
| **Feature Contract**（输出边界） | Phase 1 入口 | ✅ **可 Freeze** |
| **Diagnostics Contract** | Phase 1 入口 | ✅ **可 Freeze** |
| **Backend Boundary Contract** | Phase 1 入口 | ✅ **可 Freeze**（边界-only） |
| **Loader Contract**（manifest 字段全集） | Backend 首实现后 | ⏸ **暂不永久 Freeze** |
| **Metadata Contract**（modelHash 等） | 字段接线后 | ⏸ **暂不** |
| **Assembly toneGuard Contract** | 裁决接入与否后 | ⏸ **暂不** |
| **KenLM tone 扩展** | 非 V2 范围 | ❌ **不得 Freeze** |

---

## 12. Exists vs Effective Matrix

| 能力 | Exists（代码/数据到达） | Effective（改变最终决策） |
|------|-------------------------|---------------------------|
| `run_tone_inference` | ✅ ASR 200 + gates pass | ✅ 产生 posterior |
| HTTP `tone` | ✅ 成功路径 | ✅ Node 消费 |
| `ctx.acousticToneSlices` | ✅ multi-batch | ✅ Recall 输入 |
| tone-first SQL | ✅ | ✅ 改变候选集合 |
| tone penalty ×0.8 | ✅ | ✅ 改变 recall 排序 |
| Assembly by score | ✅ | ⚠️ 间接 |
| `applyToneAssemblyGuard` | ✅ 代码 | ❌ **未 Effective** |
| KenLM tone | ❌ | ❌ |
| Apply tone | ❌ | ❌ |
| Aggregator tone | ❌ | ❌ |

**反事实：** 禁用 `toneTimestampOnlyEnabled` 或清空 slices → Recall 退化为 plain SQL，排序无 penalty — 证明 tone **Effective 于 Recall/Ranking**。

---

## 13. Regression Gate Matrix

| 变更类型 | 必须重跑 |
|----------|----------|
| `TonePosterior` / slice Schema | `freeze-contract.test.ts` TONE-PRE-V2-*、`tone-match-score.test.ts` |
| `run_tone_inference` 输出 | `test_classifier_fail_closed.py`、`audit_runtime_acceptance --part all` |
| Mel / feature 维数 | fail-closed + d001 probe + Recall 对齐单测 |
| Loader / Backend 替换 | 上列 + posterior 分布 Unit Test（非 offline benchmark） |
| Model weights only（同 Schema） | fail-closed + d001 + sample20 |
| FW readiness / queue | FW audit probes（非 Tone Schema） |
| Recall SQL / penalty 常量 | `INTERFACE_FREEZE` 回归 + counterfactual |
| Node 主链 / Gateway | Constitution 全链审计 |

---

## 14. Required Repair Matrix

| 动作 | 项 |
|------|-----|
| **KEEP** | P0 Runtime hop；Data Schema；fail-closed；Recall penalty 不 drop；KenLM/Apply tone-free；无 shadow |
| **MODIFY** | `RANKING_V1_2.md` 与 toneGuard 现实对齐；Phase 1 Loader/Backend **新增**（非改 Contract） |
| **RESTORE** | —（不得 RESTORE 已删 shadow/offline/gateway） |
| **DELETE** | 任何第二 Tone 链路、bootstrap、mock posterior（已删 — KEEP 禁止恢复） |

**Freeze 前需裁决（非代码）：**

- `applyToneAssemblyGuard`：**KEEP 未接线**（文档删 guard 承诺）或 **MODIFY 接入 orchestrator**

---

## 15. Final Verdict

### 裁决：**CONDITIONAL PASS**

可正式进入 **Tone V2 Phase 1 Contract Freeze**，条件见下。

### 问题回答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 是否可进入 Contract Freeze？ | **CONDITIONAL PASS** — Runtime/Data/Ownership 可 Freeze；Loader/Metadata/toneGuard 附条件 |
| 2 | 哪些 Contract 可永久冻结？ | Runtime、Data、Ownership、Feature 输出边界、Diagnostics、Backend **边界** |
| 3 | 哪些仍需补充？ | Loader manifest 字段；Metadata 接线；toneGuard 裁决；Assembly 文档对齐 |
| 4 | 哪些不得冻结？ | 未实现的 modelHash/featureVersion Required；KenLM tone；第二条链路；shadow/offline |
| 5 | Freeze 后允许/禁止修改？ | **允许：** 模型权重、Backend 实现、Loader、Mel 实现（bump featureVersion）。**禁止：** Required Schema、Runtime hop、Recall SQL 语义、fail-closed、引入 tone 到 KenLM/Apply |

### 与 Phase 1 关系

本轮 **不是** Phase 1 开发。下一步：

```text
Tone V2 Phase 1 — Contract Freeze（文档 SSOT）
  → Backend registry + Loader（Implementation，遵守已 Freeze 边界）
  → 不得重新设计 Runtime
```

### 运行态支撑

- FW queue recovery 后 `audit_runtime_acceptance`：**200/200**（2026-06-29）
- `TONE-PRE-V2-3` Exists vs Effective：**静态 PASS**
- Tone fail-closed：**4/4 PASS**

---

## 附录：关键 SSOT 路径

| 角色 | 路径 |
|------|------|
| 推理 | `electron_node/services/faster_whisper_vad/tone_module/inference.py` |
| 类型 | `tone_module/tone_types.py`、`task-router/types.ts` |
| HTTP | `api_models.py`、`api_routes.py` |
| Context | `pipeline/steps/asr-step.ts`、`pipeline/context/job-context.ts` |
| Recall | `span-assembly-v4/recall-topk-for-windows.ts` |
| 打分 | `tone-match-score.ts`、`lexicon/tone-recall-sort.ts` |
| 冻结测试 | `fw-detector/freeze-contract.test.ts` |
| 架构 SSOT | `docs/tone-module/ARCHITECTURE.md` §11 |

---

*本报告为只读审计产物；未修改任何代码或 Contract 文件。*
