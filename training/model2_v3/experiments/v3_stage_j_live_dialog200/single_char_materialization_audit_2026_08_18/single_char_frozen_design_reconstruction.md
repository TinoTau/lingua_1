# Single-char frozen design reconstruction

**Date:** 2026-08-18  
**Status:** AUDIT ONLY  
**Authoritative contract:** `docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md` CR **1.0.2 / 1.0.3 / 1.0.4 / 1.0.8 (1.1C)**

---

## 1. Where length-1 is supposed to run

**Answer to §5: A, with a precise owner.**

Single-char lexicon is **not** a FineSpan-second-pass lookup and not a Model2-only path.

Frozen runtime location:

```
Lattice windows 1–5
  → recallTopKForWindows
      → recallSpanTopKV2
          → collectBaseOnlySingleCharCandidate   # length===1 SSOT
      → bindLexiconHitsToWindow                  # WindowCandidate
  → lexical edge only if candidates.length > 0
  → PathFineSpan materialization
  → (optional) Model2 P/D on each PathFineSpan
```

| Option | Verdict |
|--------|---------|
| A. FineSpan recall directly produces WindowCandidate | **Partial.** Recall is **window-first**; PathFineSpan inherits window hits. FineSpan is not the query owner. |
| B. lattice fallback dedicated path | **No.** Fallback `i→i+1` is connectivity-only (`candidates=[]`). Must not bind lexicon hits. |
| C. passive single-char span | **Retired** as LTR `in_span_single_char_fallback`. `passive_domain_weak` is 2–5 weak domain, not 1-char. |
| D. base exact lookup needing another trigger | **No extra trigger.** Every 1-syllable **window** is queried (unless hard-blocked). |
| E. other | IME `single_char` dictionary is a **different chain** (minSpanChars=2). |

Design was **not cancelled**. 2510 inventory completes CR 1.0.2 data. Routing code is present (`collectBaseOnlySingleCharCandidate`). Label is **not** `FROZEN_DESIGN_IMPLEMENTATION_MISSING`.

---

## 2. Frozen length-1 policy (CR 1.0.2+)

| Rule | Value | Evidence |
|------|--------|----------|
| Trigger | Lattice window `syllables.length === 1` | `recall-topk-for-windows.ts` |
| Source table | `base_lexicon` only | `lookupBaseByPinyinAndToneKey(..., termLength=1)` |
| Domain | forbidden (`domainIds=[]`; domain SQL `<2 → []`) | CR 1.0.2 / 1.0.3 |
| Fuzzy | forbidden | `fuzzyRecallEnabled=false` on length-1 |
| Vote | does not vote | `repairTarget=false` |
| Cap | 1 | `exactTopK=1` |
| Tone | **Mandatory Tone Recall, Fail Closed** (1.1C) | non-ready → 0 hits, no plain fill |
| Ambiguity | never Top1-guess; LIMIT-full page is not unique (1.0.4) | `resolveLength1BaseCandidate` |
| Surface exact | only if uniqueness fails; `word === windowText` (1.1B) | `tryExactSurfaceBaseIdentity` |
| Candidate type | ordinary `WindowCandidate` (`source=base_term`, `hitKind=exact_term`) | `bindLexiconHitsToWindow` |
| When it **should** materialize | unique tone-exact eligible singleton **or** unique surface-exact of **ASR window text** | |
| When it **must not** materialize | tone not ready; homophone page truncated; window surface ≠ lexicon word; expected ≠ window text unless that expected char is the unique tone-exact singleton | |

LTR `windowMinSyllables=2`, legacy `local-span-recall`, IME min span 2 remain **unchanged** and are **not** the Lattice main chain.

---

## 3. Implications for dialog_200 substitutions

A true-recall unit `没 → 莓` asks for a **different character** than the ASR window.

Frozen length-1 policy:

- uniqueness among same-tone homophones is **forbidden**
- surface-exact is **window/ASR identity**, not expectedText
- `repair_target=false` (connectivity char, not a repair vote target)

Therefore **expected-target substitution is not the job of this route**, except the rare case where tone-exact eligible set is a singleton equal to the expected char.

Empty union of `莓` is compatible with frozen design even when `莓` exists in sqlite.

---

## 4. Fallback vs lexical 1-char

`injectFallbackEdges` adds length-1 edges with **empty candidates** only if the lexical graph cannot cover 0→N.

If window recall produced a 1-char `WindowCandidate`, a **lexical** 1-char edge would exist and PathFineSpan `window_source` would not be `fallback`.

On the AFTER `dialog200_after` run: **0** lexical 1-char PathFineSpans in 200 dialogs (4157 length-1 FineSpans, all `fallback`). That is a **collector / eligibility** outcome, not a missing materializer type.
