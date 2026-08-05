# SentenceCombination Contract — Repair Completeness (Freeze Proposal)

> Status: **AUDIT FREEZE PROPOSAL** — not yet CURRENT SSOT.  
> Baseline: `FW_V4_FREEZE_2026_08_03`  
> Preceded by: `2026-08-05_Partial_Repair_Candidate_Admission_Audit` (`NO_REPAIR_COMPLETENESS_CONTRACT`)

## 1. Current DTO (frozen fact)

```ts
// build-sentence-candidates.ts
export type SentenceCombination = {
  text: string;
  replacements: SpanReplacementPick[];
  candidateScore: number;
};
```

`SpanReplacementPick` already carries: `span`, `word`, `source`, `repairTarget`, `candidateScore`, …

**Absent:** any field equivalent to Repair Completeness.

Data Contract snapshot (`04_Data_Contract.md`):

```text
SentenceCombination = { text, replacements[], candidateScore }
```

## 2. Proposed Metadata (contract intent — not implemented)

```text
repairCompleteness: RAW | PARTIAL_REPAIR | COMPLETE_REPAIR | MIXED_BUT_VALID
```

Optional supporting diagnostics (same owner, non-decision unless contracted):

```text
repairPickCount
canonicalGapCount
```

## 3. Sole Owner

| Concern | Sole Owner |
|---------|------------|
| **Repair Completeness value** | **Sentence Assembly** (`buildSentenceCandidates` at combination birth) |
| CrossPath | Consumer only — MUST NOT recompute |
| KenLM | Unaware — MUST NOT read or recompute |
| Recall / Tone / Vote | Not owners |

## 4. Derivation boundary

Completeness MUST be a **pure function** of Assembly-local inputs available when the combination is built:

```text
rawText
+ SentenceCombination.replacements[]
  (repairTarget picks + canonical_exact gap fills already attached)
```

MUST NOT:

```text
re-query Tone / SQLite
re-run Recall
re-vote Domain
call KenLM
infer from final text alone without replacements[]
```

Exact enum formula (PARTIAL vs COMPLETE vs MIXED) is **implementation contract work after this ownership freeze**; it must remain Assembly-owned and deterministic.

## 5. Runtime behaviour of metadata-only freeze

| Change | Behaviour? |
|--------|------------|
| Attach `repairCompleteness` metadata | **No** admission / ranking change if unused |
| CrossPath later consumes for budget | Separate development — explicit Admission Contract |
| KenLM | Remains score/rank/pick only |

Metadata extension ≠ hidden Gate.  
Admission policy that *uses* metadata must be a separate, explicit contract.

## 6. SSOT / SRP

```text
ONE producer: Assembly
ONE carrier: SentenceCombination
ZERO independent calculators in CrossPath / KenLM
```

Preserves One Sole Owner (`06_Ownership.md`).  
Preserves KenLM boundary (`11_KenLM_Runtime_Boundary.md`).
