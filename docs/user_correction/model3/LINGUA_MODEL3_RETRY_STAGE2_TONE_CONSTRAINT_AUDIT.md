# Lingua1 — Model3 RETRY Stage2 Tone Constraint Ownership Audit

**WHEN MODEL3 DETECTS A RESIDUAL ILLEGAL SPAN, CURRENT STAGE2 RETRY DOES NOT PROVIDE A WAY TO RECOVER FROM AN INCORRECT FIRST-PASS TONE KEY — IT REUSES THE SAME FINE SPAN ACOUSTIC TONE UNDER MANDATORY EXACT RECALL — AND HISTORICAL SSOT NEVER FROZE A DEDICATED RETRY TONE-RELAX POLICY (SOFT CONFLICT WITH STAGE6 “RELAXATION” LANGUAGE).**

| Field | Value |
|---|---|
| PHASE | `LINGUA_MODEL3_RETRY_STAGE2_TONE_CONSTRAINT_OWNERSHIP_AUDIT` |
| DATE | 2026-09-14 |
| MODE | READ_ONLY / TRACE_FIRST / SSOT_FIRST |
| BASELINE | `LINGUA_DIALOG2000_V2_PILOT200` / `LINGUA_PILOT200_POST_ANCHOR_ACP_CONTROLLED_REMEASURE` |
| PRODUCT CODE CHANGE | **NO** |

---

## 1. Baseline identity

| Check | Result |
|---|---|
| Dataset / runs | Pilot200 × 3 = 600 |
| Remeasure validity | PASS |
| E5 CORRECT_PROFILE population (Gate-E audit) | 35 |
| All 35 E5 runs have Model3 RETRY > 0 | YES |
| **BASELINE_IDENTITY** | **PASS** |

---

## 2. Historical authority

### Found

| Field | Value |
|---|---|
| `HISTORICAL_RETRY_TONE_SSOT_FOUND` | **YES** |
| `HISTORICAL_RETRY_TONE_POLICY` | **CONFLICTING** |
| `HISTORICAL_SSOT_CONFLICT` | **YES** |
| `ARCHITECTURE_CLASSIFICATION` | **C_HISTORICAL_RETRY_TONE_POLICY_NOT_SPECIFIED** |
| `TONE_RETRY_AUTHORITY_GAP` | **YES** |
| `IMPLEMENTATION_DRIFT` | **NO** |

### Authoritative quotes (short)

1. `model3_retry_contract_v1.md` — Tone on Retry recall is **not** frozen exact/relax:

> Tone gates / tone evidence on recall | PARTIALLY_SUPPORTED (existing recall tone path; retry relaxation policy Stage6)

2. `Lingua_Model3_Retry_Stage2_SSOT_Restoration_Design.md` — Stage2 reuses existing Tone attachment; must not change Recall algorithm:

> … pinyin key, and **existing tone attachment rules**.  
> Stage-2 MUST NOT: … **change … Recall algorithm**

3. `Recall_Subsystem_Frozen_Contract_2026_08_03.md` — first-pass / shared Recall = Mandatory Tone exact (Fail Closed). Stage2 calls the same `recallSpanTopKV2`.

### Conflict explained

- **Operative inheritance:** Stage2 restoration + Mandatory Tone ⇒ current Stage2 behaves as **exact Tone**.
- **Unfrozen intent language:** Retry contract / architecture wording names **tone relaxation / Stage6** as PARTIALLY_SUPPORTED — never accepted as ACP.
- Therefore: not classification A (no frozen relaxed policy to “restore”), not B (no explicit “Stage2 RETRY MUST stay EXACT forever” freeze), not D (code is not relaxed). → **C + authority gap + ACP required**.

---

## 3. Current Stage2 call chain

```
Model3 RETRY
 → deriveRetryRegions
 → resegmentRetryRegionWithLattice   (surfaces/trace only; NOT Stage2 query SSOT)
 → enumerateStage2SuccessPathQueryLocals
 → recall({ span: owner FineSpan, syllables, … })
 → recallSpanTopKV2({ acousticTonePattern: owner.toneRebindTrace?.acousticTonePattern })
 → materialize → mergeSpanCandidates (MERGE_SHARED_BUDGET / perSpanCap)
```

