# Tone V2 Phase 2-A — Development Plan Supplement Audit

**Date:** 2026-06-29  
**Type:** 只读审计（方案补充 · 非开发）  
**审计对象：** [Tone V2 Phase 2-A Development Plan.md](./Tone%20V2%20Phase%202-A%20Development%20Plan.md)  
**对照依据：** [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) · [Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md) · [Tone_V2_Phase2_PreDev_Code_Audit_2026_06_29.md](./Tone_V2_Phase2_PreDev_Code_Audit_2026_06_29.md) · 当前仓库代码

---

## Executive Summary

Phase 2-A 方案**方向与 Phase 1 冻结一致**：限定在 FW `tone_module` 内的 Registry / Backend / Metadata / Weight 演进，不触碰 Runtime hop、Recall Decision、Required Schema。与当前代码对照后，**尚无 Model Registry、Backend Dispatch 实现**（属预期空白，非漂移）。

方案存在 **12 项需补充的设计/验收缺口**、**5 项代码与冻结设计的隐含前提**、**4 项非 Tone 并行漂移**。无「guard 复活」或第二声学 Pipeline。

**方案可进入开发的前置条件：** 补齐 Registry 契约、Backend 抽象边界、`TONE_MODEL_PATH` 迁移策略、Diagnostics 字段命名、回归与切换验收细则。

**审计裁决：CONDITIONAL PASS**（方案原则正确，实施前须吸收本补充清单）

---

## 1. 与冻结设计一致性（总览）

| 维度 | Phase 2-A 方案 | 当前代码 | 一致性 |
|------|----------------|----------|--------|
| Runtime hop | KEEP | `inference.py` → `asr-step` → `fw-detector-v4-path` → Recall | ✅ |
| Required Data Contract | KEEP | `tone_types.py` · `types.ts` 四值 `skippedReason` | ✅ |
| Ownership | KEEP | Decision 仅在 Recall；Assembly/KenLM/Apply tone-free | ✅ |
| Loader fail-closed | KEEP | `loader.py` unload-first · `model_error` | ✅ |
| Model Registry | MODIFY（新增） | **不存在** | ⏳ 待开发 |
| Backend Dispatch | MODIFY（新增） | **仅 `numpy_p0` 内联于 `classifier.py`** | ⏳ 待开发 |
| 识别质量 / 训练 | 本阶段禁止 | `train_tone_cnn.py` 存在但**未接 Runtime** | ✅ |

---

## 2. 补充项清单

