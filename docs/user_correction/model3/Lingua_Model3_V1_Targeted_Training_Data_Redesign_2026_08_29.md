# Lingua — Model3 V1 Targeted Training Data Redesign

**Phase:** MODEL3_V1_TARGETED_TRAINING_DATA_REDESIGN  
**Date:** 2026-08-29  
**Mode:** DESIGN / SSOT FREEZE ONLY  
**Production / training code / data / model modified:** NO

---

## MAIN VERDICT

| Field | Verdict |
|-------|---------|
| **Redesign verdict** | **REDESIGN_READY_FOR_IMPLEMENTATION** |
| **Architecture** | **FROZEN_ARCHITECTURE_STILL_VALID** |
| **Training execution gate** | **OPEN** (implementation may proceed after user review; **do not train in this phase**) |

Evidence basis: `MODEL3_V1_TRAINING_COVERAGE_AUDIT` (2026-08-29). P0 = label semantic drift; P1 = coverage gap + resulting KEEP bias.

---

## NEW LABEL CONTRACT

### KEEP

**Definition:** Current non-Anchor FineSpan interpretation is sufficiently plausible; no justified reason to invoke **one bounded local Retry**.

**Training classes → Model3 target `KEEP`:**

| Class | Include | Conditions |
|-------|---------|------------|
| `NON_ANCHOR_VALID_KEEP` | YES | `referenceSurface == surface`; or region-aligned reference matches surface |
| `ANCHOR_KEEP` | MASKED | `isAnchor == true` → `targetMask=0`, excluded from loss |
| `HARD_KEEP` | YES | Non-Anchor, surface plausible, near-homophone but reference confirms current reading, unusual-but-valid domain text, Anchor-adjacent valid text |
| `UNREPAIRABLE_KEEP` | YES | Bounded local Retry structurally cannot help (deletion gap, out-of-scope, orthographic-only 的/地/得) |
| `AMBIGUOUS_EXCLUDE` | **NO** | Insufficient evidence → **EXCLUDE**, not silent KEEP |

**Forbidden for KEEP:** labeling uncertain mismatches as KEEP merely to avoid RETRY contamination.

### RETRY

**Definition:** Current non-Anchor FineSpan interpretation is **suspicious**, and **one bounded local Retry operation** is structurally applicable to reinterpret the **local region**.

**Training question:** *Should local reinterpretation be triggered here?*  
**NOT:** *Can this exact FineSpan independently Recall the reference?*

**Training class → Model3 target `RETRY`:**

| Class | Include | Required evidence |
|-------|---------|-------------------|
| `NON_ANCHOR_ERROR_RETRY` | YES | Non-Anchor; inside training `malformedRegion`; surface ≠ region-aligned reference projection; bounded Retry applicable; not deletion/no-target; not Anchor-blocked |

**Forbidden for RETRY:** requiring exact-span `referenceReachable == YES`; requiring exact-span phonetic recallability.

### EXCLUDE

| Class | Final disposition |
|-------|-------------------|
| `ANCHOR_KEEP` | MASKED (`targetMask=0`) |
| `AMBIGUOUS_EXCLUDE` | `EXCLUDE_FROM_SUPERVISED` |
| `UNREPAIRABLE_EXCLUDE` | `EXCLUDE_FROM_SUPERVISED` when reference/region alignment unknown and Retry not structurally applicable |

---

## OLD VS NEW SEMANTICS

| Dimension | OLD (V1) | NEW (V2 contract) |
|-----------|----------|-------------------|
| RETRY meaning | Exact span phonetically repairable via Recall | Local interpretation suspicious → bounded region Retry |
| RETRY gates | `phoneticCompatible && referenceReachable==YES && ref≠surface` | Region projection + structural Retry applicability |
| Multi-char error | MULTI_CHAR metadata but 1-char FineSpan; often KEEP when span unreachable | Region-level RETRY on overlapping 1-char FineSpans |
| Ambiguous | Often defaulted to KEEP class B | **EXCLUDE**, not KEEP |
| Anchor | MASKED | unchanged |
| Runtime Model3 | unchanged | unchanged |

---

## REGION → FINESPAN LABEL PROJECTION

**Principle:** Multi-character malformed **regions** are a training-supervision concept. Runtime FineSpan may remain 1-char (e.g. `顺|便|向|木|李`). **Do not** change FineSpan generation.

### Step 1 — Determine `malformedRegion` (training-only)

From `(referenceText, currentText, corruption metadata)`:

1. Align reference ↔ current (char-level diff or corruption `spanStart/spanEnd`).
2. Expand to contiguous **error region** `[regionStart, regionEnd)` covering all reference mismatches for the corruption cluster.
3. Stop expansion at Anchor char ranges (training materialized Anchors).
4. Attach `corruptionFamily`, `ERROR_SHAPE`, phonetic/tone flags as **metadata only**.

