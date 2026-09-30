# RETIRED / HISTORICAL / SUPERSEDED BY MODEL2 P/D ROLLBACK DECISION (2026-08-20)

**Status:** RETIRED. Not authoritative Model2 architecture. Model2 is P/D ONLY.
Do not re-enable this capability without a new Architecture Change Proposal and explicit user approval.

---

# Single-Char Minimal Context Design V1

Isolated local-text branch for `judgeSingleChar`. Not a second model.

```
RetrievalPolicyV3
├── frozen shared trunk → P / D (unchanged)
└── single-char decision
       ├── MinimalContextEncoderV1
       └── AmbiguityHeadV2
```

- Context: left 4 + right 4 characters from existing span/raw text.
- Encoder: char-bucket embedding (2048+PAD) + masked mean pool + Linear(48→64).
- Encoder output never enters P, D, or trunk `encode()`.
- Same artifact / sidecar process. No BERT / Transformer / LLM.
- Candidate surfaces share the same embedding table (not output classes).
- Output remains SELECT(relative index) / ABSTAIN; cap 8.

Canonical copy also at `training/model2_v3/experiments/v3_single_char_minimal_context_v2/single_char_minimal_context_design_v1.md`.
