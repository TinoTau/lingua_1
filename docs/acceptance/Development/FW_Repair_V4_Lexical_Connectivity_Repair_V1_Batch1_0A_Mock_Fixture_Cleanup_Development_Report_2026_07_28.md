<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_0A_Mock_Fixture_Cleanup_Development_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.0A Mock / Fixture Cleanup Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Nature | 测试污染清理 · Fake Runtime 移除 · 生产构建隔离 |
| Business logic / LIMIT / HB / Patch / SQLite | **未修改** |

---

## 1. Executive Summary

已删除生产源码中的 `connectivity-batch1-fixture.ts`（in-memory fake `LexiconRuntimeV2`），并拆除全部依赖该 fake 的自证测试。  
`npm run build:main` 成功；`dist/main` 中无 fixture / `createBatch1FixtureRuntime`。  
Hard-block 与纯 unit（Path/Vote/bind mapping）保留。真实 SQLite 基线留待 **Batch 1.0B**。

---

## 2. Final Verdict

```text
BATCH 1.0A MOCK / FIXTURE CLEANUP:
PASS

PRODUCTION SOURCE AND BUILD ARE CLEAN
READY FOR REAL SQLITE BASELINE
```

---

## 3. Fake Runtime Inventory

| Symbol | Location (before) | Action |
|--------|-------------------|--------|
| `createBatch1FixtureRuntime` | `span-assembly-v4/connectivity-batch1-fixture.ts` | **DELETED** |
| `BATCH1_BASE_TERMS` | same | **DELETED** |
| `Batch1FixtureRuntime` / Map lookup stubs | same | **DELETED** |
| FakeLexiconRuntime / Stub / inMemory* | — | 未发现其它等价实现 |

源码树 `*.ts/*.js` 搜索上述符号：**0 命中**。

---

## 4. Files Deleted

| File | Reason |
|------|--------|
| `main/src/fw-detector/span-assembly-v4/connectivity-batch1-fixture.ts` | 生产 compile scope 污染 + fake runtime |
| `main/src/lexicon-v2/recall-span-topk-v2-length1.test.ts` | 全部依赖 fake runtime（类别 B） |

---

## 5. Files Moved

无。未建立替代 fake；未迁入新测试目录（避免本轮引入新 mock）。

---

## 6. Tests Removed

| Suite | Removed | Why | Rebuild in 1.0B |
|-------|---------|-----|-----------------|
| `recall-span-topk-v2-length1.test.ts` | **整文件**（12 cases：15.1–15.9×含 cap 参数化 + alias） | B — fake runtime 自证 | 真实临时 SQLite + LexiconRuntimeV2 length=1 |
| chain: call-site len=1/2 | 2 | 需 fake runtime | 真实 runtime + spy 参数断言 |
| chain: utterance cache | 1 | 需 fake runtime | 真实 runtime cache |
| chain: Candidate→Edge | 1 | 需 fake runtime | 真实 Recall→Edge |
| chain: HB+Recall integration | 1 | 需 fake runtime | HB + 真实 Recall |

**合计删除：17 个测试用例**（12 + 5）。

---

## 7. Tests Retained

| Suite | Count | Class | Scope note |
|-------|-------|-------|------------|
| `lattice-hard-block-filter.test.ts` | 6 | D | 纯 HB，无 runtime |
| `connectivity-batch1-length1-chain.test.ts` | 3 | A/C | Path / Vote / bind **unit only**；明确 **非 E2E Recall** |

保留用例文案已去掉「我想/点/拿铁」fixture 路径宣称；Path 使用「测试段路径」手工边。

未使用 `.skip` / `.todo`。

---

## 8–10. Production Build / dist / tsconfig

| Check | Result |
|-------|--------|
| `npm run build:main` | exit 0 |
| `connectivity-batch1-fixture.js` in dist | **absent** |
| electron-builder `dist/main/**/*` | 不含 fixture |
| tsconfig.main exclude | 仍为 `*.test.ts`；fixture 源文件已删除，无需改 tsconfig |
| barrel export | 无 |

证据：[`batch1_mock_cleanup_dist_inventory.json`](./_audit_scratch/lattice_v1_batch1_generalization/batch1_mock_cleanup_dist_inventory.json) → **overall: CLEAN**

---

## 11. Regression Tests

| Command | Result |
|---------|--------|
| `build:main` | PASS |
| jest Hard-block + chain + recall V2/V3 + phase1/2 + freeze | **10 suites / 136 PASS** |
| jest `span-assembly-v4/` | **29 suites / 185 PASS** |

---

## 12. Remaining Batch 1 Gaps（→ 1.0B）

仍属 Generalization Audit P0/P1，**本轮未修**：

1. 真实临时 SQLite + LexiconRuntimeV2 集成  
2. SQL LIMIT=8 假唯一  
3. tone unsupported fallback 策略  
4. Hard-block 省略号（可选）  
5. 重建 length=1 Recall 测试（原 17 个）

---

## 13. Files Changed

| Path | Action |
|------|--------|
| `connectivity-batch1-fixture.ts` | DELETE |
| `recall-span-topk-v2-length1.test.ts` | DELETE |
| `connectivity-batch1-length1-chain.test.ts` | REWRITE（仅 unit） |
| dist inventory + 本报告 / Test Report | NEW |

---

## 14. KEEP

Recall / LIMIT / tone / HB / cap / Vote / Edge / Path 业务实现 · `lattice-hard-block-filter.test.ts` · Path/Vote/bind unit tests

---

## 15. DELETE

fake fixture runtime · fake 自证 length1 suite · fake 依赖的 chain E2E 宣称测试

---

## 16. MOVE

无

---

## 17. Target List

```text
[x] 删除 connectivity-batch1-fixture.ts
[x] 删除等价 fake runtime
[x] 删除 fake 自证测试
[x] 保留独立 unit / Hard-block
[x] 无 skip/todo
[x] fixture 不在 production compile scope
[x] production build 成功
[x] dist/main 不含 fixture
[x] electron-builder 输入干净
[x] 无 barrel export
[x] 回归通过
[x] 报告记录测试数量变化
```

---

## 18. Check List

```text
[x] 未改 Recall / LIMIT / tone / HB / cap / Patch / Full Build / 词库 / SQLite
[x] 未新增替代 fake runtime / feature flag / shadow fixture
```