### Step 2 — Project onto existing FineSpans

For each FineSpan `s` in harness materialization:

| Condition | Label |
|-----------|-------|
| `s.isAnchor` | MASKED |
| `s` overlaps `malformedRegion` AND aligned `referenceSurface(s) ≠ s.surface` | **RETRY** |
| `s` overlaps region but aligned reference matches surface | KEEP |
| `s` outside region, non-Anchor | KEEP |
| overlap region but deletion / no structural Retry path | UNREPAIRABLE_KEEP or EXCLUDE |

**Aligned reference for span:** prefer corruption `referenceSurface` if span overlaps corruption bounds; else `referenceText[rawStart:rawEnd]` when lengths align.

### Step 3 — Anchor boundaries

- Anchors stop region expansion and never receive RETRY.
- KEEP neighbors outside region remain KEEP (hard negative).

### Step 4 — Adjacent RETRY

Multiple RETRY labels inside one region are **allowed** when each overlapping FineSpan is individually suspicious. Runtime Retry consumer deduplicates region activation.

---

## RETRY TRIGGER DENSITY

**Policy:** `REGION_BOUNDED_FULL_COVERAGE`

| Option | Assessment |
|--------|------------|
| A — all suspicious FineSpans in region | **Selected (bounded by region, not utterance)** |
| B — minimal single trigger | Rejected: weak recall if runtime evaluates a different suspicious span in same region |
| C — utterance-wide RETRY | Rejected: causes false-RETRY risk |

**Rule:** Label **RETRY** for every non-Anchor FineSpan inside `malformedRegion` whose aligned reference projection differs from surface. Require ≥1 RETRY per malformed region sample. Do **not** label all FineSpans in a bad utterance.

**Reason:** Model3 evaluates each existing FineSpan independently; region Retry activates from any trigger; full in-region coverage teaches suspicion without utterance-wide spam.

---

## phoneticCompatible

| | |
|--|--|
| **Old role** | Hard RETRY label gate |
| **New role** | **DEMOTE_TO_SAMPLE_EVIDENCE** |

Stored on span/sample for family tagging (`PHONETIC_SUBSTITUTION`, `TONE`, etc.) and synthetic QC. **Not** required for RETRY label. Prevents silent redefinition of RETRY as exact-span phonetic repairability.

---

## referenceReachable

| | |
|--|--|
| **Old role** | Hard gate: `referenceReachable == YES` required for RETRY |
| **New role** | **RETIRE_FROM_RETRY_LABEL** |

Retained as **diagnostic metadata** (`repairability.referenceReachable`) for sample-family classification and audits. Replaced for labeling by **`regionRetryApplicable`** (NEW training-only helper): YES if bounded local Retry could structurally reinterpret the region containing the span (offline structural check, not exact-span Recall hit).

`validate_sample` rule `retry_without_yes` must be **retired** under V2 contract.

---

## UNREPAIRABLE / AMBIGUOUS

| Family | Treatment | Model3 target |
|--------|-----------|---------------|
| Deletion, no FineSpan gap | UNREPAIRABLE_KEEP or EXCLUDE | KEEP if neighbor span exists; else EXCLUDE |
| Error outside Model3 (NMT/TTS/semantic-only) | UNREPAIRABLE_EXCLUDE | EXCLUDE |
| Anchor-protected reference error | ANCHOR_KEEP | MASKED |
| Reference ambiguous (multiple valid readings) | AMBIGUOUS_EXCLUDE | EXCLUDE |
| Orthographic 的/地/得 only | UNREPAIRABLE_KEEP | KEEP |
| Bounded Retry structurally cannot help | UNREPAIRABLE_KEEP | KEEP |

---

## TRAINING SAMPLE FAMILIES

See `model3_training_dataset_v2_blueprint.csv`. Summary:

| ID | Family | Share (train eligible) |
|----|--------|------------------------|
| A | CLEAN KEEP | 55–62% |
| B | PHONETIC LOCAL RETRY | 8–12% |
| C | TONE-RELATED LOCAL RETRY | 3–5% |
| D | MULTI-CHAR MALFORMED REGION RETRY | 10–14% |
| E | ANCHOR-ADJACENT RETRY | 4–6% |
| F | HARD KEEP | 12–16% |
| G | UNREPAIRABLE / OUT-OF-SCOPE | 2–4% (mostly EXCLUDE) |
| H | REAL-ASR-LIKE PROBE | 5–8% (held-out + train mix) |

---

## FINESPAN DISTRIBUTION

| | Current training | Runtime dialog_200 | **TARGET (V2)** |
|--|------------------|--------------------|-----------------|
| 1-char | ~100% | ~97% | **94–98%** |
| 2-char | 0% | ~3% | **2–5%** |
| 3+ char | 0% | 0% on Model3 rows | **0–1%** (only if production FineSpan naturally emits) |

