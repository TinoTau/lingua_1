# Phase 7D — Current Runtime Dataflow (as implemented)

Markers: `PHASE7D_AUDIT` / `NOT_FOR_RUNTIME` / `NOT_FROZEN`

Note: Model2 Stage A/B is the **training/experiment** path. Production Node scoring does not consume Model2 outputs today (`Node: HOLD`).

```text
ASR / synthetic span text
        ↓
span_text + span_syllables (observed; relation may use family-synth syllables)
        ↓
FuzzyPool V1  [training/model2/fuzzy/pool.py]
        ↓  deterministic syllable Levenshtein; NO UserProfile
fuzzy_pool_term_ids[≤16] + distances + priors
        ↓
TrainRow export  [export/train_row.py]
        ↓
Stage A Model2StageAV1.forward  [model/model_v1.py]
  encode_query × encode_candidates(pool) + optional condition
  scores over pool slots + NO_MATCH only
        ↓
CandidateRelation 16D (observed × candidate × profile family)
        ↓
Stage B  score = score_base + delta(condition, relation)
        ↓
ranked permutation of INPUT term_ids (+ optional NO_MATCH)
```

| Component | Input | Output | Can add lexical candidate? | Uses profile? | Main responsibility |
|-----------|-------|--------|----------------------------|---------------|---------------------|
| FineSpan / span fields | ASR text | span_text, syllables | NO | NO | observed evidence window |
| FuzzyPool V1 | span_syllables + CandidateIndex | ≤16 term_ids | YES (lexicon) | NO | base phonetic recall |
| Stage A | pool tensors + query | scores[P+1] | NO | optional/weak | closed-set rank within pool |
| CandidateRelation 16D | observed/candidate syl + profile | feature vector | NO | YES (features) | binding features |
| Stage B | Stage A base + relation + profile | rescoring same pool | NO | YES | profile-conditioned rerank / binding |

**Cardinality:** FuzzyPool can introduce lexicon IDs absent from Exact ASR. Stage A/B never introduce a `term_id` that was not already in the input pool.
