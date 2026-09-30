#!/usr/bin/env python3
"""Offline performance analysis from accepted Delta2 dumps + optional timing dump."""
from __future__ import annotations

import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "docs" / "user_correction" / "model3"
AFTER = OUT / "model3_retry_fallback_acceptance_after_raw.jsonl"
BEFORE = OUT / "model3_retry_stage2_acceptance_after_raw.jsonl"
TIMING = OUT / "model3_retry_performance_timing_raw.jsonl"


def pct(xs, p):
    if not xs:
        return None
    ys = sorted(xs)
    i = int(round((p / 100) * (len(ys) - 1)))
    return ys[max(0, min(len(ys) - 1, i))]


def load(path: Path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.open(encoding="utf-8") if l.strip()]


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


def ok_q(rec):
    n = 0
    for p in rec.get("paths") or []:
        rids = {
            rr.get("retryRegionId") for rr in (p.get("retry_regions") or []) if rr.get("resegmentOk")
        }
        for inv in p.get("retry_recall_invocations") or []:
            if inv.get("retryRegionId") in rids:
                n += 1
    return n


def npaths_rr(rec):
    return sum(1 for p in rec.get("paths") or [] if p.get("retry_regions"))


def nregions(rec):
    return sum(len(p.get("retry_regions") or []) for p in rec.get("paths") or [])


def pearson(a, b):
    n = len(a)
    if n < 3:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    return (num / (da * db)) if da and db else None


