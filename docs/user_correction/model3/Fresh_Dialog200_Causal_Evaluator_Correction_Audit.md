# Fresh Dialog200 Causal Evaluator Correction Audit

Generated: 2026-09-09T18:30:00Z  
Phase: `FRESH_DIALOG200_CAUSAL_EVALUATOR_CORRECTION_AUDIT`  
Mode: `READ_ONLY AUDIT + OFFLINE EVALUATOR CORRECTION`  
Evidence RUN_ID: `dialog200_full_pipeline_20260909_001141`

---

## Verdict (post-correction)

See `fresh_dialog200_corrected_summary.json` for final machine verdict.  
This document records **evaluator defects** and **required corrections** before / as the offline evaluator was fixed.

---

## CURRENT_EVALUATOR_DEFECTS

Source: `docs/user_correction/model3/analyze_fresh_dialog200_causal_reconciliation.py`

| ID | Defect | Severity |
|----|--------|----------|
| D1 | `mechanismFinal` / `map_mechanism()` drive `firstBreakpoint` | **HISTORICAL_CAUSAL_LABEL_LEAK** |
| D2 | `queryCapable = (mech != QUERY_NOT_REPAIR_CAPABLE)` | **HISTORICAL_CAUSAL_LABEL_LEAK** |
| D3 | Confidence `DIRECT` claimed from historical `mechanismFinal` | Evidence fraud |
| D4 | Missing historical PRIMARY_MINIMAL → auto `NO_LOCAL_LEXICAL_TARGET` | **TARGET_REDERIVATION_GAP** |
| D5 | No `TARGET_APPLICABLE_TO_FRESH_RUN` check | Stale-target risk |
| D6 | `target_in_list()` substring used as DIRECT causal proof | **STRING_HEURISTIC_RISKS** |
| D7 | Recall hit ⇒ Domain survived shortcut | **DOMAIN_FUNNEL_SHORTCUT** |
| D8 | `target_in_kenlm or bool(kenlm_inputs)` | **KENLM_REACHABILITY_SHORTCUT** |
| D9 | Nested-if forced monotonic funnel | Accounting illusion |
| D10 | UNKNOWN forced to 0 | Anti-governance |

---

## HISTORICAL_CAUSAL_LABEL_LEAK_LOCATIONS

```text
analyze_fresh_dialog200_causal_reconciliation.py
  map_mechanism()
  first_breakpoint_for_case():
    mech = map_mechanism(pr["mechanismFinal"])
    query_capable = mech != "QUERY_NOT_REPAIR_CAPABLE"
    if mech == "QUERY_NOT_REPAIR_CAPABLE": bp = QUERY_NOT_REPAIR_CAPABLE
    conf = DIRECT if mechanismFinal == ...
    elif mechanismFinal == RECALL_TARGET_MISS: bp = RECALL_MATCHING_FAILED
```

Hard rule violated:

```text
historical mechanismFinal  >  fresh runtime evidence
```

Allowed residual use of minimality CSV (identity only):

```text
lexicalTarget, targetRole, identitySource, status
```

---

## STRING_HEURISTIC_RISKS

`target_in_list(target, surfaces)` treats:

```text
target == s OR target in s OR s in target
```

as causal proof for FineSpan / Recall / Assembly / KenLM.

Must be downgraded to `SEARCH_HINT` only.  
Structured IDs preferred; when absent → `*_NOT_ISOLATED`.

---

## DOMAIN_FUNNEL_SHORTCUT

Previous code:

```text
recallHit → DOMAIN_SURVIVED += 1
```

without path-local vote / SameDomain / candidate domain_tags check.

Corrected: Domain stage is `NOT_ISOLATED` unless structured domain survival is present (current compact dump lacks per-candidate domain retention).

---

## KENLM_REACHABILITY_SHORTCUT

Previous:

```python
in_kenlm = target_in_list(...) or bool(kenlm_inputs)
```

`bool(kenlm_inputs)` is not target reachability.

Corrected: `REACHED_KENLM` only if a **complete sentence** candidate equals `norm(reference)` (or exact final-correct sentence) appears in `kenlm_input_texts`.

---

## TARGET_REDERIVATION_GAP

Previous: no PRIMARY_MINIMAL → `NO_LOCAL_LEXICAL_TARGET` without fresh re-derivation.

Corrected: attempt fresh re-derive from raw↔ref + current Lexicon membership; else `TARGET_NOT_ISOLATED` (not automatic NO_LOCAL).

---

## FRESH_TRACE_EVIDENCE_GAP (critical)

Production observation type `Model3RetryRecallInvocationTrace` includes:

```text
windowText, spanSurface, windowPinyinKey, candidates[].surface, ...
```

Audit compact dump (`run-fresh-dialog200-causal-reconciliation.mjs`) mapped:

```text
query ← inv.query | queryText   # WRONG KEYS
window ← inv.window | queryWindow  # WRONG KEYS
hits ← inv.hits | candidates[].surface  # hits OK when candidates present
```

Measured on RUN_ID dump:

| Metric | Value |
|--------|------:|
| retry_recall_invocations | 5331 |
| query non-null | **0** |
| window non-null | **0** |
| invocations with hits | 1496 |
| cases with any invocation | 200 |

Therefore for this RUN_ID:

```text
missing field: windowText / spanSurface / windowPinyinKey (lost at audit compact)
affected cases: all 200 (query geometry), and all query/recall isolation questions
causal questions blocked:
  - QUERY_NOT_REPAIR_CAPABLE (cannot list generatedLegalWindows)
  - RECALL_MATCHING_FAILED four-condition proof (query representation unknown)
targeted rerun required?: NO for quality; YES only if future instrumentation dump fix then optional targeted re-dump
```

