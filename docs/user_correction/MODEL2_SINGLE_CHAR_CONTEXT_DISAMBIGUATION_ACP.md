# RETIRED / HISTORICAL / SUPERSEDED BY MODEL2 P/D ROLLBACK DECISION (2026-08-20)

**Status:** RETIRED. Not authoritative Model2 architecture. Model2 is P/D ONLY.
Do not re-enable this capability without a new Architecture Change Proposal and explicit user approval.

---

# ACP: Model2 Single-Char Context Disambiguation

**ACP id:** `MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_ACP`  
**Date:** 2026-08-19  
**Status:** DRAFT — awaiting user confirmation. **Not authorized to implement.**

---

## Current Architecture

ONE `RetrievalPolicyV3(with_domain_head=True)`, checkpoint `expA_frozen_trunk.pt` sha256 `d66847be…beda`, 47210 params, `MODEL2_FEATURE_HASH_V1`.

```
FineSpan + UserProfile + retrieval state
  → Model2 (P relation actions + D domain_soft/none)
  → bounded lexicon primitives
  → WindowCandidate merge
  → DomainAwareAssembly → KenLM → JobResult → NMT
```

Length-1 recall is a **separate** unique-tone collector (`recallSpanTopKV2` if syllables.length===1): 0 or 1 hit, no Model2, no Top1. Bind `minPrior=0.5` currently drops all IME 2510 singles.

## Problem

1. Same-pinyin+tone groups fail closed (`MULTIPLE_TONE_EXACT_CANDIDATES`). Context is never used.
2. Unique-only on a noisy character inventory creates **wrong uniques** (grouping audit: 赌/du4→度). Precision-first repair needs (a) a word lexicon and (b) context only when N>1.
3. Model2 today **expands retrieval**; it does not **choose among supplied lexical candidates**. Those responsibilities must stay split.

## Evidence

- Collector live 2026-08-18: 1046/4477 windows `MULTIPLE_TONE_EXACT_CANDIDATES`.
- Grouping audit 2026-08-19: STRICT unique-tone precision proxy 0.044; HOLD on import.
- Bind audit 2026-08-19: 2331 accepts × minPrior = 0 lexical 1-char FineSpans.
- Code: `N_ACTIONS=50` retrieval catalog; no candidate-index head; `expandActiveCandidatesWithModel2` has no length skip but never sees the discarded ambiguous set.

## New Responsibility Boundary

| Owner | Owns | Must not |
|-------|------|----------|
| Lexicon / Operations | repair one-char WORD membership, pinyin, tone | Model2 classes |
| Recall | bounded set from that lexicon via acoustic pinyin+tone | Model2-invented surfaces |
| Model2 | context select/rank/abstain **inside the set**, only if N>1 | vocabulary, open-vocab, second pipeline, sentence rewrite |
| Assembly / KenLM | sentence combination and LM | unchanged |
| IME 2510 | IME | repair SSOT |

## Target Architecture

```
FineSpan length == 1
        ↓
Single-Char Repair Lexicon (Ops SSOT; not IME 2510)
        ↓
phonetic/tone matching (existing collector query)
        ↓
0 → existing fallback          (no Model2)
1 → materialize                (no Model2)
>1 same pinyin+tone
        ↓
Model2 context disambiguation (new head; same sidecar)
        ↓
SELECT candidate_i  OR  ABSTAIN
        ↓
existing WindowCandidate materialization / bind
        ↓
existing Assembly → KenLM → NMT
```

P/D expansion hook in the orchestrator **stays**. This is an additional **conditional** call, not a parallel product path.

## Interface

- Internal `SingleCharDisambiguationRequestV1` / `DecisionV1` (see type proposal).
- Same Python host: extra infer fields; existing P/D JSON unchanged.
- JobResult: **no new fields**.

## Data Contract

- Candidate features: relative index + hashed surface + pinyin/tone. **Not** closed hanzi IDs.
- Context: existing `rawText` left/right slices + current span syllables + optional profile/domain as **tie features**.
- Truncation (LIMIT page full): keep fail-closed unless a later Recall ACP.

## Runtime Logic