### 2.1 设计缺失（方案未写清，开发前必须补）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **S2A-01** | **Model Registry 数据契约**：文件路径（如 `tone_module/registry.json` 或 Python 模块）、条目字段（`modelId` · `path` · `backend` · `featureVersion` · `modelVersion` · `trainingVersion` · `modelHash`）、默认条目、选择算法（env 覆盖？单 active？） | 设计缺失 | **HIGH** | `loader.py` · `config.py` · 部署 | **MODIFY** 方案 + 实现 Registry |
| **S2A-02** | **Backend Registry vs Model Registry**：Target List 同时列两者，正文仅描述 Model Registry；须明确 Backend Registry 是否为 `backend_id → impl class` 静态表，与 Model Registry 关系 | 设计缺失 | **HIGH** | 模块边界 | **MODIFY** 方案：定义两层或合并为一层 |
| **S2A-03** | **Backend 抽象接口**：`predict_batch(mel: ndarray) -> ndarray(N,5)`；Feature 仍由 `mel.py` + `inference.py` 负责；禁止 Backend 读 registry 参与 Decision | 设计缺失 | **HIGH** | `classifier.py` 重构 | **MODIFY** |
| **S2A-04** | **`TONE_MODEL_PATH` 迁移策略**：当前 `config.py` + env 为隐式单模型选择（`get_tone_loader().load(None)`）；Registry 引入后是否保留 env 覆盖、优先级顺序 | 代码实现 + 设计缺失 | **MEDIUM** | 部署/运维 | **MODIFY**（文档化优先级：`TONE_MODEL_PATH` > registry default？） |
| **S2A-05** | **进程内单例与切换语义**：`get_tone_loader()` 首次 import 即 `load(None)`；`get_tone_classifier()` 缓存实例。方案写「Backend 可切换」但未定义：热切换 vs 重启 worker | 代码实现 + 设计缺失 | **MEDIUM** | FW worker · queue recovery | **MODIFY** 方案：Phase 2-A 建议 **启动时选定 + 切换需 worker 重启** |
| **S2A-06** | **Diagnostics 样例与 Phase 1 字段对齐**：方案样例含 `ready` · `loadMs`；当前 HTTP 为 `toneEnabled` · `tone_inference_ms` · `loadError`（无 `ready`/`loadMs`） | 设计缺失 | **MEDIUM** | `api_routes.py` · 批测解析 | **MODIFY** 样例或明确新增 optional 字段不替换既有 |
| **S2A-07** | **`trainingVersion` / `dataset` / `buildTime` 挂载点**：`ToneModelMetadata` 尚无这些字段；须约定来自 npz / registry / 仅 diagnostics | 设计缺失 | **LOW** | `contract.py` · loader | **MODIFY** optional 扩展 |
| **S2A-08** | **Weight Upgrade 与 `featureVersion` 分离**：`tone_cnn_p0.npz → tone_cnn_p1.npz` 若仅换权重，`featureVersion` 保持 `p0-v1`；若改 Mel 须 bump。方案未写验收断言 | 设计缺失 | **MEDIUM** | Loader 测试 | **MODIFY** 验收用例 |
| **S2A-09** | **未知 `backend` fail-closed**：冻结允许 `backend unsupported` → `model_error`；方案须写明非法 backend 字符串行为 | 设计缺失 | **MEDIUM** | loader dispatch | **MODIFY** |
| **S2A-10** | **可选依赖策略**：Torch/ONNX/TensorRT 是否 optional import、缺失时 fail-closed 而非 bootstrap | 设计缺失 | **MEDIUM** | 部署 · CI | **MODIFY** |
| **S2A-11** | **Node 零改动边界**：Phase 2-A 应显式声明 Node 仅透传 HTTP 新 optional diagnostics，**无** `electron-node` 主链代码变更（除非 types 注释） | 设计缺失 | **LOW** | 范围控制 | **KEEP** 写入方案 |
| **S2A-12** | **Registry 不得进入 Decision 的静态门禁**：类似 `freeze-contract` 的 import 边界测试（registry 模块不可被 `recall-topk` / Node FW 引用） | 设计缺失 | **HIGH** | 架构合规 | **MODIFY** 新增测试 |

### 2.2 代码实现 / 隐含前提（方案应吸收）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **S2A-C01** | **Feature 常量双份 SSOT**：`contract.py`（`P0_*`）与 `mel.py`（`SAMPLE_RATE` 等）重复；Phase 2 `featureVersion++` 时易漂移 | 架构漂移 | **MEDIUM** | `mel.py` · loader 校验 | **MODIFY**：`mel.py` 引用 `contract.P0_FEATURE_BASELINE` 或单一导出 |
| **S2A-C02** | **`metadata.backend` 当前恒为 `numpy_p0`**：`_read_npz_metadata` 不读 npz 内 backend；Registry 引入后 backend 应以 **registry 条目** 为准还是 npz 元数据为准 | 代码实现 | **MEDIUM** | Loader · diagnostics | **MODIFY** 方案裁决 |
| **S2A-C03** | **`P0_COMPATIBLE_FEATURE_VERSIONS`（`mel_mean_80_v1`）**：Phase 1 冻结允许的 legacy alias；Phase 2-A 未说明是否保留至 P1 权重全面迁移 | 代码实现 + 冻结 | **LOW** | loader | **KEEP** 直至显式废弃 |
| **S2A-C04** | **Classifier 与 NumPy 推理耦合**：`predict_batch` 直接 matmul；Backend 扩展必重构为 dispatch，不可在 `classifier.py` 内堆 if-backend | 代码实现 | **HIGH** | Phase 2-A 核心 | **MODIFY** |
| **S2A-C05** | **E2E 环境前提**：`servicePreferences` 须启用 `faster-whisper-vad`；与 Registry 无关但 dialog_200 回归依赖 | 测试发现 | **MEDIUM** | 验收 | **MODIFY** 写入 Regression List |

### 2.3 测试发现 / 并行漂移（非 Phase 2-A 核心但影响全量回归）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **S2A-T01** | `freeze-contract` **CLEANUP-2**：`hardDropCount` 仍存在于 interval assembly 代码，与测试期望冲突 | 测试发现 | **MEDIUM** | FW assembly | **MODIFY**（并行，非 Tone） |
| **S2A-T02** | `freeze-contract` **GATE-SV2-6**：lexicon `build-for-electron.mjs` 与测试不一致 | 测试发现 | **MEDIUM** | lexicon 脚本 | **MODIFY**（并行） |
| **S2A-T03** | Python loader 测试需 **FW venv + pytest**；方案 Regression List 未写执行环境 | 测试发现 | **LOW** | CI/本地 | **MODIFY** |
| **S2A-T04** | Phase 2-A 写「dialog_200 无回归」：应量化 **`tone_effective_chain_cases === N`** 与 `model_error === 0`，非仅 CER | 设计缺失 | **MEDIUM** | 验收 | **MODIFY** |

