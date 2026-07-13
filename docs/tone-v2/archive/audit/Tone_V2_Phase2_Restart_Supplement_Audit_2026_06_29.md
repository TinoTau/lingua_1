# Tone V2 Phase 2 Restart Supplement — Supplement Audit

**Date:** 2026-06-29  
**Type:** 只读审计（方案补充核对 · 非开发）  
**审计对象：** [Tone V2 Phase 2 Restart Supplement — Single Service Single Model.md](./Tone%20V2%20Phase%202%20Restart%20Supplement%20%E2%80%94%20Single%20Service%20Single%20Model.md)  
**对照：** [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) · [Tone_V2_Phase2_Restart_PreDev_Code_Audit_2026_06_29.md](./Tone_V2_Phase2_Restart_PreDev_Code_Audit_2026_06_29.md) · 当前代码

---

## Executive Summary

《Phase 2 Restart Supplement》**方向正确**：与 Phase 1 冻结及 **Single Service / Single Model** 重启裁决一致，明确禁止 Registry / switching，并列出合理的首批 Target List。

与**当前代码**对照：单模型形态已成立，但文档中 **Target List 多数尚未落地**（属预期开发项，非矛盾）。审计发现 **6 项方案内歧义/缺口**、**5 项代码与方案未对齐**、**3 项文档 SSOT 漂移**、**2 项测试/回归缺口**。

**无** Registry 代码残留、无 guard 复活、无声学 Tone 第二 Pipeline。

**审计裁决：CONDITIONAL PASS** — 方案可作为 Phase 2 开发依据，但须先吸收本补充清单（尤其 §5 职责边界、legacy featureVersion、新实例 Node 耦合、废弃文档处理）。

---

## 1. 与冻结设计一致性

| 维度 | Supplement | 代码现状 | 一致性 |
|------|------------|----------|--------|
| Runtime hop | KEEP | 未变 | ✅ |
| Required Data Contract | KEEP | `tone_types.py` · `types.ts` | ✅ |
| Single model / no registry | 明确 | `TONE_MODEL_PATH` + 单例 Loader | ✅ |
| Feature SSOT 收敛 | MODIFY（目标） | `mel.py` · `inference.py` 仍独立常量 | ⚠️ **未实现** |
| Backend adapter 抽出 | MODIFY（目标） | numpy 仍在 `classifier.py` | ⚠️ **未实现** |
| 废弃 Registry 文档 DELETE | §14 要求 | 文件**仍在** `docs/tone-v2/` | ❌ **未执行** |
| Phase 2 Supplement 进 README SSOT | 未写 | README 无本文档 | ⚠️ **文档缺口** |

---

## 2. 补充项清单

