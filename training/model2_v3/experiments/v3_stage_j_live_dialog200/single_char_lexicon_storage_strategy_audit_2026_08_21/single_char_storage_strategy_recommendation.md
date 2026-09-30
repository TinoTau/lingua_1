# Recommendation: OPTION B

## Recommended Strategy

**OPTION B** — Remove IME 2510 mirrored rows from Repair `base_lexicon` via rebuild; load curated single-char repair vocabulary as length-1 base rows; keep IME TSV as IME SSOT.

## Reason

Single-char repair items are still **FW base lexical terms**. Lattice already placed length-1 in `base_lexicon`. IME already has a separate TSV SSOT and does not read sqlite length-1 at runtime. Adding a table would create schema/collector/ops cost without solving a proven incompatibility.

## Requires

| Item | Value |
|------|-------|
| New table | NO |
| base_lexicon schema change | NO |
| Collector change | NO |
| IME change | NO |
| Model2 change | NO |
| Rebuild planning (future) | YES |
| Final curated list selection | YES |
| License review if CLD-derived | YES |

## Explicit rejection of hybrids

No A+B dual-write, no shadow inventory, no two active Repair single-char sources.

## Relation to 2026-08-19 lexical-validity “Option C”

That “two-layer” recommendation meant **IME TSV vs Repair inventory** as data products — satisfied by **separate source files** under Option B, not necessarily a separate sqlite table (Option A of this audit).
