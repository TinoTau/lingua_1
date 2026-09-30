# Model3 100k Dataset Acceptance Contract

**Status:** FROZEN (gates for future generation; not executed this phase)

---

## A. Automated QA (required before train)

| Check | Gate |
|-------|------|
| Schema `MODEL3_TRAINING_SAMPLE_V1` | 100% |
| Label validity (RETRY rules / KEEP / MASKED / EXCLUDE) | 100% |
| Anchor mutation / Anchor RETRY | 0 |
| Span offset alignment vs `currentText` | 100% |
| RETRY ⇒ `referenceReachable==YES` + probe ≠ NOT_RUN | 100% |
| Fake acoustic on SYNTHETIC_TEXT | 0 |
| Forged MODEL2 anchors | 0 |
| dialog_200 in train/dev | 0 |
| Group split `sourceSentenceId` leakage | 0 |
| `contrastGroupId` leakage | 0 |
| Unexplained exact duplicates | 0 |
| Manifest + per-shard SHA256 | present & match |
| Distribution report | published |

Surface-pair cross-split: **report**; severe → `SURFACE_PAIR_LEAKAGE_RISK` (may PASS_WITH_GAPS).

---

## B. Human QA

- Stratified sample from the **100k** set (not only pilot 200).  
- Cover families, KEEP/RETRY, hard negatives, contrast, Domain-only anchors.  
- Pilot human QA does **not** auto-accept 100k.

---

## C. Capacity prerequisites

| Gate | Requirement |
|------|-------------|
| Unique spoken-like bases | ≥ ~15k (target 15–25k) |
| Near-duplicate-only inflation | FORBIDDEN |
| `BASE_CORPUS_GAP` | must be closed |

---

## D. Dataset limitations allowed on first corpus

- `model2AnchorStatus=UNAVAILABLE` majority → **DATASET_LIMITATION**  
- `evidenceLevel=SYNTHETIC_TEXT` majority → acoustic ABSENT + masks  
- Tone optional volume may be 0  

These are **gaps**, not schema failures — but block “full acoustic Model3 ready” claims.

---

## E. Pass classes (generation phase)

| Verdict | When |
|---------|------|
| PASS | All gates + capacity met |
| PASS_WITH_GAPS | Format/labels OK; known limitations documented |
| FAIL | Leakage, forged features/anchors, schema fail, dialog_200 leak, role drift |
