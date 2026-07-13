# Tone V2 Phase 2 — Restart Pre-Development Code Audit

**Date:** 2026-06-29  
**Type:** 只读审计（Phase 2 重启 · Single Service / Single Model）  
**审计规格：** [Tone V2 Phase 2A_pre audit.md](./Tone%20V2%20Phase%202A_pre%20audit.md)  
**Authority:** [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) · [Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md) · [Tone_V2_Phase2_PreDev_Code_Audit_2026_06_29.md](./Tone_V2_Phase2_PreDev_Code_Audit_2026_06_29.md)

**E2E 基线：** `electron_node/electron-node/tests/experiments/tone-v2-phase1-dialog200-batch-result.json`（200/200 `tone_effective_chain`）

---

## Executive Summary

在 **废弃 Model Registry / Backend Registry / 模型切换** 后，按 **Single Service / Single Model** 原则重审当前代码：

| 维度 | 结论 |
|------|------|
| Phase 1 冻结 Runtime / Contract / Ownership | ✅ **成立** |
| 代码符合单服务单模型 | ✅ **是** — `TONE_MODEL_PATH` + 单例 Loader，无 registry/routing |
| Registry / switching 代码残留 | ✅ **无** |
| 废弃方案文档残留 | ⚠️ `Tone_V2_Phase2A_Development_Plan_Supplement_Audit_2026_06_29.md` 仍主张 Registry（**文档漂移**） |
| 回归门禁 | ⚠️ `freeze-contract` CLEANUP-2 失败（interval，非 Tone） |
| Phase 2 可重启 | ✅ **可以** |

**Final Verdict: CONDITIONAL PASS**

（Tone 域无阻塞；须归档废弃 Registry 方案文档、补齐 Phase 2 实施约束文档。）

---

## 1. Frozen Architecture Verification

### Frozen Architecture Matrix

| Hop | Expected | Actual | Effective | Impact | Severity | Verdict |
|-----|----------|--------|-----------|--------|----------|---------|
| FW Worker | `faster-whisper-vad:6007` | `service.json` · `api_routes.py` | ✅ | — | — | **PASS** |
| `run_tone_inference` | audio+timestamps→payload | `inference.py:52` · `api_routes.py:283` | ✅ | — | — | **PASS** |
| `UtteranceResponse.tone` | Required payload | `tone_types.py` · `api_models.py` | ✅ | — | — | **PASS** |
| `ASRResult.tone` | HTTP 透传 | `faster-whisper-asr-strategy.ts:91` | ✅ | — | — | **PASS** |
| `ctx.acousticToneSlices` | ASR step 写入 | `asr-step.ts:262-266` | ✅ | E2E | — | **PASS** |
| Recall | `tonePenalty` | `recall-span-topkv3.ts` · `recall-topk-for-windows.ts` | ✅ | E2E | — | **PASS** |
| Ranking | Recall score 排序 | `candidate-score` · `selectPerSpanCandidates` | ✅ | E2E | — | **PASS** |
| Assembly | 无 Tone Decision | `assemble-domain-aware-span-sets.ts` | ✅ N/A | — | — | **PASS** |
| KenLM | tone-free | `kenlm/` 无 tone | ✅ N/A | — | — | **PASS** |
| Apply | tone-free | `apply-span-replacements.ts` | ✅ N/A | — | — | **PASS** |

---

## 2. Phase 2 Direction Audit

### Phase 2 Direction Matrix（Single Service / Single Model）

| Candidate Direction | Allowed / Forbidden | Reason | Drift Risk | Verdict |
|---------------------|---------------------|--------|------------|---------|
| 单模型 artifact contract 加固 | **Allowed** | 与 `loader.py`/`contract.py` 现状一致 | LOW | **GO** |
| 单 backend adapter contract（无 routing） | **Allowed** | 可将 `numpy_p0` 抽为模块，**禁止**多 backend 选择 | MEDIUM | **GO** |
| 模型权重升级（新 npz，同 featureVersion） | **Allowed** | 换 `TONE_MODEL_PATH` + **服务重启** | LOW | **GO** |
| `featureVersion` 与 artifact 绑定验证 | **Allowed** | 已有 `P0_COMPATIBLE_FEATURE_VERSIONS` | LOW | **GO** |
| 训练数据 / benchmark 准备（离线） | **Allowed** | `train_tone_cnn.py` 已存在，未接 Runtime | LOW | **GO** |
| optional diagnostics 扩展 | **Allowed** | Phase 1 已允许 | LOW | **GO** |
| Model Registry | **Forbidden** | 重启规格明确禁止 | HIGH | **NO** |
| Backend Registry | **Forbidden** | 同上 | HIGH | **NO** |
| 模型切换 / hot reload / dispatch | **Forbidden** | 单实例单模型 | HIGH | **NO** |
| 新模型同进程多实例加载 | **Forbidden** | 须新服务实例 | HIGH | **NO** |
| Required Schema / Runtime hop 变更 | **Forbidden** | Phase 1 冻结 | HIGH | **NO** |

