# MODEL3_TRAINING_DATASET_V1 Contract

**Status:** FROZEN (format audit 2026-08-23) · Synthetic V1 training identity sealed 2026-08-26  
**Schema:** `MODEL3_TRAINING_SAMPLE_V1_SCHEMA.json`  
**Parent:** `MODEL3_ARCHITECTURE_CONTRACT_V1.md`  
**Upstream (not identical):** `ERROR_TEXT_SAMPLE_V1`  
**Training SSOT:** `training/model3_dataset/configs/model3_v1_training_config.json`  
**Freeze doc:** `MODEL3_SYNTHETIC_V1_FROZEN.md`

---

## 1. Purpose

Define the **final offline training sample** consumed by Model3 baseline training (BiGRU / Tiny Transformer loaders).

```text
ERROR_TEXT_SAMPLE_V1
  + offline Domain Vote–equivalent Anchors
  + Model2 Anchor status (or UNAVAILABLE)
  + repairability probe
  + Model3 evidence + availability masks
  + KEEP | RETRY | MASKED | EXCLUDE labels
        ↓
MODEL3_TRAINING_SAMPLE_V1
```

`ERROR_TEXT_SAMPLE_V1` is **corruption / text provenance** only.  
It is **not** automatically a Model3 training row.

---

## 2. Training unit (frozen)

| Decision | Value |
|----------|--------|
| Unit | **One utterance-level span sequence** |
| Labels | **Per-span** `KEEP` / `RETRY` |
| Anchor loss | **MASKED** (`targetMask=0`, `label=MASKED`) |
| Independent orphan span rows as shard SSOT | **FORBIDDEN** (loader may flatten internally) |

Aligns with runtime: one Model3 inference per eligible path-local span sequence.

---

## 3. Evidence levels (same schema)

| Level | Audio | Acoustic / tone ASR | Typical use |
|-------|-------|---------------------|-------------|
| `SYNTHETIC_TEXT` | null | ABSENT / masks false | Current error-text path |
| `TTS_ASR` | required when available | AVAILABLE / PARTIAL | Future TTS→ASR |
| `HUMAN_ASR` | required when available | AVAILABLE / PARTIAL | Future human ASR |

**Forbidden:** invent Tone confidence / ASR confidence for `SYNTHETIC_TEXT`.

---

## 4. Top-level required fields

`schemaVersion`, `sampleId`, `sourceSampleId`, `sourceCorpus`, `evidenceLevel`,  
`referenceText`, `currentText`, `domainEvidence`, `model2AnchorStatus`,  
`spans[]`, `split`, `groupKeys`, `featureAvailability`, `provenance`

Optional: `audioRef`, `heldOutAxes`, `labelStats`

**Not copied wholesale from ERROR_TEXT:** full `corruptions[]` debug dumps, generator skip notes, duplicate provenance trees → **audit sidecar** only (`provenance.auditSidecarRef`).

---

## 5. Span required fields

`spanId`, `surface`, `rawStart`, `rawEnd`, `isAnchor`, `anchorSource`,  
`targetMask`, `label`, `pinyinEvidence`, `toneEvidence`, `acousticEvidence`,  
`pronunciationEvidence`, `recallEvidence`, `repairability`

Optional: syllable offsets, `referenceSurface`, `labelClass`

---

## 6. Anchor rules (unchanged architecture)

- Sources only: `DOMAIN` | `MODEL2` | `DOMAIN_AND_MODEL2` | `NONE`
- Domain Anchors: offline-equivalent of **retained SameDomain** membership — **not** “looks like a domain word”
- Model2 Anchors: only materialized evidence — **never forge** on synthetic text → `model2AnchorStatus=UNAVAILABLE`
- First synthetic ~100k may be **Domain-anchor primary** → **DATASET_LIMITATION**, not contract change

---

## 7. Labels

See `model3_training_label_materialization_contract.md`.  
Runtime output remains only `KEEP` | `RETRY` for `targetMask==1`.

---

## 8. Deprecation

Draft `model3_training_sample_schema_v1.json` (snake_case, incomplete evidenceLevel) is **superseded**.  
No `CONTRACT_CONFLICT` if loaders target `MODEL3_TRAINING_SAMPLE_V1` only.

---

## 9. Non-goals

- No Model3 runtime change  
- No 100k generation in format-audit phase  
- No JobResult fields  
- No KenLM / Assembly ownership shift  

---

## 10. Synthetic V1 training freeze (2026-08-26) + text-only role (same day)

Authoritative trainer: `train_full100k_strict_integration.py` via config SSOT only.

| Item | Frozen |
|------|--------|
| Objective | unweighted CE + PURE_MARGIN (λ=0.2, margin=0.25) |
| class_weight_retry | 1.0 · auto OFF · pair CE OFF |
| Sampling | STRICT 30% / Hard KEEP 30% / NATURAL 25% / NO_ANCHOR 15% |
| Strict | `STRICT_ANCHOR_CONTRAST_PAIR_V1` |
| Hard KEEP | `ANCHOR_CONDITIONED_HARD_KEEP_V1` |
| Feature plane | allowlist only — **ACOUSTIC model-visible = 0** |
| Checkpoint | `MODEL3_SYNTHETIC_V1` seed 2026082520 — do not overwrite |

`evidenceLevel` values `TTS_ASR` / `HUMAN_ASR` in the schema describe **sample provenance** (optional future text corpora from ASR roundtrips). They do **not** authorize Model3 to consume audio / Tone tensors. TTS is **not** a required Model3 V1 progression.

Next Model3 phase: `MODEL3_V1_RUNTIME_TEXT_PIPELINE_INTEGRATION_AUDIT`.