### 2.4 功能存在 / 生效 / 覆盖（Exists vs Effective）

| 项 | Exists | Effective | 主链路 | 结论 |
|----|--------|-----------|--------|------|
| Model Registry | ❌ | ❌ | ❌ | 待建；非漂移 |
| Backend Dispatch | ❌（仅 numpy 内联） | ✅（numpy） | ✅ | Phase 2-A 扩展点 |
| `train_tone_cnn.py` | ✅ | ❌ Runtime | ❌ | **KEEP** 离线；禁止接入 worker |
| `tone_module/_audit_*` | ✅ | ❌ | ❌ | 审计产物；**KEEP** 归档或 Phase 后 DELETE |
| `TONEStage` / YourTTS | ✅ | ✅（TTS 域） | ❌ 声学链 | **KEEP**；与 2-A 无关 |
| Recall `tonePenalty` | ✅ | ✅（E2E） | ✅ | 冻结；2-A 不得改 |
| KenLM / Apply 覆盖 Recall | ✅ | ✅（句级） | ✅ | 设计内 tone-free 覆盖 |

**无**「声学 Tone 实现但未进主链」或「guard 复活」。

---

## 3. 架构漂移核对（相对 Phase 2-A + Phase 1 Freeze）

| 漂移项 | 方案要求 | 代码现状 | 判定 | Action |
|--------|----------|----------|------|--------|
| 第二声学 Pipeline | 禁止 | 无 | ✅ | **KEEP** |
| Assembly Tone Guard | 禁止恢复 | 已 DELETE | ✅ | **KEEP** |
| Bootstrap / mock weights | 禁止 | fail-closed | ✅ | **KEEP** |
| Registry 参与 Recall | 禁止 | 无 registry | ✅ | **MODIFY**（开发时加门禁） |
| Backend 输出 Decision | 禁止 | 仅 posterior | ✅ | **KEEP** |
| Feature 进 Backend | 禁止 | mel 在 `inference.py` | ✅ | **KEEP** |
| `mel.py` / `contract.py` 双 SSOT | 未提及 | 重复常量 | ⚠️ | **MODIFY** |
| Node 独立声学 Tone Step | 禁止 | 未注册 STEP_REGISTRY | ✅ | **KEEP** |

---

## 4. 方案 Regression List 补充（建议写入 Phase 2-A）

在方案现有列表基础上，**必须补充**：

| 类别 | 门禁 | 通过标准 |
|------|------|----------|
| **FW Python** | `test_loader.py` | 含 registry 路径选择 · unknown backend · fail-closed |
| **FW Python** | `test_classifier_fail_closed.py` | 仍全 pass |
| **FW Python** | **新增** `test_registry_boundary.py`（建议） | registry 模块不被 recall/node 引用 |
| **FW Python** | **新增** backend dispatch 单测 | 至少 `numpy_p0` + 1 stub backend 拒绝路径 |
| **Node Jest** | `tone-recall-counterfactual.test.ts` | 仍 pass |
| **Node Jest** | `freeze-contract` GATE-RANK-04 | 仍无 guard |
| **Node E2E** | `tone-v2-phase1-dialog200-batch.js` | `tone_effective_chain === evaluated`；`model_error === 0` |
| **条件** | `d001-timestamp-tone-probe.mjs` | 可选；timestamp 对齐抽检 |
| **环境** | FW venv pytest · Node services 已启 | 文档化 |

**禁止**用 FW-only HTTP scan 替代 Node E2E。

---

## 5. Acceptance Criteria 补充（方案 §Acceptance 扩展）

开发完成除方案所列外，还须证明：

1. **Registry 选择不改变** `UtteranceAcousticTonePayload` Required 字段形状与语义。
2. **切换 backend / 权重后** `run_tone_inference` 输出仍为 `(N,5)` posterior，经 `tone-match-score` 无需改接口。
3. **`diagnostics.toneModule` 新字段**均为 optional；Node `extra.utterance_tone` 不因缺失新字段而失败。
4. **`featureVersion` 未变时**，换 `modelVersion` / 权重文件不触发 Recall 侧任何代码变更。
5. **`featureVersion` 变更时**，旧权重 **必须** fail-closed（已有 `test_feature_mismatch_fail_closed` 模式）。
6. **反事实**：`toneTimestampOnlyEnabled=false` 仍使 penalty 失效（与 Phase 1 相同）。
7. **Architecture Compliance**：对 `electron-node/main/src/fw-detector` 与 `lexicon` 做 grep，确认无 `tone_module.registry` 或等价 import。

