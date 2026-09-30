# LINGUA_ANCHOR_PROTECTION_AUTHORITY_AUDIT

**Phase:** `LINGUA_ANCHOR_PROTECTION_AUTHORITY_PREDEVELOPMENT_AUDIT`  
**Date:** 2026-09-14  
**Mode:** READ-ONLY · HISTORICAL-SSOT-FIRST · BUSINESS-SEMANTICS-FIRST · NO PRODUCT CHANGE

---

## 0. Short verdict

Frozen Anchor SSOT **does authorize** automatic Model3-RETRY suppression for:

- **Domain Anchor:** `domain_term` | `passive_domain_weak` under retained SameDomain / `retainedDomains` rules  
- **Model2 Anchor:** materialized + retained candidates with `PROFILE_PRONUNCIATION` **or** `PROFILE_DOMAIN`

It **forbids** Base-alone and states **`PROFILE_RETRIEVAL` / `BASE_FUZZY` alone are not Model2 Anchors**.

Therefore A1–A3 (soft `PROFILE_DOMAIN` / domain_term ∩ retained) **match historical automatic Anchor authority** — they are **not** an “unauthorized evidence class” restore target under current freeze.

**First blocker:** user must decide whether to **keep** that frozen breadth or **revise Anchor SSOT** (ACP). Do not treat Pilot “false Anchor” as adapter-restore against SSOT.

**Secondary code drift (does not explain A1–A3):** `hasModel2Evidence` also accepts `PROFILE_RETRIEVAL`, contradicting Anchor contract.

---

## 1. Anchor semantic recovered

From `model3_anchor_contract_v1.md`:

> Anchor means: **trusted enough to condition one bounded repair attempt**.  
> Anchor is **not** guaranteed ground truth.

Used here as: **upstream protection that removes a PathFineSpan from Model3 RETRY authority** — not final correctness / KenLM / full ASR explanation.

---

## 2. Document inventory (authority order applied)

