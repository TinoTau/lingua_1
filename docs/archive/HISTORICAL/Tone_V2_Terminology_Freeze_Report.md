<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Terminology_Freeze_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 — Terminology Freeze Report

**Date:** 2026-06-29  
**Task:** Terminology Freeze — 全项目术语 SSOT 建立与文档对齐  
**Scope:** **仅文档** — 无代码 · 无测试逻辑 · 无 Runtime / Training Pipeline 变更  
**依据:** Phase 1–3 Freeze · Phase 6-A/D/E · [Tone_V2_Phase6E_Documentation_Alignment_Report.md](./Tone_V2_Phase6E_Documentation_Alignment_Report.md)

---

## Executive Summary

本轮建立 Tone V2 **唯一术语 SSOT**，统一四级验收体系，消除 Smoke / Deployment Smoke / Shadow 等架构误导用语。

| 交付 | 状态 |
|------|------|
| [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md) | ✅ 术语 SSOT（FROZEN） |
| [TONE_V2_DOCUMENTATION_STYLE_GUIDE.md](./TONE_V2_DOCUMENTATION_STYLE_GUIDE.md) | ✅ 文档风格指南 |
| [README.md](./README.md) | ✅ 索引 + 四级体系摘要 |
| [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) | ✅ §0 验收术语 |
| [../tone-module/ARCHITECTURE.md](../tone-module/ARCHITECTURE.md) | ✅ Terminology 链接 |
| [../CODING/Lingua Project Constitution（Project SSOT）.md](../CODING/Lingua%20Project%20Constitution%EF%BC%88Project%20SSOT%EF%BC%89.md) | ✅ Tone V2 四级验收引用 |
| 活跃 Phase 报告 / Runbook 批量对齐 | ✅ 32+ 文件 |
| `archive/` README Historical Issue 标注 | ✅ |
| 代码 / 测试逻辑 | ✅ **未修改** |

### Final Verdict: **PASS**

---

## Modified Documents

### 新建（SSOT）

| 文件 | 用途 |
|------|------|
| `TONE_V2_TERMINOLOGY.md` | **唯一术语 SSOT** — Level 1–4 · Banned · Historical Issue |
| `TONE_V2_DOCUMENTATION_STYLE_GUIDE.md` | 写作规范 · 章节命名 · PR 检查清单 |

### 核心更新

| 文件 | 变更 |
|------|------|
| `README.md` | 术语 SSOT 表 · Runtime Validation 工具表述 · SSOT 三件套 |
| `TONE_V2_CONTRACT_FREEZE.md` | §0 四级验收 · TERMINOLOGY 链接 |
| `Tone_V2_Phase2_Deployment_Runbook.md` | Historical Issue 标注 · 禁止词 |
| `Tone_V2_Phase6E_*` Runbook / Dev Report / PreDev | Fixture Test · Dataset Probe 用语 |
| `docs/tone-module/ARCHITECTURE.md` | Terminology 链接 · Registry Historical Issue |
| `archive/audit/AUDIT_ARCHIVE_README.md` | 归档术语声明 |
| `archive/deprecated/DEPRECATED_README.md` | Historical Issue 头注 |
| `Lingua Project Constitution` | Tone V2 四级验收子节 |

### 批量对齐（`docs/tone-v2/*.md`，不含 `archive/`）

Phase 1–6 开发/审计报告、Dialog200 语料报告、P4 报告等 **32 个活跃文件**：`Deployment Smoke` → `Runtime Validation`；数据层 `smoke` → `Dataset Probe` / `Fixture Test` / `minimal corpus`（语料语境）。

**未改：** `electron_node/**` 代码 · 测试类逻辑（`TrainOrchestratorSmokeTest` 等代码标识保留）。

---

## Terminology Mapping

### 四级验收（冻结正名）

| Level | 名称 | 链 / 入口 |
|-------|------|-----------|
| **1** | **Unit Test** | `unittest` · `validate_artifact` 结构门 |
| **2** | **Dataset Probe** | Adapter → Provider → SyllableSample → Join Audit → Dataset Statistics Probe → **Fixture Test** |
| **3** | **Runtime Validation** | `TONE_MODEL_PATH` → FW Restart → Node E2E |
| **4** | **Architecture Verification** | Frozen Architecture · Drift Audit |

### 禁止 → 替换

| 禁止 | 替换 |
|------|------|
| Smoke · Smoke Test · Smoke Result · Smoke CLI | Level 1–4 正名 |
| Deployment Smoke · Offline Smoke | **Runtime Validation**（L3） |
| Fixture Verification | **Fixture Test**（全项目统一） |
| Shadow · Registry · Switching · A/B · Dual/Second Pipeline | **Historical Issue（已关闭）** |
| 语料「smoke 版」 | **minimal subset / minimal corpus**（非验收层级） |

