# Freeze Readiness Cleanup Plan

```text
STATUS: EXECUTION RECORD

Phase-0 scope checklist for Freeze Readiness Cleanup. Final contract: Runtime_SSOT_Contract_Freeze.md.
```

| 字段 | 值 |
|------|-----|
| Document Status | **EXECUTION RECORD** |
| 任务 | Runtime SSOT Freeze Readiness Cleanup |
| 日期 | 2026-07-19 |
| 前置 | `Runtime_SSOT_Recovery_Baseline_Audit.md` |
| 性质 | Phase 0 范围确认（执行中继续 Phase 1–6） |

---

## 处理动作枚举

`KEEP` · `REMOVE` · `RESTORE` · `REWRITE` · `ARCHIVE` · `MARK SUPERSEDED` · `NO ACTION` · `BLOCKED FOR SEPARATE AUDIT`

---

## 清单

| # | 文件 | 当前内容 | 问题类型 | 冻结依据 | 处理动作 | 验证方式 |
|---|------|----------|----------|----------|----------|----------|
| 1 | `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` | Candidate 写成 “membership 压缩”；Draft | 合同措辞误导 | Baseline Audit §23；本任务 §9.1 | **REWRITE** + 条件满足后升 **FROZEN** | 文档 diff + 人工可读检查 |
| 2 | `recall-topk-for-windows.ts` | 缺 `tone.recallToneIncompatibleCount = fallback` | 越界删除 / 诊断别名 | HEAD 有赋值；类型无正式字段；实验脚本仍读 | **RESTORE** 赋值 + 类型 optional 别名；**BLOCKED FOR SEPARATE AUDIT**（Tone Contract 重命名） | tsc；源码含赋值；实验可读 |
| 3 | `patch-recall-smoke.ts` | `RecallSmokeRow.hits[].domain?` 但映射写 `domains` | 旧单值类型残留 | Lexicon Domain Freeze；Hotword=`domains[]` | **REMOVE** `domain?`；**REWRITE** 为 `domains?: string[]` | tsc；grep `domain?` 于该文件 NONE |
| 4 | `freeze-contract.test.ts` GATE-INT-2 | 要求 pick 传播 windowSource | 测试加严 vs FROZEN_V1_2 | FROZEN_V1_2 未要求；converter/assembly 不读 | **REWRITE** gate：保留 optional 类型槽位断言；取消强制传播；归类 CFG Integration | freeze-contract PASS |
| 5 | `freeze-contract.test.ts` CLEANUP-2 | 禁止 `hardDropCount` 字符串 | 测试与 compatibility FROZEN 冲突 | `compatibility/FROZEN.md` 列出 hardDropCount；主路径恒 0 | **REWRITE** gate：断言零路径 stub 存在且为 0 | freeze-contract PASS |
| 6 | `dist/main` | 可能 stale | 构建产物风险 | 本任务 §10 | **REMOVE** clean + **RESTORE** `build:main` | dist grep + Electron smoke |
| 7 | Multi-Domain Development Report 等 | 曾宣称 PASS | 误导历史文档 | Deviation Audit 否定 | **MARK SUPERSEDED** / **REJECTED** 状态头 | 文档头可见 |
| 8 | multi-domain-*.test.ts | 已删 | 假阳性测试 | Baseline Audit | **NO ACTION**（确认无重命名副本） | glob + grep |
| 9 | selectedDomain / candidateDomains | 业务代码无 | 残留搜索 | Runtime SSOT | **NO ACTION**（确认 NONE） | rg |
| 10 | Hotword.domain | 类型已无；无 `hotword.domain` 读 | 旧镜像 | Lexicon Domain Freeze | **NO ACTION**（确认） | rg |
| 11 | 冲突注释 / README | 部分 R2 注释 OK；压缩点需 KNOWN DEBT | 注释治理 | 本任务 §9.4 | **REWRITE** 唯一压缩点注释 | 源码阅读 |
| 12 | 声称 Multi-Domain Runtime PASS 的报告 | Development Report | 误导 | Deviation Audit | **MARK SUPERSEDED** | 状态头 |
| 13 | `DomainAware` 中间 `domainId` | 合法中间态 | 文档边界 | §9.1 中间态 | Freeze 文档 **REWRITE** | 文档 |
| 14 | 双 Vote shadowVote | 诊断链 | 文档边界 | §9.1 | Freeze 文档 **REWRITE** | 文档 |
| 15 | `RUNTIME_DOMAIN_DOCUMENT_INDEX.md` | 不存在 | 缺索引 SSOT | §9.3 | **REWRITE**（新建） | 文件存在 |
| 16 | acceptance / stale dist 保护 | 无统一入口 | 构建治理 | §10.2 | **REWRITE** 最小 acceptance 脚本或文档命令 | 脚本执行 |
| 17 | hardDropCount 字段本体 | stub=0 | 非 Domain SSOT | compatibility FROZEN 仍列字段 | **KEEP** stub；不整删 | CLEANUP-2 修订后 PASS |
| 18 | window / Recovery / Baseline Audit | 状态未标 | 文档治理 | §9.2 | **MARK SUPERSEDED** / EXECUTION / ACCEPTED | 状态头 |
| 19 | `assemble-domain-aware` 等债务测试表述 | 未标 LEGACY | 测试措辞 | §8.3 | **REWRITE** describe/it 标题 | 测试仍 PASS |
| 20 | ABI 假阳性 skip | 已删 multi-domain 测 | 确认 | §8.1 | **NO ACTION**（确认无 skip→PASS） | rg skip |

---

## Gate 分类（Phase 2）

| Gate | 分类 | 本 Freeze 处理 |
|------|------|----------------|
| GATE-DSU-* / GATE-CP-* | A. Runtime Domain SSOT 必须 | 保持；必须 PASS |
| GATE-INT-2（修订后） | B. CFG / Integration | 修订为非强制传播；仍在 suite 内 PASS |
| CLEANUP-2（修订后） | C. Cleanup 非阻断→对齐 FROZEN | 修订为 zero-path 断言；PASS |
| 其它现有 freeze gates | A/B 按原文档 | 全量运行，不得 -t 子集宣称通过 |

---

## Tone 字段判定预选

**选择 C（偏恢复）+ 独立 Tone Audit 标记：**

- 恢复 `tone.recallToneIncompatibleCount = tone.recallToneFallbackCount`
- 在 `CoarseAssemblyToneDiagnostics` 增加 optional 别名字段并注释：legacy alias；正式语义以 `recallToneFallbackCount` 为准
- 不在本轮宣布废弃实验脚本字段名

---

## 明确不在本轮

* Membership Repair / Vote 多域 / DomainWeight / sameDomain includes / Shadow 删除 / Lexicon 数据改写

```text
PHASE 0 COMPLETE — CONTINUE PHASE 1
```
