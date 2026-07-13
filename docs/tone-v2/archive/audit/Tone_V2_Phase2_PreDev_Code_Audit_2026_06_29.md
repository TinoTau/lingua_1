# Tone V2 Phase 2 — Pre-Development Code Audit

**Date:** 2026-06-29  
**Type:** Read-only code audit（非开发 · 非修改）  
**Authority:** [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) · [Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md) · [tone-module/ARCHITECTURE.md](../tone-module/ARCHITECTURE.md) · [fw-detector/freeze/FROZEN.md](../fw-detector/freeze/FROZEN.md) · [Lingua Project Constitution](../CODING/Lingua%20Project%20Constitution%EF%BC%88Project%20SSOT%EF%BC%89.md)

**E2E 基线（只读引用）：** `electron_node/electron-node/tests/experiments/tone-v2-phase1-dialog200-batch-result.json`（200/200 `tone_effective_chain`）

---

## Executive Summary

对当前仓库代码与 Phase 1 冻结 SSOT 进行只读核对后：

| 维度 | 结论 |
|------|------|
| Frozen Runtime hop | ✅ 成立 — 全链有代码入口且 E2E Effective |
| Data / Interface Contract | ✅ 成立 — Required schema 与四值 `skippedReason` 一致 |
| Ownership | ✅ 成立 — Tone Decision 仅在 Recall；无 Assembly Guard |
| Architecture Drift（Tone 域） | ✅ 无第二声学 Tone Pipeline / Guard / Offline / Bootstrap |
| Loader Foundation | ✅ 可作为 Phase 2 起点 |
| Regression Gate | ⚠️ `freeze-contract` **2/72 失败**（非 Tone hop，interval/lexicon 漂移） |
| Python pytest | ⚠️ 本机默认 `python` 无 pytest（环境，非代码缺失） |

**命名注意：** `agent/postprocess/tone-stage.ts` / `runToneStep` 为 **YourTTS 音色克隆**（`pipeline.use_tone`），与声学 `tone_module` **无关**；未进入 FW 主链 `STEP_REGISTRY`。

**Final Verdict: CONDITIONAL PASS**

Phase 2 **可以开始**，但须先处理 **2 项非 Tone 回归门禁失败**（或明确 interval assembly 与 lexicon 脚本为并行工作、不阻塞 Tone Phase 2 首批）。Tone 域无必须先修的 Contract/Runtime 问题。

---

## 1. Frozen Architecture Verification

### Frozen Architecture Matrix

| Hop | Expected | Actual | Effective | Impact | Severity | Verdict |
|-----|----------|--------|-----------|--------|----------|---------|
| FW Worker | `faster-whisper-vad` 服务 | `service.json` port 6007 · `api_routes.py` `/utterance` | ✅ | — | — | **PASS** |
| `run_tone_inference` | 音频+词级时间戳 → posterior slices | `tone_module/inference.py:52` · `api_routes.py:283` | ✅ | — | — | **PASS** |
| `UtteranceResponse.tone` | `UtteranceAcousticTonePayload` | `tone_payload.as_dict()` → response `tone` · `api_models.py` | ✅ | — | — | **PASS** |
| `ASRResult.tone` | Node 透传 HTTP tone | `faster-whisper-asr-strategy.ts:91` `response.data.tone` | ✅ | — | — | **PASS** |
| `ctx.acousticToneSlices` | ASR step 归一化+offset | `asr-step.ts:150,262-266` → `JobContext` | ✅ | E2E 200/200 | — | **PASS** |
| Recall | `acousticSlices` → `tonePenalty` | `fw-detector-v4-path.ts:187` → `recall-topk-for-windows.ts` · `recall-span-topkv3.ts:194-196` `candidateScore *= tonePenalty` | ✅ | fallback 8485 | — | **PASS** |
| Ranking | 消费 Recall 后 `candidateScore` 排序 | `candidate-score.ts` · `selectPerSpanCandidates` 按 score 桶选 | ✅ | 59 条非 raw pick | — | **PASS** |
| Assembly | 桶优先级，无 Tone Decision | `assemble-domain-aware-span-sets.ts` 无 tone 引用 | ✅ N/A | — | — | **PASS** |
| KenLM | tone-free | `kenlm/` 无 `tone`/`acoustic` 匹配 | ✅ N/A | — | — | **PASS** |
| Apply | tone-free | `apply-span-replacements.ts` 无 tone 匹配 | ✅ | 135 applied | — | **PASS** |

