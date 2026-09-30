# -*- coding: utf-8 -*-
"""Held-out HIGH12 / unresolved4 replay for class-weight experiment arms."""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    encode_surface,
)

DOCS = REPO / "docs/user_correction/model3"
S3_MAINLINE = DOCS / "model3_v2_s3_mainline_s3_raw_cases.jsonl"
TRIGGER_CSV = DOCS / "model3_v2_retry_region_trigger_cases.csv"
PARTIAL_CSV = DOCS / "model3_v2_partial_coverage_decisions.csv"
SHIFTED_CSV = DOCS / "model3_v2_shifted_target_neighbor_pairs.csv"

HIGH12 = [
    "d040",
    "d042",
    "d054",
    "d065",
    "d085",
    "d102",
    "d109",
    "d114",
    "d129",
    "d138",
    "d172",
    "d175",
]
UNRESOLVED4 = ["d008", "d022", "d051", "d094"]
CLEAR_OOS = ["d040", "d042", "d085", "d129", "d172", "d175"]
LOCAL_FIT_WEAK = ["d065", "d102", "d138"]
SURFACE_UNRESOLVED = ["d054", "d109", "d114"]

LOCALIZATION_16 = HIGH12 + UNRESOLVED4
FEAT_KEYS = list(FEAT_NAMES)


