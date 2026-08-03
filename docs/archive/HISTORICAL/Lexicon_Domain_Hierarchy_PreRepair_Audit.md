<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lexicon_Domain_Hierarchy_PreRepair_Audit.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lexicon Domain Hierarchy PreRepair Audit

**Date:** 2026-07-19  
**Type:** Read-only · Pre-Repair Audit  
**Baseline Bundle:** v9 · `lexicon-full-rebuild-v1`

---

## 1. Runtime 如何使用 hierarchy

| 环节 | 行为 |
|------|------|
| Bundle 加载 | `LexiconRuntimeV2.load` → `installRuntimeDomainRegistry(db, manifest)` |
| available fine | **SSOT =** `DISTINCT term_domain_tags.domain_id`（与 hierarchy 无关） |
| hierarchy 读取 | **仅** `SELECT parent_domain_id, child_domain_id FROM domain_hierarchy` |
| fine→coarse | `fineToCoarseMap`：有 parent 则用 parent；**无 parent 则 fine→自身** |
| coarse→fine | `coarseToFineMap`：仅包含 child ∈ availableFine 的边 |
| available coarse | `Object.keys(coarseToFineMap)`（有可用 child 的 parent） |
| LLM 选域 | `llmAllowedDomains` = availableCoarse ∪ standalone fine（parent 缺失时 fine 当粗域） |
| Recall scope | `expandPolicyToFineDomains`：若 policy 命中 coarse 则展开 children ∩ available；**空 policy → 全量 availableFine** |
| Candidate / Vote | **不直接读 hierarchy**；Vote 用 candidate `domainId` |
| ReRank | `domain-rerank.ts` 用 `fineToCoarseMap` 比较 coarse 关系 |
| profile-registry | **Runtime 决策不依赖**；仅 displayName / `isValidLLMDomain` 白名单展示辅助 |

**结论：** Runtime hierarchy 决策 SSOT = **Bundle SQLite `domain_hierarchy`**。缺失 parent 不会 crash，但会把 fine 当成 coarse（Acceptance C6 失败根因）。

---

## 2. 构建源 / 第二份映射？

| 源 | 角色 |
|----|------|
| `data/lexicon/profile-registry.json` | **Build-time** 文档化 parent 字段；DSU：`profile-registry.json → build-time only` |
| `domain_hierarchy`（sqlite） | **Runtime** 唯一 hierarchy SSOT |
| 配置文件 fine→coarse 表 | **未发现** 第二份映射 |

当前 `profile-registry.json` 中：

```text
tech_ai / medical / meeting / transport → parent: null
```

与 sqlite 中「四域无 parent 边」一致；restaurant/travel 子域有 parent，对应现有 8 行。

**本轮必须同步修改 profile-registry（构建源）+ sqlite domain_hierarchy（运行 SSOT）。**

---

## 3. 硬编码白名单？

| 问题 | 答案 |
|------|------|
| parent 是否只允许固定枚举？ | **否**。Registry 动态读库；无 TypeScript union 限制 parent 字符串 |
| coarse 是否动态读取？ | **是**。来自 hierarchy ∩ available |
| 是否硬编码仅 `restaurant`/`travel`？ | **否**（Recall/Registry 无此白名单）。测试/gate 有 `domain_hierarchy: 8` **数量阈值** |
| 新增 coarse 是否需改 TS 类型？ | **否**（字符串 id）。**是**：须写入 `profile-registry.json`，否则 LLM display / `isValidLLMDomain` 可能缺条目 |
| hierarchy 是否参与 Recall 打开域？ | **间接**：仅当 `enabledDomains` 配置为 coarse 时展开；默认 `[]` → 全量 fine，不依赖 hierarchy |
| `transport` vs `tourism_transport` | **不同语义**；分属 transportation / travel；**禁止合并** |

---

## 4. Gate / 测试耦合

- `scripts/lexicon/lib/lexicon-v3-runtime.mjs`：`domain_hierarchy: 8`
- `freeze-contract.test.ts` GATE-DSU-4：断言该阈值字符串
- `run-patch-e2e-runner.mjs`：断言 `tables.domain_hierarchy === 8`

本轮补齐后 rows=12，**必须**将阈值/断言更新为 12（最小必要，非 Runtime 业务逻辑改动）。

---

## 5. 修复策略（Case A+B）

1. 更新 `profile-registry.json`（正式 seed/source）  
2. 受控 migration：`INSERT OR IGNORE` 四条边到 `domain_hierarchy`（不清空、不碰其他表）  
3. 更新 manifest/checksum/`domainHierarchyVersion` / `bundleVersion=10`

---

## 6. 本轮不改

Candidate DTO · Vote · sameDomain · Assembly · `domains[0]` · term/tags/materialized tables