**Phase 2 真实起点：** 在现有 **单路径 Loader + numpy 内联推理** 上，做 **artifact/adapter 契约加固** 与 **离线质量准备**；新模型通过 **新 FW 服务实例 + 新 `TONE_MODEL_PATH`** 接入，而非进程内路由。

---

## 3. Architecture Drift Audit

### Drift Matrix

| Drift Item | Expected | Actual | Impact | Severity | Action |
|------------|----------|--------|--------|----------|--------|
| Model Registry 残留 | 无 | 代码**无** | — | — | **KEEP** |
| Backend Registry / dispatch | 无 | 代码**无**；`classifier.py` numpy 内联 | — | — | **KEEP**（可 **MODIFY** 为单 adapter 模块，非 registry） |
| `TONE_MODEL_ID` / active model | 无 | 代码**无** | — | — | **KEEP** |
| hot switch / reload 生产路径 | 无 | 仅 `reset_*_singleton` **测试用** | 误用风险 | LOW | **KEEP**（注释已标注 test-only） |
| 废弃 Registry **文档** | 不得作 SSOT | `Tone_V2_Phase2A_Development_Plan_Supplement_Audit_*.md` 仍推荐 Registry | 开发误导 | **HIGH** | **DELETE** 或移入 archive + README 声明废弃 |
| Assembly Tone Guard | DELETE | 文件不存在 | — | — | **KEEP** |
| 第二声学 Pipeline | 无 | 仅 `/utterance` tone | — | — | **KEEP** |
| `TONEStage` / YourTTS | 非声学 Tone | 未进 `STEP_REGISTRY` | 命名混淆 | LOW | **KEEP** |
| `mel.py` / `contract.py` 双份 feature 常量 | 单 SSOT | 两处重复 | feature bump 漂移 | MEDIUM | **MODIFY** |
| `hardDropCount` interval | CLEANUP-2 | 代码仍有字段 | 回归失败 | MEDIUM | **MODIFY**（并行） |

---

## 4. Single Service / Single Model Matrix

| Item | Expected | Actual | Effective | Drift Risk | Verdict |
|------|----------|--------|-----------|------------|---------|
| 一服务实例一模型 | 是 | `faster-whisper-vad` 单进程 | ✅ | — | **PASS** |
| 模型路径固定 | `TONE_MODEL_PATH` 或默认 npz | `config.py:197-198` · `loader._resolve_default_path` | ✅ | — | **PASS** |
| 模型选择逻辑 | 无 registry/无列表 | **无**；仅 path 解析 | ✅ | — | **PASS** |
| 多模型同时加载 | 禁止 | 单例 `_loader` 一份 weights | ✅ | — | **PASS** |
| backend routing | 禁止 | 无 dispatch；`P0_BACKEND` 常量 | ✅ | — | **PASS** |
| 运行时切换 | 禁止 | `load()` 可换 path 但生产 `load(None)` 一次；无 hot API | ✅ | — | **PASS** |
| 新模型接入方式 | 新服务实例 | Node `service.json` 可再起实例+不同 port+env | ✅ 运维模型 | LOW | **PASS** |
| `tone_module/config.py` | 审计清单列出 | **文件不存在**；配置在 `faster_whisper_vad/config.py` | 文档路径错误 | LOW | **MODIFY** 审计/方案路径 |

**结论：当前实现已符合 Single Service / Single Model，无需为合规而删除代码；Phase 2 应**加固**而非引入 registry。

---

## 5. Ownership Matrix

