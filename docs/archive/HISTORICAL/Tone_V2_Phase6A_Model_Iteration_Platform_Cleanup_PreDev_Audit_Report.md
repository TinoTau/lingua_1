<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase6A_Model_Iteration_Platform_Cleanup_PreDev_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 6-A — Model Iteration Platform Cleanup 开发前审计报告

**Date:** 2026-06-29  
**Audit Type:** Read-only Pre-Development Code Audit（**非训练** · **非 Runtime 开发**）  
**Scope:** Phase 6-A 工具链泛化与清理 — 评估硬编码、脚本重复、路径耦合、文档漂移，并给出**最小开发方案**  
**禁止触碰（本轮审计确认 P6-A 亦不得改）：** Runtime · Loader · Contract · Feature Baseline · Recall · Ranking · Assembly · KenLM · Apply · Service Boundary · Backend Adapter

**依据：**

- Phase 1 / 2 / 3 Freeze · [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [Tone_V2_P4_tone_cnn_p1_Model_Freeze_Audit_Report.md](./Tone_V2_P4_tone_cnn_p1_Model_Freeze_Audit_Report.md)
- [Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md](./Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md)
- 当前仓库代码（`tone_module/*` · Node E2E · Runbook）

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| E2E 脚本 p1/p2/p3 复制风险 | **高** — 已有 phase1 / phase3 / phase4 三份近重复脚本 |
| 应收敛为通用 E2E 脚本 | **是** — 合并 phase3 主体 + phase4 的 FW health / deploymentConfig |
| `train_tone_cnn` dataset 硬编码 | **仍存在** — `DATASET_REPO` 模块常量，无 `--dataset-repo` |
| 训练 CLI（output / model-version 等） | **已具备** — P4 已加；仅缺 `--dataset-repo` |
| `validate_artifact` CLI | **缺失** — 仅库函数 + `python -c` |
| `offline_tone_eval` CLI | **缺失** — 仅训练内嵌或手工 import |
| Runbook / SSOT 文档漂移 | **是** — 仍默认 `tone_cnn_p0`；未写 canonical `tone_cnn_p1` |
| Runtime / Decision 耦合 | **无** |
| Registry / Switching / 第二 Pipeline | **未发现** |

### Final Verdict: **CONDITIONAL PASS**

**可进行 P6-A 工具链泛化开发。** 范围明确为：Node E2E 脚本收敛、训练/校验/离线 CLI 包装、Runbook/SSOT 文档对齐；**不**修改 Loader/Contract/Runtime。P6-A 完成后可进入 `tone_cnn_p2` 训练（同 P0 MLP，仅 CLI + 既有管线）。

---

## 1. Frozen Architecture Verification

```text
FW Worker → run_tone_inference → UtteranceResponse.tone
→ ctx.acousticToneSlices → Recall → Ranking → Assembly → KenLM → Apply
```

| 检查项 | Expected | Actual | Impact | Severity | Action |
|--------|----------|--------|--------|----------|--------|
| Runtime Hop 未变 | Phase 1 冻结链 | `inference.py` → `classifier` → `numpy_p0` | 无 | — | **KEEP** |
| Decision Ownership | Recall owns Tone | `recall-topk-for-windows.ts` | 无 | — | **KEEP** |
| `modelVersion` 不进 Decision | diagnostics only | Loader/Classifier 无版本分支 | 无 | — | **KEEP** |
| Single Service / Single Model | `TONE_MODEL_PATH` + 重启 | 无 Registry / hot_reload | 无 | — | **KEEP** |
| Training 不 import Decision | 隔离 | `train_tone_cnn` 无 recall 路径 | 无 | — | **KEEP** |
| Offline 不进 Runtime Gate | 隔离 | `test_phase3_contracts` PASS | 无 | — | **KEEP** |
| P6-A 工具改动触及 Runtime | **禁止** | 当前无 P6-A 代码变更 | — | — | **KEEP** 边界 |

**Material Architecture Drift：无**

---

## 2. Tooling Reusability Matrix

| 工具 | 当前状态 | p2/p3 同架构可复用？ | 手工步骤 | P6-A 目标 |
|------|----------|---------------------|----------|-----------|
| `train_tone_cnn.py` | 完整管线 + 内嵌 validate/offline | **是**（须显式 CLI） | 须记全参数 | 补 `--dataset-repo`；文档化命令 |
| `validate_artifact.py` | 库 API only | **是** | `python -c` 一行 | 增加 `python -m` CLI |
| `offline_tone_eval.py` | 库 API only | **是** | 训练内嵌或手写脚本 | 增加 `python -m` CLI |
| `tone-v2-phase3-dialog200-batch.js` | 通用逻辑，硬编码 OUT/SESSION | **是** | 改 OUT 或复制脚本 | 收敛为单脚本 |
| `tone-v2-phase4-p1-deploy-dialog200-batch.js` | p1 路径/SESSION 硬编码 | **否**（促复制） | 同左 + FW 探针 | 合并进通用脚本 |
| `tone-v2-phase1-dialog200-batch.js` | 历史 phase1 副本 | 冗余 | 三选一困惑 | **DELETE** 或薄包装指向通用脚本 |
| Runbook | 有效流程，p0 默认 | 流程可复用 | 文档未钉 p1 canonical | **MODIFY** 文档 only |
| Model Freeze | 人工报告模板 | 可复用 | 手工 | **KEEP** |

---

## 3. E2E Script Generalization Matrix

### 3.1 现状：三份 Tone dialog_200 脚本

| 文件 | OUT_PATH | SESSION_ID | TONE_MODEL_PATH | FW health | waitHealth(Node) |
|------|----------|------------|-----------------|-----------|------------------|
| `tone-v2-phase1-dialog200-batch.js` | 硬编码 phase1 | 硬编码 phase1 | **无** | 无 | ✓ |
| `tone-v2-phase3-dialog200-batch.js` | 硬编码 phase3 | 硬编码 phase3 | **无** | 无 | ✓ |
| `tone-v2-phase4-p1-deploy-dialog200-batch.js` | 硬编码 phase4/p1 | 硬编码 phase4/p1 | 默认 **p1** 路径 | ✓ `probeFwHealth` | ✓ + FW utterance_ready 等待 |

**行数级重复：** `extractRow` · `runWav` · `importSession` · `waitHealth` · 主循环 ~90% 相同。

### 3.2 发现 F-01：p2/p3 复制风险

| | |
|--|--|
| **Expected** | 单一 SSOT E2E 脚本，参数化模型路径与输出 |
| **Actual** | 每阶段复制新文件（phase4 为 p1 专版）；p2 大概率再复制 `tone-v2-phase5-p2-...js` |
| **Impact** | 指标字段漂移、修复需多处同步、运维命令混乱 |
| **Severity** | **MED** |
| **Action** | **MODIFY** — 收敛为 `tone-v2-dialog200-batch.js`（建议名） |

### 3.3 推荐通用脚本能力

| 参数 / 能力 | phase3 | phase4 | 通用脚本应支持 |
|-------------|--------|--------|----------------|
| `TONE_MODEL_PATH`（env） | ✗ | ✓（默认 p1） | ✓ env，**无**默认 artifact 路径 |
| `--session` | ✗ | ✗ | ✓ |
| `--out` | ✗ | ✗ | ✓ |
| `--max-minutes` | ✓ | ✓ | ✓ |
| `--limit` | ✓ | ✓ | ✓ |
| `waitHealth`（Node :5020） | ✓ | ✓ | ✓ |
| `--wait-fw` / FW `utterance_ready` | ✗ | ✓ | ✓ optional（默认 true） |
| `deploymentConfig` in JSON | ✗ | ✓ | ✓（记录 env，非 Runtime） |
| `--warmup-cases N` | ✗ | ✗ | **MODIFY** optional（缓解 d001–d010 冷启动） |

### 3.4 是否允许修改 Node E2E 脚本？

**允许。** E2E batch 属于 **Node Integration / Runtime Validation**（Addendum II §4），**不是** Runtime、Recall 或 FW `tone_module` 生产路径。收敛脚本不改变 pipeline 行为，仅参数化运维与报告路径。

---

## 4. Training CLI Matrix

### 4.1 `train_tone_cnn.py` 当前 CLI（`main()` L360–381）

| 参数 | 状态 | 默认 | p2 需要？ |
|------|------|------|----------|
| `--output` | **已有** | `models/tone_cnn_p0.npz` | ✓ 显式 `tone_cnn_p2.npz` |
| `--cache-dir` | **已有** | `_data_cache` | ✓ |
| `--model-version` | **已有**（P4） | `tone_cnn_p0` | ✓ `tone_cnn_p2` |
| `--training-version` | **已有** | UTC 日期 | ✓ |
| `--dataset-repo` | **缺失** | 硬编码 `CS5647Team3/data_mini` | 可选新增 |
| `--epochs` / `--batch-size` / `--lr` / `--val-ratio` / `--seed` | **已有** | 固定默认 | ✓ |

### 4.2 发现 F-02：Dataset 硬编码

| | |
|--|--|
| **Expected** | 数据集可通过 CLI 或 env 配置，不阻碍同架构迭代 |
| **Actual** | `DATASET_REPO = "CS5647Team3/data_mini"`（L36）；`_ensure_dataset()` 无 repo 参数 |
| **Impact** | 换数据集须改源码；p2 同数据无阻塞，但平台不完整 |
| **Severity** | **MED** |
| **Action** | **MODIFY** — 增加 `--dataset-repo`（及可选 `--dataset-zip`），默认保持现值 |

### 4.3 发现 F-03：默认 output / model-version 仍为 p0

| | |
|--|--|
| **Expected** | 默认值不导致误覆盖；Runbook 钉 canonical |
| **Actual** | `DEFAULT_OUT` / `--model-version` 默认 `tone_cnn_p0` |
| **Impact** | 漏 CLI 时覆盖 p0 文件或写错 metadata |
| **Severity** | **LOW**（p2 训练须显式参数 — 可接受） |
| **Action** | **KEEP** 默认 + **MODIFY** Runbook 强制显式 `--output` / `--model-version` |

### 4.4 是否允许修改 `train_tone_cnn.py` CLI？

**允许** — 仅限 **Training Foundation** 内 CLI / 数据集参数化 / 文档字符串；**不得**改 `_train_mlp` 结构、不得 import Runtime、不得改 `contract.P0_*` 语义。

---

## 5. Artifact Validation CLI Matrix

### 5.1 现状

| 能力 | 状态 |
|------|------|
| `validate_artifact(path)` API | ✓ |
| `python -m tone_module.validate_artifact` | **✗** 无 `__main__` |
| 手工调用 | `python -c "from tone_module.validate_artifact import validate_artifact; ..."` |
| `--json-out` | **✗** |

### 5.2 发现 F-04：校验步骤手工成本高

| | |
|--|--|
| **Expected** | 一条命令完成验收并落盘 JSON（CI / Runbook 友好） |
| **Actual** | 仅库函数；P4 报告依赖 `python -c` |
| **Impact** | 易打错路径；不利于 p2/p3 标准化门禁 |
| **Severity** | **LOW** |
| **Action** | **MODIFY** — 增加 `if __name__ == "__main__"`：`--artifact` · `--json-out`（optional）· stdout `to_notes()` |

### 5.3 是否允许给 `validate_artifact` 增加 CLI？

**允许。** 仅包装现有四阶段逻辑；**不**改 Schema/Shape/Loader/Adapter 规则；**不**写回 artifact。

---

## 6. Offline Evaluation CLI Matrix

### 6.1 现状

| 能力 | 状态 |
|------|------|
| `run_offline_evaluation(mel, labels, weights)` | ✓ |
| 训练后自动调用 | ✓ `train_tone_cnn` L332–353 |
| 独立 `python -m` | **✗** |
| `--artifact` + 自动构建 val 集 | **✗** |
| `--eval-json`（预计算 mel/labels） | **✗** |

### 6.2 发现 F-05：离线评估依赖训练内嵌或手工拼装

| | |
|--|--|
| **Expected** | 训练后可独立重跑 offline eval（同 holdout） |
| **Actual** | 须重复训练逻辑或 import + 自写加载 val 数据 |
| **Impact** | p2 质量对比步骤繁琐 |
| **Severity** | **MED** |
| **Action** | **MODIFY** — CLI：`--artifact` 必填；`--cache-dir` + `--dataset-repo` + `--seed`/`--val-ratio` 重建 val holdout（复用 `train_tone_cnn` 数据函数），或 `--eval-json` 读入 mel/labels |

### 6.3 是否允许给 `offline_tone_eval` 增加 CLI？

**允许。** 仅调用 `infer_batch` + 现有 report 结构；**禁止** import Recall/Ranking/Runtime。

---

## 7. Runbook / SSOT Drift Matrix

| 文档 / 代码 | Expected | Actual | Impact | Severity | Action |
|-------------|----------|--------|--------|----------|--------|
| `Tone_V2_Phase2_Deployment_Runbook.md` §1 | 钉 canonical 模型 + 候选模型流程 | 仍写默认 `tone_cnn_p0.npz` 替换文件 | 运维误用 p0 | **MED** | **MODIFY** |
| `TONE_V2_CONTRACT_FREEZE.md` §4 | 反映当前生产模型 | `TONE_MODEL_PATH` 或默认 `tone_cnn_p0.npz` | SSOT 滞后 | **LOW** | **MODIFY** 文档（注明 p1 canonical；**不改** `config.py` 默认） |
| `tone_cnn_p1` Model Freeze | p1 为冻结生产版本 | 报告已 PASS/CONDITIONAL | 文档未回写 | **LOW** | **MODIFY** Runbook §canonical |
| p2/p3 定位 | candidate → validate → E2E → freeze | 未文档化 | 流程歧义 | **LOW** | **MODIFY** Runbook 生命周期段 |
| 换模型步骤 | `TONE_MODEL_PATH` + FW 重启 | Runbook 已写 | 正确 | — | **KEEP** |
| `config.py` / `loader.py` 默认路径 | 冻结默认或 env | `tone_cnn_p0.npz` | 与 canonical 不一致 | **LOW** | **KEEP** 代码（P6-A **不**改 Loader/config）；Runbook 强制 env |
| `ARCHITECTURE.md` | 与 Freeze 一致 | 仍提 `tone_cnn_p0` | 漂移 | **LOW** | **MODIFY** |

**Runbook 应明确（P6-A 文档目标，非代码）：**

- **Canonical（生产冻结）：** `tone_cnn_p1.npz` + SHA256 `8b22ba13…`
- **Candidate（p2/p3）：** 训练产出 → `validate_artifact` PASS → offline → E2E → Model Freeze 后方可切换 `TONE_MODEL_PATH`
- **禁止：** 热切换、同 Worker 多模型、改 Runtime 选模型

---

## 8. Architecture Drift Audit（工具链域）

| 风险类 | 发现 | Severity | Action |
|--------|------|----------|--------|
| Runtime 耦合 | 无 | — | **KEEP** |
| Decision 耦合 | 无 | — | **KEEP** |
| Registry / Switching | 无 | — | **KEEP** |
| Hot Reload | 无 | — | **KEEP** |
| 第二 Pipeline（训练/校验） | 无 | — | **KEEP** |
| 隐藏门控 | 无新增 | — | **KEEP** |
| E2E 脚本膨胀 | phase1/3/4 三副本 | MED | **MODIFY** + **DELETE** 冗余 |
| 工具手工步骤过多 | validate/offline 无 CLI | LOW–MED | **MODIFY** |
| 文档漂移 | p0 默认 vs p1 freeze | MED | **MODIFY** docs only |

---

## 9. Required Repair Matrix（P6-A 最小开发方案）

| ID | 项 | 类型 | 优先级 | 触及 Runtime？ | Action |
|----|-----|------|--------|----------------|--------|
| RR-01 | 新增 `tone-v2-dialog200-batch.js` 通用 E2E | 测试工具 | **P0** | 否 | **MODIFY** |
| RR-02 | 支持 `--session` `--out` `TONE_MODEL_PATH` `--max-minutes` `--wait-fw` | 测试工具 | **P0** | 否 | **MODIFY** |
| RR-03 | phase3/phase4 改为薄包装调用通用脚本（或 **DELETE** + README 指向） | 测试工具 | **P1** | 否 | **MODIFY** / **DELETE** |
| RR-04 | optional `--warmup-cases` / ASR ready 重试 | 测试工具 | **P2** | 否 | **MODIFY** |
| RR-05 | `train_tone_cnn` 增加 `--dataset-repo`（+ 可选 `--dataset-zip`） | Training CLI | **P1** | 否 | **MODIFY** |
| RR-06 | `validate_artifact` 增加 `python -m`：`--artifact` `--json-out` | 校验 CLI | **P1** | 否 | **MODIFY** |
| RR-07 | `offline_tone_eval` 增加 `python -m`：`--artifact` `--json-out` + val 重建或 `--eval-json` | 离线 CLI | **P1** | 否 | **MODIFY** |
| RR-08 | Runbook + `TONE_V2_CONTRACT_FREEZE` 增补 canonical p1 / candidate p2/p3 | 文档 | **P1** | 否 | **MODIFY** |
| RR-09 | 提取 `train_tone_cnn` 中 `_collect_samples` / val split 为可导入函数供 offline CLI 复用 | Training 内部 | **P1** | 否 | **MODIFY**（同文件小 refactor，无行为变） |
| RR-10 | 改 `config.py` / `loader.py` 默认 npz | — | **禁止** | 是（Loader/配置边界） | **KEEP** 现状 |
| RR-11 | 训练 `tone_cnn_p2` | — | **禁止于 P6-A** | — | 延后至 P6-B |

### 最小交付集（建议 P6-A PR 范围）

1. **RR-01 + RR-02**（通用 E2E）  
2. **RR-06 + RR-07**（校验 / 离线 CLI）  
3. **RR-05**（`--dataset-repo`）  
4. **RR-08**（Runbook / SSOT 文档）  
5. **RR-03**（废弃重复脚本或薄包装）

**预估不改动：** `loader.py` · `contract.py` · `inference.py` · `classifier.py` · `numpy_p0.py` · FW Node Recall 链。

---

## 10. KEEP / MODIFY / RESTORE / DELETE

### KEEP

| 项 |
|----|
| 全部 Runtime / Decision / Loader / Contract / Backend 冻结实现 |
| `validate_artifact` 四阶段逻辑（仅加 CLI 入口） |
| `offline_tone_eval.run_offline_evaluation` 核心 |
| `train_tone_cnn` 训练算法与 post-save 内嵌 validate |
| 已有 CLI：`--output` `--cache-dir` `--model-version` `--training-version` |
| `TONE_MODEL_PATH` + FW 重启部署模型 |
| Model Freeze 人工审计流程 |
| phase3 脚本中的 `extractRow` / 架构门指标定义 |

### MODIFY（P6-A 允许）

| 项 |
|----|
| 收敛 Node E2E 为通用 `tone-v2-dialog200-batch.js` |
| `train_tone_cnn.py`：`--dataset-repo`；可选抽取数据加载函数 |
| `validate_artifact.py` / `offline_tone_eval.py`：`__main__` CLI |
| Runbook · CONTRACT_FREEZE 文档段（canonical / candidate） |
| phase1/3/4 脚本 → 薄包装或 README 迁移说明 |

### RESTORE

无。

### DELETE

| 项 |
|----|
| 重复 E2E 脚本正文（合并后 phase4 专版逻辑迁入通用脚本） |
| 每新版本复制一份 `tone-v2-phaseN-pX-...js` 的做法（流程 DELETE，非必须删历史 phase1 文件 — 可保留只读归档指向通用脚本） |

---

## 11. 最终问题答复

### Q1. 是否可以进行 P6-A 工具链泛化开发？

**可以。** 无架构阻塞；发现项均为工具/文档层 **MODIFY**，与冻结边界一致。

### Q2. 哪些修改属于工具链泛化，而不是 Runtime 开发？

| 属于 P6-A 工具链泛化 | **不属于**（禁止 P6-A 触碰） |
|----------------------|------------------------------|
| Node E2E 脚本参数化 | `inference.py` / `api_routes.py` |
| `train_tone_cnn` CLI / 数据加载参数 | `loader.py` / `contract.py` |
| `validate_artifact` / `offline_tone_eval` CLI 包装 | `numpy_p0.py` / `classifier.py` |
| Runbook / SSOT 文档 | Recall / Ranking / Assembly |
| 测试目录 `electron-node/tests/*.js` | `config.py` 默认 `TONE_MODEL_PATH` 路径 |

### Q3. 是否允许修改 Node E2E 脚本？

**允许。** Runtime Validation 工具；不修改 `run-pipeline-with-audio` 实现或 FW 服务代码。

### Q4. 是否允许修改 `train_tone_cnn.py` CLI？

**允许** — 仅 CLI 与数据集参数化 / 内部函数抽取；**不得**改网络结构、Feature Baseline 或 Runtime 桥接契约。

### Q5. 是否允许给 `validate_artifact` / `offline_tone_eval` 增加 CLI？

**允许** — 薄包装现有 API；**不得**新增第二套校验逻辑或 Decision 导入。

### Q6. 是否需要修改 Contract / Loader / Runtime？

**不需要，且 P6-A 禁止修改。** Canonical 模型切换仅通过运维 `TONE_MODEL_PATH` + 重启；Loader 默认路径保持 `tone_cnn_p0.npz` 直至未来单独冻结变更流程。

### Q7. 是否可以在 P6-A 完成后进入 `tone_cnn_p2` 训练？

**可以。** P6-A 完成后推荐命令形态（示意）：

```powershell
cd electron_node\services\faster_whisper_vad
python -m tone_module.train_tone_cnn `
  --output tone_module/models/tone_cnn_p2.npz `
  --model-version tone_cnn_p2 `
  --training-version 2026-06-29

python -m tone_module.validate_artifact --artifact tone_module/models/tone_cnn_p2.npz --json-out tone_module/models/tone_cnn_p2_validate.json
python -m tone_module.offline_tone_eval --artifact tone_module/models/tone_cnn_p2.npz --json-out tone_module/models/tone_cnn_p2_offline_eval.json

$env:TONE_MODEL_PATH = "...\tone_cnn_p2.npz"
# 重启 Electron Node / FW
node electron-node/tests/tone-v2-dialog200-batch.js --session tone-v2-p2-d200 --out experiments/tone-v2-p2-dialog200-batch-result.json
```

（`python -m` 行在 P6-A 落地后生效；当前 validate/offline 须 `python -c` 或训练内嵌。）

---

## 12. Final Verdict

# **CONDITIONAL PASS**

**条件：** P6-A 实施须严格遵守「零 Runtime / Loader / Contract / Backend 改动」；文档更新不得引入 Registry、热切换或第二决策链。

**P6-A 完成后：** 模型迭代平台在 **P0 MLP 同架构** 域内达到可长期复用；`tone_cnn_p2` 训练可作为 **P6-B（Model Improvement 训练）** 启动，无需再改 Foundation。

---

**审计员签署：** Read-only Pre-Development Audit · Tone V2 Phase 6-A · 2026-06-29
