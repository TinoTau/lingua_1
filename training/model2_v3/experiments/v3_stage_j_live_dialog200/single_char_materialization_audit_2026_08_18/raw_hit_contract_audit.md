# RAW_HIT contract audit

**Previous AFTER metric `raw_hit = 206` is not a production recall hit.**

## Definition used in Recall Foundation after-effects

File: `docs/user_correction/scripts/recall_foundation_after_effects.py`

```
ex = pta.existence(exp, lex)
raw_base = bool(ex.get("in_base"))
R4_base_raw_hit = raw_base
```

`existence()` opens production sqlite and tests whether `expected_text` appears in `base_lexicon` / `term` / `domain_lexicon`.

| Field | Previous R4 | Production RAW_HIT (this audit) |
|-------|-------------|----------------------------------|
| query origin | audit process | Lattice `recallTopKForWindows` |
| query key | none (surface membership) | window pinyin + **tone** pinyin key |
| span id | none | 1-syllable window / PathFineSpan |
| term id | sqlite row | `WindowCandidate.termId` |
| surface | expectedText | hit `hotword.word` |
| runtime or probe | **offline probe** | **runtime** |
| rank | n/a | cap=1 |

**Label:** `TRACE_STAGE_SEMANTICS_MISMATCH`

Comparing probe `in_base` to union materialization is invalid. Waterfall then did:

```
R1 exists (probe)
R3 covering FineSpan syllable count == 1   # 1-char fallback FineSpans satisfy this
R4 probe in_base
not R8 union
→ CANDIDATE_MATERIALIZATION_GAP
```

Fallback FineSpans make R3 true **without** a production length-1 hit.

## Production RAW_HIT (authoritative)

A production raw hit for a correction unit exists only if a **runtime** pack contains `surface == expected`:

- `base_candidates.items`
- Model2 `p_retrieval.queries[].hits`
- Model2 `d_retrieval.hits`
- union / after_model2

On AFTER `dialog200_after`: **0 / 206** expected 1-char surfaces appear in those packs.

Window-level SQL rows (tone-exact page, uniqueness reject, surface-exact accept/reject) are **not** in the current trace → `OBSERVATION_FIELD_ADDITION_REQUIRED`.