| DOCUMENT | DATE | AUTHORITY | ACTIVE | ANCHOR DEF | DOMAIN AUTH | M2 P | M2 D / PROFILE_DOMAIN | PROFILE_RETRIEVAL | PROFILE_PRONUNCIATION | NOTES |
|----------|------|-----------|--------|------------|-------------|------|------------------------|-------------------|------------------------|-------|
| `model3_anchor_contract_v1.md` | FROZEN w/ Arch V1 | **AUTHORITATIVE** | ACTIVE | trusted enough to condition repair | Domain Anchor = SameDomain + retained + domain_term\|passive + active | Model2 Anchor set includes P | Model2 Anchor set includes PROFILE_DOMAIN | **alone NOT** Model2 Anchor | Model2 Anchor | Dual → DOMAIN_AND_MODEL2 |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` | 2026-08-23+ | AUTHORITATIVE | ACTIVE | Anchor-conditioned Text Trigger | Must not select Domain | — | — | — | — | Points to anchor contract |
| `MODEL3_SYNTHETIC_V1_FROZEN.md` | 2026-08-26 | AUTHORITATIVE | ACTIVE | DOMAIN \| MODEL2 \| BOTH | Domain candidate ≠ Domain Anchor; needs final retainedDomains | — | — | — | — | Pipeline Vote→SameDomain→Anchors |
| `model3_input/output/retry` contracts | FROZEN | AUTHORITATIVE | ACTIVE | isAnchor mask; Anchor RETRY forbidden | — | — | — | — | — | No evidence-class expansion |
| `model3_v1_model_visible_feature_allowlist.json` | FROZEN | AUTHORITATIVE | ACTIVE | isAnchor only; provenance NOT visible | — | — | — | — | — | Model3 consumes protection state |
| `documentation_authority_matrix.csv` | 2026-08-26 | INDEX | ACTIVE | lists anchor contract | — | — | — | — | — | |
| Sufficiency / coverage predev audits | 2026-09 | **AUDIT_ONLY** | ACTIVE as evidence | Propose narrowing soft / P | Recommend CONDITIONAL | Recommend not alone | Soft mismatch not sufficiency | — | — | **Must not override** frozen Anchor contract; CONTRACT_A user-rejected earlier |
| Current `model3-anchor-adapter.ts` | code | IMPL #10 | ACTIVE | domainOk\|\|model2Ok | approx domains∩retained | PROFILE_RETRIEVAL+P+D | PROFILE_DOMAIN | included (drift) | included | Evidence of impl, not authority |

**HISTORICAL_ANCHOR_SSOT_FOUND = YES**  
**HISTORICAL_ANCHOR_SSOT_CONFLICT = NO** (predev recommendations ≠ conflicting freeze; they are lower authority)

---

## 3. Evidence class business semantics

| Class | PRODUCER | BUSINESS_PURPOSE | PROVES | DOES NOT PROVE | Materialize / provenance | CURRENT ANCHOR PATH |
|-------|----------|------------------|--------|----------------|--------------------------|---------------------|
| BASE_EXACT / base_term | Base lexicon recall | Lexical candidates | Term exists in base | ASR surface correct; Domain Anchor | often `BASE_FUZZY` | **NONE** alone (FORBIDDEN) |
| BASE_FUZZY | tagBaseProvenance | Observability on base hits | Base recall path | Model2 Anchor | `BASE_FUZZY` | **NONE** alone (contract) |
| DOMAIN_TERM | Domain / soft D recall | Domain-eligible graph source | Domain-tagged candidate | Lexical ASR correctness | `source=domain_term` | Domain Anchor **if** SameDomain+retained+active |
| PASSIVE_DOMAIN_WEAK | Domain presence / weak | Weak domain graph source | Weak domain eligibility | Strong lexical proof | `passive_domain_weak` | Domain Anchor **if** same 4 rules |
| RETAINED_DOMAIN | Domain Vote | Kept domain hypothesis set | Vote retained domains | Span protected by itself | `vote.retainedDomains` | **Gate** for Domain Anchor; not alone |
| PROFILE_DOMAIN | Model2 D / `materializeDomainHits` | Domain-guided soft expansion | Profile-conditioned domain soft hit on window | Pronunciation repair; surface==ASR | `PROFILE_DOMAIN` + usually `domain_term` | **Model2 Anchor** (frozen) + may also Domain path |
| PROFILE_RETRIEVAL | Model2 merge / legacy tag | Profile lexical retrieval umbrella / merge mark | Profile retrieval involvement | Auto Model2 Anchor alone | `PROFILE_RETRIEVAL` / `alsoProfileRetrieval` | **NO** alone (frozen); code still accepts → drift |
| PROFILE_PRONUNCIATION | Model2 P / `materializeProfileHits` | Pronunciation-conditioned lexicon hit | Closed P recall hypothesis candidate | Contextual / compound correctness | `PROFILE_PRONUNCIATION` | **Model2 Anchor** (frozen) |

### PROFILE_DOMAIN (critical)

Historical creation purpose (from Model2 D materialize + Anchor contract): **domain-guided candidate expansion** that, when **materialized and retained**, is listed in the **Model2 materialize Anchor set**.

```
PROFILE_DOMAIN_AUTOMATIC_ANCHOR_AUTHORITY = YES
  (as Model2 Anchor under materialize+retain+originSpanId rules)

PROFILE_DOMAIN_COUNTS_AS_MODEL2_REPAIR_EVIDENCE = NO
  (D soft expansion — not pronunciation repair proof)

PROFILE_DOMAIN_COUNTS_AS_DOMAIN_EVIDENCE = YES
  (source often domain_term; can feed Domain Anchor path when SameDomain/retained hold)
```

Do **not** infer “soft ≠ Anchor” from Pilot; frozen SSOT lists PROFILE_DOMAIN explicitly.

### PROFILE_PRONUNCIATION

```
PROFILE_PRONUNCIATION_AUTOMATIC_ANCHOR_AUTHORITY = YES
  (same Model2 Anchor clause; automatic once materialized+retained+originSpanId)