| Field | Value |
|---|---|
| `CURRENT_STAGE2_ENTRY` | `model3-retry-router.ts::routeModel3Retry` (+ `enumerateStage2SuccessPathQueryLocals`) |
| `CURRENT_STAGE2_RECALL_FUNCTION` | `recallSpanTopKV2` via `run-model3-path-step.ts` recall closure |
| `CURRENT_STAGE2_TONE_SOURCE` | owner `PathFineSpan.toneRebindTrace.acousticTonePattern` |
| `CURRENT_STAGE2_TONE_REQUIRED` | **YES** (Fail Closed) |
| `CURRENT_STAGE2_USES_FIRST_PASS_TONE` | **YES** |
| `CURRENT_STAGE2_REBINDS_TONE` | **NO** |
| `CURRENT_STAGE2_CAN_CALL_RECALL_WITHOUT_TONE` | **YES** (API accepts `undefined`) |
| `CURRENT_STAGE2_RECALL_MODE` | Mandatory `tone_exact`; fuzzy off; no plain fallback; empty if not ready |

Wiring evidence:

```468:478:electron_node/electron-node/main/src/model3-runtime/run-model3-path-step.ts
    recall: ({ span, local, retainedDomains, syllables, windowText, perSpanLimit }) => {
      const result = recallSpanTopKV2(args.runtime, {
        // ...
        acousticTonePattern: span.toneRebindTrace?.acousticTonePattern ?? undefined,
      });
```

```417:419:electron_node/electron-node/main/src/model3-runtime/model3-retry-router.ts
          acousticTonePattern: owner.toneRebindTrace?.acousticTonePattern
            ? [...owner.toneRebindTrace.acousticTonePattern]
            : undefined,
```

`MODEL2_ON_MODEL3_RETRY` remains **NO** for Stage2 recall path (Model2 not used to build Stage2 query keys).

---

## 4. First-pass vs Stage2

| Dimension | FIRST PASS | STAGE2 RETRY |
|---|---|---|
| Window owner | Full-utterance lexical windows / FineSpan | RetryRegion legal L=1..min(5,R) windows |
| Pinyin source | Window syllables | Same global syllables slice |
| Tone source | Window extract **and** FineSpan rebind | **Only** owner FineSpan rebind (no re-extract) |
| Tone readiness | Mandatory | Mandatory (same readiness SSOT) |
| Recall function | `recallSpanTopKV2` / window recall | `recallSpanTopKV2` |
| Exact Tone required | YES | YES |
| Fuzzy / no-Tone | Frozen off / Fail Closed | Same |
| TopK / budget | per-span limits | Same `perSpanCap` + MERGE_SHARED_BUDGET |
| Model2 invoked | Yes (pre-edge once) | **NO** on Stage2 query path |
| Domain | vote / filters | Reuses `retainedDomains` |
| Materialization / merge | First-pass pools | `m3r:` candidates → existing-first merge |

| Field | Value |
|---|---|
| `STAGE2_RECOVERY_DIMENSIONS` | **RESEGMENTATION_PLUS_NEW_WINDOW_GEOMETRY** |
| `STAGE2_CAN_RECOVER_FIRST_PASS_TONE_KEY_MISS` | **NO** |

Why NO: Stage2 reuses the same FineSpan acoustic Tone digits that already excluded the target under exact matching. New window geometry cannot invent a different Tone key; wrong Tone stays wrong. (Length mismatch can also yield `invalid_pattern` → empty.)

---

## 5. E5 TRACE replay (CORRECT_PROFILE, n=35)

All 35 E5 cases:

- first-pass: pinyin target-reachable; Tone-ready; acoustic Tone ≠ canonical → target miss
- Lexicon: target present; canonical pinyin+tone retrieves target
- Model3: **RETRY present on all 35** (`model3RetryCount > 0`; Stage2 invocations > 0)
- Stage2: same pinyin family + **same wrong Tone** → **target hit = 0**
- Harness Stage2 useful/nonempty metrics = 0 on these runs (see §7)

Representative (see CSV for full set):

| caseId | target | pinyin | acoustic Tone | canonical | Stage2 hit | CF no-Tone hit |
|---|---|---|---|---|---|---|
| p2_u001_007 | 内科 | nei\|ke | nei4\|ke5 | nei4\|ke1 | NO | YES (rank 1) |
| p2_u001_014 | 纪念 | ji\|nian | ji1\|nian3 | ji4\|nian4 | NO | YES |
| p2_u002_002 | 自取 | zi\|qu | zi2\|qu4 | zi4\|qu3 | NO | YES |
| p2_u002_007 | 坐标点 | zuo\|biao\|dian | … | … | NO | YES |
| p2_u002_016 | 咖啡师 | ka\|fei\|shi | … | … | NO | YES |

