<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_Development_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1C Mandatory Tone Recall Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Batch | **1.1C — Mandatory Tone Recall** |
| Baseline commit | `c1bd267c707b6d103958f2c41dfccd83911c78a7` |
| Contract | Implementation Contract **CR 1.0.8** |
| SSOT | [`…Batch1_1C_Mandatory_Tone_Recall_PreDevelopment_Audit_And_Repair_Design_2026_07_28.md`](./FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_PreDevelopment_Audit_And_Repair_Design_2026_07_28.md) |

---

## 1. Executive Summary

Lattice Tone Recall 已改为 **Mandatory Tone / Fail Closed**：

```text
No Tone → No Candidate.
Tone underfill → 仅返回已有 Tone Candidate（不 Plain 补齐）.
Tone exact miss → Empty（不 Plain exact）.
```

删除全部 Tone→Plain 生产路径；建立唯一 `resolveToneRecallReadiness` SSOT。1.1A / 1.1B、Runtime rows-only、LIMIT=8/2（仅 Tone）、Edge/Path/Vote/KenLM 业务语义未越界修改。

---

## 2. Frozen SSOT

| 状态 | 唯一允许行为 |
|------|----------------|
| Tone Pattern 完整合法且 Runtime 支持 | Tone Recall |
| Pattern 缺失 / 非法 / Caller 关闭 / Runtime 不支持 | Empty |
| Tone SQL 空 / underfill / exact miss | Empty 或已有 Tone Candidate；**Plain SQL = 0** |

---

## 3. Baseline

| Item | Value |
|------|-------|
| Git HEAD (pre-change) | `c1bd267c707b6d103958f2c41dfccd83911c78a7` |
| Branch | `feature/fw-v4-multi-path-lexical-lattice-v1` |
| 审计入口确认 | `collectBaseOnlySingleCharCandidate` / `collectTierCandidatesToneFirst` / `lookupPlainTiers` / `needPlainFallback` / `dedupeByIdPreferToneExact` / `plain_*` stages **均存在于修改前** |

差异：实现时沿用审计调用关系；额外将 `phase1-window-edge-harness` 的硬编码 `toneTimestampOnlyEnabled: false` 改为可传入（否则 harness 在 Fail Closed 下永远 Empty）。

---

## 4. Files Changed（核心）

| 文件 | 角色 |
|------|------|
| `lexicon-v2/tone-recall-readiness.ts` | **NEW** readiness SSOT |
| `lexicon-v2/tone-first-tier-collector.ts` | Fail Closed；删除 Plain fill |
| `lexicon-v2/recall-span-topk-v2.ts` | Length1 Fail Closed；Tone-only exact |
| `lexicon/tone-recall-sort.ts` | 仅 `tone_exact` stage |
| `fw-detector/.../recall-topk-for-windows.ts` | 传递 `toneCallerEnabled` |
| `fw-detector/.../phase1-window-edge-harness.ts` | 转发 tone 开关/声学 payload |
| `fw-detector/.../build-lexical-edges.ts` | 停止从 `plain_fallback` 置 `hasToneRelaxed` |
| 多项 SQLite/unit/audit 测试 | 对齐 SSOT + Plain SQL zero-call |
| Implementation Contract / INTERFACE_FREEZE | CR 1.0.8 + 诊断字段语义 |

---

## 5. Tone Readiness Implementation

**文件：** `tone-recall-readiness.ts`  
**函数：** `resolveToneRecallReadiness`

| 修改前 | 修改后 |
|--------|--------|
| length1/2–5 各自用 `toneActive = key!=null && supportsTone()` | 单一纯函数；可选 `toneCallerEnabled` |
| 无法区分 caller_disabled vs no_pattern | 顺序：caller_disabled → runtime_unsupported → no_pattern → invalid_pattern → ready |

符合 SSOT：只判定、不查库、不生成 Candidate、不 fallback。

---

## 6. Length1 Changes

**文件：** `recall-span-topk-v2.ts` · `collectBaseOnlySingleCharCandidate`

| 修改前 | 修改后 |
|--------|--------|
| `!toneActive` → plain amb + plain exact · stage `plain_only_no_pattern` | readiness≠ready → Empty；Plain API 不调用 |
| ready → Tone amb/exact | 保留；1.1A/1.1B 不变 |

---

## 7. Length2–5 Changes

**文件：** `tone-first-tier-collector.ts` · `collectTierCandidatesToneFirst`

| 修改前 | 修改后 |
|--------|--------|
| `!toneActive` → `lookupPlainTiers` | Empty + readiness |
| `needPlainFallback` → plain fill + `dedupeByIdPreferToneExact` | 删除；underfill 返回已有 Tone rows |

---

## 8. Plain Fallback Removal

删除生产路径：

```text
Tone unavailable / unsupported / invalid / empty / underfill / exact miss → Plain
```

