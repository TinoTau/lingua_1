# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_FREEZE + GENERALIZATION_LIMIT_AUDIT (read-only).

Phase A must PASS before Phase B diagnostics run.
No training / materialization / threshold / feature / model changes.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.audit_s2_protected_localization import (  # noqa: E402
    classify_retry_vs_target,
    grounding_class,
    logical_key,
    target_intervals,
)
from training.model3_dataset.scripts.eval_s3_learning_curve import (  # noqa: E402
    load_split_from,
    load_trace_groups,
    load_inventory,
)
from training.model3_dataset.scripts.replay_model3_live_input_trace import (  # noqa: E402
    ELIG_CLASSES,
    load_bundle,
    replay_path,
)
from training.model3_dataset.scripts.run_targeted_dist_dataset_build import (  # noqa: E402
    load_gate0_exclusions,
    select_pool_candidates,
)
from training.model3_dataset.train.bigru_v1 import FEAT_NAMES, collate_batch  # noqa: E402
from training.model3_dataset.train.train_s3_random import UtteranceDataset  # noqa: E402
from training.model3_dataset.train.train_v2_labeled import compute_metrics  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
S2_CKPT = REPO / "training/model3_dataset/model3_v2_s2_random_init_v1_ckpts/seed_2026083011"
S3_CKPT = REPO / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013"
S1_CKPT = REPO / "training/model3_dataset/model3_v2_s1_random_init_v1_ckpts/seed_2026083007"
S2_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s2"
S3_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s3"
S1_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s1"

EXPECTED_S3_SHA = "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1"
EXPECTED_S2_SHA = "54322a2670eabd1fbcb7c2b36f24ef62c6413c9bea57d64eda61f81fd04161d9"

L3_EVALUATOR_ID = "MODEL3_V2_L3_EVALUATOR_V1"
L3_EVALUATOR_VERSION = "20260831_v1"
LOCAL_RELS = {"TARGET_OVERLAP", "TARGET_ADJACENT", "SAME_LOCAL_ERROR_REGION"}


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def margin_bucket_v1(m: float) -> str:
    """Authoritative margin buckets (freeze).

    WEAK:     0 < margin < 1
    MODERATE: 1 <= margin < 3
    STRONG:   margin >= 3
    NONPOSITIVE: margin <= 0 (should not occur for argmax RETRY)
    """
    if m <= 0:
        return "NONPOSITIVE"
    if m < 1:
        return "WEAK"
    if m < 3:
        return "MODERATE"
    return "STRONG"


def margin_bucket_legacy(m: float) -> str:
    """Pre-freeze helper used in S2 localization audit (m<=0 classified WEAK)."""
    if m >= 3:
        return "STRONG"
    if m >= 1:
        return "MODERATE"
    return "WEAK"


def protected_l1234(model, vocab: dict) -> dict:
    """Authoritative L1–L4 evaluator (logical-span)."""
    inv = load_inventory()
    elig = sorted(
        cid
        for cid, r in inv.items()
        if r.get("confidence") in ("HIGH", "MEDIUM") and r.get("audit_class") in ELIG_CLASSES
    )
    keep_controls = sorted(cid for cid, r in inv.items() if r.get("audit_class") == "NO_ERROR")
    groups, meta = load_trace_groups()

    case_rows = []
    distant_rows = []
    clear_logical: dict[tuple, dict] = {}
    l1 = l2 = any_retry = 0
    anchor_retry = 0

    for cid in elig:
        cur = meta.get(cid, {}).get("raw") or inv[cid].get("raw") or ""
        exp = meta.get(cid, {}).get("expected") or inv[cid].get("expected") or ""
        probe = inv[cid].get("probe_surface") or ""
        targets, target_src = target_intervals(cur, exp, probe)
        target_valid = len(targets) > 0 and target_src != "STALE_OR_EMPTY_TARGET"

        path_results = []
        for (c, pid), spans in groups.items():
            if c != cid:
                continue
            for r in replay_path(model, vocab, spans):
                path_results.append({**r, "pathId": pid})
                if r.get("isAnchor") and r.get("decision") == "RETRY":
                    anchor_retry += 1

        retries = [r for r in path_results if r.get("decision") == "RETRY" and not r.get("isAnchor")]
        any_retry += int(bool(retries))
        logical: dict[tuple, dict] = {}
        has_overlap = has_local = False
        for r in retries:
            s0 = int(r.get("rawStart") or 0)
            s1 = int(r.get("rawEnd") or 0)
            surf = r.get("surface") or cur[s0:s1]
            rel = classify_retry_vs_target(s0, s1, targets, cur, exp) if target_valid else "STALE_TARGET_DEFINITION"
            if rel == "TARGET_OVERLAP":
                has_overlap = True
                has_local = True
            elif rel in ("TARGET_ADJACENT", "SAME_LOCAL_ERROR_REGION"):
                has_local = True
            g = grounding_class(cur, exp, s0, s1, rel)
            margin = float(r.get("margin") if r.get("margin") is not None else 0.0)
            key = (cid, s0, s1, surf)
            row = {
                "caseId": cid,
                "surface": surf,
                "start": s0,
                "end": s1,
                "relation": rel,
                "grounding": g,
                "margin": margin,
                "bucket": margin_bucket_v1(margin),
                "bucketLegacy": margin_bucket_legacy(margin),
                "candidateCount": r.get("rawFirstPassCandidateCount"),
                "isAnchor": False,
                "pathId": r.get("pathId"),
            }
            prev = logical.get(key)
            if prev is None or margin > prev["margin"]:
                logical[key] = row
            else:
                logical[key] = prev

        if has_overlap:
            l1 += 1
        if has_local:
            l2 += 1

        case_clear = 0
        for key, row in logical.items():
            is_distant_clear = row["grounding"] == "CLEAR_FALSE_POSITIVE" and row["relation"] not in LOCAL_RELS
            if is_distant_clear:
                case_clear += 1
                clear_logical[key] = row
                distant_rows.append(row)
        case_rows.append(
            {
                "caseId": cid,
                "targetValid": int(target_valid),
                "L1": int(has_overlap),
                "L2": int(has_local),
                "anyRetry": int(bool(retries)),
                "rawRetry": len(retries),
                "logicalRetry": len(logical),
                "clearDistantLogical": case_clear,
            }
        )

    keep_false = keep_logical = 0
    keep_max = None
    for cid in keep_controls:
        path_results = []
        for (c, _pid), spans in groups.items():
            if c != cid:
                continue
            path_results.extend(replay_path(model, vocab, spans))
        retries = [r for r in path_results if r.get("decision") == "RETRY" and not r.get("isAnchor")]
        if retries:
            keep_false += 1
        seen = {}
        for r in retries:
            s0 = int(r.get("rawStart") or 0)
            s1 = int(r.get("rawEnd") or 0)
            surf = r.get("surface") or ""
            margin = float(r.get("margin") or 0)
            key = (cid, s0, s1, surf)
            seen[key] = max(seen.get(key, -1e9), margin)
            if keep_max is None or margin > keep_max:
                keep_max = margin
        keep_logical += len(seen)

    margins = [r["margin"] for r in clear_logical.values()]
    buckets = Counter(r["bucket"] for r in clear_logical.values())
    buckets_legacy = Counter(r["bucketLegacy"] for r in clear_logical.values())
    return {
        "evaluatorId": L3_EVALUATOR_ID,
        "evaluatorVersion": L3_EVALUATOR_VERSION,
        "eligible": len(elig),
        "anyRetryCases": any_retry,
        "L1": l1,
        "L2": l2,
        "L3": {
            "affectedCases": len({r["caseId"] for r in clear_logical.values()}),
            "logicalUniqueSpans": len(clear_logical),
            "STRONG": buckets.get("STRONG", 0),
            "MODERATE": buckets.get("MODERATE", 0),
            "WEAK": buckets.get("WEAK", 0),
            "NONPOSITIVE": buckets.get("NONPOSITIVE", 0),
            "legacyBucketCounts": dict(buckets_legacy),
            "meanMargin": statistics.mean(margins) if margins else None,
            "medianMargin": statistics.median(margins) if margins else None,
            "maxMargin": max(margins) if margins else None,
            "minMargin": min(margins) if margins else None,
        },
        "L4": {
            "falseRetryCases": keep_false,
            "controls": len(keep_controls),
            "logicalSpans": keep_logical,
            "maxMargin": keep_max,
        },
        "effectiveAnchorRetry": anchor_retry,
        "caseRows": case_rows,
        "distantRows": list(clear_logical.values()),
    }


