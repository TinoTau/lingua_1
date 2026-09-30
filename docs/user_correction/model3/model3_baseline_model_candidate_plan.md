# Model3 Baseline Model Candidate Plan

**No training this round.**

## Sequence / feature shape (from audit)

- Short FineSpan sequences (N typically ≪ 50)
- Per-span: masks + tone/pinyin/acoustic/pronunciation/recall evidence
- Output: KEEP/RETRY head on `targetMask==1` only

## Candidates

| Priority | Model | Role |
|----------|-------|------|
| **1 — Baseline** | **Small BiGRU** + span classification head | First offline train |
| **2 — Comparison** | Tiny Transformer Encoder | Only if BiGRU fails distant-anchor ablations |
| Forbidden | LLM / BERT-large / large Chinese encoder / decoder LM / generation | — |

## Required properties

- One forward pass per eligible utterance/path input
- No token generation
- No lexicon lookup
- Acoustic + pronunciation channels required (anti local-LM)

## Upgrade rule

Promote Transformer only with measured BiGRU failure on distant Anchor dependence — not “Transformer is more modern.”
