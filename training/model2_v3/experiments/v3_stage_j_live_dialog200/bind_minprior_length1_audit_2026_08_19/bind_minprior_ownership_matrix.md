# minPrior ownership matrix

| Layer | Owns minPrior=0.5? | Owns length-1 candidate quality? | Notes |
|-------|--------------------|----------------------------------|-------|
| Lexicon Recall / collector | NO | YES | `collectBaseOnlySingleCharCandidate`: SQL, tone, uniqueness, surface exact, cap=1, minCandidateScore (default 0) |
| Candidate Binder `bindLexiconHitsToWindow` | **YES** | Applies same gate to collector output | No length branch |
| Lattice / FineSpan | NO | Consumes bound WindowCandidates | Formal length-1 needs termId from recall |
| Domain Vote | NO | Length-1 does not vote | |
| Assembly / KenLM / Budget / Model2 | NO | Downstream of bound candidates | Model2 **reads** `prior_score` as a feature if a candidate is bound; raising all 2510 priors would affect Model2 if those edges exist |

## OWNERSHIP_DRIFT_POSSIBLE

For length-1, collector already performs conservative noise control (exact-only, unique-or-surface-exact, cap=1, no fuzzy, no domain). Bind then applies a **generic** prior floor calibrated to operational 0.85-scale multi-char terms.

Bind is therefore doing a quality filter whose historical target (low operational prior / homophone_variant) is largely **already excluded** by the length-1 collector contract.

This is **OWNERSHIP_DRIFT_POSSIBLE**, recorded as a **secondary** finding. It is not IMPLEMENTATION_DRIFT: no freeze text required a length-1 minPrior bypass.