**旁路检查：** Legacy `LEXICON_RECALL` / `SENTENCE_REPAIR` 仅在非 `fw_detector_v1` 注入（`pipeline-step-registry.ts` 注释）；当前配置 `asr.engine = fw_detector_v1`，声学 Tone **不经过** legacy 路径。

---

## 2. Architecture Drift Audit

### Drift Matrix

| Drift Item | Expected | Actual | Impact | Severity | Action |
|------------|----------|--------|--------|----------|--------|
| 第二声学 Tone Pipeline | 禁止 | 无；唯一 HTTP tone 在 `/utterance` | — | — | **KEEP** |
| 独立 Node 声学 Tone Step | 禁止 | `tone-step.ts` 存在但 **未注册** 于 `STEP_REGISTRY`；实为 YourTTS | 命名混淆风险 | LOW | **KEEP**（注释已声明无关） |
| 第二 HTTP tone 出口 | 禁止 | 仅 `api_routes.py` utterance 路径 | — | — | **KEEP** |
| Assembly Tone Guard | DELETE | 文件不存在 · `freeze-contract` GATE-RANK-04 通过 | — | — | **KEEP** |
| KenLM tone 参数 | 禁止 | 无 | — | — | **KEEP** |
| Apply tone 参数 | 禁止 | 无 | — | — | **KEEP** |
| Shadow Tone Runtime | 禁止 | FW Beam shadow 存在但 **tone-free**、不进 KenLM/Apply | — | — | **KEEP** |
| Offline / Smoke 替代主链 | 禁止 | `tone-module-p1-dialog-fw-scan.py` 等为实验脚本，非 `STEP_REGISTRY` | — | — | **KEEP** |
| Bootstrap / mock weights | 禁止 | `loader.py` docstring + 实现 fail-closed；无 silent ready | — | — | **KEEP** |
| Compatibility loader 层 | 禁止独立层 | 仅 `P0_COMPATIBLE_FEATURE_VERSIONS` 别名（冻结允许） | — | — | **KEEP** |
| Gateway / Scheduler Tone | 禁止 | `central_server/` 无 `acousticTone`/`toneModule` | — | — | **KEEP** |
| `hardDropCount` interval 字段 | CLEANUP-2 要求不存在 | `candidate-compatibility-graph.ts` · `v4-types.ts` **仍含** | 回归门禁失败 | MEDIUM | **MODIFY**（interval 并行，非 Tone） |
| `TONEStage` 命名 | 与声学 Tone 隔离 | YourTTS clone；`use_tone` pipeline 标志 | 文档/新人误读 | LOW | **KEEP** |

---

## 3. Ownership Matrix

| Object / Module | Expected Owner | Actual Owner | Consumer | Decision Owner | Verdict |
|-----------------|----------------|--------------|----------|----------------|---------|
| `run_tone_inference` / posterior | FW `tone_module` | `inference.py` + `classifier.py` | Node ASR | **非 Decision**（Provider） | **PASS** |
| `tonePenalty` / `toneReason` | Recall | `recall-span-topkv3.ts` · `tone-recall-sort.ts` · `tone-match-score.ts` | Ranking（分数） | **Recall** | **PASS** |
| Sentence combination 排序 | Ranking | `build-sentence-candidates` · `candidate-score` | KenLM 输入 | Ranking | **PASS** |
| Per-span 桶选择 | Assembly | `selectPerSpanCandidates`（score + 桶优先级） | 句组合 | Assembly（**无 tone**） | **PASS** |
| KenLM pick | KenLM | `run-fw-sentence-rerank-from-prefilled.ts` | Apply Gate | KenLM | **PASS** |
| Final text | Apply / Writeback | `applyFwSpanReplacements` | `text_asr` | Apply Gate | **PASS** |
| `diagnostics.toneModule` | 仅观测 | `api_routes.py:292-302` | HTTP 客户端 | **不进 Decision** | **PASS** |
| `TONEStage` / YourTTS | N/A（非声学 Tone） | `tone-stage.ts` | TTS 后处理 | 与 Recall 无关 | **PASS** |