Primary gap = **region semantics**, not forcing multi-char FineSpans.

---

## CLASS BALANCE

| | Value |
|--|-------|
| **Current (eligible)** | KEEP ~98.5% / RETRY ~1.45% |
| **Estimated after V2 relabel (eligible spans)** | KEEP **~92–96%** / RETRY **~4–8%** |
| **Estimated after family sampling (batch exposure)** | RETRY **~8–15%** per sampled batch |

**Recommended strategy:** **BOTH**

1. **SAMPLING_REBALANCE** — family quotas ensure RETRY families appear every epoch.  
2. **CLASS_WEIGHTING** — modest `class_weight_retry` (e.g. 2–4×) **only after** V2 relabel baseline measured; not 50/50.

Evaluation may stratify RETRY recall separately; train/eval distributions may differ.

---

## REAL HELD-OUT EVAL — MODEL3_REAL_RETRY_EVAL_V1

**Purpose:** Gate future checkpoints; **not** training data.

| Bucket | Content | Min cases |
|--------|---------|-----------|
| R-REAL-HIGH | dialog_200 audit HIGH RETRY-eligible (13) | 13 |
| R-REAL-KEEP | dialog_200 exact-match + hard KEEP | ≥10 |
| R-REGION | Multi-char malformed region (incl. d160/d142/d179 patterns) | ≥8 |
| R-ANCH-ADJ | Anchor-adjacent RETRY | ≥6 |
| R-LEN2 | Existing 2-char FineSpan cases | ≥4 |
| R-FALSE-RETRY | Valid unusual text that must KEEP | ≥12 |
| R-OUT-SCOPE | Deletion / out-of-scope controls | ≥6 |
| R-UNKNOWN-HOLD | 31 UNKNOWN dialog_200 (unlabeled until classified) | 31 inventory |

**Split policy:** All dialog_200 case IDs **held out** from V2 training by `heldOutAxes: REAL_MAINLINE_EVAL`. Synthetic generator must exclude dialog_200 base pool (already enforced).

**Build phase:** `MODEL3_V1_REAL_RETRY_EVAL_SET_BUILD` (inventory only in this phase).

### UNKNOWN dialog_200 classification procedure (~31)

Later eval expansion only. **Do not** auto-label all RETRY or all KEEP.

| Outcome | Required evidence | Forbidden |
|---------|-------------------|-----------|
| **HIGH RETRY** | Non-Anchor FineSpan covers mismatch; `malformedRegion` identifiable; bounded Retry structurally applicable; reference unambiguous; confidence HIGH | Exact-span Recall hit not required |
| **HIGH KEEP** | Reference confirms current surface **or** mismatch is orthographic/unrepairable with clear KEEP rationale; no justified Retry | Using “uncertain → KEEP” |
| **OUT_OF_SCOPE** | Deletion/no FineSpan target; NMT/semantic-only rewrite; Anchor-protected; Model3 ownership does not apply | Forcing RETRY to “fix” eval |
| **AMBIGUOUS** | Competing valid readings; weak reference; incomplete FineSpan coverage | Silent KEEP or silent RETRY |

Procedure: start from `model3_real_retry_target_inventory.csv` UNKNOWN rows → attach FineSpan/Anchor/region evidence → assign one of four outcomes → promote HIGH rows into `MODEL3_REAL_RETRY_EVAL_V1` buckets; leave AMBIGUOUS in R-UNKNOWN-HOLD.

---

## TTS / TEXT-ONLY

Model3 remains **text-only** post-ASR (`MODEL3_V1_TEXT_ONLY_ROLE_FREEZE_CORRECTION`).  
Historical TTS/audio training assumptions are **historical drift** — **do not revive**. No audio features in V2 dataset redesign.

---

## SYNTHETIC + REAL VALIDATION

Future acceptance requires **both**:

1. **SYNTHETIC_VALIDATION** — regression on V2 dev/test (confusion, RETRY P/R).  
2. **REAL_HELD_OUT_VALIDATION** — `MODEL3_REAL_RETRY_EVAL_V1` activation + false-RETRY rate.

Perfect synthetic F1 alone **must not** freeze a checkpoint (V1 lesson).

---

## FUTURE ACCEPTANCE METRICS

| Metric | Role | Threshold |
|--------|------|-----------|
| KEEP precision / recall | Safety | THRESHOLD_TO_BE_CALIBRATED_FROM_BASELINE |
| RETRY precision | False trigger control | THRESHOLD_TO_BE_CALIBRATED_FROM_BASELINE |
| RETRY recall (real held-out) | Primary success | THRESHOLD_TO_BE_CALIBRATED_FROM_BASELINE |
| RETRY F1 (synthetic) | Regression only | not sole gate |
| Real RETRY activation rate | Mainline sanity | compare to eligible target rate |
| FALSE_RETRY_RATE | on R-FALSE-RETRY bucket | THRESHOLD_TO_BE_CALIBRATED_FROM_BASELINE |
| Anchor safety | Anchor spans never RETRY | 100% |
| Model3 latency | non-regression | existing budget |

