# Lingua — Model3 V2 S2 Protected RETRY Localization Audit

**Phase:** `MODEL3_V2_S2_PROTECTED_RETRY_LOCALIZATION_AUDIT`  
**Date:** 2026-08-30  
**Mode:** READ-ONLY / TRACE-BASED  
**Model:** `MODEL3_V2_S2_RANDOM_INIT_V1`  
**No code/model/threshold/registry changes**

---

## MAIN VERDICT

| Field | Value |
|-------|-------|
| **verdict** | **S2_LOCALIZATION_AUDIT_PASS_WITH_NONBLOCKING_FALSE_POSITIVES** |
| **checkpoint identity** | SHA256 `54322a26…04161d9` **VERIFIED** |
| **protected cases audited** | 13 eligible + 6 KEEP controls |
| **case-level any RETRY** | **13/13** reconfirmed |
| **target RETRY (legacy probe/err-char)** | **9/13** reconfirmed |
| **exact offset TARGET_OVERLAP** | **6/13** |
| **near-target localization (overlap∨adjacent∨same-local)** | **13/13** |
| **reported unrelated RETRY** | **4** — IDs: **d131, d176, d181, d195** |
| **true clean-region FP (secondary spans)** | present but limited (1 logical FP span each in those 4) |
| **architecture drift** | **NO** |
| **S3 authorized** | **YES** |

**Interpretation:** The S2 “unrelated=4” figure is largely a **reporting-definition artifact** of probe-surface attribution. Offset audit shows all four cases fire **strong near-target RETRY** inside the same local ASR-error region; each also has **one extra** clean-region false-positive span. KEEP controls remain **0/6**. No runtime filter / threshold / feature change justified.

---

## AUDIT CONTRACT

| Item | Identity |
|------|----------|
| Model3 role | ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER (FineSpan KEEP/RETRY) |
| Checkpoint | `MODEL3_V2_S2_RANDOM_INIT_V1` seed_2026083011 |
| SHA256 | `54322a2670eabd1fbcb7c2b36f24ef62c6413c9bea57d64eda61f81fd04161d9` |
| Trace | `model3_v2_live_input_trace.jsonl` (production features; S2 vocab encode) |
| Packer | `packModel3SpanInferFields` |
| Protection registry | `MODEL3_V2_PROTECTION_REGISTRY` |
| Inventory | `model3_real_retry_target_inventory.csv` |

Historical RealDist / reconstructed offline features: **not used**.

---

## 13-CASE SUMMARY

| caseId | targetValid | exactTargetRetry | logicalRetry | localAdjacent | clearFP spans | legacyAttr | outcomeClass |
|--------|-------------|------------------|-------------:|--------------:|--------------:|------------|--------------|
| d002 | Y | 1 | 4 | 1 | 1 | TARGET | C_TARGET_PLUS_TRUE_UNRELATED |
| d003 | Y | 1 | 5 | 1 | 1 | TARGET | C_TARGET_PLUS_TRUE_UNRELATED |
| d019 | Y | 1 | 13 | 1 | 3 | TARGET | C_TARGET_PLUS_TRUE_UNRELATED |
| d049 | Y | 1 | 7 | 1 | 0 | TARGET | B_TARGET_PLUS_LOCAL_ADJACENT |
| d099 | Y | 1 | 8 | 1 | 1 | TARGET | C_TARGET_PLUS_TRUE_UNRELATED |
| d131 | Y | 0 | 4 | 1 | 1 | **UNRELATED** | E_MISS_PLUS_TRUE_UNRELATED* |
| d139 | Y | 0 | 10 | 1 | 3 | TARGET† | E_MISS_PLUS_TRUE_UNRELATED* |
| d142 | Y | 0 | 8 | 1 | 2 | TARGET† | E_MISS_PLUS_TRUE_UNRELATED* |
| d160 | Y | 0 | 9 | 1 | 7 | TARGET† | E_MISS_PLUS_TRUE_UNRELATED* |
| d176 | Y | 0 | 4 | 1 | 1 | **UNRELATED** | E_MISS_PLUS_TRUE_UNRELATED* |
| d179 | Y | 1 | 14 | 1 | 2 | TARGET | C_TARGET_PLUS_TRUE_UNRELATED |
| d181 | Y | 0 | 6 | 1 | 1 | **UNRELATED** | E_MISS_PLUS_TRUE_UNRELATED* |
| d195 | Y | 0 | 5 | 1 | 1 | **UNRELATED** | E_MISS_PLUS_TRUE_UNRELATED* |

\* Outcome name follows exact-overlap miss; **primary RETRY mass is still near-target** (see §4).  
† Legacy TARGET via err-char heuristic without probe-surface hit.

