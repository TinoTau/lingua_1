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