def load_bundle(ckpt: Path):
    cfg = json.loads((ckpt / "config.json").read_text(encoding="utf-8"))
    vocab = json.loads((ckpt / "vocab.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(
        len(vocab),
        cfg.get("embed_dim", 64),
        cfg.get("hidden_dim", 128),
        cfg.get("feat_dim", FEAT_DIM),
    )
    state = torch.load(ckpt / "weights.pt", map_location="cpu")
    model.load_state_dict(state)
    model.eval()
    return model, vocab


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_mainline_traces() -> dict[tuple[str, str], list[dict]]:
    by_case_path: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for line in S3_MAINLINE.open(encoding="utf-8"):
        if not line.strip():
            continue
        row = json.loads(line)
        cid = row["id"]
        for tr in row.get("inference_input_traces") or []:
            sp = tr.get("span") or tr
            pid = tr.get("pathId") or sp.get("pathId") or ""
            by_case_path[(cid, pid)].append({**sp, "pathId": pid, "caseId": cid})
    for key in by_case_path:
        by_case_path[key].sort(key=lambda s: int(s.get("seqIndex") or 0))
    return by_case_path


def replay_path(model, vocab, spans: list[dict]) -> dict[str, dict]:
    n = len(spans)
    tokens = torch.zeros(1, n, 8, dtype=torch.long)
    feats = torch.zeros(1, n, FEAT_DIM)
    avail = torch.ones(1, n, FEAT_DIM)
    for i, sp in enumerate(spans):
        tok = sp.get("tokenIds")
        if isinstance(tok, list) and len(tok) == 8:
            tokens[0, i] = torch.tensor([int(x) for x in tok], dtype=torch.long)
        else:
            surf = sp.get("surfaceUsed") or sp.get("surface") or ""
            tokens[0, i] = torch.tensor(encode_surface(surf, vocab), dtype=torch.long)
        fv = sp.get("featVector")
        if isinstance(fv, list) and len(fv) == FEAT_DIM:
            row = [float(x) for x in fv]
        else:
            f = sp["features"]
            row = [float(f[k]) for k in FEAT_KEYS]
        feats[0, i] = torch.tensor(row)
        am = sp.get("availMask")
        if isinstance(am, list) and len(am) == FEAT_DIM:
            avail[0, i] = torch.tensor([float(x) for x in am])
        elif row[5] == 0.0:
            avail[0, i, 5] = 0.0
    with torch.no_grad():
        logits = model(tokens, feats, avail)[0]
    out = {}
    for i, sp in enumerate(spans):
        keep_l = float(logits[i, 0].item())
        retry_l = float(logits[i, 1].item())
        is_anchor = bool(sp.get("isAnchor"))
        decision = "KEEP" if is_anchor or retry_l <= keep_l else "RETRY"
        out[sp["spanId"]] = {
            "decision": decision,
            "margin": retry_l - keep_l,
        }
    return out


def target_span_ids(case_id: str, cls: str, trig: dict, partial: list[dict], shifted: dict) -> list[str]:
    if cls == "MODEL3_TARGET_PARTIAL_COVERAGE":
        return [r["spanId"] for r in partial if r["caseId"] == case_id]
    if cls == "MODEL3_RETRY_SHIFTED_NEARBY":
        return [shifted[case_id]["targetSpanId"]]
    ids = trig.get("targetFineSpanIds", "")
    return [x for x in ids.split("|") if x]


def case_outcome(replay: dict[str, dict], target_ids: list[str], eligible: int) -> dict:
    if not target_ids or eligible <= 0:
        return {"retryOnTarget": 0, "eligible": eligible, "fullCoverage": False, "anyRetry": False}
    retry = sum(1 for sid in target_ids if replay.get(sid, {}).get("decision") == "RETRY")
    return {
        "retryOnTarget": retry,
        "eligible": eligible,
        "fullCoverage": retry >= eligible,
        "anyRetry": retry > 0,
        "decisions": {sid: replay.get(sid, {}).get("decision", "MISSING") for sid in target_ids},
    }


def compare_outcome(base: dict, cand: dict) -> str:
    if cand["fullCoverage"] and not base["fullCoverage"]:
        return "improved"
    if base["fullCoverage"] and not cand["fullCoverage"]:
        return "regressed"
    if cand["retryOnTarget"] > base["retryOnTarget"]:
        return "improved"
    if cand["retryOnTarget"] < base["retryOnTarget"]:
        return "regressed"
    return "unchanged"


def evaluate_checkpoint(ckpt: Path, baseline_ckpt: Path | None = None) -> dict:
    trigger = {r["caseId"]: r for r in read_csv(TRIGGER_CSV)}
    partial = read_csv(PARTIAL_CSV)
    shifted = {r["caseId"]: r for r in read_csv(SHIFTED_CSV)}
    by_cp = load_mainline_traces()
    model, vocab = load_bundle(ckpt)
    base_model = None
    base_vocab = None
    if baseline_ckpt is not None:
        base_model, base_vocab = load_bundle(baseline_ckpt)

    rows = []
    subgroup_fixed = {k: 0 for k in ("CLEAR_OOS", "LOCAL_FIT_WEAK", "SURFACE_UNRESOLVED", "UNRESOLVED4")}
    subgroup_total = {k: 0 for k in subgroup_fixed}
    high_fixed = 0
    high_regressed = 0
    unresolved_improved = 0
    unresolved_regressed = 0

    for case_id in LOCALIZATION_16:
        trig = trigger[case_id]
        cls = trig.get("firstFailOwner") or trig.get("failureType") or ""
        path_id = trig["pathId"]
        spans = by_cp.get((case_id, path_id), [])
        if not spans:
            continue
        replay = replay_path(model, vocab, spans)
        target_ids = target_span_ids(case_id, cls, trig, partial, shifted)
        eligible = int(trig.get("targetEligibleCount") or len(target_ids) or 0)
        cand = case_outcome(replay, target_ids, eligible)
        base = {"retryOnTarget": 0, "eligible": eligible, "fullCoverage": False, "anyRetry": False}
        if base_model is not None:
            base_replay = replay_path(base_model, base_vocab, spans)
            base = case_outcome(base_replay, target_ids, eligible)
        delta = compare_outcome(base, cand)
        row = {
            "caseId": case_id,
            "subgroup": (
                "CLEAR_OOS"
                if case_id in CLEAR_OOS
                else "LOCAL_FIT_WEAK"
                if case_id in LOCAL_FIT_WEAK
                else "SURFACE_UNRESOLVED"
                if case_id in SURFACE_UNRESOLVED
                else "UNRESOLVED4"
            ),
            "failureType": cls,
            "baselineRetryOnTarget": base["retryOnTarget"],
            "candidateRetryOnTarget": cand["retryOnTarget"],
            "targetEligible": eligible,
            "baselineFullCoverage": base["fullCoverage"],
            "candidateFullCoverage": cand["fullCoverage"],
            "deltaVsBaseline": delta,
        }
        rows.append(row)
        sg = row["subgroup"]
        subgroup_total[sg] += 1
        if delta == "improved":
            subgroup_fixed[sg] += 1
        if case_id in HIGH12:
            if delta == "improved":
                high_fixed += 1
            elif delta == "regressed":
                high_regressed += 1
        if case_id in UNRESOLVED4:
            if delta == "improved":
                unresolved_improved += 1
            elif delta == "regressed":
                unresolved_regressed += 1

    return {
        "cases": rows,
        "CLEAR_OOS_fixed": subgroup_fixed["CLEAR_OOS"],
        "CLEAR_OOS_total": subgroup_total["CLEAR_OOS"],
        "LOCAL_FIT_WEAK_fixed": subgroup_fixed["LOCAL_FIT_WEAK"],
        "LOCAL_FIT_WEAK_total": subgroup_total["LOCAL_FIT_WEAK"],
        "SURFACE_UNRESOLVED_fixed": subgroup_fixed["SURFACE_UNRESOLVED"],
        "SURFACE_UNRESOLVED_total": subgroup_total["SURFACE_UNRESOLVED"],
        "HIGH12_fixed": high_fixed,
        "HIGH12_regressed": high_regressed,
        "unresolved4_improved": unresolved_improved,
        "unresolved4_regressed": unresolved_regressed,
    }
