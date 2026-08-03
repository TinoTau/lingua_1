<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Unified_Atomicity_Gate_Development_Report_2026_08_02.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Unified Formal-Term Atomicity Gate Development Report

**Date:** 2026-08-02  
**Nature:** DEVELOPMENT / UNIFIED ATOMICITY GATE ONLY  
**Verdict:** `ATOMICITY_GATE_PASS`

---

## 1. Executive Summary

已实现唯一 `AtomicityValidator`（SSOT：`scripts/lexicon/lib/atomicity-validator.cjs`），并强制接入 Full Rebuild、Patch V3、Patch V4、Industry Import。默认 `atomicityMode=audit`：完整审计 10061 正式 term，**不删除任何现有词**；业务内容 Hash 仍为生产值。

关键审计：

| surface | decision | reasonCode | segments |
|---------|----------|------------|----------|
| 上线计划 | REJECT_COMPOSITE | ACTION_OBJECT_PHRASE | 上线+计划 |
| 接口文档 | REJECT_COMPOSITE | NOUN_NOUN_BUSINESS_PHRASE | 接口+文档 |
| 蓝莓马芬 | UNRESOLVED | UNRESOLVED_NEEDS_EXCEPTION | 蓝莓+马芬 |
| 大床房 | ACCEPT | ATOMIC_DEFAULT | — |

Audit summary：ACCEPT 9247 / REJECT_COMPOSITE 74 / UNRESOLVED 740 / ACCEPT_EXCEPTION 0。

---

## 2. Frozen Scope

| Done | Not done |
|------|----------|
| Unified Validator + Audit/Enforce | Source composite DELETE |
| All formal write paths wired | Bulk termType classification (810+) |
| Atomicity JSON/CSV reports | Runtime term schema extension |
| Bundle content preserved | Runtime Recall filter |
| Freeze GATE-ATOMICITY-1 | KenLM / JobResult / domain tag edits |

**ATOMICITY CONTENT CLEANUP NOT EXECUTED**

---

## 3. Atomicity Contract

- Prefer ACCEPT for 2–3 字独立词（长度非唯一依据；`大床房` ACCEPT）。
- 4–5 字进入结构判断：atom covering + 角色类（动作前缀 / 抽象业务中心语）。
- 合法例外：`termType` + `exceptionReason` → ACCEPT_EXCEPTION。
- 可拆仅为证据；产品名/专名无元数据 → UNRESOLVED_NEEDS_EXCEPTION（不自动删除）。

---

## 4. Validator Input / Output

**Input owner:** 写入路径构建 `AtomicityTermDraft`（surface/source/domains/termType/exceptionReason + 溯源字段）。

**Output:** `decision` + `reasonCode` + optional `segments` / `exceptionReason` / `detail`（三者分离）。

TS bridge：`main/src/lexicon-atomicity/atomicity-validator.ts`（Patch 路径唯一入口）。

---

## 5. Decision Rules

1. 空/非 CJK → REJECT SENTENCE_FRAGMENT  
2. 有 termType/exceptionReason → 齐全则 ACCEPT_EXCEPTION，否则 MISSING_EXCEPTION_METADATA  
3. 模板/句段标记 → REJECT TEMPLATE/SENTENCE_FRAGMENT  
4. length ≥ 6 → REJECT SENTENCE_FRAGMENT  
5. length ≤ 3 → ACCEPT SHORT_ATOMIC / ATOMIC_DEFAULT  
6. length 4–5：用正式 atom set（CJK 1–3）覆盖  
   - 动作前缀 + 对象 → ACTION_OBJECT_PHRASE  
   - 抽象业务中心语 → NOUN_NOUN_BUSINESS_PHRASE  
   - 其它可覆盖 → UNRESOLVED_NEEDS_EXCEPTION  
   - 不可覆盖 → UNRESOLVED_NEEDS_EXCEPTION  

无具体 surface 硬编码；无 `bad_compounds` 黑名单文件。

---

## 6. Exception Contract

允许类型：idiom / proper_noun / brand / organization / fixed_product / fixed_technical_term / fixed_expression。  
必须同时有 `termType` + `exceptionReason`。禁止仅 `allow=true`。

---

## 7. Audit / Enforce Modes

| Mode | Write | Use |
|------|-------|-----|
| audit（本轮 Full Rebuild 默认） | 始终允许；只记录 | 保持现有 Bundle |
| enforce（Patch/Industry 默认；Full Rebuild 目标） | 仅 ACCEPT / ACCEPT_EXCEPTION | Source 清理后 |

CLI：`--atomicity-mode=enforce` / env `LEXICON_ATOMICITY_MODE`。

---

## 8. Full Rebuild Integration

顺序：Load → Normalize → TermDraft → **Atomicity Validate** → Audit Record →（audit 下）写入 SQLite。  
报告写至 candidate：`atomicity_report.json` / `.csv`。  
Manifest 增加 `atomicity` 块。