### 2.1 设计缺失 / 方案歧义（须在开发前写入 Supplement 或 ADR）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | Action |
|----|----------|------|------|----------|--------|
| **SS-01** | **§5 Backend 职责自相矛盾**：一处写 adapter 负责 `Mel feature → inference`，另一处写不得负责 `Feature extraction`。应与代码一致定为：`inference.py` + `mel.py` 负责切片→Mel；adapter **仅** `mel_batch → ndarray[N,5]` | 设计缺失 | **HIGH** | `backends/numpy_p0.py` 边界 | **MODIFY** Supplement §5 |
| **SS-02** | **`P0_COMPATIBLE_FEATURE_VERSIONS`（`mel_mean_80_v1`）**：Phase 1 冻结允许的 legacy alias；Supplement 未写 Phase 2 **KEEP** 直至全量 artifact 迁移 | 设计缺失 | **MEDIUM** | `loader.py` · 部署 npz | **MODIFY** Supplement §6/§7 |
| **SS-03** | **新服务实例与 Node 耦合**：`FW_ASR_SERVICE_ID = 'faster-whisper-vad'` 硬编码；第二实例需约定：新 `service.json` id、port、`asr.engine` 路由或调度策略，**非**仅复制 Python 目录 | 设计缺失 | **HIGH** | `fw-mode.ts` · ServiceDiscovery · 运维 | **MODIFY** §8 Runbook 细化 |
| **SS-04** | **`loadMs` vs `tone_inference_ms`**：§10 新增 `loadMs`，现网仅有 `tone_inference_ms`（推理耗时，非 load 耗时）。须定义：新增 `loadMs` optional，**不替换** Phase 1 字段 | 设计缺失 | **MEDIUM** | `api_routes.py` · 批测解析 | **MODIFY** §10 |
| **SS-05** | **`backend` vs `backendAdapter`**：现 diagnostics 用 `backend`（metadata）；§10 提议 `backendAdapter`。须声明别名关系或统一命名，避免双字段漂移 | 设计缺失 | **LOW** | diagnostics | **MODIFY** §9/§10 |
| **SS-06** | **生产入口仅允许 `load(None)`**：`ToneModelLoader.load(path)` 可传任意 path；Supplement 应禁止生产代码传显式 path（防隐性切换） | 设计缺失 | **MEDIUM** | `loader.py` · `get_tone_loader` | **MODIFY** §4 |
| **SS-07** | **Regression List 缺 `freeze-contract` / GATE-RANK-04**：Phase 1 门禁应延续；含 guard 不存在、无 registry import 等 | 设计缺失 | **MEDIUM** | Node Jest | **MODIFY** §15 |
| **SS-08** | **pytest / FW venv 执行环境**：§15 列 Python 测试但未写 venv 路径 | 设计缺失 | **LOW** | CI/本地 | **MODIFY** §15 |
| **SS-09** | **`service.json` / 运维 env**：未说明 `TONE_MODEL_PATH` 应通过进程 env 注入；当前 `service.json` 仅有 `ASR_MODEL` | 设计缺失 | **MEDIUM** | 部署 | **MODIFY** §4 或 Runbook |
| **SS-10** | **README SSOT 索引**：应将本文档列为 Phase 2 现行方案；并执行 §14 废弃文档处理 | 设计缺失 | **MEDIUM** | `docs/tone-v2/README.md` | **MODIFY** |

### 2.2 代码实现 vs 方案 Target（未实现 = 开发项，非漂移）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | Action |
|----|----------|------|------|----------|--------|
| **SS-C01** | **Feature SSOT 未收敛**：`contract.py` · `mel.py` · `inference.MIN_SLICE_SEC` 三处常量 | 代码实现 | **MEDIUM** | feature bump | **MODIFY**（Target #1） |
| **SS-C02** | **无 `backends/numpy_p0.py`**：numpy 推理内联 `classifier.predict_batch` | 代码实现 | **MEDIUM** | Target #2 | **MODIFY** |
| **SS-C03** | **`reset_*_singleton` 无测试门禁**：仅有 docstring「Test-only」；§12 要求注释或测试门禁 | 代码实现 | **LOW** | 防 hot-reload 误用 | **MODIFY**（Target #7） |
| **SS-C04** | **optional metadata 未扩展**：无 `trainingVersion` · `datasetVersion` · `artifactPath` 等 | 代码实现 | **LOW** | Target #4 | **MODIFY** |
| **SS-C05** | **Runbook 文档未编写**：权重升级 / 新实例 §8 仅原则 | 代码实现 | **LOW** | 运维 | **MODIFY**（Target #5–6） |

### 2.3 架构漂移 / 文档漂移

| ID | 补充内容 | 来源 | 风险 | 影响范围 | Action |
|----|----------|------|------|----------|--------|
| **SS-D01** | **`Tone_V2_Phase2A_Development_Plan_Supplement_Audit_2026_06_29.md` 仍在**：主张 Registry，与本文冲突；§14 要求 DELETE/archive **未执行** | 架构漂移（文档） | **HIGH** | SSOT | **DELETE** 或 `archive/deprecated/` |
| **SS-D02** | **`Tone_V2_Phase2A_Development_Plan_Supplement_Audit` 与 Restart PreDev Audit 并存**：后者已 supersede Registry 路线；README 归档规则未列 Phase 2A Registry 审计 | 文档漂移 | **MEDIUM** | 索引 | **MODIFY** README |
| **SS-D03** | **`tone-module/ARCHITECTURE.md` 未引用 Phase 2 Supplement** | 文档漂移 | **LOW** | 架构文档 | **MODIFY** 开发后同步 |

