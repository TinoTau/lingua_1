# LINGUA Model3 RETRY Stage2 Tone-Relax — Development Report

| Field | Value |
|---|---|
| PHASE | `LINGUA_MODEL3_RETRY_STAGE2_TONE_RELAXATION_SINGLE_DELTA_IMPLEMENTATION` |
| DATE | 2026-09-14 |
| ACP | `LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1` → **IMPLEMENTED** |
| SINGLE_VARIABLE | `STAGE2_RETRY_TONE_CONSTRAINT` |

---

## Files changed

| File | Why | Semantic delta | Must not change |
|---|---|---|---|
| `main/src/lexicon-v2/recall-semantic-mode.ts` | **NEW** explicit mode SSOT | `tone_exact` \| `model3_retry_pinyin_domain_recovery` | — |
| `main/src/lexicon-v2/tone-first-tier-collector.ts` | Tone gate branch | Recovery: `lookupBaseByPinyinKey` + `lookupDomainsByPinyinKeyMulti` (+ idiom pinyin if L=4); Normal: unchanged Fail Closed | first-pass tone_exact |
| `main/src/lexicon-v2/recall-span-topk-v2.ts` | Plumb `recallMode`; L=1 recovery | Default mode unchanged; recovery L=1 uses pinyin base-only | Mandatory Tone default |
| `main/src/lexicon/tone-recall-sort.ts` | Stage priority for new lookup stage | `pinyin_domain_recovery` priority=1 | tone_exact priority=3 |
| `main/src/model3-runtime/run-model3-path-step.ts` | Stage2-only mode enable | Sets `recallMode: MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY` in RETRY recall closure only | Domain Vote / Anchor / Model3 infer |
| `tests/run-pilot200-post-anchor-acp-remeasure.mjs` | Observability | Also read `candidateCount` / `candidates` | Gate/owner business logic |
| `main/src/model3-runtime/model3-retry-region.controlled-validation.test.ts` | Align Stage2 probe with production | Pass recovery mode on Stage2 recall | — |
| `main/src/fw-detector/.../length1-real-sqlite.test.helpers.ts` | Domain seed completeness for tests | Insert `term` + `term_domain_tags` with domain rows | production Lexicon |
| `main/src/lexicon-v2/stage2-tone-relax-domain.sqlite.integration.test.ts` | **NEW** focused acceptance | A–E + path isolation + NORMAL Fail Closed | — |
| `docs/.../LINGUA_ACP_MODEL3_RETRY_STAGE2_TONE_RELAXATION_V1.md` | SSOT status | APPROVED → IMPLEMENTED + runtime contract | — |

## Functions

| Function | Delta |
|---|---|
| `collectTierCandidatesToneFirst` | `switch`-style: recovery → pinyin tiers; else existing Tone exact |
| `lookupPinyinTiers` | **NEW** mirror of tone tiers with pinyin APIs |
| `collectBaseOnlySingleCharCandidate` | recovery branch uses `lookupBaseByPinyinKey` |
| `recallSpanTopKV2` | threads `recallMode` (default `tone_exact`) |
| Stage2 `recall` closure in `completeModel3PathFromUpstream` | sets recovery mode only |

## Explicitly NOT changed

Model2 · Model3 infer/input/threshold · Anchor · Domain Vote · Retry geometry · merge/budget · SameDomain · Assembly · KenLM · scoring formulas · JobResult · Lexicon data · DB schema · first-pass Mandatory Tone · no config · no dual path · no implicit no-Tone fallback

## Tests

| Suite | Result |
|---|---|
| `stage2-tone-relax-domain.sqlite.integration.test.ts` | **7/7 PASS** |
| `batch1-1c-mandatory-tone-recall.sqlite.integration.test.ts` | **10/10 PASS** |
| `tsc` / `build:main` | **PASS** |

## One-sentence explanation

> Stage2 RETRY sets an explicit recovery recall mode; Recall uses the same pinyin and retainedDomains but skips the Tone exact gate.
