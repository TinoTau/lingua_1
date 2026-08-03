<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1B_Surface_Exact_Reachability_Final_Gate_Report_2026_07_28.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1B Surface Exact Reachability Final Gate Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Stage | **5 — Cleanup & Final Gate** |
| Batch | 1.1B Surface Exact Reachability |
| Status | **CLOSED** |
| Production behavior changes this stage | **None**（文档 CR 1.0.7 + scratch README + 删除临时 jest 日志） |

---

## 1. Executive Summary

Batch 1.1B 在 Stage 1–4 PASS 之后完成 Cleanup / Verification / Documentation / Archiving / Regression。生产 Runtime/Recall **无临时代码、无 debug、无 audit 资源入 dist**；全量回归 **15 suites / 192 PASS**；`build:main` SUCCESS；dist **CLEAN**。Batch 1.1B **正式关闭**。

---

## 2. Final Verdict

```text
BATCH 1.1B

FINAL GATE

PASS

SURFACE EXACT REACHABILITY

CLOSED

READY FOR BATCH 1.1C
```

---

## 3. Cleanup Summary

| Action | Result |
|--------|--------|
| Production readiness scan（TODO/FIXME/HACK/AUDIT/PROBE…） | PASS — Runtime/Recall 无命中 |
| console / stdout debug in production exact path | PASS — 无 |
| Audit evidence 仅 `_audit_scratch` / docs / tests | PASS |
| 删除临时 `jest_1_1a_1_1b_length1.txt` | Done |
| 新增 scratch `README.md`（禁止入生产） | Done |
| CR **1.0.7** documentation-only Gate 澄清 | Done |
| 生产行为 / SQL / LIMIT / ownership | **未改** |

---

## 4. Production Readiness Audit

| Check | Result |
|-------|--------|
| TODO / FIXME / TEMP / HACK / DEBUG / WIP | 无（`lexicon-runtime-v2.ts` / `recall-span-topk-v2.ts`） |
| STAGE4 / BATCH1_1B / AUDIT / SCRATCH / PROBE | 无生产标记字符串 |
| `console.log/warn/error` / `process.stdout` | 无 |
| `Date.now()` | 仅既有 `baseLookupMs` / recall timing（非 debug dump） |
| 临时代码 / audit helper 入生产路径 | 无 |

生产注释中的 `Batch 1.1B` 为合同溯源，**不是**临时开关。

---

## 5. Documentation Consistency

| Artifact | Aligns with code |
|----------|------------------|
| CR 1.0.4 / 1.0.5（1.1A truncation） | Yes — 未改 |
| CR 1.0.6（surface exact） | Yes — API / call graph / LIMIT=2 / ownership |
| CR 1.0.7（Gate / naming debt） | Yes — docs only |
| Development / Functional / Generalization reports | Consistent with current implementation |
| Call Graph / SQL / Cache / Lifecycle / Decision / Candidate | Verified against source |

无文档与代码冲突。

---

## 6. Runtime Cleanup

| Item | Status |
|------|--------|
| `stmtBaseExactSurface` / `stmtBaseExactSurfaceTone` | 使用中；`closeDbOnly` 释放 |
| `lookupBaseByExactSurfaceAndPinyin` / `…PinyinAndTone` | 唯一机械 API；无 deprecated 双实现 |
| `tryExactSurfaceBaseIdentity` | 唯一 Recall helper；无 duplicate eligibility |
| `bucketCache` / `lookupTier` | 与 ambiguity key 隔离 |
| 无 unused statement / dead API / temporary helper | Confirmed |

---

## 7. Test Cleanup

| Check | Result |
|-------|--------|
| `test.only` / `test.skip` / `describe.only` / `describe.skip` | **无**（1.1B 相关套件） |
| Stage3 / Stage4 套件可回归 | Yes |
| Mock Runtime | 无 |
| 命名 | `*surface-exact*` / `batch1-1b-*` / Stage4 `batch1-1b-stage4-*` |

---

## 8. Technical Debt Review

