# LINGUA_PILOT200_POST_ANCHOR_ACP_REMEASURE_REPORT

| Field | Value |
|---|---|
| Date | 2026-09-14 |
| Mode | MEASURE_ONLY / FROZEN_ARCHITECTURE |
| Dataset | LINGUA_DIALOG2000_V2_PILOT200 (200×3=600) |
| Baseline | POST_PRE_EDGE_RESTORE_FULL_REMEASURE |
| Runtime | `dist` rebuilt with ACP Anchor adapter before authoritative run |
| Remeasure validity | **PASS** |
| Dominant failure owner | **LEXICON_RECALL** |
| ONE_NEXT_OWNER | **LEXICON_RECALL_OWNER** |

## 1. Executive answer

After restoring Model2 PRE-LEXICAL-EDGE, FineSpan-local Tone, and ACP PROFILE_PRONUNCIATION-only Anchor under MERGE_SHARED_BUDGET Retry:

- **Final repair is unchanged** vs previous accepted Pilot: NO 22 / CORRECT 26 / WRONG 22.
- CORRECT−NO final delta remains **+4**.
- Gates A–I are **identical** to previous (Model2→Lexicon→Edge path still fails at Gate E).
- Anchor ACP **verified**: Domain / PROFILE_DOMAIN / PROFILE_RETRIEVAL Anchors = **0**; P Anchors = **565**; P-anchor-loss = **0**.
- Model3 exposure **increased sharply** (actionable 38948, RETRY 8765, rate ≈22.5%); shared-budget drops PROFILE_DOMAIN heavily (~47.6% existing survival).
- **Zero final-case flips** vs previous TRACE (CHANGED_CASES empty).
- Research hypothesis remains **PARTIALLY_SUPPORTED**; first causal blocker for CORRECT_PROFILE→final repair is still **LEXICON_RECALL**.

## 2. Final repair vs previous

| Condition | Current | Previous | Δ |
|---|---:|---:|---:|
| NO_PROFILE | 22/200 | 22/200 | 0 |
| CORRECT_PROFILE | 26/200 | 26/200 | 0 |
| WRONG_PROFILE | 22/200 | 22/200 | 0 |
| CORRECT−NO | +4 | +4 | 0 |
| WRONG−NO | 0 | 0 | 0 |

## 3. Gates A–I

| Gate | Current | Previous | Abs Δ pass | Rate Δ |
|---|---|---|---:|---:|
| A | 471/471 | 471/471 | 0 | 0 |
| B | 261/314 | 261/314 | 0 | 0 |
| C | 226/314 | 226/314 | 0 | 0 |
| D | 161/314 | 161/314 | 0 | 0 |
| E | 3/314 | 3/314 | 0 | 0 |
| F | 3/314 | 3/314 | 0 | 0 |
| G | 3/314 | 3/314 | 0 | 0 |
| H | 3/314 | 3/314 | 0 | 0 |
| I | 70/597 | 70/597 | 0 | 0 |

## 4. Anchor authority verification

| Metric | Value |
|---|---:|
| PROFILE_PRONUNCIATION Anchor | 565 |
| Domain Anchor | **0** |
| PROFILE_DOMAIN Anchor | **0** |
| PROFILE_RETRIEVAL Anchor | **0** |
| PROFILE_PRONUNCIATION_ANCHOR_LOSS | **0** |

## 5. Model3 exposure + Retry shared budget

| Metric | Value |
|---|---:|
| Decision units | 39513 |
| Actionable non-anchor | 38948 |
| KEEP / RETRY | 30183 / 8765 |
| RETRY rate | 0.225 |
| Retry regions | 6067 |
| Stage-2 invocations | 33085 |
| Stage-2 useful (hitCount metric) | 0 (field observability; RETRY recovery runs=70) |
| Existing present / dropped / survival | 48980 / 25661 / 0.476 |
| PROFILE_DOMAIN entering Retry / drop | 47101 / 25661 |

Shared-budget displacement is **observed and expected** under frozen MERGE_SHARED_BUDGET — not a new bug class requiring reserved Domain slots.

## 6. Condition table

| Cond | final | action≈ | lex | edge | Anchors | actionable | KEEP | RETRY | existDrop | PD cands | P cands |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NO | 22 | 0 | 0 | 0 | 0 | 7471 | 5738 | 1733 | 1835 | 4042 | 0 |
| CORRECT | 26 | 104 | 3 | 3 | 330 | 14891 | 11537 | 3354 | 10781 | 20905 | 284 |
| WRONG | 22 | 122 | 0 | 0 | 235 | 16586 | 12908 | 3678 | 13045 | 26598 | 131 |

WRONG extraExpansionCount ≈ 26167 (prev 21947); finalRepairDelta still 0.

## 7. Profile contrasts

| Contrast | finalRepairΔ | actionΔ | lexΔ | edgeΔ | retryΔ | dropΔ |
|---|---:|---:|---:|---:|---:|---:|
| CORRECT−NO | +4 | +104 | +3 | +3 | +1621 | +8946 |
| WRONG−NO | 0 | — | — | — | +1945 | +11210 |
| CORRECT−WRONG | +4 | — | — | — | −324 | — |

## 8. Control cases

| ID | Result |
|---|---|
| C1 德鸾 `p2_u004_019` CORRECT | Anchors=0; KEEP=2 RETRY=4; owner LEXICON_RECALL |
| C2 行程 ASR `p2_u001_020` | Domain Anchor=0; other P Anchors=4; RETRY=9 |
| C3 刘/牛肉串 `p2_u001_039` | P Anchors=7; Domain Anchor=0 |
| C4 生成 `p2_u004_001` | P Anchors=2; Domain Anchor=0; finalCorrect=true |
| C5 PROFILE_RETRIEVAL-only | ABSENT in Pilot200 observation (count=0) |
| C6 budget drop | `p2_u001_002_CORRECT` drop=60/120 |
| C7 budget survive | `p2_u001_003_NO` drop=0 present=10 |
| C8 wrong heavy | `p2_u003_035_WRONG` extra=994 |

## 9. First-failure owners

Unchanged dominant structure vs previous; one observational reclass DOWNSTREAM→MODEL3_RETRY_NO_USEFUL_STAGE2. **LEXICON_RECALL=158** remains the largest Model2-applicable first failure.

## 10. Performance

pipeline p50≈4927 ms, p95≈12447 ms (597 samples) → **WARNING** vs ~1.5s context. No optimization this round.

## 11. Anti-drift

PRODUCT_CODE_CHANGE_THIS_ROUND = NO (compile-only of already-accepted ACP before measurement).  
No Model2/Model3/Retry/budget/Domain/FineSpan/Tone/Lexicon redesign.

ACCEPTANCE_STATUS = PASS  
ONE_NEXT_OWNER = LEXICON_RECALL_OWNER  
ONE_NEXT_DELTA = Investigate lexicon recall key/coverage blocking CORRECT_PROFILE P→hit→edge conversion; keep Anchor ACP + MERGE_SHARED_BUDGET frozen.

STOP.
