# Lingua Model2 Stage D — Real Lexical / Domain UserProfile Writeback
# Pre-Development Code Audit (READ-ONLY)
# Date: 2026-08-17
# Label: MODEL2_V3_STAGE_D_REAL_USERPROFILE_WRITEBACK_PREDEVELOPMENT_AUDIT

**Mode:** AUDIT ONLY — no code change, no training, no runtime architecture change.

**Frozen baseline (must not be redesigned this round):** Stage P Training/Runtime, Model2 Runtime Integration Skeleton, PROFILE_TARGET_ABSENT 22/22, Real UserProfile→Model2, FineSpan→Model2, Model2→LexiconRuntimeV2, termId merge, MultiRelation/MultiTag, Failure→Base Continues, Architecture Conformance.

**Artifacts:** `training/model2_v3/experiments/v3_stage_d_real_writeback_audit/`

---

## 0. Executive Verdict

真实手动纠错后，生产链**已经**写入：

1. **Pronunciation** — `phonetic_updates` → `phonetic_bias`（EMA）→ SessionBootstrap → Node Stage P — **READY**
2. **Lexical surfaces（部分）** — `personal_term_updates` → `personal_terms` + `personal_term_evidence`（自由文本 surface，非 `term_id`）— **PARTIAL**
3. **Long-term domain evidence** — **未实现**（训练侧从 Lexicon 派生；生产无写时派生、无紧凑字段）— **NOT_READY**

`domain_updates = []` **不是遗漏的“应立刻实现 Correction→domain”**：按冻结职责，domain 证据应来自 **lexical observation → Lexicon `term_domain_tags` → 聚合**，而非 Correction 直接写 domain。

**Stage J Ready: NO** — 生产尚不能生成与 Stage D 训练同语义的 profile 输入。

---

## 1. Primary Answer — What Does One Manual Correction Actually Produce?

| Artifact | Produced? | Content |
|----------|-----------|---------|
| CorrectionEventV1 (Scheduler SQLite) | YES | Full correction history |
| CorrectionFeatures | YES | text/phonetic/tone/term/domain span bundles |
| ProfileDelta.phonetic_updates | CONDITIONAL | Only ASCII syllable Replace pairs matching whitelist |
| ProfileDelta.tone_updates | ALWAYS EMPTY | No acoustic tone on correction event |
| ProfileDelta.personal_term_updates | CONDITIONAL | Replace/Insert `target_text` ≥2 chars, or macro term ≤16 chars |
| ProfileDelta.domain_updates | ALWAYS EMPTY | `NO_DOMAIN_ON_CORRECTION_EVENT` |
| UserProfile.phonetic_bias | YES if phonetic | EMA α=0.25, clamp ±5 |
| UserProfile.personal_terms / evidence | YES if term | Free-text surface; evidence += 1.0×weight; TopK 100; 32KiB |
| UserProfile.domain_bias | NO from correction | Only if PUT /profile or future domain_updates |
| Lexicon term_id resolution | NO | — |
| long_term_domain_evidence | NO | Training-only derivation |
| Live Node refresh | NO | Bootstrap once at session↔node; stale until next session |

**Next Model2 inference (current skeleton):** only consumes `phonetic_bias` for Stage P. `personal_terms` / domain evidence are **not** read by Model2 runtime.

---

## 2. STAGE_D_REAL_USERPROFILE_DATAFLOW

