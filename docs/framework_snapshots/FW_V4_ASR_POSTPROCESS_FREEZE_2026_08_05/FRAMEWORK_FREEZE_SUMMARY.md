# FRAMEWORK_FREEZE_SUMMARY

| Field | Value |
|-------|-------|
| Snapshot Name | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |
| Status | **CURRENT RECOVERY BASELINE** |
| Previous Baseline | `FW_V4_FREEZE_2026_08_03`（Historical Snapshot — 不改写） |
| Scope | ASR Post-Processing → KenLM Runtime Boundary |
| Nature | Date-based recoverable checkpoint — **not** permanent architecture freeze |
| Created | 2026-08-05 |
| Pack | `docs/framework_snapshots/FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/` |
| Acceptance Freeze Pack | `docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/` |

---

## Production Chain（冻结）

```text
ASR Raw
→ Syllable Coordinate
→ Lattice Window 1–5
→ Tone Evidence (Mandatory)
→ Exact Recall (plain + tone Mode C)
→ Domain Presence Vote
→ SameDomain Bucket (+ Base co-assembly)
→ Sentence Assembly (Interval Non-Overlap Repair-Subset DFS)
→ CrossPath (exact-text first-wins · ≤16)
→ KenLM (score / rank / pick · raw_log_delta · Gate 3.0)
→ Apply Writeback
```

---

## Frozen Contracts（本节点新增归档）

| Contract | Status |
|----------|--------|
| Tone Mandatory + Exact Recall Mode C | Inherited + restated |
| Lexicon atomicity · `term_domain_tags` | Inherited |
| Domain Vote · SameDomain Bucket · Base co-assembly | Inherited |
| **Assembly Enumeration Algorithm** | **Archived this freeze** |
| **repairSelectionCompleteness Formula A** | **Implemented + archived** |
| CrossPath exact-text · ≤16 | Inherited |
| KenLM Runtime Boundary · production model retained | Inherited + Wikipedia V1 **PRODUCTION_REJECTED** |

---

## Explicit Non-Contracts（暂不建立）

```text
Sentence Semantic Diversity
Near-Duplicate Policy
Per-Domain Sentence Quota (active budget)
Interactive Recognition Repair
```

---

## Known Non-Blocking Inconsistency

```text
allocateDomainBucketSentenceBudget
  — called as guard only
  — return value NOT passed to buildSentenceCandidates
  — each bucket still uses global cap 16
Classification: KNOWN_NON_BLOCKING_INCONSISTENCY
```

Reopen only when multi-bucket pools approach global cap with reproducible starvation.

---

## Top16 Utilization（Assembly Enumeration Audit）

```text
dialog_200 mean pool size ≈ 1.685
competition mean ≈ 2.827
max = 8 · full-16 cases = 0
mean unused slots ≈ 14.315
```

**Top16 is not a capacity bottleneck** at this baseline.

---

## Deferred Future Module

```text
Interactive Recognition Repair — DEFERRED_FUTURE_MODULE
Not part of current ASR post-processing main chain.
No interface / JobResult / Web / NMT / TTS work in this freeze.
```

---

## Recovery

See `13_Recovery_Guide.md` and Acceptance Pack `RECOVERY.md` / `verify_freeze.ps1`.

Git identity: see Acceptance Pack `baseline_identity.json` after Freeze Commit + Tag.
