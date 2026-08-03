<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexicon_Reproducible_Full_Rebuild_Development_Report_2026_08_02.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexicon Reproducible Full Rebuild Development Report

**Date:** 2026-08-02  
**Nature:** DEVELOPMENT / REPRODUCIBILITY FIX ONLY  
**Verdict:** `REPRODUCIBLE_BUILD_PASS`

---

## 1. Executive Summary

正式词库 Full Rebuild 已从 `tmp/` 非声明血统恢复为仓库内 SSOT：

```text
electron_node/docs/lexicon-assets/full_rebuild_v1/
  + idiom_zh_v2/entries.jsonl
  + profile-registry.json
→ npm run lexicon:full-rebuild
→ node_runtime/lexicon/_rebuild_candidate
```

生产对照（只读）与候选 bundle 业务内容 hash 一致；Build A / Build B 一致；Exact Recall 与 dialog_200 业务结果等价。未执行原子化清理，未实现 Atomicity Validator，未改 Recall/Lattice/Vote/Assembly/KenLM/JobResult。

`CONTENT_HASH`（排序后业务表）：

```text
2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f
```

production = candidate A = candidate B。

---

## 2. Frozen Scope

| Allowed | Forbidden |
|---------|-----------|
| Source 正式化 + hash | 删「上线计划」「接口文档」或任何正式组合词 |
| 唯一 Full Rebuild 入口 | Atomicity Validator / termType / DELETE_COMPOSITE |
| Candidate 独立输出 + gate | 从生产 SQLite 复制 term/tag/idiom/hierarchy |
| Manifest 血统修复 | 用 tmp 作生产 SSOT |
| Package script 标注 | 改领域标签 / dialog_200 / KenLM / runtime 算法 |
| 对账与双构建确定性 | patch 追加模拟 Full Rebuild |

**ATOMICITY CONTENT CLEANUP NOT EXECUTED**

---

## 3. Previous Non-Reproducibility Finding

前序审计：`NOT_REPRODUCIBLE`

- 生产 `schemaVersion=lexicon-v3-runtime-v3` / `bundleVersion=11`：term/base=10061，idiom=22192，domain tags=1033。
- 真实血统在 `tmp/lexicon_corrected_review_20260718_extract/` 四份 CSV。
- 标准 `npm run lexicon:build:v2-shadow` 只读 p1_3 JSONL，无法复现生产。
- Manifest `seedInputs` 误导生产血统。

---

## 4. Formal Source SSOT

目标目录：

```text
electron_node/docs/lexicon-assets/full_rebuild_v1/
```

| File | Purpose | Records | sha256 (prefix) |
|------|---------|---------|-----------------|
| lexicon_full_corrected_review.csv | Primary term SSOT | 10000 | `83efb26b…` |
| terms_to_remove_or_rebuild.csv | Exclude list | 12 | `5911d4ac…` |
| supplemental_terms.csv | Supplemental terms/tags | 73 | `5412133a…` |
| term_domain_tags_corrected.csv | Domain tags | 970 | `e0d48445…` |
| sources.manifest.json | Hashes + load order | — | — |

附加声明 Source（非 CSV 目录内，但列入 load order）：

| Source | Purpose | Count / note |
|--------|---------|--------------|
| `.../idiom_zh_v2/entries.jsonl` | idiom_lexicon SSOT | 22192 |
| `electron_node/electron-node/data/lexicon/profile-registry.json` | domain_hierarchy | 12 edges |

正式化脚本：`npm run lexicon:formalize:full-rebuild-sources`  
README：`full_rebuild_v1/README.md` 标明 **PRODUCTION FULL REBUILD INPUT**。

---

## 5. Source Migration and Hash Verification

`formalize-full-rebuild-sources.mjs`：

1. 自 tmp extract 复制至正式目录（若尚未存在）。
2. 逐文件 byte sha256 对比 tmp vs formal。
3. 写入 `sources.manifest.json`，字段含 `matchesTmpExtract: true`。

结论：正式 Source **byte-identical** 于原 tmp Full Rebuild CSV；无换行/编码/排序改动；未改词条内容。

正式 build **拒绝** `sourceDir` 落在 `tmp/`。

---

## 6. Full Rebuild Entry

唯一生产入口：

```text
npm run lexicon:full-rebuild          # Electron ABI wrapper
npm run lexicon:full-rebuild:raw      # direct node (needs matching better-sqlite3)
```

实现：

- CLI：`scripts/lexicon/run-lexicon-full-rebuild.mjs`
- Core：`scripts/lexicon/lib/full-rebuild-from-csv.mjs` → `runFullRebuildFromSources`
- 默认输出：`node_runtime/lexicon/_rebuild_candidate`（`--force` / `--output`）
- **不**读取现有生产 SQLite 正式内容表；**不** ATTACH 旧库做内容导入。

