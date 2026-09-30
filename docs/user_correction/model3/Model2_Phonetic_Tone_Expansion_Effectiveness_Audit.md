# Model2 Phonetic / Tone Expansion Effectiveness Audit

Generated: 2026-09-10  
Phase: `MODEL2_PHONETIC_TONE_EXPANSION_EFFECTIVENESS_AUDIT`  
Mode: READ_ONLY / PRE-DEVELOPMENT  
RUN_ID: `dialog200_full_pipeline_20260909_001141`

## Verdict

`MODEL2_EXPANSION_AUDIT_PASS_INTEGRATION_GAP_FOUND`

```text
DOMINANT_FINDING = MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED (6/10, ratio 0.6)
ONE_NEXT_AUDIT = MODEL2_INTEGRATION_CONTRACT_REPAIR_AUDIT
PRODUCTION_CODE_CHANGE = NONE
MODEL2_WEIGHT_CHANGE = NONE
MODEL2_RETRAIN = NONE
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
LEXICON = UNCHANGED
```

## Design vs Implementation

| Capability | Frozen design | Current implementation | Status |
|---|---|---|---|
| FineSpan-local expansion | YES | Per FineSpan Stage-J expand after base activeCandidates; skip span if no syllables | **IMPLEMENTED** |
| pronunciation-conditioned | YES | phonetic_bias profile items + P relation actions + hypothesized syllables → lexicon recall | **PARTIAL** |
| tone-confusion-aware | expected within user pronunciation expansion | tone_bias exists on UserProfileV1 schema but adapter does NOT read tone_bias; neural pack has no tone tensor | **MISSING** |
| user-profile-conditioned | YES | phonetic_bias / personal_terms / long_term_domain_evidence CONNECTED; tone_bias/domain_bias/confusion_bias STORED-NOT-CONSUMED | **PARTIAL** |
| domain-conditioned | YES | Stage D domain_soft actions via long_term_domain_evidence (not domain_bias) | **PARTIAL** |
| trainable behavior | YES | RetrievalPolicyV3 predicts P/D retrieval ACTIONS (not corrected text); Stage-J checkpoint frozen | **IMPLEMENTED** |
| candidate expansion | YES | termId UNION base ∪ P ∪ D into model2_union; budgets cand=8 per P/D | **IMPLEMENTED** |
| direct correction | NO | No surface typo dictionary in Model2 path; phonetic relation SSOT only | **IMPLEMENTED** |
| final selection | NO | Model2 does not select final sentence; KenLM downstream | **IMPLEMENTED** |

## Code-level Model2 contract (authoritative)

Model2 **IS**: user-conditioned **candidate expansion** via P/D **retrieval actions**.

Model2 **IS NOT**: text correction model, final selector, lexicon owner, Model3/KenLM replacement.

### Features actually consumed at inference

| Feature | Status |
|---|---|
| FineSpan syllables / windowPinyinKey | PASSED to sidecar; neural uses syllable **hash bag** |
| windowText | Passed; used by D executor / P lexicon query — **not** neural text-correction input |
| phonetic_bias (user pronunciation) | **CONNECTED** — also **hard-gates** P actions (all relations must have bias>0) |
| personal_terms / personal_term_evidence | CONNECTED |
| long_term_domain_evidence | CONNECTED (Stage D) |
| tone_bias | Schema exists — **STORED-NOT-CONSUMED** by Model2 adapter |
| domain_bias / confusion_bias | **UNUSED** by Model2 adapter |
| Acoustic tone pattern as Model2 neural feature | **NO** |

Training objective: retrieve-ACTION ranking (BCE + pairwise), **not** lexical surface correction. **ALIGNED** with expansion role; **PARTIALLY_ALIGNED** with “tone neighborhood expansion” because tone is not a Model2 feature.

Architecture drift (hardcoded typo map): **NO**.

## Probes

Accepted failure probes: **10**  
Controls (success): **2**  
Rejected: **0**

