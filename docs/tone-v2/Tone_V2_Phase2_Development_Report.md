# Tone V2 Phase 2 — Development Report

**Date:** 2026-06-29（E2E 验收更新）  
**Scope:** Phase 2 Restart（Single Service / Single Model）首批 Target List  
**执行约束：** [Tone V2 Phase 2 Restart Supplement Addendum](./Tone%20V2%20Phase%202%20Restart%20Supplement%20Addendum.md) · [Restart Supplement](./Tone%20V2%20Phase%202%20Restart%20Supplement%20%E2%80%94%20Single%20Service%20Single%20Model.md)  
**E2E 报告：** [Tone_V2_Phase2_Node_E2E_Test_Report.md](./Tone_V2_Phase2_Node_E2E_Test_Report.md)

---

## 1. Executive Summary

本轮按 Addendum 完成 Phase 2 首批实装，并通过 **dialog_200 子集 E2E（131/200，15 分钟封顶）** 验证冻结架构仍成立。

| 维度 | 结果 |
|------|------|
| 代码实装 | Feature SSOT · numpy_p0 adapter · metadata/diagnostics · regression · 文档归档 |
| Python 契约 | **18/18 PASS** |
| Node E2E | **131/131** `tone_effective_chain`，**0** `model_error`，**0** HTTP 错误 |
| 反事实 Jest | **2/2 PASS**（`tone-recall-counterfactual`） |
| Architecture Compliance | **PASS**（已测子集） |

**Final Verdict：PASS（Tone 链路）** — 全量 200 条建议延长批测闭合（见 §7）。

---

## 2. 前后调整对照

### 2.1 开发前 → 开发后

| 区域 | 开发前 | 开发后 | 处理 |
|------|--------|--------|------|
| `mel.py` 常量 | 独立硬编码 | 引用 `contract.py` | **MODIFY** |
| `inference.MIN_SLICE_SEC` | `0.02` 重复 | `P0_MIN_SLICE_SEC` | **MODIFY** |
| 推理 | 内联 `classifier.predict_batch` | `backends/numpy_p0.infer_batch` | **MODIFY** |
| Metadata | 基础字段 | +`trainingVersion`/`loadMs`/`artifactPath`/`backendAdapter` 等 optional | **MODIFY** |
| Registry 审计文档 | 根目录 SSOT 污染 | `archive/deprecated/` | **DELETE** |
| Runtime Hop / Recall | Phase 1 冻结 | **未改** | **KEEP** |

### 2.2 核心逻辑是否符合设计

**符合。** 数据流与 Addendum §1 一致：

```text
Audio Slice → inference.py → mel.py → mel_batch → numpy_p0 → TonePosterior → Recall
```

- Backend **不**做 Feature extraction  
- Loader 生产路径 **仅** `get_tone_loader()` → `load(None)`  
- 无 Registry / switching / hot reload  
- `P0_COMPATIBLE_FEATURE_VERSIONS` 保留（含 `mel_mean_80_v1`）

---

## 3. 实施变更清单（摘要）

详见首轮开发记录；关键文件：

- `tone_module/contract.py` — Feature SSOT + metadata 扩展  
- `tone_module/mel.py` — 引用 contract  
- `tone_module/backends/numpy_p0.py` — **新建** adapter  
- `tone_module/classifier.py` — 委托 adapter  
- `tone_module/loader.py` — `load_ms` / `artifact_path` / 扩展 npz 键  
- `tone_module/test_phase2_contracts.py` — Addendum §7 回归门禁  
- `docs/tone-v2/Tone_V2_Phase2_Deployment_Runbook.md` — 运维 Runbook  
- `docs/tone-v2/archive/deprecated/` — Registry 方案废弃归档  

---

## 4. Frozen Architecture Verification

### 4.1 Decision Path（E2E 证实）

| 步骤 | 组件 | Exists | Effective | 证据 |
|------|------|--------|-----------|------|
| 1 | FW `run_tone_inference` | ✅ | ✅ | 131/131 `toneEnabled`, sliceCount>0 |
| 2 | Node `ctx.acousticToneSlices` | ✅ | ✅ | FW tone diag `tonePayloadAvailable=true` |
| 3 | Recall tone SQL | ✅ | ✅ | fallback **5511** + compatible **350** |
| 4 | Ranking | ✅ | ✅ | `combinationCount>0` |
| 5 | Assembly | ✅ | ✅ tone-free | `fw_triggered`, 无 guard |
| 6 | KenLM/Apply | ✅ | ✅ tone-free | `maxDelta` 非零样本存在 |

### 4.2 反事实

- **`toneTimestampOnlyEnabled=false`**：Jest 证实 tone effective path 关闭 → **Recall 无 tone penalty**（设计内门控有效）。  
- **`model_error`**：批测 0 条 → Loader fail-closed + adapter 未阻断主链。  
- **Guard 复活**：`assembly_guard_absent_all=true` → 无 `toneGuardBlockedCount`。

### 4.3 不存在项（架构漂移检查）

- ❌ Model Registry / Backend Registry  
- ❌ Runtime 模型切换  
- ❌ Assembly Tone Guard  
- ❌ 第二声学 Decision Pipeline  
- ❌ 生产 `reset_*_singleton` 调用  

---

## 5. 质量与性能（E2E 子集 n=131）

| 指标 | 值 |
|------|-----|
| mean_cer | 0.220 |
| tone_effective_chain | 100% |
| model_error | 0 |
| pipeline_ms p50 / p95 | 6131 / 11213 |
| fw_step_ms p50 / p95 | 1274 / 1554 |
| recall_tone_fallback_total | 5511 |

---

## 6. Drift Matrix（Expected / Actual / 处理）

| ID | Expected | Actual | Impact | Severity | 处理 |
|----|----------|--------|--------|----------|------|
| SS-C01 | Feature SSOT 单源 | 已收敛 | — | — | **MODIFY** ✅ |
| SS-C02 | numpy_p0 adapter | 已抽出 | — | — | **MODIFY** ✅ |
| SS-D01 | Registry 文档归档 | 已 archive | — | — | **DELETE** ✅ |
| D-E2E-01 | dialog_200 全量 | 131/200（15min） | 全量门禁未闭合 | LOW | **KEEP** + 延长批测 |
| D-E2E-02 | Phase2 diagnostics 透传 | Node extra 未含 loadMs | 观测缺口 | LOW | **MODIFY** 可选 |
| SS-T01 | freeze-contract 全绿 | CLEANUP-2 fail | 非 Tone | MEDIUM | **MODIFY** 并行 |

---

## 7. 未闭合项

1. **dialog_200 剩余 69 条**：`--max-minutes` 提高至 25–30 或 `--limit 200` 无封顶。  
2. **`freeze-contract` CLEANUP-2**：span-assembly `hardDropCount`（与 Tone 无关）。  
3. **`start_electron_node.ps1`**：PowerShell 对 npm stderr 过敏，建议 `$ErrorActionPreference = 'Continue'`。

---

## 8. Architecture Compliance 结论

本轮 Phase 2 开发 **符合冻结架构**：

- ✅ Single Service / Single Model  
- ✅ 决策权未迁移；Recall tone 在 E2E 中 **真实生效**（非死代码）  
- ✅ Backend 边界与 Feature SSOT 按 Addendum 落地  
- ✅ 无 Registry、无 Guard 复活、无 Required Schema 变更  

**不仅功能测试通过，且冻结链路在 131 条 E2E + 反事实 Jest 中证实仍参与最终决策。**

**Final Verdict：PASS（Tone 链路）** — 全量 200/200 为建议闭合项，非架构否决项。
