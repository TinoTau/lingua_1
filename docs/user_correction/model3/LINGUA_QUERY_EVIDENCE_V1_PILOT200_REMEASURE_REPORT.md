# LINGUA_QUERY_EVIDENCE_V1_PILOT200_REMEASURE_REPORT

| Field | Value |
|---|---|
| Phase | `LINGUA_STAGE2_QUERY_EVIDENCE_V1_POST_IMPLEMENTATION_PILOT200_REMEASURE` |
| Date | 2026-09-15 |
| Mode | MEASURE_ONLY / CODE_FROZEN / NO_TUNING |
| Dataset | `LINGUA_DIALOG2000_V2_PILOT200` (200×3=600) |
| Baseline | `LINGUA_PILOT200_POST_STAGE2_TONE_RELAX_REMEASURE` |
| Remeasure validity | **PASS** (`COMPLETE_AUTHORITATIVE_600_RUNS`) |
| Lexicon runtime | **OK** (Electron ABI / better-sqlite3) |
| Runtime contradiction | **NO** (`TRACE_ONLY_EVIDENCE_COUNT=0`) |

## Primary comparison vs Stage2 Tone-relax baseline

| Metric | Baseline | Current | Delta |
|---|---:|---:|---:|
| NO_PROFILE correct | 22 | 22 | 0 |
| CORRECT_PROFILE correct | 22 | 31 | **+9** |
| WRONG_PROFILE correct | 19 | 19 | 0 |
| CORRECT−NO | 0 | 9 | +9 |
| WRONG−NO | -3 | -3 | 0 |
| Gate E | 3 | 3 | 0 |
| Gate I | 63 | 72 | **+9** |
| MODEL3_RETRY_STAGE2_QUERY | 257 | 0 (dissolved into QEV*) | **-257** |
| Stage2 target hits | 39 | 55 | +16 |
| target-hit invocations | 157 | 190 | +33 |
| retry downstream recovery | 63 | 72 | +9 |
| retry target candidate drops | 9 | 9 | 0 |
| perSpanCap saturation | 75.8129% | 75.5961% | −0.22pp |
| existing survival | 25.19% | 27.03% | +1.84pp |
| p50 ms | 5433 | 5017 | −416 |
| p95 ms | 13968 | 13196 | −772 |
| Stage2 evidence queries | 0 | 12467 | +12467 |
| Stage2 EXACT maps | 0 | 3953 | +3953 |
| Stage2 SUBSPAN maps | 0 | 8514 | +8514 |

## QueryEvidence production / Stage2 source

| Metric | Value |
|---|---:|
| Stage2 ASR queries | 20618 |
| Stage2 evidence queries | 12467 |
| Evidence mapping rate | 37.68% |
| EXACT | 3953 |
| SUBSPAN | 8514 |
| RAW_CONFLICT_REJECT | 0 |
| UNSUPPORTED_GEOMETRY | 9724 |
| INVALID_EVIDENCE | 0 |
| TRACE_ONLY_EVIDENCE | 0 |
| Evidence nonempty | 5694 |
| Evidence empty | 6773 |
| Evidence target-hit invocations | 67 |
| Evidence non-target-only | 5627 |
| NO_PROFILE evidence queries | 0 |
| CORRECT evidence queries | 6246 |
| WRONG evidence queries | 6221 |
| WRONG evidence target hits | 3 |

## Q1 runtime revalidation (CORRECT_PROFILE)

| Metric | Value |
|---|---:|
| Q1_CONFIRMED | 33 |
| Q1_RUNTIME_MAPPED | **32** |
| Q1_RUNTIME_DEFERRED | **1** (`p2_u005_011` → UNSUPPORTED_GEOMETRY / ASR) |
| Q1 mapped → target hit | 12 |
| Q1 mapped → final correct | 4 |

## Reclassification of baseline 257 `MODEL3_RETRY_STAGE2_QUERY`

