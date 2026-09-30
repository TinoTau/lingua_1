# Lingua Model2 Stage D — Real Lexical / Domain UserProfile Writeback
# Acceptance Report
# Date: 2026-08-17

**Mode:** Acceptance against DEVELOPMENT gates (no training, no Stage J execution).

**Artifacts:** `training/model2_v3/experiments/v3_stage_d_real_writeback_dev/`

---

## Acceptance Gates

| # | Gate | Result |
|---|------|--------|
| 1 | Lexical semantics contract | **PASS** |
| 2 | Known corrected term → Lexicon identity | **PASS** |
| 3 | Unknown remains unresolved | **PASS** |
| 4 | No automatic Lexicon insertion | **PASS** |
| 5 | Wrong ASR surface not lexical preference | **PASS** (stores intended target only; unresolved if not in Lexicon) |
| 6 | Repeated term evidence | **PASS** (EMA monotonic) |
| 7 | Overlap policy deterministic | **PASS** |
| 8 | Multi-tag domain derivation | **PASS** |
| 9 | term_domain_tags only knowledge SSOT | **PASS** |
| 10 | compact long_term_domain_evidence | **PASS** |
| 11 | incremental / bounded update | **PASS** |
| 12 | train/prod parity | **PASS** (120/120) |
| 13 | UserProfile version increments | **PASS** |
| 14 | Node/session bounded compatible profile | **PASS** (schema + refresh) |
| 15 | no self-reinforcement | **PASS** |
| 16 | Runtime Skeleton unchanged | **PASS** |
| 17 | Stage P unchanged | **PASS** |
| 18 | Stage J not started | **PASS** |
| 19 | no second domain SSOT | **PASS** |
| 20 | architecture conformance | **PASS** |

---

## Metrics (from artifacts)

| Metric | Value |
|--------|-------|
| Parity scenarios | 120, mismatches 0 |
| EMA @1 / @5 / @20 | ~0.25 / ~0.76 / ~0.997 |
| Profile size 10/100/500/1000 | within 32KiB via TopK100 |
| Aggregate P50/P95 (Python microbench) | see `stage_d_writeback_latency.json` |
| Gateway unit tests | 30 passed |

---

## FINAL VERDICT

```
Stage D Real UserProfile Writeback:
PASS

Frozen Model2 Runtime Skeleton:
UNCHANGED

Lexical Profile Semantics:
PASS

Correction-Confirmed Lexical Evidence:
PASS

Lexicon Term Resolution:
PASS

Lexicon Identity Representation:
term_id + canonical surface (evidence keyed by term_id)

Unknown Term Contract:
PASS

Unknown Term Auto-Inserts Lexicon:
NO

Wrong ASR Surface Stored As Preference:
NO

Personal/Common Term Persistence:
PASS

Repeated Evidence:
PASS

Single Correction Dominance:
PASS

Overlap Policy:
PASS

Overlapping Double Count:
NO

MultiTag Domain Derivation:
PASS

term_domain_tags SSOT:
PASS

Second Domain SSOT:
NO

LongTerm Domain Evidence:
PASS

Incremental Domain Update:
PASS

Training / Production Profile Contract:
MATCH

DomainUpdates Knowledge Writer:
NO

Profile Versioning:
PASS

Live Session Profile Refresh:
PASS

Session Payload:
BOUNDED

Self Reinforcement:
NO

Profile Size 100:
within_32kib (TopK)

Profile Size 500:
TopK truncates to 100; within_32kib

Profile Size 1000:
TopK truncates to 100; within_32kib

Writeback P50:
see stage_d_writeback_latency.json (aggregate microbench)

Writeback P95:
see stage_d_writeback_latency.json

Stage P Regression:
UNCHANGED

Stage D Runtime:
DEFERRED

Stage D Real Data Contract:
READY

Stage J:
READY_FROM_DATA_CONTRACT

Architecture Conformance:
PASS

Remaining P0:
none for writeback contract

Remaining P1:
optional ops hardening (lexicon path deployment, refresh observability)

Recommended Next Phase:
Stage D final freeze review → Stage J unified training on StageDProfileContractV1
(RETRAIN_REQUIRED_FOR_STAGE_J = true; do not wire Stage D checkpoint into Runtime Skeleton yet)
```

---

## Notes

- `READY_FROM_DATA_CONTRACT` means production can emit Stage-D-semantic profile fields; **Stage J training has not started**.
- Stage D **runtime inference** remains deferred; Runtime Skeleton stays Stage-P-only until a future approved swap of artifact + compatible inputs.
