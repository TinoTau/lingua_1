# 01 — Architecture Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |
| Status | CURRENT RECOVERY BASELINE |

---

## Unique Production Chain

```text
ASR Raw
→ FineSpan / Multi-Path Lexical Lattice
→ Formal Term Exact Recall
→ Domain Presence Vote
→ SameDomain Bucket
→ Sentence Assembly
→ CrossPath
→ KenLM Input / Runtime Boundary
```

| Stage | Responsibility |
|-------|----------------|
| FineSpan / Lattice | Produce windows / edges / paths |
| Exact Recall | Formal term candidates only |
| Domain Vote | Presence Vote → retainedDomains |
| Bucket | SameDomain partitioning |
| Assembly | Path-local sentence candidates |
| CrossPath | Merge · dedup · cap ≤16 |
| KenLM | Score / rank / pick only |

**Candidate generation ends at CrossPath. KenLM only scores/ranks/picks.**

---

## RETIRED / HISTORICAL / NOT PRODUCTION

```text
LTR · Beam · parent_fragment · term_pinyin_ngrams
substring candidate · phraseCandidates · phoneticGroups
parallel V2/V3 recall · shadow recall · legacy recall
```

Scan result at freeze: all **NOT FOUND** as production-active paths.

---

## KenLM Boundary

Frozen: input/output/ownership/`raw_log_delta`/gate boundary/diagnostics availability.  
**Not frozen:** ranking quality · model capability · threshold quality · training corpus quality.
