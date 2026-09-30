# LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1

| Field | Value |
|---|---|
| FREEZE_ID | `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1` |
| Date | 2026-09-14 |
| Phase | `LINGUA_POST_STAGE2_TONE_RELAX_SSOT_FREEZE_AND_CONTROLLED_PILOT200_REMEASURE` / PHASE_A |
| Mode | DOCUMENTATION_FREEZE → then CONTROLLED_REMEASURE |
| Product code this round | **NO** |

---

## 1. Freeze verdicts (Phase A gate)

| Gate | Value |
|---|---|
| PHASE_A_STATUS | **PASS** |
| FREEZE_ID | `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1` |
| ACP_STATUS | **APPROVED_IMPLEMENTED_FROZEN** |
| DUPLICATE_ACTIVE_SSOT | **NO** |
| SSOT_CONFLICT_COUNT | **1** (soft / marked superseded) |
| UNRESOLVED_SSOT_CONFLICT_COUNT | **0** |
| CODE_SSOT_MATCH | **PASS** |
| FREEZE_IDENTITY_CREATED | **YES** |
| PRODUCT_CODE_CHANGED_DURING_FREEZE | **NO** |
| PILOT_ALLOWED | **YES** |

---

## 2. Authoritative runtime architecture (frozen)

### 2.1 Model2

```text
MODEL2_INSERTION_SSOT = AUG12_PRE_LEXICAL_EDGE
MODEL2_ON_MODEL3_RETRY = NO
```

FineSpan overlapping lexical windows → Base/Exact Recall → Model2 user-conditioned pronunciation expansion → candidate merge → LexicalEdge → segmentation → Domain Vote → Anchor → Model3 → Retry if requested → SameDomain/Assembly → KenLM.

### 2.2 Tone

```text
NORMAL_FIRST_PASS_TONE_POLICY = PINYIN + TONE EXACT
Missing Tone on mandatory first-pass Tone Recall = FAIL CLOSED
Tone evidence = ORIGINAL AUDIO / FineSpan-local (no path-level first-nonempty Tone reuse)
Long-term Tone accuracy target unchanged (>=95% + N-char sequence metrics)
```

### 2.3 Model3

```text
MODEL3_ROLE = ANCHOR-CONDITIONED TEXT REPAIR TRIGGER
MODEL3_DECISION = KEEP / RETRY
MODEL3 unit = PathFineSpan
MODEL3_CHANGE_REQUIRED = NO
```

Model3 does not choose corrections; does not consume candidate identity / Model2 internals / Tone tensor / KenLM score.

### 2.4 Anchor

```text
PROFILE_PRONUNCIATION = AUTOMATIC ANCHOR
DOMAIN_TERM / PASSIVE_DOMAIN_WEAK / SAMEDOMAIN / RETAINED_DOMAIN /
PROFILE_DOMAIN / PROFILE_RETRIEVAL = NO ANCHOR AUTHORITY
```

Domain evidence does not suppress Model3 Retry.

### 2.5 Domain

Domain Vote remains upstream of Model3 Retry and is **not** rerun during Retry. Path-level retainedDomains remain path-specific. SameDomain organizes candidates downstream.

### 2.6 Model3 Retry Stage2 (ACP)

| Item | Value |
|---|---|
| ACP | `LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1` |
| Status | **APPROVED / IMPLEMENTED / FROZEN** |
| First pass `recallMode` | `tone_exact` |
| Stage2 only `recallMode` | `model3_retry_pinyin_domain_recovery` |

Stage2: pinyin required; Tone hard gate OFF; runtime `retainedDomains` reused; Base + retained-Domain + legal Idiom eligibility unchanged; no all-domain fallback; no Domain Vote; no Model2; no new Anchor.

### 2.7 Retry budget

```text
MERGE_SHARED_BUDGET
existing ∪ Retry → dedup (existing wins key collision) → unified score order → same perSpanCap
No reserved slot / source protection / cap increase
```

### 2.8 Downstream

SameDomain / Assembly / KenLM = **UNCHANGED**. KenLM remains final assembled scoring owner.

---

## 3. Document authority classification

| Document | Class | Role |
|---|---|---|
| `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1.md` (+ `.json`) | **ACTIVE_SSOT** | Runtime freeze identity after Stage2 Tone-relax |
| `LINGUA_ACP_MODEL3_RETRY_STAGE2_TONE_RELAXATION_V1.md` | **IMPLEMENTED_ACP** / ACTIVE contract for Stage2 recallMode | Single Stage2 Tone-relax authority |
| `LINGUA_STAGE2_TONE_RELAX_ACCEPTANCE_REPORT.md` | **ACCEPTANCE_EVIDENCE** | Impl acceptance (E5 recall-boundary) |
| `LINGUA_STAGE2_TONE_RELAX_IMPLEMENTATION_DEV_REPORT.md` | **ACCEPTANCE_EVIDENCE** | Impl inventory |
| `LINGUA_DIALOG2000_V2_PILOT200_SSOT.md` | **ACTIVE_SSOT** (dataset / Pilot research question only) | Unchanged Pilot identity |
| `model3_retry_contract_v1.md` | **HISTORICAL_REFERENCE** + soft conflict marked | Retry geometry SSOT; Tone Stage6 line **SUPERSEDED_BY** Stage2 ACP |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` | **ACTIVE_SSOT** (Model3 KEEP/RETRY role) | Unchanged; Stage2 Tone detail owned by ACP |
| `LINGUA_MODEL3_RETRY_STAGE2_TONE_CONSTRAINT_AUDIT.md` | **AUDIT_ONLY** | Pre-ACP ownership audit |
| `LINGUA_STAGE2_TONE_RELAX_DOMAIN_PREDEV_AUDIT.md` | **AUDIT_ONLY** | Predev; draft status superseded by ACP IMPLEMENTED |
| `LINGUA_PILOT200_POST_ANCHOR_ACP_*` | **TEST_REPORT** | Controlled Pilot baseline **before** Stage2 Tone-relax |
| Gate-E / Anchor / budget audits | **AUDIT_ONLY** / CLOSED findings | Do not reopen without Pilot contradiction |

```text
DUPLICATE_ACTIVE_SSOT = NO
SSOT_CONFLICT_COUNT = 1
  (model3_retry_contract_v1.md § Tone gates PARTIALLY_SUPPORTED / Stage6 — marked SUPERSEDED)
