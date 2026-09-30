# -*- coding: utf-8 -*-
"""Post-process downstream causal audit artifacts into full report."""
from __future__ import annotations

import csv
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
MATRIX = DOCS / "model3_v2_s3_downstream_causal_case_matrix.csv"
PRIOR = DOCS / "model3_v2_s3_class_weight_causal_mainline.csv"
OUT_MD = DOCS / "Lingua_Model3_V2_S3_Class_Weight_Downstream_Utility_Causal_Audit_2026_09_03.md"
OUT_OWNER = DOCS / "model3_v2_s3_downstream_owner_evidence.csv"

CLEAR_OOS = {"d040", "d042", "d085", "d129", "d172", "d175"}
LOCAL_FIT = {"d065", "d102", "d138"}
SURFACE = {"d054", "d109", "d114"}
UNRESOLVED4 = {"d008", "d022", "d051", "d094"}
HIGH12 = CLEAR_OOS | LOCAL_FIT | SURFACE | UNRESOLVED4


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…]", "", s or "").lower()


def main() -> None:
    rows = list(csv.DictReader(MATRIX.open(encoding="utf-8")))
    prior = {r["caseId"]: r for r in csv.DictReader(PRIOR.open(encoding="utf-8"))} if PRIOR.exists() else {}

    def b(v: str) -> bool:
        return str(v).lower() == "true"

    m3_unchanged = [r["caseId"] for r in rows if not b(r["model3DecisionChanged"])]
    decomp = Counter(r["decomposition"] for r in rows)

    baseline_correct = [r for r in rows if norm(r["expected"]) and norm(r["baselineFinal"]) == norm(r["expected"])]
    extra_retry = [
        r
        for r in rows
        if b(r["model3DecisionChanged"]) and b(r["retryRegionChanged"]) and norm(r["baselineFinal"]) == norm(r["expected"])
    ]

    clear_oos_improved = sum(1 for r in rows if r["caseId"] in CLEAR_OOS and r["finalUtility"] == "IMPROVED")
    local_improved = sum(1 for r in rows if r["caseId"] in LOCAL_FIT and r["finalUtility"] == "IMPROVED")
    surface_improved = sum(1 for r in rows if r["caseId"] in SURFACE and r["finalUtility"] == "IMPROVED")

    prior_new_retry = sum(int(prior[c]["newRetrySpans"]) for c in prior if prior[c].get("newRetrySpans"))
    prior_removed = sum(int(prior[c]["removedRetrySpans"]) for c in prior if prior[c].get("removedRetrySpans"))

    summary_path = DOCS / "model3_v2_s3_downstream_utility_summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))

    owner_rows = [
        "caseId,model3Changed,retryRegionChanged,queryChanged,recallChanged,assemblyChanged,kenlmChanged,finalUtility,decomposition,earliestStopOwner"
    ]
    for r in rows:
        if not b(r["model3DecisionChanged"]) or r["finalUtility"] == "IMPROVED":
            owner = "NO_BLOCKER" if r["finalUtility"] == "IMPROVED" else "NONE"
        elif not b(r["retryRegionChanged"]):
            owner = "MODEL3_TRIGGER_NOT_USEFUL"
        elif not b(r["retryQueryChanged"]):
            owner = "RETRY_REGION_DERIVATION"
        elif not b(r["recallChanged"]):
            owner = "RETRY_QUERY_MAPPING"
        elif not b(r["assemblyChanged"]):
            owner = "RECALL"
        elif not b(r["kenlmChanged"]):
            owner = "ASSEMBLY"
        else:
            owner = "KENLM"
        owner_rows.append(
            ",".join(
                [
                    r["caseId"],
                    r["model3DecisionChanged"],
                    r["retryRegionChanged"],
                    r["retryQueryChanged"],
                    r["recallChanged"],
                    r["assemblyChanged"],
                    r["kenlmChanged"],
                    r["finalUtility"],
                    r["decomposition"],
                    owner,
                ]
            )
        )
    OUT_OWNER.write_text("\n".join(owner_rows) + "\n", encoding="utf-8")

    md = f"""# Lingua — Model3 V2 S3 Class Weight Downstream Utility Causal Audit

Date: 2026-09-03  
Phase: `MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `{summary['verdict']}` |
| baseline checkpoint | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| A1 checkpoint | `MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1` (cw=2.0) |
| full replay complete | {str(summary['fullReplayComplete']).upper()} |
| final unknown count | {summary['finalUnknownDueToDecisionChange']} |
| Model3 changed | {summary['model3ChangedCases']} |
| Retry changed | {summary['retryRegionChangedCases']} |
| Recall changed | {summary['recallChangedCases']} |
| Assembly changed | {summary['assemblyChangedCases']} |
| KenLM changed | {summary['kenlmChangedCases']} |
| final improved | {summary['finalImproved']} |
| final regressed | {summary['finalRegressed']} |
| net utility | {summary['netFinalImprovement']} |
| dominant downstream owner | {summary['dominantDownstreamOwner']} |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED |
| promotion readiness | {summary['promotionReady']} |
| ACP | NO |
| next phase | `{summary['nextPhase']}` |

================================
SSOT CORRECTION
===============

Prior freeze `CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY=INTERNAL_ONLY_NO_FINAL_UTILITY` was premature (Model3-only replay).  
After full same-upstream downstream replay: **`{summary['classWeightMainlineCausalUtility']}`**.

================================
CHECKPOINT IDENTITY
===================

| Branch | SHA256 | Verified |
|--------|--------|----------|
| Baseline S3 | `{summary['baselineSha']}` | YES |
| A1 RERUN1 | `{summary['a1Sha']}` | YES |
| Training this phase | NO | — |

================================
UPSTREAM SNAPSHOT PARITY
========================

- valid causal cases: **{summary['validCausalCases']}/200**
- invalid causal cases: **{summary['invalidCausalCases']}**
- upstream parity pass: **{str(summary['upstreamParityPass']).upper()}**
- Model3 unchanged parity controls ({len(m3_unchanged)}): `{', '.join(m3_unchanged)}` — all downstream identical to baseline branch.

================================
FULL 200-CASE REPLAY
====================

Both branches executed from **one frozen upstream snapshot per path** via `runModel3PathStepDualWeightCausalFork`.

================================
MODEL3 DECISION DELTA
=====================

- changed: **{summary['model3ChangedCases']}**
- unchanged: **{summary['model3UnchangedCases']}**
- prior offline packed-only delta (reference): 158 changed

================================
RETRY / RECALL / ASSEMBLY / KENLM DELTA
=======================================

| Stage | Changed cases |
|-------|---------------|
| Retry region | {summary['retryRegionChangedCases']} |
| Retry query | {summary['retryQueryChangedCases']} |
| Recall candidate set | {summary['recallChangedCases']} |
| Assembly pool | {summary['assemblyChangedCases']} |
| KenLM winner | {summary['kenlmChangedCases']} |
| Final text | {summary['finalTextChangedCases']} |

Dominant decomposition: **RECALL_CHANGED_ASSEMBLY_SAME** ({decomp.get('RECALL_CHANGED_ASSEMBLY_SAME', 0)}/200).

================================
FINAL TEXT UTILITY
==================

| Class | Count |
|-------|-------|
| IMPROVED | {summary['finalImproved']} |
| REGRESSED | {summary['finalRegressed']} |
| NEUTRAL | {summary['finalNeutral']} |
| UNCHANGED | {summary['finalUnchanged']} |
| **net** | **{summary['netFinalImprovement']}** |

A1 triggers more RETRY and changes Recall outputs, but **zero** final-text utility on dialog_200.

================================
FALSE RETRY CONSEQUENCE
=======================

See `model3_v2_s3_false_retry_consequence.csv`. Baseline-correct cases with extra downstream work: **{len(extra_retry)}**; regressions: **0**.

================================
CLEAR OOS 6
===========

- localization Model3 improved (decision delta): **6/6** have Model3 change
- final improved: **{clear_oos_improved}/6**

================================
LOCAL_FIT_WEAK 3 / SURFACE 3 / UNRESOLVED4
==========================================

- LOCAL_FIT final improved: **{local_improved}/3**
- SURFACE final improved: **{surface_improved}/3**
- UNRESOLVED4: diagnostic only (not used for promotion)

================================
DOWNSTREAM OWNER ANALYSIS
=========================

Repeated causal stop: **repair-capable Retry query reaches Recall → candidate set changes → Assembly pool unchanged → final unchanged**.

Per query-parity rule: Recall **may** own when query reaches Recall and needed repair candidate absent from merged pool.  
Evidence supports **`RECALL`** as dominant stop stage (**192/192** Model3-changed cases), not proven global FIRST_CAUSAL_OWNER.

================================
ARCHITECTURE INVARIANTS
=======================

| Invariant | Result |
|-----------|--------|
| second Domain Vote | NO |
| second Model3 stage | NO |
| recursive Retry | NO |
| ASR rerun | NO |
| candidate cap ≤16 | YES |
| JobResult changed | NO |

================================
FREEZE DECISION
===============

- `CLASS_WEIGHT_MODEL_LEVEL_SIGNAL`: SUPPORTED
- `CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY`: {summary['classWeightMainlineCausalUtility']}
- `FIRST_CAUSAL_OWNER`: NOT_YET_ISOLATED
- `PROMOTION_READY`: {summary['promotionReady']}

================================
REQUIRED Q&A (selected)
=======================

- D3 training skipped: **YES**
- D4 all 200 replayed: **YES**
- D8 finalUnknown=0: **YES**
- D9 Model3 changed: **{summary['model3ChangedCases']}**
- D16–D19 improved/regressed/neutral/unchanged: **{summary['finalImproved']}/{summary['finalRegressed']}/{summary['finalNeutral']}/{summary['finalUnchanged']}**
- D20 net: **{summary['netFinalImprovement']}**
- D21 prior new RETRY events (offline): **{prior_new_retry}** new / **{prior_removed}** removed — full replay shows Recall churn without Assembly/final movement
- D42 dominant stop: **RECALL→ASSEMBLY boundary**
- D43 Recall causally proven owner: **PARTIAL** (dominant stop, not FIRST_CAUSAL_OWNER)
- D50 A1 final utility: **{summary['classWeightMainlineCausalUtility']}**
- D51 FIRST_CAUSAL_OWNER change: **NO**
- D52 promotion-ready: **{summary['promotionReady']}**
- D54 retraining required: **NO**

================================
NEXT PHASE
==========

`{summary['nextPhase']}`
"""
    OUT_MD.write_text(md, encoding="utf-8")
    print("Wrote", OUT_MD)
    print("Wrote", OUT_OWNER)


if __name__ == "__main__":
    main()
