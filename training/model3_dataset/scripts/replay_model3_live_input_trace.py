# -*- coding: utf-8 -*-
"""Offline replay of production Model3 inference-input traces (SSOT).

FAIL CLOSED if packed features missing.
Does NOT generate FineSpans / Anchors / cand / pinyin.
"""
from __future__ import annotations

import csv
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    Model3BiGRUV1,
    encode_surface,
)

DOCS = REPO / "docs/user_correction/model3"
TRACE = DOCS / "model3_v2_live_input_trace.jsonl"
RD_CKPT = REPO / "training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903"
EXPECTED_SHA = "fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e"
INV = DOCS / "model3_real_retry_target_inventory.csv"
MARGIN_TOL = 1e-4

PRIORITY = ["d002", "d003", "d019", "d160", "d179", "d181", "d195", "d137"]
ELIG_CLASSES = {
    "ERROR_INSIDE_NON_ANCHOR_FINESPAN",
    "ERROR_REQUIRES_LOCAL_RESEGMENTATION",
}
FEAT_KEYS = [
    "isAnchor",
    "span_len_log1p",
    "span_rel_position",
    "first_pass_cand_log1p",
    "current_cjk_len_log1p",
    "pinyin_channel_avail",
]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


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


def span_payload(row: dict) -> dict:
    """Normalize harness JSONL row → span dict."""
    sp = row.get("span") or row
    # harness nests under span; top-level may also carry identity
    if "features" in sp:
        return sp
    return row


def replay_path(model, vocab, spans: list[dict]) -> list[dict]:
    spans = sorted(
        spans,
        key=lambda s: int(s.get("seqIndex") if s.get("seqIndex") is not None else s.get("seq_index") or 0),
    )
    n = len(spans)
    tokens = torch.zeros(1, n, 8, dtype=torch.long)
    feats = torch.zeros(1, n, FEAT_DIM)
    avail = torch.ones(1, n, FEAT_DIM)
    for i, sp in enumerate(spans):
        # Prefer exact host tensors (SSOT). Fail closed if features absent.
        f = sp.get("features")
        if not isinstance(f, dict) or any(k not in f for k in FEAT_KEYS):
            raise ValueError(f"MISSING_PRODUCTION_TRACE_FIELD:features:{sp.get('spanId')}")

        tok = sp.get("tokenIds") or sp.get("token_ids")
        if isinstance(tok, list) and len(tok) == 8:
            tokens[0, i] = torch.tensor([int(x) for x in tok], dtype=torch.long)
        else:
            surface = sp.get("surfaceUsed") or sp.get("surface_used") or sp.get("surface") or ""
            tokens[0, i] = torch.tensor(encode_surface(surface, vocab), dtype=torch.long)

        fv = sp.get("featVector") or sp.get("feat_vector")
        if isinstance(fv, list) and len(fv) == FEAT_DIM:
            row = [float(x) for x in fv]
        else:
            row = [float(f[k]) for k in FEAT_KEYS]
        feats[0, i] = torch.tensor(row)

        am = sp.get("availMask") or sp.get("avail_mask")
        if isinstance(am, list) and len(am) == FEAT_DIM:
            avail[0, i] = torch.tensor([float(x) for x in am])
        else:
            if row[5] == 0.0:
                avail[0, i, 5] = 0.0
    with torch.no_grad():
        logits = model(tokens, feats, avail)[0]
    out = []
    for i, sp in enumerate(spans):
        keep_l = float(logits[i, 0].item())
        retry_l = float(logits[i, 1].item())
        margin = retry_l - keep_l
        is_anchor = bool(sp.get("isAnchor"))
        if is_anchor:
            decision = "KEEP"
        elif retry_l > keep_l:
            decision = "RETRY"
        else:
            decision = "KEEP"
        out.append(
            {
                "spanId": sp.get("spanId"),
                "surface": sp.get("surface"),
                "surfaceUsed": sp.get("surfaceUsed") or sp.get("surface_used"),
                "keep_logit": keep_l,
                "retry_logit": retry_l,
                "margin": margin,
                "decision": decision,
                "live_margin": sp.get("margin"),
                "live_decision": sp.get("decision"),
                "features": sp.get("features"),
                "rawFirstPassCandidateCount": sp.get("rawFirstPassCandidateCount"),
                "rawPinyinChannelAvail": sp.get("rawPinyinChannelAvail"),
                "isAnchor": is_anchor,
                "rawStart": sp.get("rawStart"),
                "rawEnd": sp.get("rawEnd"),
                "seqIndex": sp.get("seqIndex"),
                "has_exact_tensors": bool(sp.get("tokenIds") or sp.get("token_ids")),
            }
        )
    return out