```

No SSOT distinction 刘→牛 vs 藏→常. **A4_C1_AUTHORITY_RESOLVED = YES** (both authorized; no forced separation).

### PROFILE_RETRIEVAL

Semantically: profile retrieval / merge observability — **not** equivalent to P.  
Frozen: **alone not Model2 Anchor**.  
Current `isModel2Provenance` includes it → **implementation drift**.

### Domain / Base

```
DOMAIN_TERM_AUTOMATIC_ANCHOR_AUTHORITY = CONDITIONAL  (Domain Anchor 4-rules)
PASSIVE_DOMAIN_WEAK_AUTOMATIC_ANCHOR_AUTHORITY = CONDITIONAL  (same)
RETAINED_DOMAIN_AUTOMATIC_ANCHOR_AUTHORITY = SUPPORT_ONLY / gate  (not alone)
BASE_EXACT_AUTOMATIC_ANCHOR_AUTHORITY = NO
BASE_FUZZY_AUTOMATIC_ANCHOR_AUTHORITY = NO
```

Exact quote (forbidden sources): *“base term, ASR raw, function word, KenLM winner, high ASR confidence, frequency alone: FORBIDDEN as Anchor unless DOMAIN or MODEL2 rules also hold.”*

---

## 4. Current OR rule vs SSOT

Frozen structure:

- Domain rules → Domain Anchor  
- Model2 rules → Model2 Anchor  
- Both → `DOMAIN_AND_MODEL2`  
⇒ **logical OR of two independent rule families** is **DERIVED_BUT_SUPPORTED**.

Exact string `domainOk || model2Ok` is **implementation naming**, not a separate freeze text — but matches Dual-source design.

```
CURRENT_OR_RULE_AUTHORITY = DERIVED_BUT_SUPPORTED
```

Caveats (impl vs Domain clause detail):

- Adapter uses `domains ∩ retainedDomains` on bound `domain_term|passive`, **does not** read `DomainFilteredSpanSet.sameDomainCandidates` literally → **approximate** Domain rule #1.  
- Model2 path alone still Anchors PROFILE_DOMAIN without SameDomain check → A1–A3 remain authorized via Model2 clause even if Domain approximation were tightened.

---

## 5. PROFILE_DOMAIN double role

`materializeDomainHits`: `source=domain_term` + `retrievalProvenance=PROFILE_DOMAIN`.

Contract Dual source anticipates both Domain and Model2 rules on same `spanId`.

```
PROFILE_DOMAIN_DOUBLE_ROLE = INTENTIONAL
DIRECT_BOOLEAN_EFFECT = YES   (same cand can set domainOk and model2Ok)
SEMANTIC_CLASSIFICATION_EFFECT = YES  (labels DOMAIN_AND_MODEL2 without two independent producers)
```

Not treated as accidental drift under frozen Dual source.

---

## 6. Generic “MODEL2_EVIDENCE” boolean

Frozen Model2 Anchor set = **PROFILE_PRONUNCIATION ∨ PROFILE_DOMAIN** (same authority).  
**Not** `{RETRIEVAL, PRONUNCIATION, DOMAIN}`.

```
MODEL2_EVIDENCE_BOOLEAN_IS_BUSINESS_VALID = PARTIAL
  (P∪D valid; adding PROFILE_RETRIEVAL invalidates the enum grouping)
```

---

## 7. Combinations / independence

Explicit combination: Dual source when Domain **and** Model2 rules hold — **no** requirement of two distinct candidate identities.

```
EVIDENCE_INDEPENDENCE_REQUIRED = NOT_SPECIFIED
  (frozen Dual does not require independent items; one labeled cand may satisfy both paths)
