<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_Length_1_5_Recall_Chain_Alignment_Development_Report_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1 Length 1–5 Recall Chain Alignment Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **正式开发** · Batch 1 |
| Contract | Implementation Contract Change Record **1.0.2** |
| Verdict | 见 §2 |

---

## 1. Executive Summary

在不导入正式单字词表、不改 Patch V4 / Full Build / operational SQLite 的前提下，完成 Lattice Recall **受控 length=1** 对齐：

- `recallSpanTopKV2` 合法长度改为 **1–5**；length=1 走 **独立 base-only** 分支（歧义保守：多候选不瞎 Top1；surface exact 可消歧；cap=1）。
- `recallTopKForWindows` 对 length=1 强制 `exactTopK=1`、`domainIds=[]`、关闭 fuzzy / parent fragment。
- Lattice Hard-block 删除邻接句界阻断；窗内句界 / 标点 / raw gap 仍 block。
- Phase1 / Phase2 / Quality Probe 补齐 `singleChar*` diagnostics。
- 测试用 in-memory fixture（我/吗/点/是/市/我想/拿铁），完整验证 Window→Recall→Candidate→Edge→Path 与 Vote=0。

length=2–5 既有 recall / span-assembly-v4 / freeze / vote / path / fallback 回归均通过（排除无关的 intent LLM smoke 需本机 5018 服务）。

---

## 2. Final Verdict

```text
BATCH 1 LENGTH 1–5 RECALL CHAIN ALIGNMENT:
PASS

READY FOR BATCH 2 LEXICON WRITE CAPABILITY
```

仍禁止：直接导入正式单字词表；Production Lattice cutover。

---

## 3. Files Changed

| Path | Role |
|------|------|
| `docs/tone-v2/...Implementation_Contract...md` | Change Record 1.0.2 |
| `main/src/lexicon-v2/recall-span-topk-v2.ts` | length=1 base-only branch |
| `main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.ts` | len=1 call-site TopK / domains |
| `main/src/fw-detector/span-assembly-v4/lattice-hard-block-filter.ts` | adjacency hard-block fix |
| `main/src/fw-detector/span-assembly-v4/phase1-window-edge-harness.ts` | singleChar diagnostics |
| `main/src/fw-detector/span-assembly-v4/phase2-path-harness.ts` | singleChar path diagnostics |
| `main/src/fw-detector/span-assembly-v4/connectivity-batch1-fixture.ts` | **NEW** test fixture runtime |
| `main/src/lexicon-v2/recall-span-topk-v2-length1.test.ts` | **NEW** unit tests |
| `main/src/fw-detector/span-assembly-v4/lattice-hard-block-filter.test.ts` | **NEW** HB tests |
| `main/src/fw-detector/span-assembly-v4/connectivity-batch1-length1-chain.test.ts` | **NEW** integration |
| `docs/tone-v2/_audit_scratch/phase1-window-edge-dialog200-probe.mjs` | singleChar aggregate |
| `docs/tone-v2/_audit_scratch/phase2-path-dialog200-probe.mjs` | singleChar aggregate |

清单外修改：**无**（V3 对 length&lt;2 的 parent fragment 门控本已存在；length=1 经 V3 直达 V2，无需改 V3）。

---

## 4. Change Record 1.0.2

已写入 Implementation Contract §0：

- Lattice Recall：**1–5**（length=1 = 受控 base connectivity）
- LTR / fuzzy / parent / legacy local：**仍 2–5 或 min=2**
- Hard-block：仅窗内含句界或其它 gap/punct 规则；**邻接允许**
- 不授权正式单字导入 / Production cutover

---

## 5. Recall Length Branch

```text
topK<=0 | length∉[1,5] → empty
length==1 → collectBaseOnlySingleCharCandidate
length∈[2,5] → 原 collectTier / fuzzy 流程不变
```

禁止把 `<2` 改成 `<1` 后复用全量 2–5 流程。

---

## 6. Base-Only Routing

Length=1 仅调用：

- `lookupBaseByPinyinAndToneKey`（有 tone pattern 且 runtime 支持）
- 或 `lookupBaseByPinyinKey`（无 tone）

不调用 domain / idiom / fuzzy builder / alias expansion / parent fragment。命中强制 `domains=[]`、`repairTarget=false`、过滤 `isAlias`。

---

## 7. Tone / Ambiguity Implementation

| 条件 | 行为 |
|------|------|
| tone exact 唯一 | 返回 |
| tone exact 多个 | surface exact 唯一 → 返回；否则空 |
| plain 唯一 | 返回 |
| plain 多个 | surface exact 唯一 → 返回；否则空 |
| 禁止 | prior Top1、fuzzy、alias、homophone_variant |

SQL 拉取上限 8 仅用于歧义检测；最终 hits ≤ 1。

---

## 8. Candidate Cap

