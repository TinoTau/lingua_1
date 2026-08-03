# 04 — Data Contract Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |

## Internal DTO (service)

| DTO | Role |
|-----|------|
| FineSpan / Window / LexicalEdge / Path | Lattice internal |
| WindowCandidate | Recall → Assembly |
| Domain Vote output | retainedDomains / domainScores |
| Bucket DTO | SameDomain partition |
| SentenceCombination | `{ text, replacements[], candidateScore }` |
| CrossPath output | merged ≤16 combinations |
| KenLM I/O | score batch · SentenceRerankPick |

## JobResult External Boundary

JobResult = **cross-service transport only**.  
Internal Vote/Assembly/KenLM use dedicated DTOs — JobResult must not drive internal decisions.

## Contract Debt (Known Limitation)

- KenLM `topCandidates.candidateId` synthetic `raw` / `candidate:i`  
- Do not change JobResult in this freeze  

## Lexicon Tables Present / Absent

Present: base_lexicon · domain_lexicon · idiom_lexicon · industry_routing_lexicon · term · term_domain_tags · domain_hierarchy  
Absent: term_pinyin_ngrams · parent_fragment*
