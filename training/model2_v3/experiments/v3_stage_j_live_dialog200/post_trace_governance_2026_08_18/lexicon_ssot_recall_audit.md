# Lexicon SSOT recall audit

Authoritative Node recall uses `node_runtime/lexicon/v3/lexicon.sqlite`.
- term rows: 9259 (enabled 9259)
- base_lexicon rows: 9259 (enabled 9259)
- domain_lexicon rows: 655
- term length=1 enabled: 0
- base_lexicon length=1 enabled: 0

Model2 D index is the Python CandidateIndex built from the same Lexicon surfaces (no fixture-only shadow list in runtime expand).
No hard-coded candidate list was introduced this round.
Length-1 identities live in `base_lexicon`, not in `term` (0 enabled 1-char term rows).
That is an INDEX / table-split fact, not a license to import new chars this round.