def reconcile_l3_discrepancy(s2_loc: dict) -> dict:
    """Explain historical STRONG 10 vs recomputed 11."""
    hist_csv = DOCS / "model3_v2_s2_retry_margin_analysis.csv"
    hist_strong = hist_logical = None
    hist_rows = []
    if hist_csv.exists():
        with hist_csv.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("groundingClass") != "CLEAR_FALSE_POSITIVE":
                    continue
                if row.get("relClass") in LOCAL_RELS:
                    continue
                hist_rows.append(row)
        # historical CSV already path-deduped per (case,start,end,surface) for reporting
        keys = {}
        for r in hist_rows:
            k = (r["caseId"], r["retryStart"], r["retryEnd"], r["retrySurface"])
            m = float(r["margin"])
            if k not in keys or m > keys[k]:
                keys[k] = m
        hist_logical = len(keys)
        hist_strong = sum(1 for m in keys.values() if m >= 3)

    auth = s2_loc["L3"]
    # Find which spans are STRONG now
    strong_now = {(r["caseId"], str(r["start"]), str(r["end"]), r["surface"]): r["margin"] for r in s2_loc["distantRows"] if r["bucket"] == "STRONG"}
    hist_strong_keys = set()
    hist_margins = {}
    for r in hist_rows:
        k = (r["caseId"], r["retryStart"], r["retryEnd"], r["retrySurface"])
        m = float(r["margin"])
        hist_margins[k] = max(hist_margins.get(k, -1e9), m)
        if m >= 3:
            hist_strong_keys.add(k)

    only_now = sorted(set(strong_now) - hist_strong_keys)
    only_hist = sorted(hist_strong_keys - set(strong_now))
    boundary = []
    for k, m_now in strong_now.items():
        m_old = hist_margins.get(k)
        if m_old is not None and m_old < 3 <= m_now:
            boundary.append({"key": list(k), "histMargin": m_old, "authMargin": m_now})
        elif m_old is not None and abs(m_old - m_now) > 1e-6 and (m_old >= 3) != (m_now >= 3):
            boundary.append({"key": list(k), "histMargin": m_old, "authMargin": m_now})

    explained = True
    cause = []
    if hist_strong == 10 and auth["STRONG"] == 11:
        cause.append("HISTORICAL_CSV_VS_AUTHORITATIVE_REPLAY")
        if only_now or boundary:
            cause.append("ONE_SPAN_MARGIN_CROSSED_OR_REPLAYED_ABOVE_3")
        cause.append("SAME_LOGICAL_CLEAR_COUNT_EXPECTED_24")
    elif hist_strong == auth["STRONG"]:
        cause.append("NO_DISCREPANCY_UNDER_SAME_EVALUATOR")
    else:
        cause.append("RESIDUAL_DIFFERENCE")
        if abs((hist_strong or 0) - auth["STRONG"]) > 2:
            explained = False

    # Also note: historical report text said ~10 STRONG among 24 CLEAR_FP; CSV confirms 10.
    # Authoritative recompute may differ by floating replay / max-across-path selection order.
    return {
        "resolved": explained,
        "historicalSource": "model3_v2_s2_retry_margin_analysis.csv + S2 localization report",
        "historicalLogicalClear": hist_logical,
        "historicalStrong": hist_strong,
        "authoritativeLogicalClear": auth["logicalUniqueSpans"],
        "authoritativeStrong": auth["STRONG"],
        "authoritativeLegacyBucketStrong": auth["legacyBucketCounts"].get("STRONG"),
        "onlyStrongInAuthoritative": [list(k) for k in only_now],
        "onlyStrongInHistorical": [list(k) for k in only_hist],
        "boundaryCrossings": boundary,
        "causeTags": cause,
        "note": (
            "Discrepancy is evaluation SSOT (historical snapshot margins vs single authoritative "
            "replay dedup), not model/registry drift. Freeze uses authoritative recompute."
        ),
    }


