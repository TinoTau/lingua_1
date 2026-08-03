<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Parent_Fragment_Retirement_Phase1_Development_Report_2026_08_01.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Parent Fragment Retirement Phase 1 Development Report

**Date:** 2026-08-01  
**Scope:** PHASE 1 ONLY — cut production parent_fragment Recall; unify exact Recall entry  
**Verdict:** **PHASE1_PASS**

---

## 1. Executive Summary

```text
PHASE1_PASS

生产 parent_fragment Recall 已彻底切断。

生产不再查询 term_pinyin_ngrams，
parent_fragment Candidate 与 ngram:* termId 均为 0。

唯一 exact Recall 主链正常，
Lattice / Vote / Assembly / CrossPath 未受破坏。

可以进入 Phase 2/3：
删除内部残留与数据库物化机制。
```

| Gate | Result |
|------|--------|
| dialog_200 completed | **200/200** |
| parent_fragment Candidate | **0** |
| ngram SQL (`lookupParentFragmentsByNgramKey`) | **0 calls** |
| ngram:* termId | **0** |
| 科医 as PF | **0** |
| Lattice uncovered | **0** |
| KenLM inputs introduced-noise vs Raw | **0** |
| Exact probes (候选/计划/蓝莓/马芬/蓝莓马芬/医师/登机) | **PASS** |

---

## 2. Frozen Scope

Implemented Commit 1 only. Did **not**: schema/rebuild, JobResult shape, Vote/Budget/Assembly/CrossPath/KenLM algorithms, atomicity term cleanup, enable=false / blacklist.

---

## 3. Files Changed

| File | Change |
|------|--------|
| `lexicon-v2/recall-span-topkv3.ts` | Rewrote as **exact-only adapter** over `recallSpanTopKV2`; deleted all fragment functions |
| `span-assembly-v4/recall-topk-for-windows.ts` | Removed PF params/calls; bind writes `hitKind=exact_term` only; `parentFragmentHitCount` always 0 |
| `span-assembly-v4/utterance-recall-cache.ts` | Dropped `parentFragmentTopK` from canonical key; key namespace **v1→v2** |
| `freeze-contract.test.ts` | Added Phase1 production PF grep gate; updated Presence gate for V2 SSOT |
| `recall-span-topkv3.test.ts` | Exact-only adapter tests |
| `phase1-utterance-cache.test.ts` | v2 key expectations |
| `length1-recall-edge-path.sqlite.integration.test.ts` | Expect no `parentFragmentTopK`; PF lookup never called |
| `phase1-window-edge-harness.test.ts` | Removed PF from cache key fixtures |
| `b1-recall-full-traversal.test.ts` | Mock returns `parentFragmentHitCount: 0` |

---

## 4. Recall Entry Unification

**SSOT Owner:** `recallSpanTopKV2` (tone-first exact formal terms).

**Production entry name:** `recallSpanTopKV3` — **thin hit-shape adapter only** (maps V2 hits → WindowCandidate-compatible hits with `hitKind: 'exact_term'`).

**Not retained:** V2 exact + V3 exact-only as two parallel algorithms. V3 no longer contains fragment merge or a second lookup implementation.

---

## 5. Fragment Query Removal

Deleted from production path:

- `lookupParentFragments`
- `ngramRowToHotword`
- `scoreFragmentHit`
- `mergeExactAndFragmentHits`
- `classifyFragmentKind` / `fragmentRowAllowed` / `applyToneScoreToFragmentHits`
- Call-site passing of `parentFragmentTopK` / `perParentTermPerWindow`

`LexiconRuntimeV2.lookupParentFragmentsByNgramKey` / `stmtNgram` **still exist** (Phase 2/3) but are **unreachable** from production Recall (spy: 0 calls on dialog_200).

---

## 6. Mapper / Score / Merge Removal

All fragment score/merge removed with V3 rewrite. Exact score/sort/TopK/tone-first unchanged in V2.

---

## 7. Cache Contract Change

Canonical key:

```text
v2|span_v3_bundle|{pinyin}|{tone}|{domains}|{exactTopK}|{lexiconVersion}|{surface}
```

Removed dimension: `parentFragmentTopK`.  
`lexiconVersion` still invalidates across lexicon bumps. No dual-key fallback.

