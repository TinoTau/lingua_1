# Stage D2 — Domain Multi-Tag Dataflow Audit

**Date:** 2026-08-16  
**Phase:** `MODEL2_V3_STAGE_D2_MULTI_DOMAIN_HARDENING`  
**Stage D1 baseline (do not overwrite):** multi-tag training index count = **0**; CrossDomainTerms FAIL 13/40

---

## Q1 — Why schema allows multi-tag but training index has 0?

### Pipeline

| Step | Input | Output | Expected tags/term | Actual | Lossy? |
|------|-------|--------|--------------------|--------|--------|
| 1. Lexicon SSOT CSV `term_domain_tags_corrected.csv` | term_id × domain_id rows | 620 tag rows / 551 terms | multi allowed | **46 multi-tag terms** (2–4 tags) | NO |
| 2. SQLite `term` + `term_domain_tags` | Schema V2 SSOT | multi rows per term_id | multi | (materialize source) | NO (by design) |
| 3. Materialize → `domain_lexicon` | term + tags | **one row per (term, domain_id)** | flatten OK for routing | single domain_id column | **Intentional flatten** (not Model2 SSOT) |
| 4. `build_candidate_index_from_sqlite` | domain_lexicon row | `CandidateRecord(domain_ids=[row.domain_id])` | should re-aggregate | **always len=1** | **YES — first-tag-only / no re-aggregate** |
| 5. `candidate_index.jsonl` (Stage D1 training) | records | 9914 records | multi-tag records > 0 | **multi_tag_records = 0** | YES (propagates #4) |
| 6. Same surface, multiple domain rows | e.g. 中杯 × 3 domains | 3 separate `term_id`s | one lexical term, many tags | 3 identities, 1 tag each | **YES — identity split** |
| 7. Stage D dataset `target_domains` | single CandidateRecord | list from that record | all tags | usually **1** | YES |
| 8. `derive_domain_evidence` via `by_surface` | all surface hits | union of each hit’s tags | multi if siblings exist | **can recover multi** if all sibling rows loaded | Partial (works only if all flatten rows present) |

### Loss locus (authoritative)

**Primary lossy transform:**  
`training/model2/candidates/index.py` → `build_candidate_index_from_sqlite`

```text
domain_ids=[row["domain_id"]]   # never JOIN / aggregate term_domain_tags
term_id = domain:{domain_id}:{word}:{pinyin}  # splits one term into N identities
```

**Not** “source has zero multi-tag data”.

---

## HARD STOP check

| Gate | Result |
|------|--------|
| Real SSOT multi-tag count | **46 / 551** in `term_domain_tags_corrected.csv` |
| Verdict | **SOURCE_DATA_MULTITAG_PRESENT** — continue; do **not** invent synthetic tags to fake SSOT |
| If source were empty | Would report `SOURCE_DATA_MULTITAG_MISSING` and STOP training |

---

## Q2 — Why single-domain lock on multi-domain / generic terms?

1. **Index presents one domain per CandidateRecord** → teacher / labels / soft targets often one-hot.
2. **Stage D1 MULTI_DOMAIN persona** still competes with always-select-top-k decode (no true NO-ACTION).
3. **Generic terms** that should emit soft distributed evidence are taught as single-domain actions when only one tag is visible on the chosen record.
4. **Surface-level multi-domain exists** (44 surfaces with ≥2 domain sibling rows) but **record-level multi-tag = 0** → CrossDomain eval sees lock-prone one-hot structure.

---

## Q3 — Why Correct (0.3125) ≈ Swapped (0.3000)?

1. **Objective mismatch:** multi-label BCE without strong Correct-vs-Wrong/Swapped ranking.
2. **Budget always fill:** Wrong/Empty still emit ~7/8 candidates → weak policy selectivity signal.
3. **Forced domain pick:** no NO-ACTION / low-budget path for Empty/Wrong.
4. **Overlap:** Swapped still selects “some” domain action; DomainActionHit only checks intersection with target domains — weak margin metric.
5. **Multi-tag blindness** reduces distinctive evidence between Correct and Swapped profiles.

---

## Governance

- `term_domain_tags` remains **sole domain-tag SSOT**.
- UserProfile must **not** duplicate term→domain maps.
- Fix = **re-aggregate into Model2 training index / evidence**, not new mapping configs.

---

## Follow-up (Stage D2)

1. Rebuild Stage D training index preserving **all** tags per surface/pinyin (and/or from SSOT CSV).
2. Soft multi-label teacher; contrastive Correct vs Wrong/Swapped.
3. Budget = max, not must-fill; allow NO domain action.
4. Re-measure CrossDomain lock rate and Correct−Swapped margin.