| Step | Owner | File / Symbol | Input → Output | Persist | Status | Gap |
|------|-------|---------------|----------------|---------|--------|-----|
| 1 | Web→Gateway | `rest_api` correction submit | BrowserCorrectionRequest → Scheduler proxy | — | ACTIVE | — |
| 2 | Scheduler | `CorrectionService.submit` + sqlite | Request → CorrectionEventV1 | SQLite history | ACTIVE | — |
| 3 | Scheduler | `normalizer` + `align` | Event → spans | derived | ACTIVE | — |
| 4 | Scheduler | `features.extract_features_with_texts` | spans → CorrectionFeatures | derived | ACTIVE | No Lexicon resolve |
| 5 | Scheduler | `profile_delta.build_profile_delta` | features → ProfileDeltaV1 | derived | ACTIVE | domain_updates=[] |
| 6 | Gateway | `apply_profile_delta` + repository | Delta → UserProfileV1 | SQLite SSOT | ACTIVE | Free-text terms |
| 7 | Gateway | `session_proxy` inject on WS | Profile snapshot | session copy | ACTIVE | Stale after later correction |
| 8 | Scheduler | `session_bootstrap.maybe_send` | session.user_profile → Node | once | ACTIVE | Full profile payload |
| 9 | Node | `sessionUserProfiles` cache | SessionBootstrap | memory | ACTIVE | TS omits `personal_term_evidence` |
| 10 | Node Model2 | `finespan-adapter` | phonetic_bias → Stage P | — | ACTIVE | Lexical/domain unused |
| 11 | — | **MISSING** | terms + term_domain_tags → domain evidence | — | NOT_IMPL | G1 |
| 12 | — | Future Stage D/J | compact domain evidence → Model2 | — | BLOCKED | G2 |

CSV: `stage_d_real_writeback_current_dataflow.csv`

---

## 3. ProfileDelta Field Audit

| Field | DEFINED_IN_SCHEMA | ACTUALLY_POPULATED | Notes |
|-------|-------------------|--------------------|-------|
| phonetic_updates | YES | YES (conditional) | Stage P path |
| tone_updates | YES | NO | Always `[]` |
| personal_term_updates | YES | YES (conditional) | Free-text target ≥2 |
| domain_updates | YES | NO | Always `[]` — see ownership §11 |
| sample_count_delta | YES | YES in struct | Apply path does not use |

JSON: `stage_d_profiledelta_field_audit.json`

---

## 4. Pronunciation Writeback Pattern (Reference Only — Do Not Modify)

```
Correction Replace (ASCII syllables)
  → phonetic feature_key (whitelist)
  → ProfileDelta.phonetic_updates {evidence, weight}
  → Gateway EMA(α=0.25×weight) → phonetic_bias
  → profile_version++
  → SessionBootstrap
  → Node Stage P
```

Merge: EMA + clamp; versioning: `profile_version` increments per applied delta.  
Stage D lexical writeback should **reuse** UserProfile ownership / TopK / size bounds / versioning — not invent a second profile system.

---

## 5. Lexical Observation Extraction (Current)

**What is extracted today**

- Per span: Replace/Insert `target_text` if char count ≥ 2 → `personal_term_candidate`
- Fallback: `extract_macro_term_candidate` — if corrected longer than system and ≤16 chars, use **entire corrected string**
- **No** Lexicon matcher, FineSpan lookup, term_id, alias, or pinyin resolution on writeback
- **No** segmentation into overlapping Lexicon terms (接口 / 文档 / 接口文档)

**Danger check (corrected text → everything becomes personal_terms)**

- Not “split all tokens”, but: **any ≥2-char corrected surface** (or whole short utterance via macro) can become a personal term → **free-text growth risk**, not lexicon-backed identity.

**Wrong surface vs intended**

- Stores **target** (intended), not source (wrong ASR) — good for lexical preference; wrong form does not become personal_term.

**Self-reinforcement**

- No evidence of uncorrected ASR auto-writing `personal_terms` → **PROFILE_SELF_REINFORCEMENT_DEFECT = NO**

---

## 6. Term Identity Contract (Current)

| Representation | Present? |
|----------------|----------|
| term_id | NO |
| lexicon-backed surface | NO |
| free-text surface string | YES (`personal_terms`) |
| evidence map surface→f64 | YES (`personal_term_evidence`) |
| hash | NO on writeback |

**Lexicon owns lexical identity** is the frozen principle; production writeback currently violates it by storing free text only.

Unknown corrected term: still stored as free text if ≥2 chars — **no UNRESOLVED_LEXICAL_OBSERVATION contract**; **must not** auto-insert into production Lexicon for Stage D.

---

## 7. personal_terms / common_terms Inventory

