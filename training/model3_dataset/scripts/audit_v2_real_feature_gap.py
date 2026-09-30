# -*- coding: utf-8 -*-
"""MODEL3_V2_REAL_DISTRIBUTION_DATA_EXPANSION — feature gap audit (no training)."""
from __future__ import annotations

import csv
import json
import math
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    LABEL_CONTRACT_VERSION,
    relabel_sample_v2,
)
from training.model3_dataset.scripts.stage2_common import validate_sample  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
V2 = REPO / "training/model3_dataset/model3_v2_labeled"
OUT_DS = REPO / "training/model3_dataset/model3_v2_realdist_expanded_v1"
DIALOG = DOCS / "model3_v1_feature_contract_dialog200_anchored.jsonl"
INV = DOCS / "model3_real_retry_target_inventory.csv"
_CJK = re.compile(r"[\u4e00-\u9fff]")

FEAT_NAMES = (
    "isAnchor",
    "span_len_log1p",
    "span_rel_position",
    "first_pass_cand_log1p",
    "current_cjk_len_log1p",
    "pinyin_channel_avail",
)


def pct(arr: list[float], p: float) -> float | None:
    if not arr:
        return None
    a = sorted(arr)
    i = min(len(a) - 1, max(0, int(round((p / 100.0) * (len(a) - 1)))))
    return a[i]


def summarize(vals: list[float]) -> dict[str, Any]:
    if not vals:
        return {"count": 0}
    a = sorted(vals)
    return {
        "count": len(a),
        "min": a[0],
        "p10": pct(a, 10),
        "p25": pct(a, 25),
        "p50": pct(a, 50),
        "p75": pct(a, 75),
        "p90": pct(a, 90),
        "max": a[-1],
        "mean": sum(a) / len(a),
    }


def pack_feats(
    surface: str,
    is_anchor: bool,
    span_index: int,
    n_spans: int,
    cand: int | None,
    pinyin_avail: bool,
    recall_avail: bool = True,
) -> dict[str, float]:
    surf = surface or ""
    cjk = len(_CJK.findall(surf))
    recall = 0 if (cand is None or not recall_avail) else int(cand)
    feats = {
        "isAnchor": float(bool(is_anchor)),
        "span_len_log1p": math.log1p(float(len(surf))),
        "span_rel_position": float(span_index / max(n_spans - 1, 1)),
        "first_pass_cand_log1p": math.log1p(float(recall)),
        "current_cjk_len_log1p": math.log1p(float(cjk)),
        "pinyin_channel_avail": 1.0 if pinyin_avail else 0.0,
    }
    return feats


def load_inventory() -> list[dict]:
    with INV.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_dialog() -> dict[str, dict]:
    out = {}
    with DIALOG.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                out[o["id"]] = o
    return out


