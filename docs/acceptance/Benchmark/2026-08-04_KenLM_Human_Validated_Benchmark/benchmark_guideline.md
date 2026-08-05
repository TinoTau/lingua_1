# KenLM Human Validated Benchmark — Guideline

| Field | Value |
|-------|-------|
| Version | **KENLM_BENCHMARK_V1** |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Nature | Human preference on **real Runtime** competition pools |

## 1. What counts as Meaningful Competition

Must satisfy **all**:

1. `distinctText >= 2`
2. Raw present (`isRaw=true`) — never omit Raw
3. ≥1 non-Raw CrossPath alternate (`candidateSource=CROSSPATH_ALT`)
4. Texts are **semantically distinct** (not duplicate / whitespace-only twins)

`candidateCount>=2` with identical text is **not** competition.

## 2. When Raw should win (`RAW_CORRECT`)

- Raw is grammatical and meaning-clear in context
- Alternates are homophone / ASR glyph noise (`科医`, `酒店半`, `登机` for `等级`, etc.)
- Domain term in Raw is already correct

## 3. When a Candidate should win (`CANDIDATE_1` / `CANDIDATE_2`)

- Raw shows clear ASR damage
- One alternate restores meaning / grammar / domain term
- `CANDIDATE_1` = first non-Raw by `candidateId` order; `CANDIDATE_2` = second
- Do **not** invent Expected Text; choose among exported candidates only

## 4. When `MULTIPLE_OK`

- ≥2 candidates (including Raw) are equally acceptable
- No unique preferred winner for ranking supervision

## 5. When `ALL_WRONG`

- Raw damaged **and** no alternate fully repairs meaning
- Still keep the case for regression of “avoid worse picks”

## 6. When `UNDECIDABLE`

- Domain intent unclear from the sentence alone
- Proper noun / pronunciation ambiguity without context
- Status must be `UNDECIDABLE`

## 7. Status values

| status | Meaning |
|--------|---------|
| VERIFIED | Decision locked for benchmark use |
| REVIEW_REQUIRED | Needs second human pass |
| UNDECIDABLE | Kept but excluded from hard preference loss |
| RETIRED | No longer used (do not delete row) |

## 8. decisionReason vocabulary

Use one or more of: `Grammar`, `Meaning`, `Domain`, `Context`, `ASR Noise`, `Pronunciation`, `Proper Noun`, `Other` (semicolon-separated). **Never leave empty.**

## 9. Change policy

See `benchmark_change_log.md`. Append-only; no renumbering `KLM*` IDs.