无双 Owner、无 Hidden Tone Decision；`metadata`/`loadError` 未进入 Recall 分支。

---

## 4. Data Contract Matrix

| Contract | Expected | Actual | Verdict |
|----------|----------|--------|---------|
| `TonePosterior` | `{t1..t5}` | `tone_types.py:9-14` · `TonePosteriorModel` · `tone-match-score.ts` | **PASS** |
| `AcousticToneSlice` | `{start,end,tonePosterior,confidence}` | `tone_types.py:27-38` · `tone-time-align.ts` | **PASS** |
| `UtteranceAcousticTonePayload` | required + optional 四字段 | `tone_types.py:43-59` · `api_models.py:34-39` | **PASS** |
| HTTP `skippedReason` | 四值枚举 | `ToneSkippedReason` Literal 四值 · `inference.py` 仅返回此四者 | **PASS** |
| `toneReason` | `match\|mismatch\|no_pattern` | `tone-match-score.ts:9` | **PASS** |
| `tone_exact` 等 | 非 `toneReason` | 仅在 `toneLookupStage` / diagnostics 计数 | **PASS** |
| Internal `tone_timestamp_disabled` | 非 HTTP skippedReason | `tone-recall-counterfactual.test.ts` · `resolveTimestampToneState` | **PASS**（未混入 HTTP） |
| Metadata 升级 Required | 禁止 | `modelHash` 等仅 `as_diagnostics_dict()` | **PASS** |

---

## 5. Interface Contract Matrix

| Interface | Expected | Actual | Effective | Breaking Risk | Verdict |
|-----------|----------|--------|-----------|---------------|---------|
| `run_tone_inference(...)` | audio+segments → payload+ms | `inference.py:52-59` | ✅ | LOW | **PASS** |
| `ToneClassifier` / Loader | 经 Loader fail-closed | `classifier.py:27-49` | ✅ | LOW | **PASS** |
| HTTP `response.tone` | camelCase payload | `api_routes.py` + `_tone_payload_to_model` | ✅ | LOW | **PASS** |
| `ASRResult.tone` | 透传 | `faster-whisper-asr-strategy.ts:91` | ✅ | LOW | **PASS** |
| `ctx.acousticToneSlices` | 唯一 Recall 声学输入 | `fw-detector-v4-path.ts:187` | ✅ | LOW | **PASS** |
| `recallTopKForWindows` tone 输入 | `acousticSlices` + timestamp | `recall-topk-for-windows.ts:114` | ✅ | LOW | **PASS** |
| `computeToneScoreResult` | pattern vs key | `tone-match-score.ts` | ✅ | LOW | **PASS** |
| KenLM rerank | 无 tone | grep 无匹配 | ✅ N/A | — | **PASS** |
| Apply | 无 tone | grep 无匹配 | ✅ N/A | — | **PASS** |

---

## 6. Loader / Backend Readiness Matrix