| Debt | Disposition |
|------|-------------|
| Tone unsupported → plain | **KEEP → Batch 1.1C** |
| HB ellipsis | **KEEP → Batch 1.1D** |
| Unicode NFC/NFKC | **KEEP → future batch** |
| Cache key `:plain:` naming | **KEEP → documentation debt（CR 1.0.7）** |

无隐藏新债；未删除 Known Defects。

---

## 9. Regression

```powershell
ELECTRON_RUN_AS_NODE=1 electron jest --runInBand --forceExit --no-coverage \
  --testPathPattern="batch1-1b-stage4-generalization|batch1-1b-surface-reachability|length1-surface-exact|length1-truncation|length1-recall-edge-path|lexicon-runtime-v2-length1-base.contract|recall-span-topk-v2-length1.sqlite|connectivity-path-vote-bind|batch1-1a-stage4|recall-span-topk-v2.test|recall-span-topkv3|lattice-hard-block|freeze-contract.test|lexicon-runtime-v2.test"
```

| | |
|--|--|
| Suites | **15 PASS** |
| Tests | **192 PASS** |

覆盖：Runtime / Recall / SQLite Length1 / Connectivity / Edge / Vote / TopKV3 / Freeze / HB / 1.1A / 1.1B Stage3+4。

---

## 10. Build

`npm run build:main` → **SUCCESS**

---

## 11. Dist Inventory

文件：`docs/tone-v2/_audit_scratch/lattice_v1_batch1_1b/Stage5_dist_inventory.json`

| | |
|--|--|
| overall | **CLEAN** |
| audit / probe / test helpers / scratch matrices in dist | **none** |
| exact APIs compiled into dist | **yes** |

---

## 12–15. KEEP / MODIFY / DELETE / NEW

| | |
|--|--|
| **KEEP** | CR 1.0.4–1.0.6 行为；LIMIT=8/2；Runtime rows-only；Recall decision；1.1A truncation；1.1B identity；Edge/Path/Vote/Assembly/KenLM 未触碰；Known Defects 列表 |
| **MODIFY** | Implementation Contract +CR 1.0.7（docs only） |
| **DELETE** | 临时 jest tee 日志 `jest_1_1a_1_1b_length1.txt` |
| **NEW** | scratch README；`Stage5_dist_inventory.json`；本 Final Gate 报告 |

---

## 16. Target List

```text
[x] Production Readiness Audit
[x] Cleanup Runtime（核实，无行为改动）
[x] Cleanup Tests
[x] Cleanup Audit Resources
[x] Verify Documentation
[x] Review Technical Debt
[x] Full Regression
[x] Build
[x] Dist Inventory
[x] Final Consistency Audit
[x] Final Gate
[x] Output Final Gate Report
[x] Close Batch1.1B
```

---

## 17. Check List

```text
[x] 未修改 Runtime Contract（行为）
[x] 未修改 Recall Contract（行为）
[x] 未修改 SQL
[x] 未扩大 LIMIT
[x] 未新增 SQLite Index
[x] 未新增 Candidate Kind
[x] 未修改 Edge / Path / Vote / Assembly / KenLM
[x] 未进入 Batch1.1C / 1.1D / Batch2
[x] 未新增 Shadow Path
[x] 无 Debug / Temporary Code
[x] Dist CLEAN
```

---

## 18. Batch Closure

```text
Batch 1.1A: CLOSED（先验）
Batch 1.1B: CLOSED（本 Gate）

Stages:
  1 Contract Freeze     PASS
  2 Development         PASS
  3 Functional Test     PASS
  4 Generalization      PASS
  5 Cleanup & Final Gate PASS
```

冻结行为摘要：

```text
ambiguity LIMIT=8
→ filter + resolve (+ truncation)
→ if Candidate: keep
→ else independent exact-surface LIMIT=2
→ Runtime rows only; Recall decides
→ identity ≠ inferred uniqueness
```

---

## 19. Next Batch

```text
READY FOR BATCH 1.1C
```

**1.1C 范围（预告，本轮未进入）：** tone unsupported fallback 政策。

**仍禁止直至后续 Gate：** Batch 1.1D HB ellipsis、Batch 2 词库写入、Production Lattice cutover。
