# 04 — Ownership Snapshot

| Module | Owns | Does not own |
|--------|------|--------------|
| Tone / Exact Recall | Mandatory tone · Mode C SQL | Assembly / KenLM |
| Lexicon | Atomic terms · term_domain_tags | Fragment recall |
| Domain Vote | Presence vote · retained domains | Sentence diversity |
| Assembly | Enumeration · Formula A metadata · path-local exact dedup | Semantic similarity · KenLM |
| CrossPath | Merge · exact-text first-wins · ≤16 | Generation · recompute completeness · ranking |
| KenLM | Score · rank · pick | Create candidates · completeness · Tone |

**Candidate Semantic Diversity:** no Sole Owner — deferred (Top16 not saturated).
