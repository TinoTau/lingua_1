<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase2_Foundation_Documentation_Update_Report_2026_06_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 2 Foundation — Documentation Update Report

**Date:** 2026-06-29  
**Type:** Documentation Alignment / SSOT Update（非功能开发）  
**依据：** Lingua Project Constitution · Phase 1 Freeze · [Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md)

---

## Executive Summary

已将 **Tone V2 Phase 2 Foundation** 冻结结果写入唯一契约 SSOT，重组文档索引，同步架构详述，并归档与 Registry/Switching/Phase2A 冲突或易误导的过程审计文档。

| 项 | 结果 |
|----|------|
| Phase 2 Foundation 写入 SSOT | ✅ |
| Registry/Switching 活跃入口 | ❌ 已清除（仅 archive） |
| 多个冲突 Phase 2 方案 | ❌ 已收敛 |
| 后续开发唯一依据 | 见 §「后续依据」 |
| 可进入模型能力开发前审计 | ✅ |

**Final Verdict：PASS**

---

## Updated Files

| 文件 | 操作 |
|------|------|
| `docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md` | **MODIFY** — 升格为 Phase 1+2 唯一契约 SSOT；新增 §4–§8 Phase 2 Foundation |
| `docs/tone-v2/README.md` | **MODIFY** — Phase 2 CLOSED/FROZEN；SSOT / 证据 / 归档三层索引 |
| `docs/tone-module/ARCHITECTURE.md` | **MODIFY** — Phase 2 组件、数据流、Loader/Backend 边界 |
| `docs/tone-v2/archive/audit/AUDIT_ARCHIVE_README.md` | **CREATE** — 过程审计归档说明 |
| `docs/tone-v2/archive/deprecated/DEPRECATED_README.md` | **MODIFY** — 指向 CONTRACT_FREEZE |
| `docs/tone-v2/Tone V2 Phase 1 Development Plan Supplement.md` | **MODIFY** — 顶部归档说明（Registry 路线已废弃） |
| `docs/tone-v2/Tone V2 Phase 1 — Contract Freeze & Loader Foundation Development Plan.md` | **MODIFY** — 顶部归档说明 |

### 迁入 `archive/audit/`（非删除）

| 文件 |
|------|
| `Tone_V2_Phase2_Restart_PreDev_Code_Audit_2026_06_29.md` |
| `Tone_V2_Phase2_Restart_Supplement_Audit_2026_06_29.md` |
| `Tone_V2_Phase2_PreDev_Code_Audit_2026_06_29.md` |
| `Tone V2 Phase 2A_pre audit.md` |

### 保留未动（证据 · 非 SSOT）

- `Tone_V2_Phase1_Freeze_Report.md`
- `Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md`
- `Tone_V2_Phase2_Development_Report.md`
- `Tone_V2_Phase2_Node_E2E_Test_Report.md`
- `Tone_V2_Phase1_Node_E2E_Runtime_Recovery_Report.md`
- `archive/deprecated/Tone_V2_Phase2A_Development_Plan_Supplement_Audit_2026_06_29.md`

---

## SSOT Changes（写入 CONTRACT_FREEZE 的 Foundation 要点）

1. **Phase 2 Foundation CLOSED / FROZEN**（2026-06-29）
2. **Single Service / Single Model** — 单实例 → 单 artifact → 单 adapter → 单 featureVersion
3. **新模型** = 新服务实例 + 独立 `TONE_MODEL_PATH` + 独立 adapter；禁止同 Worker 内切换
4. **Feature SSOT** — `contract.py` 唯一；`mel.py` / `inference.py` 仅引用
5. **Backend** — `numpy_p0`：`mel_batch → posterior`；不负责 Feature/Runtime/Decision
6. **Loader** — 生产 `load(None)`；`load(path)` / `reset_*` 仅测试
7. **Artifact** — 单 npz；metadata 仅 diagnostics；不进 Decision
8. **Diagnostics** — optional only；不进 Recall/Ranking/Assembly/KenLM/Apply
9. **禁止项** — Registry · Switching · Hot Reload · Routing · Multi-Model · Guard · Shadow · Bootstrap · Compatibility Runtime
10. **E2E** — 131/131 effective_chain 为 Foundation 主链证明；全量 200 非 Foundation 阻塞项