```
if length!=1: existing Model2 P/D only
query lexicon
if n==0: fallback
if n==1: materialize
if n>=2:
    y = Model2.ambiguity_head(context, candidates)
    if y==ABSTAIN or infer fail: fallback
    else: materialize candidates[y]
then existing P/D expand on FineSpan (KEEP)
then Assembly / KenLM
```

Fail closed. No frequency Top1. No shadow flag.

## Training Impact

- SAME_MODEL_EXTEND_TRAINING.
- New head required. New model **not** required.
- Freeze trunk + P/D heads initially (Stage J expA).
- Train on **synthetic / varied candidate sets**, not a 1125-class table and not dialog_200.
- Held-out characters, combinations, contexts required or FAIL.

## Regression Impact

Must re-run Stage P RR gates, Stage D modest D metrics, dialog_200 NO_PROFILE (no new general-corrector behavior), uniqueness (no Top1).

## Performance Impact

Extra inference only on length-1 **ambiguous** windows. Stage J P P50 ~52ms is the current infer cost; ambiguous 1-char is a subset of FineSpans. Do not add a second process.

## Risks

| Risk | Mitigation |
|------|------------|
| Trunk interference with P/D | freeze trunk |
| Char-class overfitting | candidate-index labels + held-out chars |
| Dumping N candidates into Assembly | emit 0 or 1 only |
| minPrior still blocks bind | separate HOLD; this ACP does not change it |
| Repair lexicon not frozen | train on synthetic sets first (order B) |
| CLD GPL | LICENSE_REVIEW_REQUIRED; not this ACP’s import |
| Ambiguity collapse → wrong unique | N=1 path stays Model2-off; lexicon quality still required |

## Rejected Alternatives

| Option | Verdict |
|--------|---------|
| A Same model / conditional task + new head | **RECOMMENDED** |
| B Reuse action_head as universal candidate ranker | **REJECT** — wrong semantics |
| C Second model / LLM / POS / extra runtime | **REJECT** |
| D Rule engine / regex / hardcoded 行 map | **REJECT** |
| Shadow / dual path / compatibility flag | **REJECT** |
| Model2 generates characters | **REJECT** |
| Replace IME 2510 in place | **REJECT** |
| Frequency Top1 | **REJECT** |

## Target List

1. User confirms this ACP.
2. Candidate-set interface V1 (Recall emit internal set; default still fail-closed until head exists).
3. Ambiguity head + candidate-relative features; frozen trunk train.
4. Generalization eval (held-out chars/sets/contexts).
5. Independent: repair lexicon freeze + license; minPrior/prior ACP.
6. Bind selected hit through existing materialization.
7. Joint regression vs Stage J freeze metrics.

## Check List

- [ ] No sqlite import this ACP
- [ ] No IME 2510 edit
- [ ] No second Model2
- [ ] No JobResult schema change
- [ ] No Assembly/KenLM/budget/domain-vote redesign
- [ ] N=0/1 skip Model2
- [ ] N>1 only
- [ ] ABSTAIN fail closed
- [ ] Ops vocab update without retrain
- [ ] dialog_200 not in train
- [ ] P/D regression suite required

## Rollback / Recovery Principle

If the new head misbehaves: **do not call it** (N>1 keeps today’s fail-closed). Do not ship a shadow dual path. Revert is “ambiguous length-1 remains no candidate”, which is the current production behavior. Frozen P/D checkpoint remains loadable if new weights are a **new** file; do not overwrite `expA_frozen_trunk.pt` in place.

## Development order (required)

**B then bind lexicon:** implement candidate-set interface + synthetic-set training **before** locking a production repair word list. Operations will keep editing membership; Model2 must not wait for a fixed 1125-class freeze.

A (lexicon first then Model2) risks encoding that specific inventory as classes.

Production go-live still requires a finalized repair lexicon **and** a minPrior/prior resolution — both currently HOLD from prior audits.

## Complexity guardrail

Reuse existing Model2 sidecar, existing context (`rawText`), existing Recall query, existing materialize, existing Assembly, existing KenLM. No LLM, no second chain, no new domain subsystem.
