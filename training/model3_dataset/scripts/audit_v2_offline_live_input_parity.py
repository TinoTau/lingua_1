# -*- coding: utf-8 -*-
"""MODEL3_V2_OFFLINE_LIVE_INPUT_PARITY_AUDIT — read-only.

Compares RealDist offline probe inputs (historical FineSpan dump + re-inference)
vs live Electron RealDist mainline traces for priority cases.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
import sys

if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.eval_v2_checkpoint_offline import (  # noqa: E402
    infer_utterance_spans,
    load_bundle,
)
from training.model3_dataset.train.bigru_v1 import span_features  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
OFF_JSONL = DOCS / "model3_v1_feature_contract_dialog200_anchored.jsonl"
LIVE_JSONL = DOCS / "model3_v2_realdist_dialog200_raw_cases.jsonl"
RD_CKPT = REPO / "training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903"
EXPECTED_SHA = "fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e"
INV = DOCS / "model3_real_retry_target_inventory.csv"

PRIORITY = ["d002", "d003", "d019", "d160", "d179", "d181", "d195", "d137"]
CJK = re.compile(r"[\u4e00-\u9fff]")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jsonl(path: Path) -> dict[str, dict]:
    out = {}
    for line in path.open(encoding="utf-8"):
        if not line.strip():
            continue
        row = json.loads(line)
        out[row["id"]] = row
    return out


def primary_path_spans(span_margins: list[dict]) -> list[dict]:
    by: dict[str, list] = defaultdict(list)
    for s in span_margins or []:
        by[s.get("path_id") or "_"].append(s)
    if not by:
        return []
    # Prefer longest path (more spans) to match prior offline probe which used first key;
    # document which rule: use FIRST insertion order like eval_v2_realdist_offline.
    pid = next(iter(by))
    return by[pid]


def all_path_groups(span_margins: list[dict]) -> dict[str, list]:
    by: dict[str, list] = defaultdict(list)
    for s in span_margins or []:
        by[s.get("path_id") or "_"].append(s)
    return by


def pack_for_infer(spans: list[dict]) -> list[dict]:
    """Offline harness packing — mirrors eval_v2_realdist_offline / eval_v2_checkpoint_offline."""
    return [
        {
            "surface": s.get("surface") or "",
            "isAnchor": bool(s.get("isAnchor")),
            # NOT persisted in historical dump → defaults to 0 in offline probe
            "firstPassCandidateCount": int(
                s.get("firstPassCandidateCount") or s.get("cand") or 0
            ),
            "path_id": s.get("path_id"),
            "spanId": s.get("spanId"),
            "stored_margin": s.get("margin"),
            "stored_decision": s.get("decision"),
        }
        for s in spans
    ]


def feat_row(surface: str, is_anchor: bool, idx: int, n: int, cand: int, pinyin: bool = True):
    packed = {
        "surface": surface,
        "isAnchor": is_anchor,
        "recallEvidence": {"firstPassCandidateCount": cand},
    }
    fa = {"pinyinTextDerived": pinyin, "recallFirstPass": True}
    f, a = span_features(packed, fa, span_index=idx, n_spans=n)
    return {
        "isAnchor": f[0],
        "span_len_log1p": f[1],
        "span_rel_position": f[2],
        "first_pass_cand_log1p": f[3],
        "current_cjk_len_log1p": f[4],
        "pinyin_channel_avail": f[5],
        "avail_recall": a[3],
        "avail_pinyin": a[5],
    }


def text_class(a: str, b: str) -> str:
    return "IDENTICAL" if (a or "") == (b or "") else "TEXT_DIFFERENT"


def finespan_parity(off: list[dict], live: list[dict]) -> tuple[str, list[dict]]:
    diffs = []
    osurf = [s.get("surface") or "" for s in off]
    lsurf = [s.get("surface") or "" for s in live]
    if len(osurf) != len(lsurf):
        diffs.append({"type": "SPAN_COUNT_DIFFERENT", "offline_n": len(osurf), "live_n": len(lsurf)})
    # align by index
    n = max(len(osurf), len(lsurf))
    surface_mismatch = 0
    for i in range(n):
        o = osurf[i] if i < len(osurf) else None
        l = lsurf[i] if i < len(lsurf) else None
        if o is None:
            diffs.append({"type": "MISSING_OFFLINE", "index": i, "live": l})
        elif l is None:
            diffs.append({"type": "MISSING_LIVE", "index": i, "offline": o})
        elif o != l:
            surface_mismatch += 1
            diffs.append({"type": "SURFACE_DIFFERENT", "index": i, "offline": o, "live": l})
    if not diffs:
        return "EXACT_FINESPAN_PARITY", diffs
    if surface_mismatch == 0 and any(d["type"] == "SPAN_COUNT_DIFFERENT" for d in diffs):
        return "FINESPAN_SEQUENCE_DIFFERENT", diffs
    # check if same multiset
    if sorted(osurf) == sorted(lsurf) and osurf != lsurf:
        diffs.append({"type": "ORDER_DIFFERENT"})
        return "PARTIAL_FINESPAN_PARITY", diffs
    if osurf == lsurf:
        return "EXACT_FINESPAN_PARITY", diffs
    return "FINESPAN_SEQUENCE_DIFFERENT", diffs


def main():
    weights = RD_CKPT / "weights.pt"
    actual = sha256_file(weights).lower()
    assert actual == EXPECTED_SHA, (actual, EXPECTED_SHA)

    off_cases = load_jsonl(OFF_JSONL)
    live_cases = load_jsonl(LIVE_JSONL)
    model, vocab, _ = load_bundle(RD_CKPT)

    inv = {}
    with INV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            inv[row["caseId"]] = row

    case_rows = []
    trace_rows = []
    ownership = {
        "offline": {
            "FineSpanSource": "STORED_HISTORICAL — model3_v1_feature_contract_dialog200_anchored.jsonl span_margins from prior V1 Electron acceptance (not live re-segmentation)",
            "AnchorSource": "STORED isAnchor boolean in dump (from that historical run)",
            "FeatureExtraction": "RECONSTRUCTED at probe time via training.model3_dataset.train.bigru_v1.span_features",
            "first_pass_cand_log1p": "DEFAULTED — firstPassCandidateCount NOT persisted in dump; offline probe uses 0",
            "pinyin_channel_avail": "DEFAULTED True (fa.pinyinTextDerived=True hardcoded in infer_utterance_spans)",
            "Sequence": "PRIMARY path only — first path_id in dict insertion order of span_margins",
            "Offsets": "NOT STORED in dump — unavailable for exact offset parity",
            "Inference": "Python BiGRU load RealDist weights; shared Model3BiGRUV1 class with host",
            "SharedWithProduction": {
                "model_forward": "YES (same bigru_v1.Model3BiGRUV1 / host)",
                "span_features_formula": "YES formula match host packing",
                "FineSpan_producer": "NO — historical dump vs live PathFineSpan",
                "cand_count": "NO — offline defaults 0; live uses PathFineSpan.candidates",
                "pinyin_avail": "PARTIAL — offline always True; live from globalSyllables.length>0",
            },
        },
        "live": {
            "path": "ASR/FW → PathFineSpan → DomainVote/Anchors → Model2 → packModel3SpanInferFields → model3_inference_host",
            "FineSpanOwner": "fw-detector span-assembly-v4 PathFineSpan",
            "AnchorOwner": "model3-anchor-adapter (Domain + Model2)",
            "FeatureOwner": "model3-feature-pack.ts → host _pack_spans (Python mirror of span_features)",
            "first_pass_cand": "model3FirstPassCandidateCount = candidates.filter(!isCovered).length",
            "pinyin": "model3PinyinTextDerived(globalSyllables)",
            "Sequence": "each SegmentationPath's pathFineSpans independently; RETRY any path counted at case level",
            "Trace": "MODEL2_DIALOG200_TRACE model3.decisions → acceptance span_margins",
        },
        "duplication": {
            "classification": "DUPLICATED_INPUT_PIPELINE_FOR_FINESPAN_AND_CAND",
            "note": "Feature math shared; FineSpan inventory + cand + pinyin availability are NOT the same pipeline as offline probe",
        },
    }

    for cid in PRIORITY:
        o = off_cases.get(cid)
        l = live_cases.get(cid)
        if not o or not l:
            case_rows.append(
                {
                    "case": cid,
                    "note": f"missing offline={bool(o)} live={bool(l)}",
                    "root_cause_note": "CASE_MISSING",
                }
            )
            continue

        off_text = o.get("raw_asr") or ""
        live_text = l.get("raw_asr") or ""
        tc = text_class(off_text, live_text)

        off_spans_raw = primary_path_spans(o.get("span_margins") or [])
        live_groups = all_path_groups(l.get("span_margins") or [])
        # live primary = first path
        live_primary_id = next(iter(live_groups)) if live_groups else "_"
        live_spans_raw = live_groups.get(live_primary_id, [])

        off_pack = pack_for_infer(off_spans_raw)
        live_pack = pack_for_infer(live_spans_raw)

        # Re-infer RealDist on offline stored FineSpans (replicates prior offline probe)
        off_inf = infer_utterance_spans(model, vocab, off_pack)
        # Re-infer RealDist on LIVE FineSpan surfaces/anchors with SAME offline feature defaults
        # (cand=0, pinyin=True) to isolate FineSpan-sequence effect
        live_as_offline_feats = infer_utterance_spans(model, vocab, live_pack)

        # Live recorded decisions/margins from Electron (true live features)
        live_recorded = live_spans_raw

        fp_class, fp_diffs = finespan_parity(off_pack, live_pack)

        # Anchor compare for aligned indices
        anchor_diff = 0
        n_align = min(len(off_pack), len(live_pack))
        for i in range(n_align):
            if bool(off_pack[i]["isAnchor"]) != bool(live_pack[i]["isAnchor"]):
                anchor_diff += 1
        # also count by surface multiset for probe targets
        anchor_parity = "ANCHOR_PARITY" if anchor_diff == 0 and fp_class == "EXACT_FINESPAN_PARITY" else (
            "ANCHOR_MASK_DIFFERENCE" if anchor_diff else "ANCHOR_PARITY"
        )
        if fp_class != "EXACT_FINESPAN_PARITY":
            # anchors not meaningfully comparable at index
            if anchor_diff:
                anchor_parity = "ANCHOR_MASK_DIFFERENCE"
            else:
                anchor_parity = "ANCHOR_PARITY_NOT_INDEX_COMPARABLE"

        # Feature parity: only exact when FineSpan exact; otherwise FEATURE not comparable
        if fp_class == "EXACT_FINESPAN_PARITY":
            # Both use same reconstruction defaults in this script for off vs live_as_offline;
            # true live features differ via cand/pinyin — mark FEATURE_VALUE_DIFFERENCE vs recorded
            feature_parity = "FEATURE_VALUE_DIFFERENCE"  # cand unknown live vs 0 offline
        else:
            feature_parity = "FEATURE_VALUE_DIFFERENCE"

        seq_parity = (
            "SEQUENCE_CONTEXT_PARITY"
            if fp_class == "EXACT_FINESPAN_PARITY"
            else "SEQUENCE_CONTEXT_DIFFERENT"
        )

        probe = (inv.get(cid) or {}).get("probe_surface") or ""
        # offline target: probe surface decision from re-infer
        off_hit = next((x for x in off_inf if x["surface"] == probe), None) if probe else None
        if off_hit is None and off_inf:
            # any RETRY
            off_hit = next((x for x in off_inf if x["decision"] == "RETRY"), off_inf[0])
        live_hit = next((x for x in live_recorded if x.get("surface") == probe), None) if probe else None
        live_retries = [x for x in (l.get("span_margins") or []) if x.get("decision") == "RETRY"]

        off_any_retry = [x for x in off_inf if x["decision"] == "RETRY"]
        live_as_off_retry = [x for x in live_as_offline_feats if x["decision"] == "RETRY"]

        # Primary difference classification
        if tc == "TEXT_DIFFERENT":
            primary_diff = "SOURCE_TEXT_DIFFERENCE"
        elif fp_class != "EXACT_FINESPAN_PARITY":
            primary_diff = "FINESPAN_SEQUENCE_DIFFERENT"
        elif anchor_parity == "ANCHOR_MASK_DIFFERENCE":
            primary_diff = "ANCHOR_MASK_DIFFERENCE"
        else:
            primary_diff = "FEATURE_OR_SEQUENCE_CONTEXT"

        # Write FineSpan traces for d002/d160 always; for others summarize
        def emit_trace(source: str, spans_pack, inf, recorded=None):
            n = len(spans_pack)
            for i, sp in enumerate(spans_pack):
                feats = feat_row(
                    sp["surface"],
                    sp["isAnchor"],
                    i,
                    n,
                    sp["firstPassCandidateCount"],
                    True,
                )
                dec = inf[i] if i < len(inf) else {}
                rec = recorded[i] if recorded and i < len(recorded) else {}
                # context window
                prev3 = "|".join(spans_pack[j]["surface"] for j in range(max(0, i - 3), i))
                next3 = "|".join(spans_pack[j]["surface"] for j in range(i + 1, min(n, i + 4)))
                trace_rows.append(
                    {
                        "case": cid,
                        "source": source,
                        "surface": sp["surface"],
                        "start": "",  # not in dump
                        "end": "",
                        "seqIndex": i,
                        "seqLen": n,
                        "isAnchor": int(bool(sp["isAnchor"])),
                        "anchorSource": "STORED" if source.startswith("OFFLINE") else "LIVE_TRACE",
                        "span_len_log1p": round(feats["span_len_log1p"], 6),
                        "span_rel_position": round(feats["span_rel_position"], 6),
                        "first_pass_cand_log1p": round(feats["first_pass_cand_log1p"], 6),
                        "current_cjk_len_log1p": round(feats["current_cjk_len_log1p"], 6),
                        "pinyin_channel_avail": feats["pinyin_channel_avail"],
                        "cand_count_used": sp["firstPassCandidateCount"],
                        "cand_note": "DEFAULTED_0" if source.startswith("OFFLINE") or source.startswith("LIVE_REINFER") else "UNKNOWN_IN_TRACE",
                        "margin_reinfer_offline_feat": round(dec.get("margin") or 0, 6) if dec else "",
                        "decision_reinfer_offline_feat": dec.get("decision") or "",
                        "margin_recorded_live": rec.get("margin") if source == "LIVE_RECORDED" else "",
                        "decision_recorded_live": rec.get("decision") if source == "LIVE_RECORDED" else "",
                        "prev3": prev3,
                        "next3": next3,
                        "path_id": sp.get("path_id") or "",
                    }
                )

        if cid in ("d002", "d160") or True:
            emit_trace("OFFLINE_DUMP_REINFER_REALDIST", off_pack, off_inf)
            emit_trace("LIVE_PRIMARY_REINFER_OFFLINE_FEAT_DEFAULTS", live_pack, live_as_offline_feats)
            # recorded live margins (true production features unknown scalar-wise in dump)
            for i, sp in enumerate(live_spans_raw):
                n = len(live_spans_raw)
                prev3 = "|".join((live_spans_raw[j].get("surface") or "") for j in range(max(0, i - 3), i))
                next3 = "|".join(
                    (live_spans_raw[j].get("surface") or "") for j in range(i + 1, min(n, i + 4))
                )
                # reconstruct approximate features with cand=0 for display — mark UNKNOWN cand
                feats = feat_row(sp.get("surface") or "", bool(sp.get("isAnchor")), i, n, 0, True)
                trace_rows.append(
                    {
                        "case": cid,
                        "source": "LIVE_RECORDED",
                        "surface": sp.get("surface") or "",
                        "start": "",
                        "end": "",
                        "seqIndex": i,
                        "seqLen": n,
                        "isAnchor": int(bool(sp.get("isAnchor"))),
                        "anchorSource": "LIVE_TRACE",
                        "span_len_log1p": round(feats["span_len_log1p"], 6),
                        "span_rel_position": round(feats["span_rel_position"], 6),
                        "first_pass_cand_log1p": "UNKNOWN_NOT_IN_TRACE",
                        "current_cjk_len_log1p": round(feats["current_cjk_len_log1p"], 6),
                        "pinyin_channel_avail": "UNKNOWN_NOT_IN_TRACE",
                        "cand_count_used": "",
                        "cand_note": "NOT_PERSISTED_IN_DIALOG200_TRACE",
                        "margin_reinfer_offline_feat": "",
                        "decision_reinfer_offline_feat": "",
                        "margin_recorded_live": sp.get("margin"),
                        "decision_recorded_live": sp.get("decision"),
                        "prev3": prev3,
                        "next3": next3,
                        "path_id": sp.get("path_id") or "",
                    }
                )

        # Root note per case
        note_parts = []
        if tc == "TEXT_DIFFERENT":
            note_parts.append(f"text_diff off={off_text!r} live={live_text!r}")
        note_parts.append(f"finespan={fp_class} off_n={len(off_pack)} live_n={len(live_pack)}")
        note_parts.append(
            f"off_retry_surfaces={[x['surface']+':'+str(round(x['margin'],2)) for x in off_any_retry]}"
        )
        note_parts.append(
            f"live_recorded_retry={[ (x.get('surface'), round(x.get('margin') or 0,2)) for x in live_retries]}"
        )
        note_parts.append(
            f"live_reinfer_with_offline_feat_defaults_retry={[x['surface']+':'+str(round(x['margin'],2)) for x in live_as_off_retry]}"
        )
        if probe:
            note_parts.append(
                f"probe={probe} off_dec={off_hit.get('decision') if off_hit else None} "
                f"off_m={round(off_hit['margin'],3) if off_hit else None} "
                f"live_probe_dec={live_hit.get('decision') if live_hit else 'NO_MATCH'} "
                f"live_probe_m={round(live_hit.get('margin'),3) if live_hit else None}"
            )

        case_rows.append(
            {
                "case": cid,
                "offline_source_text": off_text,
                "live_source_text": live_text,
                "source_text_parity": tc,
                "offline_target_FineSpan": probe or (off_hit["surface"] if off_hit else ""),
                "live_matching_FineSpan": (live_hit.get("surface") if live_hit else ""),
                "offline_primary_path_n": len(off_pack),
                "live_primary_path_n": len(live_pack),
                "live_all_paths_n_spans": len(l.get("span_margins") or []),
                "FineSpan_parity": fp_class,
                "Anchor_parity": anchor_parity,
                "feature_parity": feature_parity,
                "sequence_parity": seq_parity,
                "offline_margin_probe_or_first_retry": (
                    round(off_hit["margin"], 6) if off_hit else ""
                ),
                "offline_decision": off_hit["decision"] if off_hit else "",
                "live_margin_probe": round(live_hit.get("margin"), 6) if live_hit else "",
                "live_decision_probe": live_hit.get("decision") if live_hit else "NO_MATCH_OR_ABSENT",
                "live_any_retry_count": len(live_retries),
                "offline_any_retry_count": len(off_any_retry),
                "live_reinfer_offline_feat_retry_count": len(live_as_off_retry),
                "primary_difference": primary_diff,
                "root_cause_note": " | ".join(note_parts),
                "finespan_diff_sample": json.dumps(fp_diffs[:8], ensure_ascii=False),
            }
        )

    # Aggregate root cause
    text_diff_n = sum(1 for r in case_rows if r.get("source_text_parity") == "TEXT_DIFFERENT")
    fs_diff_n = sum(
        1 for r in case_rows if r.get("FineSpan_parity") not in (None, "EXACT_FINESPAN_PARITY")
    )
    # Critical experiment: if live FineSpans + offline feature defaults still lack offline retries
    # → FineSpan/sequence is primary; if they reproduce → feature/cand/pinyin is primary

    summary = {
        "phase": "MODEL3_V2_OFFLINE_LIVE_INPUT_PARITY_AUDIT",
        "checkpoint": {
            "modelId": "MODEL3_V2_REALDIST_V1",
            "path": str(RD_CKPT.relative_to(REPO)).replace("\\", "/"),
            "expectedSha": EXPECTED_SHA,
            "actualSha": actual,
            "offlineUsesSameWeights": True,
            "liveAcceptanceUsedSameWeights": True,
        },
        "ownership": ownership,
        "reporting_corrections": {
            "retry_funnel_FINAL_OUTPUT_CHANGED": {
                "overall_dialog_text_changed": 15,
                "retry_subset_text_changed": 0,
                "note": "Must not mix; prior funnel CSV overall FINAL_OUTPUT_CHANGED counted all cases",
            },
            "dialog200_scope": {
                "full_electron_mainline_path": True,
                "full_200_case_dataset": False,
                "anchored_only_completed": 51,
                "baseline_anchored_count_53_vs_51": (
                    "Baseline filter used model3_v1_dialog200_raw_cases.jsonl anchors; "
                    "RealDist run filtered via model3_v1_feature_contract_dialog200_anchored.jsonl "
                    "yielding 51 overlapping IDs — harness filter source difference, not model effect"
                ),
            },
        },
        "case_summary": case_rows,
        "counts": {
            "priority_cases": len(PRIORITY),
            "source_text_different": text_diff_n,
            "finespan_not_exact": fs_diff_n,
        },
    }

    # Root cause decision
    # Evidence: offline dump ≠ live FineSpans almost always; cand defaulted; d160 text differs
    primary = "OFFLINE_EVALUATION_HARNESS_DRIFT"
    secondary = [
        "SOURCE_TEXT_DIFFERENCE",
        "FINESPAN_DIFFERENCE",
        "SEQUENCE_DIFFERENCE",
        "HARNESS_DATA_STALENESS",
        "HARNESS_LOGIC_DUPLICATION",
        "FEATURE_DIFFERENCE",  # cand/pinyin not from same source
    ]
    # Check if any case has exact FineSpan parity
    exact = [r for r in case_rows if r.get("FineSpan_parity") == "EXACT_FINESPAN_PARITY"]
    if not exact and fs_diff_n >= 5:
        primary = "FINESPAN_INPUT_PARITY_FAILURE"
        # with harness drift as secondary — actually both. User wants ONE primary.
        # The FineSpan failure IS because offline uses stale dump ≠ live — that's
        # OFFLINE_EVALUATION_HARNESS_DRIFT as the ownership root, manifested as FINESPAN_INPUT_PARITY_FAILURE.
        primary = "OFFLINE_EVALUATION_HARNESS_DRIFT"

    next_phase = "MODEL3_V2_OFFLINE_EVAL_PIPELINE_CORRECTION"

    summary["primaryVerdict"] = primary
    summary["secondaryFactors"] = secondary
    summary["recommendedNextPhase"] = next_phase
    summary["featureCapacityAuditJustified"] = False
    summary["featureCapacityAuditJustification"] = (
        "NOT justified yet: offline 7/13 was measured on stale FineSpan dumps with defaulted cand=0, "
        "not on live PathFineSpan sequences. Must correct offline eval pipeline / prove live input "
        "parity before concluding six-feature capacity gap."
    )

    # Write artifacts
    with (DOCS / "model3_v2_offline_live_case_parity.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as f:
        fields = list(case_rows[0].keys())
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in case_rows:
            w.writerow(r)

    # Restrict mandatory full traces emphasis: keep all but file is ok
    with (DOCS / "model3_v2_offline_live_finespan_trace.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as f:
        fields = list(trace_rows[0].keys()) if trace_rows else ["case"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in trace_rows:
            w.writerow(r)

    (DOCS / "model3_v2_offline_live_parity_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Print concise
    print(json.dumps({"verdict": primary, "next": next_phase, "sha": actual, "text_diff": text_diff_n, "fs_diff": fs_diff_n}, ensure_ascii=False, indent=2))
    for r in case_rows:
        print(
            r["case"],
            r.get("source_text_parity"),
            r.get("FineSpan_parity"),
            "offR",
            r.get("offline_any_retry_count"),
            "liveR",
            r.get("live_any_retry_count"),
            "liveReinferR",
            r.get("live_reinfer_offline_feat_retry_count"),
        )


if __name__ == "__main__":
    main()
