# 04 — Ownership Snapshot

| Module | Owns | Does not own |
|--------|------|--------------|
| Tone / Exact Recall | Mandatory tone · Mode C SQL | Assembly / KenLM |
| Lexicon | Atomic terms · term_domain_tags | Fragment recall |
| Compatibility | Active candidate graph resolve | Domain Vote · Model2 |
| Model2 Stage-J | P/D actions · profile/domain materialize into activeCandidates | Domain Vote · KEEP/RETRY · single-char ambiguity · sentence ranking |
| Domain Vote | Presence vote · retained domains · Domain Anchor source | Sentence diversity · Model3 trigger |
| SameDomain | Retained-domain bucket membership | Anchor scoring |
| Assembly | Enumeration · Formula A metadata · path-local exact dedup | Semantic similarity · KenLM |
| CrossPath | Merge · exact-text first-wins · ≤16 | Generation · recompute completeness · ranking |
| KenLM | Score · rank · pick | Create candidates · completeness · Tone · Model3 trigger |
| Model3 (planned) | KEEP/RETRY on non-anchor spans only | Anchor discovery · lexicon lookup · final text · Domain Vote |

**Path-local order (CODE_REALITY):** Tone Rebind → Compatibility → Model2 P/D → Domain Vote → SameDomain → Assembly.

**Candidate Semantic Diversity:** no Sole Owner — deferred (Top16 not saturated).