def attribution(case_rows: list[dict], inv: dict | None) -> str:
    retries = [
        s
        for s in case_rows
        if s.get("live_decision") == "RETRY" and not s.get("isAnchor")
    ]
    if not retries:
        return "NO_RETRY"
    probe = (inv or {}).get("probe_surface") or ""
    surfaces = [s.get("surface") or "" for s in retries]
    if probe and probe in surfaces:
        return "TARGET_REGION_RETRY"
    # coffee wrong-region heuristic: 背 is KEEP while 一杯 region RETRY
    if "背" in [(s.get("surface") or "") for s in case_rows]:
        back = next(s for s in case_rows if s.get("surface") == "背")
        if back.get("live_decision") != "RETRY" and any(
            s in surfaces for s in ("烦", "做", "一", "杯", "热")
        ):
            return "UNRELATED_REGION_RETRY"
    raw = (inv or {}).get("raw") or ""
    exp = (inv or {}).get("expected") or ""
    err_chars = set(raw) - set(exp) if raw and exp else set()
    if err_chars and any(ch in "".join(surfaces) for ch in err_chars):
        return "TARGET_REGION_RETRY"
    if inv and inv.get("audit_class") in ELIG_CLASSES:
        return "UNRELATED_REGION_RETRY"
    return "UNRELATED_REGION_RETRY"


