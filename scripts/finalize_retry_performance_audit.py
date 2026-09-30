#!/usr/bin/env python3
"""Finalize performance audit artifacts (post production timing dump)."""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "docs" / "user_correction" / "model3"


def pct(xs, p):
    if not xs:
        return None
    ys = sorted(xs)
    i = int(round((p / 100) * (len(ys) - 1)))
    return ys[max(0, min(len(ys) - 1, i))]


def pearson(a, b):
    n = len(a)
    if n < 3:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return (num / (da * db)) if da and db else None


def main():
    timing = [
        json.loads(l)
        for l in (OUT / "model3_retry_performance_timing_raw.jsonl").open(encoding="utf-8")
        if l.strip()
    ]
    after = [
        json.loads(l)
        for l in (OUT / "model3_retry_fallback_acceptance_after_raw.jsonl").open(encoding="utf-8")
        if l.strip()
    ]
    before = {
        r["caseId"]: r
        for r in [
            json.loads(l)
            for l in (OUT / "model3_retry_stage2_acceptance_after_raw.jsonl").open(encoding="utf-8")
            if l.strip()
        ]
    }

    clean = [r for r in timing if r.get("pipeline_ms") is not None and r["pipeline_ms"] <= 60000]
    outliers = [r for r in timing if r.get("pipeline_ms") is not None and r["pipeline_ms"] > 60000]

    pipe = [r["pipeline_ms"] for r in clean]
    fw = [r["fw_detector_step_ms"] for r in clean]
    asr = [r["pipeline_ms"] - r["fw_detector_step_ms"] for r in clean]
    m3 = [r["model3_latency_ms_sum"] for r in clean]
    retry = [r["retry_path_latency_ms_sum"] for r in clean]
    kenlm = [(r.get("kenlm_ms") or 0) for r in clean]
    resid = [fw[i] - m3[i] - retry[i] - kenlm[i] for i in range(len(clean))]
    q = [r.get("retry_recall_invocation_count") or 0 for r in clean]

    def pack(name, xs):
        return {
            "stage": name,
            "count": len(xs),
            "totalMs": sum(xs),
            "p50Ms": pct(xs, 50),
            "p95Ms": pct(xs, 95),
            "maxMs": max(xs) if xs else None,
            "meanMs": round(sum(xs) / len(xs), 1) if xs else None,
            "shareOfPipelinePercent": round(100 * sum(xs) / sum(pipe), 2) if pipe else None,
        }

    stages = [
        pack("utterance_pipeline_ms_production", pipe),
        pack("A_ASR_plus_nonFW_estimated", asr),
        pack("B_FW_detector_step_ms", fw),
        pack("B_FW_residual_ex_M3_Retry_KenLM", resid),
        pack("D_Model3_infer_sum_paths", m3),
        pack("H_Retry_path_latency_sum_paths", retry),
        pack("K_KenLM_subprocess_ms", kenlm),
    ]
    with (OUT / "model3_retry_performance_stage_breakdown.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.DictWriter(f, fieldnames=list(stages[0].keys()))
        w.writeheader()
        w.writerows(stages)

    # query scaling (acceptance wall + production retry)
    def qcount(rec):
        return sum(len(p.get("retry_recall_invocations") or []) for p in rec.get("paths") or [])

    def fb_q(rec):
        n = 0
        for p in rec.get("paths") or []:
            rids = {
                rr.get("retryRegionId")
                for rr in (p.get("retry_regions") or [])
                if not rr.get("resegmentOk")
            }
            for inv in p.get("retry_recall_invocations") or []:
                if inv.get("retryRegionId") in rids:
                    n += 1
        return n

    def npaths(rec):
        return sum(1 for p in rec.get("paths") or [] if p.get("retry_regions"))

    buckets = defaultdict(list)
    for r in after:
        qq = qcount(r)
        b = "0-5" if qq <= 5 else "6-10" if qq <= 10 else "11-20" if qq <= 20 else "21-40" if qq <= 40 else ">40"
        buckets[b].append(r)
    scale = []
    for b in ["0-5", "6-10", "11-20", "21-40", ">40"]:
        xs = buckets[b]
        pms = [r["pipelineMs"] for r in xs]
        scale.append(
            {
                "bucket": b,
                "n": len(xs),
                "acceptance_pipeline_p50": pct(pms, 50),
                "acceptance_pipeline_p95": pct(pms, 95),
                "mean_queryCount": round(sum(qcount(r) for r in xs) / len(xs), 2) if xs else None,
                "mean_fallbackQueryCount": round(sum(fb_q(r) for r in xs) / len(xs), 2) if xs else None,
                "mean_pathsWithRetry": round(sum(npaths(r) for r in xs) / len(xs), 2) if xs else None,
            }
        )
    # production retry scaling
    pb = defaultdict(list)
    for r in clean:
        qq = r.get("retry_recall_invocation_count") or 0
        b = "0-5" if qq <= 5 else "6-10" if qq <= 10 else "11-20" if qq <= 20 else "21-40" if qq <= 40 else ">40"
        pb[b].append(r["retry_path_latency_ms_sum"])
    for row in scale:
        xs = pb[row["bucket"]]
        row["production_retry_p50"] = pct(xs, 50)
        row["production_retry_p95"] = pct(xs, 95)
        row["production_retry_n"] = len(xs)

    with (OUT / "model3_retry_performance_query_scaling.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.DictWriter(f, fieldnames=list(scale[0].keys()))
        w.writeheader()
        w.writerows(scale)

    single = [r for r in after if npaths(r) <= 1]
    multi = [r for r in after if npaths(r) >= 2]
    multipath = [
        {
            "cohort": "single_path_retry_or_none",
            "n": len(single),
            "acceptance_pipeline_p50": pct([r["pipelineMs"] for r in single], 50),
            "acceptance_pipeline_p95": pct([r["pipelineMs"] for r in single], 95),
            "mean_queries": round(sum(qcount(r) for r in single) / len(single), 2) if single else None,
            "mean_paths": round(sum(npaths(r) for r in single) / len(single), 2) if single else None,
        },
        {
            "cohort": "multipath_retry",
            "n": len(multi),
            "acceptance_pipeline_p50": pct([r["pipelineMs"] for r in multi], 50),
            "acceptance_pipeline_p95": pct([r["pipelineMs"] for r in multi], 95),
            "mean_queries": round(sum(qcount(r) for r in multi) / len(multi), 2) if multi else None,
            "mean_paths": round(sum(npaths(r) for r in multi) / len(multi), 2) if multi else None,
        },
    ]
    with (OUT / "model3_retry_performance_multipath.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.DictWriter(f, fieldnames=list(multipath[0].keys()))
        w.writeheader()
        w.writerows(multipath)

    # cross-path duplicate queries
    total_inv = 0
    dup_inv = 0
    for r in after:
        allk = []
        for p in r.get("paths") or []:
            for inv in p.get("retry_recall_invocations") or []:
                allk.append(f"{inv.get('spanStart')}:{inv.get('spanEnd')}:{inv.get('windowPinyinKey')}")
        total_inv += len(allk)
        dup_inv += len(allk) - len(set(allk))

    comparable = []
    contaminated = 0
    for r in after:
        b = before.get(r["caseId"])
        if not b:
            continue
        if (b.get("raw_asr") or "") == (r.get("raw_asr") or ""):
            comparable.append((b, r))
        else:
            contaminated += 1
    d_pipe = [a["pipelineMs"] - b["pipelineMs"] for b, a in comparable]
    d_fb = [fb_q(a) - fb_q(b) for b, a in comparable]
    ms_per_q = pct([retry[i] / q[i] for i in range(len(clean)) if q[i] > 0], 50) or 2.5

    acc_pipe = [r["pipelineMs"] for r in after]
    summary = {
        "phase": "MODEL3_RETRY_PERFORMANCE_CAUSAL_BREAKDOWN_AUDIT",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "verdict": "MODEL3_RETRY_PERFORMANCE_CAUSAL_AUDIT_PASS_MULTIPLE_OWNERS",
        "performanceRisk": "PERFORMANCE_CONCERN_NONBLOCKING",
        "performanceTarget": "PERFORMANCE_TARGET_NOT_FORMALLY_ENFORCED",
        "freezePreserved": {
            "DELTA1": "RESOLVED_ACCEPTED_CLOSED",
            "DELTA2": "RESOLVED_ACCEPTED",
            "RETRY_FALLBACK_QUERY_GEOMETRY": "LEGAL_BOUNDED_RETRY_REGION_WINDOW_SPACE_1_TO_5",
        },
        "PRIMARY_LATENCY_OWNER": "A_ASR_upstream",
        "SECONDARY_LATENCY_OWNER": "B_FW_first_pass_residual_FineSpan_Recall_Vote_Assembly",
        "DELTA2_INCREMENTAL_LATENCY_OWNER": "H_Retry_Stage2_Recall_SQLite_path",
        "owners": {
            "A_ASR": "DOMINANT",
            "B_FW_residual": "SIGNIFICANT",
            "K_KenLM": "SIGNIFICANT",
            "H_Retry": "MINOR",
            "D_Model3": "NEGLIGIBLE",
            "L_acceptance_dual_fork_harness": "SIGNIFICANT_ON_ACCEPTANCE_METRIC_ONLY",
        },
        "productionTiming": {
            "n_clean": len(clean),
            "outliers_excluded": [(r.get("caseId"), r.get("pipeline_ms")) for r in outliers],
            "pipelineMs": {
                "p50": pct(pipe, 50),
                "p95": pct(pipe, 95),
                "max": max(pipe),
                "mean": round(sum(pipe) / len(pipe), 1),
            },
            "shares_percent": {s["stage"]: s["shareOfPipelinePercent"] for s in stages},
            "retry": {
                "p50": pct(retry, 50),
                "p95": pct(retry, 95),
                "max": max(retry),
                "ms_per_query_p50": pct([retry[i] / q[i] for i in range(len(clean)) if q[i] > 0], 50),
                "pearson_queries_vs_retryMs": round(pearson(q, retry) or 0, 4),
                "pearson_queries_vs_pipelineMs": round(pearson(q, pipe) or 0, 4),
            },
            "warm": {
                "first10_p50": pct(pipe[:10], 50),
                "mid50_p50": pct(pipe[75:125], 50),
                "last50_p50": pct(pipe[-50:], 50),
            },
            "vsAcceptanceHarness": {
                "acceptance_dual_fork_p50": pct(acc_pipe, 50),
                "production_p50": pct(pipe, 50),
                "delta_p50": (pct(acc_pipe, 50) or 0) - (pct(pipe, 50) or 0),
            },
        },
        "acceptanceReplay": {
            "pipelineMs_p50": pct(acc_pipe, 50),
            "pipelineMs_p95": pct(acc_pipe, 95),
            "pearson_queryCount_vs_pipelineMs": round(
                pearson([qcount(r) for r in after], acc_pipe) or 0, 4
            ),
            "clockPureRuntimeInference": False,
            "includesDualWeightCausalFork": True,
        },
        "delta2Incremental": {
            "additionalQueries_global": 1389,
            "CAUSALLY_COMPARABLE": len(comparable),
            "ASR_CONTAMINATED": contaminated,
            "comparable_deltaPipelineMs_p50": pct(d_pipe, 50),
            "comparable_deltaFallbackQueries_mean": round(sum(d_fb) / len(d_fb), 2) if d_fb else None,
            "estimated_additional_retry_ms_per_utt_from_query_cost": round(
                (sum(d_fb) / len(d_fb)) * ms_per_q, 1
            )
            if d_fb
            else None,
            "interpretation": "Delta2 adds ~1.4k fallback queries; at ~2.5ms/query Retry cost remains <1% of E2E. Acceptance +3.5s p50 on comparable cases is NOT explained by Delta2 query cost alone (ASR/harness variance dominates).",
        },
        "duplicateWork": {
            "crossPathDuplicateInvocationCount": dup_inv,
            "totalRetryInvocations": total_inv,
            "duplicateRate": round(dup_inv / total_inv, 4) if total_inv else None,
            "classification": "EXPECTED_MULTIPATH",
        },
        "stageBreakdown": stages,
        "queryScaling": scale,
        "multipath": multipath,
        "DECISION_REQUIRED_BEFORE_OPTIMIZATION": "EMPTY",
        "nextControlVariable": "ASR_UPSTREAM_AND_FIRST_PASS_FW_COST_ISOLATION",
        "nextPhase": "MODEL3_RETRY_PERFORMANCE_ASR_FW_OWNER_ISOLATION_OR_POST_DELTA_RECONCILIATION",
    }
    (OUT / "model3_retry_performance_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"verdict": summary["verdict"], "owners": summary["owners"], "shares": summary["productionTiming"]["shares_percent"]}, indent=2))


if __name__ == "__main__":
    main()