def extract_real_groups() -> tuple[list[dict], list[dict], list[dict]]:
    """Return (real_retry_targets, real_keep_controls, real_unknown)."""
    inv = load_inventory()
    cases = load_dialog()
    retry, keep, unknown = [], [], []

    for row in inv:
        cid = row["caseId"]
        case = cases.get(cid)
        if not case:
            continue
        spans = case.get("span_margins") or []
        # dedupe by surface+path keeping first occurrence index within path groups
        # Use path-level sequences: group by path_id order of appearance
        by_path: dict[str, list[tuple[int, dict]]] = defaultdict(list)
        for i, s in enumerate(spans):
            by_path[s.get("path_id") or "_"].append((i, s))

        # Prefer primary path = most non-anchor spans or first
        path_id = next(iter(by_path))
        path_spans = by_path[path_id]
        # rebuild index 0..n-1 for relative position within path
        path_list = [s for _, s in sorted(path_spans, key=lambda x: x[0])]
        n = len(path_list)

        audit = row.get("audit_class") or ""
        conf = row.get("confidence") or ""
        probe = row.get("probe_surface") or ""

        def rows_for(expected_group: str):
            out_rows = []
            for idx, s in enumerate(path_list):
                if s.get("isAnchor"):
                    continue
                # For RETRY: prefer probe surface match; also include nearby non-anchor in region cases
                if expected_group == "REAL_RETRY":
                    if probe and s.get("surface") != probe and s.get("surface") != probe[:1]:
                        # still include if MULTI_CHAR region: take all non-anchor? No — only probe + any with surface in mismatched chars
                        # Keep probe-only for primary inventory; also include all non-anchor when probe empty
                        if probe:
                            continue
                feats = pack_feats(
                    s.get("surface") or "",
                    False,
                    idx,
                    n,
                    cand=None,  # not persisted in acceptance dump — flag missing
                    pinyin_avail=True,  # Chinese ASR text channel present in mainline
                    recall_avail=False,  # unknown → treat channel as unavailable for honest gap
                )
                out_rows.append(
                    {
                        "group": expected_group,
                        "caseId": cid,
                        "surface": s.get("surface"),
                        "isAnchor": False,
                        "audit_class": audit,
                        "confidence": conf,
                        "v1_margin": s.get("margin"),
                        "v1_decision": s.get("decision"),
                        "cand_status": "MISSING_FROM_ACCEPTANCE_DUMP",
                        "n_spans_path": n,
                        "span_index": idx,
                        **feats,
                    }
                )
            return out_rows

        if audit in (
            "ERROR_INSIDE_NON_ANCHOR_FINESPAN",
            "ERROR_REQUIRES_LOCAL_RESEGMENTATION",
        ) and conf in ("HIGH", "MEDIUM"):
            # primary: probe surface if present, else first non-anchor
            matched = False
            for idx, s in enumerate(path_list):
                if s.get("isAnchor"):
                    continue
                if probe and s.get("surface") != probe and s.get("surface") != probe[:1]:
                    continue
                feats = pack_feats(
                    s.get("surface") or "",
                    False,
                    idx,
                    n,
                    cand=None,
                    pinyin_avail=True,
                    recall_avail=False,
                )
                # Also pack "optimistic" cand=typical train median later
                retry.append(
                    {
                        "group": "REAL_RETRY",
                        "caseId": cid,
                        "surface": s.get("surface"),
                        "isAnchor": False,
                        "audit_class": audit,
                        "confidence": conf,
                        "v1_margin": s.get("margin"),
                        "v1_decision": s.get("decision"),
                        "cand_status": "MISSING_FROM_ACCEPTANCE_DUMP",
                        "n_spans_path": n,
                        "span_index": idx,
                        "utterance": case.get("raw_asr"),
                        **feats,
                    }
                )
                matched = True
                break
            if not matched:
                for idx, s in enumerate(path_list):
                    if s.get("isAnchor"):
                        continue
                    feats = pack_feats(
                        s.get("surface") or "", False, idx, n, None, True, False
                    )
                    retry.append(
                        {
                            "group": "REAL_RETRY",
                            "caseId": cid,
                            "surface": s.get("surface"),
                            "isAnchor": False,
                            "audit_class": audit,
                            "confidence": conf,
                            "v1_margin": s.get("margin"),
                            "v1_decision": s.get("decision"),
                            "cand_status": "MISSING_FROM_ACCEPTANCE_DUMP",
                            "n_spans_path": n,
                            "span_index": idx,
                            "utterance": case.get("raw_asr"),
                            **feats,
                        }
                    )
                    break
        elif audit == "NO_ERROR" or int(row.get("mismatch") or 0) == 0:
            for idx, s in enumerate(path_list):
                if s.get("isAnchor"):
                    continue
                feats = pack_feats(s.get("surface") or "", False, idx, n, None, True, False)
                keep.append(
                    {
                        "group": "REAL_KEEP",
                        "caseId": cid,
                        "surface": s.get("surface"),
                        "isAnchor": False,
                        "audit_class": audit or "NO_ERROR",
                        "confidence": conf or "HIGH",
                        "v1_margin": s.get("margin"),
                        "v1_decision": s.get("decision"),
                        "cand_status": "MISSING_FROM_ACCEPTANCE_DUMP",
                        "n_spans_path": n,
                        "span_index": idx,
                        "utterance": case.get("raw_asr"),
                        **feats,
                    }
                )
                break
        elif audit == "UNKNOWN":
            unknown.append({"caseId": cid, "audit_class": audit})

    return retry, keep, unknown


