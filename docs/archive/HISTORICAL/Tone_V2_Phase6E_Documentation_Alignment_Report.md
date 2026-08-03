<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase6E_Documentation_Alignment_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 6-E — Documentation Alignment Report

**Date:** 2026-06-29  
**Task:** Documentation Alignment & Terminology Cleanup（**非功能开发**）  
**Scope:** 统一 P6-E 文档术语，避免 Dataset Probe 与 Runtime Validation 混淆  
**禁止项：** 不得修改 Runtime · Training Pipeline · DatasetAdapter 实现 · 测试逻辑（除测试类命名）

**依据 SSOT：**

- Phase 1 Freeze · Phase 2 Foundation Freeze · Phase 3 Training Foundation Freeze
- Phase 6-A Tooling Freeze · Phase 6-D Dataset Pipeline Foundation · Phase 6-E AISHELL-3 Dataset Adapter
- [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md)
- [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md)

---

## Executive Summary

本轮仅修改 Markdown 文档、README 与测试类命名，**未修改**任何功能代码、训练路径或 Runtime 行为。

| 检查 | 结果 |
|------|------|
| P6-E 文档去除架构误导性「Smoke」术语 | ✅ |
| 引入 Runtime Validation vs Dataset Probe 分离说明 | ✅ |
| 禁止词（未标注 Historical Issue）清零 | ✅ |
| 测试类重命名 + 单测通过 | ✅ |
| 冻结层 / Adapter / Probe 实现未改 | ✅ |

### Final Verdict: **PASS**

---

## Modified Documents

| 文档 | 变更 |
|------|------|
| `Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Development_Report.md` | 术语替换 · 新增 §术语说明 · Fixture/Probe 章节重命名 · Historical Issue 标注 |
| `Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md` | 全文术语对齐 · 新增 §术语说明（Runtime Validation / Dataset Probe） |
| `docs/tone-v2/README.md` | P6-E 术语脚注（Dataset Probe ≠ Runtime Validation） |
| `tone_module/test_phase6e_aishell3.py` | **仅命名：** `OptionalLocalAishellSmokeTest` → `OptionalLocalAishellDatasetProbeTest`；方法名同步 |

**未修改：** `train_tone_cnn.py` · `adapter_openslr_aishell3.py` · `pipeline.py` · `probe_aishell3.py` · `cache_layout.py` · Runtime · 其他 Phase 历史文档（除 README 一句脚注）。

---

## Terminology Mapping

| 原术语（禁止在 P6-E 数据层语境使用） | 统一术语 |
|--------------------------------------|----------|
| Smoke | **Dataset Probe** |
| Dataset Probe Test | **Dataset Probe Test** |
| Probe Result | **Probe Result** |
| Local Dataset Probe | **Local Dataset Probe** |
| Dataset Statistics Probe | **Dataset Statistics Probe**（或上下文明确的 Limited Dataset Probe） |
| Fixture Test | **Fixture Test** |
| Limited Dataset Probe | **Limited Dataset Probe** / **限流 Dataset Probe** |
| Fixture / Probe Result | **Fixture Test / Dataset Probe Result** |
| Probe CLI | **Probe CLI** |
| `OptionalLocalAishellSmokeTest` | **`OptionalLocalAishellDatasetProbeTest`** |

### 冻结验收术语（不得与 Dataset Probe 混用）

| 术语 | 定义 |
|------|------|
| **Runtime Validation** | `TONE_MODEL_PATH` → FW Restart → Node E2E |
| **Dataset Probe** | Dataset Adapter → Alignment Provider → SyllableSample[] → Statistics / Join Audit |

### 禁止词处理规则

| 词 | P6-E 文档处理 |
|----|----------------|
| Shadow · **Historical Issue:** Smoke Runtime（现行不存在） · Offline Runtime · Dual Pipeline · Second Pipeline · A/B · Registry · Switching | **不得出现**（除非 **Historical Issue** 明示已关闭） |
| Runtime Validation（Node E2E） | 保留于 **README 全局工具表** — 属 **Runtime Validation** 域，与 P6-E Dataset Probe 分区说明并存 |