### 2.4 测试发现

| ID | 补充内容 | 来源 | 风险 | 影响范围 | Action |
|----|----------|------|------|----------|--------|
| **SS-T01** | **`freeze-contract` CLEANUP-2**（`hardDropCount`）仍失败 | 测试发现 | **MEDIUM** | 全量 `test:fw-detector` | **MODIFY** 并行（非 Tone） |
| **SS-T02** | **E2E 依赖 `servicePreferences`**：dialog_200 须启用 FW；§15 未写 | 测试发现 | **MEDIUM** | 验收 | **MODIFY** §15 |
| **SS-T03** | **权重升级验收**：§7 原则有，缺「换 npz + 重启后 `tone_effective_chain` 不降」量化阈值 | 设计缺失 | **MEDIUM** | Target #5 | **MODIFY** §16 |

### 2.5 Exists vs Effective

| 项 | Exists | Effective | 主链路 | 说明 | Action |
|----|--------|-----------|--------|------|--------|
| Single model Loader | ✅ | ✅ | ✅ | 符合 Supplement | **KEEP** |
| Registry / switching | ❌ | ❌ | ❌ | 符合禁止项 | **KEEP** |
| Target #1–8 代码变更 | ❌（仅文档） | — | — | 待 Phase 2 开发 | **MODIFY** 按计划实施 |
| `train_tone_cnn.py` | ✅ | ❌ Runtime | ❌ | §13 边界正确 | **KEEP** |
| `reset_tone_loader_singleton` | ✅ | 仅测试 | ❌ | §12 待加固 | **MODIFY** |
| Recall `tonePenalty` | ✅ | ✅ E2E | ✅ | 不得改 | **KEEP** |
| KenLM/Apply 覆盖句级 | ✅ | ✅ tone-free | ✅ | 设计内 | **KEEP** |
| 废弃 Registry **审计文档** | ✅ 文档 | 误导开发 | ❌ | 非 Runtime | **DELETE** |

---

## 3. 方案内部一致性核对

| 检查点 | 结果 |
|--------|------|
| 与 Phase 1 Freeze 冲突 | **无** |
| 与 Single Service / Single Model 重启裁决冲突 | **无** |
| §5 Backend 职责自洽 | **否** — 见 SS-01 |
| §6 Feature SSOT 与 §5 Mel 分工 | 需 SS-01 澄清后一致 |
| §14 废弃文档 | **已声明未执行** — SS-D01 |
| Target List 与禁止项 | **一致**（adapter 抽出 ≠ registry） |
| Acceptance vs Regression | 缺 freeze-contract — SS-07 |

---

## 4. 隐含前提（方案应显式写出）

| 前提 | 现状 | 若失效 |
|------|------|--------|
| 每 FW 进程仅一个 `get_tone_loader()` 单例 | ✅ 代码如此 | 多模型需新进程 |
| `TONE_MODEL_PATH` 在进程启动前确定 | ✅ env 读一次 | 变更须重启 |
| Node 仅路由到单一 `faster-whisper-vad` endpoint | ✅ `fw-mode.ts` | 新实例需 Node/配置变更 |
| 生产 npz 可能带 `mel_mean_80_v1` featureVersion | ✅ loader 接受 | 见 SS-02 |
| `toneTimestampOnlyEnabled=true` 默认 | ✅ | Recall 生效前提 |
| dialog_200 批测服务已启动 | 运维 | E2E 假失败 |

---

## 5. 验收条件 / 测试要求补充（建议并入 §15–§16）

| 类别 | 补充要求 |
|------|----------|
| **静态** | grep：`tone_module` 无 `registry` · `get_backend` · `TONE_MODEL_ID`；Node `fw-detector` 无 `tone_module` import |
| **Loader** | 换 path 仅测试；生产路径测试断言 `load(None)` |
| **Feature** | 单测：`mel.py` 常量与 `contract.P0_FEATURE_BASELINE` 一致（Target #1 后） |
| **Adapter** | 单测：`numpy_p0` 输出 shape `(N,5)` 且 sum≈1 |
| **Fail-closed** | 保留 `test_loader` · `test_classifier_fail_closed` 全通过 |
| **Node** | `tone-recall-counterfactual` · GATE-RANK-04 · dialog_200 三指标 |
| **权重升级** | 同 `featureVersion` 换 npz + 重启 → E2E `tone_effective_chain` 100% |
| **禁止** | FW-only scan 替代 Node E2E |