First Stage2 blocking boundary for E5: **exact Tone-key mismatch on reused FineSpan pattern** (not Lexicon absence, not Model3 KEEP).

| Field | Value |
|---|---:|
| `E5_TRACE_CASE_COUNT` | 35 |
| `E5_RETRY_COUNT` | 35 |
| `E5_STAGE2_TARGET_HIT_COUNT` | 0 |

---

## 6. Counterfactual Tone-relaxed Stage2 (diagnostic only)

**COUNTERFACTUAL_ONLY:** same pinyin key; remove Tone constraint via RO Lexicon `pinyin_key` lookup.  
Not production behavior: calling `recallSpanTopKV2` without pattern **fail-closes to empty**, which is **not** pinyin-only.

| Metric | Value |
|---|---:|
| `E5_COUNTERFACTUAL_CASE_COUNT` | 35 |
| `E5_TARGET_RECOVERED_WITHOUT_TONE` | **35** |
| `E5_TARGET_RECOVERY_RATE_WITHOUT_TONE` | **1.00** |
| Rank-1 among recovered | 34 / 35 |
| Survives simulated perSpanCap=4 | 35 / 35 |
| `CANDIDATE_COUNT_MULTIPLIER_MEDIAN` | 1.0 |
| `CANDIDATE_COUNT_MULTIPLIER_MAX` | 2.0 |

### Controls (correct Tone keys, n=12)

| Metric | Value |
|---|---:|
| `CONTROL_CASE_COUNT` | 12 |
| `CONTROL_CANDIDATE_EXPANSION_MEDIAN` | 1.0 |
| `CONTROL_CANDIDATE_EXPANSION_MAX` | 3.0 |
| `CONTROL_EXISTING_USEFUL_CANDIDATE_DROP_COUNT` | **0** |

Includes Gate-E PASS controls (检查组 / 开幕式 / 生成) and canonical-tone non-E5 keys.  
Also CSV includes one **RETRY downstream recovery** control row (finalCorrect ∧ retryRecovery; harness Stage2 useful still 0).

`PERFORMANCE_COUNTERFACTUAL` = **NOT_MEASURED**

Recovery is **not** automatic authorization to change production — it only supports a **narrow ACP decision**.

---

## 7. Observability

Harness (`run-pilot200-post-anchor-acp-remeasure.mjs`):

- **Stage2 invocation** = `retry_recall_invocations.length`
- **Stage2 nonempty / useful** = same predicate: `hitCount ?? returnedCandidateCount ?? hits.length > 0`
- Production trace fields are **`candidateCount` / `candidates`** — names harness does **not** read when `inv` is present → systematic **0 useful** despite invocations
- **Retry downstream recovery** = `model3RetryCount > 0 && finalCorrect` (case boolean) — **does not require** Stage2 useful

| Field | Value |
|---|---|
| `STAGE2_USEFUL_METRIC_SEMANTICS` | nonempty hitCount/returnedCandidateCount/hits on invocations; else retry_attempts.returnedCandidateCount |
| `RETRY_RECOVERY_METRIC_SEMANTICS` | RETRY present ∧ final text contains target |
| `METRIC_CONTRADICTION` | **YES** (useful≈0 while recovery=70 globally) |
| `OBSERVABILITY_DEFECT` | **YES** (field-name mismatch; useful≡nonempty) |

Do not fix instrumentation this round.

---

## 8. What this audit does **not** change

| Item | Required change? |
|---|---|
| Normal first-pass exact Tone | **NO** |
| Model3 KEEP/RETRY / input | **NO** |
| Model2 | **NO** |
| Lexicon | **NO** |
| Retry shared budget | **NO** |
| Tone model training | **NO** |
| Domain as Anchor | **NO** |
| Global ignore-Tone fallback | **NOT PROPOSED** |

Only future scope under consideration (not implemented): **Model3-approved bounded local Stage2 Tone constraint**.

---

## 9. Contract authority decision

**C_HISTORICAL_RETRY_TONE_POLICY_NOT_SPECIFIED**

- Current code: exact Tone via inheritance → cannot recover E5 Tone-key misses  
- Counterfactual: Tone-relax on Stage2 would recover **all 35** E5 targets with mild expansion and **0** control useful drops under cap  
- Therefore: **ACP_REQUIRED = YES** (narrow Stage2 Tone constraint only)

`ONE_NEXT_OWNER` = **STAGE2_TONE_RELAXATION_ACP_OWNER**  
`ONE_NEXT_DELTA` = Prepare one narrow ACP for Model3-triggered bounded local Stage2 Tone-relaxed recall only.

---

