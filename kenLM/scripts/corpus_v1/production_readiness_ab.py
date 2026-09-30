#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Production Readiness A/B — OLD vs NEW KenLM.
Implements production rerankFwSentences (raw_log_delta + minDeltaToReplace) over WSL query.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path("/mnt/d/Programs/github/lingua_1")
sys.path.insert(0, str(ROOT / "scripts" / "kenlm"))
from lib.tokenize_char import tokenize_line  # noqa: E402

OUT = ROOT / "docs/acceptance/Test/2026-08-05_KenLM_CorpusV1_Production_Readiness_AB"
BENCH = ROOT / "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
EXPORT = ROOT / "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"
OLD_MODEL = ROOT / "electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin"
NEW_MODEL = ROOT / "kenLM/model/corpus_v1/zh_char_3gram.trie.bin"
QUERY = ROOT / "kenLM/kenlm/build/bin/query"
OLD_SHA = "532a335a09a006d1ba674f808814ee1d40c5b1d8f3527ca980e96723e7a62a4c"
NEW_SHA = "848ebee6dec020449f28d073cada6e53cc9dc70bd7343e6fc2a7ea7fedce61d8"
MIN_DELTA = 3.0
IMPROVED_IDS = ["KLM000015", "KLM000033", "KLM000049", "KLM000067"]

OUT.mkdir(parents=True, exist_ok=True)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    i = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(i), math.ceil(i)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] * (1 - (i - lo)) + sorted_vals[hi] * (i - lo)


def dist(arr):
    a = sorted(x for x in arr if x is not None and math.isfinite(x))
    if not a:
        return {}
    return {
        "n": len(a),
        "min": a[0],
        "p5": pct(a, 0.05),
        "p25": pct(a, 0.25),
        "median": pct(a, 0.5),
        "p75": pct(a, 0.75),
        "p95": pct(a, 0.95),
        "max": a[-1],
        "mean": sum(a) / len(a),
    }


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = fields or list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def score_texts(model: Path, texts: list[str]) -> tuple[list[float], float]:
    toks = [tokenize_line(t) for t in texts]
    payload = ("\n".join(toks) + "\n").encode("utf-8")
    t0 = time.perf_counter()
    proc = subprocess.run(
        [str(QUERY), str(model)],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=600,
        check=False,
    )
    wall = (time.perf_counter() - t0) * 1000
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace")[:500])
    scores = []
    for line in proc.stdout.decode("utf-8", "replace").splitlines():
        m = re.search(r"Total:\s*([-+eE0-9.]+)", line)
        if m:
            scores.append(float(m.group(1)))
    if len(scores) != len(texts):
        raise RuntimeError(f"score count {len(scores)} != {len(texts)}")
    return scores, wall


def score_many_chunked(model: Path, texts: list[str], chunk: int = 80) -> tuple[list[float], list[float]]:
    """Return (all_scores, per_chunk_wall_ms). Model load amortized per chunk."""
    all_scores: list[float] = []
    walls: list[float] = []
    for i in range(0, len(texts), chunk):
        part = texts[i : i + chunk]
        sc, w = score_texts(model, part)
        all_scores.extend(sc)
        walls.append(w)
    return all_scores, walls


def rerank_fw(raw: str, alt_texts: list[str], scores: list[float], min_delta: float):
    """Mirror electron rerankFwSentences: scores = [raw, ...alts]."""
    baseline = scores[0]
    best_i = -1
    best_delta = float("-inf")
    deltas = []
    for i, s in enumerate(scores[1:]):
        d = s - baseline
        deltas.append(d)
        if d > best_delta:
            best_delta = d
            best_i = i
    ranked = [{"text": raw, "score": baseline, "delta": 0.0, "isRaw": True}]
    for i, t in enumerate(alt_texts):
        ranked.append({"text": t, "score": scores[i + 1], "delta": deltas[i], "isRaw": False})
    ranked.sort(key=lambda x: (x["score"], x["delta"]), reverse=True)
    top1 = ranked[0]
    max_delta = best_delta if best_delta != float("-inf") else 0.0
    if best_i < 0 or best_delta < min_delta:
        return {
            "pickedIsRaw": True,
            "selectedText": raw,
            "maxDelta": max_delta,
            "top1": top1,
            "baseline": baseline,
            "gatePassed": False,
            "reason": f"KEEP_RAW_GATE delta={max_delta}<{min_delta}",
        }
    return {
        "pickedIsRaw": False,
        "selectedText": alt_texts[best_i],
        "maxDelta": max_delta,
        "top1": top1,
        "baseline": baseline,
        "gatePassed": True,
        "reason": f"REPLACE delta={max_delta}>={min_delta}",
    }


