# Prior contract proposal (NOT FROZEN)

## Status

**CONTRACT_GAP** — this audit must not casually freeze a numeric prior to force PASS.

## Facts forcing an operational prior

1. Schema: `prior_score REAL NOT NULL`.
2. Collector: requires `prior > 0`.
3. Bind: requires `prior >= minPrior` (0.5) or length-1 never materializes.
4. Complex frequency→prior mapping: **forbidden** this round (simplicity rule).
5. Changing minPrior: **forbidden** this round.

## Simplest contract candidate (for next freeze)

| Item | Proposal |
|------|----------|
| Kind | **Constant** for all V1 length-1 rows |
| Suggested value | **0.9** (same default as multi-char Full Rebuild CSV / idiom path) |
| Range | Fixed; must be `>= 0.5` and `> 0` |
| Source | Import-time constant — **not** IME weight, **not** CLD frequency remap |
| Consumer | Collector eligibility + bind minPrior + SQL order (ties only) |

Alternative acceptable band historically discussed: 0.85–0.95. Pick one constant in development ACP.

## Explicit non-goals

- No per-character weight table
- No SUBTL/Weibo → prior formula in V1
- No minPrior change in the same change-set as SSOT swap