This is an **audit dump field mismatch**, not a production semantic gap.  
Fixing compact field names is audit-only and allowed later; **this phase must not re-run ASR**.

---

## REQUIRED_CORRECTIONS

1. Remove all `mechanismFinal` → breakpoint control flow.  
2. Historical mechanism only in reconciliation comparison table.  
3. Explicit `value + evidenceSource + evidenceLevel + evidenceRunId + confidence` on causal fields.  
4. Fresh target applicability + re-derivation.  
5. PROVE or `*_NOT_ISOLATED` / `UNKNOWN_NOT_ISOLATED`.  
6. Evidence funnel with conservation: `eligible = survived + lost + notIsolated`.  
7. Quality baseline immutability gate (25→31).  
8. Independence / sensitivity tests on audit fixtures.

---

## Development Gate

| Check | Result |
|-------|--------|
| PRODUCTION_CODE_DIFF | NONE (offline only) |
| Fresh RUN_ID preserved | YES |
| Correction limited to offline evaluator/tests/reports | YES |
| Fresh trace sufficient for full QUERY/Recall isolation | **NO** (`windowText` lost) |
| Sufficient to remove historical leak + honest isolation | **YES** |

Proceed with offline evaluator correction under honesty rule:  
missing query geometry ⇒ **notIsolated**, not invented QUERY owner.

---

## Additional attribution shortcuts found

- Auto-prefer earliest mapped historical mech among multiple PRIMARY_MINIMAL without fresh precedence proof.
- `ASSEMBLY_CANDIDATE_LOSS` from substring absence in assembly strings.
- Treating any `fine:` sourceSpanId as target-specific FineSpan exposure.
- Funnel `FINAL_CORRECT` nested only under KenLM path while script-normalization rescues exist outside lexical repair (document as non-lexical rescue; do not force into lexical funnel).

---

## Correction executed (offline only)

| Item | Path |
|------|------|
| Corrected evaluator | `analyze_fresh_dialog200_corrected_causal.py` |
| Tests | `test_fresh_dialog200_corrected_causal.py` (8/8 PASS) |
| Future dump field fix (audit runner only) | `run-fresh-dialog200-causal-reconciliation.mjs` now persists `windowText` / `spanSurface` / candidates |
| Same RUN_ID recompute | `dialog200_full_pipeline_20260909_001141` (no ASR rerun) |

### Tests

```text
HISTORICAL_MECHANISM_MUTATION_INDEPENDENCE = PASS
HISTORICAL_MECHANISM_REMOVAL_INDEPENDENCE = PASS
QUERY_FRESH_EVIDENCE_SENSITIVITY = PASS
RECALL_FRESH_EVIDENCE_SENSITIVITY = PASS
KENLM_REACHABILITY_STRICTNESS = PASS
QUALITY_BASELINE_IMMUTABILITY = PASS
FUNNEL_CONSERVATION = PASS
FUNNEL_MONOTONICITY = PASS
PRODUCTION_DIFF = NONE (business logic untouched; audit runner dump mapping only)
```

### Before / After matrix

| Metric | Before correction | After correction |
| --- | ---: | ---: |
| RAW_CORRECT | 25 | **25** |
| FINAL_CORRECT | 31 | **31** |
| NET_GAIN | +6 | **+6** |
| QUERY_NOT_REPAIR_CAPABLE | 100 unverified | **0 proven** |
| NO_LOCAL_LEXICAL_TARGET | 59 unverified | **0 proven** (`NO_LOCAL_…_PROVEN`) |
| LEXICON_COVERAGE_MISSING | 0 partially supported | **0** |
| RECALL_MATCHING_FAILED | 14 unverified | **0 proven** |
| ASSEMBLY_CANDIDATE_LOSS | 2 unverified | **0 proven** |
| MODEL3 owner | 0 | **0** |
| KENLM owner | 0 unverified | **0 proven** (7 correct sentences reached KenLM pool, but first-breakpoint blocked upstream) |
| UNKNOWN / NOT_ISOLATED | 0 suspicious | **175** (138 UNKNOWN + 37 TARGET_NI) |
| Historical causal dependency | YES | **NO** |

### Final answers

| # | Question | Answer |
|---|----------|--------|
| A | Quality still 25→31? | **YES** |
| B | Still depends on mechanismFinal? | **NO** |
| C | Independently isolated valid targets? | **138** |
| D | Historical targets not applicable cases? | **0** |
| E | Proven QUERY_NOT_REPAIR_CAPABLE? | **0** |
| F | Valid Lexicon gaps? | **0** |
| G | Proven Recall failures? | **0** |
| H | Proven Domain losses? | **0** |
| I | Proven Assembly losses? | **0** |
| J | Correct candidates reached KenLM? | **7** |
| K | Proven KenLM wrong selections? | **0** |
| L | NOT_ISOLATED? | **175** |
| M | Model3 still closed? | **YES** |
| N | Retry architecture still frozen? | **YES** |
| O | Highest-confidence actionable owner? | **NONE_WITH_DIRECT_FRESH_EVIDENCE** |
| P | Evidence sufficient for module Delta? | **NO** → `CAUSAL_TRACE_INSTRUMENTATION_AUDIT` |

### Verdict

`FRESH_CAUSAL_EVALUATOR_CORRECTION_NEEDS_TRACE_INSTRUMENTATION`

Reason: historical label leak removed and quality baseline immutable, but this RUN_ID compact dump lacks `windowText` / region offsets, so QUERY/RECALL/FineSpan-target-specific owners cannot be DIRECT-proven. UNKNOWN rising is correct under PROVE-or-NOT_ISOLATED.