---

## 9. Dead Code Removal

| 符号 | 处理 |
|------|------|
| `lookupPlainTiers` | DELETE（collector 内） |
| `needPlainFallback` | DELETE |
| `dedupeByIdPreferToneExact` | DELETE |
| stage `plain_fallback` / `plain_only_no_pattern` | 生产赋值 DELETE；类型收窄为 `tone_exact` |

---

## 10. Diagnostics Migration

- 生产不再赋值 `plain_fallback_hits`（恒为 undefined/0）
- readiness 状态可经 `toneRecallReadiness` / skip codes `tone_*` 观测
- 诊断字段 `plain_fallback_hits` / `plainFallbackHitCount` **保留兼容**，语义改为 always-0

---

## 11. Sorting / Scoring Cleanup

`tone-recall-sort.ts`：删除 plain stage 权重；仅 `tone_exact`。

---

## 12. Runtime API Retention

| API | 状态 |
|-----|------|
| `lookupBaseByPinyinKey` | KEEP — Runtime contract / 非本链调用 |
| `lookupBaseByExactSurfaceAndPinyin` | KEEP — 同上 |
| Tone Recall 生产链引用 | **0**（spy 断言覆盖） |

---

## 13. Edge Input Impact

- `hasToneRelaxed`：本链不再由 `plain_fallback` 置 true；字段保留（Path 计数等）
- 未改 LexicalEdge contract / Path / Vote / KenLM 算法

---

## 14. SSOT Documents Updated

| 文档 | 动作 |
|------|------|
| Implementation Contract | **CR 1.0.8** |
| INTERFACE_FREEZE.md | `plainFallbackHitCount` 语义 |
| Mandatory Tone Pre-Dev Audit | 标为 IMPLEMENTED |
| Tone Unsupported Pre-Dev Audit | 标为 **SUPERSEDED** |

---

## 15. Deleted Conflicting Definitions

停用作为可用策略的描述：

```text
Tone unsupported → Plain
No pattern → Plain-only
Tone underfill → Plain fill
plain_fallback 是合法 Candidate 来源
```

旧审计报告保留历史证据，但不再是有效政策。

---

## 16. KEEP

1.1A truncation · 1.1B exact identity · LIMIT 8/2（Tone）· Runtime rows-only · Recall Candidate ownership · Candidate Kind · SQLite schema · Edge/Path/Vote/Assembly/KenLM 业务逻辑 · Plain Runtime API（非本链）

## 17. MODIFY

Readiness SSOT · Length1/2–5 collectors · sort stages · harness tone forwarding · tests · CR/docs

## 18. DELETE

Plain-only / underfill Plain / plain stages / dead helpers（见 §9）

---

## 19. Risks

| Risk | Mitigation |
|------|------------|
| 无 Tone 窗口 Candidate/Edge/Path 下降 | 预期；记为 Tone coverage / timestamp alignment；**禁止恢复 Plain** |
| dialog_200 全量需声学 Tone 对齐 | Coverage FOLLOW-UP；本轮不恢复 fallback |
| live harness 依赖 pinyin-ime dict 路径 | 环境缺 dict 时 live 失败与 1.1C 语义无关 |

---

## 20. Target List

```text
[x] 记录开发前基线
[x] 建立唯一 ToneRecallReadiness
[x] 删除 Length1 Plain-only / Plain exact
[x] 删除 Length2–5 Plain-only / underfill Plain
[x] 删除无引用 Plain helpers
[x] 清理废弃 stage / 排序
[x] Tone Recall 不调用 Plain Runtime API
[x] Plain SQL zero-call 测试
[x] 1.1A / 1.1B / Edge / Path 回归
[x] SSOT / CR 更新 + 冲突文档失效
[x] 开发报告 / 测试报告
```

## 21. Check List

```text
[x] 未新增双链路 / 兼容开关 / shadow
[x] 未修改 SQLite / Candidate Kind / LIMIT 数值语义（仅用于 Tone）
[x] 未改 Runtime rows-only / Recall ownership
[x] 未越界改 Edge/Path/Vote/Assembly/KenLM 业务逻辑
[x] 未进入 Batch 1.1D / Batch 2
```

## 22. Final Verdict

```text
BATCH 1.1C MANDATORY TONE RECALL

IMPLEMENTATION:
PASS

TONE READINESS SSOT:
UNIFIED

TONE → PLAIN PATHS:
ZERO

UNDERFILL PLAIN PATHS:
ZERO

PLAIN SQL CALLS FROM TONE RECALL:
ZERO

DEAD CODE:
CLEAN

DOCUMENT SSOT:
ALIGNED

REGRESSION:
PASS

TONE COVERAGE:
REQUIRES FOLLOW-UP

READY FOR BATCH 1.1C CLOSURE AUDIT:
YES
```
