# 06 — KenLM Boundary Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |

## Production

- Model path: `kenLM/model/zh_char_3gram.trie.bin`
- SHA256: `532A335A09A006D1BA674F808814EE1D40C5B1D8F3527CA980E96723E7A62A4C`
- scoreMode: `raw_log_delta`
- Gate: `minDeltaToReplace = 3.0`
- **Unchanged** this freeze

## Wikipedia Corpus V1

```text
TRAINING_VALID · MODEL_LOADABLE · BENCHMARK_TESTED · PRODUCTION_REJECTED
```

Must not replace production KenLM.

Authority: `docs/fw-detector/kenlm/KENLM_RUNTIME.md`
