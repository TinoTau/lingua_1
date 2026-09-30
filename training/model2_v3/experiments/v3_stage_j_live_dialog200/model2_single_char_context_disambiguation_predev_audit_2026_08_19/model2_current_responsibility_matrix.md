# Model2 current responsibility matrix

**Frozen SSOT:** `STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1`, `FW_REPAIR_V4_POST_TRACE_FREEZE_V1`, Stage J model freeze 2026-08-18.

| Concern | Current owner | Model2 role today | Proposed single-char role |
|---------|---------------|-------------------|---------------------------|
| FineSpan generation | Lattice FineSpan | consumer | KEEP / consumer |
| Base lexical recall 2–5 | LexiconRuntimeV2 / Recall | none (base already done) | KEEP |
| Length-1 candidate universe | Recall unique-tone collector + `base_lexicon` (IME 2510) | none | Lexicon SSOT = separate repair lexicon (future) |
| Length-1 unique accept | Recall (`resolveLength1BaseCandidate`) | none | KEEP: skip Model2 |
| Length-1 ambiguous reject | Recall (`MULTIPLE_TONE_EXACT_CANDIDATES`) | none | Recall emits bounded set; Model2 select/abstain |
| Pronunciation-conditioned expansion | Model2 Stage P | **owns** relation action + lexicon query | KEEP; not single-char vocab |
| Domain-conditioned expansion | Model2 Stage D | **owns** `domain_soft:{slot}` / `domain_none` | KEEP; domain is context evidence only |
| Domain membership of terms | Lexicon `domain_ids` | must not invent tags | KEEP |
| Candidate ranking among surfaces | **not Model2** (Assembly + KenLM sentence score) | no listwise surface head | NEW conditional head: index among supplied set |
| Sentence assembly | DomainAwareAssembly | none | KEEP |
| Sentence LM | KenLM | none | KEEP |
| Sentence budget 16 | FW config | none | KEEP |
| minPrior bind | Candidate binder | none | HOLD (separate ACP) |
| Character generation | none | none (no open vocab) | FORBIDDEN |

## What Model2 actually is (code)

Trainable **retrieval policy**: FineSpan + UserProfile + retrieval state → bounded retrieval primitives.

- Stage P: which phonetic relation(s) to query (`single:{rel}`), plus unused composed/identity logits.
- Stage D: which domain slot to open, or `domain_none`.
- Shared trunk `HIDDEN=128`. ONE checkpoint. Params 47210.

Model2 is **not** a vocabulary, **not** a single-char recall source, **not** a character generator, **not** a sentence corrector.
