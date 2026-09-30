# Model3 Training Data Source Plan

**Status:** Design only — no corpus generation this round

## Priority

1. **Real data first:** audio + ASR raw + reference + Tone + FineSpan + Domain Vote + Model2 traces  
2. **dialog_200:** validation / integration / limited research — **not** sole training set; do not overfit fixed cases  
3. **Synthetic:** acoustic-plausible corruptions only (tone drift, n/l, d/t, nasal, zh/ch/sh↔z/c/s, frozen relation confusions)  
4. **TTS path preferred:** correct text → TTS audio → real ASR errors (not random character replace)

## Forbidden

- Random Hanzi substitution as Model3 training  
- Fixed-case patch training (10 near-copies of a failure → retrain)  
- dialog_200 acceptance cases leaking into test tuning  

## Inventory (existing)

| Source | Role |
|--------|------|
| `test wav/dialog_200/` | Measurement / limited research |
| Stage-J / Single-Char freeze dialog traces | Trace schema research |
| Model2 P/D `rows.jsonl` | Pronunciation evidence patterns — **not** Model3 labels |
| Single-Char Repair V1 TSV | **DO NOT USE** for Model3 membership |

## Scale-up path (future)

Expand beyond dialog_200 with held-out semantic families (see generalization split plan).