### 保留不变

- **Join Audit** · **Dataset Statistics Probe** · **Runtime Validation** · **Architecture Verification** · **Frozen Architecture Verification** · **Offline Evaluation**（模型质量，非 L3）

---

## Documentation Consistency Result

### 活跃 SSOT 文档

| 检查 | 结果 |
|------|------|
| `TONE_V2_TERMINOLOGY.md` 四级体系完整 | ✅ |
| `README` 链接 TERMINOLOGY + STYLE GUIDE | ✅ |
| `CONTRACT_FREEZE` §0 与 TERMINOLOGY 一致 | ✅ |
| P6-E Runbook / Dev Report 无未标注 Smoke 验收用语 | ✅ |
| `Deployment Smoke` 在活跃 SSOT 中已消除 | ✅ |
| `Fixture Test` 统一（非 Fixture Verification） | ✅ |

### 允许的「Smoke」残留

| 位置 | 原因 |
|------|------|
| `TONE_V2_TERMINOLOGY.md` §3 Banned 表 | 列举禁止词 |
| `STYLE_GUIDE` 反例句 | 「不得这样说」 |
| `restore-dialog200-smoke.py` **文件名** | 历史脚本名；正文已注明非验收层级 |
| `archive/**` 原文 | 归档 + README Historical Issue 声明 |
| `Documentation_Alignment_Report` | 记录上一轮映射（历史） |

### 代码

| 检查 | 结果 |
|------|------|
| Runtime / Loader / Contract / Pipeline 代码 | ✅ 未修改 |
| 测试逻辑 | ✅ 未修改 |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| 单 Runtime 主链描述未变 | ✅ |
| 四级验收 **不**引入第二训练链或 Shadow | ✅ |
| Dataset Probe 明确不参与 Decision | ✅ |
| Runtime Validation 明确不替代 Dataset Probe | ✅ |
| Constitution Rule 0 与 Tone V2 术语一致 | ✅ |

---

## Architecture Drift Audit

| 区域 | Expected | Actual | Action |
|------|----------|--------|--------|
| 术语 SSOT | 唯一文件 | `TONE_V2_TERMINOLOGY.md` | **KEEP** |
| Smoke 作验收类型 | 禁止 | 活跃 SSOT 已清除 | **KEEP** |
| Registry/Shadow 现行能力暗示 | 禁止 | 仅 Historical Issue | **KEEP** |
| 代码执行路径 | 不变 | 无代码 diff | **KEEP** |
| archive 误导风险 | 低 | README 头注 + TERMINOLOGY 链接 | **KEEP** |

**Material Drift：无**

---

## KEEP

- 四级验收体系（Level 1–4）为 **唯一** Tone V2 验收词汇表
- `TONE_V2_TERMINOLOGY.md` 与 `TONE_V2_CONTRACT_FREEZE.md` 并列 SSOT
- `offline_tone_eval` = 模型质量（非 Runtime Validation）
- 历史脚本文件名 `*-smoke.py`（正文注明非层级名）
- `archive/` 原文作 Historical Issue 证据

## MODIFY

- 全部活跃 Tone V2 文档验收表述
- README · CONTRACT_FREEZE · ARCHITECTURE · Constitution 交叉引用
- P6-E Fixture Verification → **Fixture Test**

## RESTORE

- —

## DELETE

- 活跃文档中作为 **验收类型** 的 Smoke / Deployment Smoke 用法（已替换，非删文件）

---

## Remaining Risks

| 风险 | 等级 | 缓解 |
|------|------|------|
| `archive/` 内历史正文仍含旧词 | LOW | AUDIT_ARCHIVE_README + TERMINOLOGY 链接 |
| 代码内测试类名含 `Smoke` | LOW | 非验收 SSOT；后续可选重命名（非本轮） |
| 新文档未链 TERMINOLOGY | MED | STYLE GUIDE PR 检查清单 |
| dialog_200 脚本文件名 `-smoke` | LOW | TERMINOLOGY §3 文件名例外 |

---

## Final Verdict

# **PASS**

Tone V2 **Terminology Freeze** 已落地：四级验收体系为唯一 SSOT；活跃文档与核心 Runbook/契约已对齐；**Dataset Probe** 与 **Runtime Validation** 职责边界已书面冻结；**无代码与测试逻辑变更**。

**维护义务：** 新 Tone V2 文档须链接 [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md) 并标明验收 Level。

---

*Terminology Freeze — documentation only.*