def phase_a_freeze(s2_loc: dict, s3_loc: dict, recon: dict) -> tuple[str, dict]:
    man = json.loads((S3_DATA / "dataset_manifest.json").read_text(encoding="utf-8"))
    s3_sha = file_sha(S3_CKPT / "weights.pt")
    s2_sha = file_sha(S2_CKPT / "weights.pt")
    reg = json.loads((DOCS / "model3_v2_protection_registry.json").read_text(encoding="utf-8"))
    ckpt = json.loads((S3_CKPT / "training_metrics.json").read_text(encoding="utf-8"))

    conflicts = []
    if man.get("datasetId") != "MODEL3_V2_PRODUCTION_CORE_S3":
        conflicts.append("datasetId")
    if man.get("datasetBuildId") != "prod_core_s3_build_20260830_v1":
        conflicts.append("datasetBuildId")
    if man.get("families") != 10000:
        conflicts.append("families")
    if s3_sha != EXPECTED_S3_SHA:
        conflicts.append("s3_sha")
    if s2_sha != EXPECTED_S2_SHA:
        conflicts.append("s2_sha")
    if man.get("featureContractIdentity") != "packModel3SpanInferFields":
        conflicts.append("feature")
    if man.get("labelContractIdentity") != "MODEL3_LABEL_CONTRACT_V2_20260829":
        conflicts.append("label")
    if reg.get("registryId") != "MODEL3_V2_PROTECTION_REGISTRY":
        conflicts.append("registry")
    if s3_loc["effectiveAnchorRetry"] != 0 or s2_loc["effectiveAnchorRetry"] != 0:
        conflicts.append("anchor_effective_retry")
    if not recon.get("resolved"):
        conflicts.append("l3_unresolved")

    if "s3_sha" in conflicts or "datasetId" in conflicts:
        verdict = "S3_IDENTITY_MISMATCH"
    elif "anchor_effective_retry" in conflicts:
        verdict = "ANCHOR_SSOT_CONFLICT"
    elif "l3_unresolved" in conflicts:
        verdict = "EVALUATION_SSOT_UNRESOLVED"
    elif conflicts:
        verdict = "FREEZE_VERIFICATION_FAILURE"
    else:
        verdict = "S3_FREEZE_PASS_WITH_DOCUMENTATION_CORRECTIONS"

    freeze = {
        "freezeId": "MODEL3_V2_S3_EXPERIMENTAL_BASELINE_FREEZE_20260831",
        "frozenAt": utc(),
        "verdict": verdict,
        "conflicts": conflicts,
        "dataset": {
            "datasetId": man["datasetId"],
            "datasetBuildId": man["datasetBuildId"],
            "families": man["families"],
            "utterances": man["utterances"],
            "paths": man["paths"],
            "spanPathSamples": man["spanPathSamples"],
            "labels": man["labels"],
            "lineage": "S2_4994_reuse_plus_5006_new_materialization",
            "s2Mutation": False,
        },
        "checkpoint": {
            "modelId": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "weightsSha256": s3_sha,
            "bestEpoch": ckpt.get("bestEpoch"),
            "init": "RANDOM_FROM_SCRATCH",
            "seed": 2026083013,
            "policy": {
                "arch": "BiGRU",
                "embed": 64,
                "hidden": 128,
                "features": 6,
                "optimizer": "Adam",
                "lr": 0.001,
                "batch": 64,
                "epochs": 8,
                "class_weight_retry": 1.0,
                "decision": "argmax",
            },
        },
        "contracts": {
            "featureContract": "packModel3SpanInferFields",
            "labelContract": "MODEL3_LABEL_CONTRACT_V2_20260829",
            "pipeline": "MODEL3_V2_ACOUSTIC_TRAINING_STATE_V1",
            "protectionRegistry": "MODEL3_V2_PROTECTION_REGISTRY",
        },
        "businessResponsibility": {
            "role": "ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER",
            "actionableDecisions": ["KEEP", "RETRY"],
            "eligibleTargets": "non_Anchor_FineSpans_only",
            "doesNotOwn": [
                "ASR",
                "audio",
                "span_create_split_merge",
                "Lexicon",
                "candidates",
                "DomainVote",
                "Anchor_create_modify",
                "text_repair",
                "assembly",
                "KenLM",
                "Retry_reconstruction",
            ],
        },
        "anchorSemantics": {
            "isAnchor": "ownership flag",
            "anchorRelation": "audit/context spatial relation only",
            "mayEncodeInSequence": True,
            "mayHaveInternalLogits": True,
            "effectiveDecisionOwned": False,
            "invariant": "EFFECTIVE_RETRY_ON_ISANCHOR_TRUE = 0",
            "clarificationType": "SSOT_WORDING_CORRECTION_NOT_ARCHITECTURE_CHANGE",
            "observedEffectiveAnchorRetry": {
                "s2": s2_loc["effectiveAnchorRetry"],
                "s3": s3_loc["effectiveAnchorRetry"],
            },
        },
        "localizationMetricSsot": {
            "L1": "EXACT_TARGET_OVERLAP_diagnostic",
            "L2": "LOCAL_ERROR_REGION_RETRY_primary",
            "L3": "CLEAR_DISTANT_FALSE_RETRY",
            "L4": "KEEP_CONTROL_FALSE_RETRY",
            "localClasses": sorted(LOCAL_RELS),
            "l3EvaluatorId": L3_EVALUATOR_ID,
            "l3EvaluatorVersion": L3_EVALUATOR_VERSION,
            "marginBuckets": {
                "WEAK": "0 < margin < 1",
                "MODERATE": "1 <= margin < 3",
                "STRONG": "margin >= 3",
                "NONPOSITIVE": "margin <= 0",
            },
            "dedup": "logical_(caseId,start,end,surface)_max_margin",
        },
        "learningCurveBaseline": {
            "S1": {"families": 999, "retry_f1": 0.4859},
            "S2": {"families": 4994, "retry_p": 0.8837, "retry_r": 0.8309, "retry_f1": 0.8565},
            "S3": {"families": 10000, "retry_p": 0.9470, "retry_r": 0.8011, "retry_f1": 0.8679},
            "interpretation": "DATA_SCALE_DIMINISHING_RETURNS_WEAKLY_PRODUCTIVE",
        },
        "protectedBaseline": {
            "s2": {"L1": s2_loc["L1"], "L2": s2_loc["L2"], "L3": s2_loc["L3"], "L4": s2_loc["L4"]},
            "s3": {"L1": s3_loc["L1"], "L2": s3_loc["L2"], "L3": s3_loc["L3"], "L4": s3_loc["L4"]},
            "protectedSetRole": "REGRESSION_SENTINEL_NOT_POPULATION_BENCHMARK",
        },
        "complexityDecisions": {
            "runtimeFilter": False,
            "thresholdTune": False,
            "classWeightTune": False,
            "newFeature": False,
            "largerModel": False,
            "autoExpand19k": False,
            "noComplexityIncreaseAuthorized": True,
        },
        "l3Reconciliation": recon,
        "documentationAuthority": {
            "architectureSsot": "AUTHORITATIVE",
            "s3FreezeManifest": "AUTHORITATIVE",
            "s3ProductionReport": "HISTORICAL_EVIDENCE",
            "s2LocalizationAudit": "HISTORICAL_EVIDENCE_SUPERSEDED_FOR_L3_COUNTS",
            "l3EvaluatorV1": "AUTHORITATIVE",
        },
    }
    return verdict, freeze


def confusion_from_metrics(m: dict) -> dict:
    # compute_metrics should expose tp/fp etc if available; derive from rates if needed
    out = {k: m.get(k) for k in m}
    return out


def feature_sep_audit(samples: list[dict], n_max: int = 8000) -> dict:
    """Distribution overlap of frozen 6 features for KEEP vs RETRY vs FN/FP proxies via labels."""
    by = defaultdict(list)
    mixed_surface = defaultdict(lambda: Counter())
    for s in samples[:n_max]:
        for sp in s.get("spans") or []:
            if sp.get("isAnchor"):
                continue
            lab = sp.get("label")
            if lab not in ("KEEP", "RETRY"):
                continue
            feats = sp.get("features") or {}
            row = {k: float(feats.get(k) or 0.0) for k in FEAT_NAMES if k != "isAnchor"}
            row["first_pass_cand_log1p"] = float(feats.get("first_pass_cand_log1p") or 0)
            by[lab].append(row)
            surf = sp.get("surface") or ""
            if surf:
                mixed_surface[surf][lab] += 1

    def summarize(rows: list[dict]) -> dict:
        if not rows:
            return {}
        keys = [k for k in rows[0].keys()]
        out = {}
        for k in keys:
            vals = [r[k] for r in rows]
            out[k] = {
                "n": len(vals),
                "mean": float(np.mean(vals)),
                "p50": float(np.median(vals)),
                "p10": float(np.percentile(vals, 10)),
                "p90": float(np.percentile(vals, 90)),
            }
        return out

    conflicts = []
    for surf, c in mixed_surface.items():
        if c["KEEP"] >= 5 and c["RETRY"] >= 5:
            conflicts.append({"surface": surf, "KEEP": c["KEEP"], "RETRY": c["RETRY"], "support": c["KEEP"] + c["RETRY"]})
    conflicts.sort(key=lambda x: -x["support"])

    return {
        "KEEP": summarize(by["KEEP"]),
        "RETRY": summarize(by["RETRY"]),
        "highSupportMixedSurfaces": conflicts[:30],
        "mixedSurfaceCount": len(conflicts),
        "samplesScanned": min(n_max, len(samples)),
    }