| Symbol | Class | Writer | Model2 consumer |
|--------|-------|--------|-----------------|
| personal_terms | ACTIVE_STORE_DEAD_CONSUMER | Gateway apply | NO (runtime) |
| personal_term_evidence | ACTIVE_PARTIAL | Gateway apply | Train YES; Node TS missing |
| personal_term_updates | ACTIVE | Scheduler | Gateway |
| domain_updates | SCHEMA_ONLY | always empty | apply shell only |
| domain_bias | SCHEMA_ONLY (correction) | PUT profile | unused by Model2 |
| common_terms / long_term_domain_evidence | TRAINING_ONLY | synthetic builders | train encode |
| lexical_profile / term_frequency | DEAD | — | — |

**Semantics:** `LEXICAL_PROFILE_SEMANTICS_UNDEFINED` — current behavior closest to “manual-correction free-text surface with additive evidence”, **not** a defined A–E contract.

CSV: `stage_d_existing_personal_term_inventory.csv`  
JSON: `stage_d_lexical_evidence_semantics.json`

---

## 8. Frequency / Confidence / Growth

| Mechanism | Behavior |
|-----------|----------|
| count | Implicit via evidence sum |
| frequency rate | NO |
| confidence | NO separate field |
| weight | Delta weight × 1.0 increment |
| last_seen / decay | NO |
| TopK | Max 100 terms |
| Size | 32 KiB hard bound |

1× correction → evidence ≈ 1.0 immediately → **SINGLE_CORRECTION_DOMINANCE_RISK = YES**  
5× / 50× → evidence ≈ 5 / 50 (additive), then TopK eviction by evidence.

**COMPACT_PROFILE_MISSING:** TopK surfaces ≠ Stage D `domain_evidence` vector (12 slots).  
**SESSION_PAYLOAD_GROWTH_RISK = YES:** SessionBootstrap sends full `UserProfileV1`.

---

## 9. Stage D Training Profile Contract

**STAGE_D_TRAINING_PROFILE_CONTRACT** (from `derive_domain_evidence` / pack):

| Input | Role |
|-------|------|
| personal_terms | Surfaces (synthetic) |
| personal_term_evidence / term_evidence | Weights |
| long_term_domain_evidence | **Derived** via CandidateIndex / `term_domain_tags`, `normalized_weighted_multitag` — **not** stored as UserProfile SSOT in train |
| session_domain_prior | On rows; **not** in pack_batch_inputs encoder |
| Max lexical hashes in forward | 32 |
| Domain slots | 12 |

Training **complies** with Lexicon multi-tag SSOT (no term→domain copy into profile). Production **cannot** yet produce the same derived evidence.

JSON: `stage_d_training_profile_contract.json`  
Matrix: `stage_d_training_vs_production_profile_matrix.csv`

---

## 10. term_domain_tags SSOT & Long-Term Domain Evidence

- **SSOT:** Lexicon `term_domain_tags` / CandidateRecord.domain_ids — **PASS** (train + Node Lexicon multi-tag)
- **UserProfile must not** persist “接口 → software” as second knowledge — **do not** fill `domain_updates` from Correction as Lexicon replacement
- **Allowed:** compact aggregated domain weights as **user state** (derived)
- Production write-time read of tags: **NOT_IMPLEMENTED**
- Incremental domain evidence update: **INCREMENTAL_PROFILE_UPDATE_MISSING**

---

## 11. domain_updates Ownership

| Question | Answer |
|----------|--------|
| Why empty? | Intentional feature gap + `NO_DOMAIN_ON_CORRECTION_EVENT` |
| Should Correction emit domain_updates? | **Likely WRONG ownership** under frozen design |
| Verdict | **PLACEHOLDER** — prefer **DEPRECATE** as knowledge writer; domain evidence = lexical → Lexicon tags → aggregate |
| Keep applying shell for soft `domain_bias`? | Optional soft preference ≠ Lexicon SSOT — clarify before any fill |

JSON: `stage_d_domain_updates_ownership_audit.json`

---

## 12. Session Domain Prior (Separate)

- Long-term ≠ session prior
- Found: `JobAssign.domainPriors` soft quota — **not** Model2 Stage D encoder input
- No LLM long-term domain writeback owner found
- Confusion into lexical UserProfile: **not found**
- Model2 session prior field: **NOT_IMPLEMENTED**