def analyze():
    after = load(AFTER)
    before = {r["caseId"]: r for r in load(BEFORE)}
    timing = load(TIMING)

    pipe = [r["pipelineMs"] for r in after if r.get("pipelineMs") is not None]
    rows_scale = []
    buckets = defaultdict(list)
    for r in after:
        q = qcount(r)
        if q <= 5:
            b = "0-5"
        elif q <= 10:
            b = "6-10"
        elif q <= 20:
            b = "11-20"
        elif q <= 40:
            b = "21-40"
        else:
            b = ">40"
        buckets[b].append(r)
        rows_scale.append(
            {
                "caseId": r["caseId"],
                "pipelineMs": r.get("pipelineMs"),
                "queryCount": q,
                "fallbackQueryCount": fb_q(r),
                "successQueryCount": ok_q(r),
                "pathWithRetryCount": npaths_rr(r),
                "regionCount": nregions(r),
                "bucket": b,
            }
        )

    scale_summary = []
    for b in ["0-5", "6-10", "11-20", "21-40", ">40"]:
        xs = buckets[b]
        pms = [r["pipelineMs"] for r in xs]
        scale_summary.append(
            {
                "bucket": b,
                "n": len(xs),
                "pipeline_p50": pct(pms, 50),
                "pipeline_p95": pct(pms, 95),
                "pipeline_max": max(pms) if pms else None,
                "mean_queryCount": round(sum(qcount(r) for r in xs) / len(xs), 2) if xs else None,
                "mean_fallbackQueryCount": round(sum(fb_q(r) for r in xs) / len(xs), 2) if xs else None,
                "mean_pathsWithRetry": round(sum(npaths_rr(r) for r in xs) / len(xs), 2) if xs else None,
            }
        )

    # multipath
    single = [r for r in after if npaths_rr(r) <= 1]
    multi = [r for r in after if npaths_rr(r) >= 2]
    multipath_rows = [
        {
            "cohort": "single_path_retry_or_none",
            "n": len(single),
            "pipeline_p50": pct([r["pipelineMs"] for r in single], 50),
            "pipeline_p95": pct([r["pipelineMs"] for r in single], 95),
            "mean_queries": round(sum(qcount(r) for r in single) / len(single), 2) if single else None,
            "mean_paths": round(sum(npaths_rr(r) for r in single) / len(single), 2) if single else None,
        },
        {
            "cohort": "multipath_retry",
            "n": len(multi),
            "pipeline_p50": pct([r["pipelineMs"] for r in multi], 50),
            "pipeline_p95": pct([r["pipelineMs"] for r in multi], 95),
            "mean_queries": round(sum(qcount(r) for r in multi) / len(multi), 2) if multi else None,
            "mean_paths": round(sum(npaths_rr(r) for r in multi) / len(multi), 2) if multi else None,
        },
    ]

    # Delta2 incremental on comparable
    comparable = []
    contaminated = []
    for r in after:
        b = before.get(r["caseId"])
        if not b:
            continue
        if (b.get("raw_asr") or "") == (r.get("raw_asr") or ""):
            comparable.append((b, r))
        else:
            contaminated.append((b, r))
    d_pipe = [a["pipelineMs"] - b["pipelineMs"] for b, a in comparable]
    d_fb = [fb_q(a) - fb_q(b) for b, a in comparable]
    d_q = [qcount(a) - qcount(b) for b, a in comparable]

    # warm analysis
    first10 = [r["pipelineMs"] for r in after[:10]]
    mid = [r["pipelineMs"] for r in after[75:125]]
    last50 = [r["pipelineMs"] for r in after[-50:]]

    # timing dump stage breakdown if present
    stage = {}
    if timing:
        pipe_t = [r["pipeline_ms"] for r in timing if r.get("pipeline_ms") is not None]
        fw = [r["fw_detector_step_ms"] for r in timing if r.get("fw_detector_step_ms") is not None]
        asr_est = [
            r["pipeline_ms"] - r["fw_detector_step_ms"]
            for r in timing
            if r.get("pipeline_ms") is not None and r.get("fw_detector_step_ms") is not None
        ]
        m3 = [r["model3_latency_ms_sum"] for r in timing if r.get("model3_latency_ms_sum") is not None]
        retry = [r["retry_path_latency_ms_sum"] for r in timing if r.get("retry_path_latency_ms_sum") is not None]
        kenlm = [r["kenlm_ms"] for r in timing if r.get("kenlm_ms") is not None]
        base_fork = [r["baseline_post_fork_ms_sum"] for r in timing if r.get("baseline_post_fork_ms_sum") is not None]
        s3_fork = [r["s3_post_fork_ms_sum"] for r in timing if r.get("s3_post_fork_ms_sum") is not None]

        def pack(name, xs, total_ref=None):
            if not xs:
                return {
                    "stage": name,
                    "count": 0,
                    "totalMs": 0,
                    "p50Ms": None,
                    "p95Ms": None,
                    "maxMs": None,
                    "shareOfPipelinePercent": None,
                }
            tot = sum(xs)
            share = None
            if total_ref and sum(total_ref):
                # approximate share using means
                share = round(100.0 * (sum(xs) / len(xs)) / (sum(total_ref) / len(total_ref)), 2)
            return {
                "stage": name,
                "count": len(xs),
                "totalMs": tot,
                "p50Ms": pct(xs, 50),
                "p95Ms": pct(xs, 95),
                "maxMs": max(xs),
                "meanMs": round(sum(xs) / len(xs), 1),
                "shareOfPipelinePercent": share,
            }

        stage_rows = [
            pack("utterance_pipeline_ms", pipe_t, pipe_t),
            pack("ASR_plus_non_FW_estimated", asr_est, pipe_t),
            pack("FW_detector_step_ms", fw, pipe_t),
            pack("Model3_infer_sum_paths", m3, pipe_t),
            pack("Retry_path_latency_sum_paths", retry, pipe_t),
            pack("KenLM_subprocess_ms", kenlm, pipe_t),
            pack("acceptance_baseline_post_fork_sum", base_fork, pipe_t),
            pack("acceptance_s3_post_fork_sum", s3_fork, pipe_t),
        ]
    else:
        stage_rows = []

    # write CSVs
    with (OUT / "model3_retry_performance_query_scaling.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(scale_summary[0].keys()))
        w.writeheader()
        w.writerows(scale_summary)

    with (OUT / "model3_retry_performance_multipath.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(multipath_rows[0].keys()))
        w.writeheader()
        w.writerows(multipath_rows)

    if stage_rows:
        with (OUT / "model3_retry_performance_stage_breakdown.csv").open(
            "w", encoding="utf-8", newline=""
        ) as f:
            w = csv.DictWriter(f, fieldnames=list(stage_rows[0].keys()))
            w.writeheader()
            w.writerows(stage_rows)
    else:
        # placeholder from acceptance-only evidence
        stage_rows = [
            {
                "stage": "utterancePipelineMs_ACCEPTANCE_HARNESS",
                "count": len(pipe),
                "totalMs": sum(pipe),
                "p50Ms": pct(pipe, 50),
                "p95Ms": pct(pipe, 95),
                "maxMs": max(pipe) if pipe else None,
                "meanMs": round(sum(pipe) / len(pipe), 1) if pipe else None,
                "shareOfPipelinePercent": 100.0,
                "note": "Wall-clock of HTTP /run-pipeline-with-audio including ASR + dual-weight causal fork",
            }
        ]
        with (OUT / "model3_retry_performance_stage_breakdown.csv").open(
            "w", encoding="utf-8", newline=""
        ) as f:
            w = csv.DictWriter(
                f,
                fieldnames=[
                    "stage",
                    "count",
                    "totalMs",
                    "p50Ms",
                    "p95Ms",
                    "maxMs",
                    "meanMs",
                    "shareOfPipelinePercent",
                    "note",
                ],
            )
            w.writeheader()
            w.writerows(stage_rows)

    summary = {
        "phase": "MODEL3_RETRY_PERFORMANCE_CAUSAL_BREAKDOWN_AUDIT",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "acceptanceReplay": {
            "artifact": AFTER.name,
            "n": len(after),
            "pipelineMs": {
                "p50": pct(pipe, 50),
                "p95": pct(pipe, 95),
                "max": max(pipe) if pipe else None,
                "mean": round(sum(pipe) / len(pipe), 1) if pipe else None,
            },
            "warm": {
                "first10_p50": pct(first10, 50),
                "first10_mean": round(sum(first10) / len(first10), 1) if first10 else None,
                "mid50_p50": pct(mid, 50),
                "last50_p50": pct(last50, 50),
                "last50_mean": round(sum(last50) / len(last50), 1) if last50 else None,
            },
            "correlations": {
                "pearson_queryCount_vs_pipelineMs": round(pearson([qcount(r) for r in after], pipe) or 0, 4),
                "pearson_fallbackQuery_vs_pipelineMs": round(pearson([fb_q(r) for r in after], pipe) or 0, 4),
                "pearson_pathsWithRetry_vs_pipelineMs": round(
                    pearson([npaths_rr(r) for r in after], pipe) or 0, 4
                ),
            },
            "queryScaling": scale_summary,
            "multipath": multipath_rows,
            "clockDefinition": {
                "metric": "utterancePipelineMs / harness pipelineMs",
                "boundary": "acceptance runner Date.now around full HTTP /run-pipeline-with-audio",
                "includes": [
                    "audio load via ASR service",
                    "full post-ASR pipeline",
                    "MODEL3_ACCEPTANCE_CAUSAL_FORK",
                    "MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT (2x infer+retry+assembly per path)",
                    "KenLM",
                    "HTTP/IPC",
                    "trace serialization in response",
                ],
                "excludes": ["server cold start before first case", "npm build"],
                "pure_runtime_inference": False,
            },
        },
        "delta2Incremental": {
            "CAUSALLY_COMPARABLE": len(comparable),
            "ASR_CONTAMINATED": len(contaminated),
            "deltaPipelineMs_p50": pct(d_pipe, 50) if d_pipe else None,
            "deltaPipelineMs_p95": pct(d_pipe, 95) if d_pipe else None,
            "deltaPipelineMs_mean": round(sum(d_pipe) / len(d_pipe), 1) if d_pipe else None,
            "deltaFallbackQueries_total": sum(d_fb) if d_fb else None,
            "deltaFallbackQueries_mean": round(sum(d_fb) / len(d_fb), 2) if d_fb else None,
            "deltaAllQueries_mean": round(sum(d_q) / len(d_q), 2) if d_q else None,
            "beforeFallbackQueryTotal": 1074,
            "afterFallbackQueryTotal": 2463,
            "additionalQueries": 2463 - 1074,
            "note": "Both BEFORE/AFTER dumps used same dual-weight acceptance harness; pipeline delta is NOT isolated Retry-only cost",
        },
        "timingDumpPresent": bool(timing),
        "timingDumpN": len(timing),
        "stageBreakdown": stage_rows,
    }
    (OUT / "model3_retry_performance_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: summary[k] for k in ["acceptanceReplay", "delta2Incremental", "timingDumpPresent", "timingDumpN"]}, ensure_ascii=False, indent=2))
    return summary


if __name__ == "__main__":
    analyze()
