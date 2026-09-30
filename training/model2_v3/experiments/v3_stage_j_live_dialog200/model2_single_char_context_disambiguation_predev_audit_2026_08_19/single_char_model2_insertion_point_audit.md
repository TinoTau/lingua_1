# Insertion point audit

## Current Model2 hook (KEEP for P/D)

`span-assembly-v4-orchestrator.ts` after compatibility `activeCandidates`, before `runDomainAwareAssembly`.

This remains the Stage P/D expansion point. Do not move it. Do not merge single-char disambiguation into P action decode.

## Required additional hook (PROPOSED, not coded)

**File:** `electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts`  
**Function:** `collectBaseOnlySingleCharCandidate` after `filterEligibleBaseSingleChar` / eligible list, **before** `resolveLength1BaseCandidate` unique-only collapse.

Alternatively: Recall returns `{hits: [...eligible scored], ambiguous: true}` into window bind as a **non-materialized internal set**, then a Model2 helper selects 0/1 hit, then existing `bindLexiconHitsToWindow`.

Must be **after** lexicon query, **before** Assembly.

## Why not only the orchestrator hook

By orchestrator time, length-1 hits are already 0 or 1. Ambiguous evidence is discarded (`MULTIPLE_TONE_EXACT_CANDIDATES`).

## Why not before lexicon query

Would make Model2 a recall source / character generator. Forbidden.

## Why not a second pipeline

User-approved architecture is one main chain. No shadow, no ASR→Model2-corrector bypass.

## minPrior

Insertion does not authorize changing `minPrior`. Live bind still drops all 2510 IME priors. That remains a **separate HOLD**. Disambiguation without a passing prior still cannot materialize.
