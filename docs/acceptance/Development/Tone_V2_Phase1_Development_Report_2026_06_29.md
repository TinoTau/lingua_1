<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/Tone_V2_Phase1_Development_Report_2026_06_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Tone V2 Phase 1 — Development Report

**日期：** 2026-06-29  
**依据：** Phase 1 主方案 · Supplement · Final Addendum · Pre-Audit · `TONE_V2_CONTRACT_FREEZE.md`

---

## 1. 变更摘要

| 类别 | 项 | 裁决 |
|------|-----|------|
| **MODIFY** | Final Addendum §1.1 `toneReason` 枚举 | 修正为 `match \| mismatch \| no_pattern`；区分 `toneLookupStage` |
| **CREATE** | `docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md` | Phase 1 Contract Freeze SSOT |
| **CREATE** | `tone_module/contract.py` · `tone_module/loader.py` | Loader Foundation |
| **MODIFY** | `tone_module/classifier.py` | 经 Loader 加载；fail-closed 保持 |
| **MODIFY** | `api_routes.py` | `diagnostics.toneModule.loadError` + optional metadata |
| **DELETE** | `apply-tone-assembly-guard.ts` | 第二 Tone Decision，方案禁止 |
| **DELETE** | orphan `filter-domain-candidates-per-span.ts` | 生产用 `assemble-domain-aware-span-sets.ts` 内联 |
| **DELETE** | `ranking-repair.test.ts` | guard 正向测；GATE-RANK-04 迁至 freeze-contract |
| **DELETE** | `UtteranceTonePayload*` 别名 · `toneGuardBlockedCount` | 命名/诊断漂移 |
| **MODIFY** | `freeze-contract.test.ts` GATE-RANK-01/02/04 | 对齐生产路径 |
| **CREATE** | `tone-recall-counterfactual.test.ts` | Semantic 反事实（config 级） |
| **CREATE** | `tone_module/test_loader.py` | Loader fail-closed / metadata |
| **MODIFY** | `RANKING_V1_2.md` · `diagnostics/FROZEN.md` · `ARCHITECTURE.md` | 删 Tone Guard 承诺 |

---

## 2. Frozen Architecture Verification

| 验收项 | Expected | Actual | Impact |
|--------|----------|--------|--------|
| Runtime hop 未破坏 | FW→tone→ctx→Recall | ✅ 未改 hop | KEEP |
| Required schema | TonePosterior / AcousticToneSlice / UtteranceAcousticTonePayload | ✅ 未改 | KEEP |
| fail-closed | model missing → model_error | ✅ Loader + classifier | KEEP |
| 无第二 Pipeline | 无 Assembly Tone Guard | ✅ 已 DELETE | RESTORE |
| Tone Effective | Recall/Ranking only | ✅ guard 删除；Recall penalty 保留 | KEEP |
| KenLM/Apply tone-free | 无 tone 参数 | ✅ TONE-PRE-V2-2 仍过 | KEEP |
| Loader Foundation | contract.py + loader.py | ✅ 已实现 | MODIFY |
| GATE-RANK-02/04 | 生产符号 / 无 guard | ✅ 4/4 GATE-RANK 通过 | MODIFY |
| Semantic 反事实 | disabled → no penalty | ✅ counterfactual 单测 | MODIFY |
| Contract Freeze 文档 | 唯一 SSOT | ✅ `TONE_V2_CONTRACT_FREEZE.md` | CREATE |

---

## 3. 回归结果

| 套件 | 结果 |
|------|------|
| Jest: assemble-domain-aware · tone-match-score · tone-recall-counterfactual · span-assembly-v4-tone-score | **PASS** |
| Jest: freeze-contract GATE-RANK-01~04 | **PASS** |
| Python: test_classifier_fail_closed + test_loader | **9/9 OK** |
| freeze-contract 全量 | 3 失败（**既有** GATE-INT-2/4、CLEANUP-2；非本次引入） |

---

## 4. §11 Completion Gate 快照

| 项 | 状态 |
|----|------|
| Runtime hop / required schema | ✅ |
| DELETE guard/orphan/alias | ✅ |
| GATE-RANK-02/04 | ✅ |
| Loader + contract.py | ✅ |
| TONE_V2_CONTRACT_FREEZE.md | ✅ |
| Semantic 反事实集成测 | ✅ |
| dialog_200 / FW readiness | ✅（前序 post-recovery） |

---

## 5. 后续（Phase 1 范围外）

- CRNN / 训练管线 / Registry 完整实现
- `featureVersion` bump 与新 Mel 常量
- freeze-contract 既有 GATE-INT/CLEANUP 漂移（与 Tone V2 无关，单独 PR）

---

## 6. 批测后热修复（2026-06-29 dialog_200 验收发现）

| 项 | 问题 | 修复 |
|----|------|------|
| Loader `featureVersion` | 生产 npz 为 `mel_mean_80_v1`，Loader 仅接受 `p0-v1` → 全量 model_error | `contract.py` 增加 `P0_COMPATIBLE_FEATURE_VERSIONS` |
| orchestrator schema 常量 | 错误导入 `LEXICON_V3_FIVE_TABLE_RUNTIME_SCHEMA_VERSION`（undefined）→ FW 步骤失败 | 改为 `LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION` |
| `recallToneIncompatibleCount` | 已废弃字段赋值导致 TS 错误 | DELETE 赋值行 |

**Runtime 验证：** FW 直调 20/20 toneEnabled（见 `Tone_V2_Phase1_Runtime_Test_Report_2026_06_29.md`）。

**详细测试报告：** [`Tone_V2_Phase1_Runtime_Test_Report_2026_06_29.md`](./Tone_V2_Phase1_Runtime_Test_Report_2026_06_29.md)