---

## 13. Ownership Matrix (Authoritative)

| Concern | AUTHORITATIVE OWNER |
|---------|---------------------|
| Correction / corrected text | User (fact) + Scheduler history |
| Lexical observation | Correction pipeline (to be lexicon-backed) |
| Term identity | **Lexicon** |
| Term frequency / lexical confidence | **UserProfile** (user state) |
| term_domain_tags | **Lexicon** |
| Long-term domain evidence | **UserProfile** (derived compact user state) |
| Session domain prior | Session / JobAssign context (not long-term profile) |
| UserProfile container | API Gateway SSOT |
| Model2 runtime representation | Bounded payload for Node (future; skeleton FROZEN) |

---

## 14. Twenty Correction Examples (Static)

See `stage_d_correction_examples.json`. Summary classes:

| Class | Expected | Actual | Gap |
|-------|----------|--------|-----|
| A pronunciation-only | phonetic | YES | — |
| B known lexical | term_id + tags→evidence | free-text surface | G1 |
| C repeated | evidence grows | YES additive | no decay |
| D multi-domain | multi-tag aggregate | no domain evidence | G1 |
| E generic | multi-tag soft | surface only | G1 |
| F unknown lexicon | UNRESOLVED | free-text stored | G5 |
| G overlapping | single policy | span/macro risk | OVERLAP RISK |
| H multiple terms | multi surfaces | per-span ≥2 | OK partial |
| I wrong≠intended | store 奶牛 not 奶流 | YES target | OK |
| J no useful | empty delta | often empty | OK |

---

## 15. Gap Classification

| Class | Findings |
|-------|----------|
| **G0** | Runtime skeleton not drifted; keep FROZEN |
| **G1** | No lexicon-backed observation; no write-time `long_term_domain_evidence` |
| **G2** | Train derives domain evidence; prod has free-text + empty domain_bias path |
| **G3** | Node TS missing `personal_term_evidence`; bootstrap stale after correction |
| **G4** | Full profile SessionBootstrap — SESSION_PAYLOAD_GROWTH_RISK |
| **G5** | LEXICAL_PROFILE_SEMANTICS_UNDEFINED; unknown/overlap policies |
| **G6** | INCREMENTAL_PROFILE_UPDATE_MISSING for domain evidence |
| **G7** | Wrong/Swapped budget selectivity; SameDomain interaction = MONITOR |

---

## 16. NEXT DEVELOPMENT TARGET LIST (Do Not Develop This Round)

| Pri | Target | Minimal direction |
|-----|--------|-------------------|
| P0 | Lexical semantics contract | correction-confirmed, lexicon-backed |
| P0 | Term resolution on writeback | surface → term_id; no Lexicon auto-insert |
| P0 | Write-time derive compact long-term domain evidence | personal terms + term_domain_tags → same formula as train |
| P0 | UNRESOLVED term policy | no free-text as fake Lexicon identity |
| P1 | Node TS + bounded Stage D fields | after contract; skeleton input swap only |
| P1 | Profile refresh after correction | version-aware minimal |
| P1 | Deprecate Correction→domain_updates as knowledge | |
| P2 | Overlap double-count policy | |
| P2 | Single-correction dominance dampening | |
| P3 | Stage J | **only after** real data semantic match |

CSV: `stage_d_next_development_target_list.csv`

---

## 17. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | Model2 Runtime Skeleton (insertion/merge/lexicon/failure) |
| KEEP | Pronunciation EMA writeback |
| KEEP | term_domain_tags Lexicon SSOT |
| KEEP | UserProfileV1 single SSOT (no UserDomainProfile DB) |
| MODIFY | extract_term → lexicon-backed observation |
| MODIFY | Gateway apply → derive compact domain evidence |
| MODIFY | Node protocol + future Stage D fields (compatible) |
| MODIFY | SessionBootstrap freshness |
| ADD | Lexical semantics + UNRESOLVED contracts |
| ADD | Write-time / incremental domain evidence |
| DELETE (suggest) | Correction domain_updates as Lexicon knowledge writer |
| DEFER | Stage J / H / Tone / 50k / Wrong-Swapped / SameDomain fix |