UNRESOLVED_SSOT_CONFLICT_COUNT = 0
```

---

## 4. Closed findings (do not reopen without Pilot contradiction)

MODEL2_PRE_EDGE_INSERTION · FINESPAN_LOCAL_TONE_BINDING · MODEL2_GLOBAL_RELATION_APPLICATION · COMPOUND_NON_PROFILE_ASR_ERROR · MODEL2_WINDOW_BINDING_BUG · MODEL3_INPUT_SSOT · ANCHOR_PROFILE_PRONUNCIATION_ONLY · DOMAIN_ANCHOR_AUTHORITY · RETRY_SHARED_BUDGET · NORMAL_FIRST_PASS_TONE_EXACT · STAGE2_EXPLICIT_RECOVERY_MODE · STAGE2_TONE_RELAXATION · STAGE2_RUNTIME_RETAINED_DOMAIN_REUSE · DOMAIN_ONLY_TONE_RELAXED_RECOVERY · DOMAIN_ONLY_NEGATIVE_FILTER · MULTI_DOMAIN_RECOVERY · EMPTY_RETAINED_DOMAIN_BASE_ONLY · CROSS_PATH_DOMAIN_ISOLATION — **PASS/CLOSED** as listed in phase brief.

---

## 5. Deferred (preserve)

MODEL2_USER_TONE_PROFILE · FineSpan ASR-space boundary · Model2 changed-position coverage loss · Retry/ProfileDomain score-scale · Performance optimization — **DEFERRED**.

---

## 6. CODE ↔ SSOT consistency (pre-Pilot)

| Check | Result |
|---|---|
| Default / first-pass `recallMode` = `tone_exact` | PASS (`recall-semantic-mode.ts`, collectors) |
| First-pass Tone missing = Fail Closed | PASS |
| Stage2 recovery mode explicit | PASS (`model3_retry_pinyin_domain_recovery`) |
| Stage2 only from Model3 Retry closure | PASS (`run-model3-path-step.ts`) |
| Stage2 uses runtime `retainedDomains` | PASS |
| Stage2 does not rerun Domain Vote | PASS (Vote in prepare once) |
| Stage2 does not rerun Model2 | PASS |
| Model3 KEEP/RETRY / inputs unchanged | PASS |
| Anchor PROFILE_PRONUNCIATION-only | PASS (`model3-anchor-adapter.ts`) |
| Domain does not create Anchor | PASS |
| Shared MERGE_SHARED_BUDGET / perSpanCap | PASS (unchanged this freeze) |
| SameDomain / Assembly / KenLM | PASS (unchanged) |
| No generic pinyin-only / all-domain / compatibility path | PASS |

```text
CODE_SSOT_MATCH = PASS
```

---

## 7. Freeze identity

See companion JSON: `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1.json`.

| Field | Value |
|---|---|
| architecture_version | `POST_STAGE2_TONE_RELAX_V1` |
| active_acp_ids | `LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1` (+ prior Anchor / Retry geometry ACPs as referenced) |
| git_commit | `63b253769cab6f4b11d1ded4f9c89c4a610555b3` (working tree may contain unrelated local dirt; freeze semantics = Stage2 Tone-relax product files listed) |
| lexicon_checksum | `59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19` |
| Pilot dataset | `LINGUA_DIALOG2000_V2_PILOT200` |
| Pilot frozen RAW | via `LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json` |
| Model2 / Model3 / Tone model identity | `NOT_AVAILABLE` (no dedicated freeze hash file for this round) |
| configuration identity | production defaults; **no tuning this round** |
| build identity | `npm run build:main` in `electron_node/electron-node` immediately before Pilot |

---

## 8. Pilot baseline (comparison)

Authoritative pre-Stage2 controlled Pilot:

`LINGUA_PILOT200_POST_ANCHOR_ACP_CONTROLLED_REMEASURE`

| Condition | Final correct |
|---|---|
| NO_PROFILE | 22 / 200 |
| CORRECT_PROFILE | 26 / 200 |
| WRONG_PROFILE | 22 / 200 |
| CORRECT − NO | +4 |
| WRONG − NO | 0 |

Gates A–I and first-failure owner counts verified against `LINGUA_PILOT200_POST_ANCHOR_ACP_SUMMARY.json` — **BASELINE_MISMATCH = NO**.

Historical Stage2 useful=0: **NOT_COMPARABLE_OBSERVABILITY_DEFECT**.

---

## 9. Stop condition for Phase A

All Phase A gates PASS → **PILOT_ALLOWED = YES**. Proceed to Phase B Controlled Pilot200. No product development in Phase B.
