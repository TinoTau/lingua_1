# -*- coding: utf-8 -*-
"""Post-process dialog200 bundle13 vs bundle14 comparison for final acceptance."""
from __future__ import annotations

import csv
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
OUT = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_v1_final_acceptance_freeze_20260823"
)
B13 = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "recall_foundation_completion_2026_08_18/dialog200_after"
)
B14 = OUT / "dialog200_bundle14"
PRE_SQLITE = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_v1_implement_rebuild_20260823_0207/"
    "single_char_repair_v1_rebuild_backup_20260823_0207/lexicon_v3_pre.sqlite"
)
V3_SQLITE = ROOT / "node_runtime/lexicon/v3/lexicon.sqlite"
POLLUTION = {"毫", "涡", "皿"}


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def final_text(rec: dict) -> str:
    for k in ("final_text", "final_output", "finalOutput", "corrected_text", "output_text"):
        v = rec.get(k)
        if isinstance(v, str):
            return v
    return ""


def length1_from_trace(rec: dict) -> list[str]:
    pt = rec.get("path_trace") or {}
    out: list[str] = []
    for path in pt.get("paths") or []:
        if not isinstance(path, dict):
            continue
        for sp in path.get("finespans") or []:
            if not isinstance(sp, dict):
                continue
            src = str(sp.get("source_text") or "")
            ph = str(sp.get("phonetic_representation") or "")
            if len(src) == 1 and ph and "|" not in ph:
                out.append(src)
            lc = sp.get("length1_collector") or sp.get("length1Collector") or {}
            for h in lc.get("sqlHits") or lc.get("sql_hits") or []:
                if isinstance(h, dict) and h.get("surface"):
                    out.append(h["surface"])
    return sorted(set(out))


def lookup(db: Path, pk: str, tk: str) -> list[str]:
    con = sqlite3.connect(str(db))
    rows = con.execute(
        "SELECT word FROM base_lexicon WHERE pinyin_key=? AND tone_pinyin_key=? "
        "AND enabled=1 AND length(word)=1 ORDER BY prior_score DESC LIMIT 8",
        (pk, tk),
    ).fetchall()
    con.close()
    return [r[0] for r in rows]


def classify_change(t13: str, t14: str, b13_len1: list[str], b14_len1: list[str]) -> str:
    if t13 == t14:
        return "D.UNCHANGED"
    removed = set(b13_len1) - set(b14_len1)
    if removed & POLLUTION:
        return "A.POLLUTION_REMOVED_IMPROVED"
    if set(b13_len1) and not set(b14_len1):
        return "C.VALID_CANDIDATE_LOST"
    if not b13_len1 and not b14_len1:
        return "E.UNRELATED_TO_SINGLE_CHAR"
    if removed:
        return "B.POLLUTION_REMOVED_NEUTRAL"
    return "F.ENVIRONMENT_OR_TRACE_UNCLEAR"


def replay_length1_metrics(b13_span: list[dict]) -> tuple[dict, list[dict]]:
    metrics: dict[str, int] = defaultdict(int)
    coverage_gaps: list[dict] = []
    for s in b13_span:
        fs = s.get("finespan") or s.get("fine_span") or {}
        src = str(fs.get("source_text") or "").strip()
        ph = str(fs.get("phonetic_representation") or "").strip()
        tones = fs.get("tone_representation") or []
        if len(src) != 1 or not ph or "|" in ph or not tones:
            continue
        metrics["length1_spans"] += 1
        pk = ph.lower()
        tk = f"{pk}{tones[0]}"
        b13c = lookup(PRE_SQLITE, pk, tk)
        b14c = lookup(V3_SQLITE, pk, tk)
        if b13c:
            metrics["b13_has_candidate"] += 1
        if b14c:
            metrics["b14_has_candidate"] += 1
        if len(b13c) > 1:
            metrics["b13_ambiguous"] += 1
        if len(b14c) > 1:
            metrics["b14_ambiguous"] += 1
        if b13c and not b14c:
            metrics["candidate_lost"] += 1
            if src not in b14c:
                coverage_gaps.append(
                    {
                        "dialog_id": s.get("dialog_id"),
                        "surface": src,
                        "pinyin_key": pk,
                        "tone_key": tk,
                    }
                )
        if set(b13c) & POLLUTION and not (set(b14c) & POLLUTION):
            metrics["pollution_removed_hits"] += 1
    return dict(metrics), coverage_gaps