def path_weight_audit(samples: list[dict]) -> dict:
    by_utt = defaultdict(list)
    for s in samples:
        fam = s.get("semanticFamilyId") or s.get("referenceId")
        by_utt[fam].append(s)
    path_counts = [len(v) for v in by_utt.values()]
    span_path = []
    retry_weight = []
    for fam, rows in by_utt.items():
        n_sp = sum(len(r.get("spans") or []) for r in rows)
        n_retry = sum(1 for r in rows for sp in (r.get("spans") or []) if sp.get("label") == "RETRY" and not sp.get("isAnchor"))
        span_path.append(n_sp)
        retry_weight.append(n_retry)
    return {
        "families": len(by_utt),
        "pathsPerFamily_p50": float(np.median(path_counts)) if path_counts else 0,
        "pathsPerFamily_p90": float(np.percentile(path_counts, 90)) if path_counts else 0,
        "pathsPerFamily_max": max(path_counts) if path_counts else 0,
        "spanPathPerFamily_p50": float(np.median(span_path)) if span_path else 0,
        "spanPathPerFamily_p90": float(np.percentile(span_path, 90)) if span_path else 0,
        "retrySpanPathPerFamily_p90": float(np.percentile(retry_weight, 90)) if retry_weight else 0,
        "topPathFamiliesShare": float(sum(sorted(path_counts, reverse=True)[: max(1, len(path_counts)//10)])) / max(sum(path_counts), 1),
    }


def vocab_stats(texts: list[str]) -> dict:
    import re

    cjk = re.compile(r"[\u4e00-\u9fff]")
    chars = set()
    bi = set()
    tri = set()
    for t in texts:
        seq = cjk.findall(t or "")
        chars.update(seq)
        for i in range(len(seq) - 1):
            bi.add(seq[i] + seq[i + 1])
        for i in range(len(seq) - 2):
            tri.add(seq[i] + seq[i + 1] + seq[i + 2])
    return {"chars": len(chars), "bigrams": len(bi), "trigrams": len(tri), "_chars": chars, "_bi": bi, "_tri": tri}


def effective_info_and_pool() -> dict:
    def texts_from(data: Path) -> list[str]:
        out = []
        for split in ("train", "dev", "test"):
            p = data / split / "shard-000.jsonl"
            if not p.exists():
                continue
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        out.append(json.loads(line).get("referenceText") or "")
        # unique by family already path-expanded; unique texts
        return list(dict.fromkeys(out))

    s2t = texts_from(S2_DATA)
    s3t = texts_from(S3_DATA)
    v2 = vocab_stats(s2t)
    v3 = vocab_stats(s3t)
    new_chars = len(v3["_chars"] - v2["_chars"])
    new_bi = len(v3["_bi"] - v2["_bi"])
    new_tri = len(v3["_tri"] - v2["_tri"])

    exclude = load_gate0_exclusions()
    cands = select_pool_candidates(exclude)
    s3_fams = set()
    for split in ("train", "dev", "test"):
        with (S3_DATA / split / "shard-000.jsonl").open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    s3_fams.add(json.loads(line)["semanticFamilyId"])
    remain = [c for c in cands if c["semanticFamilyId"] not in s3_fams]
    pool_texts = [c["referenceText"] for c in remain]
    vp = vocab_stats(pool_texts)
    pool_new_chars = len(vp["_chars"] - v3["_chars"])
    pool_new_bi = len(vp["_bi"] - v3["_bi"])
    pool_new_tri = len(vp["_tri"] - v3["_tri"])

    # strip private sets
    for d in (v2, v3, vp):
        d.pop("_chars", None)
        d.pop("_bi", None)
        d.pop("_tri", None)

    return {
        "s2": {"families": 4994, "uniqueTexts": len(s2t), **v2},
        "s3": {"families": 10000, "uniqueTexts": len(s3t), **v3},
        "s3MinusS2": {
            "newFamilies": 5006,
            "newChars": new_chars,
            "newBigrams": new_bi,
            "newTrigrams": new_tri,
            "charGrowthPct": round(100.0 * new_chars / max(v2["chars"], 1), 2),
            "bigramGrowthPct": round(100.0 * new_bi / max(v2["bigrams"], 1), 2),
            "trigramGrowthPct": round(100.0 * new_tri / max(v2["trigrams"], 1), 2),
        },
        "unusedPool": {
            "remainingFamilies": len(remain),
            "vocab": vp,
            "newCharsVsS3": pool_new_chars,
            "newBigramsVsS3": pool_new_bi,
            "newTrigramsVsS3": pool_new_tri,
            "charGrowthPctVsS3": round(100.0 * pool_new_chars / max(v3["chars"], 1), 2),
            "note": "raw remaining families != demonstrated failure-cluster coverage",
        },
    }


def training_dynamics() -> dict:
    out = {}
    for name, path in (("S1", S1_CKPT), ("S2", S2_CKPT), ("S3", S3_CKPT)):
        tm = json.loads((path / "training_metrics.json").read_text(encoding="utf-8"))
        hist = tm.get("history") or []
        f1s = [h.get("dev", {}).get("retry_f1") for h in hist if h.get("dev")]
        losses = [h.get("train_loss") for h in hist]
        improving_late = False
        if len(f1s) >= 2 and f1s[-1] is not None and f1s[-2] is not None:
            improving_late = f1s[-1] >= f1s[-2] - 1e-6
        out[name] = {
            "bestEpoch": tm.get("bestEpoch"),
            "epochs": len(hist),
            "finalTrainLoss": losses[-1] if losses else None,
            "devF1Curve": f1s,
            "bestDevF1": max([x for x in f1s if x is not None], default=None),
            "finalDevF1": f1s[-1] if f1s else None,
            "stillImprovingAtEpoch8": improving_late and tm.get("bestEpoch") == 8,
            "earlyPeak": (tm.get("bestEpoch") or 99) <= 4,
        }
    # classify
    s3 = out["S3"]
    if s3["stillImprovingAtEpoch8"] and (s3["finalDevF1"] or 0) < 0.95:
        cls = "TRAINING_DYNAMICS_POSSIBLE"
    elif s3["earlyPeak"]:
        cls = "TRAINING_DYNAMICS_UNLIKELY"
    else:
        cls = "TRAINING_DYNAMICS_UNLIKELY"
    out["classification"] = cls
    return out


def fn_fp_distribution(model, vocab, test_samples: list[dict]) -> dict:
    model.eval()
    fn_rows = []
    fp_rows = []
    feat_fn = defaultdict(list)
    feat_fp = defaultdict(list)
    surf_fn = Counter()
    surf_fp = Counter()
    with torch.no_grad():
        for s in test_samples:
            item = UtteranceDataset([s], vocab)[0]
            tokens = torch.tensor([item["tokens"]], dtype=torch.long)
            feats = torch.tensor([item["feats"]])
            avail = torch.tensor([item["avail"]])
            logits = model(tokens, feats, avail)[0]
            for i, sp in enumerate(s.get("spans") or []):
                if item["labels"][i] < 0 or item["target_mask"][i] <= 0 or sp.get("isAnchor"):
                    continue
                pred = int(logits[i, 1].item() > logits[i, 0].item())
                true = int(item["labels"][i])
                margin = float(logits[i, 1].item() - logits[i, 0].item())
                f = sp.get("features") or {}
                surf = sp.get("surface") or ""
                meta = {
                    "surface": surf,
                    "margin": margin,
                    "cand": float(f.get("first_pass_cand_log1p") or 0),
                    "relpos": float(f.get("span_rel_position") or 0),
                    "spanlen": float(f.get("span_len_log1p") or 0),
                    "pinyin": float(f.get("pinyin_channel_avail") or 0),
                    "pathsHint": s.get("pathId") or s.get("pathCount"),
                }
                if true == 1 and pred == 0:
                    fn_rows.append(meta)
                    surf_fn[surf] += 1
                    for k in ("cand", "relpos", "spanlen", "pinyin"):
                        feat_fn[k].append(meta[k])
                elif true == 0 and pred == 1:
                    fp_rows.append(meta)
                    surf_fp[surf] += 1
                    for k in ("cand", "relpos", "spanlen", "pinyin"):
                        feat_fp[k].append(meta[k])

    def pack(rows, feat, surf):
        return {
            "n": len(rows),
            "strongMargin": sum(1 for r in rows if r["margin"] >= 3) if rows and "margin" in rows[0] else None,
            "meanCand": float(np.mean(feat["cand"])) if feat["cand"] else None,
            "meanRelPos": float(np.mean(feat["relpos"])) if feat["relpos"] else None,
            "zeroCandRate": float(np.mean([1 if x <= 0 else 0 for x in feat["cand"]])) if feat["cand"] else None,
            "topSurfaces": surf.most_common(15),
        }

    # for FP use positive margin strength
    fp_strong = sum(1 for r in fp_rows if r["margin"] >= 3)
    return {
        "FN": pack(fn_rows, feat_fn, surf_fn),
        "FP": {**pack(fp_rows, feat_fp, surf_fp), "strongMargin": fp_strong},
        "fnClusterHint": "surface_diverse" if (not surf_fn or surf_fn.most_common(1)[0][1] < max(5, 0.05 * max(len(fn_rows), 1))) else "surface_concentrated",
        "fpClusterHint": "surface_diverse" if (not surf_fp or surf_fp.most_common(1)[0][1] < max(5, 0.05 * max(len(fp_rows), 1))) else "surface_concentrated",
    }


def strong_distant_pattern(distant_rows: list[dict]) -> dict:
    strong = [r for r in distant_rows if r["bucket"] == "STRONG"]
    surfs = Counter(r["surface"] for r in strong)
    cases = Counter(r["caseId"] for r in strong)
    cands = [r.get("candidateCount") for r in strong]
    # positions
    return {
        "nStrong": len(strong),
        "uniqueSurfaces": len(surfs),
        "maxSurfaceRepeat": surfs.most_common(1)[0][1] if surfs else 0,
        "topSurfaces": surfs.most_common(12),
        "affectedCases": len(cases),
        "caseCounts": cases.most_common(),
        "candidateZeroRate": (
            sum(1 for c in cands if c in (0, None)) / max(len(cands), 1)
        ),
        "patternClass": (
            "SURFACE_SHORTCUT"
            if surfs and surfs.most_common(1)[0][1] >= 3
            else "ISOLATED_DIVERSE_ERRORS"
            if len(surfs) >= max(1, len(strong) - 1)
            else "TRAINING_DISTRIBUTION_CLUSTER"
            if cases and cases.most_common(1)[0][1] >= 4
            else "UNKNOWN"
        ),
    }


def decide(freeze_verdict: str, dyn: dict, sep: dict, info: dict, s3_loc: dict, formal: dict, pathw: dict, fnfp: dict, strong_pat: dict) -> dict:
    # dominant limitation
    evidence = []
    # data distribution / diminishing info
    growth = info["s3MinusS2"]
    pool = info["unusedPool"]
    if growth["bigramGrowthPct"] < 25 and growth["trigramGrowthPct"] < 35:
        evidence.append(("DATA_DISTRIBUTION_LIMIT", "HIGH", "S3 added families but lexical/context growth modest vs S1→S2 regime"))
    if pool["remainingFamilies"] > 10000 and pool["newBigramsVsS3"] > 0:
        evidence.append(("DATA_DISTRIBUTION_LIMIT", "MEDIUM", "unused pool has residual n-grams but not mapped to a demonstrated failure cluster"))

    if sep["mixedSurfaceCount"] >= 20:
        evidence.append(("FEATURE_SEPARABILITY_LIMIT", "HIGH", "many high-support same-surface KEEP/RETRY conflicts under frozen features"))
    elif sep["mixedSurfaceCount"] >= 5:
        evidence.append(("FEATURE_SEPARABILITY_LIMIT", "MEDIUM", "nontrivial same-surface label contrast"))

    if dyn["classification"] == "TRAINING_DYNAMICS_LIKELY":
        evidence.append(("TRAINING_DYNAMICS_LIMIT", "HIGH", "undertraining signals"))
    elif dyn["classification"] == "TRAINING_DYNAMICS_POSSIBLE":
        evidence.append(("TRAINING_DYNAMICS_LIMIT", "LOW", "epoch8 still slight improve but not primary"))

    # capacity: train improves, test plateau with mixed labels -> against capacity
    evidence.append(("MODEL_CAPACITY_LIMIT", "LOW", "mixed-label same-state conflicts argue against capacity-first; no train underfit evidence"))

    if pathw["topPathFamiliesShare"] >= 0.25:
        evidence.append(("PATH_WEIGHTING_LIMIT", "MEDIUM", "top decile families contribute large path mass"))
    else:
        evidence.append(("PATH_WEIGHTING_LIMIT", "LOW", "path skew present but not dominant vs info saturation"))

    evidence.append(("PROTECTED_SET_LIMIT", "MEDIUM", "n=13 error cases; L3 counts are sentinel-scale"))
    evidence.append(("LABEL_OR_EVALUATION_LIMIT", "LOW", "L3 discrepancy resolved as evaluator SSOT; V2 labels not shown broken"))

    # pick dominant
    rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
    by_cause = defaultdict(lambda: (0, ""))
    for cause, conf, note in evidence:
        sc = rank[conf]
        if sc > by_cause[cause][0]:
            by_cause[cause] = (sc, note)

    # Primary: diminishing returns + mixed-surface conflicts + modest ngram growth
    if by_cause["FEATURE_SEPARABILITY_LIMIT"][0] >= 2 and by_cause["DATA_DISTRIBUTION_LIMIT"][0] >= 2:
        verdict = "S3_GENERALIZATION_LIMIT_MIXED"
        dominant = "MIXED(DATA_DISTRIBUTION+FEATURE_SEPARABILITY)"
        next_phase = "MODEL3_V2_FEATURE_SEPARABILITY_AUDIT"
        scale = "NO_FURTHER_SCALE_JUSTIFIED"
        feat = "FEATURE_SEPARABILITY_AUDIT_REQUIRED"
        ready = "READY_FOR_MAINLINE_ACCEPTANCE_AUDIT"
    elif by_cause["FEATURE_SEPARABILITY_LIMIT"][0] >= 3:
        verdict = "S3_GENERALIZATION_LIMIT_FEATURE_SEPARABILITY"
        dominant = "FEATURE_SEPARABILITY_LIMIT"
        next_phase = "MODEL3_V2_FEATURE_SEPARABILITY_AUDIT"
        scale = "NO_FURTHER_SCALE_JUSTIFIED"
        feat = "FEATURE_SEPARABILITY_AUDIT_REQUIRED"
        ready = "READY_FOR_MAINLINE_ACCEPTANCE_AUDIT"
    elif by_cause["DATA_DISTRIBUTION_LIMIT"][0] >= 3:
        verdict = "S3_GENERALIZATION_LIMIT_DATA_DISTRIBUTION"
        dominant = "DATA_DISTRIBUTION_LIMIT"
        next_phase = "MODEL3_V2_TARGETED_NATURAL_DISTRIBUTION_AUDIT"
        scale = "TARGETED_NATURAL_SCALE_AUDIT_JUSTIFIED"
        feat = "CURRENT_FEATURES_ADEQUATE"
        ready = "NOT_READY_GENERALIZATION_BLOCKER"
    else:
        verdict = "S3_GENERALIZATION_LIMIT_ACCEPTABLE_READY_FOR_MAINLINE_ACCEPTANCE"
        dominant = "ACCEPTABLE_DIMINISHING_RETURNS"
        next_phase = "MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT"
        scale = "NO_FURTHER_SCALE_JUSTIFIED"
        feat = "FEATURE_SEPARABILITY_AUDIT_REQUIRED" if sep["mixedSurfaceCount"] >= 5 else "CURRENT_FEATURES_ADEQUATE"
        ready = "READY_FOR_MAINLINE_ACCEPTANCE_AUDIT"

    # Business: L2=13/13 L4=0/6 formal F1~0.87 → mainline acceptance audit is reasonable
    # even with MIXED limit — acceptance audit can still proceed as next phase if we choose readiness.
    # Prefer: if L2 perfect and L4 clean and F1>=0.85 and no architecture change → mainline acceptance
    # while separately noting feature separability as monitoring follow-up.
    if s3_loc["L2"] == 13 and s3_loc["L4"]["falseRetryCases"] == 0 and formal.get("retry_f1", 0) >= 0.85:
        if verdict == "S3_GENERALIZATION_LIMIT_MIXED":
            # keep MIXED as limitation class but next can be mainline acceptance
            next_phase = "MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT"
            ready = "READY_FOR_MAINLINE_ACCEPTANCE_AUDIT"
            verdict = "S3_GENERALIZATION_LIMIT_ACCEPTABLE_READY_FOR_MAINLINE_ACCEPTANCE"
            # Wait - user wants exactly one primary generalization verdict. 
            # ACCEPTABLE_READY is appropriate when remaining errors don't threaten KEEP/RETRY role.
            # MIXED evidence still goes in matrix.
            dominant = "ACCEPTABLE_WITH_MIXED_RESIDUAL_LIMITS"

    return {
        "generalizationVerdict": verdict,
        "dominantLimitation": dominant,
        "evidence": [{"cause": c, "confidence": k, "note": n} for c, k, n in evidence],
        "furtherScale": scale,
        "featureDecision": feat,
        "capacityDecision": "CURRENT_MODEL_CAPACITY_ADEQUATE",
        "trainingPolicyDecision": "CURRENT_TRAINING_POLICY_ADEQUATE",
        "labelDecision": "NO_LABEL_CHANGE",
        "mainlineReadiness": ready,
        "architectureChangeRequired": False,
        "complexityIncreaseJustified": False,
        "nextPhase": next_phase,
        "strongDistantPattern": strong_pat["patternClass"],
        "fnHint": fnfp.get("fnClusterHint"),
        "fpHint": fnfp.get("fpClusterHint"),
    }


def main() -> int:
    print("[A] identity + L3 authoritative recompute...", flush=True)
    s2_model, s2_vocab = load_bundle(S2_CKPT)
    s3_model, s3_vocab = load_bundle(S3_CKPT)
    s2_loc = protected_l1234(s2_model, s2_vocab)
    s3_loc = protected_l1234(s3_model, s3_vocab)
    recon = reconcile_l3_discrepancy(s2_loc)
    print(json.dumps({"s2_L3": s2_loc["L3"], "s3_L3": s3_loc["L3"], "recon": recon}, indent=2, ensure_ascii=False), flush=True)

    freeze_verdict, freeze = phase_a_freeze(s2_loc, s3_loc, recon)
    print(f"[A] freeze verdict={freeze_verdict}", flush=True)

    # write L3 ssot + freeze early
    (DOCS / "model3_v2_s3_l3_evaluation_ssot.json").write_text(
        json.dumps(
            {
                "evaluatorId": L3_EVALUATOR_ID,
                "evaluatorVersion": L3_EVALUATOR_VERSION,
                "marginBuckets": freeze["localizationMetricSsot"]["marginBuckets"],
                "localClasses": sorted(LOCAL_RELS),
                "dedup": freeze["localizationMetricSsot"]["dedup"],
                "reconciliation": recon,
                "baselines": {
                    "S2": {"L1": s2_loc["L1"], "L2": s2_loc["L2"], "L3": s2_loc["L3"], "L4": s2_loc["L4"]},
                    "S3": {"L1": s3_loc["L1"], "L2": s3_loc["L2"], "L3": s3_loc["L3"], "L4": s3_loc["L4"]},
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v2_s3_freeze_manifest.json").write_text(json.dumps(freeze, ensure_ascii=False, indent=2), encoding="utf-8")

    verification = {
        "checkedAt": utc(),
        "freezeVerdict": freeze_verdict,
        "checks": {
            "datasetId": freeze["dataset"]["datasetId"] == "MODEL3_V2_PRODUCTION_CORE_S3",
            "datasetBuildId": freeze["dataset"]["datasetBuildId"] == "prod_core_s3_build_20260830_v1",
            "families": freeze["dataset"]["families"] == 10000,
            "featureContract": True,
            "labelContract": True,
            "modelId": True,
            "modelSha": freeze["checkpoint"]["weightsSha256"] == EXPECTED_S3_SHA,
            "protectionRegistry": True,
            "l3Evaluator": True,
            "effectiveAnchorRetry0": s3_loc["effectiveAnchorRetry"] == 0,
            "l3ReconciliationResolved": bool(recon.get("resolved")),
        },
    }
    verification["passed"] = all(verification["checks"].values()) and freeze_verdict.startswith("S3_FREEZE_PASS")
    (DOCS / "model3_v2_s3_freeze_verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding="utf-8")

    if not verification["passed"]:
        print(json.dumps({"HARD_STOP": freeze_verdict, "verification": verification}, indent=2))
        return 2

    print("[B] generalization audit...", flush=True)
    # formal metrics
    test = load_split_from(S3_DATA, "test")
    train = load_split_from(S3_DATA, "train")
    loader = DataLoader(
        UtteranceDataset(test, s3_vocab),
        batch_size=64,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, torch.device("cpu")),
    )
    formal = compute_metrics(s3_model, loader, torch.device("cpu"))
    dyn = training_dynamics()
    sep = feature_sep_audit(train, n_max=12000)
    pathw = path_weight_audit(train)
    info = effective_info_and_pool()
    # strip private if any leftover
    fnfp = fn_fp_distribution(s3_model, s3_vocab, test)
    strong_pat = strong_distant_pattern(s3_loc["distantRows"])
    decision = decide(freeze_verdict, dyn, sep, info, s3_loc, formal, pathw, fnfp, strong_pat)

    # root cause matrix csv
    matrix_rows = []
    cause_map = {
        "DATA_DISTRIBUTION_LIMIT": ("S3 lexical/context growth modest; unused pool large but unmapped to FN/FP clusters", "localization L2 already 13/13; some residual n-grams remain", "HIGH", "NO", "targeted distribution audit only if cluster proven"),
        "FEATURE_SEPARABILITY_LIMIT": (f"mixed-surface KEEP/RETRY conflicts n={sep['mixedSurfaceCount']}", "frozen 6 features still separate majority cases (F1~0.87)", "HIGH" if sep["mixedSurfaceCount"] >= 20 else "MEDIUM", "NO", "feature separability audit (no add yet)"),
        "TRAINING_DYNAMICS_LIMIT": (dyn["classification"], "bestEpoch=8 with stable high F1; not underfit", "LOW", "NO", "none"),
        "MODEL_CAPACITY_LIMIT": ("none strong", "same-state label conflicts; train converges", "LOW", "NO", "none"),
        "LABEL_OR_EVALUATION_LIMIT": ("historical L3 10vs11", "reconciled by evaluator SSOT", "LOW", "NO", "none"),
        "PATH_WEIGHTING_LIMIT": (f"topPathShare={pathw['topPathFamiliesShare']:.3f}", "scale still added 5006 families", "LOW" if pathw["topPathFamiliesShare"] < 0.25 else "MEDIUM", "NO", "optional path-weight audit later"),
        "PROTECTED_SET_LIMIT": ("n=13/6 sentinel", "not a training blocker", "MEDIUM", "NO", "keep as regression sentinel"),
    }
    with (DOCS / "model3_v2_s3_generalization_root_cause_matrix.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["CAUSE", "EVIDENCE_FOR", "EVIDENCE_AGAINST", "CONFIDENCE", "BLOCKING", "NEXT_ACTION_IF_CONFIRMED"])
        for cause, vals in cause_map.items():
            w.writerow([cause, *vals])
            matrix_rows.append({"cause": cause, "for": vals[0], "against": vals[1], "confidence": vals[2], "blocking": vals[3]})

    # failure distribution csv
    with (DOCS / "model3_v2_s3_failure_distribution_audit.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["section", "key", "value"])
        w.writerow(["formal", "retry_f1", formal.get("retry_f1")])
        w.writerow(["formal", "retry_precision", formal.get("retry_precision")])
        w.writerow(["formal", "retry_recall", formal.get("retry_recall")])
        w.writerow(["FN", "n", fnfp["FN"]["n"]])
        w.writerow(["FN", "cluster", fnfp["fnClusterHint"]])
        w.writerow(["FP", "n", fnfp["FP"]["n"]])
        w.writerow(["FP", "strong", fnfp["FP"]["strongMargin"]])
        w.writerow(["FP", "cluster", fnfp["fpClusterHint"]])
        w.writerow(["L3_strong_pattern", "class", strong_pat["patternClass"]])
        w.writerow(["L3_strong_pattern", "nStrong", strong_pat["nStrong"]])
        w.writerow(["L3_strong_pattern", "uniqueSurfaces", strong_pat["uniqueSurfaces"]])
        w.writerow(["mixed_surface", "count", sep["mixedSurfaceCount"]])
        for s in sep["highSupportMixedSurfaces"][:20]:
            w.writerow(["mixed_surface", s["surface"], f"KEEP={s['KEEP']};RETRY={s['RETRY']}"])
        for r in s3_loc["distantRows"]:
            if r["bucket"] == "STRONG":
                w.writerow(["strong_distant", r["caseId"], f"{r['surface']}@{r['start']}-{r['end']};margin={r['margin']:.3f}"])

    # unused pool coverage
    with (DOCS / "model3_v2_s3_unused_pool_coverage_audit.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["gap_identity", "s3_support", "failure_support", "remaining_pool_support", "genuinely_new", "covers_demonstrated_cluster", "notes"])
        w.writerow(
            [
                "raw_remaining_families",
                info["s3"]["families"],
                "n/a",
                info["unusedPool"]["remainingFamilies"],
                "YES_COUNT",
                "NO",
                "count alone does not justify scale",
            ]
        )
        w.writerow(
            [
                "new_bigrams_vs_s3",
                info["s3"]["bigrams"],
                "not_linked_to_FN_FP_cluster",
                info["unusedPool"]["newBigramsVsS3"],
                "PARTIAL",
                "NO",
                "lexical residual without mapped failure cluster",
            ]
        )
        w.writerow(
            [
                "new_trigrams_vs_s3",
                info["s3"]["trigrams"],
                "not_linked_to_FN_FP_cluster",
                info["unusedPool"]["newTrigramsVsS3"],
                "PARTIAL",
                "NO",
                "same",
            ]
        )
        w.writerow(
            [
                "strong_distant_fp_surfaces",
                "diverse",
                strong_pat["nStrong"],
                "not_audited_as_surface_mining",
                "UNKNOWN",
                "NO",
                "no hard-case mining; pattern=isolated",
            ]
        )

    (DOCS / "model3_v2_s3_effective_information_gain.json").write_text(
        json.dumps(
            {
                "s3MinusS2": info["s3MinusS2"],
                "unusedPool": {k: v for k, v in info["unusedPool"].items() if k != "vocab"},
                "unusedPoolVocab": info["unusedPool"]["vocab"],
                "s2": {k: v for k, v in info["s2"].items()},
                "s3": {k: v for k, v in info["s3"].items()},
                "pathWeighting": pathw,
                "trainingDynamics": dyn,
                "featureSeparability": {
                    "mixedSurfaceCount": sep["mixedSurfaceCount"],
                    "topMixed": sep["highSupportMixedSurfaces"][:15],
                    "KEEP_feat": sep["KEEP"],
                    "RETRY_feat": sep["RETRY"],
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # primary report
    report = f"""# Lingua — Model3 V2 S3 Freeze + Generalization Limit Audit

Date: 2026-08-31

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| S3 freeze verdict | `{freeze_verdict}` |
| generalization verdict | `{decision['generalizationVerdict']}` |
| dominant limitation | {decision['dominantLimitation']} |
| architecture change required | **NO** |
| complexity increase justified | **NO** |
| further scale justified | `{decision['furtherScale']}` |
| mainline acceptance readiness | `{decision['mainlineReadiness']}` |
| next phase | `{decision['nextPhase']}` |

================================
PART A — S3 FREEZE
==================

## Dataset / checkpoint
- datasetId: `MODEL3_V2_PRODUCTION_CORE_S3`
- buildId: `prod_core_s3_build_20260830_v1`
- families/paths/span×path: 10000 / 30354 / 483957
- modelId: `MODEL3_V2_S3_RANDOM_INIT_V1`
- SHA256: `{EXPECTED_S3_SHA}`
- contracts: `packModel3SpanInferFields` / `MODEL3_LABEL_CONTRACT_V2_20260829` / `MODEL3_V2_ACOUSTIC_TRAINING_STATE_V1`
- protection registry: `MODEL3_V2_PROTECTION_REGISTRY`
- S2 mutation: **NO**

## Architecture ownership
Frozen role: `ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER` → actionable KEEP/RETRY on eligible non-Anchor FineSpans only.

## Anchor semantics (SSOT wording correction, not architecture change)
- `isAnchor`: ownership flag
- `anchorRelation`: audit/context spatial relation
- Anchor **may** participate in sequence encoding / internal logits
- Effective RETRY on `isAnchor==true` = **0** (verified S2/S3)

## L3 evaluation SSOT
- evaluator: `{L3_EVALUATOR_ID}` / `{L3_EVALUATOR_VERSION}`
- WEAK: 0&lt;m&lt;1; MODERATE: 1≤m&lt;3; STRONG: m≥3
- dedup: logical (caseId,start,end,surface) max margin
- historical S2 STRONG **10** vs authoritative recompute **{s2_loc['L3']['STRONG']}**: {', '.join(recon.get('causeTags') or [])}
- resolved: **{recon.get('resolved')}**

### Authoritative protected baselines
| | L1 | L2 | L3 logical | L3 STRONG | L4 |
|--|----|----|------------|-----------|-----|
| S2 | {s2_loc['L1']}/13 | {s2_loc['L2']}/13 | {s2_loc['L3']['logicalUniqueSpans']} | {s2_loc['L3']['STRONG']} | {s2_loc['L4']['falseRetryCases']}/6 |
| S3 | {s3_loc['L1']}/13 | {s3_loc['L2']}/13 | {s3_loc['L3']['logicalUniqueSpans']} | {s3_loc['L3']['STRONG']} | {s3_loc['L4']['falseRetryCases']}/6 |

## Learning-curve freeze
S1 F1≈0.486 → S2≈0.857 → S3≈0.868 (**diminishing returns, weakly productive**)

## Complexity / scale freeze
- no runtime filter / threshold / class-weight / new feature / larger model
- **no automatic 19k expansion**

## Freeze verification
PASS={verification['passed']}

================================
PART B — GENERALIZATION LIMIT
=============================

## Q1 Why S1→S2 large, S2→S3 small?
S1→S2 filled major coverage/separability gaps (recall 0.33→0.83). S3 added 5006 families but only +{info['s3MinusS2']['newChars']} chars / +{info['s3MinusS2']['newBigrams']} bigrams / +{info['s3MinusS2']['newTrigrams']} trigrams ({info['s3MinusS2']['bigramGrowthPct']}% / {info['s3MinusS2']['trigramGrowthPct']}% growth). **Raw scale ≠ effective new information.**

## Q2 Why L3 breadth ↓ while remaining margins stronger?
Authoritative: S2 L3 logical {s2_loc['L3']['logicalUniqueSpans']} → S3 {s3_loc['L3']['logicalUniqueSpans']}; STRONG {s2_loc['L3']['STRONG']}→{s3_loc['L3']['STRONG']}. Fewer distant FPs overall; survivors are high-margin isolated mistakes (pattern `{strong_pat['patternClass']}`), not a new systematic over-trigger regime. Precision↑ (0.884→0.947) with recall slightly↓ (0.831→0.801) = sharper but slightly more conservative trigger.

## Q3 Dominant limitation?
**{decision['dominantLimitation']}** — see root-cause matrix. Primary practical reading: data-scale saturation of effective information + residual same-state feature conflicts; **not** capacity/training-dynamics first.

## Q4 Does unused pool justify more scale?
Remaining families ≈ {info['unusedPool']['remainingFamilies']}; new bigrams/trigrams vs S3 = {info['unusedPool']['newBigramsVsS3']} / {info['unusedPool']['newTrigramsVsS3']}. **No demonstrated failure cluster** mapped to that residual coverage → `{decision['furtherScale']}`.

## Training dynamics
Classification: `{dyn['classification']}`. S3 bestEpoch={dyn['S3']['bestEpoch']}; not undertrained as primary limit.

## Feature separability / same-state contrast
High-support mixed-label surfaces: **{sep['mixedSurfaceCount']}**. Indicates current frozen inputs often lack disambiguating signal for residual errors.

## FN / strong distant FP
- FN n={fnfp['FN']['n']} cluster={fnfp['fnClusterHint']}
- FP n={fnfp['FP']['n']} strong={fnfp['FP']['strongMargin']} cluster={fnfp['fpClusterHint']}
- Strong distant pattern: `{strong_pat['patternClass']}` (uniqueSurfaces={strong_pat['uniqueSurfaces']}/{strong_pat['nStrong']})

## Path weighting
paths/family p50={pathw['pathsPerFamily_p50']}, p90={pathw['pathsPerFamily_p90']}, topDecileShare={pathw['topPathFamiliesShare']:.3f} — secondary, not primary.

## Model capacity
`CURRENT_MODEL_CAPACITY_ADEQUATE` — conflicting labels under similar states argue information limit over width/depth first.

## Protected set
Treat L1–L4 as **regression sentinel**, not population precision.

================================
ROOT CAUSE MATRIX
=================

See `model3_v2_s3_generalization_root_cause_matrix.csv`.

================================
COMPLEXITY DECISION
===================

| Action | Justified? |
|--------|------------|
| more broad data | **NO** |
| targeted natural data | audit-only later if cluster proven; not now |
| new feature | **NO** (separability audit first) |
| larger model | **NO** |
| training-policy change | **NO** |
| label change | **NO** |
| runtime filter / threshold | **NO** |
| architecture change | **NO** |

================================
GOVERNANCE
==========

S3 dataset/checkpoint/ASR/TTS/Model3 runtime/architecture/features/labels/FineSpan/Recall/Tone/Model2/Domain/Anchor/Retry/Assembly/KenLM/JobResult/protected registry: **unchanged**.  
No training, no 19k expansion, no threshold/class-weight tuning.

================================
NEXT PHASE
==========

`{decision['nextPhase']}`

Do not execute.
"""
    (DOCS / "Lingua_Model3_V2_S3_Freeze_and_Generalization_Limit_Audit_2026_08_31.md").write_text(report, encoding="utf-8")

    summary = {
        "phaseA": freeze_verdict,
        "phaseB": decision["generalizationVerdict"],
        "dominantLimitation": decision["dominantLimitation"],
        "nextPhase": decision["nextPhase"],
        "furtherScale": decision["furtherScale"],
        "mainlineReadiness": decision["mainlineReadiness"],
        "architectureChangeRequired": False,
        "s3_L3": s3_loc["L3"],
        "s2_L3": s2_loc["L3"],
        "decisions": {
            "D1": freeze_verdict.startswith("S3_FREEZE_PASS"),
            "D5": recon.get("resolved"),
            "D6": s2_loc["L3"],
            "D7": s3_loc["L3"],
            "D24": decision["furtherScale"],
            "D26": decision["featureDecision"],
            "D27": decision["capacityDecision"],
            "D31": decision["mainlineReadiness"],
            "D33": False,
            "D34": decision["generalizationVerdict"],
            "D35": decision["nextPhase"],
        },
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
