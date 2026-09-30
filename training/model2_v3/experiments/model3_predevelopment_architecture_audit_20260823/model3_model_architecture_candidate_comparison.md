# Model3 Model Architecture Candidate Comparison (preliminary)

**Not final model selection** — feasibility only.

## Input shape (from audit)

- Utterance-level sequence of N FineSpans (typical N ≪ 50)
- Per span: anchor flag, anchorSource, tone reliability, pinyin key, acoustic tone pattern summary, Model2 action summary, domain bucket id, candidate count, ASR surface
- Output: KEEP/RETRY per **non-anchor** span (masked)

## Candidates

| | A. Small BiGRU | B. Tiny Transformer Encoder | C. Hybrid MLP+BiGRU |
|--|----------------|----------------------------|---------------------|
| Params (est.) | 50k–200k | 150k–400k | 80k–250k |
| CPU p50 target | 5–10ms | 10–25ms | 8–15ms |
| Distant anchor context | moderate (bidirectional) | strong | moderate |
| Training complexity | low | medium | medium |
| Implementation fit | high (fixed-length span seq) | high | medium |
| Overbuild risk | low | medium | low |

## Recommendation

**Start with A (small BiGRU)** unless ablation shows distant-anchor dependency requires B.

Evidence for B not yet measured — span sequences are short; anchors usually local.

## Required properties (all candidates)

- Utterance-level single forward pass
- Span-level KEEP/RETRY head
- Anchor mask in input; anchor outputs masked at runtime
- No text generation, no lexicon lookup

## Local KenLM collapse prevention

Model inputs must include **acoustic/tone/pronunciation** channels; training contract forbids n-gram-only features. Audit role: **MODEL3_ROLE_COLLAPSE_TO_LOCAL_LM** if design uses only surface co-occurrence.
