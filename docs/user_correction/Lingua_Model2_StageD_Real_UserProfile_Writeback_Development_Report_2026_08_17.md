# Lingua Model2 Stage D — Real Lexical / Domain UserProfile Writeback
# Development Report
# Date: 2026-08-17
# Label: STAGE_D_REAL_USERPROFILE_WRITEBACK_DEVELOPMENT

**Scope:** Development + testing. No model training. No Stage J. No Model2 Runtime Skeleton change.

**Baseline:** `Lingua_Model2_StageD_Real_Lexical_Domain_UserProfile_Writeback_PreDevelopment_Audit_2026_08_17.md`

**Artifacts:** `training/model2_v3/experiments/v3_stage_d_real_writeback_dev/`  
**Semantics contract:** `docs/user_correction/stage_d_lexical_profile_semantics_contract.md`

---

## 1. What was built

### P0-A — Lexical profile semantics
Frozen as **USER-CONFIRMED LEXICAL OBSERVATION**: only Manual Correction → Lexicon-resolved terms enter long-term lexical/domain evidence. Unconfirmed ASR never writes.

### P0-B/C — Lexicon-backed resolution + unresolved
Gateway opens production Lexicon SQLite **read-only** (`persistence.lexicon_db_path` → `node_runtime/lexicon/v3/lexicon.sqlite`).

- Exact surface resolve → `term_id` + `term_domain_tags`
- Ambiguous / missing → `UNRESOLVED_LEXICAL_OBSERVATION` (diagnostic only)
- **No** Lexicon auto-insert, **no** fake `term_id`, **no** fuzzy writeback

Overlap policy:
1. Whole-candidate exact match wins (prevents 接口+文档+接口文档 triple-count when phrase exists)
2. Else greedy longest-match L→R; covered nested spans rejected with trace

### P0-D — Lexical statistics
`UserProfile` schema_version **2**:
- `resolved_lexical_terms` (term_id → surface/evidence/confirm_count)
- `personal_term_evidence` keyed by **term_id**
- `personal_terms` = TopK canonical **surfaces** (Stage D hash compatibility)
- EMA α=0.25 toward 1.0 (mitigates single-correction dominance)
- TopK 100 + 32 KiB retained

### P0-E — Write-time multi-tag domain evidence
`long_term_domain_evidence` derived at apply time via **normalized_weighted_multitag** (same as Stage D training). Bounded rebuild from TopK≤100 (not full history scan).

`domain_updates` remains **not** a Stage D knowledge writer.

### P0-F — Train/prod parity
Python golden: 120 scenarios, **0 mismatches** (`stage_d_train_prod_domain_evidence_parity.json`).  
Rust unit tests cover resolve / multitag / EMA / unknown / overlap.

### P1-A — Node schema
`UserProfileV1` TS updated with `personal_term_evidence`, `resolved_lexical_terms`, `long_term_domain_evidence`, unresolved/legacy fields (electron_node / central_server / webapp shared protocols).

### P1-B — Live profile refresh
After Gateway apply: `POST /api/v1/sessions/profile-refresh` → Scheduler `RefreshUserProfile` (clears bootstrap gate) → force `SessionBootstrap` → Node `Map.set` overwrite.

---

## 2. Ownership preserved

```
Manual Correction
  → candidate surfaces (Scheduler features / ProfileDelta)
  → Lexicon exact resolve (Gateway readonly SSOT)
  → UserProfile lexical stats (Gateway SSOT)
  → term_domain_tags → long_term_domain_evidence
  → SessionBootstrap / refresh → Node cache
```

Model2 Runtime Skeleton, Stage P sidecar, FineSpan, Assembly, KenLM: **untouched**.

---

## 3. Tests run

| Suite | Result |
|-------|--------|
| `api-gateway` `cargo test --lib` | **30 passed** |
| Stage D train/prod parity script (120) | **PASS** |
| `scheduler` `cargo check` | **OK** |

---

## 4. Explicit deferrals

- Stage D / Stage J **runtime** checkpoint wiring — DEFERRED
- Stage J training — **not started** (`RETRAIN_REQUIRED_FOR_STAGE_J` when unifying on StageDProfileContractV1)
- Session domain prior — still separate / not implemented as Model2 input
- Wrong/Swapped budget & SameDomain interaction — secondary MONITOR

---

## 5. Migration

Existing free-text `personal_term_evidence` keys: exact Lexicon match → resolved; else → `legacy_free_text_personal_terms`. No silent delete. No auto Lexicon insert.
