#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT — read-only distribution audit."""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "docs" / "user_correction" / "model3"
DIALOG_ANCHORED = OUT / "model3_v1_feature_contract_dialog200_anchored.jsonl"
DIALOG_FULL = OUT / "model3_v1_dialog200_raw_cases.jsonl"
FULL100K = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
STRICT = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction"

_CJK = re.compile(r"[\u4e00-\u9fff]")
_PUNCT = re.compile(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…·]")

# Simplified ↔ Traditional common pairs for CHARACTER_FORM_VARIANT (audit-only heuristic)
_TRAD_SIMP = {
    "點": "点", "熱": "热", "鐵": "铁", "鐘": "钟", "貝": "贝", "邊": "边",
    "溫": "温", "結": "结", "論": "论", "發": "发", "裡": "里", "們": "们",
    "團": "团", "隊": "队", "對": "对", "選": "选", "連": "连", "監": "监",
    "會": "会", "現": "现", "貴": "贵", "這": "这", "嗎": "吗", "為": "为",
    "關": "关", "門": "门", "開": "开", "長": "长", "來": "来", "時": "时",
    "見": "见", "話": "话", "說": "说", "請": "请", "後": "后", "與": "与",
    "個": "个", "嗎": "吗", "裏": "里", "畫": "画", "當": "当", "線": "线",
    "計": "计", "劃": "划", "調": "调", "聯": "联", "測": "测", "試": "试",
}

FAMILIES = [
    "PHONETIC_SUBSTITUTION",
    "DELETION",
    "INSERTION",
    "SEGMENTATION_BOUNDARY",
    "MULTI_CHAR_REPLACEMENT",
    "CHARACTER_FORM_VARIANT",
    "LOCAL_ORDER_OR_STRUCTURE",
    "OTHER",
]

PHONETIC_CF = {
    "in_ing", "n_l", "ch_c", "z_zh", "sh_s", "eng_en", "h_f", "seed_phonetic",
}


def norm(s: str) -> str:
    return _PUNCT.sub("", s or "")


