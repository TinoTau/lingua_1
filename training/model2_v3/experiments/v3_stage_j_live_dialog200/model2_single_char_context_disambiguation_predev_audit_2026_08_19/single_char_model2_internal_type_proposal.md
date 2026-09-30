# Internal type proposal (not JobResult)

Prefer types colocated with Model2 runtime (`model2-runtime/types.ts` pattern: “internal only”).

```
SingleCharDisambiguationRequestV1
  span_id
  query_tone_pinyin_key
  window_text
  left_text            // slice of existing rawText
  right_text
  span_syllables
  acoustic_tone_pattern?  // already on FineSpan if present
  candidates[]         // Lexicon-produced only
    index
    surface
    pinyin_key
    tone_pinyin_key
    term_id
  profile_features     // reuse existing UserProfile packing; rank only
  domain_evidence      // context, not membership

SingleCharDisambiguationDecisionV1
  decision: ABSTAIN | SELECT
  selected_index: number | null
  n_candidates
  model2_invoked: boolean
  reason: UNIQUE_SKIP | ZERO_SKIP | TONE_NOT_READY | SELECT | ABSTAIN | INFER_FAIL_CLOSED
```

No JobResult fields. Diagnostics stay on V4/Model2 observation traces if later enabled — observation-only, no ranking change.

If a future consumer needs cross-service visibility, list consumers first. Current consumers of JobResult: InferenceService → agent result sender → NMT/TTS. None need the internal candidate set.