## Anti-drift

| Check | OK? |
|---|---|
| First-pass exact Tone frozen | YES |
| No global no-Tone / dual chain proposed | YES |
| Model2 ownership / no Retry Model2 | YES |
| Model3 unchanged | YES |
| Anchor / budget / Lexicon / Tone model unchanged | YES |
| Historical authority before code judgment | YES |
| Counterfactual only removed Stage2 Tone constraint | YES |
| Zero product code changes | YES |

---

## Final verdicts

```
BASELINE_IDENTITY = PASS

HISTORICAL_RETRY_TONE_SSOT_FOUND = YES
HISTORICAL_RETRY_TONE_POLICY = CONFLICTING
HISTORICAL_SSOT_CONFLICT = YES

CURRENT_STAGE2_ENTRY = model3-retry-router.ts::routeModel3Retry (+ enumerateStage2SuccessPathQueryLocals)
CURRENT_STAGE2_RECALL_FUNCTION = recallSpanTopKV2 (run-model3-path-step recall closure)
CURRENT_STAGE2_TONE_SOURCE = owner PathFineSpan.toneRebindTrace.acousticTonePattern
CURRENT_STAGE2_TONE_REQUIRED = YES
CURRENT_STAGE2_USES_FIRST_PASS_TONE = YES
CURRENT_STAGE2_REBINDS_TONE = NO
CURRENT_STAGE2_CAN_CALL_RECALL_WITHOUT_TONE = YES
CURRENT_STAGE2_RECALL_MODE = Mandatory tone_exact Fail Closed; fuzzy off; no plain fallback

STAGE2_RECOVERY_DIMENSIONS = RESEGMENTATION_PLUS_NEW_WINDOW_GEOMETRY
STAGE2_CAN_RECOVER_FIRST_PASS_TONE_KEY_MISS = NO

E5_TRACE_CASE_COUNT = 35
E5_RETRY_COUNT = 35
E5_STAGE2_TARGET_HIT_COUNT = 0
E5_COUNTERFACTUAL_CASE_COUNT = 35
E5_TARGET_RECOVERED_WITHOUT_TONE = 35
E5_TARGET_RECOVERY_RATE_WITHOUT_TONE = 1.00
CANDIDATE_COUNT_MULTIPLIER_MEDIAN = 1.0
CANDIDATE_COUNT_MULTIPLIER_MAX = 2.0

CONTROL_CASE_COUNT = 12
CONTROL_CANDIDATE_EXPANSION_MEDIAN = 1.0
CONTROL_CANDIDATE_EXPANSION_MAX = 3.0
CONTROL_EXISTING_USEFUL_CANDIDATE_DROP_COUNT = 0

STAGE2_USEFUL_METRIC_SEMANTICS = harness nonempty via hitCount|returnedCandidateCount|hits (mismatched vs production candidateCount)
RETRY_RECOVERY_METRIC_SEMANTICS = model3RetryCount>0 AND finalCorrect
METRIC_CONTRADICTION = YES
OBSERVABILITY_DEFECT = YES

NORMAL_FIRST_PASS_TONE_POLICY_CHANGE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
MODEL2_CHANGE_REQUIRED = NO
LEXICON_CHANGE_REQUIRED = NO
RETRY_BUDGET_CHANGE_REQUIRED = NO
TONE_MODEL_CHANGE_REQUIRED_FOR_THIS_AUDIT = NO

TONE_RETRY_AUTHORITY_GAP = YES
IMPLEMENTATION_DRIFT = NO
ACP_REQUIRED = YES
ARCHITECTURE_CLASSIFICATION = C_HISTORICAL_RETRY_TONE_POLICY_NOT_SPECIFIED

PRODUCT_CODE_CHANGE_THIS_ROUND = NO
AUDIT_STATUS = PASS

ONE_NEXT_OWNER = STAGE2_TONE_RELAXATION_ACP_OWNER
ONE_NEXT_DELTA = Prepare one narrow ACP for Model3-triggered bounded local Stage2 Tone-relaxed recall only
```

### Artifacts

1. `LINGUA_MODEL3_RETRY_STAGE2_TONE_CONSTRAINT_AUDIT.md` (this file)
2. `LINGUA_MODEL3_RETRY_STAGE2_TONE_CASE_MATRIX.csv`
3. `LINGUA_MODEL3_RETRY_STAGE2_TONE_COUNTERFACTUAL.json`
4. `LINGUA_MODEL3_RETRY_STAGE2_TONE_AUTHORITY_MATRIX.json`

**STOP.** No implementation.