---

## 7. Rebuild Order

冻结唯一顺序（已实现并写入 manifest `sourceInputs.loadOrder`）：

```text
1. Validate Source files + hashes + refuse tmp
2. Load review terms
3. Apply remove list
4. Load supplemental terms
5. Load corrected domain tags
6. Validate unique surfaces / IDs
7. Materialize term
8. Materialize base_lexicon
9. Materialize domain_lexicon
10. Materialize industry_routing_lexicon
11. Load idioms (JSONL)
12. Load domain hierarchy (profile-registry)
13. Write manifest
14. Write checksum
15. Caller / gate (npm run lexicon:gate:v3-runtime on candidate)
```

不存在第二套生产 Full Rebuild 实现。

---

## 8. Term ID Determinism

| Source | Rule |
|--------|------|
| Review CSV | 使用声明列 `term_id`（确定性，不从旧 DB 读取） |
| Supplemental | `term-{hex16}`；碰撞时 `supp-{hex24}`（与历史生产规则对齐） |
| base ids | `base-rebuild-${termId}` |

对账：`termId.idSame=10061`，`idChanged=0`。  
相同 Source surface → 相同 termId；未为匹配旧 ID 读取旧 SQLite。

---

## 9. Idiom Source

正式声明：

```text
electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/
  p1_3_lexicon_zh_v2/idiom_zh_v2/entries.jsonl
```

- sha256：`017f68a5…`
- recordCount：22192
- Full Rebuild 自 JSONL 写入 `idiom_lexicon`，**不**从旧 SQLite copy。

对账：idiom set diff empty；count 22192 = 生产。

---

## 10. Domain Hierarchy Source

正式声明：

```text
electron_node/electron-node/data/lexicon/profile-registry.json
```

- 自 parent links 物化 `domain_hierarchy`（12 行）
- sha256：`6f609767…`（亦写入 `domainHierarchyVersion`）
- **不**依赖历史 hierarchy patch 作为内容 SSOT；`lastPatchId: null` 于新 manifest。

对账：hierarchy set diff empty。

---

## 11. Manifest Truth Repair

候选 manifest 关键字段：

- `sourceInputs`：mode、sourceDir、loadOrder、termSources(+hashes/counts)、idiomSource、hierarchySource、excluded/supplemental/tag counts
- `historicalInputs`：标明 p1_3 seed / shadow **不是**生产 Full Rebuild 输入
- `rebuild.mode = FULL_REBUILD`
- `atomicityNote` / rebuild notes：`ATOMICITY CONTENT CLEANUP NOT EXECUTED`
- 误导性生产 `seedInputs` 不再作为当前 Source 声明

---

## 12. Package Script Changes

| Script | Role |
|--------|------|
| `lexicon:full-rebuild` | **正式生产 Full Rebuild** |
| `lexicon:formalize:full-rebuild-sources` | Source 正式化 / hash 校验 |
| `lexicon:build:v2-shadow` | **NOT PRODUCTION FULL REBUILD**（fixture/seed） |
| `lexicon:prepare:v3-runtime` | **NOT PRODUCTION FULL REBUILD**（shadow→v3 布局迁移） |
| `lexicon:retire:parent-fragment-schema` | **历史迁移工具**，非日常 build |
| `lexicon:gate:v3-runtime` | Schema/manifest/checksum gate（可对 candidate） |

---

## 13. Old SQLite Copy Elimination

Full Rebuild 路径：

- 拒绝 tmp sourceDir
- 不 ATTACH 生产 DB 导入 term/tag/idiom/hierarchy
- `retire-parent-fragment-schema` 仍可 copy 表，但已标注为历史工具，非正式日常入口

对账脚本可只读打开生产 bundle，**不**作为 build 输入。

---

## 14. Candidate Bundle Build

```text
Build A → node_runtime/lexicon/_rebuild_candidate
Build B → node_runtime/lexicon/_rebuild_candidate_b
```

均从空输出目录 `--force` 重建；**未在对账前覆盖** `node_runtime/lexicon/v3`。  
本轮不强制 promote；内容等价已证明，promote 属安全流程另决。

---

## 15. Production-vs-Candidate Reconciliation

Artifact：`docs/tone-v2/_audit_scratch/repro_rebuild_audit/reconcile.json`

| Table | old | new | set diff |
|-------|-----|-----|----------|
| term | 10061 | 10061 | empty |
| base_lexicon | 10061 | 10061 | (via content hash) |
| domain_lexicon | 1033 | 1033 | — |
| term_domain_tags | 1033 | 1033 | empty |
| idiom_lexicon | 22192 | 22192 | empty |
| industry_routing_lexicon | 1033 | 1033 | — |
| domain_hierarchy | 12 | 12 | empty |