| caseId | probe | lexicon | base has | Model2 added | phonetic class | primary |
|---|---|---|---|---|---|---|
| d032 | 祭典→几点 | NO | NO | NO | SAME_PINYIN_DIFFERENT_TONE | LEXICON_TERM_ABSENT |
| d060 | 定单→订单 | YES | NO | NO | NEAR_PINYIN_SAME_OR_CLOSE_TONE | MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED |
| d060 | 加格→价格 | YES | NO | NO | SAME_PINYIN_DIFFERENT_TONE | MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED |
| d074 | 提叫→提交 | YES | NO | NO | SAME_PINYIN_DIFFERENT_TONE | MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED |
| d101 | 内客→内科 | YES | NO | NO | SAME_PINYIN_DIFFERENT_TONE | MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED |
| d114 | 台头→抬头 | YES | YES | NO | NEAR_PINYIN_SAME_OR_CLOSE_TONE | BASE_RECALL_ALREADY_HAS_CORRECT_CANDIDATE |
| d168 | 知冷→制冷 | NO | NO | NO | SAME_PINYIN_DIFFERENT_TONE | LEXICON_TERM_ABSENT |
| d182 | 大背→大杯 | YES | NO | NO | SAME_PINYIN_DIFFERENT_TONE | MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED |
| d194 | 司时→四十 | NO | NO | NO | SAME_PINYIN_DIFFERENT_TONE | LEXICON_TERM_ABSENT |
| d089 | 上限→上线 | YES | NO | NO | NEAR_PINYIN_SAME_OR_CLOSE_TONE | MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED |

### Controls (d084 / d184)

- **d084** `扫马→扫码`: base_has=YES, model2_added=NO → SUCCESS_NOT_ATTRIBUTABLE_TO_MODEL2
- **d184** `客互→客户`: base_has=YES, model2_added=NO → SUCCESS_NOT_ATTRIBUTABLE_TO_MODEL2

## Dominant finding interpretation

`MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED` means: for most probes where the correct Lexicon term exists and Base Recall misses it, Model2 also does **not** add it — and code shows **tone/profile features required for P expansion are missing or empty / not supplied** on this dialog200 path (empty `phonetic_bias` gates P; `tone_bias` never consumed).

This is **integration / feature-supply**, not proven Model2-weight failure under §28 ownership rule (required features not supplied → cannot assign `MODEL2_TONE_EXPANSION_INEFFECTIVE`).

Secondary signals (not dominant):

- `LEXICON_TERM_ABSENT` 3/10: 几点 / 制冷 / 四十 — Model2 **cannot** invent these (`MODEL2_EXPECTED_TO_ADD_CORRECT_TERM=NO`); lexicon unchanged this phase.
- `BASE_RECALL_ALREADY_HAS_CORRECT_CANDIDATE` 1/10: d114 `抬头` already in base/model2_union but sentence still unchanged → **not Model2-owned** for that probe (survival/assembly/selection later).
- Controls d084/d184: `扫码`/`客户` already in Base Recall → `SUCCESS_NOT_ATTRIBUTABLE_TO_MODEL2`.

### Offline candidate-bound note (no production change)

Model2 P/D already bound retrieval to **candBudget≈8** each; merge is termId UNION before sentence CrossPath ≤16.  
Do **not** propose global tone ignore. Any future tone/profile conditioning must stay **user-local, span-local, budgeted**.

## Required answers

| # | Answer |
|---|--------|
| A | Role still expansion (P/D actions), **PARTIAL** vs frozen tone/user-profile expectations |
| B | spanSyllables, windowText/PinyinKey, phonetic_bias, personal_terms, domain evidence, basePool — **not** tone_bias |
| C | Surface/pinyin keys enter adapter; **tone does not** enter Model2 neural/P gate as dedicated feature |
| D | phonetic_bias **can** enter if profile populated; dialog200 dump cannot prove non-empty profile; tone_bias **never** consumed |
| E | Yes, expansion path exists (UNION); effectiveness depends on profile-gated P/D actions |
| F | Lexicon present on **7/10** failure probes |
| G | Base miss reason mostly **NOT_OBSERVABLE** in compact dump (no query/tone fields); code-side tone constraints exist in Base Recall |
| H | Model2 added correct term: **0/10** |
| I | Tone mismatch as Model2-owned failure: **NOT_PROVEN** (tone feature not supplied to Model2) |
| J | Phonetic neighborhood “too narrow” as model behavior: **NOT_PROVEN**; empty phonetic_bias → P inert is stronger evidence |
| K | **Integration gap** (required features not supplied / tone unused) — not Model3/Retry; lexicon absent only if counted dominant |
| L | ONE potential Delta (next audit only): repair Model2 integration contract so pronunciation/tone-capable profile signals actually condition P expansion — **no retrain yet** |
| M | Retrain Model2: **NO this phase** |
| N | Modify Model3: **NO** |
| O | Modify Retry architecture: **NO** |
| P | Expand Lexicon: **DOES_NOT_SUGGEST** (do not execute) |
| Q | NEXT: `MODEL2_INTEGRATION_CONTRACT_REPAIR_AUDIT` |

## Freeze

```text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
LEXICON = UNCHANGED
FULL_MAINLINE = KEEP FROZEN
```