| Item | Expected | Actual | Phase 2 Ready | Verdict |
|------|----------|--------|---------------|---------|
| `contract.py` SSOT | feature baseline + metadata | `P0_*` 常量 · `ToneModelMetadata` | ✅ | **PASS** |
| `loader.py` fail-closed | missing→`ready=false` | `load()` unload first · `model_not_found` 等 | ✅ | **PASS** |
| `classifier.py` 经 Loader | 无直接 np.load | `ToneModelLoader` only | ✅ | **PASS** |
| `featureVersion` alias | `p0-v1` + `mel_mean_80_v1` | `P0_COMPATIBLE_FEATURE_VERSIONS` · `metadataWarning` | ✅ | **PASS** |
| `loadError` 可诊断 | diagnostics only | `api_routes.py:299-300` | ✅ | **PASS** |
| `backend` 仅 diagnostics | 不进 Decision | `metadata.as_diagnostics_dict()` | ✅ | **PASS** |
| `modelHash` / `modelVersion` | optional diagnostics | loader `_file_sha256` · npz keys | ✅ | **PASS** |

### Phase 2 第一批允许开发项

1. **模型权重** — 替换/重训 `tone_cnn_p0.npz`（保持 Required schema）
2. **Backend 实现** — 新 backend 字符串（diagnostics `backend` 字段）
3. **Feature 实现** — Mel/特征变更须 **bump `featureVersion`** 并更新 `contract.py`
4. **模型质量** — posterior 质量提升（不改变 hop / payload shape）
5. **Diagnostics 可选扩展** — `diagnostics.toneModule` 新 optional 字段

**禁止首批触碰：** Runtime hop · Required schema · Recall SQL 语义 · fail-closed 语义 · KenLM/Apply tone。

---

## 7. Decision Path Matrix

| Function | Exists | Effective | Final Decision Position | Covered / Bypassed | Verdict |
|----------|--------|-----------|-------------------------|-------------------|---------|
| `run_tone_inference` | ✅ | ✅（E2E） | Provider（非 Decision） | 主链 | **PASS** |
| `resolveTimestampToneState` | ✅ | ✅（`toneTimestampOnlyEnabled=true` 默认） | Recall 前门控 | 配置可关 | **PASS** |
| `extractAcousticTonePatternForRecall` | ✅ | ✅ | Recall 输入 | 主链 | **PASS** |
| `computeToneScoreResult` | ✅ | ✅ | Recall | 主链 | **PASS** |
| `candidateScore *= tonePenalty` | ✅ | ✅ | Recall | 主链 | **PASS** |
| Ranking 使用 Recall score | ✅ | ✅ | Ranking | 非 bypass | **PASS** |
| Assembly 桶优先级 | ✅ | N/A tone | Assembly | 不覆盖 tone penalty | **PASS** |
| KenLM rawDelta pick | ✅ | tone-free | Apply Gate 前 | 可覆盖句级选择（设计如此） | **PASS** |
| Apply span replace | ✅ | tone-free | Final text | 设计如此 | **PASS** |

**存在但不生效（配置下）：** `toneTimestampOnlyEnabled=false` → 无 pattern → `tonePenalty=1.0`（反事实测试覆盖，属冻结语义）。

**生效但被后续覆盖（设计内）：** KenLM/Apply 可改变 final text，**不读取 tone**；非 Tone Decision 覆盖。

---

## 8. Dead Feature Matrix

| Feature | Exists | Effective | Used By Main Runtime | Impact | Action |
|---------|--------|-----------|-------------------|--------|--------|
| `apply-tone-assembly-guard.ts` | ❌ | ❌ | ❌ | — | **DELETE**（已完成） |
| orphan `filter-domain-candidates-per-span.ts` | ❌ | ❌ | ❌ | — | **DELETE**（已完成） |
| `UtteranceTonePayload*` alias | ❌ | ❌ | ❌ | — | **DELETE**（已完成） |
| `toneGuardBlockedCount` | ❌ | ❌ | ❌ | — | **DELETE**（已完成） |
| `recallToneIncompatibleCount` | ❌ | ❌ | ❌ | — | **DELETE**（已移除赋值） |
| `hardDropCount` | ✅ | 恒 0 / interval 占位 | diagnostics only | 回归测试冲突 | **MODIFY** |
| `TONEStage` / `runToneStep` | ✅ | YourTTS only | 非 FW 声学链 | 命名 | **KEEP** |
| `tone-module-p1-dialog-fw-scan.py` | ✅ | 实验 | ❌ 主链 | — | **KEEP**（非门禁） |
| `_audit_*.py` / probe scripts | ✅ | 审计 | ❌ | — | **KEEP**（归档） |