| Current first owner | Count |
|---|---:|
| QEV7_RECALL_NON_TARGET_HIT | **108** |
| TONE_QUERY | 56 |
| MODEL2_ACTION | 40 |
| RELATION_TRANSFORM | 30 |
| QEV11_KENLM_NOT_SELECTED | 9 |
| QEV1_NO_FIRST_PASS_EVIDENCE | 8 |
| QEV13_SUCCESS | 4 |
| QEV6_MAPPED_QUERY_EXECUTED_RECALL_EMPTY | 2 |
| **Total** | **257** |

## Changed cases vs baseline

| | Count |
|---|---:|
| IMPROVED | **9** (all CORRECT_PROFILE) |
| REGRESSED | **0** |
| UNCHANGED | **591** |
| NO_PROFILE unexpected delta | **0** |

Improved caseIds: `p2_u001_037`, `p2_u001_038`, `p2_u001_040`, `p2_u002_015`, `p2_u002_037`, `p2_u003_008`, `p2_u004_036`, `p2_u004_038`, `p2_u005_012`.

## Domain safety

| Metric | Value |
|---|---:|
| outOfBucket | 0 |
| emptyRetainedAllDomainFallback | 0 |
| crossPathLeak | 0 |
| DOMAIN_SAFETY | **PASS** |

## Interpretation (measurement only)

1. QueryEvidence V1 is **mechanically proven in production**: Stage2 consumes mapped syllables (`querySource=RECALL_QUERY_EVIDENCE`, `TRACE_ONLY=0`), Q1 **32/33** maps at runtime, deferred case remains deferred.
2. Final accuracy effect is **POSITIVE** on CORRECT_PROFILE (+9) with **no regressions** and unchanged NO/WRONG finals.
3. Gate E stays 3/314 (first-pass Lexicon hit unchanged). Recovery moves to Stage2 → Gate I +9.
4. Previous 257 Stage2-query owner **dissolves**; largest new first loss among that cohort and overall is **`QEV7_RECALL_NON_TARGET_HIT`** (mapped query executes, Recall returns non-target / no target).
5. Secondary residual after target hit+budget survival: **`QEV11_KENLM_NOT_SELECTED`** (n=11 overall / 9 of 257).

## ONE next owner

```text
ONE_NEXT_OWNER = QEV7_RECALL_NON_TARGET_HIT
ONE_NEXT_DELTA =
Audit why evidence-mapped Stage2 Recall returns non-target (or empty-of-target)
hits under frozen retainedDomains + Tone-relax: query/domain eligibility vs
lexicon surface coverage — measurement/ACP only; no budget/KenLM/Model3 tuning.
```

## Anti-drift checklist

```text
product runtime code changed this round? NO (harness/analysis only)
dataset / RAW / Tone replay / profiles / lexicon / eval criteria? NO
Model2 / Model3 / RetryRegion / Stage2 geometry / Tone / Domain / budget /
SameDomain / Assembly / KenLM changed? NO
GT used by runtime? NO
fixed newly discovered bugs this round? NO
```

## Artifacts (≤8)

1. `LINGUA_QUERY_EVIDENCE_V1_PILOT200_REMEASURE_REPORT.md`
2. `LINGUA_QUERY_EVIDENCE_V1_PILOT200_SUMMARY.json`
3. `LINGUA_QUERY_EVIDENCE_V1_Q1_RUNTIME_FUNNEL.csv`
4. `LINGUA_QUERY_EVIDENCE_V1_STAGE2_QUERY_SOURCE.csv`
5. `LINGUA_QUERY_EVIDENCE_V1_257_RECLASSIFICATION.csv`
6. `LINGUA_QUERY_EVIDENCE_V1_CHANGED_CASES.csv`
7. `LINGUA_QUERY_EVIDENCE_V1_CANDIDATE_LIFECYCLE.csv`
8. `modified_file_inventory.csv`