---

## Documentation Consistency Result

### P6-E Development Report

| 检查项 | 结果 |
|--------|------|
| 无未标注的 Smoke / Dataset Probe Test | ✅ |
| §术语说明含 Runtime Validation / Dataset Probe | ✅ |
| Fixture Test / Dataset Probe Result 章节 | ✅ |
| Probe CLI / Dataset Probe Test 用语 | ✅ |
| Registry 仅出现在 Historical Issue 块 | ✅ |
| 无 Second Pipeline / Dual Pipeline / A/B / Shadow | ✅ |

### P6-E Runbook

| 检查项 | 结果 |
|--------|------|
| 开篇 §术语说明 | ✅ |
| 限流 Dataset Probe / Local Dataset Probe | ✅ |
| 无 smoke 残留 | ✅ |
| 测试命令指向 `OptionalLocalAishellDatasetProbeTest` | ✅ |
| 明确 Dataset Probe 不得替代 Runtime Validation | ✅ |

### README（P6-E 相关）

| 检查项 | 结果 |
|--------|------|
| Dataset Probe vs Runtime Validation 脚注 | ✅ |
| 全局 Runtime Validation 保留（Runtime Validation 域） | ✅ |

### 测试命名一致性

```text
python -m unittest tone_module.test_phase6e_aishell3 -q
→ Ran 12 tests — OK (skipped=1)
```

---

## Frozen Architecture Verification

| 检查项 | 本轮 |
|--------|------|
| `contract.py` / `loader.py` / `mel.py` / Runtime 链 | **未修改** |
| `adapter_openslr_aishell3.py` / `probe_aishell3.py` / `pipeline.py` | **未修改** |
| `train_tone_cnn.py` 默认 `data_mini` | **未修改** |
| 无 `tone_cnn_p3` 训练 / 新权重 | **未执行** |
| Dataset Probe 实现路径 | **未变** |

---

## Architecture Drift Audit

| 区域 | Expected | Actual | Action |
|------|----------|--------|--------|
| 文档不暗示 Shadow / 双模型 / 第二训练入口 | 禁止误导 | P6-E 文档已清理；Registry 仅 Historical Issue | **KEEP** |
| Dataset Probe ≠ Runtime Smoke | 术语分离 | Runbook + Dev Report + README 脚注 | **KEEP** |
| 功能代码零漂移 | 仅文档轮 | 实现文件未改 | **KEEP** |
| 测试逻辑零漂移 | 仅类名/方法名 | 12/12 PASS | **KEEP** |

**Material Drift：无**

---

## KEEP

- Phase 1–3 / 6-A / 6-D / 6-E 冻结架构描述
- `probe_aishell3` CLI 行为与命令（文档仅改称谓）
- README 中 Node E2E **Runtime Validation** 作为 **Runtime Validation** 工具索引
- Historical Issue 块对废弃 Registry 路线的说明（已关闭）

## MODIFY

- P6-E Development Report · Runbook 全文术语
- README P6-E 术语脚注
- `OptionalLocalAishellDatasetProbeTest` 测试类命名

## RESTORE

- —

## DELETE

- P6-E 文档中所有未标注的「Smoke*」数据层术语（已替换，非删文件）

---

## Final Verdict

# **PASS**

P6-E 文档术语已与冻结架构对齐：**Dataset Probe** 明确限定于 Training Foundation 数据层；**Runtime Validation** 明确限定于 `TONE_MODEL_PATH` → FW → Node E2E。不存在将 `probe_aishell3` 误解为 Runtime 验收或 Shadow / 第二链路的表述（Registry 等仅作 **Historical Issue** 引用）。

---

*Documentation-only round — no code execution path changes · no model training.*
