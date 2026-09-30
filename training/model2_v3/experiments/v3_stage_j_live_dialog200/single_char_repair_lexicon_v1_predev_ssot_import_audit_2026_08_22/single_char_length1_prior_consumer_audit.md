# Length-1 prior consumer audit

## Collector (`collectBaseOnlySingleCharCandidate` / eligibility)

- Rejects `priorScore <= 0` or non-finite (**A: eligibility > 0**).
- SQL `ORDER BY prior_score DESC` among tone-exact hits (**B: ranking** when N>1; unique-only often collapses to 0/1).

## Bind (`bindLexiconHitsToWindow`)

- `priorScore >= minPrior` (default **0.5** from `fw-config`) (**C: minPrior gate**).
- **No length branch** — length-1 uses same gate as multi-char.
- Historical Bind MinPrior Length-1 Audit (2026-08-19): IME weights 0.08–0.30 → **0** length-1 binds.

## Downstream

FineSpan/Assembly/KenLM do not redefine prior; they consume bound candidates.

## IME role weight

**NOT** reusable as Repair prior.