---

## 6. Required Repair Matrix

| Item | Expected（Supplement） | Actual | Severity | Action | Owner |
|------|------------------------|--------|----------|--------|-------|
| Phase 1 Runtime / Ownership | KEEP | 一致 | — | **KEEP** | — |
| Single model 无 registry | KEEP | 一致 | — | **KEEP** | — |
| §5 Backend 职责 | 清晰 | 自相矛盾 | HIGH | **MODIFY** 方案 | Docs |
| Feature SSOT | mel←contract | 三处常量 | MEDIUM | **MODIFY** 代码 Target #1 | Tone FW |
| numpy adapter 模块 | `backends/numpy_p0.py` | 内联 | MEDIUM | **MODIFY** Target #2 | Tone FW |
| 废弃 Registry 审计稿 | DELETE/archive | 仍存在 | HIGH | **DELETE** | Docs |
| README 索引 Phase 2 Supplement | 有 | 无 | MEDIUM | **MODIFY** | Docs |
| reset singleton 门禁 | 测试/注释 | 仅注释 | LOW | **MODIFY** Target #7 | Tone FW |
| `freeze-contract` 回归 | 应列 | 未列 | MEDIUM | **MODIFY** §15 | Docs |
| interval CLEANUP-2 | 绿 | 失败 | MEDIUM | **MODIFY** 并行 | FW |

**RESTORE：** 无（禁止恢复 guard / registry / bootstrap）。

**DELETE：** `Tone_V2_Phase2A_Development_Plan_Supplement_Audit_2026_06_29.md`（或移 `archive/deprecated/`）。

---

## 7. 与 Target List 差距矩阵

| Target # | Supplement 描述 | 代码状态 | 阻塞开发？ |
|----------|-----------------|----------|------------|
| 1 | mel←contract SSOT | ❌ 未做 | 建议首批 |
| 2 | numpy_p0 adapter | ❌ 未做 | 建议首批 |
| 3 | artifact contract 加固 | 部分（loader 已有） | 文档+测试 |
| 4 | optional metadata/diagnostics | 部分 | 可并行 |
| 5 | 权重升级 runbook | ❌ 未写 | 文档 |
| 6 | 新实例 runbook | ❌ 未写；缺 Node 细节 SS-03 | 文档 |
| 7 | reset test-only guard | ❌ 未做 | 小项 |
| 8 | 归档废弃 Registry 文档 | ❌ 未做 | **应先做** |
| 9 | Node E2E 标准 | ✅ 已在 §15 | 保持 |

---

## 8. Final Verdict

### **CONDITIONAL PASS**

| 问题 | 回答 |
|------|------|
| Supplement 是否与冻结设计一致？ | **是**（原则层面） |
| 是否存在 Registry/switching 代码漂移？ | **否** |
| 方案是否可直接开发？ | **可以**，先吸收 SS-01/03/06/14 与 SS-D01 |
| 代码是否已满足 Target List？ | **否** — 属 Phase 2 待开发 |
| 必须先做？ | **DELETE/归档** 废弃 Registry 审计文档；**修正** §5 职责边界 |

---

## 9. 建议优先并入 Supplement 的段落（摘要）

1. **§5 修订**：Feature = `mel.py`/`inference.py`；Adapter = `weights + mel_batch → posterior` only。  
2. **§6 增补**：`P0_COMPATIBLE_FEATURE_VERSIONS` Phase 2 **KEEP**。  
3. **§8 增补**：新实例需新 `service id` 或 Node 配置说明，非仅 env。  
4. **§4/§12**：生产仅 `load(None)`；`load(path)` 限测试。  
5. **§14 执行**：立即 archive 废弃 Registry 审计稿。  
6. **§15 增补**：`freeze-contract` · `servicePreferences` · pytest venv。  
7. **README**：将本文档列为 Phase 2 SSOT。

---

*Read-only supplement audit · no code/config modifications · 2026-06-29*
