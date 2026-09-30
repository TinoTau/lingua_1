# Model2 V3 — UserProfile Feature Audit

Markers: `MODEL2_V3` / `USERPROFILE_EXTENSION_CONTRACT`

Runtime SSOT: `central_server/api-gateway/src/user_profile.rs`  
Feature keys: `scheduler/.../feature_schema.rs` ↔ `training/model2/contract.py`

## Top-level Runtime UserProfile V1

| field | type | source | meaning | runtime | training | populated | used | Model2 V3 role | class |
|-------|------|--------|---------|---------|----------|-----------|------|----------------|-------|
| schema_version | u32 | user_profile.rs | contract version | YES | meta | YES | meta | version gate | READY |
| profile_version | u64 | user_profile.rs | optimistic lock | YES | ref | YES | bootstrap | freshness | READY |
| phonetic_bias | map→f64 | user_profile.rs + 16 keys | pronunciation relations | YES | YES | YES (synth/real) | V2/V3 core | profile item set (type=phonetic) | READY |
| tone_bias | map→f64 | 12 tone keys | tone confusions | YES schema | masked | mostly empty | NO main path | set encoder type=tone | DEFERRED_BY_DATA (Tone HOLD) |
| personal_terms | string[]≤100 | user_profile.rs | personal lexicon preference | YES | candidate feats | partial | Stage A/B feats only | profile items type=personal_term + personal_term_query primitive | PARTIAL |
| personal_term_evidence | map→f64 | Rust only (TS gap) | Top-K evidence | YES gateway | rank proxy | partial | eviction | strength/confidence on personal items | PARTIAL |
| confusion_bias | map→f64 | schema | reserved confusion | YES schema | NO | NO | NO | extension slot | UNUSED / DEFERRED |
| domain_bias | map→f64 | →12 domain slots | domain prior | YES | domain_prior partial | sparse | not in V2 recall | domain_filtered_query + routing head when data exists | PARTIAL |
| speaking_habits | — | **no field** | product narrative | NO | NO | NO | NO | future item type; not deleted from product contract | DEFERRED (interface reserved) |

## Phonetic relations (16) — pronunciation

| key | class | V3 training | note |
|-----|-------|-------------|------|
| n_l,z_zh,ch_c,sh_s,eng_en,in_ing,h_f | BOUND / ACTIVE_SET_V1 | READY | validated reverse-map |
| s_sh,en_eng | WEAK | DEFERRED until quality audit pass | do not force-include |
| l_n,zh_z,c_ch,an_ang,ang_an,ing_in,f_h | REVERSED | DEFERRED | schema retained; not silently deleted |

Strength: runtime continuous f64; training buckets LOW/MED/HIGH → 0.2/0.5/0.8 (`V2_INITIAL_CONTRACT` / extendable).

## Manual correction derived

| path | feeds | V3 role | class |
|------|-------|---------|-------|
| phonetic_updates | phonetic_bias | same as phonetic items | READY |
| personal_term_updates | personal_terms/evidence | personal items | PARTIAL |
| tone_updates / domain_updates | often empty V1 | reserved | DEFERRED_BY_DATA |

## Governance

- Do **not** delete PARTIAL/DEFERRED/UNUSED dimensions because only phonetic is dense today.
- They remain Model2 extensibility contract; V3 round-1 trains on READY (+ synthetic multi-item cardinality stress).
- `speaking_habits`: `DEFERRED` interface — **NOT_PART_OF_MODEL2 is forbidden wording**; use `DEFERRED_BY_SCHEMA`.
