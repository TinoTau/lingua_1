# LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1

| Field | Value |
|---|---|
| ACP ID | `LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1` |
| Date | 2026-09-14 |
| Status | **APPROVED / IMPLEMENTED / FROZEN** |
| Scope | Model3-triggered bounded local Stage2 recall only |
| Implementation phase | `LINGUA_MODEL3_RETRY_STAGE2_TONE_RELAXATION_SINGLE_DELTA_IMPLEMENTATION` |
| Runtime freeze | `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1` |

### Runtime contract (authoritative)

| Path | `recallMode` | Behavior |
|---|---|---|
| First-pass / default | `tone_exact` (default) | Mandatory Tone exact; Fail Closed |
| Model3 RETRY Stage2 only | `model3_retry_pinyin_domain_recovery` | Pinyin + `domainIds=retainedDomains`; Tone hard gate off |

Wiring: `run-model3-path-step.ts` Stage2 recall closure sets recovery mode; `recallSpanTopKV2` / `collectTierCandidatesToneFirst` own Lexicon retrieval.

> TONE-RELAXED STAGE2 IS A RESIDUAL RECOVERY PATH, NOT A SUBSTITUTE FOR TONE MODEL ACCURACY.


---

## 1. Decision

**APPROVE** the following narrow semantic delta:

| Path | Recall mode |
|---|---|
| First pass (unchanged) | **PINYIN + TONE EXACT** |
| Model3 KEEP | no retry |
| Model3 RETRY → Stage2 | **PINYIN REQUIRED + TONE HARD GATE OFF + EXISTING DOMAIN CONTEXT ON** |

Stage2 recovery mode (implemented enum):

`model3_retry_pinyin_domain_recovery`

(conceptual alias from predev: `PINYIN_ONLY_WITH_DOMAIN_CONTEXT`)

Meaning:

1. Require pinyin match  
2. Disable hard Tone matching / Tone readiness Fail-Closed for this Stage2 call only  
3. Preserve `retainedDomains` → `domainIds` exactly as today  
4. Preserve existing Base + retained-Domain + (legal Idiom) source eligibility  
5. Preserve path-level independent domain hypothesis (no new Domain Vote)  
6. Preserve MERGE_SHARED_BUDGET / perSpanCap  
7. Preserve SameDomain / Assembly / KenLM  
8. Do **not** rerun Model2  
9. Do **not** change Model3 KEEP/RETRY or inputs  

---

## 2. Explicit non-goals

This ACP does **not** authorize:

- global no-Tone recall / dual production chains  
- generic empty→no-Tone fallback outside Model3 RETRY regions  
- second Model2 call  
- new Domain Vote / retainedDomains recompute  
- Domain-as-Anchor / PROFILE_DOMAIN Anchor  
- Lexicon data / DB schema / new ranking model  
- Retry budget increase or reserved slots  
- Tone model training changes  

---

## 3. Domain preservation (mandatory)

Tone relaxation changes **only** pronunciation filtering.

Stage2 MUST continue to pass the path’s already-computed `vote.retainedDomains` into `recallSpanTopKV2` as `domainIds`.

| Rule | Required |
|---|---|
| Domain Vote rerun on Retry | **NO** |
| Domain creates Anchor | **NO** |
| Domain suppresses Model3 | **NO** |
| Path-level independent domain buckets | **PRESERVE** |
| Base eligibility when `domainIds` active | **UNCHANGED** (base + retained domain tiers) |

---

## 4. Residual-recovery doctrine

> **TONE-RELAXED STAGE2 IS A RESIDUAL RECOVERY PATH, NOT A SUBSTITUTE FOR TONE MODEL ACCURACY.**

Long-term Tone target remains ≥95% per-syllable (+ lexical-window sequence KPI).  
First-pass exact Tone policy remains frozen.

---

## 5. Evidence summary (predev audit)

| Evidence | Result |
|---|---|
| Stage2 already receives `retainedDomains` | YES |
| Stage2 recomputes Domain Vote | NO |
| E5 domain-bounded pinyin recovery | **35 / 35** |
| Targets lost to domain bounding | **0** |
| Domain-bounded vs global candidate growth | median 1→1; max 4→2 (bounded tighter) |
| Budget pressure | LOW; 35/35 survive cap=4 |
| Model3 / Model2 / Anchor / Domain Vote redesign | NOT REQUIRED |

Full audit: `LINGUA_STAGE2_TONE_RELAX_DOMAIN_PREDEV_AUDIT.md`.

---

## 6. Minimal future implementation boundary

Expected product touchpoints (exact list in implementation-scope JSON):

- Stage2 recall closure (`run-model3-path-step.ts`) — set recovery mode flag only for Stage2  
- `recallSpanTopKV2` / tone-first tier collector — when recovery mode: use pinyin-key lookups (base + retained domains), skip Tone exact gate  
- Harness observability field alignment (acceptance only; no business logic change)

Must not touch: Model3 infer, Anchor adapter, Domain Vote, Model2, Lexicon DB, Assembly/KenLM algorithms, shared budget policy.

---

## 7. Acceptance gates (layered)

| Gate | Meaning |
|---|---|
| R1 | Model3 RETRY entered |
| R2 | Tone-relaxed Stage2 produced pinyin candidates |
| R3 | Target candidate recalled |
| R4 | Target compatible with retained domain **or** legal base policy |
| R5 | Target survives merge / shared budget |
| R6 | Target reaches SameDomain / Assembly |
| R7 | Target in KenLM candidate set |
| R8 | Final correction (not sole success criterion) |

Populations: 35 E5 CORRECT; correct-Tone controls; domain-sensitive; wrong-domain controls; existing Pilot successes.

---

## 8. Sign-off

| Field | Value |
|---|---|
| `ACP_DRAFT_STATUS` | **APPROVED / IMPLEMENTED** |
| `ARCHITECTURE_DECISION_REQUIRED` | **NO** |
| `IMPLEMENTATION_FEASIBLE` | **YES** |
| `ONE_NEXT_OWNER` | `STAGE2_TONE_RELAXATION_ACCEPTANCE_OWNER` |

**Do not implement in this round.**
