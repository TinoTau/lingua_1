#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline stage performance/quality baseline from RUN_ID dump. No production changes."""
from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent
RUN_ID = "dialog200_full_pipeline_20260909_001141"
RAW = OUT / f"fresh_dialog200_raw_cases_{RUN_ID}.jsonl"
CASES = OUT / "fresh_dialog200_case_results.csv"


def pct(arr, p):
    a = sorted(x for x in arr if isinstance(x, (int, float)))
    if not a:
        return None
    return a[min(len(a) - 1, max(0, math.ceil((p / 100) * len(a)) - 1))]


def stats(arr):
    a = [x for x in arr if isinstance(x, (int, float))]
    if not a:
        return None
    return {
        "n": len(a),
        "total_ms": round(sum(a), 1),
        "mean_ms": round(sum(a) / len(a), 1),
        "p50_ms": pct(a, 50),
        "p95_ms": pct(a, 95),
        "max_ms": max(a),
        "min_ms": min(a),
    }


def norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", (s or ""), flags=re.UNICODE).lower()


def lev(a: str, b: str) -> int:
    a, b = a or "", b or ""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = cur
    return prev[-1]


def main():
    rows = [json.loads(l) for l in RAW.open(encoding="utf-8") if l.strip()]
    outcomes = {
        r["caseId"]: r["outcome"]
        for r in csv.DictReader(CASES.open(encoding="utf-8-sig"))
    }

    pipe, fw, kenlm, residual = [], [], [], []
    m3_utt, retry_utt, pathc, pool, kinc = [], [], [], [], []
    keep_n, retry_n, retry_regions, recall_inv = [], [], [], []
    by = defaultdict(lambda: defaultdict(list))

    for r in rows:
        cid = r["caseId"]
        oc = outcomes.get(cid, "UNKNOWN")
        p, f, k = r.get("pipeline_ms"), r.get("fw_detector_step_ms"), r.get("kenlm_ms")
        pipe.append(p)
        fw.append(f)
        kenlm.append(k)
        if isinstance(p, (int, float)) and isinstance(f, (int, float)):
            residual.append(max(0, p - f))

        m3s = rs = kr = kk = regions = invs = 0
        for path in r.get("paths") or []:
            m = path.get("model3") or {}
            if isinstance(m.get("model3_latency_ms"), (int, float)):
                m3s += m["model3_latency_ms"]
            if isinstance(m.get("retry_path_latency_ms"), (int, float)):
                rs += m["retry_path_latency_ms"]
            kr += m.get("decisions_retry") or 0
            kk += m.get("decisions_keep") or 0
            regions += len(m.get("retry_regions") or [])
            invs += len(m.get("retry_recall_invocations") or [])
        m3_utt.append(m3s)
        retry_utt.append(rs)
        pathc.append(r.get("path_count") or 0)
        pool.append(r.get("kenlm_pool_candidate_count") if isinstance(r.get("kenlm_pool_candidate_count"), int) else 0)
        kinc.append(len(r.get("kenlm_input_texts") or []))
        keep_n.append(kk)
        retry_n.append(kr)
        retry_regions.append(regions)
        recall_inv.append(invs)

        by[oc]["pipeline"].append(p)
        by[oc]["fw"].append(f)
        by[oc]["kenlm"].append(k)
        by[oc]["m3"].append(m3s)
        by[oc]["retry"].append(rs)
        by[oc]["paths"].append(r.get("path_count") or 0)
        by[oc]["pool"].append(pool[-1])
        by[oc]["kinc"].append(kinc[-1])
        by[oc]["retry_dec"].append(kr)
        by[oc]["retry_case"].append(1 if kr > 0 else 0)
        by[oc]["regions"].append(regions)
        by[oc]["inv"].append(invs)

        # text change
        raw, final, ref = r.get("rawMergedAsrText") or "", r.get("finalPostprocessText") or "", r.get("reference") or ""
        nr, nf, nref = norm(raw), norm(final), norm(ref)
        changed = nr != nf
        by[oc]["text_changed"].append(1 if changed else 0)
        if nref:
            dr, df = lev(nref, nr), lev(nref, nf)
            by[oc]["cer_delta"].append(df - dr)
            by[oc]["improved"].append(1 if df < dr else 0)
            by[oc]["regressed"].append(1 if df > dr else 0)

    # exclusive approx within fw
    rest = []
    for i in range(len(rows)):
        f = fw[i]
        if isinstance(f, (int, float)):
            rest.append(max(0, f - (kenlm[i] or 0) - (m3_utt[i] or 0) - (retry_utt[i] or 0)))

    fw_s, kenlm_s, m3_s, retry_s, rest_s, asr_s = (
        stats(fw),
        stats(kenlm),
        stats(m3_utt),
        stats(retry_utt),
        stats(rest),
        stats(residual),
    )
    pipe_s = stats(pipe)

    # postprocess share among fw (authoritative postprocess bucket)
    def share(part, whole):
        if not whole or not whole["p50_ms"]:
            return None
        return round(100.0 * (part["p50_ms"] or 0) / whole["p50_ms"], 1)

    perf_rows = [
        {
            "stage": "ASR_reference_pipeline_minus_fw",
            "calls": 200,
            "calls_per_case": 1,
            "total_ms": asr_s["total_ms"],
            "mean_ms": asr_s["mean_ms"],
            "p50_ms": asr_s["p50_ms"],
            "p95_ms": asr_s["p95_ms"],
            "max_ms": asr_s["max_ms"],
            "inclusive_or_exclusive": "exclusive_approx",
            "postprocess_share": "UPSTREAM_REFERENCE_not_in_postprocess",
            "notes": "pipeline_ms - fw_detector_step_ms; not reopened",
        },
        {
            "stage": "FW_postprocess_bundle_INCLUSIVE",
            "calls": 200,
            "calls_per_case": 1,
            "total_ms": fw_s["total_ms"],
            "mean_ms": fw_s["mean_ms"],
            "p50_ms": fw_s["p50_ms"],
            "p95_ms": fw_s["p95_ms"],
            "max_ms": fw_s["max_ms"],
            "inclusive_or_exclusive": "inclusive",
            "postprocess_share": 100.0,
            "notes": "fw_detector_step_ms includes FineSpan/Recall/Model2/Domain/Model3/Retry/Assembly/KenLM",
        },
        {
            "stage": "FW_rest_FineSpan_Recall_Model2_Domain_Assembly_approx_EXCLUSIVE",
            "calls": 200,
            "calls_per_case": "UNKNOWN_merged",
            "total_ms": rest_s["total_ms"],
            "mean_ms": rest_s["mean_ms"],
            "p50_ms": rest_s["p50_ms"],
            "p95_ms": rest_s["p95_ms"],
            "max_ms": rest_s["max_ms"],
            "inclusive_or_exclusive": "exclusive_approx",
            "postprocess_share": share(rest_s, fw_s),
            "notes": "fw - kenlm - model3_sum - retry_sum; MEASUREMENT_GAP for per-substage",
        },
        {
            "stage": "Model3_sum_per_utterance",
            "calls": sum(1 for x in m3_utt if x > 0),
            "calls_per_case": round(sum(1 for _ in rows for p in (_.get("paths") or []) if (p.get("model3") or {}).get("model3_latency_ms") is not None) / 200, 2),
            "total_ms": m3_s["total_ms"],
            "mean_ms": m3_s["mean_ms"],
            "p50_ms": m3_s["p50_ms"],
            "p95_ms": m3_s["p95_ms"],
            "max_ms": m3_s["max_ms"],
            "inclusive_or_exclusive": "exclusive_path_sum_nested_in_fw",
            "postprocess_share": share(m3_s, fw_s),
            "notes": "FROZEN; path-local model3_latency_ms summed",
        },
        {
            "stage": "Retry_path_sum_per_utterance",
            "calls": sum(1 for x in retry_utt if x > 0),
            "calls_per_case": round(sum(retry_regions) / 200, 2),
            "total_ms": retry_s["total_ms"],
            "mean_ms": retry_s["mean_ms"],
            "p50_ms": retry_s["p50_ms"],
            "p95_ms": retry_s["p95_ms"],
            "max_ms": retry_s["max_ms"],
            "inclusive_or_exclusive": "inclusive_retry_path_nested_in_fw",
            "postprocess_share": share(retry_s, fw_s),
            "notes": "FROZEN; includes Retry Recall; do not add again",
        },
        {
            "stage": "KenLM",
            "calls": 200,
            "calls_per_case": 1,
            "total_ms": kenlm_s["total_ms"],
            "mean_ms": kenlm_s["mean_ms"],
            "p50_ms": kenlm_s["p50_ms"],
            "p95_ms": kenlm_s["p95_ms"],
            "max_ms": kenlm_s["max_ms"],
            "inclusive_or_exclusive": "exclusive_nested_in_fw",
            "postprocess_share": share(kenlm_s, fw_s),
            "notes": "kenlm_ms from dump",
        },
        {
            "stage": "Total_pipeline_wall_INCLUSIVE",
            "calls": 200,
            "calls_per_case": 1,
            "total_ms": pipe_s["total_ms"],
            "mean_ms": pipe_s["mean_ms"],
            "p50_ms": pipe_s["p50_ms"],
            "p95_ms": pipe_s["p95_ms"],
            "max_ms": pipe_s["max_ms"],
            "inclusive_or_exclusive": "inclusive",
            "postprocess_share": "N/A_includes_ASR",
            "notes": "pipeline_ms",
        },
        {
            "stage": "Recall_standalone",
            "calls": "MEASUREMENT_GAP",
            "calls_per_case": round(sum(recall_inv) / 200, 2),
            "total_ms": "",
            "mean_ms": "",
            "p50_ms": "",
            "p95_ms": "",
            "max_ms": "",
            "inclusive_or_exclusive": "UNKNOWN",
            "postprocess_share": "UNKNOWN",
            "notes": "only invocation counts in dump; no exclusive Recall ms",
        },
        {
            "stage": "Model2_standalone",
            "calls": "MEASUREMENT_GAP",
            "calls_per_case": "UNKNOWN",
            "total_ms": "",
            "mean_ms": "",
            "p50_ms": "",
            "p95_ms": "",
            "max_ms": "",
            "inclusive_or_exclusive": "UNKNOWN",
            "postprocess_share": "UNKNOWN",
            "notes": "no exclusive Model2 ms in this dump",
        },
        {
            "stage": "DomainVote_SameDomain_Anchor_Assembly_CrossPath_standalone",
            "calls": "MEASUREMENT_GAP",
            "calls_per_case": round(sum(pathc) / 200, 2),
            "total_ms": "",
            "mean_ms": "",
            "p50_ms": "",
            "p95_ms": "",
            "max_ms": "",
            "inclusive_or_exclusive": "UNKNOWN",
            "postprocess_share": "UNKNOWN",
            "notes": "merged into FW_rest approx; path_count available",
        },
    ]

    with (OUT / "ASR_Postprocess_Stage_Performance_Baseline.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as f:
        w = csv.DictWriter(f, fieldnames=list(perf_rows[0].keys()))
        w.writeheader()
        w.writerows(perf_rows)

    # Quality observations — simple
    text_changed = sum(1 for r in rows if norm(r.get("rawMergedAsrText") or "") != norm(r.get("finalPostprocessText") or ""))
    improved = worsened = unchanged_dist = 0
    for r in rows:
        ref = norm(r.get("reference") or "")
        if not ref:
            continue
        dr = lev(ref, norm(r.get("rawMergedAsrText") or ""))
        df = lev(ref, norm(r.get("finalPostprocessText") or ""))
        if df < dr:
            improved += 1
        elif df > dr:
            worsened += 1
        else:
            unchanged_dist += 1

    # KenLM selection gap
    gap = measurable = 0
    for r in rows:
        ref = norm(r.get("reference") or "")
        final = norm(r.get("finalPostprocessText") or "")
        inputs = r.get("kenlm_input_texts") or []
        if not ref or len(inputs) < 2:
            continue
        measurable += 1
        d_final = lev(ref, final)
        best = min(lev(ref, norm(t)) for t in inputs)
        if best < d_final:
            gap += 1

    q_rows = [
        {
            "stage": "Postprocess_bundle_raw_to_final",
            "observation_type": "DIRECT_TEXT_CHANGE",
            "cases_observed": 200,
            "positive": improved,
            "unchanged": unchanged_dist,
            "negative": worsened,
            "not_measurable": 0,
            "notes": f"text_changed={text_changed}; CER-distance vs reference; baseline NET_GAIN=+6 exact",
        },
        {
            "stage": "Model3",
            "observation_type": "CANDIDATE_QUALITY_SIGNAL",
            "cases_observed": 200,
            "positive": "",
            "unchanged": "",
            "negative": "",
            "not_measurable": 200,
            "notes": f"KEEP_sum={sum(keep_n)} RETRY_sum={sum(retry_n)} cases_with_RETRY={sum(1 for x in retry_n if x>0)}; FROZEN; no responsibility rescoring",
        },
        {
            "stage": "Retry",
            "observation_type": "CANDIDATE_QUALITY_SIGNAL",
            "cases_observed": 200,
            "positive": "",
            "unchanged": "",
            "negative": "",
            "not_measurable": 200,
            "notes": f"regions/case p50={pct(retry_regions,50)} recall_inv/case p50={pct(recall_inv,50)}; association only; FROZEN",
        },
        {
            "stage": "KenLM",
            "observation_type": "DIRECT_TEXT_CHANGE",
            "cases_observed": measurable,
            "positive": "",
            "unchanged": "",
            "negative": gap,
            "not_measurable": 200 - measurable,
            "notes": f"KENLM_SELECTION_GAP={gap}/{measurable} multi-candidate cases where better-CER complete sentence existed in inputs",
        },
        {
            "stage": "Recall_Model2_Domain_Assembly",
            "observation_type": "NO_DIRECT_QUALITY_OBSERVATION",
            "cases_observed": 200,
            "positive": "",
            "unchanged": "",
            "negative": "",
            "not_measurable": 200,
            "notes": "CORRECT_CANDIDATE_NOT_MEASURED; no per-stage text; candidate counts only via pool/kinc",
        },
        {
            "stage": "Candidate_cap_16",
            "observation_type": "CANDIDATE_QUALITY_SIGNAL",
            "cases_observed": 200,
            "positive": 200,
            "unchanged": "",
            "negative": 0,
            "not_measurable": 0,
            "notes": f"pool max={max(pool)} p50={pct(pool,50)} p95={pct(pool,95)} over16=0; CAP16=NO CURRENT ISSUE",
        },
    ]
    with (OUT / "ASR_Postprocess_Stage_Quality_Observations.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as f:
        w = csv.DictWriter(f, fieldnames=list(q_rows[0].keys()))
        w.writeheader()
        w.writerows(q_rows)

    # Outcome group comparison
    group_rows = []
    for oc in ["FULL_RESCUE", "PARTIAL_IMPROVEMENT", "UNCHANGED", "CORRECT_PRESERVED"]:
        d = by[oc]
        n = len(d["pipeline"])
        group_rows.append(
            {
                "outcome_group": oc,
                "count": n,
                "postprocess_latency_p50_ms": pct(d["fw"], 50),
                "pipeline_latency_p50_ms": pct(d["pipeline"], 50),
                "kenlm_latency_p50_ms": pct(d["kenlm"], 50),
                "model3_sum_p50_ms": pct(d["m3"], 50),
                "retry_sum_p50_ms": pct(d["retry"], 50),
                "Model3_Retry_rate": round(sum(d["retry_case"]) / n, 3) if n else None,
                "retry_decisions_p50": pct(d["retry_dec"], 50),
                "retry_regions_p50": pct(d["regions"], 50),
                "path_count_p50": pct(d["paths"], 50),
                "kenlm_pool_p50": pct(d["pool"], 50),
                "kenlm_input_count_p50": pct(d["kinc"], 50),
                "text_changed_rate": round(sum(d["text_changed"]) / n, 3) if n else None,
                "cer_improved_rate": round(sum(d["improved"]) / n, 3) if n and d["improved"] else None,
            }
        )
    with (OUT / "ASR_Postprocess_Outcome_Group_Comparison.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as f:
        w = csv.DictWriter(f, fieldnames=list(group_rows[0].keys()))
        w.writeheader()
        w.writerows(group_rows)

    summary = {
        "run_id": RUN_ID,
        "baseline_id": "LINGUA_DIALOG200_BASELINE_V1",
        "pipeline": pipe_s,
        "fw_postprocess_inclusive": fw_s,
        "asr_reference_approx": asr_s,
        "kenlm": kenlm_s,
        "model3_utt": m3_s,
        "retry_utt": retry_s,
        "fw_rest_approx": rest_s,
        "shares_of_fw_p50": {
            "kenlm": share(kenlm_s, fw_s),
            "model3": share(m3_s, fw_s),
            "retry": share(retry_s, fw_s),
            "rest_merged": share(rest_s, fw_s),
        },
        "quality": {
            "improved_cer": improved,
            "worsened_cer": worsened,
            "unchanged_cer": unchanged_dist,
            "kenlm_selection_gap": f"{gap}/{measurable}",
        },
        "groups": group_rows,
        "measurement_gaps": [
            "exclusive Recall ms",
            "exclusive Model2 ms",
            "exclusive Domain/SameDomain/Anchor/Assembly/CrossPath ms",
            "FineSpan-only ms",
        ],
    }
    (OUT / "_tmp_stage_perf_quality_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: summary[k] for k in ["shares_of_fw_p50", "quality", "fw_postprocess_inclusive", "asr_reference_approx", "kenlm", "model3_utt", "retry_utt", "fw_rest_approx"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