**Verified:** any RETRY **13/13**; legacy target **9/13**; offset near-target **13/13**.

---

## 4 REPORTED UNRELATED CASES

Exact IDs: **d131, d176, d181, d195**.

| caseId | current (abbrev) | protectedTarget | retrySurface | start–end | overlap | dist | path× | margin | bucket | grounding | relClass |
|--------|------------------|-----------------|--------------|-----------|---------|------|------:|--------|--------|-----------|----------|
| d131 | 更**意识规则**…帮忙… | probe `意` @1–2 | 识 | 2–3 | 0 | 0 | 2 | +9.24 | STRONG | near-target | TARGET_ADJACENT |
| d131 | | | 规 | 3–4 | 0 | 1 | 2 | +4.32 | STRONG | near-target | TARGET_ADJACENT |
| d131 | | | 则 | 4–5 | 0 | 2 | 2 | +0.78 | WEAK | near-target | TARGET_ADJACENT |
| d131 | | | **忙** | 16–17 | 0 | 14 | 2 | +1.40 | MODERATE | CLEAR_FP | UNRELATED_OTHER_CLAUSE |
| d176 | 更**意识规则**…帮忙… | probe `意` | 识/规/则 | 2–5 | 0 | 0–2 | 2 | up to +9.46 | STRONG | near-target | TARGET_ADJACENT |
| d176 | | | **忙** | 16–17 | 0 | 14 | 2 | +3.24 | STRONG | CLEAR_FP | UNRELATED_OTHER_CLAUSE |
| d181 | …中**贝**…**温习**一下以下… | probe `下` | 便/温/习 | 17–20 | 0 | 1–3 | 1 | up to +11.21 | STRONG | near-target | ADJ/SAME_LOCAL |
| d181 | | | 蓝莓 | 26–28 | 0 | 4 | 1 | +0.31 | WEAK | near-target | SAME_LOCAL |
| d181 | | | **中** | 11–12 | 0 | 9 | 1 | +2.80 | MODERATE | CLEAR_FP | UNRELATED |
| d181 | | | 贝 | 12–13 | 0 | 8 | 1 | +3.98 | STRONG | PLAUSIBLY_MALFORMED | UNRELATED |
| d195 | …比…款**定**…**平淡**… | probe `在` | 款/定/平/淡 | 9–17 | 0 | 0–4 | 1–2 | up to +9.78 | STRONG | near-target | ADJ/SAME_LOCAL |
| d195 | | | **比** | 3–4 | 0 | 10 | 1 | +7.67 | STRONG | CLEAR_FP | UNRELATED |

**Case-level reading:**

| caseId | Primary behavior | Extra FP |
|--------|------------------|----------|
| d131 | Local RETRY on 更衣室→更意识 畸形区 (not exact `意`) | 忙 |
| d176 | Same as d131 | 忙 (stronger) |
| d181 | Local RETRY on 温习/便 near `下` error cluster | 中 (+贝 plausibly bad ASR) |
| d195 | Local RETRY on 订单畸形区 near probe `在` | 比 |

---

## MULTIPATH ACCOUNTING

| Metric | Observation |
|--------|-------------|
| Raw path RETRY | Often 2× logical (e.g. d131/d176 pathCount=2) |
| Logical unique spans | Dedup by `(rawStart, rawEnd, surface)` |
| Effect on “4 unrelated” | **Not** pure multipath inflation — logical unique still shows near-target + 1 FP |

Multipath inflates raw counts but does **not** erase the secondary clear-FP spans.

---

## TARGET LOCALIZATION

| Definition | Count |
|------------|------:|
| Exact TARGET_OVERLAP (case) | 6/13 |
| Legacy probe/err-char TARGET | 9/13 |
| Near-target (overlap∨adj∨same-local) | **13/13** |
| Exact miss but local-adjacent among the 4 | **4/4** |

**Reporting gap:** Legacy `attribution()` marks TARGET only if `probe_surface ∈ retry surfaces` (or err-char heuristic). Models often RETRY **adjacent** FineSpans in the same malformed region → counted “unrelated” even when localization is locally correct.

Utterance sensitivity ≠ localization: Model3 still fires FineSpan-local RETRY concentrated on error neighborhoods; it is **not** merely “any anomaly → whole utterance RETRY”.

---

## MARGIN ANALYSIS

| Class (logical spans, all 13) | n | mean margin |
|-------------------------------|--:|------------:|
| TARGET_OVERLAP | 9 | ~4.62 |
| TARGET_ADJACENT / SAME_LOCAL | 49 | ~4.23 |
| CLEAR_FALSE_POSITIVE | 24 | ~3.28 (10 STRONG) |

