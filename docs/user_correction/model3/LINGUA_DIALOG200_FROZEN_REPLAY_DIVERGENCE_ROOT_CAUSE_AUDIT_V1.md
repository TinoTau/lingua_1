# Lingua1 — Dialog200 Frozen Evidence Replay Divergence Root-Cause Audit V1

**Mode:** READ_ONLY / TRACE_FIRST / CONTRACT_FIRST / NO_IMPLEMENTATION  
**Scope:** Replay equivalence only (Frozen Evidence SSOT replacement not reopened)  
**Inputs:** `DIALOG200_FROZEN_EVIDENCE_REPLAY_V1_VALIDATION.json`, replay contract, capture jsonl, production path enum, `EVALUATION_SSOT_V1.md`

---

## Executive Verdict

Replay equivalence is **not proven**. Prior RESULT A (`REPLAY EQUIVALENT — SSOT REPLACEMENT COMPLETE`) was granted by a **newly introduced approximate-rate promotion gate**, not by a frozen exact-final contract. Seven E18 finals diverge with first divergence at path structure (E7/E6). Path enumeration is **deterministic given identical edges**; labeling E6/E7 as `EXPECTED_NONDETERMINISM` is an **evaluator assumption**, not a frozen production authority.

**FINAL DECISION: G — MULTIPLE_INDEPENDENT_ROOT_CAUSES**  
**NEXT OWNER: FURTHER_DIVERGENCE_AUDIT**  
**TRUSTED_DIALOG200_FUNNEL_V2: NOT SAFE TO START**

---

## 1. Equivalence Contract Audit (Q1–Q5)

### Where defined

| Concept | Location |
|---------|----------|
| `decidePromotion` / RESULT A / `REPLAY_EQUIVALENT_SSOT_READY` | `tests/lib/dialog200-frozen-evidence-replay-contract.mjs` `decidePromotion` |
| `criticalFail` | same file `compareCaptureReplay` — E1/E2/E18/PROFILE |
| E18 / E7 acceptance rates | `e18Rate = e18Pass/caseCount`, `e7Rate = e7Pass/caseCount` |
| Promotion thresholds | `e18Rate < 0.95` OR `criticalRate > 0.05` → reject; `e7Rate < 0.8` → reject; else promote A |
| `classifyDivergence` / `EXPECTED_NONDETERMINISM` | same file — E6/E7 → EXPECTED_NONDETERMINISM **iff E18 PASS** |

### Q1 — What allowed 193/200 → REPLAY_EQUIVALENT?

`decidePromotion`: with identity OK, inject OK, `e18Rate=0.965 ≥ 0.95`, `criticalRate=0.035 ≤ 0.05`, `e7Rate=0.825 ≥ 0.8` → `{ promote:true, result:'A', reason:'REPLAY_EQUIVALENT_SSOT_READY' }`.

### Q2 — Threshold authority?

**EQUIVALENCE_THRESHOLD_AUTHORITY = NEW_REPLAY_IMPLEMENTATION**

Not in `EVALUATION_SSOT_V1`. Not a pre-existing frozen Dialog200 replay contract.

### Q3 — Introduced during Frozen Evidence Replay V1?

**YES.** File: `dialog200-frozen-evidence-replay-contract.mjs`, symbol: `decidePromotion`, thresholds `0.95` / `0.05` / `0.8`. Rationale in-code comment only: soft path-count divergence “acceptable if bounded.”

### Q4 — Does EVALUATION_SSOT_V1 authorize approximate FINAL replay equivalence?

**NO.** Quote (concepts / capability):

> `FINAL_OUTPUT | EVALUABLE`  
> `FAIL | Contract applicable, evidence sufficient, behavior violates Frozen contract`  
> `Forbidden: missing evidence → FAIL`

No clause authorizes 96.5% final match as equivalence. No approximate-rate replay gate.

### Q5 — SSOT promotion vs Replay equivalence?

**Incorrectly coupled.** One function (`decidePromotion`) both:

1. Declares `REPLAY_EQUIVALENT_SSOT_READY`
2. Drives `promote: true` / RESULT A / SSOT replacement

They are not separate gates in implementation.

---

## 2. Seven E18 Final Divergences

| Case | Capture Final (abbrev) | Replay Final (abbrev) | First Divergence | Root Cause | Final Impact | Confidence |
|------|------------------------|-----------------------|------------------|------------|--------------|------------|
| d019 | …后选…上限… | …候选…上限… | E7 8→4 | E / UNEXPLAINED | YES | STRONG |
| d045 | …上线…上线… | …上限…上限… | E7 1→2 | E / UNEXPLAINED | YES | STRONG |
| d061 | …天气预报…带水 | …其余…记得水 | E7 3→2 | E / UNEXPLAINED | YES | STRONG |
| d110 | …商线激化…后选… | …上线计划…候选… | E7 8→6 | E / UNEXPLAINED | YES | STRONG |
| d112 | …定单… | …订单… | E7 2→1 | E / UNEXPLAINED | YES | STRONG |
| d156 | …县级画文档… | …限集画文当… | E7 2→1 | E / UNEXPLAINED | YES | STRONG |
| d157 | …耽误… | …但物流… | E6 path_id (count 2=2); E3 also FAIL | E / UNEXPLAINED (+ comparator order) | YES | STRONG |

