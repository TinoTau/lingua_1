# minPrior frozen design reconstruction

**Audit date:** 2026-08-19  
**Stage:** FW_REPAIR_V4_BIND_MIN_PRIOR_LENGTH1_AUDIT  
**Type:** READ ONLY

## Owner of the numeric default

- Runtime default: `loadFwDetectorRuntimeConfig` → `cfg.minPrior ?? 0.5` (`fw-config.ts`).
- Config SSOT: `docs/fw-detector/CONFIG.md` lists `features.fwDetector.minPrior` as **运营** (“候选 prior 下限”), not a KenLM-class framework-frozen key.
- Recall freeze: `Recall_Subsystem_Frozen_Contract_2026_08_03.md` places `bindLexiconHitsToWindow (minPrior)` **after** SQLite → merge → score → TopK, and forbids changing minPrior without Framework Impact Audit + new snapshot.

Tension: CONFIG calls it operational; Recall freeze treats changing it as a frozen-recall change. This audit does not resolve that documentation tension and does **not** change the value.

## Original business purpose (from historical records, not reverse-engineered from 2026-08-18 0-yield)

Documented purpose is **low-confidence lexical noise control** on enumerator hits before they become WindowCandidates / FineSpan edges.

Evidence:

- LexicalEdge Quality Audit 2026-07-27: minPrior=0.5 dropped `麻烦` (prior=0.35, `homophone_variant`) and similar low-prior terms. Classified as candidate-filter, not Edge Builder defect. Repair guidance: raise canonical prior or review data; **do not lower global minPrior** as a connectivity workaround.
- Import Interface Audit 2026-07-27: Patch `addTerm` default `prior_score=0.85` so that only **explicitly low** priors are filtered. Semantic: operational lexicon authority / ranking score on a 0–1 scale compatible with 0.5.
- Length 1–5 Consistency Audit 2026-07-27: for **controlled connectivity** single-char, recommended prior **0.85–0.95 (≥ minPrior 0.5)** and **全局 minPrior 不降**. Ambiguity control for single-char was uniqueness / tone / cap=1 / no fuzzy / no domain — not a second prior model.

What it was **not** originally specified as:

- A single-char homophone disambiguator (that is collector uniqueness / tone exact / cap=1).
- An IME frequency cutoff.
- A FineSpan / Vote / Assembly / KenLM gate.
- A length-specific policy with a different threshold for length=1 vs 2+.

## Lattice CR 1.0.2+

Formal length-1 edges **must** come from operational lexicon Recall with a real termId. Collector is base-only, exact-only, no fuzzy, no domain, cap=1.

CR **does not** say “bypass minPrior for length-1”.  
CR **does not** define a length-specific prior threshold.

Length-specific prior policy: **CONTRACT_GAP**.

## 2510 import (2026-08-18)

Foundation report froze **which characters exist** (2510 from IME TSV) and routing (base-only exact). It did **not** freeze a remapping of IME `weight` onto the 0.85 operational prior scale, and it did **not** waive minPrior.

Rebuild code copies TSV `weight` (typically 0.08–0.30) into `prior_score`. Multi-char CSV terms still default to **0.9**.

## Conclusion for design reconstruction

minPrior=0.5 is a **generic bind-layer prior floor** owned by Candidate Binder / Recall pre-filter, designed against low operational priors and homophone_variant noise, historically kept even for length-1 **provided** length-1 operational priors sat at 0.85–0.95.

The 2510 IME-weight passthrough was not that historical prior contract. Combining the two frozen pieces yields zero lexical length-1 edges.