CSV: `stage_d_keep_modify_add_delete_defer.csv`

---

## 18. Secondary Issues (Record Only)

- `WRONG_SWAPPED_DOMAIN_CANDIDATE_BUDGET_SELECTIVITY` = **KNOWN_SECONDARY_ISSUE**
- `DOWNSTREAM_SAMEDOMAIN_INTERACTION` = **MONITOR**

Must not preempt Stage D real writeback.

---

## 19. Success Criteria Check (Audit Completeness)

1. What lexical evidence after correction — **answered** (free-text surfaces; not lexicon-backed)
2. Who owns term identity — **Lexicon** (writeback not yet using it)
3. Who owns term→domain — **Lexicon term_domain_tags**
4. What UserProfile should persist — **user lexical stats + compact derived domain evidence** (latter missing)
5. Where/when incremental domain update — **write-time at Profile apply** (missing)
6. What Node needs — **bounded Model2 representation** (today full profile; Model2 only phonetic)
7. Train vs prod semantic match — **MISMATCH**
8. Minimal mods — **P0 list**
9. Must not touch — **Runtime skeleton, Stage P path, FineSpan, DomainAwareAssembly, KenLM, Tone, insertion point**

---

## 20. FINAL VERDICT

```
Stage D Real UserProfile Writeback Audit:
PARTIAL

Frozen Model2 Runtime Skeleton:
FROZEN

Manual Correction Pipeline:
PARTIAL

Pronunciation Writeback:
READY

Lexical Observation Extraction:
PARTIAL

Lexicon Term Resolution:
NOT_IMPLEMENTED

Personal/Common Term Persistence:
PARTIAL

Lexical Frequency/Confidence:
PARTIAL

MultiTag Domain Resolution:
READY (Lexicon SSOT / train+Node runtime; NOT wired on writeback)

LongTerm Domain Evidence:
NOT_IMPLEMENTED

Incremental Domain Evidence Update:
NOT_IMPLEMENTED

Session Domain Prior:
PARTIAL

Training / Production Profile Contract:
MISMATCH

Stage D Real Data:
NOT_READY

Stage D Production Runtime:
BLOCKED

Stage J Ready:
NO

domain_updates Ownership:
PLACEHOLDER

TermDomain SSOT:
PASS

Second Domain SSOT:
NO

Self Reinforcement Risk:
NO

Single Correction Dominance Risk:
YES

Overlapping Term Double Count Risk:
YES

Session Payload Growth Risk:
YES

Architecture Drift:
NO

G0:
none (runtime skeleton frozen)

G1:
missing lexicon-backed lexical writeback; missing write-time long_term_domain_evidence

G2:
Stage D train derives domain evidence; production cannot emit semantic-equivalent input

G3:
Node TS omits personal_term_evidence; SessionBootstrap stale after correction

G4:
full UserProfile SessionBootstrap — SESSION_PAYLOAD_GROWTH_RISK

G5:
LEXICAL_PROFILE_SEMANTICS_UNDEFINED; unknown/overlap policies

G6:
INCREMENTAL_PROFILE_UPDATE_MISSING for domain evidence

Highest Priority Blocker:
G1 — no lexicon-backed lexical observation + no write-time compact long-term domain evidence derivation

Recommended Next Development Phase:
STAGE_D_REAL_USERPROFILE_WRITEBACK_DEVELOPMENT
(contracts → minimal writers → semantic parity with Stage D train)
— NOT Stage J; NOT LLM/hardcoded domain shortcuts
```

---

## 21. Governance Reminder

Must preserve:

```
Manual Correction
  → User lexical observations (lexicon-backed)
  → UserProfile (user state)
  → Lexicon term_domain_tags (SSOT)
  → compact long-term domain evidence
  → Trainable Model2
```

Forbidden shortcuts: LLM→long-term domain; hardcoded term-domain; UserProfile second term→domain map; per-FineSpan full history scan; redesign Runtime Skeleton.
