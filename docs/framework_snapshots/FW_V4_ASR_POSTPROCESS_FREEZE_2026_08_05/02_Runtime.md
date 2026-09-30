# 02 — Runtime Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |

## Tone / Exact Recall

- Tone Payload = **Mandatory Input**
- Exact Recall = **plain pinyin + tone pinyin** joint exact query (Mode C)
- Tone model miss → Exact Recall miss = **allowed capability boundary**
- Must not restore Plain fallback / Fuzzy SQL / hidden retry

## Path-local order (CODE_REALITY 2026-08-23)

```text
Tone Rebind → Compatibility → Model2 P/D → Domain Vote → SameDomain → Assembly
```

Model2 expands `activeCandidates` **before** Domain Vote. Do not document Vote immediately after Tone.

## Domain Vote / SameDomain

- Domain candidates vote; **Base does not vote**
- Base **may co-assemble** into retained sameDomain buckets
- No proven SameDomain defect that blocks Base
- Domain Anchor (Model3 contract): only members of retained SameDomain buckets for `vote.retainedDomains`

## Assembly Enumeration

```text
Interval Non-Overlap Repair-Subset DFS
+ Canonical Gap Fill
+ candidateScore sort
+ Exact-Text Dedup
+ Output Cap (≤16)
```

Hard limits: enumNodes 1024 · repairs/path 16 · maxSentenceCandidates 16 · per-span 8/6/4

Assembly enumerates **legal replacement subsets**, not semantic clusters.
