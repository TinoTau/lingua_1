# No-git rollback target state

## Model2

- `RetrievalPolicyV3(with_domain_head=True)` only
- No `with_ambiguity_head`, `ambiguity_version`, heads, encoder
- `forward` keys: action / query_budget / cand_budget / domain_action
- No dormant flags, shims, or hidden cmds

## Checkpoint

- Unique authoritative artifact: `expA_frozen_trunk.pt`
- sha256 `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda`
- params 47210
- No retrain

## Host

Keep: ping, stats, load, load_index, infer, shutdown  
Delete: disambiguate

## Node

Keep: `infer` P/D expansion  
Delete: disambiguate wrapper, contract types, SELECT materializer

## Recall

Keep: length-1 collector unique-only / surface-exact / fail-closed (`MULTIPLE_TONE_EXACT_CANDIDATES`), `length1Collector` trace  
Delete: `singleCharAmbiguousSet` construction and type coupling to Model2 contract

## Main chain

ASR → Tone → FineSpan → Lexicon Recall → Model2 P/D existing assistance → Candidate Set → Domain Vote → Assembly → KenLM → NMT

## Lost capability (expected)

Model2 single-char candidate SELECT/ABSTAIN

## Compatibility

None. Project not launched. Delete thoroughly.