- V2：`effectiveTopK = min(requestedTopK, 1)`
- Call-site：`exactTopK=1`
- 无第三层截断

---

## 9. Cache Behavior

沿用 utterance Fact cache。Length=1 key 因 `domainScope=[]` + `exactTopK=1` 与 2–5 隔离。测试：同一单字 Window 逻辑 recall×2 → `uniqueKeyCount=1` + cache hit。

---

## 10. Hard-block Fix

`hasSentenceBoundary` 仅检测 `rawText.slice(rawStart, rawEnd)`。删除 `rawStart-1` / `rawEnd` 邻接检查。LTR `blockedFilter` 未改。

注：窗内含 `？。！` 时，既有 `punctuation_in_window` 通常先于 `sentence_boundary` 命中；跨句仍被阻断。

---

## 11. Diagnostics

**Phase1：** `singleCharWindowCount` / `RecallCount` / `HitCount` / `CandidateCount` / `CandidateCapHitCount` / `LexicalEdgeCount`

**Phase2：** + `singleCharLexicalEdgeUsedCount` / `singleCharFallbackEdgeCount`

**Quality Probe：** Phase1/Phase2 dialog200 probe 汇总 `singleChar` 块。

---

## 12. Fixture

`createBatch1FixtureRuntime` in-memory：我/吗/点/是/市/我想/拿铁。仅测试；未写 operational SQLite / seed / patch。

---

## 13–16. Tests / Vote / Path

见配套 **Test Report**。要点：

- Candidate→Edge：`edgeKind=lexical`，span=1，`source=base_term`
- Path `[我想][点][拿铁]`：lexical-only complete path ≥1；单字 lexical 进入 retained path
- Vote：base 单字 0 票；domain 双字正常；`domainScores` 无 `base_term`

---

## 17. 2–5 Regression

`lexicon-v2` + `span-assembly-v4` + freeze + vote + path + fallback：**PASS**（343 passed）。唯一失败：`lexicon-intent-integration.smoke`（ECONNREFUSED 5018）— 与本批无关、需外部 LLM。

---

## 18. Performance Snapshot（fixture）

| Metric | Fixture note |
|--------|----------------|
| logicalWindowRecallCount | 2（重复同 key） |
| uniqueRecallKeyCount | 1 |
| physicalSqlStatementCount | 1 次量级（cache hit） |
| harness latency | chain suite ~0.7s wall（Jest） |

未为指标跳过单字查询或改缓存生命周期。

---

## 19. Deviations

无架构偏差。相对 Pre-Dev §9「有 tone 取最佳 1」：本批按 **Batch 1 开发规格** 采用更严的「同 tone 多候选不瞎选（可 surface 消歧）」。

---

## 20. KEEP

Edge Builder · Path Enumerator / Comparator · Fallback inject · Domain Vote 公式 · KenLM · Tone · NMT · LTR 2–5 · fuzzy/parent min=2 · local-span-recall · LTR blockedFilter · Patch V4 · Full Build · operational SQLite

---

## 21. MODIFY

`recallSpanTopKV2` · `recallTopKForWindows` · `lattice-hard-block-filter.hasSentenceBoundary` · Phase1/2 harness diagnostics · Contract CR 1.0.2 · Quality probes

---

## 22. DELETE

Hard-block 邻接句界两处判断（逻辑删除，非文件）。

---

## 23. NEW

Fixture helper · length1 unit tests · HB tests · chain integration tests · 本报告与 Test Report

---

## 24. Target List

```text
[x] Change Record 1.0.2
[x] recallSpanTopKV2 受控 length=1
[x] length=1 只查 base / 不查 domain / 不做 fuzzy / alias / variant
[x] tone/plain 多候选不瞎选；surface exact 可消歧
[x] Candidate cap=1；call-site exactTopK=1；domainIds=[]
[x] cache 语义正确
[x] Hard-block 邻接允许；真跨句 / raw gap / 窗内标点仍 block
[x] singleChar diagnostics
[x] fixture 未进正式词库
[x] Candidate→Edge / lexical 优先 fallback / Vote=0
[x] 2–5 回归通过（相关套件）
[x] 开发报告 / 测试报告
```

---

## 25. Check List

```text
[x] 未修改 Patch V4 / Full Build / operational SQLite / 正式词表
[x] 未新增单字第二链路 / 新表 / feature flag / shadow path
[x] 未修改 Edge Builder / Path Enumerator / Vote / KenLM / LTR 2–5 / fuzzy·parent min / local-span-recall
[x] 未降低 minPrior
[x] 未通过删除测试“通过”
```

---

## 26. Final Recommendation

进入 **Batch 2：Patch V4 `addBaseTerm` + Full Build `singleCharApproved` + base update/disable**。  
Batch 2 完成前 **不得** 向 operational 词库导入正式 50–100 单字词表。