Among the **4 reported unrelated cases**, near-target margins are typically **STRONG**; extra FPs are MODERATE–STRONG (忙/中/比). Not solely weak argmax noise — but **primary mass remains near-target**.

---

## ANCHOR / CANDIDATE CONTEXT

| Check | Result |
|-------|--------|
| Anchor span receives RETRY | **NONE** (no ownership violation) |
| Relation | Mostly far-from or near-Anchor; no inside-Anchor RETRY |
| Candidate channel | Trace `first_pass_cand_log1p` present; no missing-candidate FAIL |
| Candidate anomaly | No systematic cand=0-only false RETRY pattern required for explanation |

---

## KEEP CONTROLS

| Control set | false RETRY | max margin |
|-------------|------------:|------------|
| 6 NO_ERROR cases | **0/6** | n/a (no RETRY) |

S2 is **not** globally aggressive on clean controls.

---

## ROOT CAUSE (of the reported 4)

| Class | Count | Evidence |
|-------|------:|----------|
| **LOCALIZATION_NEAR_TARGET** | **4/4 primary** | Strong adj/same-local RETRY around probe/error region |
| **TRUE_LOCALIZATION_FALSE_POSITIVE** | **4 secondary spans** | 忙 / 忙 / 中 / 比 |
| MULTIPATH_ACCOUNTING_ARTIFACT | partial | path×2 duplicates; not sole cause |
| TARGET_MAPPING / STALE_TARGET | 0 | targets valid via probe/alignment |
| TRACE_IMPLEMENTATION_DEFECT | 0 | SHA + features OK |
| GENERAL_OVER_RETRY | no | KEEP controls clean |

**Aggregate label:** **MIXED** — definition/near-target primary + limited true FP secondary.

---

## COMPLEXITY DECISION

| Question | Answer |
|----------|--------|
| New runtime logic required | **NO** |
| Feature / model change required | **NO** |
| Threshold change | **NO** |
| Class-weight / training change | **NO** |
| Hard-case mining / filters | **NO** |

A small set of secondary clear FPs does **not** justify new mechanisms at this scale.

---

## S3 DECISION

**Authorize S3 unchanged.**

Reasons:

1. No architecture / Anchor / packer / checkpoint defect  
2. Reported “4 unrelated” mainly near-target under strict probe attribution  
3. Target/near-target localization materially better than S1 (0/13 → 13/13 near-local; 9/13 legacy target)  
4. KEEP controls remain 0/6  
5. Secondary FPs are limited and do not dominate margins of the local error region  

Monitor at S3: secondary clear-FP rate / strong-margin distant RETRY — **audit-only**, no filter.

---

## REQUIRED DECISIONS (D1–D20)

| ID | Answer |
|----|--------|
| D1 | Exact S2 checkpoint replayed **YES** |
| D2 | Protected targets valid **YES** (probe/alignment) |
| D3 | Unrelated IDs: **d131, d176, d181, d195** |
| D4 | Target+unrelated (legacy): 0 of these 4 had legacy TARGET; offset: all have near-target |
| D5 | Miss(exact)+unrelated: **4/4** exact-miss; all still near-target |
| D6 | Multipath-only: **0** (duplicates exist but not sole) |
| D7 | Target-adjacent / same region: **4/4** |
| D8 | True clean FP spans: **1 per case** (4 spans) |
| D9 | Near-target margins mostly **STRONG**; FP MODERATE–STRONG |
| D10 | Shared pattern: RETRY mass on ASR-garbled local window; FP often function/content chars far away |
| D11 | Anchor violation **NO** |
| D12 | Candidate anomaly **NO** (blocking) |
| D13 | Trace/offset mapping defect **NO** |
| D14 | Utterance classifier? **NO** — span-local near errors; plus limited distant FP |
| D15 | Localization quality for S2 scale **acceptable** with nonblocking FPs |
| D16 | Runtime logic change **NO** |
| D17 | Feature/model change **NO** |
| D18 | S3 proceed unchanged **YES** |
| D19 | If later: distribution audit only if S3 worsens strong distant FP |
| D20 | Verdict singular **YES** |

---

## GOVERNANCE

Model3 / ASR / features / labels / FineSpan / Recall / Model2 / Domain / Anchor / Retry / threshold / class weight / protection registry / training: **all unchanged (NO)**.

---

## NEXT PHASE

**Exactly one (NOT EXECUTED):**

`MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3`

---

## ARTIFACTS (5)

1. `Lingua_Model3_V2_S2_Protected_Retry_Localization_Audit_2026_08_30.md`  
2. `model3_v2_s2_protected_localization_summary.json`  
3. `model3_v2_s2_protected_case_trace.csv`  
4. `model3_v2_s2_retry_margin_analysis.csv`  
5. `model3_v2_s2_localization_qa.csv`
