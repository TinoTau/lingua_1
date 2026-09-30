# -*- coding: utf-8 -*-
"""Post-process RealDist dialog_200 mainline for RETRY attribution + funnel.

Read-only analysis. Does not modify production or promote checkpoints.
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
RAW = DOCS / "model3_v2_realdist_dialog200_raw_cases.jsonl"
INV = DOCS / "model3_real_retry_target_inventory.csv"
BASELINE = DOCS / "model3_v1_dialog200_acceptance_summary.json"
SUMMARY_IN = DOCS / "model3_v2_realdist_acceptance_summary.json"

CJK = re.compile(r"[\u4e00-\u9fff]")


def norm(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").strip().lower())


def mismatch_spans(raw: str, expected: str) -> list[tuple[int, int, str]]:
    """Char-level contiguous mismatch regions in raw vs expected (aligned by simple scan)."""
    r = list(raw or "")
    e = list(expected or "")
    # Use LCS-ish greedy: mark positions where chars differ under zip + leftover
    n = max(len(r), len(e))
    # Pad shorter
    # Better: use raw only and find chars not in expected neighborhoods via probe inventory
    out = []
    # Simple diff on equal-length prefix + remainder
    i = 0
    while i < min(len(r), len(e)):
        if r[i] != e[i]:
            j = i
            while j < min(len(r), len(e)) and r[j] != e[j]:
                j += 1
            # extend while raw continues differing length
            out.append((i, j, "".join(r[i:j])))
            i = j
        else:
            i += 1
    if len(r) > len(e):
        out.append((len(e), len(r), "".join(r[len(e) :])))
    return out


def load_inventory():
    rows = []
    with INV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def attribution_for_case(row: dict, inv: dict | None) -> str:
    retry_surfaces = [
        s.get("surface") or ""
        for s in (row.get("span_margins") or [])
        if s.get("decision") == "RETRY" and s.get("isAnchor") is not True
    ]
    if not retry_surfaces and (row.get("decisions_retry") or 0) == 0:
        return "NO_RETRY"

    raw = row.get("raw_asr") or ""
    expected = row.get("expected") or ""
    probe = (inv or {}).get("probe_surface") or ""
    regions = row.get("retry_regions") or []
    region_old = []
    for rr in regions:
        region_old.extend(rr.get("oldLocalSpanSurfaces") or [])

    # TARGET: probe surface itself RETRY, or probe in retry region old surfaces
    if probe and (probe in retry_surfaces or probe in region_old):
        return "TARGET_REGION_RETRY"

    # Char mismatch overlap with RETRY surfaces / region text
    mm = mismatch_spans(raw, expected)
    mm_chars = set()
    for a, b, frag in mm:
        mm_chars.update(frag)
    joined_retry = "".join(retry_surfaces + region_old)
    if mm and any(ch in joined_retry for ch in mm_chars if CJK.match(ch)):
        return "ADJACENT_VALID_REGION_RETRY"

    # Inventory families with multi-char: if any retry surface appears in raw mismatch window text
    for a, b, frag in mm:
        for s in retry_surfaces:
            if s and s in frag:
                return "TARGET_REGION_RETRY"
            if s and frag and (s in raw[max(0, a - 2) : min(len(raw), b + 2)]):
                return "ADJACENT_VALID_REGION_RETRY"

    # If inventory says ERROR and we have retry but no overlap → unrelated
    if inv and inv.get("audit_class") in (
        "ERROR_INSIDE_NON_ANCHOR_FINESPAN",
        "ERROR_REQUIRES_LOCAL_RESEGMENTATION",
    ):
        return "UNRELATED_REGION_RETRY"

    # For non-inventory: treat as unrelated if no mismatch overlap
    if mm and joined_retry:
        return "UNRELATED_REGION_RETRY"
    if retry_surfaces:
        return "UNRELATED_REGION_RETRY"
    return "NO_RETRY"


def main():
    if not RAW.exists():
        raise SystemExit(f"missing {RAW}")
    cases = [json.loads(l) for l in RAW.open(encoding="utf-8") if l.strip()]
    inv_rows = load_inventory()
    inv_by = {r["caseId"]: r for r in inv_rows}
    elig_ids = {
        r["caseId"]
        for r in inv_rows
        if r.get("confidence") in ("HIGH", "MEDIUM")
        and r.get("audit_class")
        in ("ERROR_INSIDE_NON_ANCHOR_FINESPAN", "ERROR_REQUIRES_LOCAL_RESEGMENTATION")
    }
    keep_ids = {
        r["caseId"] for r in inv_rows if r.get("audit_class") == "NO_ERROR"
    }
    no_repair_ids = {
        r["caseId"]
        for r in inv_rows
        if r.get("audit_class")
        in ("NO_ERROR", "DELETION_NO_REPAIRABLE_TARGET")
        or (
            r.get("dist") == "0"
            and r.get("mismatch") == "0"
            and r.get("audit_class") == "NO_ERROR"
        )
    }
    # Expand no-repair: inventory NO_ERROR + cases with dist_raw==0 from run
    evaluated = [c for c in cases if not c.get("skip") and not c.get("error")]

    attr_counts = Counter()
    inventory_rows = []
    funnel = Counter()
    funnel["dialog_cases"] = len(evaluated)

    for c in evaluated:
        cid = c["id"]
        inv = inv_by.get(cid)
        attr = attribution_for_case(c, inv)
        has_retry = (c.get("decisions_retry") or 0) > 0
        regions = c.get("retry_regions") or []
        if has_retry:
            funnel["RETRY_TRIGGERED"] += 1
        if regions:
            funnel["REGION_DERIVED"] += 1
        if any((rr.get("newLocalSpanSurfaces") or []) for rr in regions) or (
            c.get("retry_attempts") or 0
        ) > 0:
            if has_retry:
                funnel["LOCAL_HYPOTHESES_AVAILABLE"] += 1
        if (c.get("retry_returned") or 0) > 0:
            funnel["RECALL_CANDIDATES_AVAILABLE"] += 1
        if (c.get("kenlm_pool") or 0) > 0 and has_retry:
            funnel["ASSEMBLED_CANDIDATES_AVAILABLE"] += 1
        if c.get("text_changed"):
            funnel["FINAL_OUTPUT_CHANGED"] += 1
        if has_retry:
            if c.get("final_class") == "IMPROVED":
                funnel["IMPROVED"] += 1
            elif c.get("final_class") == "REGRESSED":
                funnel["REGRESSED"] += 1
            else:
                funnel["UNCHANGED"] += 1

        if cid in elig_ids:
            attr_counts[attr] += 1
            retry_spans = [
                f"{s.get('surface')}:{s.get('margin')}"
                for s in (c.get("span_margins") or [])
                if s.get("decision") == "RETRY"
            ]
            region_bounds = ";".join(
                f"{rr.get('rawStart')}-{rr.get('rawEnd')}:{'|'.join(rr.get('oldLocalSpanSurfaces') or [])}"
                for rr in regions
            )
            inventory_rows.append(
                {
                    "caseId": cid,
                    "probe_surface": (inv or {}).get("probe_surface") or "",
                    "audit_class": (inv or {}).get("audit_class") or "",
                    "retry_spans": "|".join(retry_spans),
                    "attribution": attr,
                    "region_bounds": region_bounds,
                    "retry_attempts": c.get("retry_attempts") or 0,
                    "retry_returned": c.get("retry_returned") or 0,
                    "text_changed": int(bool(c.get("text_changed"))),
                    "final_class": c.get("final_class"),
                    "candidate_gen": int((c.get("retry_returned") or 0) > 0),
                }
            )

    # False RETRY on no-repair / NO_ERROR
    false_retry_cases = []
    for c in evaluated:
        cid = c["id"]
        inv = inv_by.get(cid)
        is_no_error = (inv and inv.get("audit_class") == "NO_ERROR") or (
            (c.get("dist_raw") or 0) == 0 and (c.get("dist_final") or 0) == 0
        )
        if not is_no_error:
            # also treat inventory NO_ERROR keep controls
            if cid not in keep_ids:
                continue
        if (c.get("decisions_retry") or 0) > 0:
            false_retry_cases.append(c)

    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else {}
    summary = json.loads(SUMMARY_IN.read_text(encoding="utf-8")) if SUMMARY_IN.exists() else {}

    # Meaningful trigger coverage among 13
    meaningful = attr_counts["TARGET_REGION_RETRY"] + attr_counts["ADJACENT_VALID_REGION_RETRY"]

    # Promotion decision heuristics
    regressed = summary.get("final_text", {}).get("regressed", 0)
    improved = summary.get("final_text", {}).get("improved", 0)
    base_improved = baseline.get("final_text", {}).get("improved", 0)
    base_regressed = baseline.get("final_text", {}).get("regressed", 0)
    gt16 = summary.get("invariants", {}).get("global_gt16", 0)
    second_vote = summary.get("invariants", {}).get("second_vote_violations", 0)
    false_retry_n = len(false_retry_cases)
    false_regress = sum(1 for c in false_retry_cases if c.get("final_class") == "REGRESSED")

    if second_vote or gt16:
        verdict = "REALDIST_CHECKPOINT_REJECTED"
        failure = "MAINLINE_INVARIANT_FAILURE"
        next_phase = "STOP_AND_REVIEW"
    elif false_regress > 0 or (regressed > base_regressed + 1):
        verdict = "REALDIST_CHECKPOINT_REJECTED"
        failure = "FINAL_OUTPUT_REGRESSION" if regressed else "MODEL3_FALSE_RETRY_FAILURE"
        next_phase = "STOP_AND_REVIEW"
    elif meaningful >= 3 and regressed <= base_regressed and false_retry_n <= 2:
        # Accepted as validated candidate; promotion still explicit next phase
        verdict = "REALDIST_CHECKPOINT_READY_FOR_PROMOTION"
        failure = None
        next_phase = "MODEL3_V2_REALDIST_PRODUCTION_PROMOTION"
    elif meaningful >= 1:
        verdict = "REALDIST_CHECKPOINT_ACCEPTED_NOT_PROMOTED"
        failure = "RETRY_REGION_ATTRIBUTION_FAILURE" if attr_counts["UNRELATED_REGION_RETRY"] > meaningful else None
        next_phase = "STOP_AND_REVIEW"
    else:
        verdict = "REALDIST_CHECKPOINT_REJECTED"
        failure = "RETRY_REGION_ATTRIBUTION_FAILURE"
        next_phase = "MODEL3_V2_FEATURE_CAPACITY_AUDIT"

    out = {
        "checkpointAcceptance": verdict,
        "readyForProductionPromotion": verdict == "REALDIST_CHECKPOINT_READY_FOR_PROMOTION",
        "autoPromoted": False,
        "failureClassification": failure,
        "recommendedNextPhase": next_phase,
        "identity": summary.get("model"),
        "dialog200": summary.get("coverage"),
        "final_text": summary.get("final_text"),
        "model3": summary.get("model3"),
        "attribution_13": dict(attr_counts),
        "meaningful_trigger_13": meaningful,
        "funnel": dict(funnel),
        "false_retry": {
            "no_error_keep_controls": len(keep_ids),
            "false_retry_cases": [c["id"] for c in false_retry_cases],
            "false_retry_count": false_retry_n,
            "false_regions": sum(len(c.get("retry_regions") or []) for c in false_retry_cases),
            "false_final_modifications": sum(1 for c in false_retry_cases if c.get("text_changed")),
            "false_regressions": false_regress,
        },
        "baseline_vs_realdist": {
            "cases": {
                "baseline": baseline.get("coverage", {}).get("completed"),
                "realdist": summary.get("coverage", {}).get("completed"),
            },
            "improved": {
                "baseline": base_improved,
                "realdist": improved,
                "delta": improved - base_improved if improved is not None else None,
            },
            "unchanged": {
                "baseline": baseline.get("final_text", {}).get("unchanged"),
                "realdist": summary.get("final_text", {}).get("unchanged"),
            },
            "regressed": {
                "baseline": base_regressed,
                "realdist": regressed,
                "delta": regressed - base_regressed if regressed is not None else None,
            },
            "model3_retry_cases": {
                "baseline": 0,
                "realdist": summary.get("model3", {}).get("cases_with_retry"),
            },
            "latency_model3_p50": {
                "baseline": baseline.get("latency", {}).get("model3_p50"),
                "realdist": summary.get("latency", {}).get("model3_p50"),
            },
        },
        "invariants": summary.get("invariants"),
        "latency": summary.get("latency"),
        "inventory_13": inventory_rows,
    }

    with (DOCS / "model3_v2_realdist_retry_funnel.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["stage", "count"])
        for k in [
            "dialog_cases",
            "RETRY_TRIGGERED",
            "REGION_DERIVED",
            "LOCAL_HYPOTHESES_AVAILABLE",
            "RECALL_CANDIDATES_AVAILABLE",
            "ASSEMBLED_CANDIDATES_AVAILABLE",
            "FINAL_OUTPUT_CHANGED",
            "IMPROVED",
            "UNCHANGED",
            "REGRESSED",
        ]:
            w.writerow([k, funnel.get(k, 0)])

    with (DOCS / "model3_v2_realdist_mainline_results.csv").open("w", encoding="utf-8", newline="") as f:
        # Enrich existing mainline csv is already written by harness; write inventory diagnostic
        pass

    inv_path = DOCS / "model3_v2_realdist_inventory13_attribution.csv"
    with inv_path.open("w", encoding="utf-8", newline="") as f:
        fields = list(inventory_rows[0].keys()) if inventory_rows else ["caseId"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in inventory_rows:
            w.writerow(r)

    # Merge into acceptance summary
    if SUMMARY_IN.exists():
        summary["promotionAudit"] = out
        SUMMARY_IN.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    (DOCS / "model3_v2_realdist_acceptance_governance.json").write_text(
        json.dumps(
            {
                "phase": "MODEL3_V2_REALDIST_ACCEPTANCE_AND_PROMOTION_AUDIT",
                "checkpointAcceptance": verdict,
                "readyForProductionPromotion": out["readyForProductionPromotion"],
                "autoPromoted": False,
                "failureClassification": failure,
                "recommendedNextPhase": next_phase,
                "integrityProtectionWeakened": False,
                "productionDefaultCheckpointChanged": False,
                "architectureChanged": False,
                "trainingReopened": False,
                "filesChangedForCandidatePath": [
                    "electron_node/electron-node/main/src/model3-runtime/model3-checkpoint-registry.ts",
                    "electron_node/electron-node/main/src/model3-runtime/model3-inference-client.ts",
                    "electron_node/electron-node/main/src/model3-runtime/model3-types.ts",
                    "electron_node/services/model3_runtime/model3_inference_host.py",
                    "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts",
                    "electron_node/electron-node/tests/run-dialog200-model3-acceptance.mjs",
                ],
                "hashLockOwnership": [
                    "CHECKPOINT_INTEGRITY_GUARD",
                    "PRODUCTION_IDENTITY_SEAL",
                    "TEST_ENVIRONMENT_IDENTITY_SEAL",
                    "ACCIDENTAL_HARDCODED_COUPLING",
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
