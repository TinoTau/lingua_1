# Owner Matrix — Repair Completeness

Baseline: `FW_V4_FREEZE_2026_08_03` · Rule: **One Sole Owner · No Overlap**

## Concern: Repair Completeness

| Role | Module | Allowed? |
|------|--------|----------|
| **Sole Owner / Producer** | Sentence Assembly (`buildSentenceCandidates`) | **YES — REQUIRED** |
| Carrier DTO | `SentenceCombination` metadata | **YES** |
| Consumer (optional future) | CrossPath Admission | Consume only — no recompute |
| Non-owner | `mergeCrossPathSentenceCandidates` (today: dedupe+cap only) | MUST NOT calculate independently |
| Non-owner | `rerankFwSentences` / KenLM | MUST NOT know / score / filter by it |
| Non-owner | Exact Recall / Tone / Presence Vote | MUST NOT own completeness |

## Existing Sole Owners (unchanged)

| Concern | Sole Owner | Not Owner |
|---------|------------|-----------|
| FineSpan / Path | Lattice | KenLM / Vote |
| Formal Candidate Recall | Exact Recall | Assembly / KenLM |
| Domain decision | Presence Vote | KenLM |
| Sentence generation | Assembly / CrossPath merge | KenLM |
| Language ranking | KenLM | Recall / Assembly fluency |
| **Repair Completeness (proposed)** | **Assembly** | **CrossPath calc · KenLM · Recall** |

## Forbidden patterns

```text
Assembly computes completeness
AND CrossPath recomputes from text
AND KenLM filters by completeness
→ OWNERSHIP OVERLAP — REJECTED
```

```text
CrossPath infers PARTIAL from substring heuristics
without Assembly metadata
→ SECOND OWNER — REJECTED
```

## Overlap check (this freeze)

| Risk | Result |
|------|--------|
| Assembly ∩ CrossPath independent completeness | FORBIDDEN by this audit |
| Assembly ∩ KenLM | FORBIDDEN |
| Completeness ∩ Language ranking | NONE — KenLM remains LM-only |
| Metadata attach ∩ Runtime admission | SEPARATE — metadata alone is not a Gate |