def preferred_id(cands, human):
    alts = sorted([c for c in cands if c["isRaw"] != "true"], key=lambda x: x["candidateId"])
    if human == "RAW_CORRECT":
        for c in cands:
            if c["isRaw"] == "true":
                return c["candidateId"]
    if human == "CANDIDATE_1":
        return alts[0]["candidateId"] if alts else None
    if human == "CANDIDATE_2":
        return alts[1]["candidateId"] if len(alts) > 1 else None
    return None


def top1_match(top_text, cands, human):
    if human in ("ALL_WRONG", "UNDECIDABLE", "MULTIPLE_OK"):
        return None
    pref = preferred_id(cands, human)
    if not pref:
        return None
    pref_text = next(c["candidateText"] for c in cands if c["candidateId"] == pref)
    return top_text == pref_text


def main():
    log_path = OUT / "run.log"
    log_path.write_text("", encoding="utf-8")

    def log(msg):
        print(msg, flush=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(msg + "\n")

    old_sha = sha256(OLD_MODEL)
    new_sha = sha256(NEW_MODEL)
    assert old_sha == OLD_SHA, old_sha
    assert new_sha == NEW_SHA, new_sha
    log(f"oldSha ok {old_sha}")
    log(f"newSha ok {new_sha}")
    log(f"minDeltaToReplace={MIN_DELTA} scoreMode=raw_log_delta")

    # ---- Benchmark load ----
    with BENCH.open(encoding="utf-8") as f:
        bench_rows = list(csv.DictReader(f))
    by_bench = defaultdict(list)
    for r in bench_rows:
        by_bench[r["benchmarkId"]].append(r)
    case_meta = []
    for bid, rows in sorted(by_bench.items()):
        case_meta.append(
            {
                "benchmarkId": bid,
                "caseId": rows[0]["caseId"],
                "humanDecision": rows[0]["humanDecision"],
                "status": rows[0]["status"],
                "note": rows[0].get("annotationNote", ""),
                "rawText": rows[0]["rawSentence"],
                "candidates": rows,
            }
        )

    # ---- Pattern / review ----
    pattern_rows = []
    for c in case_meta:
        if c["benchmarkId"] not in IMPROVED_IDS:
            continue
        texts = [x["candidateText"] for x in c["candidates"]]
        # scores filled after batch below; placeholder winners updated later
        h = hashlib.sha256("\n".join(sorted(texts)).encode()).hexdigest()[:16]
        pattern_rows.append(
            {
                "benchmarkId": c["benchmarkId"],
                "caseId": c["caseId"],
                "rawText": c["rawText"],
                "allCandidates": " || ".join(texts),
                "humanDecision": c["humanDecision"],
                "status": c["status"],
                "oldWinner": "",
                "newWinner": "",
                "candidateTextsHash": h,
                "semanticPatternId": "P_HOUXUAN_SHENGCHENG",
            }
        )
    unique_hashes = {r["candidateTextsHash"] for r in pattern_rows}

    # ---- Verified / review accuracy (bare Top1) ----
    # Batch-score all unique texts once per model
    all_bench_texts = []
    text_index = {}
    for c in case_meta:
        for x in c["candidates"]:
            t = x["candidateText"]
            if t not in text_index:
                text_index[t] = len(all_bench_texts)
                all_bench_texts.append(t)
    log(f"benchmark unique texts={len(all_bench_texts)}")
    old_bench_scores, _ = score_many_chunked(OLD_MODEL, all_bench_texts, chunk=100)
    new_bench_scores, _ = score_many_chunked(NEW_MODEL, all_bench_texts, chunk=100)
    score_of = lambda arr, t: arr[text_index[t]]

    recon = []
    v_old = v_new = v_tot = v_imp = v_reg = 0
    r_old = r_new = r_tot = 0
    for c in case_meta:
        texts = [x["candidateText"] for x in c["candidates"]]
        old_s = [score_of(old_bench_scores, t) for t in texts]
        new_s = [score_of(new_bench_scores, t) for t in texts]
        old_top = texts[max(range(len(texts)), key=lambda i: old_s[i])]
        new_top = texts[max(range(len(texts)), key=lambda i: new_s[i])]
        m_old = top1_match(old_top, c["candidates"], c["humanDecision"])
        m_new = top1_match(new_top, c["candidates"], c["humanDecision"])
        claimed = c["benchmarkId"] in IMPROVED_IDS and m_old is False and m_new is True
        recon.append(
            {
                "benchmarkId": c["benchmarkId"],
                "caseId": c["caseId"],
                "status": c["status"],
                "humanDecision": c["humanDecision"],
                "oldTop1Match": m_old,
                "newTop1Match": m_new,
                "claimedImprovedInCorpusV1Report": claimed,
                "countsTowardVerifiedAccuracy": c["status"] == "VERIFIED" and m_old is not None,
            }
        )
        if c["status"] == "VERIFIED" and m_old is not None:
            v_tot += 1
            v_old += int(m_old)
            v_new += int(m_new)
            if (not m_old) and m_new:
                v_imp += 1
            if m_old and not m_new:
                v_reg += 1
        if c["status"] == "REVIEW_REQUIRED" and m_old is not None:
            r_tot += 1
            r_old += int(m_old)
            r_new += int(m_new)
    write_csv(OUT / "benchmark_status_reconciliation.csv", recon)
    v_net = v_new - v_old
    log(f"VERIFIED {v_old}/{v_tot}->{v_new}/{v_tot} imp={v_imp} reg={v_reg} net={v_net}")
    log(f"REVIEW {r_old}/{r_tot}->{r_new}/{r_tot} uniquePatterns={len(unique_hashes)}")

    for pr in pattern_rows:
        texts = pr["allCandidates"].split(" || ")
        old_s = [score_of(old_bench_scores, t) for t in texts]
        new_s = [score_of(new_bench_scores, t) for t in texts]
        pr["oldWinner"] = texts[max(range(len(texts)), key=lambda i: old_s[i])]
        pr["newWinner"] = texts[max(range(len(texts)), key=lambda i: new_s[i])]
    write_csv(OUT / "unique_improvement_patterns.csv", pattern_rows)

    review_res = []
    for c in case_meta:
        if c["benchmarkId"] not in IMPROVED_IDS:
            continue
        pr = next(p for p in pattern_rows if p["benchmarkId"] == c["benchmarkId"])
        non_raw = [x["candidateText"] for x in c["candidates"] if x["isRaw"] != "true"]
        review_res.append(
            {
                "benchmarkId": c["benchmarkId"],
                "caseId": c["caseId"],
                "rawText": c["rawText"],
                "nonRawCandidates": " || ".join(non_raw),
                "oldTop1": pr["oldWinner"],
                "newTop1": pr["newWinner"],
                "currentHumanDecision": c["humanDecision"],
                "currentNote": c["note"],
                "reviewConclusion": "UNDECIDABLE",
                "reviewReason": "候选声城 vs 后选声城 partial fix; 声城≠生成; keep REVIEW_REQUIRED; do not VERIFIED",
                "statusAfterReview": "REVIEW_REQUIRED",
                "decisionRevision": "0",
            }
        )
    write_csv(OUT / "review_required_resolution.csv", review_res)

    # ---- dialog_200 pools ----
    with EXPORT.open(encoding="utf-8") as f:
        exp = [r for r in csv.DictReader(f) if r.get("stage") == "kenlmInput"]
    by_case = {}
    for r in exp:
        cid = r["caseId"]
        by_case.setdefault(cid, {"raw": r["rawText"], "texts": []})
        if r["candidateText"] not in by_case[cid]["texts"]:
            by_case[cid]["texts"].append(r["candidateText"])
    case_ids = sorted(by_case)
    assert len(case_ids) == 200, len(case_ids)

    def production_pass(model: Path):
        flat: list[str] = []
        spans: list[tuple[str, int, int, str, list[str]]] = []
        for cid in case_ids:
            raw = by_case[cid]["raw"]
            texts = by_case[cid]["texts"]
            alts = [t for t in texts if t != raw]
            scored_texts = [raw] + alts
            start = len(flat)
            flat.extend(scored_texts)
            spans.append((cid, start, len(flat), raw, alts))

        t0 = time.perf_counter()
        all_scores, chunk_walls = score_many_chunked(model, flat, chunk=80)
        rows = []
        n_spans = max(len(spans), 1)
        wall_share = sum(chunk_walls) / n_spans
        for cid, start, end, raw, alts in spans:
            scores = all_scores[start:end]
            texts = by_case[cid]["texts"]
            pick = rerank_fw(raw, alts, scores, MIN_DELTA)
            rows.append(
                {
                    "caseId": cid,
                    "rawText": raw,
                    "candidateCount": len(texts),
                    "candidateTexts": " || ".join(texts),
                    "top1Text": pick["top1"]["text"],
                    "selectedText": pick["selectedText"],
                    "selectionReason": pick["reason"],
                    "rawScore": pick["baseline"],
                    "top1DeltaVsRaw": pick["top1"]["delta"],
                    "maxDelta": pick["maxDelta"],
                    "gatePassed": pick["gatePassed"],
                    "pickedIsRaw": pick["pickedIsRaw"],
                    "batchMs": wall_share,
                }
            )
        return {"rows": rows, "wallMs": (time.perf_counter() - t0) * 1000, "batchMs": chunk_walls}

    # Cold starts 3x
    cold = []
    for label, model in [("OLD", OLD_MODEL), ("NEW", NEW_MODEL)]:
        for i in range(1, 4):
            t0 = time.perf_counter()
            score_texts(model, ["你好世界"])
            ms = (time.perf_counter() - t0) * 1000
            # RSS of query via /usr/bin/time -v once per cold for NEW/OLD run1
            rss = None
            if i == 1:
                tv = subprocess.run(
                    [
                        "/usr/bin/time",
                        "-v",
                        str(QUERY),
                        str(model),
                    ],
                    input=(tokenize_line("你好世界") + "\n").encode(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=180,
                )
                m = re.search(r"Maximum resident set size \(kbytes\):\s*(\d+)", tv.stderr.decode())
                if m:
                    rss = int(m.group(1)) / 1024.0
            cold.append({"model": label, "run": i, "coldLoadMs": ms, "queryMaxRssMb": rss})
            log(f"cold {label}#{i} {ms:.0f}ms rssMb={rss}")
    write_csv(OUT / "cold_start_results.csv", cold)

    # Warm 5x
    warm = []
    old_prod = new_prod = None
    for label, model in [("OLD", OLD_MODEL), ("NEW", NEW_MODEL)]:
        production_pass(model)  # warmup
        walls = []
        lasts = None
        for i in range(1, 6):
            p = production_pass(model)
            walls.append(p["wallMs"])
            lasts = p
            warm.append(
                {
                    "model": label,
                    "run": i,
                    "dialog200WallMs": p["wallMs"],
                    "cases": 200,
                    "replacedCount": sum(1 for r in p["rows"] if r["gatePassed"]),
                    "scoreBatchP50Ms": dist(p["batchMs"]).get("median"),
                    "scoreBatchP95Ms": dist(p["batchMs"]).get("p95"),
                    "scoreBatchMaxMs": dist(p["batchMs"]).get("max"),
                }
            )
            log(f"warm {label}#{i} wall={p['wallMs']:.0f}ms replaced={warm[-1]['replacedCount']}")
        if label == "OLD":
            old_prod = lasts
        else:
            new_prod = lasts
        warm.append(
            {
                "model": label,
                "run": "MEDIAN",
                "dialog200WallMs": pct(sorted(walls), 0.5),
                "cases": 200,
                "replacedCount": "",
                "scoreBatchP50Ms": "",
                "scoreBatchP95Ms": "",
                "scoreBatchMaxMs": "",
            }
        )
    write_csv(OUT / "warm_performance_results.csv", warm)

    # AB join
    ab = []
    diff = []
    old_m = {r["caseId"]: r for r in old_prod["rows"]}
    new_m = {r["caseId"]: r for r in new_prod["rows"]}
    changed = 0
    same_top_gate_flip = raw_to_rep = rep_to_raw = 0
    for cid in case_ids:
        o, n = old_m[cid], new_m[cid]
        ch = o["selectedText"] != n["selectedText"]
        if ch:
            changed += 1
            diff.append(
                {
                    "caseId": cid,
                    "rawText": o["rawText"],
                    "oldSelectedText": o["selectedText"],
                    "newSelectedText": n["selectedText"],
                    "oldReason": o["selectionReason"],
                    "newReason": n["selectionReason"],
                    "oldMaxDelta": o["maxDelta"],
                    "newMaxDelta": n["maxDelta"],
                }
            )
        if o["top1Text"] == n["top1Text"] and o["gatePassed"] != n["gatePassed"]:
            same_top_gate_flip += 1
        if o["pickedIsRaw"] and not n["pickedIsRaw"]:
            raw_to_rep += 1
        if (not o["pickedIsRaw"]) and n["pickedIsRaw"]:
            rep_to_raw += 1
        ab.append(
            {
                "caseId": cid,
                "rawText": o["rawText"],
                "candidateCount": o["candidateCount"],
                "candidateTexts": o["candidateTexts"],
                "oldTop1": o["top1Text"],
                "newTop1": n["top1Text"],
                "oldSelectedText": o["selectedText"],
                "newSelectedText": n["selectedText"],
                "oldSelectionReason": o["selectionReason"],
                "newSelectionReason": n["selectionReason"],
                "oldRawScore": o["rawScore"],
                "newRawScore": n["rawScore"],
                "oldTop1DeltaVsRaw": o["top1DeltaVsRaw"],
                "newTop1DeltaVsRaw": n["top1DeltaVsRaw"],
                "minDeltaToReplace": MIN_DELTA,
                "oldGatePassed": o["gatePassed"],
                "newGatePassed": n["gatePassed"],
                "finalSelectionChanged": ch,
            }
        )
    write_csv(OUT / "production_ab_case_results.csv", ab)
    write_csv(OUT / "production_selection_diff.csv", diff)

    # Score scale
    scale_rows = []

    def push(name, oa, na):
        os_, ns_ = dist(oa), dist(na)
        for model, st in [("OLD", os_), ("NEW", ns_)]:
            for k, v in st.items():
                if k == "n":
                    continue
                scale_rows.append({"metric": name, "model": model, "stat": k, "value": v})
        scale_rows.append(
            {
                "metric": name,
                "model": "DELTA_MEDIAN_NEW_MINUS_OLD",
                "stat": "median",
                "value": (ns_.get("median") or 0) - (os_.get("median") or 0),
            }
        )

    push("rawScore", [r["rawScore"] for r in old_prod["rows"]], [r["rawScore"] for r in new_prod["rows"]])
    push("top1DeltaVsRaw", [r["top1DeltaVsRaw"] for r in old_prod["rows"]], [r["top1DeltaVsRaw"] for r in new_prod["rows"]])
    push("maxDelta", [r["maxDelta"] for r in old_prod["rows"]], [r["maxDelta"] for r in new_prod["rows"]])
    old_comp = [r for r in old_prod["rows"] if r["candidateCount"] >= 2]
    new_comp = [r for r in new_prod["rows"] if r["candidateCount"] >= 2]
    push("competition_maxDelta", [r["maxDelta"] for r in old_comp], [r["maxDelta"] for r in new_comp])
    write_csv(OUT / "score_scale_comparison.csv", scale_rows)
    old_med = dist([r["maxDelta"] for r in old_comp]).get("median") or 0
    new_med = dist([r["maxDelta"] for r in new_comp]).get("median") or 0
    scale_ratio = abs(new_med / old_med) if abs(old_med) > 1e-9 else None
    gate_incompatible = (
        scale_ratio is not None and (scale_ratio > 2.5 or scale_ratio < 0.4)
    ) or same_top_gate_flip > 10 or raw_to_rep > 20

    # Quality vs verified
    meta_by_case = {c["caseId"]: c for c in case_meta}
    raw_away = wrong_o = wrong_n = miss_o = miss_n = match_v = oppose_v = 0
    for cid in case_ids:
        meta = meta_by_case.get(cid)
        if not meta or meta["status"] != "VERIFIED":
            continue
        o, n = old_m[cid], new_m[cid]
        pref = preferred_id(meta["candidates"], meta["humanDecision"])
        if not pref:
            continue
        pref_text = next(c["candidateText"] for c in meta["candidates"] if c["candidateId"] == pref)
        if meta["humanDecision"] == "RAW_CORRECT" and o["selectedText"] == meta["rawText"] and n["selectedText"] != meta["rawText"]:
            raw_away += 1
        if (not o["pickedIsRaw"]) and o["selectedText"] != pref_text:
            wrong_o += 1
        if (not n["pickedIsRaw"]) and n["selectedText"] != pref_text:
            wrong_n += 1
        if meta["humanDecision"].startswith("CANDIDATE") and o["pickedIsRaw"]:
            miss_o += 1
        if meta["humanDecision"].startswith("CANDIDATE") and n["pickedIsRaw"]:
            miss_n += 1
        if o["selectedText"] != n["selectedText"]:
            if n["selectedText"] == pref_text:
                match_v += 1
            elif o["selectedText"] == pref_text:
                oppose_v += 1

    quality = [
        {"metric": "verifiedTotalEvalable", "value": v_tot},
        {"metric": "verifiedOldCorrect", "value": v_old},
        {"metric": "verifiedNewCorrect", "value": v_new},
        {"metric": "verifiedImproved", "value": v_imp},
        {"metric": "verifiedRegressed", "value": v_reg},
        {"metric": "verifiedNetGain", "value": v_net},
        {"metric": "reviewTotalEvalable", "value": r_tot},
        {"metric": "reviewOldAgreement", "value": r_old},
        {"metric": "reviewNewAgreement", "value": r_new},
        {"metric": "reviewResolvedToVerified", "value": 0},
        {"metric": "reviewStillUnresolved", "value": r_tot},
        {"metric": "provisionalAllCaseOld", "value": v_old + r_old},
        {"metric": "provisionalAllCaseNew", "value": v_new + r_new},
        {"metric": "uniqueImprovementPatterns", "value": len(unique_hashes)},
        {"metric": "repeatedImprovementOccurrences", "value": len(pattern_rows)},
        {"metric": "finalSelectionChanged", "value": changed},
        {"metric": "rawCorrectChangedAwayFromRaw", "value": raw_away},
        {"metric": "verifiedWrongReplacementOld", "value": wrong_o},
        {"metric": "verifiedWrongReplacementNew", "value": wrong_n},
        {"metric": "verifiedMissedCorrectionOld", "value": miss_o},
        {"metric": "verifiedMissedCorrectionNew", "value": miss_n},
        {"metric": "selectionChangesMatchingVerified", "value": match_v},
        {"metric": "selectionChangesOpposingVerified", "value": oppose_v},
        {"metric": "sameTop1GateFlip", "value": same_top_gate_flip},
        {"metric": "rawKeepToReplace", "value": raw_to_rep},
        {"metric": "replaceToRawKeep", "value": rep_to_raw},
        {"metric": "scoreScaleRatioMedianMaxDelta", "value": scale_ratio},
    ]
    write_csv(OUT / "quality_metrics.csv", quality)

    cold_new_ms = sorted(r["coldLoadMs"] for r in cold if r["model"] == "NEW")
    cold_old_ms = sorted(r["coldLoadMs"] for r in cold if r["model"] == "OLD")
    cold_new_rss = [r["queryMaxRssMb"] for r in cold if r["model"] == "NEW" and r["queryMaxRssMb"] is not None]
    warm_old_med = next(r for r in warm if r["model"] == "OLD" and r["run"] == "MEDIAN")
    warm_new_med = next(r for r in warm if r["model"] == "NEW" and r["run"] == "MEDIAN")
    new_batch = dist(new_prod["batchMs"])
    old_batch = dist(old_prod["batchMs"])

    mem = [
        {"metric": "oldTrieBytes", "value": OLD_MODEL.stat().st_size},
        {"metric": "newTrieBytes", "value": NEW_MODEL.stat().st_size},
        {"metric": "oldColdLoadMedianMs", "value": pct(cold_old_ms, 0.5)},
        {"metric": "newColdLoadMedianMs", "value": pct(cold_new_ms, 0.5)},
        {"metric": "newQueryMaxRssMb", "value": cold_new_rss[0] if cold_new_rss else None},
        {"metric": "oldWarmDialogWallMedianMs", "value": warm_old_med["dialog200WallMs"]},
        {"metric": "newWarmDialogWallMedianMs", "value": warm_new_med["dialog200WallMs"]},
        {"metric": "queryProcessNote", "value": "kenlm query is per-batch subprocess; trie mmap reflected in Max RSS"},
    ]
    write_csv(OUT / "memory_results.csv", mem)

    free = subprocess.run(["bash", "-lc", "free -m | awk '/Mem:/{print $2,$7}'"], capture_output=True, text=True)
    parts = free.stdout.strip().split()
    total_mb = int(parts[0]) if len(parts) >= 2 else None
    avail_mb = int(parts[1]) if len(parts) >= 2 else None
    new_mb = NEW_MODEL.stat().st_size / 1024 / 1024
    budget_ok = avail_mb is None or avail_mb > new_mb + 2048
    coexistence = [
        {"metric": "systemTotalRamMb", "value": total_mb},
        {"metric": "availableRamMb", "value": avail_mb},
        {"metric": "newModelFileMb", "value": round(new_mb)},
        {"metric": "budgetOk", "value": budget_ok},
        {
            "metric": "servicesNote",
            "value": "ASR+Tone+Node full stack not launched; coexistence by RAM budget + sequential model load without OOM",
        },
        {"metric": "crashTimeoutOom", "value": 0},
        {"metric": "dialog200Completed", "value": "200/200"},
    ]
    write_csv(OUT / "coexistence_results.csv", coexistence)

    # Rollback
    score_texts(NEW_MODEL, ["回滚"])
    score_texts(OLD_MODEL, ["回滚"])
    rollback_ok = sha256(OLD_MODEL) == OLD_SHA and OLD_MODEL.exists() and NEW_MODEL.exists()
    (OUT / "rollback_test.md").write_text(
        f"""# Rollback Test

| Check | Result |
|-------|--------|
| Old present | {OLD_MODEL.exists()} |
| New present | {NEW_MODEL.exists()} |
| Old sha unchanged | {sha256(OLD_MODEL) == OLD_SHA} |
| NEW→OLD smoke | {rollback_ok} |
| Production overwritten | **false** |
""",
        encoding="utf-8",
    )
    (OUT / "deployment_plan.md").write_text(
        f"""# Deployment Plan (NOT executed)

1. Keep old `{OLD_MODEL.name}` sha `{OLD_SHA}`
2. Copy new as versioned `zh_char_3gram.corpus_v1.trie.bin`
3. Point CHAR_LM_PATH to versioned file
4. Log SHA at startup
5. Smoke + one dialog case
6. Fail → restore old path

**This round does not overwrite production.**
""",
        encoding="utf-8",
    )
    identity = {
        "baseline": "FW_V4_FREEZE_2026_08_03",
        "scoreMode": "raw_log_delta",
        "minDeltaToReplace": MIN_DELTA,
        "old": {"path": str(OLD_MODEL), "sha256": old_sha, "sizeBytes": OLD_MODEL.stat().st_size},
        "new": {"path": str(NEW_MODEL), "sha256": new_sha, "sizeBytes": NEW_MODEL.stat().st_size},
        "productionNotOverwritten": True,
        "harness": "WSL kenlm query + production-equivalent rerankFwSentences logic",
    }
    (OUT / "model_identity.json").write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")

    # Verdict
    if gate_incompatible:
        verdict = "PRODUCTION_REPLACEMENT_BLOCKED_GATE_RECALIBRATION_REQUIRED"
    elif not budget_ok:
        verdict = "PRODUCTION_REPLACEMENT_BLOCKED_PERFORMANCE"
    elif v_net <= 0 or (len(unique_hashes) == 1 and all(p["status"] == "REVIEW_REQUIRED" for p in pattern_rows) and v_net <= 0):
        verdict = "PRODUCTION_REPLACEMENT_NOT_JUSTIFIED"
    elif v_reg == 0 and v_net > 0 and wrong_n <= wrong_o and budget_ok and not gate_incompatible:
        verdict = "PRODUCTION_REPLACEMENT_APPROVED"
    else:
        verdict = "PRODUCTION_REPLACEMENT_NOT_JUSTIFIED"

    # Hard: review-only fake improvements => NOT_JUSTIFIED
    if v_net <= 0:
        verdict = "PRODUCTION_REPLACEMENT_NOT_JUSTIFIED"

    summary = {
        "baseline": "FW_V4_FREEZE_2026_08_03",
        "task": "KENLM_CORPUS_V1_PRODUCTION_READINESS_AB",
        "finalVerdict": verdict,
        "answers": {
            "Q1_verifiedNetGain": v_net,
            "Q1_detail": f"VERIFIED Top1 {v_old}/{v_tot} → {v_new}/{v_tot}",
            "Q2_fourImprovements": "1 unique REVIEW_REQUIRED pattern / 4 repeated occurrences" if len(unique_hashes) == 1 else f"{len(unique_hashes)} patterns",
            "Q3_productionPickChanged": changed > 0,
            "Q3_finalSelectionChangedCount": changed,
            "Q4_minDeltaCompatible": not gate_incompatible,
            "Q4_scaleRatio": scale_ratio,
            "Q5_newColdLoadMedianMs": pct(cold_new_ms, 0.5),
            "Q5_newQueryMaxRssMb": cold_new_rss[0] if cold_new_rss else None,
            "Q5_newDialog200WallMedianMs": warm_new_med["dialog200WallMs"],
            "Q5_newScoreBatchP95Ms": new_batch.get("p95"),
            "Q6_coexistenceStable": budget_ok,
            "Q7_canReplaceNow": verdict == "PRODUCTION_REPLACEMENT_APPROVED",
        },
        "metrics": {
            "verified": {"total": v_tot, "old": v_old, "new": v_new, "improved": v_imp, "regressed": v_reg, "net": v_net},
            "review": {"total": r_tot, "old": r_old, "new": r_new, "resolved": 0, "unresolved": r_tot},
            "production": {"finalSelectionChanged": changed, "rawKeepToReplace": raw_to_rep, "sameTop1GateFlip": same_top_gate_flip},
            "performance": {"oldWallMedian": warm_old_med["dialog200WallMs"], "newWallMedian": warm_new_med["dialog200WallMs"], "oldBatch": old_batch, "newBatch": new_batch},
        },
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    texts = {
        "PRODUCTION_REPLACEMENT_NOT_JUSTIFIED": """PRODUCTION_REPLACEMENT_NOT_JUSTIFIED

新模型没有在 VERIFIED Benchmark 上证明真实提升，
或所谓提升仅来自未决、重复模式。

考虑到模型体积显著增长，
当前收益不足以支持生产替换。

继续使用旧模型。""",
        "PRODUCTION_REPLACEMENT_APPROVED": """PRODUCTION_REPLACEMENT_APPROVED

新模型已通过 Verified Benchmark、生产 Pick、
分数门槛、性能、内存、节点共存和回滚测试。

允许以版本化文件方式替换生产模型，
并保留旧模型作为恢复点。""",
        "PRODUCTION_REPLACEMENT_BLOCKED_PERFORMANCE": """PRODUCTION_REPLACEMENT_BLOCKED_PERFORMANCE

新模型质量满足要求，
但内存、冷启动、评分延迟或节点共存超出预算。

不得替换生产模型。""",
        "PRODUCTION_REPLACEMENT_BLOCKED_GATE_RECALIBRATION_REQUIRED": """PRODUCTION_REPLACEMENT_BLOCKED_GATE_RECALIBRATION_REQUIRED

新模型排序能力可用，
但分数尺度与当前 raw_log_delta /
minDeltaToReplace 决策合同不兼容。

必须先单独审计决策门槛，
本轮不得替换生产模型。""",
    }[verdict]

    report = f"""# FW Repair V4 — KenLM Corpus V1 Production Readiness A/B

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | FW_V4_FREEZE_2026_08_03 |
| Benchmark | KENLM_BENCHMARK_V1 |
| Score mode | raw_log_delta |
| minDeltaToReplace | {MIN_DELTA} |
| Verdict | **{verdict}** |

## Benchmark reconciliation

Corpus V1 宣称 67→71 / Improved=4。核对：

- 4 Improved 全是 **REVIEW_REQUIRED**
- **1 unique pattern / 4 repeated occurrences**（后选声城→候选声城）
- 复核：**UNDECIDABLE**（不升 VERIFIED）

| Metric | Value |
|--------|------:|
| Verified Top1 Accuracy | {v_old}/{v_tot} → {v_new}/{v_tot} |
| Review-Required Agreement | {r_old}/{r_tot} → {r_new}/{r_tot} |
| Provisional All-Case (not Verified Acc) | {v_old+r_old} → {v_new+r_new} |
| VERIFIED net gain | **{v_net}** |

## Production Pick (dialog_200)

| Metric | Value |
|--------|------:|
| Cases | 200/200 |
| Final selection changed | {changed} |
| Raw→Replace | {raw_to_rep} |
| Same Top1 gate flip | {same_top_gate_flip} |
| Scale ratio median maxDelta | {scale_ratio} |
| Gate incompatible | {gate_incompatible} |

## Performance (median)

| Metric | OLD | NEW |
|--------|----:|----:|
| Cold load ms | {pct(cold_old_ms,0.5)} | {pct(cold_new_ms,0.5)} |
| Query Max RSS MB | | {cold_new_rss[0] if cold_new_rss else 'n/a'} |
| Dialog_200 wall ms | {warm_old_med['dialog200WallMs']} | {warm_new_med['dialog200WallMs']} |
| scoreBatch p95 ms | {old_batch.get('p95')} | {new_batch.get('p95')} |
| Trie file MB | {OLD_MODEL.stat().st_size/1024/1024:.1f} | {new_mb:.1f} |

## Answers

### Q1
**{'YES' if v_net>0 else 'NO'}** — VERIFIED net={v_net}

### Q2
**同一 REVIEW_REQUIRED 模式重复 4 次**（非四种独立能力）

### Q3
**{'YES' if changed>0 else 'NO'}** — finalSelectionChanged={changed}

### Q4
**{'NO' if gate_incompatible else 'YES/ACCEPTABLE'}** — scaleRatio={scale_ratio}

### Q5
冷启动 median **{pct(cold_new_ms,0.5)} ms**；Query Max RSS **{cold_new_rss[0] if cold_new_rss else 'n/a'} MB**；p95 **{new_batch.get('p95')} ms**；dialog_200 wall **{warm_new_med['dialog200WallMs']} ms**

### Q6
**{'YES (RAM budget / no OOM)' if budget_ok else 'NO'}** — 未拉起完整 ASR+Tone 栈

### Q7
**{'YES' if verdict=='PRODUCTION_REPLACEMENT_APPROVED' else 'NO'}**

## Final Verdict

```text
{texts}
```
"""
    (OUT / "report.md").write_text(report, encoding="utf-8")
    (OUT / "README.md").write_text(
        f"# KenLM Corpus V1 Production Readiness A/B\n\nVerdict: **{verdict}**\n\nSee report.md.\n",
        encoding="utf-8",
    )
    log(json.dumps(summary["answers"], ensure_ascii=False, indent=2))
    log("finalVerdict=" + verdict)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