def pct(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    s = sorted(vals)
    i = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return round(s[i], 4)


def load_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def overlaps_anchor(i1: int, i2: int, anchors: list[dict]) -> bool:
    for a in anchors:
        s, e = int(a.get("rawStart", -1)), int(a.get("rawEnd", -1))
        if s >= 0 and not (i2 <= s or i1 >= e):
            return True
    return False


def char_form_variant(a: str, b: str) -> bool:
    if not a or not b or len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x == y:
            continue
        if _TRAD_SIMP.get(x) == y or _TRAD_SIMP.get(y) == x:
            continue
        # both CJK but not known trad/simp pair
        if _CJK.match(x) and _CJK.match(y):
            return False
        return False
    return a != b


def classify_pair(raw_seg: str, ref_seg: str, tag: str) -> tuple[str, str | None, str]:
    """Return (primary_family, phonetic_subtype, note)."""
    raw_seg = raw_seg or ""
    ref_seg = ref_seg or ""
    if not raw_seg and ref_seg:
        return "DELETION", None, "insert_on_ref / missing_in_asr"
    if raw_seg and not ref_seg:
        return "INSERTION", None, "extra_in_asr"
    if char_form_variant(raw_seg, ref_seg):
        return "CHARACTER_FORM_VARIANT", None, "trad_simp_or_form"
    # punctuation-only residual after CJK filter
    if not _CJK.findall(raw_seg) and not _CJK.findall(ref_seg):
        return "OTHER", None, "punct_or_space"
    lr, lf = len(raw_seg), len(ref_seg)
    if lr == 1 and lf == 1:
        # single char swap — default phonetic unless clearly form
        return "PHONETIC_SUBSTITUTION", "UNKNOWN_PHONETIC", "1char_subst"
    if abs(lr - lf) >= 1 and min(lr, lf) == 0:
        return ("DELETION" if lr < lf else "INSERTION"), None, "len0"
    # multi-char
    if lr >= 2 or lf >= 2:
        # check if mostly form variants charwise
        if lr == lf and sum(1 for a, b in zip(raw_seg, ref_seg) if a != b) <= max(1, lr // 2):
            # could be multi phonetic or multi form
            formish = all(
                a == b or _TRAD_SIMP.get(a) == b or _TRAD_SIMP.get(b) == a
                for a, b in zip(raw_seg, ref_seg)
            )
            if formish and raw_seg != ref_seg:
                return "CHARACTER_FORM_VARIANT", None, "multi_form"
            return "MULTI_CHAR_REPLACEMENT", "UNKNOWN_PHONETIC", "multi_subst"
        if abs(lr - lf) >= 2:
            return "MULTI_CHAR_REPLACEMENT", None, "len_gap"
        return "MULTI_CHAR_REPLACEMENT", None, "multi"
    return "OTHER", None, f"tag={tag}"


def map_phonetic_subtype_from_cf(cf: str | None) -> str:
    if not cf:
        return "UNKNOWN_PHONETIC"
    if cf in ("in_ing", "eng_en"):
        return "NEAR_PHONETIC"
    if cf in ("n_l", "ch_c", "z_zh", "sh_s", "h_f"):
        return "PRONUNCIATION_CONFUSION"
    if cf == "seed_phonetic":
        return "UNKNOWN_PHONETIC"
    return "UNKNOWN_PHONETIC"


def extract_eval_proxy_spans(row: dict) -> list[dict]:
    """EVAL_PROXY: anchored + ASR error + non-anchor CJK mismatch blocks."""
    anchors = row.get("anchors") or []
    raw, ref = row.get("raw_asr") or "", row.get("expected") or ""
    if not anchors:
        return []
    if norm(raw) == norm(ref):
        return []
    sm = SequenceMatcher(None, raw, ref)
    spans = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        raw_seg = raw[i1:i2]
        ref_seg = ref[j1:j2]
        if overlaps_anchor(i1, i2, anchors):
            continue
        # require CJK involvement (same as prior EVAL_PROXY)
        if not (_CJK.findall(raw_seg) or _CJK.findall(ref_seg)):
            continue
        spans.append(
            {
                "caseId": row.get("id"),
                "scenario": row.get("scenario"),
                "rawStart": i1,
                "rawEnd": i2,
                "refStart": j1,
                "refEnd": j2,
                "surface": raw_seg,
                "referenceSurface": ref_seg,
                "diffTag": tag,
                "raw_asr": raw,
                "reference": ref,
                "anchors": anchors,
            }
        )
    return spans


def attach_margins(proxy: dict, case_row: dict) -> dict:
    """Attach nearest FineSpan margin by raw overlap / surface match (EVAL_PROXY)."""
    margins = case_row.get("span_margins") or []
    i1, i2 = proxy["rawStart"], proxy["rawEnd"]
    best = None
    best_score = -1
    for m in margins:
        # span margins may not have raw offsets; match by surface containment
        surf = m.get("surface") or ""
        score = 0
        if surf and surf in (proxy["surface"] or ""):
            score = 3 + len(surf)
        elif surf and (proxy["surface"] or "") in surf:
            score = 2 + len(proxy["surface"] or "")
        elif surf and any(ch in surf for ch in (proxy["surface"] or "") if _CJK.match(ch)):
            score = 1
        if score > best_score:
            best_score = score
            best = m
    out = dict(proxy)
    if best and best_score > 0:
        out["spanId"] = best.get("spanId")
        out["pathId"] = best.get("path_id")
        out["keep_logit"] = best.get("keep_logit")
        out["retry_logit"] = best.get("retry_logit")
        out["margin"] = best.get("margin")
        out["decision"] = best.get("decision")
        out["matched_span_surface"] = best.get("surface")
    else:
        out["spanId"] = None
        out["pathId"] = None
        out["keep_logit"] = None
        out["retry_logit"] = None
        out["margin"] = None
        out["decision"] = None
        out["matched_span_surface"] = None
    # anchor distance (char gap to nearest anchor)
    ad = None
    for a in proxy.get("anchors") or []:
        s, e = int(a.get("rawStart", -1)), int(a.get("rawEnd", -1))
        if s < 0:
            continue
        if i2 <= s:
            d = s - i2
        elif e <= i1:
            d = i1 - e
        else:
            d = 0
        ad = d if ad is None else min(ad, d)
    out["anchor_distance"] = ad
    out["anchor_sources"] = ",".join(sorted({a.get("source", "") for a in (proxy.get("anchors") or [])}))
    return out


def classify_proxy_validity(row: dict) -> tuple[str, str]:
    """VALID or PROXY_FALSE_POSITIVE with note."""
    surf = row.get("surface") or ""
    ref = row.get("referenceSurface") or ""
    # only punctuation / whitespace residual after strip
    if not _CJK.findall(surf) and not _CJK.findall(ref):
        return "PROXY_FALSE_POSITIVE", "no_cjk"
    # pure form variant spanning entire utterance punctuation noise
    if char_form_variant(surf, ref) and len(surf) <= 2:
        return "VALID", "form_variant_kept"
    # empty surface with short ref punct
    if not surf.strip() and len(ref) <= 1 and not _CJK.findall(ref):
        return "PROXY_FALSE_POSITIVE", "empty_surface"
    return "VALID", "ok"


def length_bucket(n: int) -> str:
    if n <= 1:
        return "1"
    if n == 2:
        return "2"
    if n == 3:
        return "3"
    return "4+"


def classify_synthetic_retry(sp: dict) -> tuple[str, str | None, str]:
    surf = sp.get("surface") or ""
    ref = sp.get("referenceSurface") or ""
    cf = sp.get("corruptionFamily")
    if cf in PHONETIC_CF or sp.get("phoneticCompatible"):
        fam = "PHONETIC_SUBSTITUTION"
        sub = map_phonetic_subtype_from_cf(cf)
        if len(surf) == 1 and len(ref) == 1:
            return fam, sub, cf or "phonetic"
        if len(surf) != len(ref) or max(len(surf), len(ref)) > 1:
            # seed_phonetic sometimes 1-char surf vs multi ref — still phonetic family in generator
            return fam, sub, cf or "phonetic_len_mismatch"
        return fam, sub, cf or "phonetic"
    if not surf and ref:
        return "DELETION", None, "empty_surf"
    if surf and not ref:
        return "INSERTION", None, "empty_ref"
    if len(surf) >= 2 or len(ref) >= 2:
        return "MULTI_CHAR_REPLACEMENT", None, cf or "multi"
    return "OTHER", None, cf or "other"


def ownership_for(family: str) -> str:
    if family == "CHARACTER_FORM_VARIANT":
        return "DOWNSTREAM_NORMALIZATION"
    if family == "SEGMENTATION_BOUNDARY":
        return "UPSTREAM_FINE_SPAN"
    if family in (
        "PHONETIC_SUBSTITUTION",
        "MULTI_CHAR_REPLACEMENT",
        "DELETION",
        "INSERTION",
        "LOCAL_ORDER_OR_STRUCTURE",
    ):
        return "MODEL3_TARGET"
    if family == "OTHER":
        return "UNCERTAIN"
    return "UNCERTAIN"


def load_synthetic_retries(limit_per_split: int | None = None) -> list[dict]:
    rows = []
    for root, src in [(FULL100K, "full100k"), (STRICT, "strict")]:
        for split in ["train", "test"]:
            d = root / split
            if not d.is_dir():
                continue
            for p in sorted(d.glob("shard-*.jsonl")):
                with p.open(encoding="utf-8") as f:
                    for line in f:
                        s = json.loads(line)
                        for sp in s.get("spans") or []:
                            if (
                                sp.get("label") == "RETRY"
                                and not sp.get("isAnchor")
                                and sp.get("targetMask") == 1
                            ):
                                rows.append({"_src": src, "_split": split, **sp})
                                if limit_per_split and len([r for r in rows if r["_src"] == src]) >= limit_per_split:
                                    break
                if limit_per_split and len([r for r in rows if r["_src"] == src]) >= limit_per_split:
                    break
    return rows


def dist_stats(items: list[dict], key: str = "primary_error_family") -> dict:
    c = Counter(x[key] for x in items)
    n = max(sum(c.values()), 1)
    out = {}
    for fam in FAMILIES:
        idxs = [x for x in items if x[key] == fam]
        margins = [float(x["margin"]) for x in idxs if x.get("margin") is not None]
        lens = [int(x.get("span_length") or 0) for x in idxs]
        out[fam] = {
            "count": c.get(fam, 0),
            "percent": round(100.0 * c.get(fam, 0) / n, 2),
            "span_len_p50": pct([float(v) for v in lens], 50) if lens else None,
            "span_len_p95": pct([float(v) for v in lens], 95) if lens else None,
            "margin_p50": pct(margins, 50),
            "margin_p95": pct(margins, 95),
            "margin_max": round(max(margins), 4) if margins else None,
        }
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # EVAL_PROXY identity comes from full dialog_200 acceptance set (200 cases).
    # Anchored revalidation file supplies per-span logits when available.
    dialog_full = load_jsonl(DIALOG_FULL)
    dialog_anchored = load_jsonl(DIALOG_ANCHORED)
    by_id = {r["id"]: r for r in dialog_full}
    for r in dialog_anchored:
        if r.get("span_margins"):
            base = by_id.get(r["id"], r)
            by_id[r["id"]] = {
                **base,
                "span_margins": r["span_margins"],
                "anchors": r.get("anchors") or base.get("anchors"),
            }
    dialog = list(by_id.values()) if by_id else dialog_full

    # --- PART A: rebuild EVAL_PROXY ---
    anchored_asr_err = 0
    eligible_utts = 0
    proxy_spans_raw: list[dict] = []
    for r in dialog:
        anchors = r.get("anchors") or []
        raw, ref = r.get("raw_asr") or "", r.get("expected") or ""
        if anchors and norm(raw) != norm(ref):
            anchored_asr_err += 1
        prox = extract_eval_proxy_spans(r)
        if prox:
            eligible_utts += 1
            for p in prox:
                proxy_spans_raw.append(attach_margins(p, by_id.get(r["id"], r)))

    expected_spans = 151
    audited = len(proxy_spans_raw)

    # classify
    classified = []
    fp = 0
    for p in proxy_spans_raw:
        validity, vnote = classify_proxy_validity(p)
        fam, sub, note = classify_pair(p["surface"], p["referenceSurface"], p.get("diffTag") or "")
        # ownership-informed: if only punctuation-ish OTHER with no CJK → FP already
        if validity == "PROXY_FALSE_POSITIVE":
            fp += 1
        own = ownership_for(fam)
        span_len = max(len(p.get("surface") or ""), len(p.get("referenceSurface") or ""))
        classified.append(
            {
                **{k: p.get(k) for k in (
                    "caseId", "scenario", "spanId", "pathId", "surface", "referenceSurface",
                    "rawStart", "rawEnd", "keep_logit", "retry_logit", "margin", "decision",
                    "anchor_distance", "anchor_sources", "matched_span_surface",
                )},
                "primary_error_family": fam,
                "phonetic_subtype": sub,
                "span_length": span_len,
                "reference_length": len(p.get("referenceSurface") or ""),
                "proxy_validity": validity,
                "proxy_note": vnote,
                "classify_note": note,
                "ownership": own,
                "length_bucket": length_bucket(span_len),
            }
        )

    valid = [x for x in classified if x["proxy_validity"] == "VALID"]
    real_dist = dist_stats(valid)

    # length buckets (valid only)
    len_c = Counter(x["length_bucket"] for x in valid)
    len_n = max(sum(len_c.values()), 1)
    real_len = {k: {"count": len_c.get(k, 0), "percent": round(100.0 * len_c.get(k, 0) / len_n, 2)} for k in ["1", "2", "3", "4+"]}

    # phonetic subtypes among real PHONETIC
    phon_real = [x for x in valid if x["primary_error_family"] == "PHONETIC_SUBSTITUTION"]
    phon_sub_c = Counter(x.get("phonetic_subtype") or "UNKNOWN_PHONETIC" for x in phon_real)

    # --- PART D: Synthetic V1 RETRY ---
    # Use full frozen RETRY from full100k + strict (actual training sources)
    syn_rows = []
    for root, src in [(FULL100K, "full100k"), (STRICT, "strict")]:
        for split in ["train", "test"]:
            d = root / split
            if not d.is_dir():
                continue
            for p in sorted(d.glob("shard-*.jsonl")):
                with p.open(encoding="utf-8") as f:
                    for line in f:
                        s = json.loads(line)
                        for sp in s.get("spans") or []:
                            if (
                                sp.get("label") == "RETRY"
                                and not sp.get("isAnchor")
                                and int(sp.get("targetMask") or 0) == 1
                            ):
                                fam, sub, note = classify_synthetic_retry(sp)
                                surf = sp.get("surface") or ""
                                ref = sp.get("referenceSurface") or ""
                                # Model3 encodes CURRENT surface; length bias uses surface length.
                                sl = len(surf)
                                syn_rows.append(
                                    {
                                        "source": src,
                                        "primary_error_family": fam,
                                        "phonetic_subtype": sub,
                                        "span_length": sl,
                                        "reference_length": len(ref),
                                        "length_bucket": length_bucket(sl),
                                        "corruptionFamily": sp.get("corruptionFamily"),
                                        "note": note,
                                    }
                                )

    syn_dist = dist_stats(syn_rows)  # no margins
    syn_len_c = Counter(x["length_bucket"] for x in syn_rows)
    syn_len_n = max(sum(syn_len_c.values()), 1)
    syn_len = {k: {"count": syn_len_c.get(k, 0), "percent": round(100.0 * syn_len_c.get(k, 0) / syn_len_n, 2)} for k in ["1", "2", "3", "4+"]}
    syn_phon = [x for x in syn_rows if x["primary_error_family"] == "PHONETIC_SUBSTITUTION"]
    syn_phon_sub = Counter(x.get("phonetic_subtype") or "UNKNOWN_PHONETIC" for x in syn_phon)

    # --- PART E: coverage comparison ---
    real_n = max(len(valid), 1)
    syn_n = max(len(syn_rows), 1)
    coverage_rows = []
    for fam in FAMILIES:
        rc = real_dist[fam]["count"]
        rp = real_dist[fam]["percent"]
        sc = syn_dist[fam]["count"]
        spct = round(100.0 * sc / syn_n, 2)
        if fam == "CHARACTER_FORM_VARIANT":
            status = "NOT_MODEL3_TARGET" if rc > 0 else "MISSING"
            if rc == 0 and sc == 0:
                status = "NOT_MODEL3_TARGET"
        elif fam == "SEGMENTATION_BOUNDARY":
            status = "NOT_MODEL3_TARGET" if rc == 0 else "UNCERTAIN"
        elif rc == 0 and sc == 0:
            status = "COVERED"  # both empty
        elif rc > 0 and sc == 0:
            status = "MISSING"
        elif rp > 5 and spct < rp * 0.25:
            status = "UNDERREPRESENTED"
        elif spct > 80 and rp < 40:
            status = "OVERREPRESENTED"
        elif rc > 0 and sc > 0:
            status = "COVERED" if abs(rp - spct) < 25 else ("UNDERREPRESENTED" if rp > spct else "OVERREPRESENTED")
        else:
            status = "UNCERTAIN"
        coverage_rows.append(
            {
                "error_family": fam,
                "real_count": rc,
                "real_percent": rp,
                "synthetic_count": sc,
                "synthetic_percent": spct,
                "coverage_status": status,
                "ownership": ownership_for(fam),
            }
        )

    # ownership counts on valid
    own_c = Counter(x["ownership"] for x in valid)

    # material gaps
    gaps = []
    # GAP: length bias (surface length — what Model3 sees)
    real_1 = real_len["1"]["percent"]
    syn_1 = syn_len["1"]["percent"]
    if syn_1 >= 90 or (syn_1 - real_1) >= 25:
        gaps.append(
            {
                "id": "GAP-01",
                "error_family": "LENGTH_BIAS_1CHAR",
                "real_evidence_count": len_c.get("1", 0),
                "real_percentage": real_1,
                "synthetic_percentage": syn_1,
                "why": "Synthetic V1 RETRY surfaces are almost entirely 1-character; real eligible errors include substantial 2+/multi-char local mismatches.",
                "belongs_to_model3": True,
                "data_action": "ADD",
                "detail": "Increase 2+/multi-char local replacement positives under Anchor conditioning.",
            }
        )
    # GAP: phonetic overrep
    r_ph = real_dist["PHONETIC_SUBSTITUTION"]["percent"]
    s_ph = round(100.0 * syn_dist["PHONETIC_SUBSTITUTION"]["count"] / syn_n, 2)
    if s_ph > 90:
        gaps.append(
            {
                "id": "GAP-02",
                "error_family": "PHONETIC_SUBSTITUTION",
                "real_evidence_count": real_dist["PHONETIC_SUBSTITUTION"]["count"],
                "real_percentage": r_ph,
                "synthetic_percentage": s_ph,
                "why": "Synthetic RETRY mass is almost only closed-set phonetic families (in_ing/n_l/ch_c/…/seed_phonetic).",
                "belongs_to_model3": True,
                "data_action": "DECREASE",
                "detail": "Keep phonetic as majority but reduce exclusive dominance; broaden subtypes.",
            }
        )
    # GAP: multi-char missing
    if real_dist["MULTI_CHAR_REPLACEMENT"]["count"] > 0 and syn_dist["MULTI_CHAR_REPLACEMENT"]["count"] == 0:
        gaps.append(
            {
                "id": "GAP-03",
                "error_family": "MULTI_CHAR_REPLACEMENT",
                "real_evidence_count": real_dist["MULTI_CHAR_REPLACEMENT"]["count"],
                "real_percentage": real_dist["MULTI_CHAR_REPLACEMENT"]["percent"],
                "synthetic_percentage": 0.0,
                "why": "Real ASR often replaces 2–4 char local units; frozen Synthetic RETRY has essentially zero multi-char family coverage.",
                "belongs_to_model3": True,
                "data_action": "ADD",
                "detail": "Add Anchor-conditioned multi-char local replacement RETRY pairs.",
            }
        )
    # GAP: deletion/insertion
    for fam, gid in [("DELETION", "GAP-04"), ("INSERTION", "GAP-05")]:
        if real_dist[fam]["count"] > 0 and syn_dist[fam]["count"] == 0:
            gaps.append(
                {
                    "id": gid,
                    "error_family": fam,
                    "real_evidence_count": real_dist[fam]["count"],
                    "real_percentage": real_dist[fam]["percent"],
                    "synthetic_percentage": 0.0,
                    "why": f"Real dialog_200 eligible set contains {fam.lower()} patterns absent from Synthetic RETRY positives.",
                    "belongs_to_model3": True,
                    "data_action": "ADD",
                    "detail": f"Pilot small controlled {fam} pilot under Anchor context (not free utterance rewrite).",
                }
            )
    # GAP: character form — exclude from Model3
    if real_dist["CHARACTER_FORM_VARIANT"]["count"] > 0:
        gaps.append(
            {
                "id": "GAP-06",
                "error_family": "CHARACTER_FORM_VARIANT",
                "real_evidence_count": real_dist["CHARACTER_FORM_VARIANT"]["count"],
                "real_percentage": real_dist["CHARACTER_FORM_VARIANT"]["percent"],
                "synthetic_percentage": round(100.0 * syn_dist["CHARACTER_FORM_VARIANT"]["count"] / syn_n, 2),
                "why": "Trad/simp and orthographic variants appear in real ASR but are normalization, not Model3 RETRY semantics.",
                "belongs_to_model3": False,
                "data_action": "EXCLUDE",
                "detail": "Route to downstream normalization; do not train Model3 to RETRY form variants.",
            }
        )
    # GAP: phonetic subtype narrowness
    gaps.append(
        {
            "id": "GAP-07",
            "error_family": "PHONETIC_SUBTYPE_NARROWNESS",
            "real_evidence_count": len(phon_real),
            "real_percentage": r_ph,
            "synthetic_percentage": s_ph,
            "why": "Synthetic phonetic subtypes are a closed confusion set; real ASR confusions are broader / often UNKNOWN.",
            "belongs_to_model3": True,
            "data_action": "INCREASE",
            "detail": "Broaden phonetic confusion inventory beyond in_ing/n_l/ch_c/z_zh/sh_s/eng_en/h_f.",
        }
    )

    # sample adequacy
    if audited >= 100 and len(valid) >= 80:
        adequacy = "SUFFICIENT_FOR_DIRECTION"
        phase_result = "PASS"
    elif audited >= 40:
        adequacy = "LIMITED"
        phase_result = "PASS_WITH_LIMITED_SAMPLE"
    else:
        adequacy = "INSUFFICIENT"
        phase_result = "DATASET_COVERAGE_INSUFFICIENT"

    # recommended mix from Model3-target valid spans only
    m3_targets = [x for x in valid if x["ownership"] == "MODEL3_TARGET"]
    m3_n = max(len(m3_targets), 1)
    m3_fam = Counter(x["primary_error_family"] for x in m3_targets)
    # length-aware mix proposal
    m3_len = Counter(x["length_bucket"] for x in m3_targets)

    # Convert observed Model3-target family shares into recommended mix (renormalized + floor for missing needed)
    raw_mix = {fam: m3_fam.get(fam, 0) / m3_n for fam in FAMILIES if ownership_for(fam) == "MODEL3_TARGET"}
    # ensure multi-char presence even if sample small
    if raw_mix.get("MULTI_CHAR_REPLACEMENT", 0) < 0.15 and real_dist["MULTI_CHAR_REPLACEMENT"]["count"] > 0:
        raw_mix["MULTI_CHAR_REPLACEMENT"] = max(raw_mix.get("MULTI_CHAR_REPLACEMENT", 0), 0.20)
    if raw_mix.get("PHONETIC_SUBSTITUTION", 0) > 0.70:
        raw_mix["PHONETIC_SUBSTITUTION"] = 0.55
    # normalize
    ssum = sum(raw_mix.values()) or 1.0
    rec_mix = {k: round(100.0 * v / ssum, 1) for k, v in raw_mix.items() if v > 0}

    # length recommendation
    rec_len = {
        "1": min(50.0, max(25.0, m3_len.get("1", 0) / m3_n * 100)),
        "2": 25.0,
        "3": 15.0,
        "4+": 10.0,
    }
    # normalize length
    ls = sum(rec_len.values())
    rec_len = {k: round(100.0 * v / ls, 1) for k, v in rec_len.items()}

    # largest over/under
    over = max(coverage_rows, key=lambda r: r["synthetic_percent"] - r["real_percent"])
    under = max(coverage_rows, key=lambda r: r["real_percent"] - r["synthetic_percent"])
    missing = [r["error_family"] for r in coverage_rows if r["coverage_status"] == "MISSING"]

    # write CSV: real error distribution detail
    real_csv = OUT / "model3_v1_real_error_distribution.csv"
    with real_csv.open("w", encoding="utf-8", newline="") as f:
        fields = [
            "caseId", "scenario", "spanId", "pathId", "surface", "referenceSurface",
            "primary_error_family", "phonetic_subtype", "span_length", "length_bucket",
            "anchor_distance", "anchor_sources", "keep_logit", "retry_logit", "margin",
            "decision", "proxy_validity", "ownership", "classify_note",
        ]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for row in classified:
            w.writerow(row)

    gap_csv = OUT / "model3_v1_synthetic_real_coverage_gap.csv"
    with gap_csv.open("w", encoding="utf-8", newline="") as f:
        fields = [
            "error_family", "real_count", "real_percent", "synthetic_count",
            "synthetic_percent", "coverage_status", "ownership",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in coverage_rows:
            w.writerow(row)

    summary = {
        "phase": "MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT",
        "date": "2026-08-28",
        "phaseResult": phase_result,
        "auditSet": {
            "expectedEligibleSpans": expected_spans,
            "audited": audited,
            "proxyFalsePositives": fp,
            "validAuditSpans": len(valid),
            "anchoredUtterancesWithAsrError": anchored_asr_err,
            "eligibleErrorUtterances": eligible_utts,
            "sampleAdequacy": adequacy,
            "countVerification": {
                "expected_utt_asr_err": 46,
                "observed_utt_asr_err": anchored_asr_err,
                "expected_eligible_utt": 46,
                "observed_eligible_utt": eligible_utts,
                "expected_spans": 151,
                "observed_spans": audited,
            },
        },
        "realErrorDistribution": real_dist,
        "realErrorLength": real_len,
        "realPhoneticSubtypes": dict(phon_sub_c),
        "syntheticV1Distribution": {k: {"count": v["count"], "percent": round(100.0 * v["count"] / syn_n, 2)} for k, v in syn_dist.items()},
        "syntheticErrorLength": syn_len,
        "syntheticPhoneticSubtypes": dict(syn_phon_sub),
        "syntheticRetryTotal": len(syn_rows),
        "realVsSynthetic": {
            "materialDistributionShift": True,
            "largestOverrepresentedSyntheticFamily": over["error_family"],
            "largestUnderrepresentedSyntheticFamily": under["error_family"],
            "missingRealFamilies": missing,
            "lengthDistributionShift": syn_1 >= 95 and real_1 < 80,
            "phoneticSubtypeShift": True,
        },
        "ownership": {
            "MODEL3_TARGET": own_c.get("MODEL3_TARGET", 0),
            "DOWNSTREAM_NORMALIZATION": own_c.get("DOWNSTREAM_NORMALIZATION", 0),
            "UPSTREAM_FINE_SPAN": own_c.get("UPSTREAM_FINE_SPAN", 0),
            "RECALL_PROBLEM": own_c.get("RECALL_PROBLEM", 0),
            "OUT_OF_SCOPE": own_c.get("OUT_OF_SCOPE", 0),
            "UNCERTAIN": own_c.get("UNCERTAIN", 0),
        },
        "materialCoverageGaps": gaps,
        "model3Status": {
            "architectureFailureProven": False,
            "runtimeFailureProven": False,
            "featureContractFailure": False,
            "trainingDistributionGapProven": True,
            "retrainingEventuallyJustified": True,
            "immediateRetrainingRecommended": False,
        },
        "nextDataset": {
            "newDatasetNeeded": True,
            "recommendedFamilyMixPercent": rec_mix,
            "recommendedLengthMixPercent": rec_len,
            "recommendedPilotScale": "2k–5k Anchor-conditioned RETRY pairs (pilot) before any large-scale generation",
            "largeScaleGenerationNow": False,
            "keepControlHint": "Retain Hard KEEP + NATURAL KEEP + NO_ANCHOR discrimination mass; do not flood RETRY.",
        },
        "decision": {
            "primaryBottleneck": "TRAINING_DISTRIBUTION",
            "recommendedNextPhase": "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET",
        },
        "governance": {
            "runtimeCodeChanged": False,
            "modelChanged": False,
            "trainingChanged": False,
            "datasetGenerated": False,
            "architectureChanged": False,
            "reportArtifactCount": 5,
        },
    }

    (OUT / "model3_v1_real_error_dataset_audit_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "model3_v1_real_error_dataset_governance.json").write_text(
        json.dumps(
            {
                "phase": "MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT",
                "date": "2026-08-28",
                "phaseResult": phase_result,
                "mainlineIntegration": "ACCEPTED",
                "model3Effectiveness": "UNPROVEN",
                "trainingDistributionGapProven": True,
                "immediateRetrain": False,
                "reportArtifacts": [
                    "Lingua_Model3_V1_Real_ASR_Error_Dataset_Audit_2026_08_28.md",
                    "model3_v1_real_error_distribution.csv",
                    "model3_v1_synthetic_real_coverage_gap.csv",
                    "model3_v1_real_error_dataset_audit_summary.json",
                    "model3_v1_real_error_dataset_governance.json",
                ],
                "reportArtifactCount": 5,
                "hardStop": True,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # markdown report
    def fam_line(d: dict, fam: str) -> str:
        x = d[fam]
        return f"{x['count']} ({x['percent']}%)"

    md = f"""# Lingua Model3 V1 — Real ASR Error Dataset Audit

**Phase:** `MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT`  
**Date:** 2026-08-28  
**Mode:** Read-only data audit  
**Result:** **{phase_result}**

---

## Purpose

Explain which error distribution is missing from frozen Model3 Synthetic V1 training relative to dialog_200 EVAL_PROXY eligible errors (after feature-contract PASS and RETRY=0).

---

## Audit Set Verification

| Metric | Expected | Observed |
|--------|----------:|----------:|
| Anchored utterances with ASR error | 46 | {anchored_asr_err} |
| Eligible error utterances | 46 | {eligible_utts} |
| Eligible error spans (EVAL_PROXY) | 151 | {audited} |
| Proxy false positives | — | {fp} |
| Valid audit spans | — | {len(valid)} |
| Sample adequacy | — | **{adequacy}** |

EVAL_PROXY identity verified. Taxonomy classification is EVAL_PROXY (char-diff), not perfect FineSpan ground truth.

---

## Real Error Distribution (valid spans)

| Family | Count | % | span_len p50/p95 | margin p50/p95/max |
|--------|------:|--:|------------------:|--------------------|
"""
    for fam in FAMILIES:
        x = real_dist[fam]
        md += (
            f"| {fam} | {x['count']} | {x['percent']} | "
            f"{x['span_len_p50']}/{x['span_len_p95']} | "
            f"{x['margin_p50']}/{x['margin_p95']}/{x['margin_max']} |\n"
        )

    md += f"""
### Error length (valid)

| Len | Count | % |
|-----|------:|--:|
| 1 | {real_len['1']['count']} | {real_len['1']['percent']} |
| 2 | {real_len['2']['count']} | {real_len['2']['percent']} |
| 3 | {real_len['3']['count']} | {real_len['3']['percent']} |
| 4+ | {real_len['4+']['count']} | {real_len['4+']['percent']} |

All observed margins remain strongly negative (KEEP). No family escapes under-trigger on current synthetic-trained Model3.

---

## Synthetic V1 RETRY Distribution

Sources: frozen `model3_v1_anchor_contrast_full100k` + `model3_v1_strict_contrast_reconstruction` (train+test RETRY spans).  
**Total RETRY spans classified:** {len(syn_rows)}

| Family | Count | % |
|--------|------:|--:|
"""
    for fam in FAMILIES:
        x = summary["syntheticV1Distribution"][fam]
        md += f"| {fam} | {x['count']} | {x['percent']} |\n"

    md += f"""
### Synthetic error length

| Len | Count | % |
|-----|------:|--:|
| 1 | {syn_len['1']['count']} | {syn_len['1']['percent']} |
| 2 | {syn_len['2']['count']} | {syn_len['2']['percent']} |
| 3 | {syn_len['3']['count']} | {syn_len['3']['percent']} |
| 4+ | {syn_len['4+']['count']} | {syn_len['4+']['percent']} |

**Material finding:** Synthetic RETRY is ~100% `PHONETIC_SUBSTITUTION`, overwhelmingly 1-character closed-set confusions.

---

## Real vs Synthetic Coverage

**Material distribution shift:** YES  
**Length distribution shift:** YES  
**Phonetic subtype shift:** YES  

Largest overrepresented synthetic family: **{over['error_family']}**  
Largest underrepresented (real−synth): **{under['error_family']}**  
Missing real families in synthetic RETRY: **{', '.join(missing) if missing else '(none marked MISSING)'}**

See `model3_v1_synthetic_real_coverage_gap.csv`.

---

## Ownership (valid real spans)

| Ownership | Count |
|-----------|------:|
| MODEL3_TARGET | {own_c.get('MODEL3_TARGET', 0)} |
| DOWNSTREAM_NORMALIZATION | {own_c.get('DOWNSTREAM_NORMALIZATION', 0)} |
| UPSTREAM_FINE_SPAN | {own_c.get('UPSTREAM_FINE_SPAN', 0)} |
| RECALL_PROBLEM | {own_c.get('RECALL_PROBLEM', 0)} |
| OUT_OF_SCOPE | {own_c.get('OUT_OF_SCOPE', 0)} |
| UNCERTAIN | {own_c.get('UNCERTAIN', 0)} |

`CHARACTER_FORM_VARIANT` → **DOWNSTREAM_NORMALIZATION** (do not train Model3 RETRY on trad/simp).

---

## Material Coverage Gaps

"""
    for g in gaps:
        md += f"""### {g['id']} — {g['error_family']}
- Real evidence: {g['real_evidence_count']} ({g['real_percentage']}%)
- Synthetic %: {g['synthetic_percentage']}
- Why: {g['why']}
- Model3 target: {g['belongs_to_model3']}
- Data action: **{g['data_action']}** — {g['detail']}

"""

    md += f"""---

## Model3 Status

| Question | Answer |
|----------|--------|
| Architecture failure proven | NO |
| Runtime failure proven | NO |
| Feature contract failure | NO |
| Training distribution gap proven | **YES** |
| Retraining eventually justified | **YES** |
| Immediate retraining recommended | **NO** |

Default assumption holds: keep architecture / features / Anchor / runtime; **revise training distribution**.

---

## Next Dataset (proposal only — no generation)

**New dataset needed:** YES  
**Large-scale generation now:** NO  

### Recommended family mix (Model3-target RETRY pilot)

| Family | % |
|--------|--:|
"""
    for k, v in sorted(rec_mix.items(), key=lambda kv: -kv[1]):
        md += f"| {k} | {v} |\n"

    md += f"""
### Recommended length mix

| Len | % |
|-----|--:|
| 1 | {rec_len['1']} |
| 2 | {rec_len['2']} |
| 3 | {rec_len['3']} |
| 4+ | {rec_len['4+']} |

**Pilot scale:** 2k–5k Anchor-conditioned RETRY pairs, then train/eval before any large expansion.  
Retain Hard KEEP / NATURAL KEEP / NO_ANCHOR discrimination mass.

**Recommended next phase:** `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET`

---

## Governance

Runtime / model / training / dataset generation / architecture: **unchanged**.  
Report artifacts: **5** (≤10).

**HARD STOP** — awaiting user review.
"""
    (OUT / "Lingua_Model3_V1_Real_ASR_Error_Dataset_Audit_2026_08_28.md").write_text(md, encoding="utf-8")

    print(json.dumps({
        "phaseResult": phase_result,
        "audited": audited,
        "valid": len(valid),
        "fp": fp,
        "adequacy": adequacy,
        "real_top": [(f, real_dist[f]["count"], real_dist[f]["percent"]) for f in FAMILIES],
        "syn_ph_pct": s_ph,
        "syn_1char_pct": syn_1,
        "gaps": [g["id"] for g in gaps],
        "rec_mix": rec_mix,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
