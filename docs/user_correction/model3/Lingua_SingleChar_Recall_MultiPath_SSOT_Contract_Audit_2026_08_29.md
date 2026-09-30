# Lingua — Single-Char Recall + Multi-Path Consumer SSOT Contract Audit

**Phase:** `SINGLE_CHAR_RECALL_AND_MULTIPATH_CONSUMER_SSOT_AUDIT`  
**Date:** 2026-08-29  
**Mode:** Strict read-only  
**Main Verdict:** **SSOT_CONTRACTS_MATCH**

---

## Executive summary

Two unresolved contract questions from the prior Recall/Lexicon coverage audit are now resolved against **frozen design documents** (not merely current behavior):

1. **Single-char Recall (d019 成→城):** Current surface-exact behavior is **INTENDED_FROZEN_CONTRACT** (Lattice CR 1.0.2/1.0.4). Not implementation drift.
2. **Multi-path consumer (d160):** First-pass consumes **all retained paths**; Retry consumes **one best path** after ranking. This is a **frozen phase difference**, not ranking drift.

Prior coverage audit mislabeled d019 as `PHONETIC_RECALL_MISS`; under single-char SSOT it is **expected contract behavior**.

---

## PART A — Single-char Recall

### Frozen contract (SSOT)

| Source | Requirement |
|--------|-------------|
| Lattice Implementation Contract CR **1.0.2** | length=1 **base-only**; no domain/fuzzy/homophone_variant; cap=1 |
| CR **1.0.4** | Never Top1-guess among same-tone homophones; truncation-aware fail-closed |
| CR **1.0.6 (1.1B)** | Surface-exact identity only when ambiguity path has no unique candidate |
| `SINGLE_CHAR_REPAIR_LEXICON_V1_FREEZE.md` | 1125-char SSOT; Recall via `collectBaseOnlySingleCharCandidate` |
| Model2 retirement decision | Model2 **not** owner of length-1 lexical choice |

**Contract answer to Question A/B:** For ambiguous same-tone homophones, Recall returns **A: ASR surface only** (e.g. 成), **not B: 成+城**. Homophone Top1 is explicitly forbidden.

### Current implementation

**File:** `recall-span-topk-v2.ts`

```
lookupBaseByPinyinAndToneKey(cheng2) → {成, 城, …}
→ resolveLength1BaseCandidate (eligible >= 2)
→ pickUniqueSurfaceExact(windowText="成")
→ returns 成 only; 城 filtered at h.word !== windowText
```

**First exclusion point for 城:** `pickUniqueSurfaceExact` inside `resolveLength1BaseCandidate` (line ~323).

### d019 trace

| Field | Value |
|-------|-------|
| FineSpan surface | 成 |
| Query pinyin | cheng |
| Query tone | cheng2 |
| Lexicon 成 | exists, cheng2 |
| Lexicon 城 | exists, cheng2 |
| Recall(成) | 成 |
| Model2 eligibility | N/A (retired for length-1 disambiguation) |

### Representative homophone pairs (10 tested)

See `single_char_recall_contract_evidence.csv`.

| Pattern | Result |
|---------|--------|
| Same-tone pairs (成/城, 他/她, 在/再, 做/作, 向/项, 李/里) | Target **never** returned; source surface exact only |
| Negative control d002 (背 bei4 → 杯 bei1) | 背 only (tone mismatch; correct) |
| **Systematic current behavior** | **YES** — matches frozen surface-exact contract |

### Single-char verdict

**SINGLE_CHAR_CONTRACT_MATCH**

No correction required. Prior `PHONETIC_RECALL_MISS` label for d019 was a **coverage-audit interpretation error**, not a Recall defect.

---

## PART B — Multi-path consumer

### Path ranking (already resolved)

**SSOT:** `compareSegmentationPathBestFirst` — used for lattice pruning and Retry path **selection**.

### Normal first-pass consumption

**File:** `span-assembly-v4-orchestrator.ts` L294

```typescript
for (const view of lattice.pathFineSpanViews) {
  // per-path: tone rebind → compatibility → Model2 → Model3 → Assembly → sentence candidates
}
mergeCrossPathSentenceCandidates(...); // dedup-before-cap, global ≤16
```

**Semantic label:** **B** — iterate ALL retained paths + **E** — cross-path sentence merge.

Recall runs **once** before path enumeration (shared lexical edges); path differences affect Vote/Assembly/Model3 downstream.

### Retry consumption

**File:** `model3-retry-region-resegment.ts` L91–106

```typescript
preferredPathFineSpanView(...):
  [...segmentationPaths].sort(compareSegmentationPathBestFirst)[0]
```

**Semantic label:** **A** — ONE best path only for resegment + per-span retry recall.

**Frozen Retry contract** (`model3_retry_contract_v1.md`): *"one bounded local re-segmentation + re-recall"* — singular, bounded scope.

### SSOT question answer

Retry reuses **ranking SSOT only** for **selection**, not full first-pass multipath consumption. First-pass multipath is governed by Lattice Architecture §9 (per-Path Vote/Assembly). **Different phases, different frozen consumption semantics.**

