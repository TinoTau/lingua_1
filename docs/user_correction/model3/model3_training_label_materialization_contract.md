# Model3 Training Label Materialization Contract

**Status:** FROZEN (format audit 2026-08-23)  
**Parent:** `model3_training_label_contract_v1.md` + `MODEL3_TRAINING_DATASET_V1_CONTRACT.md`

---

## 1. Critical rule (unchanged)

```text
currentText ≠ referenceText  ⇏  RETRY
ERROR_TEXT expectedRepairClass ≠ Model3 label
```

Stage2 **label materializer** owns KEEP / RETRY / EXCLUDE.  
Error-text generator only supplies candidates + reachability hints.

---

## 2. Span label enum (training sample)

| Label | `targetMask` | Loss |
|-------|--------------|------|
| `RETRY` | 1 | supervised |
| `KEEP` | 1 | supervised |
| `MASKED` | 0 | ignore (Anchors) |
| `EXCLUDE_FROM_SUPERVISED` | 0 | ignore (unknown / unreliable) |

**Forbidden:** train Anchors as KEEP.  
Runtime Anchor action remains forced KEEP; training uses MASKED / IGNORE_INDEX.

---

## 3. RETRY (all required)

1. `isAnchor == false` and span eligible (`targetMask` would be 1).  
2. Aligned `surface` / first-pass ≠ `referenceSurface` on that span (alignment artifact; not sole `indexOf`).  
3. Error class compatible with pronunciation / accent / tone / phonetic confusion under allowed families.  
4. `repairability.referenceReachable == YES` under **allowed retry Recall policy** (see §5).  
5. Retry does **not** require Anchor mutation.  
6. Domain / Model2 Anchors elsewhere on the utterance remain fixed.

If any criterion fails → not RETRY.

---

## 4. KEEP (supervised negatives / corrects)

| Class | Meaning |
|-------|---------|
| A | Non-anchor already matches reference |
| B | Incorrect but non-repairable under Model3 retry policy |
| C | Would require Anchor change |
| D | Reference not reachable under allowed Recall |
| E | Rare / odd phrasing but should KEEP (hard negative vs local-LM) — prefer acoustic-backed when available; on SYNTHETIC_TEXT use orthographic / unreachable phonetic / NON_PHONETIC tracks |

CLEAN error-text rows → typically all non-anchor KEEP (class A) + MASKED anchors.

---

## 5. Repairability probe (authoritative)

**Forbidden:** `reference ∈ lexicon` alone ⇒ reachable.

**Required probe:** offline **read-only equivalent** of retry Recall policy:

1. Reuse APIs / offline mirrors of `recallSpanTopKV2` and/or `recallTopKForWindows` (subset).  
2. Bound to `domainEvidence.retainedDomains` + SameDomain preference + base lexicon.  
3. Apply existing tone / length gates as available; if tone acoustic ABSENT, do not invent relaxation — record probe limitations.  
4. Reference candidate must appear in the allowed candidate universe for that span under those constraints.

Record:

```text
repairability.referenceReachable ∈ { YES, NO, UNKNOWN }
repairability.probe ∈ { OFFLINE_RECALL_EQUIVALENT, RUNTIME_RECALL, NOT_RUN }
```

If probe cannot run reliably → `UNKNOWN` → **EXCLUDE_FROM_SUPERVISED** for that span (do not guess KEEP/RETRY).

---

## 6. UNKNOWN / EXCLUDE

When alignment unstable, polyphony unresolved, Domain Anchor materialization unavailable for a required positive, or reachability UNKNOWN:

```text
label = EXCLUDE_FROM_SUPERVISED
targetMask = 0
```

Do not force quota fills with guessed RETRY.

---

## 7. Transformation checklist (ERROR_TEXT → TRAINING)

| Step | Action |
|------|--------|
| 1 | Build span sequence over `currentText` with stable `spanId` / offsets |
| 2 | Materialize Domain Anchors via offline Domain Vote + SameDomain equivalent |
| 3 | Set `model2AnchorStatus`; never invent MODEL2 anchors |
| 4 | Run repairability probe per corrupted / candidate span |
| 5 | Assign KEEP / RETRY / MASKED / EXCLUDE |
| 6 | Set `featureAvailability` for evidenceLevel |
| 7 | Drop heavy corruptions[] to audit sidecar |
| 8 | Preserve `groupKeys` for group split |

---

## 8. Acceptance for labeled shards

- 100% schema  
- 0 Anchor with `label=RETRY`  
- 0 RETRY with `referenceReachable != YES`  
- 0 RETRY with `isAnchor=true`  
- EXCLUDE rate reported (not silently dropped without count)  