Full per-case trace fields: `LINGUA_DIALOG200_FROZEN_REPLAY_DIVERGENCE_CASE_MATRIX_V1.json`.

**Causal rule applied:** first recorded divergence owns attribution; later FAIL_SECONDARY treated as cascade. For d157, comparator order lists E6 before E3 even though E3 also fails independently — noted as comparator artifact; true pipeline-first candidate is likely E3.

---

## 3. Root-Cause Matrix

| Root Cause | Cases | First Stage | Final Impact | Failure Class | Evidence Strength |
|------------|------:|-------------|--------------|---------------|------------------|
| Equivalence contract / promotion coupling (0.95/0.05/0.8) | 200 | PROMOTION | YES (false RESULT A) | TEST / EVALUATOR DEFECT | PROVEN |
| `EXPECTED_NONDETERMINISM` without frozen authority | 54 | E6/E7 | NO (finals match) | TEST / EVALUATOR DEFECT | PROVEN |
| E5/E8 vacuous (`finespans`≠`fine_spans`) | 200 | E5/E8 | NO (hides structure) | OBSERVABILITY GAP | PROVEN |
| E16 NOT_CAPTURED but E17 scored | 200 | E16/E17 | UNKNOWN | TEST / EVALUATOR DEFECT | PROVEN |
| Capture full-audio vs mock inject → path/final delta | 7 | E7/E6 | YES | ARCHITECTURE GAP / CONFLICT | STRONG |
| E3 set delta at equal pathCount | 8 | E3 | NO | OBSERVABILITY GAP | PARTIAL |

---

## 4. Base Recall (E3)

- **30** primary FAIL + **32** FAIL_SECONDARY (secondary to E7).
- **8** first-divergence at E3 with **E7 PASS** and **E18 PASS** (d046,d059,d091,d102,d135,d150,d151,d188).
- Utterance recall cache is **per-utterance** (not process-global).
- Lexicon SQL generally has `ORDER BY`; not proven as E3 root cause.
- Compact stores `.slice(0, 48)` surfaces — order-dependent truncation can create false set diffs; some E3 cases also show unequal raw counts (real delta).
- **Cannot** classify Base Recall mismatch as contract-authorized nondeterminism.
- Under identical query+DB+function, divergence is **UNEXPLAINED** until inject-boundary inputs (tone windows, domain scope, truncation) are isolated.

---

## 5. Model2 (E4)

- Identity SHA guarded; PROFILE_MODE NO_PROFILE preserved (200/200).
- E4 FAILs largely cascade from path-count or co-travel with E3.
- No bit-exact GPU determinism proof.
- Classification for independent E4: **INSUFFICIENT** to call MODEL_INFERENCE_NONDETERMINISM; prefer **INPUT_STATE_DIFFERENCE / UNEXPLAINED** pending deeper trace.

---

## 6. SegmentationPath / Path Count (E6/E7)

Production structural comparator **verified** in `enumerate-complete-segmentation-paths.ts` (fallback↑, invalid↑, fuzzy↑, toneRelaxed↑, exact↓, lexical↓, boundaryKey↑). Outgoing edges re-sorted; kept paths sorted by boundaryKey.

**Conclusion:** Path generation is **deterministic under identical lexical edges + caps**. Therefore:

- E7 mismatch ⇒ **upstream edge/candidate graph difference** (or missing frozen mid-state), **not** path-enum lottery.
- Path count difference is **not harmless** — 6/7 E18 fails first-diverge at E7; cascades Domain Vote → Assembly → KenLM → Final.
- Frozen contract does **not** authorize path-count soft-fail.

**NONDETERMINISM_AUTHORITY = EVALUATOR_ASSUMPTION** for prior `EXPECTED_NONDETERMINISM` labels.

---

## 7. Model3 / E16–E17 (Q6–Q9)

| Q | Answer |
|---|--------|
| Q6 Can E17 be proven without E16? | **NO** |
| Q7 Does Replay reconstruct E16 deterministically? | **NOT PROVEN** (decisions compared; input/anchor not captured) |
| Q8 Evidence chain? | **Broken** — capture compact omits full Model3 input/anchor geometry |
| Q9 E17 status under EVALUATION_SSOT_V1? | Should be **NOT_EVALUABLE**, not FAIL/PASS |

---

## 8. Capture Completeness

