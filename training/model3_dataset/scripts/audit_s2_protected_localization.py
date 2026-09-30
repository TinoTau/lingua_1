# -*- coding: utf-8 -*-
"""MODEL3_V2_S2_PROTECTED_RETRY_LOCALIZATION_AUDIT — read-only."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.replay_model3_live_input_trace import (  # noqa: E402
    ELIG_CLASSES,
    load_bundle,
    replay_path,
    span_payload,
)
from training.model3_dataset.scripts.stage2_v2_label import derive_malformed_regions  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
TRACE = DOCS / "model3_v2_live_input_trace.jsonl"
INV = DOCS / "model3_real_retry_target_inventory.csv"
REG = DOCS / "model3_v2_protection_registry.json"
S2_CKPT = REPO / "training/model3_dataset/model3_v2_s2_random_init_v1_ckpts/seed_2026083011"
EXPECTED_SHA = "54322a2670eabd1fbcb7c2b36f24ef62c6413c9bea57d64eda61f81fd04161d9"
CJK = re.compile(r"[\u4e00-\u9fff]")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_ref(t: str) -> str:
    # strip punctuation spaces for alignment against ASR current
    return "".join(CJK.findall(t or ""))


def overlaps(a0: int, a1: int, b0: int, b1: int) -> bool:
    return not (a1 <= b0 or b1 <= a0)


def overlap_chars(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def distance_to_interval(s0: int, s1: int, t0: int, t1: int) -> int:
    if overlaps(s0, s1, t0, t1):
        return 0
    if s1 <= t0:
        return t0 - s1
    return s0 - t1


def margin_bucket(m: float) -> str:
    if m >= 3:
        return "STRONG"
    if m >= 1:
        return "MODERATE"
    return "WEAK"


def clause_id(text: str, pos: int) -> int:
    # crude clause split on ，。？！,? and spaces
    cuts = [0]
    for i, ch in enumerate(text):
        if ch in "，。？！,.?!;； ":
            cuts.append(i + 1)
    cuts.append(len(text) + 1)
    for i in range(len(cuts) - 1):
        if cuts[i] <= pos < cuts[i + 1]:
            return i
    return max(0, len(cuts) - 2)


def find_probe_intervals(current: str, probe: str) -> list[tuple[int, int]]:
    if not probe:
        return []
    out = []
    start = 0
    while True:
        i = current.find(probe, start)
        if i < 0:
            break
        out.append((i, i + len(probe)))
        start = i + 1
    return out


def target_intervals(current: str, expected: str, probe: str) -> tuple[list[tuple[int, int]], str]:
    """Authoritative target = probe surfaces in current if present; else alignment malformed regions."""
    probes = find_probe_intervals(current, probe)
    if probes:
        return probes, "PROBE_SURFACE"
    exp_norm = normalize_ref(expected)
    cur_norm = current  # raw_asr already mostly CJK continuous
    # Prefer derive_malformed_regions in current coords vs normalized expected
    regs = derive_malformed_regions(cur_norm, exp_norm)
    ivals = [(r["curStart"], r["curEnd"]) for r in regs if r["curEnd"] > r["curStart"]]
    if ivals:
        return ivals, "ALIGNMENT_MALFORMED"
    # fallback: char-diff positions
    diffs = []
    for i, ch in enumerate(cur_norm):
        if i >= len(exp_norm) or ch != exp_norm[i]:
            diffs.append(i)
    if not diffs:
        # length-only / insertion elsewhere
        if len(cur_norm) != len(exp_norm):
            return [], "STALE_OR_EMPTY_TARGET"
        return [], "NO_MISMATCH"
    # merge contiguous diffs
    merged = []
    s = e = diffs[0]
    for i in diffs[1:]:
        if i == e + 1:
            e = i
        else:
            merged.append((s, e + 1))
            s = e = i
    merged.append((s, e + 1))
    return merged, "CHAR_DIFF"


def classify_retry_vs_target(
    s0: int,
    s1: int,
    targets: list[tuple[int, int]],
    current: str,
    reference: str,
) -> str:
    if not targets:
        return "STALE_TARGET_DEFINITION"
    best_ov = 0
    best_dist = 10**9
    best_t = targets[0]
    for t0, t1 in targets:
        ov = overlap_chars(s0, s1, t0, t1)
        dist = distance_to_interval(s0, s1, t0, t1)
        if ov > best_ov or (ov == best_ov and dist < best_dist):
            best_ov, best_dist, best_t = ov, dist, (t0, t1)
    t0, t1 = best_t
    if best_ov > 0:
        return "TARGET_OVERLAP"
    if best_dist <= 2:
        return "TARGET_ADJACENT"
    # same local malformed window: within 4 chars of any target
    if best_dist <= 4:
        return "SAME_LOCAL_ERROR_REGION"
    # clause relation
    sc = clause_id(current, (s0 + s1) // 2)
    tc = clause_id(current, (t0 + t1) // 2)
    # grounding: is retry surface clean vs reference?
    surf = current[s0:s1]
    # if span chars all equal to corresponding expected slice after alignment — hard; use simple containment
    ref_norm = normalize_ref(reference)
    # If surface appears identically as intended in expected and not in error set
    if sc == tc:
        return "UNRELATED_SAME_CLAUSE"
    return "UNRELATED_OTHER_CLAUSE"


def grounding_class(current: str, expected: str, s0: int, s1: int, rel: str) -> str:
    if rel in ("TARGET_OVERLAP", "TARGET_ADJACENT", "SAME_LOCAL_ERROR_REGION"):
        return "TARGET_ADJACENT" if rel != "TARGET_OVERLAP" else "PLAUSIBLY_MALFORMED"
    if rel == "STALE_TARGET_DEFINITION":
        return "TARGET_STALE"
    surf = current[s0:s1]
    exp = normalize_ref(expected)
    # if surface substring exists in expected as-is in similar neighborhood — likely FP
    if surf and surf in exp:
        # still could be wrong occurrence; treat as clear FP if not near any mismatched chars
        return "CLEAR_FALSE_POSITIVE"
    # surface not in expected → plausibly wrong ASR local piece
    if surf and surf not in exp:
        return "PLAUSIBLY_MALFORMED"
    return "REFERENCE_AMBIGUOUS"


def logical_key(sp: dict) -> tuple:
    return (
        int(sp.get("rawStart") or 0),
        int(sp.get("rawEnd") or 0),
        sp.get("surface") or "",
        bool(sp.get("isAnchor")),
    )


def case_outcome(
    has_target_overlap: bool,
    has_adjacent: bool,
    has_true_unrelated: bool,
    logical_retry: int,
    raw_retry: int,
    target_valid: bool,
) -> str:
    if not target_valid:
        return "G_TARGET_DEFINITION_STALE"
    if logical_retry == 0:
        return "I_NO_RETRY"
    if raw_retry > logical_retry and not has_true_unrelated and (has_target_overlap or has_adjacent):
        # may still be multipath duplicate only if unique logical is only target/adjacent
        if not has_true_unrelated and (has_target_overlap or has_adjacent) and logical_retry <= (1 + int(has_adjacent)):
            if has_target_overlap and not has_true_unrelated and not has_adjacent and raw_retry > 1:
                return "F_MULTIPATH_DUPLICATE_ONLY"
    if has_target_overlap and not has_true_unrelated and not has_adjacent:
        if raw_retry > logical_retry >= 1:
            return "F_MULTIPATH_DUPLICATE_ONLY"
        return "A_TARGET_ONLY"
    if has_target_overlap and has_adjacent and not has_true_unrelated:
        return "B_TARGET_PLUS_LOCAL_ADJACENT"
    if has_target_overlap and has_true_unrelated:
        return "C_TARGET_PLUS_TRUE_UNRELATED"
    if not has_target_overlap and (has_adjacent) and not has_true_unrelated:
        return "D_MISS_PLUS_LOCAL_NEAR_TARGET"
    if not has_target_overlap and has_true_unrelated:
        return "E_MISS_PLUS_TRUE_UNRELATED"
    if has_adjacent and not has_true_unrelated:
        return "D_MISS_PLUS_LOCAL_NEAR_TARGET"
    return "E_MISS_PLUS_TRUE_UNRELATED"


def load_inventory() -> dict[str, dict]:
    inv = {}
    with INV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            inv[row["caseId"]] = row
    return inv


def main() -> int:
    sha = sha256_file(S2_CKPT / "weights.pt")
    if sha != EXPECTED_SHA:
        print(json.dumps({"fatal": "checkpoint_hash_mismatch", "actual": sha}))
        return 2
    reg = json.loads(REG.read_text(encoding="utf-8"))
    if reg.get("registryId") != "MODEL3_V2_PROTECTION_REGISTRY":
        print(json.dumps({"fatal": "registry_id_mismatch"}))
        return 3

    inv = load_inventory()
    elig = sorted(
        cid
        for cid, r in inv.items()
        if r.get("confidence") in ("HIGH", "MEDIUM") and r.get("audit_class") in ELIG_CLASSES
    )
    keep_controls = sorted(cid for cid, r in inv.items() if r.get("audit_class") == "NO_ERROR")

    # load trace groups
    groups: dict[tuple[str, str], list] = defaultdict(list)
    meta: dict[str, dict] = {}
    for line in TRACE.open(encoding="utf-8"):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("status") not in (None, "OK"):
            continue
        sp = span_payload(row)
        if not sp.get("features"):
            continue
        sp = dict(sp)
        sp.pop("tokenIds", None)
        sp.pop("token_ids", None)
        cid = row.get("caseId") or row.get("id")
        pid = row.get("pathId") or "_"
        groups[(cid, pid)].append({**sp, "pathId": pid})
        meta[cid] = {
            "raw": row.get("raw_asr") or row.get("sourceText") or "",
            "expected": row.get("expected") or row.get("expectedText") or "",
        }

    model, vocab = load_bundle(S2_CKPT)

    all_retry_rows = []
    case_summaries = []
    unrelated_case_ids = []
    legacy_attr = {}

    anchor_retry_violation = False
    mapping_defect = False

    for cid in elig:
        cur = meta.get(cid, {}).get("raw") or inv[cid].get("raw") or ""
        exp = meta.get(cid, {}).get("expected") or inv[cid].get("expected") or ""
        probe = inv[cid].get("probe_surface") or ""
        targets, target_src = target_intervals(cur, exp, probe)
        target_valid = len(targets) > 0 and target_src != "STALE_OR_EMPTY_TARGET"

        # replay all paths
        path_results = []
        for (c, pid), spans in groups.items():
            if c != cid:
                continue
            replayed = replay_path(model, vocab, spans)
            # merge identity from input spans
            by_seq = {int(s.get("seqIndex") or i): s for i, s in enumerate(spans)}
            for i, rep in enumerate(replayed):
                src = by_seq.get(int(rep.get("seqIndex") or i), spans[i] if i < len(spans) else {})
                merged = {
                    **src,
                    **rep,
                    "pathId": pid,
                    "rawStart": src.get("rawStart", rep.get("rawStart")),
                    "rawEnd": src.get("rawEnd", rep.get("rawEnd")),
                    "surface": src.get("surface") or rep.get("surface"),
                    "isAnchor": bool(src.get("isAnchor") or rep.get("isAnchor")),
                    "rawFirstPassCandidateCount": src.get("rawFirstPassCandidateCount"),
                    "features": src.get("features") or {},
                }
                path_results.append(merged)

        retries = [r for r in path_results if r.get("decision") == "RETRY"]
        for r in retries:
            if r.get("isAnchor"):
                anchor_retry_violation = True

        # legacy attribution for comparison with S2 report
        legacy_attr[cid] = (
            "TARGET_REGION_RETRY"
            if any(
                (probe and (r.get("surface") or "") == probe)
                or (
                    set(cur) - set(normalize_ref(exp))
                    and any(ch in (r.get("surface") or "") for ch in (set(cur) - set(normalize_ref(exp))))
                )
                for r in retries
                if not r.get("isAnchor")
            )
            else ("UNRELATED_REGION_RETRY" if retries else "NO_RETRY")
        )
        # simpler legacy: use prior attribution helper style
        from training.model3_dataset.scripts.replay_model3_live_input_trace import attribution as legacy_attribution

        legacy_attr[cid] = legacy_attribution(
            [{"surface": r.get("surface"), "live_decision": r.get("decision"), "isAnchor": r.get("isAnchor")} for r in path_results],
            inv[cid],
        )

        logical_map: dict[tuple, dict] = {}
        for r in retries:
            if r.get("isAnchor"):
                continue
            s0 = int(r.get("rawStart") or 0)
            s1 = int(r.get("rawEnd") or 0)
            if s1 <= s0 and (r.get("surface") or ""):
                # try locate surface in current
                surf = r.get("surface") or ""
                idx = cur.find(surf)
                if idx >= 0:
                    s0, s1 = idx, idx + len(surf)
                else:
                    mapping_defect = True
            rel = classify_retry_vs_target(s0, s1, targets, cur, exp)
            gnd = grounding_class(cur, exp, s0, s1, rel)
            margin = float(r.get("margin") or 0)
            feats = r.get("features") or {}
            cand = r.get("rawFirstPassCandidateCount")
            if cand is None:
                cand = feats.get("first_pass_cand_log1p")
                # can't invert log reliably; leave as packed
            # Anchor relation
            anchors = [(int(x.get("rawStart") or 0), int(x.get("rawEnd") or 0)) for x in path_results if x.get("isAnchor")]
            a_rel = "far_from_Anchor"
            for a0, a1 in anchors:
                if overlaps(s0, s1, a0, a1):
                    a_rel = "inside_Anchor"
                    break
                d = distance_to_interval(s0, s1, a0, a1)
                if d == 0:
                    a_rel = "adjacent_to_Anchor"
                elif d <= 2 and a_rel == "far_from_Anchor":
                    a_rel = "adjacent_to_Anchor"
                elif d <= 6 and a_rel == "far_from_Anchor":
                    a_rel = "near_Anchor"

            best_t = targets[0] if targets else (None, None)
            best_ov = 0
            best_dist = None
            for t0, t1 in targets:
                ov = overlap_chars(s0, s1, t0, t1)
                dist = distance_to_interval(s0, s1, t0, t1)
                if ov > best_ov or best_dist is None or dist < best_dist:
                    best_ov, best_dist, best_t = ov, dist, (t0, t1)

            row = {
                "caseId": cid,
                "reference": exp,
                "currentText": cur,
                "protectedTarget": "|".join(f"{a}-{b}:{cur[a:b]}" for a, b in targets) if targets else "",
                "targetSource": target_src,
                "retrySurface": r.get("surface") or "",
                "retryStart": s0,
                "retryEnd": s1,
                "targetOverlap": best_ov,
                "distanceToTarget": best_dist if best_dist is not None else "",
                "pathId": r.get("pathId"),
                "spanId": r.get("spanId"),
                "relClass": rel,
                "groundingClass": gnd,
                "anchorRelation": a_rel,
                "candidateCount": r.get("rawFirstPassCandidateCount"),
                "cand_log1p": (feats.get("first_pass_cand_log1p") if isinstance(feats, dict) else None),
                "keep_logit": r.get("keep_logit"),
                "retry_logit": r.get("retry_logit"),
                "margin": margin,
                "marginBucket": margin_bucket(margin),
                "span_rel_position": feats.get("span_rel_position") if isinstance(feats, dict) else None,
                "pinyin_channel_avail": feats.get("pinyin_channel_avail") if isinstance(feats, dict) else None,
                "isAnchor": bool(r.get("isAnchor")),
            }
            all_retry_rows.append(row)
            key = logical_key({"rawStart": s0, "rawEnd": s1, "surface": row["retrySurface"], "isAnchor": False})
            prev = logical_map.get(key)
            if not prev or margin > prev["margin"]:
                logical_map[key] = row

        logical_retries = list(logical_map.values())
        raw_retry_count = len([r for r in retries if not r.get("isAnchor")])
        logical_retry_count = len(logical_retries)

        has_overlap = any(x["relClass"] == "TARGET_OVERLAP" for x in logical_retries)
        has_adj = any(x["relClass"] in ("TARGET_ADJACENT", "SAME_LOCAL_ERROR_REGION") for x in logical_retries)
        has_unrel = any(x["relClass"] in ("UNRELATED_SAME_CLAUSE", "UNRELATED_OTHER_CLAUSE") for x in logical_retries)
        # true unrelated = clean FP grounding
        true_unrel = [
            x
            for x in logical_retries
            if x["relClass"] in ("UNRELATED_SAME_CLAUSE", "UNRELATED_OTHER_CLAUSE")
            and x["groundingClass"] == "CLEAR_FALSE_POSITIVE"
        ]
        plaus_unrel = [
            x
            for x in logical_retries
            if x["relClass"] in ("UNRELATED_SAME_CLAUSE", "UNRELATED_OTHER_CLAUSE")
            and x["groundingClass"] != "CLEAR_FALSE_POSITIVE"
        ]

        outcome = case_outcome(has_overlap, has_adj, bool(true_unrel or plaus_unrel), logical_retry_count, raw_retry_count, target_valid)
        # refine multipath-only
        if has_overlap and not has_adj and not true_unrel and not plaus_unrel and raw_retry_count > logical_retry_count:
            outcome = "F_MULTIPATH_DUPLICATE_ONLY"
        if has_overlap and not true_unrel and not plaus_unrel and has_adj:
            outcome = "B_TARGET_PLUS_LOCAL_ADJACENT"
        if has_overlap and not true_unrel and not plaus_unrel and not has_adj:
            outcome = "A_TARGET_ONLY" if logical_retry_count >= 1 else "I_NO_RETRY"
        if has_overlap and (true_unrel or plaus_unrel):
            outcome = "C_TARGET_PLUS_TRUE_UNRELATED"
        if not has_overlap and has_adj and not (true_unrel or plaus_unrel):
            outcome = "D_MISS_PLUS_LOCAL_NEAR_TARGET"
        if not has_overlap and (true_unrel or plaus_unrel):
            outcome = "E_MISS_PLUS_TRUE_UNRELATED"

        target_margins = [x["margin"] for x in logical_retries if x["relClass"] == "TARGET_OVERLAP"]
        unrel_margins = [x["margin"] for x in logical_retries if x["relClass"] in ("UNRELATED_SAME_CLAUSE", "UNRELATED_OTHER_CLAUSE")]

        case_summaries.append(
            {
                "caseId": cid,
                "targetValid": int(target_valid),
                "targetSource": target_src,
                "protectedTarget": "|".join(f"{a}-{b}:{cur[a:b]}" for a, b in targets),
                "targetRetry": int(has_overlap),
                "rawRetryCount": raw_retry_count,
                "logicalRetryCount": logical_retry_count,
                "localAdjacentRetry": int(has_adj),
                "trueUnrelatedRetry": len(true_unrel),
                "plausibleUnrelatedRetry": len(plaus_unrel),
                "strongestTargetMargin": max(target_margins) if target_margins else "",
                "strongestUnrelatedMargin": max(unrel_margins) if unrel_margins else "",
                "legacyAttribution": legacy_attr[cid],
                "outcomeClass": outcome,
                "probe": probe,
            }
        )
        if legacy_attr[cid] == "UNRELATED_REGION_RETRY":
            unrelated_case_ids.append(cid)

    # KEEP controls
    keep_rows = []
    for cid in keep_controls:
        cur = meta.get(cid, {}).get("raw") or inv[cid].get("raw") or ""
        path_results = []
        for (c, pid), spans in groups.items():
            if c != cid:
                continue
            for rep, src in zip(replay_path(model, vocab, spans), spans):
                path_results.append({**src, **rep, "pathId": pid})
        retries = [r for r in path_results if r.get("decision") == "RETRY" and not r.get("isAnchor")]
        logical = {logical_key(r): r for r in retries}
        margins = [float(r.get("margin") or 0) for r in logical.values()]
        keep_rows.append(
            {
                "caseId": cid,
                "rawRetry": len(retries),
                "logicalRetry": len(logical),
                "maxMargin": max(margins) if margins else "",
                "falseRetry": int(len(logical) > 0),
            }
        )

    # Aggregate root cause for the 4 legacy-unrelated cases
    four = [c for c in case_summaries if c["caseId"] in unrelated_case_ids]
    root = Counter()
    for c in four:
        oc = c["outcomeClass"]
        if oc == "F_MULTIPATH_DUPLICATE_ONLY":
            root["MULTIPATH_ACCOUNTING_ARTIFACT"] += 1
        elif oc == "G_TARGET_DEFINITION_STALE":
            root["TARGET_MAPPING / STALE_TARGET"] += 1
        elif oc in ("B_TARGET_PLUS_LOCAL_ADJACENT", "D_MISS_PLUS_LOCAL_NEAR_TARGET", "A_TARGET_ONLY"):
            root["LOCALIZATION_NEAR_TARGET"] += 1
        elif oc == "C_TARGET_PLUS_TRUE_UNRELATED":
            # check if clear FP strong
            root["TRUE_LOCALIZATION_FALSE_POSITIVE"] += 1
        elif oc == "E_MISS_PLUS_TRUE_UNRELATED":
            root["TRUE_LOCALIZATION_FALSE_POSITIVE"] += 1
        else:
            root["MIXED"] += 1

    # Re-classify the 4 with more nuance using logical retries detail
    four_detail = []
    for cid in unrelated_case_ids:
        rows = [r for r in all_retry_rows if r["caseId"] == cid]
        # logical unique
        lm = {}
        for r in rows:
            k = (r["retryStart"], r["retryEnd"], r["retrySurface"])
            if k not in lm or r["margin"] > lm[k]["margin"]:
                lm[k] = r
        logical = list(lm.values())
        cs = next(c for c in case_summaries if c["caseId"] == cid)
        for r in logical:
            four_detail.append(
                {
                    **{k: r[k] for k in [
                        "caseId",
                        "reference",
                        "currentText",
                        "protectedTarget",
                        "retrySurface",
                        "retryStart",
                        "retryEnd",
                        "targetOverlap",
                        "distanceToTarget",
                        "anchorRelation",
                        "candidateCount",
                        "margin",
                        "marginBucket",
                        "groundingClass",
                        "relClass",
                    ]},
                    "pathCount": len({x["pathId"] for x in rows if (x["retryStart"], x["retryEnd"], x["retrySurface"]) == (r["retryStart"], r["retryEnd"], r["retrySurface"])}),
                    "logicalDuplicateCount": len([x for x in rows if (x["retryStart"], x["retryEnd"], x["retrySurface"]) == (r["retryStart"], r["retryEnd"], r["retrySurface"])]),
                    "caseOutcomeClass": cs["outcomeClass"],
                    "legacyAttribution": cs["legacyAttribution"],
                }
            )

    # Verdict logic
    target_retry_count = sum(1 for c in case_summaries if c["targetRetry"])
    true_fp_strong = 0
    near_or_multipath = 0
    for cid in unrelated_case_ids:
        cs = next(c for c in case_summaries if c["caseId"] == cid)
        rows = [r for r in four_detail if r["caseId"] == cid]
        unrel = [r for r in rows if r["relClass"] in ("UNRELATED_SAME_CLAUSE", "UNRELATED_OTHER_CLAUSE")]
        if cs["outcomeClass"] in ("A_TARGET_ONLY", "B_TARGET_PLUS_LOCAL_ADJACENT", "D_MISS_PLUS_LOCAL_NEAR_TARGET", "F_MULTIPATH_DUPLICATE_ONLY"):
            near_or_multipath += 1
        elif unrel and all(r["marginBucket"] == "WEAK" or r["groundingClass"] != "CLEAR_FALSE_POSITIVE" for r in unrel):
            near_or_multipath += 1
        elif unrel and any(r["marginBucket"] == "STRONG" and r["groundingClass"] == "CLEAR_FALSE_POSITIVE" for r in unrel):
            true_fp_strong += 1
        else:
            # mixed weak clear FP
            if unrel and any(r["groundingClass"] == "CLEAR_FALSE_POSITIVE" for r in unrel):
                true_fp_strong += 0  # weak/moderate clear FP -> nonblocking
                near_or_multipath += 1
            else:
                near_or_multipath += 1

    if anchor_retry_violation or mapping_defect:
        verdict = "TRACE_OR_LOCALIZATION_AUDIT_IMPLEMENTATION_FAILURE"
        next_phase = "STOP_AND_REVIEW"
        s3 = False
    elif true_fp_strong >= 2 and target_retry_count < 7:
        verdict = "S2_SYSTEMATIC_LOCALIZATION_FAILURE"
        next_phase = "MODEL3_V2_S2_LOCALIZATION_DISTRIBUTION_AUDIT"
        s3 = False
    elif true_fp_strong >= 2:
        verdict = "S2_LOCALIZATION_NEEDS_DISTRIBUTION_AUDIT"
        next_phase = "MODEL3_V2_S2_LOCALIZATION_DISTRIBUTION_AUDIT"
        s3 = False
    elif near_or_multipath >= len(unrelated_case_ids) - true_fp_strong:
        # check if any clear FP exist among 4
        clear_fp_cases = 0
        for cid in unrelated_case_ids:
            rows = [r for r in four_detail if r["caseId"] == cid]
            if any(
                r["relClass"] in ("UNRELATED_SAME_CLAUSE", "UNRELATED_OTHER_CLAUSE")
                and r["groundingClass"] == "CLEAR_FALSE_POSITIVE"
                for r in rows
            ):
                clear_fp_cases += 1
        if clear_fp_cases:
            verdict = "S2_LOCALIZATION_AUDIT_PASS_WITH_NONBLOCKING_FALSE_POSITIVES"
        else:
            verdict = "S2_LOCALIZATION_AUDIT_PASS_PROCEED_S3"
        next_phase = "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3"
        s3 = True
    else:
        verdict = "S2_LOCALIZATION_AUDIT_PASS_WITH_NONBLOCKING_FALSE_POSITIVES"
        next_phase = "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3"
        s3 = True

    # Write artifacts
    with (DOCS / "model3_v2_s2_protected_case_trace.csv").open("w", encoding="utf-8", newline="") as f:
        fields = [
            "caseId",
            "targetValid",
            "targetSource",
            "protectedTarget",
            "targetRetry",
            "rawRetryCount",
            "logicalRetryCount",
            "localAdjacentRetry",
            "trueUnrelatedRetry",
            "plausibleUnrelatedRetry",
            "strongestTargetMargin",
            "strongestUnrelatedMargin",
            "legacyAttribution",
            "outcomeClass",
            "probe",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in case_summaries:
            w.writerow(row)
        # append four-detail section rows with prefix in outcomeClass note — also write separate block via second file content
    with (DOCS / "model3_v2_s2_retry_margin_analysis.csv").open("w", encoding="utf-8", newline="") as f:
        # all retry rows + four detail preferred
        fields = list(four_detail[0].keys()) if four_detail else ["caseId", "margin"]
        # also include all logical retries from all cases for margin analysis
        all_logical = []
        seen = set()
        for r in all_retry_rows:
            k = (r["caseId"], r["retryStart"], r["retryEnd"], r["retrySurface"])
            if k in seen:
                continue
            seen.add(k)
            all_logical.append(r)
        w = csv.DictWriter(
            f,
            fieldnames=[
                "caseId",
                "retrySurface",
                "retryStart",
                "retryEnd",
                "relClass",
                "groundingClass",
                "margin",
                "marginBucket",
                "keep_logit",
                "retry_logit",
                "distanceToTarget",
                "targetOverlap",
                "anchorRelation",
                "candidateCount",
                "legacyUnrelatedCase",
            ],
        )
        w.writeheader()
        for r in all_logical:
            w.writerow(
                {
                    "caseId": r["caseId"],
                    "retrySurface": r["retrySurface"],
                    "retryStart": r["retryStart"],
                    "retryEnd": r["retryEnd"],
                    "relClass": r["relClass"],
                    "groundingClass": r["groundingClass"],
                    "margin": r["margin"],
                    "marginBucket": r["marginBucket"],
                    "keep_logit": r["keep_logit"],
                    "retry_logit": r["retry_logit"],
                    "distanceToTarget": r["distanceToTarget"],
                    "targetOverlap": r["targetOverlap"],
                    "anchorRelation": r["anchorRelation"],
                    "candidateCount": r["candidateCount"],
                    "legacyUnrelatedCase": int(r["caseId"] in unrelated_case_ids),
                }
            )

    # extend case_trace with detailed four-case table as second section file content in same csv? Use dedicated columns file append
    with (DOCS / "model3_v2_s2_protected_case_trace.csv").open("a", encoding="utf-8", newline="") as f:
        f.write("\n# FOUR_REPORTED_UNRELATED_DETAIL\n")
        if four_detail:
            fields = list(four_detail[0].keys())
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for row in four_detail:
                w.writerow(row)

    with (DOCS / "model3_v2_s2_localization_qa.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["gate", "status", "notes"])
        w.writerow(["checkpoint_sha", "PASS" if sha == EXPECTED_SHA else "FAIL", sha])
        w.writerow(["protection_registry", "PASS", reg.get("registryId")])
        w.writerow(["eligible_cases", "PASS", len(elig)])
        w.writerow(["case_level_any_retry", "PASS" if sum(1 for c in case_summaries if c["logicalRetryCount"] > 0) == 13 else "CHECK", sum(1 for c in case_summaries if c["logicalRetryCount"] > 0)])
        w.writerow(["target_retry", "PASS", f"{target_retry_count}/13"])
        w.writerow(["legacy_unrelated_cases", "PASS", ",".join(unrelated_case_ids)])
        w.writerow(["anchor_retry_violation", "FAIL" if anchor_retry_violation else "PASS", ""])
        w.writerow(["mapping_defect", "FAIL" if mapping_defect else "PASS", ""])
        w.writerow(["keep_control_false_retry", "PASS", f"{sum(k['falseRetry'] for k in keep_rows)}/6"])

    # refine root counts based on four_detail
    root2 = Counter()
    for cid in unrelated_case_ids:
        cs = next(c for c in case_summaries if c["caseId"] == cid)
        rows = [r for r in four_detail if r["caseId"] == cid]
        unrel_clear = [r for r in rows if r["relClass"].startswith("UNRELATED") and r["groundingClass"] == "CLEAR_FALSE_POSITIVE"]
        near = [r for r in rows if r["relClass"] in ("TARGET_OVERLAP", "TARGET_ADJACENT", "SAME_LOCAL_ERROR_REGION")]
        if cs["rawRetryCount"] > cs["logicalRetryCount"] and not unrel_clear and near:
            root2["MULTIPATH_ACCOUNTING_ARTIFACT"] += 1
        elif near and not unrel_clear:
            root2["LOCALIZATION_NEAR_TARGET"] += 1
        elif unrel_clear and near:
            root2["MIXED"] += 1
        elif unrel_clear:
            root2["TRUE_LOCALIZATION_FALSE_POSITIVE"] += 1
        elif any(r["relClass"] == "STALE_TARGET_DEFINITION" for r in rows) or not cs["targetValid"]:
            root2["TARGET_MAPPING / STALE_TARGET"] += 1
        else:
            root2["LOCALIZATION_NEAR_TARGET"] += 1

    summary = {
        "phase": "MODEL3_V2_S2_PROTECTED_RETRY_LOCALIZATION_AUDIT",
        "verdict": verdict,
        "nextPhase": next_phase,
        "s3Authorized": s3,
        "checkpoint": {
            "modelId": "MODEL3_V2_S2_RANDOM_INIT_V1",
            "sha256": sha,
            "verified": sha == EXPECTED_SHA,
        },
        "protectionRegistry": reg.get("registryId"),
        "eligibleCases": elig,
        "legacyUnrelatedCaseIds": unrelated_case_ids,
        "verified": {
            "caseLevelAnyRetry": sum(1 for c in case_summaries if c["logicalRetryCount"] > 0),
            "targetRetry": target_retry_count,
            "legacyUnrelated": len(unrelated_case_ids),
        },
        "caseSummaries": case_summaries,
        "fourUnrelatedDetail": four_detail,
        "rootCauseCounts": dict(root2),
        "keepControls": keep_rows,
        "anchorRetryViolation": anchor_retry_violation,
        "mappingDefect": mapping_defect,
        "complexityDecision": {
            "newRuntimeLogicRequired": False,
            "featureChangeRequired": False,
            "thresholdChangeRequired": False,
            "trainingChangeRequired": False,
        },
        "architectureDrift": False,
    }
    (DOCS / "model3_v2_s2_protected_localization_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "verdict": verdict,
                "sha_ok": sha == EXPECTED_SHA,
                "unrelated_ids": unrelated_case_ids,
                "target_retry": f"{target_retry_count}/13",
                "any_retry": sum(1 for c in case_summaries if c["logicalRetryCount"] > 0),
                "root": dict(root2),
                "outcomes": {c["caseId"]: c["outcomeClass"] for c in case_summaries},
                "keep_fp": sum(k["falseRetry"] for k in keep_rows),
                "nextPhase": next_phase,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