Baseline calibration run on V1 checkpoint vs V2 post-train comparison harness.

---

## LABEL PIPELINE CHANGE INVENTORY

| File | Function | Current | Required future | Change |
|------|----------|---------|-----------------|--------|
| `stage2_common.py` | `label_spans` | RETRY if phonetic+reach YES | Region projection + `regionRetryApplicable` | MODIFY |
| `stage2_common.py` | `validate_sample` | `retry_without_yes` | Remove; add region RETRY validation | MODIFY |
| `stage2_common.py` | — | — | `project_malformed_region`, `regionRetryApplicable` | NEW_TRAINING_ONLY_HELPER |
| `offline_harness/stage2_materialize.cjs` | span loop | Sets per-span referenceSurface | Emit `malformedRegion` sidecar optional | MODIFY (metadata only) |
| `run_v1_synthetic_100k.py` | generation | Old label path | Call V2 label contract | MODIFY |
| `run_real_distribution_retry_pilot.py` | quotas | MULTI_CHAR → old labels | V2 region families | MODIFY |
| `finalize_real_distribution_retry_pilot_reports.py` | reports | phonetic RETRY contract text | V2 SSOT text | MODIFY |
| `qa_v1_dataset.py` | QA | V1 rules | V2 rules | MODIFY |
| `model3_v1_training_config.json` | gates | strict_keep_retry_ratio | V2 ratio targets | MODIFY (post-baseline) |

Runtime Model3 / feature pack: **KEEP** (no change).

---

## DATA REGENERATION SCOPE

**Verdict:** **PARTIALLY_REGENERATED**

| Path | Action |
|------|--------|
| Existing Full100K / pilot JSONL | **RELABEL** via V2 projection (referenceText, corruptions, spans retained) |
| Malformed-region + hard-KEEP gaps | **PARTIAL REGENERATION** new samples |
| Semantically wrong V1 RETRY (exact-span-only) | **Retire** from train; keep in audit shard |
| Full wipe | **Not required** — source metadata sufficient |

---

## OLD MODEL STATUS

**KEEP_AS_BASELINE** — `MODEL3_SYNTHETIC_V1` / seed `2026082520` unchanged until V2 accepted.

---

## HARNESS DEBT

**HARNESS_STATE_RESTORE_DEBT** — `ensureServicePreferencesForAcceptance()` persistent write to `%APPDATA%/lingua-electron-node/electron-node-config.json`. Separate minimal harness cleanup; **not** mixed into this redesign.

---

## ARCHITECTURE GOVERNANCE

Model3 / FineSpan / Retry / Recall / Lattice / Anchor / Domain Vote / Model2 / Assembly / JobResult: **NO change**.

---

## GATES

Phase start: `TRAINING_EXECUTION_GATE = HOLD`.  
Phase end: all SSOT items below frozen → gate may open for **next** phase only.

| Gate | Status |
|------|--------|
| ARCHITECTURE_TRAINING_GATE | **OPEN** |
| DEVELOPMENT_SEQUENCE_GATE | **OPEN** |
| TRAINING_EXECUTION_GATE | **OPEN** (next implementation phase after user review; **no training this phase**) |

Frozen checklist for OPEN: KEEP/RETRY/EXCLUDE semantics; region→FineSpan projection; phoneticCompatible/referenceReachable roles; ambiguous handling; sample families; class-balance strategy; real held-out eval; acceptance metrics; code inventory; regeneration scope.

---

## NEXT PHASE

**MODEL3_V1_TRAINING_DATA_REDESIGN_IMPLEMENTATION**

Do not execute in this phase.

---

## CHECKLIST

- [x] no production / training code / data / model modified  
- [x] KEEP / RETRY / EXCLUDE semantics frozen  
- [x] region→FineSpan projection frozen  
- [x] multi-char region ≠ multi-char FineSpan  
- [x] phoneticCompatible → DEMOTE_TO_SAMPLE_EVIDENCE  
- [x] referenceReachable → RETIRE_FROM_RETRY_LABEL  
- [x] ambiguous → EXCLUDE not silent KEEP  
- [x] sample families + balance + real eval designed  
- [x] label pipeline inventory + regeneration scope  
- [x] old checkpoint preserved  

---

## Artifacts

1. This report  
2. `model3_label_contract_v1.csv`  
3. `model3_training_dataset_v2_blueprint.csv`  
4. `model3_training_redesign_summary.json`  
5. `model3_training_redesign_governance.json`
