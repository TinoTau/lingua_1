# 06 — Ownership Matrix

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |
| Rule | One Sole Owner · No Overlap |

---

| Concern | Sole Owner | Not Owner |
|---------|------------|-----------|
| FineSpan / Path | Lattice runtime (`runLatticeFineSpanGeneration`) | KenLM / Vote |
| Formal Candidate Recall | Exact Recall (`recallSpanTopKV2`) | Assembly / KenLM |
| Atomicity | Unified Atomicity Validator (build-time) | Runtime Recall |
| Domain facts | `term_domain_tags` | Config / aliases as SSOT |
| Domain decision | Presence Vote | KenLM |
| Sentence generation | Assembly / CrossPath | KenLM |
| Language ranking | KenLM reranker (`rerankFwSentences`) | Recall |
| External transport | JobResult | Internal service DTO |

---

## Overlap Check

| Risk | Result |
|------|--------|
| Dual FineSpan producers (LTR ∩ Lattice) | NONE — LTR production NOT FOUND |
| Runtime Atomicity ∩ Build Atomicity | NONE |
| KenLM ∩ Candidate generation | NONE |
| Vote ∩ Domain tag write | NONE |

**Ownership Overlap: NONE**