---

## 9. Patch V3 Integration

`validateLexiconPatchV3`：`table===term && op===add` 强制 Validator；domain-tag-only 操作跳过。  
默认 enforce。

---

## 10. Patch V4 Integration

`validateLexiconPatchV4`：`addTerm` 强制 Validator；`appendDomainTags` 等跳过。  
默认 enforce。旧 `validateGranularity` 收敛为长度/denylist，Atomicity 不再由其拥有。

---

## 11. Industry Import Integration

`validateIndustryEntry` → Unified Validator。  
`build-patch-v4` 从 sqlite 加载 atom set。  
`rejectPhraseLike` 降级为非 Owner helper（仅映射 REJECT_COMPOSITE；禁止黑名单 Owner）。

---

## 12. Legacy Validator Consolidation

| Legacy | Status |
|--------|--------|
| rejectPhraseLike blacklists | Removed as Owner；helper 转调 Validator |
| validateGranularity（Atomicity 语义） | 不再作为 Atomicity Owner |
| scan-patch-granularity denylist | 保留为 expansion length/deny 工具，非 Atomicity SSOT |

---

## 13. Source Schema Changes

- review + supplemental：**可选**列 `term_type` / `exception_reason`（文档化于 `sources.manifest.json`）  
- tags / remove list：无需这些字段  
- 现有 CSV 行内容未改；缺列 → undefined → audit 报告  

Runtime SQLite **未**新增 termType/exceptionReason 列。

---

## 14. Atomicity Audit Artifacts

```text
node_runtime/lexicon/_rebuild_candidate/atomicity_report.json
node_runtime/lexicon/_rebuild_candidate/atomicity_report.csv
```

每行含 surface/termId/sourceFile/sourceRow/decision/reasonCode/segments/termType/exceptionReason/domains。

---

## 15. Current Source Audit Result

| decision | count |
|----------|------:|
| ACCEPT | 9247 |
| ACCEPT_EXCEPTION | 0 |
| REJECT_COMPOSITE | 74 |
| UNRESOLVED | 740 |
| **total** | **10061** |

---

## 16. Bundle Content Preservation

| Metric | Value |
|--------|-------|
| term | 10061 |
| contentHash | `2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f` (= production) |

上线计划 / 接口文档仍在。

---

## 17. Double Build Determinism

A (`_rebuild_candidate`) 与 B (`_rebuild_candidate_b`)：contentHash 相同；checksum `38c376c4…` 相同。

---

## 18. Runtime Regression

- Gate candidate：PASS  
- Exact Recall：equal  
- dialog_200：200/200，businessEqual=true  

---

## 19. Freeze Contract

- `Lexicon_Domain_Contract_Freeze_V1.md` §8  
- `GATE-ATOMICITY-1` in `freeze-contract.test.ts`

---

## 20. Remaining Composite Cleanup

下一阶段：Source-level review（74 REJECT + 740 UNRESOLVED）、填写合法例外、切 Full Rebuild 至 enforce、再删组合词（含上线计划/接口文档若确认）。

---

## 21. Target List Result

T1–T30：**PASS**（见开发目标清单；未删词、未改 domain、可进入 cleanup）。

---

## 22. Check List Result

```text
[x] 已实现统一 Validator
[x] 已实现统一 Decision 类型
[x] 已实现 Audit Mode
[x] 已实现 Enforce Mode
[x] 已接入 Full Rebuild
[x] 已接入 Patch V3
[x] 已接入 Patch V4
[x] 已接入 Industry Import
[x] 已删除或收敛旧 Atomicity 规则
[x] 未新增黑名单
[x] 未新增 Runtime 过滤
[x] 已定义例外合同
[x] 已生成 Atomicity JSON
[x] 已生成 Atomicity CSV
[x] 已审计全部 10061 term
[x] 上线计划被识别
[x] 接口文档被识别
[x] 蓝莓马芬未被误删
[x] 大床房保持合法
[x] Audit Mode 未删除词
[x] Enforce Mode 明确拒绝
[x] 双构建内容一致
[x] Exact Recall 一致
[x] dialog_200 200/200
[x] 未删除现有 term
[x] 未修改 domains
[x] 未修改 Runtime 算法
[x] 已生成开发报告
[x] 已生成测试报告
```

---

## 23. Final Verdict

```text
ATOMICITY_GATE_PASS

所有正式 term 写入路径已统一接入唯一 Atomicity Validator。

Audit / Enforce 合同、合法例外元数据和审计证据已建立；
不存在 Source 绕过、第二套规则、字符串黑名单或 Runtime 过滤。

Audit Mode 下现有词库内容和 Runtime 行为完全不变。

可以进入下一阶段：
Source-level Composite Review and Cleanup。
```
