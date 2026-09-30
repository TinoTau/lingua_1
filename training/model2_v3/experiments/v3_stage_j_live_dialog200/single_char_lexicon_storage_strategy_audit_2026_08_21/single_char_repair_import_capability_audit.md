# Single-char repair import capability audit

## Can curated lists import under Option A?

YES — new table ingest. Requires new pipeline.

## Can curated lists import under Option B?

YES — reuse `loadSingleCharRows`-shaped ingest into `term` + `base_lexicon`, with:

- different source path (not IME TSV)
- different prior mapping (not IME weights)
- source label indicating Repair curation

## Strict / Balanced / Full CLD

Compatible as **candidate content inputs** for either option. Not selected this round.

**LICENSE_REVIEW_REQUIRED** for any CLD-derived production import (prior audits).

## HOLD_NO_IMPORT (grouping audit 2026-08-19)

Still applies to **which list** to ship, not to **where to store**. Storage can be decided while list selection remains open.
