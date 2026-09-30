# Model3 Stage2 Check List — Offline Labels

## Must

- [ ] SpanId/offset alignment artifact (no substring-only labels)
- [ ] RETRY requires repairability criteria (label contract §50)
- [ ] KEEP classes A–E including hard negatives
- [ ] Contrast-pair generation capability
- [ ] Anchor masked (`MASKED_ANCHOR` / target_mask=0)
- [ ] Split tags per generalization plan
- [ ] No production inference

## Must not

- [ ] ASR≠ref ⇒ RETRY
- [ ] Random character corruption
- [ ] Fixed-case overfitting from dialog_200 only
