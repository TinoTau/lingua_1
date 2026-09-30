# Model3 Retry / Recall Reuse Audit

## Existing Recall capability

| API | Partial re-invocation |
|-----|----------------------|
| `recallSpanTopKV2(input)` | **YES** — pure function per window |
| `recallTopKForWindows({windows: subset})` | **YES** — pass subset only |
| `utterance-recall-cache` | **YES** — unchanged canonical keys hit cache |
| Production retry orchestrator | **NO** — does not exist |

**Second pipeline required:** **NO**

## Retry coordinator (future CREATE)

1. Receive Model3 RETRY set keyed by `fineSpanId` / syllable range.
2. Build `LexicalWindowQuery` for target spans only.
3. Call `recallSpanTopKV2` or `recallTopKForWindows(subset)`.
4. Merge new `WindowCandidate` into `activeCandidates` for that path (replace same-span candidates).
5. Re-run `runDomainAwareAssembly` → `buildSentenceCandidates` for that path.
6. Re-run `mergeCrossPathSentenceCandidates` + **one** KenLM pass.

## Search policy (future, not implemented)

| Capability | Status |
|------------|--------|
| anchor domain bounded recall | **PARTIALLY_SUPPORTED** — SameDomain buckets + retainedDomains |
| base lexicon | **ALREADY_SUPPORTED** |
| tone relaxation | **PARTIALLY_SUPPORTED** — recall tone gates exist; retry policy TBD |
| Model2 pronunciation relation | **PARTIALLY_SUPPORTED** — via Model2 P actions on retry re-call |
| bounded candidate count | **ALREADY_SUPPORTED** — per-span budget + global 16 |

## Domain during retry

Use **existing** `vote.retainedDomains` — do not re-vote from all domains. Model3 does not select domain.

## One-shot constraints

- `model3Invoked` flag per utterance
- `retryCycleDone` flag per utterance
- No recursion
