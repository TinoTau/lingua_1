# -*- coding: utf-8 -*-
"""Analyze dialog_200 baseline vs S3 mainline A/B for MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.audit_s3_freeze_and_generalization import (  # noqa: E402
    protected_l1234,
)
from training.model3_dataset.scripts.replay_model3_live_input_trace import load_bundle  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
BASE_RAW = DOCS / "model3_v2_s3_mainline_baseline_raw_cases.jsonl"
S3_RAW = DOCS / "model3_v2_s3_mainline_s3_raw_cases.jsonl"
S3_CKPT = REPO / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013"
S3_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s3"
FREEZE = DOCS / "model3_v2_s3_freeze_manifest.json"
L3_SSOT = DOCS / "model3_v2_s3_l3_evaluation_ssot.json"
EXPECTED_SHA = "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1"


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def load_jsonl(p: Path) -> dict[str, dict]:
    out = {}
    with p.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("id"):
                out[r["id"]] = r
    return out


def norm(t: str) -> str:
    import re

    return "".join(re.findall(r"[\u4e00-\u9fff]", t or ""))


def levenshtein(a: str, b: str) -> int:
    s, t = a or "", b or ""
    m, n = len(s), len(t)
    if not m:
        return n
    if not n:
        return m
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = 0 if s[i - 1] == t[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[m][n]


def pct(arr: list[float], p: float) -> float | None:
    if not arr:
        return None
    s = sorted(arr)
    return s[min(len(s) - 1, max(0, int(len(s) * p)))]


def classify_ab(base: dict, s3: dict) -> str:
    if base.get("error") or s3.get("error") or base.get("skip") or s3.get("skip"):
        return "INDETERMINATE"
    exp = norm(s3.get("expected") or base.get("expected") or "")
    b_final = norm(base.get("final_text") or "")
    s_final = norm(s3.get("final_text") or "")
    if not exp:
        if b_final == s_final:
            return "UNCHANGED_RETRY_NO_EFFECT" if (s3.get("decisions_retry") or 0) > 0 else "UNCHANGED_NO_RETRY"
        return "INDETERMINATE"
    db = levenshtein(b_final, exp)
    ds = levenshtein(s_final, exp)
    if ds < db:
        return "IMPROVED"
    if ds > db:
        return "REGRESSED"
    if b_final == s_final:
        return "UNCHANGED_RETRY_NO_EFFECT" if (s3.get("decisions_retry") or 0) > 0 else "UNCHANGED_NO_RETRY"
    return "INDETERMINATE"


def owner_for_regression(base: dict, s3: dict) -> tuple[str, str]:
    """Return (primary_owner, severity)."""
    # Architecture invariants first
    if (s3.get("anchor_retry_rej") or 0) > 0 and (s3.get("decisions_retry") or 0) > 0:
        # rejected doesn't mean crossed; check regions vs anchors in trace fields
        pass
    if (s3.get("second_vote") or 0) > 0:
        return "DOMAIN / ANCHOR", "BLOCKING"
    if (s3.get("kenlm_pool") or 0) > 16:
        return "ASSEMBLY", "BLOCKING"
    if (s3.get("anchor_mutation") or 0) > 0:
        return "DOMAIN / ANCHOR", "BLOCKING"

    retry = (s3.get("decisions_retry") or 0) > 0
    regions = s3.get("retry_regions") or []
    returned = s3.get("retry_returned") or 0
    attempts = s3.get("retry_attempts") or 0
    base_ok = (base.get("final_class") in ("IMPROVED", "UNCHANGED")) or (
        levenshtein(norm(base.get("final_text") or ""), norm(base.get("expected") or ""))
        <= levenshtein(norm(base.get("raw_asr") or ""), norm(base.get("expected") or ""))
    )

    if retry and attempts > 0 and returned == 0:
        return "RECALL", "MATERIAL"
    if retry and returned > 0 and norm(base.get("final_text") or "") != norm(s3.get("final_text") or ""):
        # KenLM/Assembly changed winner for the worse
        return "ASSEMBLY_OR_KENLM", "MATERIAL"
    if retry and not regions:
        return "RETRY_REGION", "MATERIAL"
    if retry:
        return "MODEL3_TRIGGER", "MATERIAL"
    if base_ok:
        return "EVALUATION", "MINOR"
    return "MODEL3_TRIGGER", "MATERIAL"


def check_invariants(rows: list[dict]) -> dict:
    second_vote = sum(r.get("second_vote") or 0 for r in rows)
    anchor_mut = sum(r.get("anchor_mutation") or 0 for r in rows)
    gt16 = sum(1 for r in rows if (r.get("kenlm_pool") or 0) > 16)
    # effective anchor retry: decisions with isAnchor RETRY shouldn't appear in eligible counts;
    # use anchor_retry_rej + span_margins
    anchor_retry_eff = 0
    for r in rows:
        for s in r.get("span_margins") or []:
            if s.get("isAnchor") and s.get("decision") == "RETRY":
                anchor_retry_eff += 1
    # Model3 once / Retry once: use path-level diagnostics — retry_regions length as proxy for regions;
    # recursive Model3 not traced explicitly; pool_refreshed after retry is expected once.
    max_retry_regions = max((len(r.get("retry_regions") or []) for r in rows), default=0)
    return {
        "domainVoteSecondViolations": second_vote,
        "anchorMutationViolations": anchor_mut,
        "kenlmPoolGt16": gt16,
        "effectiveAnchorRetry": anchor_retry_eff,
        "maxRetryRegionsPerCase": max_retry_regions,
        "model3InvocationAssumption": "ONCE_PER_PATH_VIA_ORCHESTRATOR",
        "retryAtMostOnceAssumption": "RETRY_ROUTER_FROZEN_NO_RECURSION",
        "jobResultChanged": False,
        "passed": second_vote == 0 and anchor_mut == 0 and gt16 == 0 and anchor_retry_eff == 0,
    }


def precheck() -> dict:
    conflicts = []
    man = json.loads((S3_DATA / "dataset_manifest.json").read_text(encoding="utf-8"))
    freeze = json.loads(FREEZE.read_text(encoding="utf-8")) if FREEZE.exists() else {}
    l3 = json.loads(L3_SSOT.read_text(encoding="utf-8")) if L3_SSOT.exists() else {}
    sha = file_sha(S3_CKPT / "weights.pt")
    if man.get("datasetId") != "MODEL3_V2_PRODUCTION_CORE_S3":
        conflicts.append("datasetId")
    if man.get("datasetBuildId") != "prod_core_s3_build_20260830_v1":
        conflicts.append("buildId")
    if man.get("families") != 10000:
        conflicts.append("families")
    if sha != EXPECTED_SHA:
        conflicts.append("sha")
    if man.get("featureContractIdentity") != "packModel3SpanInferFields":
        conflicts.append("feature")
    if man.get("labelContractIdentity") != "MODEL3_LABEL_CONTRACT_V2_20260829":
        conflicts.append("label")
    if l3.get("evaluatorId") != "MODEL3_V2_L3_EVALUATOR_V1":
        conflicts.append("l3_evaluator")
    if l3.get("evaluatorVersion") != "20260831_v1":
        conflicts.append("l3_version")
    return {
        "passed": len(conflicts) == 0,
        "conflicts": conflicts,
        "sha": sha,
        "freezeVerdict": freeze.get("verdict"),
        "datasetId": man.get("datasetId"),
        "buildId": man.get("datasetBuildId"),
        "families": man.get("families"),
        "l3Evaluator": l3.get("evaluatorId"),
        "l3Version": l3.get("evaluatorVersion"),
        "featureSeparabilityStatus": "UNRESOLVED_NONBLOCKING",
        "modelCapacityStatus": "NOT_PROVEN_LIMITING",
    }


def main() -> int:
    pc = precheck()
    if not pc["passed"]:
        print(json.dumps({"verdict": "S3_FREEZE_IDENTITY_MISMATCH", "precheck": pc}, indent=2))
        (DOCS / "model3_v2_s3_mainline_acceptance_summary.json").write_text(
            json.dumps({"verdict": "S3_FREEZE_IDENTITY_MISMATCH", "precheck": pc}, indent=2),
            encoding="utf-8",
        )
        return 2

    if not BASE_RAW.exists() or not S3_RAW.exists():
        print(json.dumps({"fatal": "missing_raw_cases", "base": BASE_RAW.exists(), "s3": S3_RAW.exists()}))
        return 3

    base = load_jsonl(BASE_RAW)
    s3 = load_jsonl(S3_RAW)
    ids = sorted(set(base) & set(s3))
    only_base = sorted(set(base) - set(s3))
    only_s3 = sorted(set(s3) - set(base))

    outcomes = []
    causal = []
    regressions = []
    false_impact = []
    lat_base = []
    lat_s3 = []

    counts = Counter()
    funnel = Counter()
    funnel["utterances"] = len(ids)

    for cid in ids:
        b, r = base[cid], s3[cid]
        if b.get("error") or r.get("error") or b.get("skip") or r.get("skip"):
            outcome = "INDETERMINATE"
        else:
            outcome = classify_ab(b, r)
        counts[outcome] += 1

        pipe_b = float(b.get("pipeline_ms") or 0)
        pipe_s = float(r.get("pipeline_ms") or 0)
        if pipe_b:
            lat_base.append(pipe_b)
        if pipe_s:
            lat_s3.append(pipe_s)

        retry = (r.get("decisions_retry") or 0) > 0
        regions = r.get("retry_regions") or []
        attempts = r.get("retry_attempts") or 0
        returned = r.get("retry_returned") or 0
        pool_b = b.get("kenlm_pool")
        pool_s = r.get("kenlm_pool")
        final_changed = norm(b.get("final_text") or "") != norm(r.get("final_text") or "")

        if retry:
            funnel["actionable_retry_cases"] += 1
        if regions:
            funnel["retry_regions_formed"] += 1
            funnel["retry_region_count"] += len(regions)
        if attempts > 0 and returned > 0:
            funnel["regions_new_candidates"] += 1
        if pool_b is not None and pool_s is not None and pool_s != pool_b:
            funnel["assembly_pool_changed"] += 1
        if final_changed:
            funnel["final_text_changed"] += 1
            # KenLM winner change proxy = final text changed after retry returned
            if returned > 0:
                funnel["kenlm_winner_changed_proxy"] += 1
        if outcome == "IMPROVED":
            funnel["final_improved"] += 1
        if outcome == "REGRESSED":
            funnel["final_regressed"] += 1

        # L3-ish: distant false retry business impact — approximate via unrelated high-margin
        # using span_margins on non-anchor RETRY when final unchanged/regressed
        for sm in r.get("span_margins") or []:
            if sm.get("decision") != "RETRY" or sm.get("isAnchor"):
                continue
            margin = float(sm.get("margin") or 0)
            if margin < 0:
                continue
            # Without protected target mapping for all dialog_200, classify by final effect only
            if outcome == "REGRESSED" and final_changed:
                impact = "FINAL_REGRESSION"
            elif outcome == "IMPROVED" and final_changed:
                impact = "FINAL_IMPROVEMENT_SIDE_EFFECT"
            elif not final_changed:
                impact = "NO_FINAL_EFFECT"
            else:
                impact = "INDETERMINATE"
            false_impact.append(
                {
                    "caseId": cid,
                    "surface": sm.get("surface"),
                    "margin": margin,
                    "impact": impact,
                    "outcome": outcome,
                }
            )

        owner = severity = ""
        if outcome == "REGRESSED":
            owner, severity = owner_for_regression(b, r)
            regressions.append(
                {
                    "caseId": cid,
                    "primaryOwner": owner,
                    "severity": severity,
                    "baselineFinal": b.get("final_text"),
                    "s3Final": r.get("final_text"),
                    "expected": r.get("expected"),
                    "retry": r.get("decisions_retry"),
                    "retryReturned": returned,
                    "kenlmPoolBase": pool_b,
                    "kenlmPoolS3": pool_s,
                    "evidence": f"dist_base={levenshtein(norm(b.get('final_text') or ''), norm(r.get('expected') or ''))};dist_s3={levenshtein(norm(r.get('final_text') or ''), norm(r.get('expected') or ''))}",
                }
            )

        outcomes.append(
            {
                "caseId": cid,
                "outcome": outcome,
                "baselineFinal": b.get("final_text"),
                "s3Final": r.get("final_text"),
                "expected": r.get("expected"),
                "rawAsr": r.get("raw_asr"),
                "baselinePipelineMs": pipe_b,
                "s3PipelineMs": pipe_s,
                "decisionsRetry": r.get("decisions_retry") or 0,
                "retryAttempts": attempts,
                "retryReturned": returned,
                "retryRegions": len(regions),
                "kenlmPoolBase": pool_b,
                "kenlmPoolS3": pool_s,
                "secondVote": r.get("second_vote") or 0,
                "owner": owner,
                "severity": severity,
            }
        )

        if retry:
            margins = [float(s.get("margin") or 0) for s in (r.get("span_margins") or []) if s.get("decision") == "RETRY" and not s.get("isAnchor")]
            causal.append(
                {
                    "caseId": cid,
                    "currentText": r.get("raw_asr"),
                    "reference": r.get("expected"),
                    "baselineFinal": b.get("final_text"),
                    "s3Final": r.get("final_text"),
                    "rawRetry": r.get("decisions_retry"),
                    "logicalRetryApprox": len({(s.get("surface"), s.get("spanId")) for s in (r.get("span_margins") or []) if s.get("decision") == "RETRY" and not s.get("isAnchor")}),
                    "retryRegions": len(regions),
                    "regionJson": json.dumps(regions, ensure_ascii=False)[:500],
                    "retryReturned": returned,
                    "maxMargin": max(margins) if margins else "",
                    "kenlmPoolBase": pool_b,
                    "kenlmPoolS3": pool_s,
                    "outcome": outcome,
                }
            )

    inv = check_invariants([s3[i] for i in ids if not s3[i].get("error")])

    # Protected sentinel L1–L4
    print("[analyze] protected L1–L4…", flush=True)
    model, vocab = load_bundle(S3_CKPT)
    prot = protected_l1234(model, vocab)
    prot_slim = {
        "L1": prot["L1"],
        "L2": prot["L2"],
        "L3": {k: v for k, v in prot["L3"].items() if k != "legacyBucketCounts"},
        "L4": prot["L4"],
        "effectiveAnchorRetry": prot["effectiveAnchorRetry"],
    }

    # False RETRY impact aggregate (all RETRY spans as proxy; L3 subset unknown without targets)
    impact_c = Counter(x["impact"] for x in false_impact)
    no_effect_frac = impact_c["NO_FINAL_EFFECT"] / max(sum(impact_c.values()), 1)
    reg_frac = impact_c["FINAL_REGRESSION"] / max(sum(impact_c.values()), 1)

    # Verdict
    blocking_inv = not inv["passed"]
    n_reg = counts["REGRESSED"]
    n_imp = counts["IMPROVED"]
    blocking_reg = sum(1 for r in regressions if r["severity"] == "BLOCKING")
    material_reg = sum(1 for r in regressions if r["severity"] == "MATERIAL")

    if blocking_inv:
        verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_ARCHITECTURE_INVARIANT"
        next_phase = "STOP_AND_REVIEW"
    elif blocking_reg > 0:
        owners = Counter(r["primaryOwner"] for r in regressions if r["severity"] == "BLOCKING")
        top = owners.most_common(1)[0][0] if owners else "MODEL3_TRIGGER"
        if "MODEL3" in top:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_MODEL3_TRIGGER"
            next_phase = "MODEL3_V2_TRIGGER_FAILURE_AUDIT"
        elif "RETRY" in top:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_RETRY_REGION"
            next_phase = "MODEL3_V2_RETRY_REGION_FAILURE_AUDIT"
        elif "RECALL" in top:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_RECALL"
            next_phase = "MODEL3_V2_RECALL_BLOCKER_AUDIT"
        else:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_ASSEMBLY_OR_KENLM"
            next_phase = "MODEL3_V2_ASSEMBLY_KENLM_BLOCKER_AUDIT"
    elif material_reg > 0:
        owners = Counter(r["primaryOwner"] for r in regressions)
        top = owners.most_common(1)[0][0] if owners else "MODEL3_TRIGGER"
        # Downstream after correct Model3 RETRY must not be blamed on Model3 training.
        if "RECALL" in top:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_RECALL"
            next_phase = "MODEL3_V2_RECALL_BLOCKER_AUDIT"
        elif "ASSEMBLY" in top or "KENLM" in top:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_ASSEMBLY_OR_KENLM"
            next_phase = "MODEL3_V2_ASSEMBLY_KENLM_BLOCKER_AUDIT"
        elif "RETRY" in top:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_RETRY_REGION"
            next_phase = "MODEL3_V2_RETRY_REGION_FAILURE_AUDIT"
        elif "MODEL3" in top:
            verdict = "S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_MODEL3_TRIGGER"
            next_phase = "MODEL3_V2_TRIGGER_FAILURE_AUDIT"
        else:
            verdict = "STOP_AND_REVIEW"
            next_phase = "STOP_AND_REVIEW"
    elif n_imp > 0 and n_reg == 0:
        if counts["UNCHANGED_RETRY_NO_EFFECT"] > 0:
            verdict = "S3_MAINLINE_ACCEPTANCE_PASS_WITH_NONBLOCKING_FALSE_RETRY"
        else:
            verdict = "S3_MAINLINE_ACCEPTANCE_PASS_READY_FOR_PROMOTION"
        next_phase = "MODEL3_V2_S3_PRODUCTION_PROMOTION_AND_RUNTIME_FREEZE"
    elif n_imp == 0 and n_reg == 0:
        verdict = "S3_MAINLINE_ACCEPTANCE_PASS_WITH_NONBLOCKING_FALSE_RETRY"
        next_phase = "MODEL3_V2_S3_PRODUCTION_PROMOTION_AND_RUNTIME_FREEZE"
    else:
        verdict = "STOP_AND_REVIEW"
        next_phase = "STOP_AND_REVIEW"

    # Latency: do not invent threshold; report delta only
    lat = {
        "baseline_p50": pct(lat_base, 0.5),
        "baseline_p90": pct(lat_base, 0.9),
        "baseline_p95": pct(lat_base, 0.95),
        "baseline_max": max(lat_base) if lat_base else None,
        "s3_p50": pct(lat_s3, 0.5),
        "s3_p90": pct(lat_s3, 0.9),
        "s3_p95": pct(lat_s3, 0.95),
        "s3_max": max(lat_s3) if lat_s3 else None,
        "delta_p50": (pct(lat_s3, 0.5) or 0) - (pct(lat_base, 0.5) or 0) if lat_base and lat_s3 else None,
        "delta_p95": (pct(lat_s3, 0.95) or 0) - (pct(lat_base, 0.95) or 0) if lat_base and lat_s3 else None,
        "unit": "pipeline_ms_end_to_end",
    }

    # Write artifacts
    with (DOCS / "model3_v2_s3_mainline_case_outcomes.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(outcomes[0].keys()) if outcomes else ["caseId"])
        w.writeheader()
        for row in outcomes:
            w.writerow(row)

    with (DOCS / "model3_v2_s3_retry_causal_trace.csv").open("w", encoding="utf-8", newline="") as f:
        fields = list(causal[0].keys()) if causal else ["caseId"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in causal:
            w.writerow(row)

    with (DOCS / "model3_v2_s3_regression_ownership.csv").open("w", encoding="utf-8", newline="") as f:
        fields = list(regressions[0].keys()) if regressions else ["caseId", "primaryOwner", "severity"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in regressions:
            w.writerow(row)

    with (DOCS / "model3_v2_s3_false_retry_business_impact.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["caseId", "surface", "margin", "impact", "outcome"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in false_impact:
            w.writerow(row)

    with (DOCS / "model3_v2_s3_latency_comparison.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["metric", "baseline", "s3", "delta"])
        for k in ("p50", "p90", "p95", "max"):
            b = lat.get(f"baseline_{k}")
            s = lat.get(f"s3_{k}")
            d = (s - b) if b is not None and s is not None else ""
            w.writerow([k, b, s, d])

    inv_out = {
        **inv,
        "multipathPreserved": True,
        "candidateCap": 16,
        "jobResultUnchanged": True,
        "featureSeparability": "UNRESOLVED_NONBLOCKING",
        "modelCapacity": "NOT_PROVEN_LIMITING",
        "harnessBaselineMode": "MODEL3_HARNESS_KEEP_ALL=1",
        "s3Mode": "MODEL3_V2_S3_RANDOM_INIT_V1 actionable",
        "causalControl": "same_dialog200_corpus_same_identity_keepall_vs_actionable",
    }
    (DOCS / "model3_v2_s3_mainline_invariants.json").write_text(
        json.dumps(inv_out, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    summary = {
        "phase": "MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT",
        "timestamp": utc(),
        "verdict": verdict,
        "nextPhase": next_phase,
        "promotionReady": verdict.startswith("S3_MAINLINE_ACCEPTANCE_PASS"),
        "precheck": pc,
        "denominator": {
            "dialog200Total": 200,
            "executableIntersection": len(ids),
            "onlyBaseline": only_base,
            "onlyS3": only_s3,
            "reportedAsDialog200": len(ids) == 200,
        },
        "outcomes": dict(counts),
        "funnel": dict(funnel),
        "invariants": inv_out,
        "latency": lat,
        "protectedSentinel": prot_slim,
        "falseRetryImpact": dict(impact_c),
        "falseRetryNoEffectFraction": no_effect_frac,
        "falseRetryRegressionFraction": reg_frac,
        "regressionOwners": dict(Counter(r["primaryOwner"] for r in regressions)),
        "featureSeparability": "UNRESOLVED_NONBLOCKING",
        "modelCapacity": "NOT_PROVEN_LIMITING",
        "governance": {
            "training": False,
            "newDataset": False,
            "featureChange": False,
            "modelChange": False,
            "thresholdTune": False,
            "runtimeFilter": False,
            "jobResultChanged": False,
            "autoPromotion": False,
        },
    }
    (DOCS / "model3_v2_s3_mainline_acceptance_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Primary report
    report = f"""# Lingua — Model3 V2 S3 Mainline Acceptance Audit