| Object / Module | Expected Owner | Actual Owner | Consumer | Decision Owner | Verdict |
|-----------------|----------------|--------------|----------|----------------|---------|
| Posterior | FW `tone_module` | `inference.py` | Node ASR | Provider only | **PASS** |
| `tonePenalty` | Recall | `recall-span-topkv3.ts` | Ranking | **Recall** | **PASS** |
| Sentence ranking | Ranking | `build-sentence-candidates` | KenLM | Ranking | **PASS** |
| Per-span 选择 | Assembly | `selectPerSpanCandidates` | 句组合 | Assembly（无 tone） | **PASS** |
| KenLM / Apply | LM / Replace | kenlm · apply | final text | tone-free | **PASS** |
| `metadata.backend` | diagnostics only | `as_diagnostics_dict()` | HTTP | 非 Decision | **PASS** |

---

## 6. Data Contract Matrix

| Contract | Expected | Actual | Verdict |
|----------|----------|--------|---------|
| `TonePosterior` | t1–t5 | `tone_types.py` · `types.ts` | **PASS** |
| `AcousticToneSlice` | 4 字段 | 一致 | **PASS** |
| `UtteranceAcousticTonePayload` | Required+optional | 一致；`sliceCount` 在 Node types | **PASS** |
| HTTP `skippedReason` | 四值 | `ToneSkippedReason` Literal | **PASS** |
| `toneReason` | 三值，Recall 级 | `tone-match-score.ts` | **PASS** |
| backend/model 进 Recall | 禁止 | grep 无引用 | **PASS** |

---

## 7. Interface Contract Matrix

| Interface | Expected | Actual | Effective | Breaking Risk | Verdict |
|-----------|----------|--------|-----------|---------------|---------|
| `run_tone_inference` | in/out 冻结 | `inference.py` | ✅ | LOW | **PASS** |
| Loader / Classifier 边界 | Loader 载权重 | `classifier` 经 `get_tone_loader()` | ✅ | LOW | **PASS** |
| HTTP / ASR / ctx hop | 冻结 | 与 Phase 1 相同 | ✅ | LOW | **PASS** |
| Recall tone 输入 | `acousticSlices` | `fw-detector-v4-path.ts:187` | ✅ | LOW | **PASS** |
| KenLM / Apply | 无 tone | 无参数 | ✅ | — | **PASS** |

---

## 8. Model / Backend Adapter Readiness Matrix

| Item | Current State | Phase 2 Ready | Notes |
|------|---------------|---------------|-------|
| 模型固定加载 | `TONE_MODEL_PATH` → `loader.load()` | ✅ | 符合单模型 |
| backend adapter | `numpy_p0` 内联于 `classifier.predict_batch` | ⚠️ | 可抽 **单** adapter 文件，**禁止** routing |
| metadata | `ToneModelMetadata` + npz optional keys | ✅ | 可扩展 optional |
| featureVersion 绑定 | loader 校验 + legacy alias | ✅ | **KEEP** alias |
| loadError diagnostics | `api_routes.py` | ✅ | |
| fail-closed | unload on error | ✅ | |
| Registry 残留 | 无 | ✅ | 无需「先清理 registry 代码」 |

### Phase 2 第一批允许开发项（重启后）

1. **单模型 artifact 契约文档化** — npz required keys · metadata optional keys · 与 `featureVersion` 绑定规则  
2. **`numpy_p0` 单 adapter 模块化**（重命名/抽文件，**无** dispatch 表）  
3. **权重升级 Runbook** — 新 npz → 设 `TONE_MODEL_PATH` → **重启** `faster-whisper-vad` 实例  
4. **新模型新实例 Runbook** — 复制服务定义 · 新 port · 新 env · Node 路由到新 endpoint（**非**进程内切换）  
5. **optional diagnostics** — `trainingVersion` 等（仅 HTTP）  
6. **离线** — `train_tone_cnn.py` / benchmark 数据集准备（不接 Runtime）

**禁止首批：** Registry · switching · hot reload API · 多 backend dispatch · Mel 变更不 bump `featureVersion`

---

## 9. Decision Path Matrix