| Field | Class |
|-------|-------|
| ASR text / segments / tone slices | RECONSTRUCTABLE (injected) |
| Model/lexicon/kenlm SHA | RECONSTRUCTABLE |
| Production `finespans` | **REQUIRED_BUT_MISSING** (harness key `fine_spans`) → OBSERVABILITY GAP |
| E16 Model3 input/anchor | **REQUIRED_BUT_MISSING** → REPLAY CONTRACT GAP for E17 |
| Untruncated base/Model2 lists | **REQUIRED_BUT_MISSING** for strict E3/E4 |
| Lexical edge graph | NOT_REQUIRED if candidates+config identical (currently not reproducing) |

---

## 9. Global Reclassification (prior first-divergence)

| Prior | Count | After |
|-------|------:|-------|
| E7:EXPECTED_NONDETERMINISM | 29 | UNEXPLAINED_DIVERGENCE |
| E6:EXPECTED_NONDETERMINISM | 25 | UNEXPLAINED_DIVERGENCE |
| E7:PRODUCTION_STATE_DEPENDENCY | 6 | UNEXPLAINED_DIVERGENCE (entrypoint; no concrete singleton proven) |
| E6:PRODUCTION_STATE_DEPENDENCY | 1 | UNEXPLAINED_DIVERGENCE |
| E3:PRODUCTION_STATE_DEPENDENCY | 8 | UNEXPLAINED_DIVERGENCE |
| E17:PRODUCTION_STATE_DEPENDENCY | 1 | COMPARATOR_DEFECT (E16 missing) |

| After class | Count |
|-------------|------:|
| CONTRACT_AUTHORIZED_NONDETERMINISM | **0** |
| SEMANTICALLY_IRRELEVANT_ORDERING | **0** |
| PRODUCTION_NONDETERMINISM | **0** |
| UNEXPLAINED_DIVERGENCE | **70** (all prior first-divergence rows) |

---

## 10. Mandatory Questions (Q1–Q20)

| # | Answer |
|---|--------|
| Q1 | `decidePromotion` with e18≥0.95, critical≤0.05, e7≥0.8 → RESULT A |
| Q2 | **NEW_REPLAY_IMPLEMENTATION** (unsupported by frozen SSOT) |
| Q3 | **Incorrectly coupled** in `decidePromotion` |
| Q4 | See seven-case matrix (all E7 except d157→E6; all UNEXPLAINED under entrypoint delta) |
| Q5 | Equal pathCount still shows set deltas; truncation possible; no proof of legal nondeterminism; entrypoint/state gap STRONG for path-linked cases |
| Q6 | **None** contract-authorized |
| Q7 | **None proven**; path enum itself is deterministic |
| Q8 | E5/E8 vacuous; E16/E17 scoring; EXPECTED_NONDETERMINISM label; promotion thresholds; firstDivergence order |
| Q9 | Mid-lattice / edge inputs not frozen beyond ASR+Tone; finespans mis-captured; E16 missing |
| Q10 | Resolved to **CAPTURE_FULL_AUDIO_VS_MOCK_INJECT_ENTRYPOINT** / upstream edge delta — not a named production singleton |
| Q11 | **YES**, given identical edges |
| Q12 | **YES** — exact reproduce expected |
| Q13 | **NO** — E17 should be NOT_EVALUABLE |
| Q14 | **NO** — not enough to reproduce all behavior to Final |
| Q15 | Yes: finespans, E16 anchors/inputs, untruncated candidate sets; possibly other mid-state |
| Q16 | **No production defect proven** (path enum OK; divergence upstream/unexplained) |
| Q17 | **YES (STRONG)** — capture full-audio vs mock-inject claimed equivalent boundary but finals/paths diverge |
| Q18 | **YES (PROVEN)** — thresholds, labels, E5/E8, E17 |
| Q19 | **NO** |
| Q20 | **NO** |

---

## 11. Final Decision

**G. MULTIPLE_INDEPENDENT_ROOT_CAUSES**

Independent proven/strong causes:

1. Equivalence / promotion contract defect  
2. Comparator / observability defects (E5/E8/E16–E17/labels)  
3. Capture↔Replay entrypoint behavioral divergence affecting Final (7 cases) — mechanism not fully isolated → remains UNEXPLAINED for bit-level cause

Not A/B: pass-rate alone does not prove equivalence; contract does not cover remaining behavioral diffs.

---

## 12. Next Owner

**FURTHER_DIVERGENCE_AUDIT**

Isolate exact upstream delta (edge graph / recall query keys / domain scope / truncation vs real set) on the seven E18 cases under frozen inject. Do **not** start TRUSTED_DIALOG200_FUNNEL_V2. Comparator/contract repair is also required before any future equivalence claim, but funnel gating fails first on unproven behavioral replay.

---

## 13. Artifacts

1. This report  
2. `LINGUA_DIALOG200_FROZEN_REPLAY_DIVERGENCE_CASE_MATRIX_V1.json`  
3. `LINGUA_DIALOG200_FROZEN_REPLAY_DETERMINISM_AUDIT_V1.json`

**No production / replay / evaluator / SSOT / baseline / ASR changes were made.**
