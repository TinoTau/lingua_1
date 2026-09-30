# Production candidate recommendation

**Recommended universe:** `NONE`  
**Audit verdict:** `HOLD`

Non-expected unique substitutions remain high on both STRICT and BALANCED. Shrinking groups can create new wrong uniques (example: acoustic `du4` → 度).

- Do **not** import sqlite this round.
- Do **not** replace the 2510 IME TSV.
- Separate repair lexicon remains the architecture: IME keeps 2510; FW Repair would later read a CLD-derived table.
- License: **LICENSE_REVIEW_REQUIRED** (CLD / GPL).
- minPrior / collector / FineSpan / Model2: unchanged.

STRICT unique-tone live (213 targets): expected=2 non-expected=43 precision_proxy=0.044444444444444446 recall_proxy=0.009389671361502348
BALANCED unique-tone live: expected=1 non-expected=26 precision_proxy=0.037037037037037035 recall_proxy=0.004694835680751174