| Function | Exists | Effective | Final Decision Position | Covered / Bypassed | Verdict |
|----------|--------|-----------|-------------------------|-------------------|---------|
| `run_tone_inference` | ✅ | ✅ E2E | Provider | 主链 | **PASS** |
| `computeToneScoreResult` | ✅ | ✅ | Recall | 主链 | **PASS** |
| `candidateScore *= tonePenalty` | ✅ | ✅ | Recall | 主链 | **PASS** |
| Ranking 用 Recall score | ✅ | ✅ | Ranking | 主链 | **PASS** |
| Assembly 桶优先 | ✅ | N/A tone | Assembly | 可压 tone 低分候选 | **PASS**（设计内） |
| KenLM pick | ✅ | tone-free | Apply Gate 前 | 句级覆盖 | **PASS**（设计内） |
| Apply | ✅ | tone-free | Final text | 设计内 | **PASS** |

---

## 10. Dead Feature Matrix

| Feature | Exists | Effective | Main Runtime | Impact | Action |
|---------|--------|-----------|--------------|--------|--------|
| Assembly guard / orphan filter | ❌ | ❌ | ❌ | — | **KEEP** deleted |
| `UtteranceTonePayload*` | ❌ | ❌ | ❌ | — | **KEEP** deleted |
| Model Registry 代码 | ❌ | ❌ | ❌ | — | **KEEP** |
| Registry **方案审计文档** | ✅ 文档 | ❌ 代码 | ❌ | 误导 Phase 2 | **DELETE**/archive |
| `train_tone_cnn.py` | ✅ | ❌ Runtime | ❌ | 离线 OK | **KEEP** |
| `tone_module/_audit_*` | ✅ | ❌ | ❌ |  clutter | **KEEP** 归档 |
| `reset_tone_loader_singleton` | ✅ | 测试 only | ❌ | — | **KEEP** |
| `TONEStage` YourTTS | ✅ | TTS 域 | ❌ 声学 | 命名 | **KEEP** |

---

## 11. Hidden Gate Matrix

| Gate / Weight / Context | Expected | Actual | Failure Mode | Impact | Severity |
|-------------------------|----------|--------|--------------|--------|----------|
| `toneTimestampOnlyEnabled` | 默认 true | config true | false→无 penalty | 反事实 | LOW |
| `word_timestamps` | Recall 依赖 | `no_timestamps` | 无 tone | 设计内 | LOW |
| `minSliceSec` 0.02 | 过滤短 slice | `inference.py` | 少 slice | 设计内 | LOW |
| `featureVersion` alias | `mel_mean_80_v1` | loader 接受 | mismatch→model_error | fail-closed | LOW |
| `TONE_MODEL_PATH` unset | 默认或 fail | 无文件→model_error | tone off | 部署 | MEDIUM |
| `servicePreferences` | E2E 需 FW | 可全 false | 无 ASR | E2E | MEDIUM |
| `tonePenalty` 0.8 | mismatch | 常量 | 降权 | 设计内 | LOW |
| KenLM Δ≥3 | 句级覆盖 | Apply Gate | 改 final | 非 tone | LOW |

---

## 12. Regression Gate Matrix

| Gate | FW / Node | Status（审计日） | Verdict |
|------|-----------|------------------|---------|
| `test_loader.py` | FW | 存在；本机缺 pytest | **CONDITIONAL** |
| `test_classifier_fail_closed.py` | FW | 同上 | **CONDITIONAL** |
| FW queue/readiness | FW | `test_asr_worker_readiness.py` | **PASS**（未重跑） |
| `freeze-contract` | Node | 70/72；CLEANUP-2 fail | **FAIL** |
| `tone-match-score` / counterfactual | Node | 在套件内 | **PASS** |
| dialog_200 E2E | Node | 200/200 effective 基线 | **PASS** |
| d001 probe | 条件 | `.mjs` 存在 | **OPTIONAL** |

---

