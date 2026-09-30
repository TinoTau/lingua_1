# Candidate contract proposal (not implemented)

**Name:** `SingleCharAmbiguousCandidateSetV1` (internal Model2/Recall type)

## Ownership

- Lexicon/Operations: membership, pinyin, tone, enabled flag.
- Recall: acoustic pinyin+tone query → bounded eligible list (existing LIMIT 8).
- Model2: select index or abstain. Must not add surfaces.

## Invariants

1. Every member is length=1 Han, enabled, from Single-Char Repair Lexicon SSOT (not IME 2510 as repair universe).
2. All members share the same acoustic `queryTonePinyinKey`.
3. N ∈ [2, min(8, existing SQL limit)]. Truncated page (returned==LIMIT) remains fail-closed (CR 1.0.4) unless a later contract says otherwise — this ACP does **not** relax truncation uniqueness.
4. Order is deterministic (stable sort by term_id / surface) so candidate_i is reproducible. Model2 must still be order-robust in training.
5. Output is `ABSTAIN` or `CANDIDATE_i` with i < N. Fail closed.
6. Selected hit re-enters existing `WindowCandidate` materialization / bind. Not a new replacement pipeline.
7. At most **one** lexical 1-char candidate proceeds to Assembly for that span (select or nothing). Do not dump the set into sentence combinations.

## Forbidden

- Frequency Top1 as Model2 substitute.
- Open-vocab decode.
- Model2 lexicon scan.
- expectedText at runtime.
