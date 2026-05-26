# Semantic Boundary (LLM vs Recover)

## LLM may

- Select active domain profile (Intent / Session Affinity)
- Generate session summary for rolling context
- Support **offline** evaluation analysis

## LLM must not

- Generate `WindowCandidate`
- Modify `repairedText` directly
- Modify lexicon SQLite / seed
- Modify `priorScore` at runtime
- Write replay patch into production bundle

## Recover owns

- Window recall from canonical bundle only
- Sentence expansion + KenLM rerank
- `repairedText` output from scored candidates

Enforcement: CPU LLM Intent path is separate from `hotword-recall` / `pinyin-topk-lookup`; no LLM hook in candidate generation.