### d160 trace

| Metric | Value |
|--------|-------|
| Regional paths enumerated | 4 |
| 2-char lexical edges | yes (inputParity_lex2=2) |
| Retry selected path | 顺\|便\|向\|木\|李 (all single-char) |
| 项目 in Lexicon | yes (xiang\|mu) |
| 项目 recallable on own surface | yes |
| 项目 from Retry windows | no (no 2-char 向木 window) |

Simulated path ranking (see CSV): all-single-char path ranks **#1** under compareBestFirst (fallbackEdgeCount tie-break → boundaryKey ASC). Paths with 向木 rank lower even with more lexical edges.

**Architecture question (not reference optimization):** Would first-pass normally allow alternative paths to contribute? **YES** (all 4 would run per-path pipeline). Retry? **NO** (only rank-1 path). d160 failure is **WINDOW_BOUNDARY on selected single-char path**, compounded by Lexicon/coverage gaps elsewhere — not evidence that Retry should auto-consume all paths without ACP.

### Six multi-path controlled cases

| caseId | paths | Retry consumes | vs first-pass | ref reachable |
|--------|------:|----------------|---------------|---------------|
| d179 | 2 | 1 | YES diff | YES |
| d142 | 2 | 1 | YES diff | YES |
| d099 | 2 | 1 | YES diff | NO |
| d131 | 2 | 1 | YES diff | NO |
| d160 | 4 | 1 | YES diff | NO |
| d176 | 2 | 1 | YES diff | NO |

### Candidate budget (first-pass multipath)

- Per-span caps via `budgetPerSpanCandidates` / `getPerSpanCandidateLimit`
- Cross-path: `mergeCrossPathSentenceCandidates` — text dedup first-wins, then global ≤16
- Retry: `mergeSpanCandidates` per span; no multipath flatten

### Multi-path verdict

**MULTIPATH_CONTRACT_MATCH**

Retry single-path consumption is **frozen by Retry contract**, not implementation drift from first-pass multipath.

---

## PART C — Previous coverage statistics (26 vs 29)

| Item | Value |
|------|-------|
| Reported repair units | 26 |
| Published category sum (prior MD) | 29 |
| **Cause** | Prior summary table listed WINDOW_BOUNDARY=**13**; authoritative `retry_region_recall_coverage_units.csv` has **11** |
| Correct primary counts | LEXICON 9, WINDOW 11, EXPECTED_UNREPAIRABLE 2, TONE 1, PHONETIC_RECALL 1, OTHER 2 |
| **Sum** | **26** |
| **Invariant** | **PASS** |

Each repair unit has exactly one `firstMissingPoint`. Secondary factors were not meant to be summed into primary totals.

---

## PART D — dialog_200

| Item | Value |
|------|-------|
| **Authoritative procedure** | `ELECTRON_RUN_AS_NODE=1 electron.exe tests/run-dialog200-model3-acceptance.mjs` — runner **auto-starts** node via `start-node-detached.mjs`; wait :5020 + ASR warmup |
| **Do NOT use** | `--skip-start` unless node already listening |
| **Prior error** | `--skip-start` with no ASR node → hung on health check |
| **This phase** | **DIALOG_200_ENV_BLOCKED** — full anchored run (53 cases) requires long-running ASR bootstrap; not completed in audit window |
| Production code modified | NO |

---

## Training gates

| Gate | Verdict | Reason |
|------|---------|--------|
| **ARCHITECTURE_TRAINING_GATE** | **OPEN** | Retry/Lattice/Recall architecture structurally sound |
| **DEVELOPMENT_SEQUENCE_GATE** | **OPEN** | Single-char + multipath contracts resolved; no implementation drift requiring pre-training correction |

dialog_200 ENV_BLOCKED = outstanding regression debt, not architecture block.

---

## Ownership

| Module | Verdict |
|--------|---------|
| Model3 | KEEP |
| Retry Region | KEEP |
| FineSpan | KEEP |
| Lattice | KEEP |
| Single-char Recall | **KEEP** (not CORRECTION_REQUIRED) |
| Lexicon | COVERAGE_GAP (unchanged) |
| Model2 | KEEP |
| Domain Vote | KEEP |
| Assembly | KEEP |

---

## Next phase

**MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS**

Do **not** automatically implement SINGLE_CHAR_RECALL_CONTRACT_MINIMAL_CORRECTION or RETRY_MULTIPATH_CONSUMER_MINIMAL_CORRECTION — contracts match frozen SSOT.

---

## Governance

Production / Lexicon / Config / Training / Architecture modified: **NO**  
Artifact count: **5** (≤10)

1. `Lingua_SingleChar_Recall_MultiPath_SSOT_Contract_Audit_2026_08_29.md` (this file)
2. `single_char_recall_contract_evidence.csv`
3. `multipath_consumer_contract_evidence.csv`
4. `ssot_contract_audit_summary.json`
5. `ssot_contract_audit_governance.json`