def main():
    actual = sha256_file(RD_CKPT / "weights.pt").lower()
    if actual != EXPECTED_SHA:
        raise SystemExit(f"checkpoint_hash_mismatch:{actual}")

    if not TRACE.exists():
        raise SystemExit(f"missing_trace:{TRACE}")

    rows = []
    missing = 0
    for line in TRACE.open(encoding="utf-8"):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("status") == "MISSING_PRODUCTION_TRACE_FIELD":
            missing += 1
            rows.append(row)
            continue
        if row.get("status") and row.get("status") != "OK":
            missing += 1
            rows.append(row)
            continue
        sp = span_payload(row)
        if not sp.get("features"):
            missing += 1
            rows.append({**row, "status": "MISSING_PRODUCTION_TRACE_FIELD"})
            continue
        rows.append({**row, "span": sp, "status": "OK"})

    if missing:
        print(json.dumps({"parity": "FAIL", "reason": "MISSING_PRODUCTION_TRACE_FIELD", "missing": missing}))
        # continue reporting but mark fail

    model, vocab = load_bundle(RD_CKPT)

    # group by caseId + pathId
    groups: dict[tuple[str, str], list] = defaultdict(list)
    meta: dict[str, dict] = {}
    for r in rows:
        if r.get("status") != "OK":
            continue
        cid = r.get("caseId") or r.get("id")
        pid = r.get("pathId") or "_"
        sp = r["span"]
        groups[(cid, pid)].append(sp)
        meta[cid] = {
            "raw_asr": r.get("raw_asr") or r.get("sourceText"),
            "expected": r.get("expected"),
            "final_class": r.get("final_class"),
            "weightsSha256": r.get("weightsSha256") or actual,
            "modelId": r.get("modelId") or "MODEL3_V2_REALDIST_V1",
        }

    parity_rows = []
    decision_mismatch = 0
    max_margin_delta = 0.0
    spans_tested = 0
    paths_tested = 0

    for (cid, pid), spans in sorted(groups.items()):
        paths_tested += 1
        replayed = replay_path(model, vocab, spans)
        for live_sp, rep in zip(
            sorted(spans, key=lambda s: int(s.get("seqIndex") or 0)), replayed
        ):
            spans_tested += 1
            live_dec = live_sp.get("decision")
            live_m = float(live_sp.get("margin") if live_sp.get("margin") is not None else 0)
            rep_m = float(rep["margin"])
            delta = abs(rep_m - live_m)
            max_margin_delta = max(max_margin_delta, delta)
            dec_ok = live_dec == rep["decision"]
            margin_ok = delta <= MARGIN_TOL
            if not dec_ok:
                decision_mismatch += 1
            parity_rows.append(
                {
                    "case": cid,
                    "pathId": pid,
                    "surface": live_sp.get("surface"),
                    "seqIndex": live_sp.get("seqIndex"),
                    "isAnchor": live_sp.get("isAnchor"),
                    "rawFirstPassCandidateCount": live_sp.get("rawFirstPassCandidateCount"),
                    "first_pass_cand_log1p": (live_sp.get("features") or {}).get(
                        "first_pass_cand_log1p"
                    ),
                    "pinyin_channel_avail": (live_sp.get("features") or {}).get(
                        "pinyin_channel_avail"
                    ),
                    "span_rel_position": (live_sp.get("features") or {}).get("span_rel_position"),
                    "live_margin": live_m,
                    "replay_margin": rep_m,
                    "margin_delta": delta,
                    "live_decision": live_dec,
                    "replay_decision": rep["decision"],
                    "decision_match": int(dec_ok),
                    "margin_match": int(margin_ok),
                    "PASS": "PASS" if dec_ok and margin_ok else "FAIL",
                }
            )

    inv = {}
    with INV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            inv[row["caseId"]] = row

    # 13-case inventory on live decisions (all paths: any RETRY)
    elig = {
        cid
        for cid, r in inv.items()
        if r.get("confidence") in ("HIGH", "MEDIUM") and r.get("audit_class") in ELIG_CLASSES
    }
    inv_rows = []
    attr_counts = Counter()
    for cid in sorted(elig):
        case_spans = []
        for (c, pid), spans in groups.items():
            if c == cid:
                case_spans.extend(spans)
        # also include from parity if needed
        live_retries = [s for s in case_spans if s.get("decision") == "RETRY" and not s.get("isAnchor")]
        attr = attribution(
            [
                {
                    "surface": s.get("surface"),
                    "live_decision": s.get("decision"),
                    "isAnchor": s.get("isAnchor"),
                }
                for s in case_spans
            ],
            inv.get(cid),
        )
        attr_counts[attr] += 1
        inv_rows.append(
            {
                "caseId": cid,
                "source_text": (meta.get(cid) or {}).get("raw_asr"),
                "probe_surface": (inv.get(cid) or {}).get("probe_surface"),
                "retry_surfaces": "|".join(
                    f"{s.get('surface')}:{round(float(s.get('margin') or 0), 3)}"
                    for s in live_retries
                ),
                "attribution": attr,
                "historical_reconstructed_offline": "HISTORICAL_NON_PARITY (was in old 7/13 set)"
                if cid
                in {"d002", "d003", "d019", "d160", "d179", "d181", "d195"}
                else "",
            }
        )

    parity_pass = decision_mismatch == 0 and missing == 0 and max_margin_delta <= MARGIN_TOL

    with (DOCS / "model3_v2_live_replay_parity.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as f:
        fields = list(parity_rows[0].keys()) if parity_rows else ["case"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in parity_rows:
            w.writerow(r)

    with (DOCS / "model3_v2_corrected_inventory13.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as f:
        fields = list(inv_rows[0].keys()) if inv_rows else ["caseId"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in inv_rows:
            w.writerow(r)

    # Priority surface dumps for d002/d160
    focus = {}
    for cid in ("d002", "d160", "d137"):
        want = {
            "d002": ["背", "烦", "做", "一", "杯"],
            "d160": ["顺", "便", "向", "木", "李"],
            "d137": ["背", "烦", "一", "杯", "热"],
        }[cid]
        focus[cid] = [
            r
            for r in parity_rows
            if r["case"] == cid and r["surface"] in want
        ]

    summary = {
        "phase": "MODEL3_V2_OFFLINE_EVAL_PIPELINE_CORRECTION",
        "checkpoint": {
            "modelId": "MODEL3_V2_REALDIST_V1",
            "sha": actual,
            "verified": True,
        },
        "evaluationPipelineCorrection": "PASS" if parity_pass else "FAIL",
        "productionInputTraceSSOT": "ESTABLISHED" if missing == 0 else "NOT_ESTABLISHED",
        "offlineReplayParity": "PASS" if parity_pass else "FAIL",
        "correctedRealDistEvaluationTrustworthy": parity_pass,
        "parity": {
            "paths_tested": paths_tested,
            "spans_tested": spans_tested,
            "decision_mismatches": decision_mismatch,
            "max_margin_delta": max_margin_delta,
            "tolerance": MARGIN_TOL,
            "missing_trace_fields": missing,
        },
        "oldEvalDrift": {
            "historicalFineSpanDependency": "REMOVED_FROM_PARITY_EVAL",
            "cand_default_0": "REMOVED",
            "pinyin_default_True": "REMOVED",
            "primary_path_only": "REMOVED",
            "historicalDumpRole": "HISTORICAL_NON_PARITY_INPUT",
        },
        "inventory13": {
            "historical_reconstructed_offline": "7/13 HISTORICAL_NON_PARITY",
            "attribution": dict(attr_counts),
            "TARGET": attr_counts.get("TARGET_REGION_RETRY", 0),
            "ADJACENT": attr_counts.get("ADJACENT_VALID_REGION_RETRY", 0),
            "UNRELATED": attr_counts.get("UNRELATED_REGION_RETRY", 0),
            "NO_RETRY": attr_counts.get("NO_RETRY", 0),
        },
        "focusTraces": focus,
        "recommendedNextPhase": (
            "MODEL3_V2_LIVE_FEATURE_DISTRIBUTION_AUDIT"
            if parity_pass
            else (
                "MODEL3_V2_TRACE_CONTRACT_CORRECTION"
                if missing
                else "MODEL3_V2_INFERENCE_REPLAY_PARITY_CORRECTION"
            )
        ),
        "featureCapacityAuditAuthorized": False,
    }
    (DOCS / "model3_v2_eval_pipeline_correction_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: summary[k] for k in (
        "evaluationPipelineCorrection",
        "offlineReplayParity",
        "productionInputTraceSSOT",
        "parity",
        "inventory13",
        "recommendedNextPhase",
    )}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