## 13. 补充项清单（实施 Phase 2 前须吸收）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | Action |
|----|----------|------|------|----------|--------|
| **R2-01** | **正式 Phase 2 Development Plan**（非 pre-audit 提示词）：写明 Single Service / Single Model、新实例部署、禁止 registry | 设计缺失 | HIGH | 全体 | **MODIFY** 新建方案文档 |
| **R2-02** | **废弃并归档** `Tone_V2_Phase2A_Development_Plan_Supplement_Audit_2026_06_29.md`（Registry 路线） | 架构漂移（文档） | HIGH | SSOT | **DELETE** 或移 archive + README |
| **R2-03** | **`TONE_MODEL_PATH` 实例绑定契约**：启动时解析一次；变更须重启 worker；禁止运行时 API 切换 | 代码实现 | MEDIUM | 运维 · loader | **MODIFY** 写入 Phase 2 方案 |
| **R2-04** | **新模型 = 新服务实例** 操作说明（port/env/Node endpoint），非代码 registry | 设计缺失 | MEDIUM | 部署 | **MODIFY** |
| **R2-05** | **单 adapter 模块化边界**：允许 `backends/numpy_p0.py`；禁止 `get_backend(name)` 路由 | 设计缺失 | MEDIUM | classifier | **MODIFY** |
| **R2-06** | **`mel.py` ← `contract.py` SSOT 收敛** | 架构漂移 | MEDIUM | feature bump | **MODIFY** |
| **R2-07** | **权重升级验收**：同 `featureVersion` 换 npz + 重启后 dialog_200 `tone_effective_chain` 不降 | 设计缺失 | MEDIUM | 回归 | **MODIFY** |
| **R2-08** | **E2E 量化**：`tone_effective_chain === N` · `model_error === 0` | 测试发现 | MEDIUM | 验收 | **MODIFY** |
| **R2-09** | **审计清单路径修正**：`tone_module/config.py` → `faster_whisper_vad/config.py` | 设计缺失 | LOW | 文档 | **MODIFY** |
| **R2-10** | **`reset_*_singleton` 禁止生产调用** 门禁（lint/注释/测试） | 代码实现 | LOW | 防 hot-switch 误用 | **MODIFY** |
| **R2-11** | **CLEANUP-2 `hardDropCount`** 与 interval 对齐或改测试 | 测试发现 | MEDIUM | FW 回归 | **MODIFY** 并行 |
| **R2-12** | **pytest 执行环境**（FW venv）写入 Regression List | 测试发现 | LOW | CI | **MODIFY** |

---

## 14. Required Repair Matrix

| Item | Expected | Actual | Impact | Severity | Action | Owner |
|------|----------|--------|--------|----------|--------|-------|
| Phase 1 Runtime hop | 冻结 | 一致 | — | — | **KEEP** | — |
| Single model 代码形态 | 无 registry | 符合 | — | — | **KEEP** | Tone FW |
| 废弃 Registry 审计文档 | 不得指导开发 | 仍存在 | 误导 | HIGH | **DELETE**/archive | Docs |
| Feature 双 SSOT | 单一 | 重复 | drift | MEDIUM | **MODIFY** | Tone FW |
| interval `hardDropCount` | 测试绿 | 失败 | 回归 | MEDIUM | **MODIFY** | FW |
| Assembly guard | DELETE | 已删 | — | — | **KEEP** | — |
| Registry 代码 | 禁止 | 无 | — | — | **KEEP** | — |

**RESTORE：** 无。  
**DELETE：** 废弃 Registry 方案审计文档（非 Phase 1 冻结文档）。

---

## 15. Final Verdict

### **CONDITIONAL PASS**

| # | 问题 | 回答 |
|---|------|------|
| 1 | Phase 1 冻结是否仍然成立？ | **是** |
| 2 | 唯一 Runtime / Pipeline / Decision Path？ | **是** |
| 3 | 是否符合 Single Service / Single Model？ | **是**（代码已符合） |
| 4 | Registry / switching 残留？ | **代码无**；**文档有**废弃 Registry 审计稿 |
| 5 | Tone 仅 Recall/Ranking 生效？ | **是**（E2E 验证） |
| 6 | Architecture / Contract / Decision Drift？ | **Tone 域无**；文档与 interval 有非 Tone 项 |
| 7 | 功能存在但不生效？ | `train_tone_cnn` 离线；无声学 Tone 失效项 |
| 8 | 生效但被覆盖？ | KenLM/Apply 句级（设计内，tone-free） |
| 9 | hidden gate？ | `TONE_MODEL_PATH`/servicePreferences 运维门控 |
| 10 | 可否重新开始 Phase 2？ | **可以** |
| 11 | 第一批允许开发项？ | artifact 契约 · 单 adapter 模块化 · 权重/实例 Runbook · 离线 benchmark · optional diagnostics |
| 12 | 必须先修复？ | **Tone 无**；建议 **DELETE/归档 Registry 审计文档**；并行修 CLEANUP-2 |

---

*Read-only restart audit · Single Service / Single Model · 2026-06-29*
