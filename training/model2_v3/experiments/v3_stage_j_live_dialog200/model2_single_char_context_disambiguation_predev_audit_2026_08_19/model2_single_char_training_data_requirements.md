# Training data requirements (design only — do not generate a trainset this round)

## Objective

Learn **index selection among a supplied set given local context**, not “this hanzi is always correct”.

## Required example types

| Type | Purpose |
|------|---------|
| Positive ambiguous | N>=2 legal candidates; context supports exactly one; label = that index |
| Abstain | All candidates equally implausible OR context insufficient; label = ABSTAIN |
| Polyphonic-shaped | Same surface different pinyin only if set actually contains both; otherwise do not fake |
| Same-pinyin same-tone | Core CASE C |
| Negative context | Context supports none of the set → ABSTAIN not random pick |
| Context-switch | Same candidate set, two sentences, opposite labels |
| Domain-neutral | Must work with empty domain evidence |
| Profile-neutral | Must work with empty UserProfile (dialog_200 NO_PROFILE is production-relevant) |
| Profile-conditioned rank | Optional: profile may break ties **among supplied candidates only** |

## Forbidden supervision

- dialog_200 `expectedText` as the only / primary train source
- Hardcoded 好→毫 / 我→涡 case tables
- Frequency Top1 labels
- Open-vocab character IDs as classes (1125-way softmax over STRICT)

## Split rules (future)

- Held-out **characters**
- Held-out **candidate combinations**
- Held-out **sentence contexts**
- Term-exclusive where identities exist
- Report REAL / DERIVED / SYNTHETIC mix; synthetic must not dominate reported production metrics

## Volume

Unspecified this round. Feasibility does not require a generated corpus now.