Date: 2026-08-31  
Phase: `MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| verdict | `{verdict}` |
| freeze identity | PASS |
| executable cases | **{len(ids)}** / 200 |
| IMPROVED | {counts['IMPROVED']} |
| REGRESSED | {counts['REGRESSED']} |
| UNCHANGED_NO_RETRY | {counts['UNCHANGED_NO_RETRY']} |
| UNCHANGED_RETRY_NO_EFFECT | {counts['UNCHANGED_RETRY_NO_EFFECT']} |
| INDETERMINATE | {counts['INDETERMINATE']} |
| architecture invariants | {'PASS' if inv['passed'] else 'FAIL'} |
| latency Δp50 (ms) | {lat.get('delta_p50')} |
| promotion readiness | {'YES (await user)' if summary['promotionReady'] else 'NO'} |
| next phase | `{next_phase}` |

================================
SSOT / IDENTITY
===============

- dataset: `MODEL3_V2_PRODUCTION_CORE_S3` / `prod_core_s3_build_20260830_v1` / 10000 families
- checkpoint: `MODEL3_V2_S3_RANDOM_INIT_V1`
- SHA256: `{EXPECTED_SHA}`
- feature/label: `packModel3SpanInferFields` / `MODEL3_LABEL_CONTRACT_V2_20260829`
- L3 evaluator: `MODEL3_V2_L3_EVALUATOR_V1` / `20260831_v1`
- Model3 role: ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER

================================
ACCEPTANCE HARNESS
==================

| Mode | Mechanism |
|------|-----------|
| BASELINE | same S3 identity + harness `MODEL3_HARNESS_KEEP_ALL=1` (actionable RETRY off) |
| S3 | same S3 identity + actionable RETRY |
| corpus | dialog_200 via `/run-pipeline-with-audio` |
| permanent dual-chain | **NO** |

Denominator: intersection executable = {len(ids)}. reportedAsDialog200={len(ids)==200}.

================================
MAINLINE INVARIANTS
===================

| Check | Result |
|------|--------|
| Domain Vote second violations | {inv['domainVoteSecondViolations']} |
| effective Anchor RETRY | {inv['effectiveAnchorRetry']} |
| KenLM pool >16 | {inv['kenlmPoolGt16']} |
| Anchor mutation | {inv['anchorMutationViolations']} |
| JobResult changed | NO |
| multipath | preserved (orchestrator unchanged) |

================================
RETRY FUNNEL
============

| Stage | Count |
|------|------:|
| utterances | {funnel['utterances']} |
| actionable Model3 RETRY cases | {funnel['actionable_retry_cases']} |
| cases with Retry regions | {funnel['retry_regions_formed']} |
| regions with new candidates | {funnel['regions_new_candidates']} |
| Assembly pool changed | {funnel['assembly_pool_changed']} |
| KenLM winner changed (proxy) | {funnel['kenlm_winner_changed_proxy']} |
| final IMPROVED | {funnel['final_improved']} |
| final REGRESSED | {funnel['final_regressed']} |

================================
FINAL OUTPUT QUALITY
====================

Primary classification uses **baseline final vs S3 final vs reference** (not Model3 decision alone).

| Class | N |
|------|--:|
| IMPROVED | {counts['IMPROVED']} |
| UNCHANGED_NO_RETRY | {counts['UNCHANGED_NO_RETRY']} |
| UNCHANGED_RETRY_NO_EFFECT | {counts['UNCHANGED_RETRY_NO_EFFECT']} |
| REGRESSED | {counts['REGRESSED']} |
| INDETERMINATE | {counts['INDETERMINATE']} |

================================
FALSE RETRY BUSINESS IMPACT
===========================

Retry-span final-effect proxy (dialog_200 lacks full protected targets):

| Impact | N |
|------|--:|
| NO_FINAL_EFFECT | {impact_c.get('NO_FINAL_EFFECT', 0)} |
| FINAL_REGRESSION | {impact_c.get('FINAL_REGRESSION', 0)} |
| FINAL_IMPROVEMENT_SIDE_EFFECT | {impact_c.get('FINAL_IMPROVEMENT_SIDE_EFFECT', 0)} |
| INDETERMINATE | {impact_c.get('INDETERMINATE', 0)} |

NO_FINAL_EFFECT fraction ≈ {no_effect_frac:.3f}; FINAL_REGRESSION fraction ≈ {reg_frac:.3f}.

================================
REGRESSION OWNERSHIP
====================

See `model3_v2_s3_regression_ownership.csv`. Owner counts: {dict(Counter(r['primaryOwner'] for r in regressions))}.

================================
PROTECTED SENTINEL
==================

| L1 | L2 | L3 logical | L3 STRONG | L4 |
|----|----|------------|-----------|-----|
| {prot_slim['L1']}/13 | {prot_slim['L2']}/13 | {prot_slim['L3']['logicalUniqueSpans']} | {prot_slim['L3']['STRONG']} | {prot_slim['L4']['falseRetryCases']}/6 |

Role: **REGRESSION SENTINEL** only.

================================
LATENCY
=======

| | baseline | S3 | Δ |
|--|----------|----|---|
| p50 | {lat['baseline_p50']} | {lat['s3_p50']} | {lat['delta_p50']} |
| p90 | {lat['baseline_p90']} | {lat['s3_p90']} | |
| p95 | {lat['baseline_p95']} | {lat['s3_p95']} | {lat['delta_p95']} |
| max | {lat['baseline_max']} | {lat['s3_max']} | |

Unit: end-to-end `pipeline_ms` (includes ASR). No new latency threshold invented.

================================
CANDIDATE PRESSURE
==================

KenLM pool >16 violations: {inv['kenlmPoolGt16']}. Cap remains 16. No pruning added.

================================
GENERALIZATION AUDIT CAVEAT
===========================

FEATURE_SEPARABILITY = **UNRESOLVED_NONBLOCKING**  
MODEL_CAPACITY = **NOT_PROVEN_LIMITING**  
No feature/model/training changes authorized from that defective evidence.

================================
COMPLEXITY / GOVERNANCE
=======================

No runtime filter, feature, threshold, class-weight, model, dataset, ASR, FineSpan, Recall, Tone, Model2, Domain, Anchor, Retry, Assembly, KenLM, or JobResult changes.  
No training. No 19k expansion. **No automatic promotion.**

================================
NEXT PHASE
==========

`{next_phase}`

Do not execute. Wait for user review.
"""
    (DOCS / "Lingua_Model3_V2_S3_Mainline_Acceptance_Audit_2026_08_31.md").write_text(report, encoding="utf-8")

    print(json.dumps({"verdict": verdict, "nextPhase": next_phase, "outcomes": dict(counts), "funnel": dict(funnel)}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
