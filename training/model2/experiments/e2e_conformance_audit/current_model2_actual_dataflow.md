# Current Model2 Actual Dataflow (code-backed)

Markers: READ_ONLY

```text
PRODUCTION Node:
  ASR → Lattice FineSpan (PathFineSpan / GlobalWindowDescriptor)
      → Lexicon Exact (+ legacy fuzzy flags)
      → Domain Vote → Sentence Assembly → KenLM
  UserProfile: session-cached, NOT consumed by Model2
  Model2 runtime: NOT WIRED (Node HOLD)

TRAINING / EXPERIMENT (offline):
  TrainRow.span_text + span_syllables / observed_syllables
      → FuzzyPool (profile-agnostic)
      → Stage A closed-set scores (optional)
      → CandidateRelation + Stage B delta (optional)
  Phase 7E/7F Profile Retrieval:
      observed_syllables → reverse map → FuzzyPool-style lexicon query
      (span_text often empty string in FuzzyPoolRequest)

PHASE7F REAL_ASR PATH (TEST):
  results.asr_hypothesis (WHOLE UTTERANCE)
      → text_to_syllables(asr)
      → profile reverse on entire sequence
      → lexicon query
  BYPASSES FineSpan windows  → ARCHITECTURE_DRIFT_WHOLE_UTTERANCE_BYPASS (test path)
```

| Node | Granularity | Uses profile? | Can introduce candidate? | Runtime? |
|------|-------------|---------------|--------------------------|----------|
| FineSpan (Node) | span window 1–5 syl | NO | via Exact/lexicon | YES prod |
| FuzzyPool | span syllables | NO | YES lexicon | train/exp |
| Profile Retrieval 7E | syllables (intended: span) | YES phonetic_bias∩BOUND | YES | exp only |
| Phase7F REAL_ASR | **whole utterance** | YES | fails in practice | TEST_ONLY drift |
| Stage A | pool slots | weak/optional | NO | exp |
| Stage B | pool slots | YES relation | NO | exp |
| Sentence assembly | utterance | — | — | prod (no Model2) |
