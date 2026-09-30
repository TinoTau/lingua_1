# Model3 Stage2 Pre-Development Bundle

**Phase:** `MODEL3_BASE_CORPUS_CAPACITY_AND_STAGE2_PREDEVELOPMENT_AUDIT`  
**Date:** 2026-08-23  
**Companion data:** `model3_stage2_tables.csv` · `model3_stage2_offline_checks.json`  
**Schema:** `MODEL3_TRAINING_SAMPLE_V1` — **DO NOT CHANGE**

**Input:** `ERROR_TEXT_SAMPLE_V1` → **Output:** `MODEL3_TRAINING_SAMPLE_V1`

---

## A. Architecture

```text
ERROR_TEXT_SAMPLE_V1
  → span sequence materialization (offline FineSpan-equivalent harness)
  → offline Domain Vote + SameDomain (production functions)
  → Domain Anchor materialization
  → model2AnchorStatus (= UNAVAILABLE for synthetic-text v1)
  → repairability probe (recallSpanTopKV2 / recallTopKForWindows wrapper)
  → label materialization (KEEP|RETRY|MASKED|EXCLUDE)
  → featureAvailability masks
  → MODEL3_TRAINING_SAMPLE_V1 JSONL
```

Future package sketch:

```text
training/model3_dataset/materialize/
  span_materializer.*
  domain_anchor_adapter.*
  repairability_probe.*
  label_materializer.*
  feature_mask_builder.*
  writer / validate
```

Prefer **Node offline CLI** wrapping existing TS modules. Loader stays dumb. **No** production algorithm changes.

### Span

Reuse `runLatticeFineSpanGeneration` / PathFineSpan. Stable `spanId`, `rawStart`/`rawEnd`. Missing harness → `SPAN_MATERIALIZATION_GAP` (do not invent segmentation).

### Domain Anchor

Only retained SameDomain for `bucketDomain ∈ vote.retainedDomains`. Multi domains coexist. Not “has domain tag”.

### Model2

First synthetic batch: `UNAVAILABLE`. Forge forbidden.

---

## B. Offline Domain Anchor

| Step | Module |
|------|--------|
| Vote | `span-assembly-shared/utterance-domain-vote.ts` |
| SameDomain | `assemble-domain-aware-span-sets.ts` → `runDomainAwareAssembly` |

Python clone of Domain Vote: **FORBIDDEN**. Thin Node harness: **preferred**. Harness today: **MISSING**.

---

## C. Repairability / Retry Equivalence

```text
referenceSurface ∈ lexicon  ⇏  referenceReachable
```

Reuse: `recallSpanTopKV2`, `recallTopKForWindows` only. No Model3Lexicon / TrainingRetryRecallEngine.

Constraints: retainedDomains + base · existing caps · tone gates only when evidence exists · ACTIVE_SET is provenance not a wider Recall license.

Equivalence target: at least **PARTIAL** with documented delta; membership-only = **NO**.

`UNKNOWN` → `EXCLUDE_FROM_SUPERVISED`. No guessing.

---

## D. Label Materializer

Decision order:

1. Anchor → `MASKED` / `targetMask=0`  
2. Unstable / UNKNOWN reachable / missing evidence → `EXCLUDE_FROM_SUPERVISED`  
3. All RETRY criteria → `RETRY`  
4. Else → `KEEP` (classes A–E)

Machine table: `model3_stage2_tables.csv` section=`label_decision`.

---

## E. Development Checklist (future)

Preconditions: schema unchanged · no production Vote/Recall/FineSpan edits · harness plan reviewed.

Implement: span · domain adapter · Model2 UNAVAILABLE · repairability · labels · feature masks · writer/validate.

Labeled pilot **5k–10k** (not BiGRU, not 100k): Anchor RETRY=0 · RETRY⇒YES · split leakage=0 · no dialog_200 · loader consumes without re-label.

Gate to 100k: base≥15k **and** Stage2 complete **and** labeled pilot PASS.