---

## Deprecated / Archived Documents

| 路径 | 类别 | 处理 |
|------|------|------|
| `archive/deprecated/` | Registry / Phase2A 废弃方案 | **KEEP** archived |
| `archive/audit/` | 过程审计 | **MOVE** + README |
| Phase 1 Plans（含 Registry 展望） | 历史依据 | **KEEP** + 顶部废弃说明 |
| Restart Supplement + Addendum | 已并入 CONTRACT_FREEZE | **KEEP** 历史依据 |

---

## Contract Alignment

| 契约域 | SSOT 章节 | 代码 | 对齐 |
|--------|-----------|------|------|
| Runtime Hop | §1 | 未改代码 | ✅ |
| Required Data | §2 | 未改代码 | ✅ |
| Feature Baseline | §3 | `contract.py` | ✅ |
| Single Service/Model | §4 | `loader` + `numpy_p0` | ✅ |
| Backend Boundary | §5 | `backends/numpy_p0.py` | ✅ |
| Loader | §6 | `get_tone_loader()` → `load(None)` | ✅ |
| Artifact / Metadata | §7 | `ToneModelMetadata` | ✅ |
| Diagnostics | §8 | `api_routes` toneModule | ✅ |
| Ownership | §10 | Recall tone-free downstream | ✅ |
| Regression | §12 | test_phase2_contracts + E2E JSON | ✅ |

---

## Architecture Compliance

- Runtime · Decision · Contract **代码未修改**（本轮仅文档）
- 文档与 [Foundation Freeze Audit](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md) **一致**
- 无 SSOT 文档再推荐 Registry / Switching 路线

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 对象 |
|------|------|
| **KEEP** | Phase 1+2 冻结证据报告；`archive/deprecated/` Phase2A 审计；代码与测试 |
| **MODIFY** | `TONE_V2_CONTRACT_FREEZE.md` · `README.md` · `ARCHITECTURE.md` · Phase 1 Plan 顶部说明 |
| **RESTORE** | 无 |
| **DELETE** | 无（审计文档为 **MOVE** 至 archive，非删除） |

---

## Remaining Documentation Risks

| ID | 风险 | Severity | 建议 |
|----|------|----------|------|
| DR-01 | 根目录仍有大量 Phase 1 `*_Audit_*.md` 未迁入 `archive/audit/` | LOW | 后续文档清理轮次统一迁入 |
| DR-02 | `_audit_*.json` 仍在 `docs/tone-v2/` | LOW | 保持非 SSOT；可选迁入 archive |
| DR-03 | `freeze-contract` CLEANUP-2 文档未在 Tone SSOT 展开 | LOW | FW 域并行文档 |
| DR-04 | Restart Supplement/Addendum 与 CONTRACT_FREEZE 重复 | LOW | **KEEP** 作历史；以 CONTRACT_FREEZE 为准 |

**无 HIGH 风险项阻塞模型能力开发前审计。**

---

## Final Verdict — 五问

| # | 问题 | 答案 |
|---|------|------|
| 1 | Phase 2 Foundation 是否已写入 SSOT？ | **是** — `TONE_V2_CONTRACT_FREEZE.md` |
| 2 | 是否仍存在 Registry/Switching/Multi-Model **文档入口**？ | **否**（仅 `archive/deprecated` 只读） |
| 3 | 是否仍存在多个互相冲突的 Phase 2 **方案**？ | **否** — 已收敛至 Single Service/Model |
| 4 | 后续模型能力开发唯一依据？ | **`TONE_V2_CONTRACT_FREEZE.md`** + **`tone-module/ARCHITECTURE.md`** + **`Tone_V2_Phase2_Deployment_Runbook.md`** + 代码 |
| 5 | 是否可以进入模型能力开发前代码审计？ | **是** |

```text
PASS
```

---

## 后续模型能力开发边界（摘自 SSOT）

**允许：** 同 featureVersion 权重升级 · 离线训练 · benchmark · 全量 dialog_200 质量评估 · optional metadata 填充  

**禁止（须再冻结）：** Runtime hop · Required Schema · Decision Ownership · Service Boundary · Registry/Switching · Guard 恢复 · featureVersion 变更不经新实例/再冻结