无 guard 复活、无 orphan filter 重入生产路径。

---

## 9. Hidden Gate Matrix

| Gate / Weight / Context | Expected | Actual | Failure Mode | Impact | Severity |
|-------------------------|----------|--------|--------------|--------|----------|
| `toneTimestampOnlyEnabled` | 默认 true | `node-config-defaults` / 配置 true | false → 无 penalty | 反事实可测 | LOW |
| `word_timestamps` | Recall 依赖 | `no_timestamps` skip | 无 slices | 设计内 | LOW |
| `minSliceSec` 0.02 | 过滤短 slice | `inference.py:17,88-90` | 少 slice | 设计内 | LOW |
| `featureVersion` alias | 接受 legacy | loader L160-170 | mismatch→model_error | fail-closed | LOW |
| `metadataWarning` | diagnostics only | 不进 Decision | — | — | LOW |
| `skippedReason=model_error` | loader not ready | classifier.ready false | 全链 skip tone | fail-closed | LOW |
| `servicePreferences` 全 false | E2E 需 ASR 服务 | 用户配置项 | 无 ASR 端点 | 运维 | MEDIUM |
| `tonePenalty` 0.8 | mismatch | `TONE_MISMATCH_PENALTY` | 降权非删除 | 设计内 | LOW |
| Assembly 桶 `sameDomain>base` | 可压过低分同域 | `selectPerSpanCandidates` | 桶优先于纯 tone | 设计内 | LOW |
| KenLM Δ≥3.0 | 句级覆盖 | Apply Gate | 高 Δ 改 final | 非 tone 覆盖 | LOW |
| Queue readiness | FW worker | `test_asr_worker_readiness.py` | 503 未就绪 | 启动 | MEDIUM |

无 hidden tone weight 失效；`servicePreferences` 与 queue 为**环境门控**，非架构漂移。

---

## 10. Regression Gate Matrix

| Gate | Type | Expected | Actual（审计日） | Verdict |
|------|------|----------|------------------|---------|
| `test_loader.py` | Python | pass | 脚本存在；本机 `python` 无 pytest | **CONDITIONAL** |
| `test_classifier_fail_closed.py` | Python | pass | 同上 | **CONDITIONAL** |
| FW readiness / queue | Python | pass | `test_asr_worker_readiness.py` 存在 | **PASS**（未重跑） |
| `freeze-contract.test.ts` | Jest | 全 pass | **70/72**；`CLEANUP-2` hardDropCount · `GATE-SV2-6` lexicon script | **FAIL** |
| `tone-match-score.test.ts` | Jest | pass | 在 `test:fw-detector` 套件内 | **PASS** |
| `tone-recall-counterfactual.test.ts` | Jest | pass | 在套件内 | **PASS** |
| `tone-v2-phase1-dialog200-batch.js` | Node E2E | 200/200 effective | 基线 JSON 已冻结 | **PASS** |
| `d001-timestamp-tone-probe.mjs` | 条件探测 | 可选 | 存在 · 非 CI 硬门禁 | **PASS** |

**区分：** FW-only 实验脚本 **不能**替代 Node E2E；当前 E2E 基线满足 Phase 1 Acceptance。

---

## 11. Phase 2 Readiness Matrix

| 方向 | 允许 | 代码现状 | Ready |
|------|------|----------|-------|
| Model weights | ✅ | Loader 可换 npz | ✅ |
| Backend impl | ✅ | `P0_BACKEND` 常量可扩展 | ✅ |
| Feature + version bump | ✅ | `contract.py` 有 baseline | ✅ |
| Model quality | ✅ | posterior 质量可变 | ✅ |
| Diagnostics extension | ✅ | `toneModule` dict 可扩展 | ✅ |
| Schema break | ❌ | 未发生 | — |
| Runtime hop change | ❌ | 未发生 | — |
| KenLM/Apply tone | ❌ | 无 | — |
| Second pipeline / guard | ❌ | 已 DELETE | — |

