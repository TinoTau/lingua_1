# Owner Matrix — Enumeration & Diversity

| Concern | Sole Owner (required) | Current Owner | Status |
|---------|----------------------|---------------|--------|
| Repair-subset combination enumeration | Assembly | `buildSentenceCandidates` | **Owned** |
| Gap canonical fill | Assembly | `buildPathFromRepairs` | **Owned** |
| Path-local exact-text dedup | Assembly | `Map` in `buildSentenceCandidates` | **Owned** |
| Global exact-text dedup + ≤16 | CrossPath | `mergeCrossPathSentenceCandidates` | **Owned** |
| Per-span option budget | Assembly upstream | `budgetPerSpanCandidates` | **Owned** |
| Sentence near-duplicate policy | **Must be ONE** | **None** | **MISSING** |
| Sentence / semantic diversity objective | **Must be ONE** | **None** | **MISSING** |
| Domain bucket sentence quota | Assembly orchestrator (claimed) | Function computes but **unused** | **INCONSISTENT** |
| KenLM ranking | KenLM | `rerankFwSentences` | Out of scope |
| Tone / Recall admission | Recall / Tone | — | Out of scope |

## Freeze implication

```text
Enumeration algorithm Owner = Assembly  → clear
Candidate Diversity Owner               → UNASSIGNED
⇒ ASSEMBLY_CONTRACT_INCOMPLETE
```
