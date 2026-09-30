# Model3 Training Loader Contract

**Status:** FROZEN (format audit 2026-08-23)  
**Consumes:** `MODEL3_TRAINING_SAMPLE_V1` JSONL shards

---

## 1. Compatibility

| Model | Compatible |
|-------|------------|
| Small BiGRU + span head (baseline) | **YES** |
| Tiny Transformer Encoder (comparison) | **YES** |
| Schema coupled to one architecture | **NO** |

Loader may differ; **shard schema must not**.

---

## 2. Required tensors / structures (conceptual)

From one sample:

| Structure | Source |
|-----------|--------|
| Span sequence length N | `len(spans)` |
| Surface / token ids (optional) | `spans[].surface` + shared vocab / char encoder (train package choice) |
| Feature vectors per span | packed from pinyin / tone / acoustic / Model2 / recall **only where available** |
| `feature_avail_mask` | from `featureAvailability` (+ per-span status) |
| `anchor_mask` | `spans[].isAnchor` |
| `target_mask` | `spans[].targetMask` |
| `y` labels | map `KEEP→0`, `RETRY→1`; ignore `MASKED` / `EXCLUDE` |

**Loss:** binary / two-class on positions with `target_mask==1` only (IGNORE_INDEX elsewhere).

---

## 3. Batching

- Pad sequences to max N in batch; attention / validity mask required.  
- Do not drop Anchors from the sequence (context needed); only mask loss.  
- One sample = one utterance sequence (do not explode to independent span dataset files).

---

## 4. Absent channels

If `featureAvailability.toneAcoustic == false`:

- Omit acoustic tone dims **or** pass zeros **together with** avail mask bit 0  
- Training code **must** multiply features by availability (or equivalent) so zeros are not “measured”

Same for ASR confidence / Model2 / recall.

---

## 5. Forbidden loader behaviors

- Reconstruct Anchors from frequency  
- Relabel RETRY from `currentText != referenceText` alone  
- Require KenLM scores  
- Require full `UserProfileV1`  
- Fail closed if `model2AnchorStatus=UNAVAILABLE` (Domain-only samples are valid under DATASET_LIMITATION)

---

## 6. Sidecar

Loader **must not** require audit sidecars for training forward.  
Sidecars are QA / debug only.