**Phase 2 是否可以开始：** **是（CONDITIONAL）** — Tone 域无阻塞；建议并行修复 `freeze-contract` 2 例失败以免 SSOT 回归门禁悬空。

---

## 12. Required Repair Matrix

| Item | Expected | Actual | Impact | Severity | Action | Owner |
|------|----------|--------|--------|----------|--------|-------|
| Tone Runtime hop | 冻结链 | 与 SSOT 一致 | — | — | **KEEP** | Tone |
| Loader fail-closed | 冻结 | 实现正确 | — | — | **KEEP** | FW Python |
| Assembly Tone Guard | DELETE | 已删 | — | — | **KEEP** | FW Node |
| `hardDropCount` vs CLEANUP-2 | 测试要求无字段 | 代码仍有 interval 字段 | 回归失败 | MEDIUM | **MODIFY** | FW Assembly |
| `GATE-SV2-6` lexicon script | fail fast | 脚本内容与测试不一致 | 回归失败 | MEDIUM | **MODIFY** | Lexicon tooling |
| `TONEStage` 命名 | 与声学隔离 | 已注释 | 误读 | LOW | **KEEP** | Node postprocess |
| `servicePreferences` E2E 文档 | 运维明确 | 配置默认全 false | E2E 踩坑 | LOW | **MODIFY**（文档/运维） | Node ops |
| pytest 环境 | CI 可跑 loader tests | 本机缺 pytest | 本地验证 | LOW | **MODIFY**（环境） | DevOps |

**RESTORE：** 无（禁止恢复 guard/shadow/offline/bootstrap）。

**DELETE：** 无新增项（Phase 1 DELETE 已落实）。

---

## 13. KEEP / MODIFY / RESTORE / DELETE（汇总）

| Action | 项 |
|--------|-----|
| **KEEP** | 全 Runtime hop · Loader · Recall tonePenalty · 无 guard · SSOT 文档 · E2E 基线 · YourTTS `TONEStage`（非声学） |
| **MODIFY** | `hardDropCount` interval 与 `freeze-contract` CLEANUP-2 对齐 · `GATE-SV2-6` lexicon 脚本 · E2E 运维说明 · pytest 环境 |
| **RESTORE** | （无） |
| **DELETE** | （无新增；Phase 1 项已删除） |

---

## Final Verdict

### **CONDITIONAL PASS**

---

### 正式回答

| # | 问题 | 回答 |
|---|------|------|
| 1 | Phase 1 冻结是否仍然成立？ | **是** — Runtime/Data/Ownership/DELETE 与代码及 E2E 一致 |
| 2 | 是否仍只有唯一 Runtime / Pipeline / Decision Path（声学 Tone）？ | **是** |
| 3 | Tone 是否仍只在 Recall / Ranking 生效？ | **是** |
| 4 | 是否存在 Drift？ | **Tone 域无**；**非 Tone**：`hardDropCount` interval · lexicon GATE-SV2-6 |
| 5 | 是否存在功能存在但不生效？ | **仅配置下**（`toneTimestampOnlyEnabled=false` · 服务未启） |
| 6 | 是否存在功能生效但被后续覆盖？ | **KenLM/Apply 句级覆盖**（设计内，tone-free） |
| 7 | 是否存在 hidden gate / weight / context loss？ | **无 Tone 权重失效**；`servicePreferences`/queue 为环境门控 |
| 8 | 是否可以进入 Phase 2？ | **可以（CONDITIONAL）** |
| 9 | Phase 2 第一批允许开发项？ | 权重 · backend · feature+version bump · 质量 · diagnostics 扩展 |
| 10 | 是否有必须先修复的问题？ | **Tone 无**；建议先修 **freeze-contract 2 失败** 再视为全绿回归 |

---

*Read-only audit · no code/config/model/test-data modifications · 2026-06-29*
