<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_Length_1_5_Recall_Chain_Alignment_Test_Report_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1 Length 1–5 Recall Chain Alignment Test Report

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Scope | Batch 1 fixture + unit/integration + 2–5 regression |
| Companion | Development Report 2026-07-27 |

---

## 1. Test Commands

```powershell
cd electron_node/electron-node

# Batch 1 new suites
npx jest --testPathPattern="recall-span-topk-v2-length1|lattice-hard-block-filter|connectivity-batch1-length1" --no-coverage

# Regression (recall / lattice / freeze / vote / path / fallback / lexicon-v2)
npx jest --testPathPattern="lexicon-v2/|recall-span-topk|span-assembly-v4|freeze-contract|domain-presence-vote|inject-fallback|enumerate-complete|phase1-window|phase2-path" --no-coverage
```

---

## 2. Counts

| Suite group | Result |
|-------------|--------|
| Batch 1 new (`length1` + HB + chain) | **3 suites / 26 tests PASS** |
| Broad regression matching pattern | **50 suites PASS** · **343 tests PASS** |
| Unrelated failure | `lexicon-intent-integration.smoke` · 2 tests FAIL（`ECONNREFUSED 127.0.0.1:5018`） |

Batch 1 相关失败：**0**。

---

## 3. Fixture Content

In-memory only (`connectivity-batch1-fixture.ts`)：

| word | pinyin | tone | prior | notes |
|------|--------|------|-------|-------|
| 我 | wo | wo3 | 0.90 | base |
| 吗 | ma | ma5 | 0.90 | base |
| 点 | dian | dian3 | 0.90 | base / unique plain |
| 是 | shi | shi4 | 0.90 | ambiguity |
| 市 | shi | shi4 | 0.85 | ambiguity |
| 我想 | wo\|xiang | … | 0.90 | path bigram |
| 拿铁 | na\|tie | … | 0.90 | path bigram |

未写入 `node_runtime/lexicon/v3`、正式 seed/patch、operational SQLite。

---

## 4. Unit Tests (Recall)

| ID | Case | Result |
|----|------|--------|
| 15.1 | tone exact 我 | PASS · 1 hit · exact_base · domains=[] · repairTarget=false |
| 15.2 | plain unique 点 | PASS |
| 15.3 | plain ambiguity 事 | PASS · 0 |
| 15.4 | tone ambiguity 事 | PASS · 0 |
| 15.5 | surface 市 消歧 | PASS |
| 15.6 | domain isolation | PASS · domain lookup=0 |
| 15.7 | fuzzy isolation | PASS · 无 fuzzy kind |
| 15.8 | topK 1/2/5 → ≤1 | PASS |
| 15.9 | length=2 我想 | PASS |
| — | alias 过滤 | PASS |

---

## 5. Call-site / Cache

| Case | Result |
|------|--------|
| len=1 → exactTopK=1, domainIds=[], fuzzy=false, parentFragmentTopK=0 | PASS |
| len=2 → exactTopK≥2, domainIds 保留 | PASS |
| 同单字 ×2 logical → uniqueKey=1 + cache hit | PASS |

---

## 6. Integration：Candidate → Edge → Path

| Case | Result |
|------|--------|
| 点 → lexical edge span=1 · source=base_term | PASS |
| Path [我想][点][拿铁] lexical-only ≥1；singleCharLexicalEdgeUsedCount≥1 | PASS |
| retained path 中位使用 lexical「点」而非仅 fallback | PASS |

---

## 7. Domain Vote

| Assertion | Result |
|-----------|--------|
| base 单字贡献 0 | PASS |
| domain 双字 coffee=1 | PASS |
| `domainScores` 无 `base_term` | PASS |

`domainVoteContributionFromBaseSingleChars = 0`（语义满足）。

---

## 8. Hard-block Cases

| Case | Expected | Result |
|------|----------|--------|
| 「你要吗？」窗「吗」 | allow | PASS |
| 「？我想…」窗「我」 | allow | PASS |
| 「吗？我」跨句窗 | block | PASS（punctuation_in_window / sentence_boundary） |
| 「你好。请问」跨 。 | block | PASS |
| 窗内「，」 | block | PASS |
| raw/whitespace gap | block | PASS |
| 「吗」邻接 ？ → Recall → lexical edge | PASS | PASS |

---

## 9. singleChar Diagnostics（fixture Path case）

从 Path 集成断言：

```text
singleCharLexicalEdgeCount = 1
singleCharLexicalEdgeUsedCount ≥ 1
```

Phase1 harness 字段已接线；dialog200 probe 已汇总（正式 dialog200 在无单字词表时 HitCount 仍可为 0，属预期，不阻塞 Batch 1）。

---

## 10. 2–5 Regression

相关套件（含 `recall-span-topk-v2.test.ts`、`recall-span-topkv3.test.ts`、`phase1-window-edge-harness*`、`phase2-path*`、`freeze-contract`、`domain-presence-vote*`、`inject-fallback-edges`、`enumerate-complete-segmentation-paths` 等）：**全部 PASS**。

未删除旧测试、未放宽断言。

---

## 11. SQL / Latency Snapshot（fixture）

| Metric | Value |
|--------|-------|
| logicalWindowRecallCount（重复查询用例） | 2 |
| uniqueRecallKeyCount | 1 |
| physicalSqlStatementCount | 1 次量级（第二次 cache） |
| Batch1 三 suite Jest wall | ~2.1s |
| chain suite alone | ~0.7s |

---

## 12. Failures

| Test | Reason | Batch1 impact |
|------|--------|---------------|
| `lexicon-intent-integration.smoke` | 本机 intent LLM `127.0.0.1:5018` 未启动 | **None** |

---

## 13. Acceptance vs Batch 1 Gate

| Gate | Status |
|------|--------|
| length=1 fixture → base candidate | ✅ |
| → lexical edge | ✅ |
| → retained path | ✅ |
| 歧义不瞎选 | ✅ |
| base 单字 Vote=0 | ✅ |
| 邻接句界可通过 HB | ✅ |
| 真跨句仍阻断 | ✅ |
| length=2–5 回归 | ✅ |
| 未改禁止范围 | ✅ |

---

## 14. Final Test Verdict

```text
BATCH 1 LENGTH 1–5 RECALL CHAIN ALIGNMENT TESTS: PASS
```
