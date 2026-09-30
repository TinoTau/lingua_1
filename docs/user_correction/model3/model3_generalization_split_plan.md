# Model3 Generalization Split Plan

**Forbidden:** random row-only split as sole strategy.

## Required held-out axes (future)

| Axis | Purpose |
|------|---------|
| held-out utterance | Prevent utterance memorization |
| held-out anchor combination | Contrast-pair generalization |
| held-out bridge surface | Same surface / different anchors |
| held-out pronunciation corruption | Accent class OOD |
| held-out domain | Domain Anchor OOD |
| held-out user-profile pattern | Pronunciation evidence OOD |

## Leakage control

- dialog_200 final-acceptance cases: **not** for iterative test tuning of Model3 labels/thresholds.
- Fixed narrative examples (e.g. 裹上) stay **documentation-only**, not runtime rules and not exclusive train seeds.

## Acceptance (Stage4)

Report metrics on each held-out axis before shadow runtime enablement.
