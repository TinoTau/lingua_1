# FineSpan Contract Audit

## Production Model2 input

`training/model2/retrieval/finespan.py` `FineSpanView`: lattice-equivalent windows **1..5 syllables** (`LATTICE_WINDOW_MIN_SYLLABLES` / `MAX`). Model2 does not take whole utterance as the retrieval unit.

## Three surfaces

| Surface | FineSpan | Aligned to domain term length? |
|---------|----------|--------------------------------|
| Production | PathFineSpan / lattice 1..5 | No — ASR window |
| D training (stage_d2 rows) | Dataset span field | Mixed; not re-audited as a rewrite |
| D benchmark V2 eligibility | Term syllables + relation corruption, plus a term-length gate on Phase2 | Generator **assumes** near term length (`abs(len(span)-len(term))>1` skip) |

## Phase2 REAL_ASR domain-target rows

N=**6510**. Taxonomy: **6510 / 6510 have `|span_len - term_len| = 1`**.

They are **not** outside lattice 1..5. They **pass** V2’s `>1` skip. V2 still got **0 extra unique D** after trying a cap of 120 because off-by-1 windows remain **BASE_VISIBLE_FUZZY** (distance 1 still sits in mixed pool@16) or fail later uniqueness — not because FineSpan contract changed.

Classification:

- Production FineSpan contract: **FROZEN_DESIGN**, **FINESPAN_CONTRACT_DRIFT = NO**
- D benchmark vs Phase2 gold-term alignment: **TEST_CONTRACT_ISSUE** (generator wants term-aligned observation; Phase2 spans are lattice windows off-by-1 from the gold term)

## D / production / training consistency

Python Stage D eval and J1 use `FineSpanView.span_syllables` the same way. Node assembly uses PathFineSpan. No whole-utterance Model2 on this path.
