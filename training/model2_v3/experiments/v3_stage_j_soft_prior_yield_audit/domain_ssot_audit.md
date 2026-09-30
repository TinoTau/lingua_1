# Domain SSOT Audit

## Python Stage D retrieval tags

`soft_domain_retrieve` reads `CandidateRecord.domain_ids` (`domain_actions.py` L90–94).

On the frozen D2 index those fields come from:

1. Sibling merge of `domain_lexicon` flatten rows (`multitag.py` `enrich_index_multitag` L42–62)
2. SSOT CSV `electron_node/docs/lexicon-assets/full_rebuild_v1/term_domain_tags_corrected.csv` (`load_ssot_word_domains` L16–25; applied L64–83)

This audit: missing_tag=0, ssot_tags_not_on_record=0, first_tag_collapse_vs_ssot=0, multi_tag identities=44/588.

## Other domain sources (not used as the D2 score SSOT)

| Source | Role | Drift? |
|--------|------|--------|
| `DOMAIN_SLOT_IDS` in `training/model2/contract.py` L75–88 | Static 12-slot action catalog | Catalog not rebuilt from live Lexicon at Python eval start |
| `build_candidate_index_from_sqlite` L118 `domain_ids=[row["domain_id"]]` | Unenriched flatten | Historical first-tag; **not** the D2 index used here |
| Node `term_domain_tags` SQL in `queryDomainMultiRowsAtomic` | Node recall | Not on Python Stage D path |
| UserProfile `long_term_domain_evidence` | Derived via `derive_domain_evidence` → `aggregate_domain_evidence` | Not a duplicate mapping SSOT; resolved from index at use time (`domain_actions.py` L39–48) |

## DOMAIN_SSOT_DRIFT

**YES (mild):** action catalog is frozen `DOMAIN_SLOT_IDS`, not a live registry from the index. Tag facts on the D2 index match SSOT CSV for this snapshot.

**NO second mapping SSOT** on the Python score path: no alias file / hard-coded term→domain map in `soft_domain_retrieve`.