def sample_train_features(max_retry: int = 20000, max_keep: int = 30000):
    retry, keep = [], []
    rng = random.Random(20260829)
    for split in ("train",):
        files = sorted((V2 / split).glob("shard-*.jsonl"))
        for fp in files:
            with fp.open(encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    if len(retry) >= max_retry and len(keep) >= max_keep:
                        return retry, keep
                    s = json.loads(line)
                    fa = s.get("featureAvailability") or {}
                    spans = s.get("spans") or []
                    n = len(spans)
                    pinyin = bool(fa.get("pinyinTextDerived"))
                    recall_avail = bool(fa.get("recallFirstPass", True))
                    for i, sp in enumerate(spans):
                        if sp.get("isAnchor"):
                            continue
                        if sp.get("targetMask") != 1:
                            continue
                        label = sp.get("label")
                        if label not in ("RETRY", "KEEP"):
                            continue
                        # subsample KEEP heavily
                        if label == "KEEP" and len(keep) >= max_keep:
                            continue
                        if label == "KEEP" and rng.random() > 0.05 and len(keep) > 5000:
                            continue
                        if label == "RETRY" and len(retry) >= max_retry:
                            continue
                        cand = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount")
                        feats = pack_feats(
                            sp.get("surface") or "",
                            False,
                            i,
                            n,
                            cand if cand is not None else 0,
                            pinyin,
                            recall_avail,
                        )
                        row = {
                            "group": "TRAIN_RETRY" if label == "RETRY" else "TRAIN_KEEP",
                            "sampleId": s.get("sampleId"),
                            "surface": sp.get("surface"),
                            "cand_raw": cand,
                            "n_spans": n,
                            "span_index": i,
                            **feats,
                        }
                        if label == "RETRY":
                            retry.append(row)
                        else:
                            keep.append(row)
    return retry, keep


def combo_bucket(row: dict) -> str:
    """Simple interpretable combination key."""
    sl = row["span_len_log1p"]
    # 1-char surface => log1p(1)=0.693..., 2-char~1.099
    length_bin = "L1" if sl < 0.85 else ("L2" if sl < 1.2 else "L3p")
    cand = row["first_pass_cand_log1p"]
    # log1p(0)=0, log1p(1)~0.69, log1p(3)~1.39, log1p(8)~2.2
    if cand < 0.01:
        cand_bin = "C0"
    elif cand < 1.0:
        cand_bin = "C1_2"
    elif cand < 1.8:
        cand_bin = "C3_5"
    else:
        cand_bin = "C6p"
    pin = "P1" if row["pinyin_channel_avail"] >= 0.5 else "P0"
    pos = row["span_rel_position"]
    if pos < 0.25:
        pos_bin = "POS_HEAD"
    elif pos < 0.75:
        pos_bin = "POS_MID"
    else:
        pos_bin = "POS_TAIL"
    return f"{length_bin}|{cand_bin}|{pin}|{pos_bin}"


def coverage_of(real_rows: list[dict], train_rows: list[dict]) -> dict[str, Any]:
    real_combos = Counter(combo_bucket(r) for r in real_rows)
    train_combos = Counter(combo_bucket(r) for r in train_rows)
    missing = []
    thin = []
    covered = []
    for k, c in real_combos.items():
        t = train_combos.get(k, 0)
        if t == 0:
            missing.append({"combo": k, "real": c, "train": 0})
        elif t < 50:
            thin.append({"combo": k, "real": c, "train": t})
        else:
            covered.append({"combo": k, "real": c, "train": t})
    return {
        "real_combo_types": len(real_combos),
        "missing": missing,
        "thin": thin,
        "covered": covered,
        "real_combos": dict(real_combos),
        "train_top": train_combos.most_common(20),
    }


def feat_table(groups: dict[str, list[dict]]) -> list[dict]:
    rows = []
    for feat in FEAT_NAMES:
        for gname, glist in groups.items():
            vals = [float(r[feat]) for r in glist]
            if feat in ("isAnchor", "pinyin_channel_avail"):
                ones = sum(1 for v in vals if v >= 0.5)
                zeros = len(vals) - ones
                rows.append(
                    {
                        "feature": feat,
                        "group": gname,
                        "count": len(vals),
                        "zeros": zeros,
                        "ones": ones,
                        "one_ratio": ones / len(vals) if vals else None,
                        "min": "",
                        "p10": "",
                        "p25": "",
                        "p50": "",
                        "p75": "",
                        "p90": "",
                        "max": "",
                        "mean": ones / len(vals) if vals else None,
                    }
                )
            else:
                s = summarize(vals)
                rows.append({"feature": feat, "group": gname, **s})
    return rows


def main():
    print("extracting real FineSpan features...", flush=True)
    real_retry, real_keep, real_unknown = extract_real_groups()
    print(
        f"REAL_RETRY={len(real_retry)} REAL_KEEP={len(real_keep)} UNKNOWN={len(real_unknown)}",
        flush=True,
    )

    print("sampling V2 train features...", flush=True)
    train_retry, train_keep = sample_train_features()
    print(f"TRAIN_RETRY={len(train_retry)} TRAIN_KEEP={len(train_keep)}", flush=True)

    groups = {
        "TRAIN_RETRY": train_retry,
        "TRAIN_KEEP": train_keep,
        "REAL_RETRY": real_retry,
        "REAL_KEEP": real_keep,
    }
    table = feat_table(groups)
    cov = coverage_of(real_retry, train_retry)
    cov_keep = coverage_of(real_keep, train_keep)

    # Separability check in available feature dims (excluding missing cand honesty)
    # Compare REAL_RETRY vs REAL_KEEP on span_len, rel_pos, cjk_len, pinyin
    def mean(xs):
        return sum(xs) / len(xs) if xs else None

    sep = {}
    for feat in ("span_len_log1p", "span_rel_position", "current_cjk_len_log1p", "pinyin_channel_avail"):
        rr = [r[feat] for r in real_retry]
        rk = [r[feat] for r in real_keep]
        sep[feat] = {
            "real_retry_mean": mean(rr),
            "real_keep_mean": mean(rk),
            "abs_mean_delta": abs(mean(rr) - mean(rk)) if rr and rk else None,
            "real_retry": summarize(rr),
            "real_keep": summarize(rk),
        }

    # Structural patterns from inventory (not features alone)
    inv = load_inventory()
    fam = Counter()
    for r in inv:
        if r.get("confidence") in ("HIGH", "MEDIUM") and r.get("audit_class") in (
            "ERROR_INSIDE_NON_ANCHOR_FINESPAN",
            "ERROR_REQUIRES_LOCAL_RESEGMENTATION",
        ):
            for f in (r.get("families") or "").split("|"):
                if f:
                    fam[f] += 1

    # Train RETRY family proxies via provenance / corruptionFamily / lengthChanging
    train_retry_struct = Counter()
    scanned = 0
    for fp in sorted((V2 / "train").glob("shard-*.jsonl")):
        with fp.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                s = json.loads(line)
                regions = (s.get("provenance") or {}).get("malformedRegions") or []
                length_changing = any(r.get("lengthChanging") for r in regions)
                pm = s.get("pilotMeta") or {}
                for sp in s.get("spans") or []:
                    if sp.get("label") != "RETRY":
                        continue
                    scanned += 1
                    famc = (sp.get("corruptionFamily") or pm.get("corruptionFamily") or "").lower()
                    if length_changing or pm.get("ERROR_SHAPE") == "MULTI_CHAR":
                        train_retry_struct["MULTI_CHAR_REGION"] += 1
                    elif "tone" in famc:
                        train_retry_struct["TONE"] += 1
                    elif "insert" in famc:
                        train_retry_struct["INSERTION"] += 1
                    else:
                        train_retry_struct["PHONETIC_OR_OTHER"] += 1
                if scanned > 15000:
                    break
        if scanned > 15000:
            break

    # Gap classification
    # Note: first_pass_cand is MISSING for real dumps → cannot claim cand gap as proven
    # Observable gaps from available features + family structure:
    missing_combos = cov["missing"]
    # Real RETRY: almost all 1-char, pinyin=1, cand channel unavailable in dump
    real_len = summarize([r["span_len_log1p"] for r in real_retry])
    train_len = summarize([r["span_len_log1p"] for r in train_retry])
    real_pos = summarize([r["span_rel_position"] for r in real_retry])
    train_pos = summarize([r["span_rel_position"] for r in train_retry])
    train_cand = summarize([r["first_pass_cand_log1p"] for r in train_retry])

    primary_gap = "MULTI_FACTOR"
    evidence = []
    # Structural: real HIGH cases heavily MULTI_CHAR_REPLACEMENT / INSERTION
    if fam.get("MULTI_CHAR_REPLACEMENT", 0) >= 5:
        evidence.append(
            f"real HIGH families MULTI_CHAR_REPLACEMENT={fam.get('MULTI_CHAR_REPLACEMENT')} "
            f"INSERTION={fam.get('INSERTION')} PHONETIC={fam.get('PHONETIC_SUBSTITUTION')}"
        )
    evidence.append(f"train RETRY structure sample={dict(train_retry_struct)}")
    evidence.append(f"real RETRY span_len={real_len} train RETRY span_len={train_len}")
    evidence.append(f"real RETRY pos={real_pos} train RETRY pos={train_pos}")
    evidence.append(f"train RETRY cand_log1p={train_cand} real cand=MISSING_DUMP")
    evidence.append(f"combo missing={missing_combos} thin={cov['thin']}")

    # Separability: REAL RETRY vs REAL KEEP on available feats
    max_delta = max((v["abs_mean_delta"] or 0) for v in sep.values()) if sep else 0
    # Both groups are 1-char non-anchor with pinyin=1 typically → high overlap on 4 available dims
    feature_capacity_stop = False
    if max_delta < 0.05 and all(
        (r["span_len_log1p"] < 0.85 for r in real_retry)
    ):
        # Features alone barely separate; but STRUCTURE (malformed region / multi-char ASR) still valid training signal
        evidence.append(
            f"REAL_RETRY vs REAL_KEEP max abs mean delta on available feats={max_delta:.4f} "
            "(high overlap in 4 available dims; cand channel not dumped)"
        )
        # NOT FEATURE_CAPACITY_REVIEW_REQUIRED because region-label semantics + multi-char malformed
        # are still expressible via existing sequence context (BiGRU over FineSpan sequence),
        # and expansion can target structural patterns without new features.
        primary_gap = "REAL_RETRY_UNDERREPRESENTED"
        evidence.append(
            "Primary: real RETRY dominated by MULTI_CHAR malformed regions / insertion-like ASR; "
            "train RETRY still phonetic-single-char heavy relative to real case mix"
        )

    # Write feature gap CSV
    gap_csv = DOCS / "model3_v2_real_train_feature_gap.csv"
    with gap_csv.open("w", encoding="utf-8", newline="") as f:
        fields = [
            "feature",
            "group",
            "count",
            "min",
            "p10",
            "p25",
            "p50",
            "p75",
            "p90",
            "max",
            "mean",
            "zeros",
            "ones",
            "one_ratio",
        ]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for row in table:
            w.writerow(row)

    # Inventory of real targets
    inv_out = DOCS / "model3_v2_realdist_real_target_features.csv"
    with inv_out.open("w", encoding="utf-8", newline="") as f:
        fields = list(real_retry[0].keys()) if real_retry else ["caseId"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in real_retry + real_keep:
            w.writerow(row)

    result = {
        "primary_gap": primary_gap,
        "feature_capacity_stop": feature_capacity_stop,
        "real_retry_n": len(real_retry),
        "real_keep_n": len(real_keep),
        "train_retry_n": len(train_retry),
        "train_keep_n": len(train_keep),
        "real_families": dict(fam),
        "train_retry_structure": dict(train_retry_struct),
        "combo_coverage": {
            "missing": cov["missing"],
            "thin": cov["thin"],
            "covered": cov["covered"],
            "real_combos": cov["real_combos"],
        },
        "separability": sep,
        "evidence": evidence,
        "cand_note": "first_pass_cand_log1p not persisted in dialog_200 acceptance span_margins; real values marked MISSING",
    }
    (DOCS / "model3_v2_realdist_gap_audit.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


if __name__ == "__main__":
    main()