---

## 8. Window Candidate Binding Change

`bindLexiconHitsToWindow` always emits:

- `hitKind: 'exact_term'`
- no `parentTerm*` / `matchedTerm*` / `fragmentTonePinyinKey` writes

Optional type fields may remain until Phase 3; production objects do not populate them.

---

## 9. Diagnostics Boundary

```text
TEMPORARY CONTRACT BOUNDARY
parentFragmentHitCount = 0 (still present on result/diagnostics types)
parentTermVoteCount unchanged formula; no PF inputs → naturally 0 contribution from PF
```

JobResult shape **not** modified this phase.

---

## 10. Static Residual Search (production)

| Path | lookupParentFragments* | ngramRowToHotword | term_pinyin_ngrams SELECT | parentFragmentTopK pass |
|------|------------------------|-------------------|---------------------------|-------------------------|
| `recall-span-topkv3.ts` | **0** | **0** | **0** | N/A |
| `recall-topk-for-windows.ts` | **0** | **0** | **0** | **0** |
| `utterance-recall-cache.ts` | — | — | — | **removed from key** |

**Still present (Phase 2/3):**

- `lexicon-runtime-v2.ts` stmtNgram + `lookupParentFragmentsByNgramKey`
- `v4-limits.ts` `parentFragmentTopK` constants (unused by production call-site)
- Types: `parent_fragment` union, `ParentTermNgramRow`, Vote structural key
- DB table `term_pinyin_ngrams` + build materialization
- Tests that still construct PF fixtures for Vote/eligibility (not production path)

---

## 11–16. Regression / Comparison

See **Test Report**. Summary:

| Metric | Before (audit) | After Phase 1 |
|--------|----------------|---------------|
| Cases with PF | 166 | **0** |
| PF candidate rows | 1143 | **0** |
| 科医 medical PF | 26 cases / 78 | **0** |
| KenLM introduced noise vs Raw | 27 cases / 38 | **0** |
| dialog_200 | — | **200/200** |
| Pre-KenLM p50 / p95 | — | **58.1 / 101.7 ms** |
| ngram SQL | active | **0** |

---

## 17. Remaining Phase 2/3 Work

1. Delete `stmtNgram` / `lookupParentFragmentsByNgramKey`  
2. Drop `term_pinyin_ngrams` + materialize + manifest ngrams; schemaVersion bump; clean rebuild  
3. Delete PF types, Vote structural key, `hasParent` / `parentEdgeCount`, unused limits  
4. JobResult consumer audit before removing diagnostic fields  
5. Update/archive Tone-First docs describing exact+fragment  

---

## 18. JobResult Contract Boundary

Unchanged. `fw_detector` may still expose `parentFragmentHitCount: 0`. Field removal → separate audit.

---

## 19. Target List Result

| ID | Result |
|----|--------|
| T1–T8 | **PASS** |
| T9–T13 | **PASS** (exact probes + lattice coverage) |
| T14–T18 | **PASS** (no Vote/Budget/Assembly/CrossPath/JobResult/dialog data edits) |
| T19–T20 | **PASS** |
| T21 | **PASS** (p50≈58ms; no intentional param retuning) |
| T22–T24 | **PASS** |
| T25 | **PASS** (residuals listed §10/§17) |

---

## 20. Check List Result

```text
[x] 已切断生产 fragment 查询 / mapper / score / merge
[x] 已统一 exact Recall 入口（V2 SSOT）
[x] 未保留 V2/V3 双实现
[x] 已删除生产 PF 参数传递；已更新 cache key
[x] parent_fragment / ngram:* / 科医 PF = 0
[x] exact Recall / Lattice / dialog_200 200/200
[x] 未修改 Vote/Budget/Assembly/CrossPath/KenLM/JobResult/schema/rebuild/正式 term
[x] 已生成开发报告与测试报告
```

---

## 21. Final Verdict

```text
PHASE1_PASS

生产 parent_fragment Recall 已彻底切断。

生产不再查询 term_pinyin_ngrams，
parent_fragment Candidate 与 ngram:* termId 均为 0。

唯一 exact Recall 主链正常，
Lattice / Vote / Assembly / CrossPath 未受破坏。

可以进入 Phase 2/3：
删除内部残留与数据库物化机制。
```
