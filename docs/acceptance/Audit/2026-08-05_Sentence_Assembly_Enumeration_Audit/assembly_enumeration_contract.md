# Assembly Enumeration Contract — Audit Snapshot（READ ONLY）

**Status:** Documented as **implemented behavior** — **not** newly frozen this round.  
**Verdict context:** `ASSEMBLY_CONTRACT_INCOMPLETE`（diversity / budget gaps）.

## In scope

```text
buildSentenceCandidates(rawText, spanSets, maxSentenceCandidates, coarseSpanRanges?)
→ SentenceCombination[]
```

## Guarantees（current code）

1. Deterministic DFS over non-overlapping repair subsets per slot.
2. Overlapping repairs never co-exist on one path.
3. Empty repair set → RAW sentence (gap/canonical only).
4. Exact-text uniqueness inside Assembly output (first-wins after score sort).
5. Hard caps: enum nodes 1024 · repairs/path 16 · output ≤ maxSentenceCandidates.
6. Formula A metadata attached at creation（metadata-only；不改变枚举集合）。

## Non-guarantees（gaps）

1. Distinct **semantic** sentences.
2. Bounded **near-duplicate** occupancy of Top16.
3. Per-domain sentence quotas inside Assembly.
4. Use of `allocateDomainBucketSentenceBudget` return value.
5. Predictable diversity when enum node cap truncates.

## Explicit non-owners

- CrossPath: exact-text merge + global cap only.
- KenLM: ranking consumer only.