termId：10061 same / 0 changed。  
允许差异：buildTime、checksum 文件字节元数据时间、输出路径（本轮 SQLite checksum 亦一致为 `38c376c4…`）。

---

## 16. Double Build Determinism

```text
CONTENT_HASH_A = CONTENT_HASH_B = production
= 2c0088e3983826aa83018f38f2f8ec56cd0ec5bb31a4e824e6a1d2c44a6dca3f
```

`bundleVersion` 固定为 Source 声明的 `contentBundleVersion=11`，非无意义自增。

---

## 17. Runtime Load Test

- `LEXICON_V3_BUNDLE_DIR=.../_rebuild_candidate` → `lexicon:gate:v3-runtime` **PASS**
- Electron (`ELECTRON_RUN_AS_NODE=1`) 加载候选与生产做 Exact + dialog_200

---

## 18. Exact Recall Comparison

Artifact：`runtime_compare.json` — `exactEqual: true`

探针全部 found，ID/score 与生产一致，含：

- 候选 / 计划 / 蓝莓 / 马芬 / 蓝莓马芬 / 医师 / 登机
- **上线计划** / **接口文档**（本轮仍存在）

---

## 19. dialog_200 Comparison

| Metric | prod | cand |
|--------|------|------|
| completed | 200 | 200 |
| failed | 0 | 0 |
| uncovered | 0 | 0 |
| kenlm | 200 | 200 |
| sentenceDiffs | 0 | 0 |
| businessEqual | — | **true** |

未修改 dialog_200 数据或算法。

---

## 20. Remaining Atomicity Work

下一阶段（本轮未做）：

- Unified Atomicity Gate
- Source-level Composite Cleanup（含「上线计划」「接口文档」等可删组合词评审）
- `termType` / `exceptionReason` / phrase rejection 等

本轮仅恢复可重复构建，为安全 Source-level cleanup 铺路。

---

## 21. Target List Result

| ID | Result |
|----|--------|
| T1 | PASS — Source 在 `full_rebuild_v1/` |
| T2 | PASS — byte hash = tmp |
| T3 | PASS — build 拒 tmp |
| T4 | PASS — 不读旧 SQLite 内容 |
| T5 | PASS — 不复制旧表 |
| T6 | PASS — `lexicon:full-rebuild` |
| T7–T10 | PASS — review / supplemental / tags / remove |
| T11 | PASS — idiom JSONL 声明 |
| T12 | PASS — profile-registry 声明 |
| T13 | PASS — 唯一顺序文档化 |
| T14 | PASS — deterministic termId |
| T15–T18 | PASS — 表内容等价 |
| T19–T20 | PASS — sourceInputs / historicalInputs |
| T21–T22 | PASS — shadow/prepare/retire 标注 |
| T23–T25 | PASS — 空目录 / 双构建 / gate |
| T26–T27 | PASS — Exact / dialog_200 |
| T28 | PASS — 组合词仍在 |
| T29 | PASS — 无 Atomicity Validator |
| T30 | PASS — 可进入 Source-level Atomicity Cleanup |

---

## 22. Check List Result

```text
[x] 未修改正式词条内容
[x] 未删除组合词
[x] 未实现 Atomicity Validator
[x] 未修改领域标签
[x] 已正式化 Full Rebuild Source
[x] 已记录 Source hash
[x] 已恢复 Full Rebuild 脚本
[x] 已移除旧 SQLite 内容依赖
[x] 已接入 idiom Source
[x] 已接入 hierarchy Source
[x] 已修复 manifest Source 声明
[x] 已区分 shadow 与 production build
[x] 已从空目录构建
[x] 已独立构建两次
[x] 两次业务内容 hash 一致
[x] 已生成 candidate bundle
[x] 已通过 schema gate
[x] 已完成生产表对账
[x] 已完成 termId 对账
[x] 已完成 domains 对账
[x] 已完成 idiom 对账
[x] 已完成 hierarchy 对账
[x] 已完成 Exact Recall 对账
[x] 已完成 dialog_200 对账
[x] 未读取 tmp 作为运行时 Source
[x] 未复制旧生产 SQLite
[x] 未修改 Recall/Lattice/Vote/Assembly/KenLM
[x] 已生成开发报告
[x] 已生成测试报告
```

---

## 23. Final Verdict

```text
REPRODUCIBLE_BUILD_PASS

正式词库已经能够从仓库内声明 Source，
在空输出目录中通过唯一 Full Rebuild 入口
稳定重建为与当前生产内容等价的 Runtime Bundle。

构建不依赖旧 SQLite、备份、snapshot 或 tmp 目录；
Manifest 准确记录真实 Source；
双构建业务内容 hash 一致。

可以进入下一阶段：
Unified Atomicity Gate + Source-level Composite Cleanup。
```
