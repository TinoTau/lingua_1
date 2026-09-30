# Model3 Assembly / KenLM Reuse Audit

## Assembly

| Question | Answer |
|----------|--------|
| Reuse existing `buildSentenceCandidates`? | **YES** |
| Incremental / patch assembly API? | **NO** — must rebuild `spanSets` after candidate swap |
| Reuse `assembleDomainAwareSpanSets`? | **YES** — rerun after partial recall + domain filter |
| Reuse compatibility graph? | **PARTIAL** — may need re-resolve if new candidates conflict |

**Verdict:** Assembly **REUSABLE** via full re-run on updated `activeCandidates` (not hot-patch).

## KenLM

| Pass | Today | Model3 target |
|------|-------|---------------|
| First KenLM | One `runFwSentenceRerankFromPrefilled` | Prefer **one** KenLM after optional retry |
| Second KenLM | Does not exist | Only if design chooses post-KenLM trigger (not recommended) |

Stage-J p50 KenLM ~538ms — doubling on trigger is material.

**Verdict:** KenLM **REUSABLE**; recommend **single** rerank after retry assembly.

## Model3 is not final judge

Final text from KenLM pick + `applyFwSpanReplacements`, not Model3 output.
