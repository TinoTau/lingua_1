<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_Test_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1C Mandatory Tone Recall Test Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Batch | **1.1C — Mandatory Tone Recall** |
| Runner | Electron ABI (`ELECTRON_RUN_AS_NODE=1` + jest `--runInBand`) |
| Baseline commit | `c1bd267c707b6d103958f2c41dfccd83911c78a7` |

---

## 1. Test Environment

| Item | Value |
|------|-------|
| OS | Windows 10 |
| Lexicon fixture | temp SQLite bundles + `node_runtime/lexicon/v3`（部分集成） |
| 命令模式 | `electron.exe node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage` |

---

## 2. Unit Test Results

| Suite | Result |
|-------|--------|
| `tone-recall-readiness.test.ts` | PASS |
| `tone-recall-sort.test.ts` | PASS |
| `batch1-1c-mandatory-tone-recall.sqlite.integration.test.ts` | PASS |
| `recall-span-topk-v2.test.ts` | PASS |

Readiness 覆盖：`ready` / `no_pattern` / `invalid_pattern` / `caller_disabled` / `runtime_unsupported`。

---

## 3. Plain SQL Zero-Call Assertions

Spy 覆盖（非 ready + underfill / empty Tone）：

```text
lookupBaseByPinyinKey = 0
lookupBaseByExactSurfaceAndPinyin = 0
```

主要文件：`batch1-1c-mandatory-tone-recall.sqlite.integration.test.ts`、length1 surface-exact / length1 integration、`recall-span-topk-v2.test.ts`。

---

## 4. 1.1A Regression

| Suite | Result |
|-------|--------|
| `recall-span-topk-v2-length1-truncation.sqlite.integration.test.ts` | PASS |
| `batch1-1a-stage4-generalization.audit.test.ts` | PASS |

说明：原 “Plain path” 用例改为 **Tone path + 正确 acousticTonePattern**，仍验证 truncation-aware uniqueness。

---

## 5. 1.1B Regression

| Suite | Result |
|-------|--------|
| `recall-span-topk-v2-length1-surface-exact.sqlite.integration.test.ts` | PASS |
| `batch1-1b-surface-reachability.audit.test.ts` | PASS |
| `batch1-1b-stage4-generalization.audit.test.ts` | PASS |

原 “plain exact without pattern” 改为 Fail Closed Empty + Plain SQL=0。

---

## 6. Length1 Results

| Suite | Result |
|-------|--------|
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | PASS |
| `length1-recall-edge-path.sqlite.integration.test.ts` | PASS |

---

## 7. Length2–5 Results

| Suite | Result |
|-------|--------|
| `recall-span-topk-v2.test.ts`（tone-first / no-pattern Empty） | PASS |
| TopKV2/V3 相关回归（batch 套件内） | PASS |

---

## 8. Edge Regression

| Suite | Result |
|-------|--------|
| `phase1-window-edge-harness.test.ts` | PASS |
| `length1-recall-edge-path` Edge 段 | PASS |
| `build-lexical-edges` evidence（无 plain_fallback） | PASS |

---

## 9. Path Regression

| Suite | Result |
|-------|--------|
| length1 Edge→Path | PASS |
| `connectivity-path-vote-bind` / phase2 harness（套件内） | PASS |

---

## 10. dialog_200 Results

本轮 **未重跑全量 dialog_200 LTR offline probe**（需完整声学 Tone 时间戳对齐；Fail Closed 后无 Tone 窗口直接 Empty）。

Stage4 审计以 parameterized length1 corpus 替代 dialog_200 触发率统计（与 1.1B Stage4 一致）。

**判定：** Tone coverage **REQUIRES FOLLOW-UP**（对齐问题，不得恢复 Plain）。

---

## 11. Tone Coverage Metrics

来自 Batch 1.1C 单元/集成断言的结构覆盖（非 dialog_200 规模）：

| Metric | Observation |
|--------|-------------|
| readiness states | 5 态均有单测唯一输出 |
| length1 Fail Closed | no_pattern / invalid / caller_disabled / runtime_unsupported / exact miss → Empty |
| length2–5 underfill / empty | Tone-only 或 Empty；Plain=0 |
| harness | 无 Tone payload 时不得静默 Plain（caller_disabled / no_pattern） |

全量窗口级计数（总窗口 / tone_ready rate / length1–5 分层 / Path 完整率 / fallback Edge 比例）→ **dialog_200 + 声学对齐后输出**（Closure Audit 输入）。

---

## 12–15. Candidate / Edge / Path / Fallback Edge Delta

| Delta | Classification |
|-------|----------------|
| Candidate ↓ when no Tone | **预期**：删除非法 Plain Candidate |
| Edge / Path ↓ when no Tone | **预期**：上游 Empty |
| Fallback Edge ↑ | 若发生：连通性补偿，**非** Tone→Plain 恢复 |

不得将上述自动判为回归失败。

---

## 16. Failures

主回归（排除 live dict 环境问题）：

```text
suites 21/21 PASS · tests 248 PASS · failed 0
```

`phase1-window-edge-harness.live.test.ts`：本环境 `pinyin-ime-v2/dict` 路径缺失导致 harnessDeps 抛错（与 1.1C Fail Closed 语义无关）。SQLite length1 harness 已 PASS。

---

## 17. Root Cause Classification

| Symptom | Class |
|---------|--------|
| 无 pattern 窗口 Empty | SSOT Fail Closed |
| Candidate 下降 | 删除非法 Plain |
| live dict missing | 环境 / 路径 |
| dialog_200 未全量 | Tone coverage FOLLOW-UP |

---

## 18. Final Verdict

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

---

## Appendix A — Residual Search（生产 + 测试）

| 符号 | 剩余位置 | 用途 | 符合 SSOT |
|------|----------|------|-----------|
| `lookupPlainTiers` / `needPlainFallback` / `dedupeByIdPreferToneExact` / `plain_only_no_pattern` | **无生产引用** | — | YES |
| `plain_fallback` | 诊断字段名 / 注释 / 历史实验脚本 | 兼容计数 always-0；实验脚本历史 | YES（非生产路径） |
| `toneActive` | `recall-topk-for-windows.ts` | 仅控制是否 **提取** acoustic pattern | YES（非 Plain gate） |
| `lookupBaseByPinyinKey` / `lookupBaseByExactSurfaceAndPinyin` | Runtime + Runtime/contract/audit 测试 + 实验工具 | 非 Mandatory Tone Recall 生产链 | YES |
| Tone Recall 生产链对上述 Plain API | **0**（spy） | — | YES |