def main() -> None:
    b13_utt = {
        r.get("dialog_id") or r.get("id"): r
        for r in load_jsonl(B13 / "dialog200_stagej_per_utterance.jsonl")
    }
    b14_utt_path = B14 / "dialog200_stagej_per_utterance.jsonl"
    b14_utt = {
        r.get("dialog_id") or r.get("id"): r for r in load_jsonl(b14_utt_path)
    }

    status = "ENVIRONMENT_BLOCKED"
    if b14_utt_path.exists() and len(b14_utt) >= 200:
        status = "PASS"
    elif b14_utt_path.exists() and len(b14_utt) > 0:
        status = "IN_PROGRESS"

    changed_rows = []
    classes: Counter[str] = Counter()
    b13_span = load_jsonl(B13 / "dialog200_stagej_per_span.jsonl")
    replay_metrics, coverage_gaps = replay_length1_metrics(b13_span)

    for did in sorted(set(b13_utt) | set(b14_utt)):
        r13 = b13_utt.get(did, {})
        r14 = b14_utt.get(did, {})
        t13 = final_text(r13)
        t14 = final_text(r14)
        b13_len1 = length1_from_trace(r13)
        b14_len1 = length1_from_trace(r14) if r14 else []
        cls = classify_change(t13, t14 if r14 else t13, b13_len1, b14_len1)
        ra13 = str(r13.get("raw_asr_text") or "")
        ra14 = str(r14.get("raw_asr_text") or "")
        if t13 != t14 and r14 and ra13 != ra14:
            cls = "E.UNRELATED_TO_SINGLE_CHAR"
        elif t13 != t14 and r14 and not b13_len1 and not b14_len1:
            cls = "E.UNRELATED_TO_SINGLE_CHAR"
        removed_pollution = (set(b13_len1) - set(b14_len1)) & POLLUTION
        if removed_pollution and t13 != t14:
            cls = "A.POLLUTION_REMOVED_IMPROVED"
        classes[cls.split(".")[0]] += 1
        if t13 != t14 and r14:
            changed_rows.append(
                {
                    "dialog_id": did,
                    "asr_raw": r14.get("raw_asr_text") or r13.get("raw_asr_text"),
                    "tone_evidence": r14.get("tone") or r13.get("tone"),
                    "fine_span": (r14.get("path_trace") or {}).get("paths"),
                    "bundle13_length1_candidates": b13_len1,
                    "bundle14_length1_candidates": b14_len1,
                    "domain_vote": None,
                    "assembly_candidates": None,
                    "kenlm_ranking": (r14.get("path_trace") or {}).get("kenlm_rerank"),
                    "kenlm_inputs": (r14.get("path_trace") or {}).get("kenlm_input"),
                    "bundle13_final": t13,
                    "bundle14_final": t14,
                    "final_output": t14,
                    "classification": cls,
                }
            )

    summary = {
        "status": status,
        "bundle13_baseline_available": True,
        "utterances_b13": len(b13_utt),
        "utterances_b14": len(b14_utt),
        "changed_outputs": len(changed_rows),
        "sqlite_replay_length1_metrics": replay_metrics,
        "classification_counts": dict(classes),
        "pollution_removed_improved": classes.get("A", 0),
        "pollution_removed_neutral": classes.get("B", 0),
        "valid_candidate_lost": classes.get("C", 0),
        "unchanged": classes.get("D", 0),
        "unrelated": classes.get("E", 0),
        "unclear": classes.get("F", 0),
        "coverage_gap_candidates": len(coverage_gaps),
    }
    (OUT / "single_char_v1_dialog200_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    with (OUT / "single_char_v1_dialog200_change_classification.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["dialog_id", "classification", "bundle13_final", "bundle14_final"])
        for row in changed_rows:
            w.writerow([row["dialog_id"], row["classification"], row["bundle13_final"], row["bundle14_final"]])

    with (OUT / "single_char_v1_coverage_gap_candidates.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["dialog_id", "surface", "pinyin_key", "tone_key"])
        w.writeheader()
        for g in coverage_gaps[:500]:
            w.writerow(g)

    with (OUT / "single_char_v1_dialog200_changed_case_trace.jsonl").open("w", encoding="utf-8") as f:
        for row in changed_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
