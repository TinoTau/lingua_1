# Full Rebuild Source SSOT (v1)

**PRODUCTION FULL REBUILD INPUT** — not seed-only shadow.

| File | Purpose |
|------|---------|
| lexicon_full_corrected_review.csv | Primary term SSOT |
| terms_to_remove_or_rebuild.csv | Exclude list |
| supplemental_terms.csv | +73 terms / tags |
| term_domain_tags_corrected.csv | Domain tags |
| sources.manifest.json | Hashes + load order |

Idiom SSOT: `p1_3_.../idiom_zh_v2/entries.jsonl`  
Hierarchy SSOT: `electron_node/electron-node/data/lexicon/profile-registry.json`

Build: `npm run lexicon:full-rebuild` (from electron_node/electron-node).

Default Atomicity mode: **audit** (records ACCEPT/EXCEPTION/REJECT/UNRESOLVED, does not delete rows).  
Enforce: `npm run lexicon:full-rebuild -- --force --atomicity-mode=enforce` (after Source cleanup).

Optional Source columns (review + supplemental only): `term_type`, `exception_reason`.  
Tags CSV / remove list do not need these fields. Missing fields → audit report only.

Do **not** use `lexicon:build:v2-shadow` + `prepare:v3-runtime` for production.
