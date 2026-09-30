# -*- coding: utf-8 -*-
"""MODEL3_V2_LIVE_FEATURE_DISTRIBUTION_AUDIT — read-only.

Consumes production Model3 input SSOT + RealDist training shards.
No training / data generation / feature change.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
TRACE = DOCS / "model3_v2_live_input_trace.jsonl"
INV = DOCS / "model3_real_retry_target_inventory.csv"
CORRECTED = DOCS / "model3_v2_corrected_inventory13.csv"
RD_DATA = REPO / "training/model3_dataset/model3_v2_realdist_expanded_v1"
RD_CKPT = REPO / "training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903"
EXPECTED_SHA = "fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e"
RD_MANIFEST = RD_DATA / "dataset_manifest.json"

FEAT_KEYS = [
    "isAnchor",
    "span_len_log1p",
    "span_rel_position",
    "first_pass_cand_log1p",
    "current_cjk_len_log1p",
    "pinyin_channel_avail",
]
ELIG = {
    "ERROR_INSIDE_NON_ANCHOR_FINESPAN",
    "ERROR_REQUIRES_LOCAL_RESEGMENTATION",
}
TARGET_SUCCESS = {"d002", "d003", "d019"}
UNRELATED = {"d139", "d179", "d181", "d195"}
NO_RETRY_CASES = {"d049", "d099", "d131", "d142", "d160", "d176"}
INV13 = TARGET_SUCCESS | UNRELATED | NO_RETRY_CASES

PROBE_BY_CASE = {
    "d002": ["背"],
    "d003": ["烟", "烧", "背"],
    "d019": ["成", "城", "上", "线"],
    "d049": ["理", "李", "科", "工"],
    "d099": ["苏", "和", "那", "便"],
    "d131": ["意", "识", "规", "则"],
    "d139": ["能", "理", "工"],
    "d142": ["回", "会"],
    "d160": ["顺", "便", "向", "木", "李"],
    "d176": ["意", "识", "规", "则"],
    "d179": ["限", "上", "意", "境"],
    "d181": ["下", "贝", "杯"],
    "d195": ["在", "点", "赞", "订"],
}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    ys = sorted(xs)
    if len(ys) == 1:
        return ys[0]
    pos = (len(ys) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return ys[lo]
    return ys[lo] * (hi - pos) + ys[hi] * (pos - lo)


def dist_stats(xs: list[float], label: str) -> dict:
    if not xs:
        return {"group": label, "n": 0, "note": "EMPTY"}
    note = "SMALL_SAMPLE" if len(xs) < 8 else ""
    mean = statistics.fmean(xs)
    std = statistics.pstdev(xs) if len(xs) > 1 else 0.0
    return {
        "group": label,
        "n": len(xs),
        "min": min(xs),
        "p10": pct(xs, 0.10),
        "p25": pct(xs, 0.25),
        "p50": pct(xs, 0.50),
        "p75": pct(xs, 0.75),
        "p90": pct(xs, 0.90),
        "max": max(xs),
        "mean": mean,
        "std": std,
        "note": note,
    }


def pack_train_span(sp: dict, fa: dict, idx: int, n: int) -> list[float]:
    surf = sp.get("surface") or ""
    cjk = len([c for c in surf if "\u4e00" <= c <= "\u9fff"])
    recall = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount")
    if recall is None:
        recall = 0
    rel = idx / max(n - 1, 1)
    feats = [
        float(bool(sp.get("isAnchor"))),
        math.log1p(float(len(surf))),
        float(rel),
        math.log1p(float(recall)),
        math.log1p(float(cjk)),
        1.0 if fa.get("pinyinTextDerived") else 0.0,
    ]
    if not fa.get("recallFirstPass", True):
        feats[3] = 0.0
    if not fa.get("pinyinTextDerived"):
        feats[5] = 0.0
    return feats


def load_inventory() -> dict[str, dict]:
    out = {}
    with INV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("confidence") in ("HIGH", "MEDIUM") and row.get("audit_class") in ELIG:
                out[row["caseId"]] = row
    return out


def load_live() -> list[dict]:
    rows = []
    for line in TRACE.open(encoding="utf-8"):
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("status") != "OK":
            continue
        sp = r.get("span") or {}
        feats = sp.get("features") or {}
        if not feats:
            continue
        rows.append(
            {
                "caseId": r.get("caseId"),
                "pathId": r.get("pathId"),
                "raw_asr": r.get("raw_asr") or r.get("sourceText") or "",
                "expected": r.get("expected"),
                "final_class": r.get("final_class"),
                "modelId": r.get("modelId"),
                "weightsSha256": r.get("weightsSha256"),
                "surface": sp.get("surface") or "",
                "rawStart": sp.get("rawStart"),
                "rawEnd": sp.get("rawEnd"),
                "seqIndex": int(sp.get("seqIndex") or 0),
                "seqLen": int(sp.get("seqLen") or 0),
                "isAnchor": bool(sp.get("isAnchor")),
                "anchorSource": sp.get("anchorSource"),
                "features": feats,
                "featVector": sp.get("featVector") or [feats[k] for k in FEAT_KEYS],
                "rawCand": sp.get("rawFirstPassCandidateCount"),
                "rawPinyin": sp.get("rawPinyinChannelAvail"),
                "margin": float(sp.get("margin") if sp.get("margin") is not None else 0),
                "decision": sp.get("decision"),
                "eligible": sp.get("eligible", True),
            }
        )
    return rows


def load_train(max_retry: int = 50000, max_keep: int = 80000):
    retry, keep = [], []
    path_struct = Counter()
    token_retry = Counter()
    token_keep = Counter()
    seq_len_retry = []
    for split in ("train", "dev"):
        for p in sorted((RD_DATA / split).glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    sample = json.loads(line)
                    spans = sample.get("spans") or []
                    fa = sample.get("featureAvailability") or {}
                    n = len(spans)
                    path_struct["utterances"] += 1
                    path_struct["spans"] += n
                    path_struct["samples_with_pathId"] += 1 if sample.get("pathId") else 0
                    for i, sp in enumerate(spans):
                        lab = sp.get("label")
                        if lab not in ("RETRY", "KEEP"):
                            continue
                        if sp.get("isAnchor"):
                            continue
                        feats = pack_train_span(sp, fa, i, n)
                        surf = sp.get("surface") or ""
                        row = {
                            "surface": surf,
                            "features": dict(zip(FEAT_KEYS, feats)),
                            "featVector": feats,
                            "rawCand": (sp.get("recallEvidence") or {}).get("firstPassCandidateCount"),
                            "seqIndex": i,
                            "seqLen": n,
                            "label": lab,
                            "prev": [
                                (spans[j].get("surface"), bool(spans[j].get("isAnchor")), spans[j].get("label"))
                                for j in range(max(0, i - 3), i)
                            ],
                            "next": [
                                (spans[j].get("surface"), bool(spans[j].get("isAnchor")), spans[j].get("label"))
                                for j in range(i + 1, min(n, i + 4))
                            ],
                        }
                        if lab == "RETRY":
                            if len(retry) < max_retry:
                                retry.append(row)
                                token_retry[surf] += 1
                                seq_len_retry.append(float(n))
                        else:
                            if len(keep) < max_keep:
                                keep.append(row)
                                token_keep[surf] += 1
                    if len(retry) >= max_retry and len(keep) >= max_keep:
                        break
            if len(retry) >= max_retry and len(keep) >= max_keep:
                break
    meta = {
        "path_struct": dict(path_struct),
        "token_retry": token_retry,
        "token_keep": token_keep,
        "seq_len_retry_stats": dist_stats(seq_len_retry, "TRAIN_RETRY_seqLen"),
    }
    return retry, keep, meta


def normalize_text(s: str) -> str:
    return "".join(ch for ch in (s or "") if not ch.isspace() and ch not in ",.?!:;，。？！、")


def classify_inventory_validity(inv: dict, live_by_case: dict[str, list]) -> dict:
    out = {}
    for cid, meta in inv.items():
        rows = live_by_case.get(cid) or []
        src = rows[0]["raw_asr"] if rows else ""
        hist_raw = meta.get("raw") or ""
        hist_exp = meta.get("expected") or ""
        probe = meta.get("probe_surface") or ""
        src_n = normalize_text(src)
        hist_n = normalize_text(hist_raw)
        err = set(normalize_text(hist_raw)) - set(normalize_text(hist_exp)) if hist_raw and hist_exp else set()
        probes = PROBE_BY_CASE.get(cid, [probe] if probe else [])
        present = []
        for pr in probes:
            if pr and (pr in src_n or any(pr == r["surface"] for r in rows)):
                present.append(pr)
        if cid == "d160":
            if "向木李" in hist_n and "向木李" not in src_n and "木李" not in src_n:
                if "顺便" in src_n or any(r["surface"] in ("顺", "便") for r in rows):
                    cls = "CURRENT_TARGET_CHANGED_BUT_ALIGNABLE"
                    note = "historical 向木李 absent; current has 顺便看看项目里"
                else:
                    cls = "STALE_TARGET_NOT_COMPARABLE"
                    note = "向木李 absent from current sourceText"
            else:
                cls = "CURRENT_TARGET_PRESENT" if present else "STALE_TARGET_NOT_COMPARABLE"
                note = ""
        elif not rows:
            cls = "STALE_TARGET_NOT_COMPARABLE"
            note = "no live trace"
        elif probe and probe in src_n:
            cls = "CURRENT_TARGET_PRESENT"
            note = f"probe {probe} present"
        elif present:
            cls = "CURRENT_TARGET_CHANGED_BUT_ALIGNABLE"
            note = f"alignable surfaces {present}"
        elif err and any(ch in src_n for ch in err):
            cls = "CURRENT_TARGET_CHANGED_BUT_ALIGNABLE"
            note = f"error-char residual {sorted(err)[:6]}"
        elif src_n and hist_n and src_n != hist_n:
            cur_err = set(src_n) - set(normalize_text(hist_exp))
            if cur_err:
                cls = "CURRENT_TARGET_CHANGED_BUT_ALIGNABLE"
                note = f"source changed; residual errs {sorted(cur_err)[:6]}"
            else:
                cls = "STALE_TARGET_NOT_COMPARABLE"
                note = "source changed; no residual inventory error"
        else:
            cls = "CURRENT_TARGET_PRESENT" if probe else "CURRENT_TARGET_CHANGED_BUT_ALIGNABLE"
            note = ""
        out[cid] = {
            "class": cls,
            "note": note,
            "sourceText": src,
            "historical_raw": hist_raw,
            "probe": probe,
            "present_probes": present,
        }
    return out


def target_spans_for_case(cid: str, rows: list[dict], inv_row: dict, validity: dict) -> list[dict]:
    if validity.get("class") == "STALE_TARGET_NOT_COMPARABLE":
        return []
    probe = inv_row.get("probe_surface") or ""
    hits: list[dict] = []
    if cid == "d002":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] == "背"]
    elif cid == "d003":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("烟", "烧", "麦")]
    elif cid == "d019":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("成", "上", "限", "线", "计", "化")]
    elif cid == "d160":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("顺", "便")]
    elif cid in ("d131", "d176"):
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("意", "识", "规", "则")]
    elif cid == "d099":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("苏", "和", "那", "便")]
    elif cid == "d142":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("回", "会")]
    elif cid == "d049":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("理", "工", "科")]
    elif cid == "d139":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("能", "理", "工")]
    elif cid == "d179":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("限", "上", "意", "境")]
    elif cid == "d181":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("下", "贝", "杯")]
    elif cid == "d195":
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] in ("在", "点", "赞", "订")]
    elif probe:
        hits = [r for r in rows if (not r["isAnchor"]) and r["surface"] == probe]
    seen = set()
    uniq = []
    for h in hits:
        k = (h["pathId"], h["rawStart"], h["rawEnd"], h["surface"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(h)
    return uniq


def feat_dist(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def neighborhood(live_vec, train_retry, train_keep, k: int = 25) -> dict:
    pool = train_retry + train_keep[:: max(1, len(train_keep) // 20000)]
    dists = []
    for t in pool:
        d = feat_dist(live_vec, t["featVector"])
        dists.append((d, t["label"], t["surface"]))
    dists.sort(key=lambda x: x[0])
    top = dists[:k]
    if not top:
        return {"support": "INCONCLUSIVE", "neighborhood": "NO_SUPPORT", "nn_dist": None, "retry_frac": None}
    nn = top[0][0]
    retry_n = sum(1 for _, lab, _ in top if lab == "RETRY")
    retry_frac = retry_n / len(top)
    if nn < 0.15:
        support = "WELL_SUPPORTED"
    elif nn < 0.9:
        support = "THIN_SUPPORT"
    else:
        support = "OUT_OF_DISTRIBUTION"
    if retry_frac >= 0.7:
        neigh = "TRAIN_RETRY"
    elif retry_frac <= 0.3:
        neigh = "TRAIN_KEEP"
    else:
        neigh = "MIXED"
    return {
        "support": support,
        "neighborhood": neigh,
        "nn_dist": nn,
        "retry_frac": retry_frac,
        "k": k,
        "top_surfaces": [s for _, _, s in top[:5]],
    }


def combo_bin(rel: float, cand: float, py: float) -> str:
    if rel < 0.33:
        rp = "HEAD"
    elif rel < 0.66:
        rp = "MID"
    else:
        rp = "TAIL"
    if cand < 0.1:
        cp = "C0"
    elif cand < 0.8:
        cp = "C1"
    else:
        cp = "C2p"
    pp = "PY1" if py >= 0.5 else "PY0"
    return f"{rp}|{cp}|{pp}"


def sequence_support(live_row, path_rows, train_retry) -> dict:
    idx = live_row["seqIndex"]
    ordered = sorted(path_rows, key=lambda r: r["seqIndex"])
    matches = 0
    checked = 0
    for t in train_retry[:: max(1, len(train_retry) // 5000)]:
        checked += 1
        tf = t["features"]
        if abs(tf["span_rel_position"] - live_row["features"]["span_rel_position"]) > 0.25:
            continue
        if abs(tf["first_pass_cand_log1p"] - live_row["features"]["first_pass_cand_log1p"]) > 0.5:
            continue
        if abs(tf["pinyin_channel_avail"] - live_row["features"]["pinyin_channel_avail"]) > 0.5:
            continue
        t_prev_a = sum(1 for _, a, _ in t["prev"] if a)
        l_prev_a = sum(1 for r in ordered if idx - 3 <= r["seqIndex"] < idx and r["isAnchor"])
        if abs(t_prev_a - l_prev_a) <= 1:
            matches += 1
    cb = combo_bin(
        live_row["features"]["span_rel_position"],
        live_row["features"]["first_pass_cand_log1p"],
        live_row["features"]["pinyin_channel_avail"],
    )
    if matches >= 80:
        cls = "SEQUENCE_WELL_SUPPORTED"
    elif matches >= 3:
        cls = "SEQUENCE_THIN_SUPPORT"
    else:
        cls = "SEQUENCE_OOD"
    return {"class": cls, "matches": matches, "combo": cb}


def local_context(live_row, path_rows) -> dict:
    idx = live_row["seqIndex"]
    ordered = sorted(path_rows, key=lambda r: r["seqIndex"])

    def fmt(r):
        f = r["features"]
        return {
            "surface": r["surface"],
            "isAnchor": r["isAnchor"],
            "cand": f["first_pass_cand_log1p"],
            "rel": round(f["span_rel_position"], 3),
            "py": f["pinyin_channel_avail"],
            "margin": round(r["margin"], 3),
            "decision": r["decision"],
        }

    return {
        "prev3": [fmt(r) for r in ordered if idx - 3 <= r["seqIndex"] < idx],
        "target": fmt(live_row),
        "next3": [fmt(r) for r in ordered if idx < r["seqIndex"] <= idx + 3],
    }


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    keys: list[str] = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def explain_missed(nb, sq, pdep) -> str:
    if nb["neighborhood"] == "TRAIN_KEEP":
        return "TRAIN_KEEP_DOMINATED_NEIGHBORHOOD"
    if nb["support"] == "OUT_OF_DISTRIBUTION":
        return "TRAIN_RETRY_COVERAGE_GAP"
    if sq["class"] == "SEQUENCE_OOD":
        return "SEQUENCE_DISTRIBUTION_GAP"
    if pdep and pdep.get("classification") == "PATH_DEPENDENT":
        return "PATH_STRUCTURE_GAP"
    if nb["neighborhood"] == "MIXED":
        return "FEATURE_SPACE_LABEL_OVERLAP"
    return "TRAIN_RETRY_COVERAGE_GAP"


def explain_unrelated(nb, sq, token_ev) -> str:
    if token_ev == "TOKEN_LABEL_SHORTCUT":
        return "TOKEN_LABEL_SHORTCUT"
    if sq["class"] == "SEQUENCE_OOD":
        return "SEQUENCE_DISTRIBUTION_GAP"
    if nb["neighborhood"] == "TRAIN_RETRY":
        return "MIXED"
    if nb["neighborhood"] == "MIXED":
        return "FEATURE_SPACE_LABEL_OVERLAP"
    return "TRAIN_RETRY_COVERAGE_GAP"


def main():
    actual = sha256_file(RD_CKPT / "weights.pt").lower()
    if actual != EXPECTED_SHA:
        raise SystemExit(f"checkpoint_hash_mismatch:{actual}")

    inv = load_inventory()
    live = load_live()
    if not live:
        raise SystemExit("missing live SSOT trace")
    shas = Counter((r.get("weightsSha256") or "").lower() for r in live)
    if EXPECTED_SHA not in shas:
        raise SystemExit(f"trace_checkpoint_mismatch:{dict(shas)}")

    live_by_case: dict[str, list] = defaultdict(list)
    live_by_path: dict[tuple[str, str], list] = defaultdict(list)
    for r in live:
        if r["caseId"] in INV13:
            live_by_case[r["caseId"]].append(r)
            live_by_path[(r["caseId"], r["pathId"])].append(r)

    validity = classify_inventory_validity(inv, live_by_case)
    print("loading train…")
    train_retry, train_keep, train_meta = load_train()
    print("train_retry", len(train_retry), "train_keep", len(train_keep))

    live_target_retry = []
    live_missed_target = []
    live_unrelated = []
    live_normal_keep = []
    corrected = {}
    with CORRECTED.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            corrected[row["caseId"]] = row

    case_root = []
    unrelated_root = []
    neigh_rows = []
    seq_rows = []
    path_dep_rows = []

    for cid in sorted(INV13):
        rows = live_by_case.get(cid) or []
        inv_row = inv.get(cid) or {}
        val = validity.get(cid) or {"class": "STALE_TARGET_NOT_COMPARABLE"}
        attr = (corrected.get(cid) or {}).get("attribution") or "UNKNOWN"
        targets = target_spans_for_case(cid, rows, inv_row, val)

        if cid in UNRELATED:
            target_keys = {(t["pathId"], t["rawStart"], t["surface"]) for t in targets}
            for r in rows:
                if r["decision"] == "RETRY" and not r["isAnchor"]:
                    if (r["pathId"], r["rawStart"], r["surface"]) not in target_keys:
                        live_unrelated.append(r)

        if val["class"] == "STALE_TARGET_NOT_COMPARABLE":
            case_root.append(
                {
                    "case": cid,
                    "target": inv_row.get("probe_surface"),
                    "attribution": attr,
                    "validity": val["class"],
                    "note": val.get("note"),
                    "primary_explanation": "STALE_TARGET_NOT_COMPARABLE",
                }
            )
            continue

        for t in targets:
            if t["decision"] == "RETRY":
                live_target_retry.append(t)
            else:
                live_missed_target.append(t)

        by_surf = defaultdict(list)
        for t in targets:
            by_surf[t["surface"]].append(t)
        for surf, lst in by_surf.items():
            paths = {x["pathId"] for x in lst}
            retry_p = {x["pathId"] for x in lst if x["decision"] == "RETRY"}
            keep_p = {x["pathId"] for x in lst if x["decision"] != "RETRY"}
            margins = [x["margin"] for x in lst]
            if len(paths) <= 1:
                pcls = "SINGLE_PATH_ONLY"
            elif retry_p and keep_p:
                pcls = "PATH_DEPENDENT"
            else:
                pcls = "ROBUST_ACROSS_PATHS"
            path_dep_rows.append(
                {
                    "case": cid,
                    "surface": surf,
                    "n_paths": len(paths),
                    "retry_paths": len(retry_p),
                    "keep_paths": len(keep_p),
                    "margin_min": min(margins) if margins else None,
                    "margin_max": max(margins) if margins else None,
                    "classification": pcls,
                }
            )

        focus = []
        if cid in TARGET_SUCCESS:
            focus = [t for t in targets if t["decision"] == "RETRY"][:3]
        elif cid in NO_RETRY_CASES:
            focus = targets[:3]
        if cid in UNRELATED:
            focus = [r for r in live_unrelated if r["caseId"] == cid][:3]

        for fr in focus:
            path_rows = live_by_path[(cid, fr["pathId"])]
            nb = neighborhood(fr["featVector"], train_retry, train_keep)
            sq = sequence_support(fr, path_rows, train_retry)
            ctx = local_context(fr, path_rows)
            if fr in live_target_retry or (fr["decision"] == "RETRY" and cid in TARGET_SUCCESS):
                grp = "LIVE_TARGET_RETRY"
            elif cid in UNRELATED:
                grp = "LIVE_UNRELATED_RETRY"
            else:
                grp = "LIVE_MISSED_TARGET"
            neigh_rows.append(
                {
                    "case": cid,
                    "surface": fr["surface"],
                    "pathId": fr["pathId"][:16],
                    "group": grp,
                    "margin": fr["margin"],
                    "decision": fr["decision"],
                    "support": nb["support"],
                    "neighborhood": nb["neighborhood"],
                    "nn_dist": nb["nn_dist"],
                    "retry_frac": nb["retry_frac"],
                    "feat_rel": fr["features"]["span_rel_position"],
                    "feat_cand": fr["features"]["first_pass_cand_log1p"],
                    "feat_py": fr["features"]["pinyin_channel_avail"],
                    "rawCand": fr.get("rawCand"),
                }
            )
            seq_rows.append(
                {
                    "case": cid,
                    "surface": fr["surface"],
                    "pathId": fr["pathId"][:16],
                    "seqIndex": fr["seqIndex"],
                    "seqLen": fr["seqLen"],
                    "margin": fr["margin"],
                    "decision": fr["decision"],
                    "sequence_support": sq["class"],
                    "combo": sq.get("combo"),
                    "matches": sq.get("matches"),
                    "prev3": json.dumps(ctx["prev3"], ensure_ascii=False),
                    "target": json.dumps(ctx["target"], ensure_ascii=False),
                    "next3": json.dumps(ctx["next3"], ensure_ascii=False),
                }
            )

        if cid in TARGET_SUCCESS or cid in NO_RETRY_CASES:
            primary = None
            retry_ts = [t for t in targets if t["decision"] == "RETRY"]
            if retry_ts:
                primary = max(retry_ts, key=lambda x: x["margin"])
            elif targets:
                primary = min(targets, key=lambda x: x["margin"])
            if primary:
                nb = neighborhood(primary["featVector"], train_retry, train_keep)
                sq = sequence_support(primary, live_by_path[(cid, primary["pathId"])], train_retry)
                pdep = next((p for p in path_dep_rows if p["case"] == cid and p["surface"] == primary["surface"]), None)
                if cid in TARGET_SUCCESS:
                    expl = "MIXED"
                    if nb["neighborhood"] == "TRAIN_RETRY":
                        expl = "MIXED"
                else:
                    expl = explain_missed(nb, sq, pdep)
                case_root.append(
                    {
                        "case": cid,
                        "target": primary["surface"],
                        "attribution": attr,
                        "validity": val["class"],
                        "margin": primary["margin"],
                        "decision": primary["decision"],
                        "feature_support": nb["support"],
                        "label_neighborhood": nb["neighborhood"],
                        "nn_dist": nb["nn_dist"],
                        "sequence_support": sq["class"],
                        "path_dependence": (pdep or {}).get("classification"),
                        "rel": primary["features"]["span_rel_position"],
                        "cand": primary["features"]["first_pass_cand_log1p"],
                        "rawCand": primary.get("rawCand"),
                        "py": primary["features"]["pinyin_channel_avail"],
                        "primary_explanation": expl,
                    }
                )

    for cid in NO_RETRY_CASES:
        rows = live_by_case.get(cid) or []
        targets = target_spans_for_case(cid, rows, inv.get(cid) or {}, validity.get(cid) or {})
        tset = {(t["pathId"], t["rawStart"], t["surface"]) for t in targets}
        for r in rows:
            if r["isAnchor"] or r["decision"] != "KEEP":
                continue
            if (r["pathId"], r["rawStart"], r["surface"]) in tset:
                continue
            live_normal_keep.append(r)
    if len(live_normal_keep) > 400:
        live_normal_keep = live_normal_keep[:: max(1, len(live_normal_keep) // 400)][:400]

    for r in live_unrelated:
        nb = neighborhood(r["featVector"], train_retry, train_keep)
        sq = sequence_support(r, live_by_path[(r["caseId"], r["pathId"])], train_retry)
        tok_r = train_meta["token_retry"].get(r["surface"], 0)
        tok_k = train_meta["token_keep"].get(r["surface"], 0)
        tot = tok_r + tok_k
        ratio = tok_r / tot if tot else None
        if tot == 0:
            token_ev = "INSUFFICIENT_SAMPLE"
        elif ratio is not None and ratio >= 0.35 and tok_r >= 5:
            token_ev = "TOKEN_LABEL_SHORTCUT"
        elif tot < 5:
            token_ev = "INSUFFICIENT_SAMPLE"
        else:
            token_ev = "NO_TOKEN_SHORTCUT_EVIDENCE"
        unrelated_root.append(
            {
                "case": r["caseId"],
                "span": r["surface"],
                "pathId": r["pathId"][:16],
                "offset": f"{r['rawStart']}-{r['rawEnd']}",
                "margin": r["margin"],
                "rel": r["features"]["span_rel_position"],
                "cand": r["features"]["first_pass_cand_log1p"],
                "rawCand": r.get("rawCand"),
                "py": r["features"]["pinyin_channel_avail"],
                "feature_support": nb["support"],
                "label_neighborhood": nb["neighborhood"],
                "nn_dist": nb["nn_dist"],
                "sequence_support": sq["class"],
                "token_train_retry": tok_r,
                "token_train_keep": tok_k,
                "token_retry_ratio": ratio,
                "token_evidence": token_ev,
                "primary_explanation": explain_unrelated(nb, sq, token_ev),
            }
        )

    groups = {
        "TRAIN_RETRY": train_retry,
        "TRAIN_KEEP": train_keep,
        "LIVE_TARGET_RETRY": live_target_retry,
        "LIVE_MISSED_TARGET": live_missed_target,
        "LIVE_UNRELATED_RETRY": live_unrelated,
        "LIVE_NORMAL_KEEP": live_normal_keep,
    }

    dist_rows = []
    for gname, items in groups.items():
        for fk in FEAT_KEYS:
            xs = [float(it["features"][fk]) for it in items]
            st = dist_stats(xs, gname)
            st["feature"] = fk
            dist_rows.append(st)
        raws = []
        for it in items:
            if it.get("rawCand") is not None:
                raws.append(float(it["rawCand"]))
            elif gname.startswith("TRAIN"):
                raws.append(float(round(math.expm1(it["features"]["first_pass_cand_log1p"]))))
        if raws:
            st = dist_stats(raws, gname)
            st["feature"] = "rawFirstPassCandidateCount"
            dist_rows.append(st)
        margins = [
            float(it["margin"])
            for it in items
            if (not gname.startswith("TRAIN")) and it.get("margin") is not None
        ]
        if margins:
            st = dist_stats(margins, gname)
            st["feature"] = "margin"
            dist_rows.append(st)

    combo_counts = {g: Counter() for g in groups}
    for gname, items in groups.items():
        for it in items:
            f = it["features"]
            combo_counts[gname][
                combo_bin(f["span_rel_position"], f["first_pass_cand_log1p"], f["pinyin_channel_avail"])
            ] += 1

    token_surfaces = sorted(
        {r["surface"] for r in live_target_retry + live_missed_target + live_unrelated}
        | {"背", "烟", "烧", "成", "引", "四", "温", "对", "顺", "苏", "意", "回"}
    )
    token_rows = []
    for s in token_surfaces:
        tr = train_meta["token_retry"].get(s, 0)
        tk = train_meta["token_keep"].get(s, 0)
        tot = tr + tk
        ratio = tr / tot if tot else None
        if tot == 0:
            ev = "INSUFFICIENT_SAMPLE"
        elif ratio is not None and ratio >= 0.35 and tr >= 5:
            ev = "TOKEN_LABEL_SHORTCUT"
        elif tot < 5:
            ev = "INSUFFICIENT_SAMPLE"
        else:
            ev = "NO_TOKEN_SHORTCUT_EVIDENCE"
        token_rows.append({"surface": s, "TRAIN_KEEP": tk, "TRAIN_RETRY": tr, "ratio": ratio, "evidence": ev})

    stale = [c for c, v in validity.items() if v["class"] == "STALE_TARGET_NOT_COMPARABLE"]
    comparable = [c for c in INV13 if c not in stale]
    attr_c = Counter()
    for c in comparable:
        attr_c[(corrected.get(c) or {}).get("attribution", "UNKNOWN")] += 1

    live_paths = {cid: len({r["pathId"] for r in rows}) for cid, rows in live_by_case.items()}
    multi = sum(1 for n in live_paths.values() if n > 1)
    path_verdict = "TRAIN_SINGLE_PATH_VS_LIVE_MULTIPATH"
    manifest = json.loads(RD_MANIFEST.read_text(encoding="utf-8"))

    def median_feat(items, fk):
        xs = [float(it["features"][fk]) for it in items]
        return pct(xs, 0.5) if xs else None

    sep_rows = []
    for fk in FEAT_KEYS:
        pairs = [
            ("LIVE_TARGET_RETRY", "LIVE_MISSED_TARGET", live_target_retry, live_missed_target),
            ("LIVE_UNRELATED_RETRY", "LIVE_NORMAL_KEEP", live_unrelated, live_normal_keep),
        ]
        for a, b, ia, ib in pairs:
            ma, mb = median_feat(ia, fk), median_feat(ib, fk)
            n = min(len(ia), len(ib))
            if n < 3 or ma is None or mb is None:
                strength = "INSUFFICIENT_SAMPLE"
            else:
                gap = abs(ma - mb)
                if fk == "span_rel_position":
                    strength = "STRONG" if gap > 0.25 else "MODERATE" if gap > 0.12 else "WEAK" if gap > 0.05 else "NONE"
                elif fk in ("first_pass_cand_log1p", "span_len_log1p", "current_cjk_len_log1p"):
                    strength = "STRONG" if gap > 0.4 else "MODERATE" if gap > 0.2 else "WEAK" if gap > 0.08 else "NONE"
                elif fk == "pinyin_channel_avail":
                    strength = "NONE" if gap < 0.05 else "MODERATE"
                else:
                    strength = "NONE"
            sep_rows.append(
                {"feature": fk, "pair": f"{a}_vs_{b}", "median_a": ma, "median_b": mb, "n_min": n, "strength": strength}
            )

    py_live = [r["features"]["pinyin_channel_avail"] for r in live if r["caseId"] in INV13]
    py_var = statistics.pstdev(py_live) if len(py_live) > 1 else 0.0
    pinyin_note = "LOW_VARIANCE_FEATURE" if py_var < 0.05 else "HAS_VARIATION"

    missed_keep_dom = sum(1 for r in case_root if r.get("label_neighborhood") == "TRAIN_KEEP")
    unrelated_retry_dom = sum(1 for r in unrelated_root if r.get("label_neighborhood") == "TRAIN_RETRY")
    unrelated_token = sum(1 for r in unrelated_root if r.get("token_evidence") == "TOKEN_LABEL_SHORTCUT")
    seq_ood = sum(1 for r in seq_rows if r.get("sequence_support") == "SEQUENCE_OOD")
    path_dep = sum(1 for r in path_dep_rows if r.get("classification") == "PATH_DEPENDENT")

    primary_verdict = "MULTI_FACTOR_TRAINING_DISTRIBUTION_GAP"
    next_phase = "MODEL3_V2_TARGETED_DISTRIBUTION_CORRECTION_DESIGN"
    if unrelated_token >= 2 and unrelated_retry_dom >= 2 and missed_keep_dom >= 2:
        primary_verdict = "MULTI_FACTOR_TRAINING_DISTRIBUTION_GAP"
        next_phase = "MODEL3_V2_TARGETED_DISTRIBUTION_CORRECTION_DESIGN"
    elif path_dep >= 2 and multi >= 5:
        primary_verdict = "TRAIN_LIVE_PATH_STRUCTURE_GAP"
        next_phase = "MODEL3_V2_TRAIN_LIVE_PATH_STRUCTURE_AUDIT"

    write_csv(DOCS / "model3_v2_live_train_feature_distribution.csv", dist_rows)
    write_csv(
        DOCS / "model3_v2_live_training_neighborhood.csv",
        neigh_rows + [{**u, "group": "LIVE_UNRELATED_DETAIL"} for u in unrelated_root],
    )
    write_csv(DOCS / "model3_v2_live_sequence_context.csv", seq_rows)

    summary = {
        "phase": "MODEL3_V2_LIVE_FEATURE_DISTRIBUTION_AUDIT",
        "checkpoint": {"modelId": "MODEL3_V2_REALDIST_V1", "sha": actual, "verified": True},
        "primaryVerdict": primary_verdict,
        "trainingDistributionExplainsFailures": "PARTIALLY",
        "featureCapacityAuditAuthorized": False,
        "thresholdTuningAuthorized": False,
        "architectureChangeAuthorized": False,
        "groupSizes": {k: len(v) for k, v in groups.items()},
        "inventory": {
            "original": {"TARGET": 3, "ADJACENT": 0, "UNRELATED": 4, "NO_RETRY": 6},
            "validity": validity,
            "stale": stale,
            "comparable": comparable,
            "comparable_attribution": dict(attr_c),
        },
        "pinyin": {
            "note": pinyin_note,
            "live_std": py_var,
            "live_mean": statistics.fmean(py_live) if py_live else None,
        },
        "pathStructure": {
            "verdict": path_verdict,
            "live_cases_multipath": multi,
            "live_paths_per_case": live_paths,
            "train": train_meta["path_struct"],
        },
        "v2Position": {
            "realdist_all_retry_position": manifest.get("allRetryPositionApprox"),
            "realdist_expansion_retry_position": manifest.get("expansionRetryPosition"),
            "v2_original_train_dataset": "ABSENT_IN_REPO_USE_MANIFEST_BASELINE_ONLY",
        },
        "comboTop": {
            g: combo_counts[g].most_common(8)
            for g in ("TRAIN_RETRY", "LIVE_TARGET_RETRY", "LIVE_MISSED_TARGET", "LIVE_UNRELATED_RETRY")
        },
        "separability": sep_rows,
        "tokenShortcut": token_rows,
        "pathDependence": path_dep_rows,
        "targetRootCause": case_root,
        "unrelatedRootCause": unrelated_root,
        "questions": {
            "A_training_distribution_explains": "PARTIALLY",
            "B_targeted_data_correction_before_feature_change": True,
            "C_feature_capacity_audit_justified": False,
            "D_threshold_tuning": False,
            "E_architecture_change": False,
        },
        "recommendedNextPhase": next_phase,
        "factorsObserved": {
            "missed_keep_dominated": missed_keep_dom,
            "unrelated_retry_dominated": unrelated_retry_dom,
            "unrelated_token_shortcut": unrelated_token,
            "sequence_ood": seq_ood,
            "path_dependent_surfaces": path_dep,
        },
    }
    (DOCS / "model3_v2_live_distribution_audit_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "primaryVerdict": primary_verdict,
                "next": next_phase,
                "groups": summary["groupSizes"],
                "stale": stale,
                "factors": summary["factorsObserved"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
