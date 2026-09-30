# Model3 Training Data Feasibility Audit

## Automatic KEEP/RETRY labels

| Requirement | Feasibility |
|-------------|-------------|
| span sequence + anchor mask | **PARTIAL** — need adapter from trace |
| ASR raw vs reference | **YES** — dialog_200 has expectedText |
| span-level alignment ASR↔reference | **PARTIAL** — FineSpan lattice paths; no stable offline aligner exported |
| non-anchor KEEP/RETRY from error | **PARTIAL** — requires counterfactual: would re-recall fix span given anchors? |

**Verdict:** **PARTIAL** — not fully automatic without gap closure (span align + label policy).

## Real data sources

| Source | Audio | ASR raw | Reference | Tone trace | Span trace | Model2 trace |
|--------|-------|---------|-----------|------------|------------|--------------|
| dialog_200 | YES | YES | YES (expectedText) | YES (when trace on) | YES (per_span jsonl) | YES (Stage-J) |
| Model2 P rows.jsonl | NO (metadata) | span text | labels in row | partial | YES | training only |
| Model2 D rows | NO | partial | domain labels | partial | YES | training only |
| Single-char repair | N/A | N/A | frozen | N/A | N/A | forbidden |

## Synthetic pipeline

TTS + pronunciation corruption: **PARTIAL** — relation-lexicon + Model2 training variants exist conceptually; no Model3 synthetic corpus today.

## Contrast pairs (same surface, different anchor context → KEEP vs RETRY)

**PARTIAL** — dialog_200 + domain buckets could support; no automated generator.

## Major gaps

1. No exported `anchor_mask` in traces
2. No `retry_pass_id` / pass-1 vs pass-2
3. length1 collector not in default trace (known from Single-Char V1 acceptance)
4. Offline span-reference alignment tool not standardized