---

## 6. Required Repair Matrix（审计建议，非本轮实施）

| Item | Expected | Actual | Severity | Action | Owner |
|------|----------|--------|----------|--------|-------|
| Phase 2-A Registry 契约 | 有 SSOT | 无 | HIGH | **MODIFY** 方案 | Tone FW |
| Backend 抽象层 | dispatch | numpy 内联 | HIGH | **MODIFY** 代码（2-A） | Tone FW |
| `mel.py` / `contract.py` | 单 SSOT | 双份常量 | MEDIUM | **MODIFY** | Tone FW |
| `TONE_MODEL_PATH` | 与 registry 共存规则 | 仅 env | MEDIUM | **MODIFY** 方案 | Tone FW |
| Diagnostics 样例 | 与 Phase 1 兼容 | 字段名漂移 | MEDIUM | **MODIFY** 方案 | Docs |
| `hardDropCount` / GATE-SV2-6 | 全绿回归 | 2 失败 | MEDIUM | **MODIFY** 并行 | FW/Lexicon |
| `train_tone_cnn.py` | 离线 | 未接 Runtime | LOW | **KEEP** | — |
| `_audit_*` 产物 | 非 SSOT | 在 tone_module | LOW | **KEEP** 归档 | — |
| Assembly Tone Guard | DELETE | 已删 | — | **KEEP** | — |
| Shadow/Offline Tone Runtime | 禁止 | 无 | — | **KEEP** | — |

**RESTORE：** 无（禁止恢复 guard / bootstrap / compatibility runtime）。

**DELETE（本阶段方案已声明无新增 DELETE）：** 无强制项；`_audit_*` 可在后续清理阶段 DELETE，**不纳入 2-A**。

---

## 7. Phase 2-A Target List 与代码差距

| Target | 代码现状 | 差距 |
|--------|----------|------|
| Backend Registry | 无 | 需新建；与 Model Registry 关系待 S2A-02 |
| Backend Dispatch | `classifier.py` numpy only | 需抽象 + 注册表 |
| Model Registry | 无（`TONE_MODEL_PATH` 隐式） | 需新建 |
| Metadata Extension | `ToneModelMetadata` 部分字段 | 扩展 optional |
| Weight Upgrade | loader 支持换 path | 需 registry 绑定 + 测试 |
| Diagnostics Extension | `api_routes.py` 合并 dict | 加字段即可 |

**不得修改（方案正确）：** Runtime · Decision · Required Schema · Recall · Node hop。

---

## 8. 最终裁决

### **CONDITIONAL PASS**

| # | 问题 | 回答 |
|---|------|------|
| 方案是否与 Phase 1 冻结冲突？ | **否** — 边界清晰 |
| 当前代码是否已满足 Phase 2-A 目标？ | **否** — Registry/Backend 待建 |
| 是否存在需补充的设计/验收？ | **是** — 见 §2（16 项） |
| 是否存在 Tone 架构漂移？ | **否** — 仅 feature 双 SSOT 与 metadata backend 硬编码 |
| 是否可先开发再补文档？ | **不建议** — S2A-01/02/03/12 为 HIGH，应先写入方案或 ADR |
| RESTORE guard/shadow？ | **禁止** |

---

## 9. 建议纳入 Phase 2-A 方案的最小补充段落（摘要）

开发启动前，将以下内容写入 Phase 2-A 正文或链接 ADR：

1. **Registry JSON/schema + 选择优先级**（env `TONE_MODEL_PATH` / `TONE_MODEL_ID` / default entry）。
2. **Backend 接口** + **Backend 注册表**与 Model Registry 关系图。
3. **切换策略**：Phase 2-A 仅保证启动加载与 fail-closed；热切换列为 Out of Scope。
4. **Diagnostics 字段表**：Phase 1 保留字段 + Phase 2-A 新增 optional（`trainingVersion` · `loadMs` 等）。
5. **Regression 量化指标**：`tone_effective_chain` + `model_error` + counterfactual + registry boundary test。
6. **Feature SSOT 收敛**：`mel.py` ← `contract.py`。
7. **Node 无改动声明**（除 types 注释可选）。

---

*Read-only supplement audit · no code/config/model/test-data modifications · 2026-06-29*
