# Operations update contract (proposed)

Operations MUST be able to change Single-Char Repair Lexicon membership **without retraining Model2**.

| Operation | Retrain Model2? | Notes |
|-----------|-----------------|-------|
| Add one-character word | NO | appears in future candidate sets as hashed features |
| Remove / disable | NO | disappears from sets |
| Change pinyin / tone metadata | NO | query key changes; model still sees supplied features |
| Change frequency | NO | must not become Top1 runtime policy |
| Change IME 2510 | N/A | IME table is a different SSOT |

If implementation uses a closed softmax over a fixed 1125-character inventory: **ARCHITECTURE_NOT_ACCEPTABLE**.

Prior/minPrior remain HOLD. Ops prior retune is a separate binder ACP, not this Model2 ACP.
