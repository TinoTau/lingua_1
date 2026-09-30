# Model3 Stage1 Check List — Anchor + Provenance + Trace

**Goal:** Zero production final-text behavior change.

## Must

- [ ] Implement Anchor Adapter (DOMAIN / MODEL2 / DOMAIN_AND_MODEL2) from existing fields
- [ ] Preserve provenance to Model3 boundary (pre-assembly side structure)
- [ ] Emit `MODEL3_RETRY_TRACE_V1` (env-gated)
- [ ] Anchor RETRY masked if any stub decisions exist
- [ ] No JobResult schema change
- [ ] No Model3 inference enablement
- [ ] No retry / re-recall
- [ ] Regression: dialog_200 or existing FW golden — **0 text delta** vs baseline

## Must not

- [ ] Touch Single-Char V1 / Model2 training / Domain Vote algorithm
- [ ] Reintroduce SuspiciousSpan / shadow beam
- [ ] Weighted trigger scores
- [ ] KenLM-based trigger
