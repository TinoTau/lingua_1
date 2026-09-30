# LINGUA_QEV7_EXACT_ATTRIBUTION_AUDIT

| Field | Value |
|---|---|
| Phase | `LINGUA_QEV7_RECALL_NON_TARGET_HIT_EXACT_ATTRIBUTION_AUDIT_V1` |
| Mode | READ_ONLY / CODE_FROZEN / NO_TUNING |
| Cohort | `QEV7_RECALL_NON_TARGET_HIT` |
| Expected / Actual | **109 / 109** |
| Owner matrix total | **109** |
| Dominant proven first owner | **`A1_QUERY_NOT_TARGET_REACHABLE` (72)** |
| True Recall-internal loss (A7–A10) | **0** |
| Product runtime changed | **NO** |
| GT used by runtime | **NO** |
| GT used by audit | **YES** |
| QueryEvidence V1 reopen | **NO** |

## Verdict in one paragraph

`QEV7_RECALL_NON_TARGET_HIT` is a **measurement label**, not a Recall defect. Across all 109 cases, **no evidence-backed Stage2 invocation selected the exact target canonical pinyin** (`Q_MATCH_EXACT = 0`). Therefore zero cases reach the Recall-proof gate. Loss is entirely **pre-Recall**: either no target-length evidence window (**A2=37**) or same-length / other windows whose selected keys are not the target pinyin (**A1=72**). Offline lexicon lookup confirms targets exist; exact target keys would retrieve them — the production Stage2 query never asked for those keys.

## Owner matrix

| Owner | CORRECT | WRONG | NO_PROFILE | Total | % |
|---|---:|---:|---:|---:|---:|
| A1_QUERY_NOT_TARGET_REACHABLE | 29 | 43 | 0 | **72** | 66.1% |
| A2_TARGET_GEOMETRY_NOT_COMPATIBLE | 14 | 23 | 0 | **37** | 33.9% |
| A3–A14 (all others) | 0 | 0 | 0 | **0** | 0% |

## Funnel (first-drop; exact target-pinyin reachability)

```text
109 QEV7
↓ query target-reachable (selectedPinyin == targetCanonicalPinyin): 0
↓ target geometry valid: 0
↓ lexicon present: 0
↓ pinyin compatible: 0
↓ domain eligible: 0
↓ exact Recall reproduced: 0
↓ target raw-retrieved: 0
↓ target inside topK: 0
```

## Condition split

| Condition | QEV7 | A1 | A2 |
|---|---:|---:|---:|
| CORRECT_PROFILE | 43 | 29 | 14 |
| WRONG_PROFILE | 66 | 43 | 23 |
| NO_PROFILE | 0 | 0 | 0 |

## A1 secondary breakdown (n=72)

| Secondary | Count |
|---|---:|
| WRONG_PROFILE_CONDITIONED_QUERY | 43 |
| LENGTH_MISALIGNED_EVIDENCE_SLICE | 25 |
| MODEL2_OR_EVIDENCE_WINDOW_MISS_TARGET_KEY | 4 |

## Query relation vs target (observational)

| Relation | Count |
|---|---:|
| Q_MATCH_TARGET_SUPERSPAN (window shorter than target) | 61 |
| Q_NOT_TARGET_REACHABLE | 40 |
| Q_MATCH_PHONETICALLY_REACHABLE (same length, one frozen relation away) | 8 |
| Q_MATCH_EXACT | **0** |

Note: SUPERSPAN / phonetic-near are **not** Stage2 Recall-reachable for the target term (Recall keys by exact window pinyin + length). They remain **A1/A2**, not Recall-internal.

## Recall defect proof

```text
RECALL_IS_DOMINANT_OWNER = NO
RECALL_TRUE_INTERNAL_LOSS_COUNT = 0
```

No case satisfied:

```text
exact target query selected
+ geometry valid
+ lexicon present
+ domain eligible
+ target lost inside Recall
```

## Lexicon / Domain

```text
LEXICON_COVERAGE_IS_DOMINANT_OWNER = NO
DOMAIN_IS_DOMINANT_OWNER = NO
```

Pilot case metadata marks all 109 targets `targetInLexicon=true`. Audit DB probes show exact target pinyin would retrieve the surface when queried — production never issued that query on an evidence-backed Stage2 invocation.

## Model2 / relation boundary

```text
MODEL2_OR_RELATION_IS_DOMINANT_OWNER = YES
```

(via A1 dominant + CORRECT_PROFILE misses + WRONG_PROFILE conditioned queries)

Frozen `MODEL2_RELATION_GLOBAL_APPLICATION = INTENTIONAL` is **not** contradicted: wrong-profile QEV7 (66) is expected when mapped evidence is wrong-profile-conditioned. CORRECT_PROFILE residual (43) is primarily **evidence-backed Stage2 windows not carrying exact target keys** (slice / coverage / multi-window), not Lexicon/Recall engine failure.

## Architecture / ACP

```text
ARCHITECTURE_CONFLICT_FOUND = NO
ACP_REQUIRED = POSSIBLE
```

Possible later ACP only if product wants Stage2 to prefer target-length exact keys from utterance evidence store — **not** in this round.

## ONE next owner

```text
ONE_NEXT_OWNER = A1_QUERY_NOT_TARGET_REACHABLE

ONE_NEXT_DELTA =
Read-only pre-development audit of why evidence-backed Stage2 REPLACE
queries never equal target canonical pinyin (window-length selection vs
Model2 evidence coverage vs compound ASR) — do not touch Recall/topK/budget/KenLM.
```

## Anti-drift

```text
QueryEvidence V1 changed? NO
Model2/Model3/Retry/Tone/Domain/budget/Assembly/KenLM/Lexicon/dataset? NO
GT entered runtime? NO
Failures fixed this round? NO
```

## Artifacts

1. `LINGUA_QEV7_EXACT_ATTRIBUTION_AUDIT.md`
2. `LINGUA_QEV7_CASE_ATTRIBUTION.csv` (109 rows)
3. `LINGUA_QEV7_OWNER_MATRIX.csv`
4. `LINGUA_QEV7_ATTRIBUTION_FUNNEL.json`
5. `LINGUA_QEV7_RECALL_REPRODUCTION.csv`
6. `modified_file_inventory.csv`