```

Current impl **cannot** distinguish “two independent sources” from “one soft D cand with two labels.”

---

## 8. Implementation mapping

| CURRENT CONDITION | EVIDENCE CLASS | CURRENT AUTO ANCHOR | HISTORICAL | MATCH |
|-------------------|----------------|---------------------|------------|-------|
| `source∈{domain_term,passive}` ∧ domains∩retained ∧ bound | DOMAIN_TERM / PASSIVE + RETAINED gate | YES (domainOk) | CONDITIONAL Domain Anchor | **PARTIAL** (SameDomain set not literally checked) |
| `retrievalProvenance=PROFILE_DOMAIN` ∧ bound | PROFILE_DOMAIN | YES (model2Ok) | AUTOMATIC Model2 Anchor | **MATCH** |
| `retrievalProvenance=PROFILE_PRONUNCIATION` ∧ bound | PROFILE_PRONUNCIATION | YES | AUTOMATIC Model2 Anchor | **MATCH** |
| `retrievalProvenance=PROFILE_RETRIEVAL` ∧ bound | PROFILE_RETRIEVAL | YES (model2Ok) | **NO** alone | **DRIFT** |
| `BASE_FUZZY` / base_term alone | BASE | NO | NO | MATCH |
| `domainOk \|\| model2Ok` → whole PFS Mark | — | YES | DERIVED Dual/OR families | MATCH intent; no coverage test (prior audit) |

---

## 9. Sanity (counterfactual; no GT rules)

| Case | CURRENT_ANCHOR | HISTORICAL_RULE_ANCHOR | REASON |
|------|----------------|------------------------|--------|
| A1 德鸾 | YES | **YES** | PROFILE_DOMAIN Model2 Anchor (+ Domain path via domain_term∩retained) |
| A2 注册 | YES | **YES** | same |
| A3 理事 | YES | **YES** | same |
| A4 藏→常 | YES | **YES** | PROFILE_PRONUNCIATION Model2 Anchor |
| C1 刘→牛 | YES | **YES** | PROFILE_PRONUNCIATION Model2 Anchor |
| C2 升层→生成 | YES | **YES** | PROFILE_PRONUNCIATION (+ Domain/PROFILE_DOMAIN Dual possible) |

```
A1_A3_FIRST_PROVEN_DRIFT = NONE
A4_C1_AUTHORITY_RESOLVED = YES
```

Pilot “false Anchor” on A1–A3 is **SSOT breadth**, not unauthorized class.

---

## 10. Partial Anchor / changedPositions

```
MODEL2_CHANGED_POSITION_COVERAGE = CONFIRMED_INFORMATION_LOSS_DEFERRED
PARTIAL_ANCHOR_ACP_REQUIRED_NOW = NO
```

Unauthorized-authority restore does **not** apply; partial protection ACP not forced by this audit.

---

## 11. Decision matrices

### A. NO USER DECISION REQUIRED (impl vs SSOT)

| Item | Action class |
|------|----------------|
| Exclude `PROFILE_RETRIEVAL` alone from Model2 Anchor predicate | Adapter restore to match Anchor contract |
| Optionally tighten Domain path to SameDomain membership | Alignment to Domain Anchor rule #1 (does not alone clear A1–A3) |

### B. USER DECISION REQUIRED

**Item 1 — PROFILE_DOMAIN / soft Domain automatic RETRY suppression breadth**

| OPTION | MEANING | MODULES | COMPLEXITY | KNOWN CASE EFFECT | ARCH IMPACT |
|--------|---------|---------|------------|-------------------|-------------|
| **O1 Keep frozen** | PROFILE_DOMAIN (+ Domain soft under Domain rules) remain auto Anchor | none now | low | A1–A3 stay Anchor; Model3 may not see residuals | none |
| **O2 Demote PROFILE_DOMAIN Model2 Anchor** | Remove PROFILE_DOMAIN from Model2 Anchor set; Domain path only if Domain rules | Anchor contract + adapter; ACP | med | A1–A3 lose model2Ok; may still domainOk unless Domain also tightened | ACP |
| **O3 Demote soft mismatched Domain+PROFILE_DOMAIN** | Only exact-surface / stronger Domain membership creates Domain/Model2 Anchor | Anchor SSOT + adapter; ACP | high | Targets A1–A3 soft lists; risks demoting useful domain Anchors | ACP; prior CONTRACT_A rejected — do not silently revive |

This audit **does not recommend** an option; frozen evidence supports **O1** until user revises SSOT.

**Item 2 — PROFILE_PRONUNCIATION automatic Anchor** — already frozen YES; changing it is separate ACP (A4/C1). Not required to unblock A1–A3.

---

## 12. Patch-free locality (if user chooses O2/O3 later)

| Module | Status |
|--------|--------|
| Model2 inference / relation | UNCHANGED |
| candidate materialization labels | MAY_REQUIRE_CHANGE (provenance semantics stay; Anchor consume changes) |
| Tone / Lexicon / FineSpan / Edge / segmentation / Domain Vote | UNCHANGED |
| Model3 input / model / training | UNCHANGED |
| Retry / Assembly / KenLM / JobResult | UNCHANGED |
| Anchor adapter + Anchor contract text | **MUST_CHANGE** under O2/O3 + ACP |

```
MODEL3_CHANGE_REQUIRED = NO
MODEL2_SEMANTIC_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
PRODUCT_CODE_CHANGE_THIS_ROUND = NO
```

---

## 13. Required authority matrix

| Evidence Class | Business Purpose | Current Auto Anchor? | Historical Auto Anchor? | Conditional Rule | Current Match? | SSOT Source |
|----------------|------------------|----------------------|-------------------------|------------------|----------------|-------------|
| BASE_EXACT | base lexical cand | NO | **NONE** | unless Domain/Model2 rules | MATCH | anchor_contract forbidden |
| BASE_FUZZY | base provenance tag | NO alone | **NONE** alone | — | MATCH | Model2 Anchor exclude |
| DOMAIN_TERM | domain graph source | YES if ∩retained | **CONDITIONAL** Domain Anchor | SameDomain+retained+active+eligible source | PARTIAL | Domain Anchor § |
| PASSIVE_DOMAIN_WEAK | weak domain source | YES if ∩retained | **CONDITIONAL** | same | PARTIAL | Domain Anchor § |
| RETAINED_DOMAIN | vote keep set | gate only | **SUPPORT_ONLY** / gate | not alone | MATCH intent | Domain Anchor + Synthetic freeze |
| PROFILE_DOMAIN | Model2 D soft expand | YES | **AUTOMATIC** Model2 Anchor | materialize+retain+originSpanId | MATCH | Model2 Anchor § |
| PROFILE_RETRIEVAL | profile retrieval / merge | YES in code | **NONE** alone | — | **DRIFT** | Model2 Anchor § exclude |
| PROFILE_PRONUNCIATION | Model2 P lexicon hit | YES | **AUTOMATIC** Model2 Anchor | materialize+retain+originSpanId | MATCH | Model2 Anchor § |

---

## 14. Final verdict fields

```
BASELINE_IDENTITY = PASS
HISTORICAL_ANCHOR_SSOT_FOUND = YES
HISTORICAL_ANCHOR_SSOT_CONFLICT = NO
CURRENT_OR_RULE_AUTHORITY = DERIVED_BUT_SUPPORTED
BASE_EXACT_AUTHORITY = NONE
BASE_FUZZY_AUTHORITY = NONE
DOMAIN_TERM_AUTHORITY = CONDITIONAL
PASSIVE_DOMAIN_WEAK_AUTHORITY = CONDITIONAL
RETAINED_DOMAIN_AUTHORITY = SUPPORT_ONLY
PROFILE_DOMAIN_AUTHORITY = AUTOMATIC
PROFILE_RETRIEVAL_AUTHORITY = NONE
PROFILE_PRONUNCIATION_AUTHORITY = AUTOMATIC
PROFILE_DOMAIN_COUNTS_AS_MODEL2_REPAIR_EVIDENCE = NO
PROFILE_DOMAIN_DOUBLE_ROLE = INTENTIONAL
MODEL2_EVIDENCE_BOOLEAN_IS_BUSINESS_VALID = PARTIAL
EVIDENCE_INDEPENDENCE_REQUIRED = NOT_SPECIFIED
A1_A3_FIRST_PROVEN_DRIFT = NONE
A4_C1_AUTHORITY_RESOLVED = YES
MODEL2_CHANGED_POSITION_COVERAGE = CONFIRMED_INFORMATION_LOSS_DEFERRED
PARTIAL_ANCHOR_ACP_REQUIRED_NOW = NO
MODEL3_CHANGE_REQUIRED = NO
MODEL2_SEMANTIC_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
PRODUCT_CODE_CHANGE_THIS_ROUND = NO
USER_DECISION_REQUIRED = YES
USER_DECISION_ITEMS = Keep frozen PROFILE_DOMAIN (+ Domain soft Conditional) automatic Anchor authority (O1) OR revise Anchor SSOT via ACP to demote PROFILE_DOMAIN and/or soft Domain protection (O2/O3)
ONE_NEXT_OWNER = USER_ARCHITECTURE_DECISION_REQUIRED
ONE_NEXT_DELTA = Explicit user architecture decision on whether PROFILE_DOMAIN / soft Domain automatic Model3-RETRY suppression remains frozen as written in model3_anchor_contract_v1.md; do not treat A1–A3 as unauthorized-adapter drift. Secondary (non-blocking A1–A3): note PROFILE_RETRIEVAL inclusion in hasModel2Evidence contradicts SSOT for later restore-only delta.
```

---

## 15. Acceptance

All required audits completed. No product change. No partial-Anchor design. No A4/C1 forced separation. No changedPositions fix. No Model3 input reopen. Exactly one next owner / delta.

STOP.
