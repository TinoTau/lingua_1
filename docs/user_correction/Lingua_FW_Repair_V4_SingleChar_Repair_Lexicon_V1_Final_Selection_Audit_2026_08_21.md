# Lingua FW Repair V4 — Single-Char Repair Lexicon V1 Final Selection Audit

**Date:** 2026-08-21 (report finalized 2026-08-22)  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_V1_FINAL_SELECTION_AUDIT`  
**Mode:** AUDIT + DATA ANALYSIS ONLY  
**Verdict:** **STRICT_RECOMMENDED**  
**Safe To Freeze:** **NO** (LICENSE_REVIEW_REQUIRED)

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_repair_lexicon_v1_final_selection_audit_2026_08_21/`

---

## 1. Frozen constraints honored

- Model2 = P/D ONLY (no single-char disambiguation)
- No new table; future storage = `base_lexicon` length-1 (Option B)
- IME 2510 TSV preserved; not Repair authority
- No sqlite write / import / rebuild / production code change
- No dialog_200 expectedText membership
- Ambiguity rate not used as exclusion objective

---

## 2. Dataset reconstruction

| Set | Rows / chars | Rule | Status |
|-----|-------------:|------|--------|
| IME 2510 | 2510 | Common-character IME inventory | IME SSOT only |
| FULL CLD | 3913 | All CLD v2.1 **one-character lexical entries** | AUDIT_ONLY / too wide |
| STRICT | 1125 | CLD wordhood + SUBTL≥10 **and** Weibo≥10 | **Proposed V1** |
| BALANCED | 1420 | CLD wordhood + SUBTL≥5 **and** Weibo≥5 | Validation / broader |

Relationships (set equality on surfaces):

- STRICT ⊂ BALANCED ⊂ FULL (**true**; STRICT−BALANCED = ∅)
- IME ∩ STRICT = 927; IME ∩ BALANCED = 1149; IME ∩ FULL = 2348

FULL CLD = dictionary **single-character lexemes/headwords**, not “all Hanzi”. Still **not** a spoken-repair production universe without frequency gating.

---

## 3. Eligibility contract (SingleCharRepairEligibilityV1)

**INCLUDE:** CLD one-char lexical entry + STRICT dual frequency gates + traceable pinyin/tone.  
**EXCLUDE:** IME-only common chars; EXTENDED/LOW_FREQ CLD; case-driven adds; homophone-based deletes.  
**REVIEW:** BALANCED-only mid-band; license; morpheme/fallback audit flags (not auto-delete).  
**Function words:** protected by design (not required to be content N/V).

---

## 4. STRICT vs BALANCED

### STRICT

- Strength: wordhood + conservative spoken/subtitle gates; README’s initial production candidate; function-word protection 45/46 spot list present (`什` absent; `啥`/`么` present — not case-patched).
- Risk: misses some mid-frequency spoken CLD words (BALANCED−STRICT = **295**).
- Content suitable for V1: **YES** (pending license).

### BALANCED

- Strength: +295 coverage.
- Precision risk: mid-band includes many IME-fallback overlaps (deterministic class **D**=141 of 295) without proving V1 necessity.
- Default V1: **NO** — prefer STRICT simplicity.

### BALANCED−STRICT classes (deterministic metadata only)

| Class | N |
|-------|--:|
| A clearly useful spoken proxy | 118 |
| B valid but uncommon | 19 |
| C written/literary leaning | 10 |
| D morpheme/fallback risk | 141 |
| F uncertain | 7 |

A-class items are **ops ADD candidates later**, not automatic V1 refine (would invent a fourth rule set without POS authority).

### FULL−BALANCED

2493 surfaces; tiers EXTENDED 562 + LOW_FREQ 1931 — too wide for production repair.

---

## 5. Examples (rule check only)

| Char | STRICT | BALANCED | FULL | IME |
|------|--------|----------|------|-----|
| 毫 | ABSENT | ABSENT | PRESENT | PRESENT |
| 涡 | ABSENT | ABSENT | PRESENT | PRESENT |
| 皿 | ABSENT | ABSENT | ABSENT | PRESENT |
| 酯 | ABSENT | ABSENT | PRESENT | ABSENT |

---

## 6. Phonetic / polyphonic

Proposed V1 (=STRICT): 1125 chars; 752 pinyin+tone groups; 515 unique; 237 ambiguous; max size 7.

Polyphonic: CLD export is effectively **one row per surface** in STRICT/BALANCED (**0** multi-row surfaces) → pronunciation inventory **PARTIAL** (not solved this round).

---

## 7. License / provenance

CLD-derived lists: repo documents **GNU GPL** → **LICENSE_REVIEW_REQUIRED**.  
Production Source License Verified: **NO** → cannot SAFE_TO_FREEZE.

IME role weights must **not** become Repair prior.

---

## 8. Decision

**Recommended Production V1 content = STRICT (1125).**  
No REFINE: existing STRICT is enough; BALANCED delta does not force a new deterministic rule without over-filtering or case patches.

**Remaining blockers:** license review; rebuild planning (Option B source swap); prior mapping (later).

**Next phase:** legal review of CLD-derived vocab → then rebuild planning ACP (still no import until cleared).

---

AUDIT STOP. No import / sqlite write / rebuild / Model2 / collector / IME change.
