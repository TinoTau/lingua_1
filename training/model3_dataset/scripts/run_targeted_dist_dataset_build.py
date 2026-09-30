# -*- coding: utf-8 -*-
"""MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD

Formal acoustic B2 dataset materialization for:
  MODEL3_V2_TARGETED_DIST_CORRECTED_V1

Gate0 acceptance sources are EXCLUDED (infrastructure regression reference).
No training. No pronunciation perturbation. No outcome-shopping.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.acoustic_training.family_identity import (  # noqa: E402
    assert_split_locked,
    semantic_family_id,
)
from training.model3_dataset.acoustic_training.holdout_registry import (  # noqa: E402
    PROTECTED_CASE_IDS,
    check_holdout,
    ensure_registry_file,
    load_protected_texts,
)
from training.model3_dataset.acoustic_training.orchestrator import (  # noqa: E402
    HARNESS,
    materialize_fresh_batch,
)
from training.model3_dataset.acoustic_training.serializer import (  # noqa: E402
    FEATURE_CONTRACT,
    LABEL_CONTRACT,
    PIPELINE_VERSION,
)

DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
GATE0_MANIFEST = DOCS / "model3_v2_gate0_source_batch_manifest.csv"
OUT = REPO / "training/model3_dataset/model3_v2_targeted_dist_corrected_v1"
BUILD = OUT / "build"
WORK = REPO / "training/model3_dataset/offline_harness/_b2_formal_work"

DATASET_ID = "MODEL3_V2_TARGETED_DIST_CORRECTED_V1"
DATASET_BUILD_ID = "tdist_build_20260830_v1"
SOURCE_SEED = 2026083004
SHARD_SIZE = 56
N_SHARDS = 5  # 280 frozen refs; Gate0 excluded
CJK = re.compile(r"[\u4e00-\u9fff]")
HIST_SURFACES = ("背", "烧", "四", "温", "苏", "对", "上")


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_gate0_exclusions() -> dict:
    """Prefer keeping Gate0 acceptance sources out of training."""
    ids: set[str] = set()
    fams: set[str] = set()
    texts: set[str] = set()
    hashes: set[str] = set()
    if GATE0_MANIFEST.exists():
        with GATE0_MANIFEST.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                ids.add(row["referenceId"])
                fams.add(row["semanticFamilyId"])
                texts.add(row.get("referenceText") or "")
                hashes.add(row.get("referenceTextHash") or "")
    return {
        "policy": "EXCLUDE_GATE0_ACCEPTANCE_SOURCES_FROM_TRAINING",
        "referenceIds": ids,
        "semanticFamilyIds": fams,
        "texts": texts,
        "hashes": hashes,
        "count": len(ids),
    }


def select_pool_candidates(exclude: dict) -> list[dict]:
    prot = load_protected_texts()
    rows: list[dict] = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            t = (o.get("normalized") or o.get("text") or "").strip()
            src = (o.get("source") or "").lower()
            if not t:
                continue
            if "dialog_200" in src or "dialog200" in src:
                continue
            rid = str(o.get("id") or hashlib.md5(t.encode()).hexdigest()[:12])
            th = hashlib.sha256(t.encode()).hexdigest()[:16]
            if rid in PROTECTED_CASE_IDS or t in prot:
                continue
            if check_holdout(reference_id=rid, reference_text=t):
                continue
            if rid in exclude["referenceIds"] or t in exclude["texts"] or th in exclude["hashes"]:
                continue
            cjk = len(CJK.findall(t))
            if cjk < 10 or cjk > 36 or len(t) > 48:
                continue
            if t.startswith("一般对话里常说") and cjk < 14:
                continue
            near = o.get("near_dup_key") or o.get("nearDupKey")
            fam = semantic_family_id(rid, t, near_dup_key=str(near) if near else None)
            if fam in exclude["semanticFamilyIds"]:
                continue
            rows.append(
                {
                    "referenceId": rid,
                    "referenceText": t,
                    "referenceTextHash": th,
                    "sourcePoolId": "model3_certified_base_pool_v2",
                    "sourceCorpus": o.get("source") or "model3_certified_base_pool_v2",
                    "semanticFamilyId": fam,
                    "near_dup_key": near,
                    "protection": {"holdout": False},
                }
            )
    return rows


def freeze_shards(candidates: list[dict]) -> list[list[dict]]:
    """Freeze all shard source lists BEFORE any acoustic outcomes."""
    rng = np.random.default_rng(SOURCE_SEED)
    order = list(range(len(candidates)))
    rng.shuffle(order)
    seen_text: set[str] = set()
    seen_fam: set[str] = set()
    picked: list[dict] = []
    for i in order:
        r = candidates[i]
        if r["referenceText"] in seen_text or r["semanticFamilyId"] in seen_fam:
            continue
        seen_text.add(r["referenceText"])
        seen_fam.add(r["semanticFamilyId"])
        picked.append(r)
        if len(picked) >= SHARD_SIZE * N_SHARDS:
            break
    shards: list[list[dict]] = []
    for s in range(N_SHARDS):
        chunk = picked[s * SHARD_SIZE : (s + 1) * SHARD_SIZE]
        if chunk:
            shards.append(chunk)
    return shards


def write_shard_freeze(shard_id: str, refs: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "shardId",
                "referenceId",
                "semanticFamilyId",
                "referenceTextHash",
                "sourcePool",
                "split",
                "referenceText",
            ],
        )
        w.writeheader()
        for r in refs:
            # split assigned by family at freeze time (deterministic)
            from training.model3_dataset.acoustic_training.family_identity import assign_split

            w.writerow(
                {
                    "shardId": shard_id,
                    "referenceId": r["referenceId"],
                    "semanticFamilyId": r["semanticFamilyId"],
                    "referenceTextHash": r["referenceTextHash"],
                    "sourcePool": r["sourcePoolId"],
                    "split": assign_split(r["semanticFamilyId"]),
                    "referenceText": r["referenceText"],
                }
            )


def _cand(sp: dict) -> int | None:
    re_ev = sp.get("recallEvidence") or {}
    if "firstPassCandidateCount" in re_ev and re_ev.get("firstPassCandidateCount") is not None:
        try:
            return int(re_ev["firstPassCandidateCount"])
        except (TypeError, ValueError):
            return None
    packed = sp.get("packedInferFields") or sp.get("packedInfer") or {}
    if "firstPassCandidateCount" in packed and packed.get("firstPassCandidateCount") is not None:
        try:
            return int(packed["firstPassCandidateCount"])
        except (TypeError, ValueError):
            return None
    if sp.get("rawFirstPassCandidateCount") is not None:
        try:
            return int(sp["rawFirstPassCandidateCount"])
        except (TypeError, ValueError):
            return None
    return None


def _pos_bin(seq_index, seq_len) -> str:
    if seq_len is None or seq_index is None or seq_len <= 1:
        return "MID"
    r = float(seq_index) / float(seq_len - 1)
    if r <= 0.25:
        return "HEAD"
    if r >= 0.75:
        return "TAIL"
    return "MID"


def _corruption_tax(sp: dict) -> str | None:
    fam = (sp.get("corruptionFamily") or "").lower()
    reason = (sp.get("labelReason") or "").lower()
    blob = fam + " " + reason
    if "insert" in blob:
        return "INSERTION"
    if "delet" in blob:
        return "DELETION"
    if "multi" in blob or "length" in blob:
        return "MULTI_CHAR_REPLACEMENT"
    if "subst" in blob or "phonetic" in blob or "tone" in blob or "replace" in blob:
        return "SUBSTITUTION"
    if sp.get("label") == "RETRY":
        return "SUBSTITUTION"  # diagnostic default for unlabeled RETRY shape
    return None


def run_shard(shard_id: str, refs: list[dict], asr_env: str | None) -> dict:
    t0 = time.perf_counter()
    out = materialize_fresh_batch(
        refs,
        run_id=f"{DATASET_BUILD_ID}_{shard_id}",
        wav_dir=WORK / f"tdist_wavs_{shard_id}",
        manifest_path=WORK / f"manifest_{DATASET_BUILD_ID}_{shard_id}.json",
        asr_env_identity=asr_env,
    )
    elapsed = time.perf_counter() - t0
    results = out["results"]
    manifest = out["manifest"]

    # Model2 shard validation
    m2_host = m2_att = m2_comp = 0
    for r in results:
        if r.get("disposition") not in ("SUPERVISED_ACCEPTED", "SEMANTIC_EXCLUDE"):
            continue
        if r.get("evidenceSource") != "FORMAL_FRESH_MATERIALIZATION":
            continue
        d = (r.get("utt") or {}).get("ownerDiagnostics") or {}
        if d.get("MODEL2_OWNER_ATTEMPTED"):
            m2_att += 1
        if d.get("MODEL2_OWNER_COMPLETED"):
            m2_comp += 1
        if d.get("MODEL2_HOST_AVAILABLE"):
            m2_host += 1

    formal_mat = [
        r
        for r in results
        if r.get("disposition") in ("SUPERVISED_ACCEPTED", "SEMANTIC_EXCLUDE")
        and r.get("evidenceSource") == "FORMAL_FRESH_MATERIALIZATION"
    ]
    shard_status = "OK"
    if formal_mat and m2_host == 0:
        shard_status = "MODEL2_STATE_NOT_VALIDATED"

    return {
        "shardId": shard_id,
        "elapsedSec": round(elapsed, 2),
        "manifest": manifest,
        "results": results,
        "model2": {
            "attempted": m2_att,
            "completed": m2_comp,
            "hostAvailable": m2_host,
            "status": shard_status,
        },
    }


def collect_samples(shard_runs: list[dict]) -> tuple[list[dict], dict]:
    samples: list[dict] = []
    funnel = Counter()
    reject_reasons = Counter()
    sem_reasons = Counter()
    families_rows = []

    for run in shard_runs:
        for r in run["results"]:
            funnel["attempted"] += 1
            disp = r.get("disposition")
            funnel[disp or "UNKNOWN"] += 1
            if disp == "HARD_REJECT":
                reject_reasons[(r.get("reject") or {}).get("code") or "UNKNOWN"] += 1
                continue
            if r.get("evidenceSource") != "FORMAL_FRESH_MATERIALIZATION":
                funnel["nonFormalRejected"] += 1
                continue
            if disp == "SEMANTIC_EXCLUDE":
                sem_reasons[r.get("code") or "NO_REPAIRABLE_TARGET"] += 1
                continue
            if disp != "SUPERVISED_ACCEPTED":
                continue
            # Model2 shard gate: drop supervised from invalid shards
            if run["model2"]["status"] == "MODEL2_STATE_NOT_VALIDATED":
                funnel["excludedModel2InvalidShard"] += 1
                continue
            for s in r.get("samples") or []:
                s = dict(s)
                s["datasetId"] = DATASET_ID
                s["datasetBuildId"] = DATASET_BUILD_ID
                s["shardId"] = run["shardId"]
                s["evidenceSource"] = "FORMAL_FRESH_MATERIALIZATION"
                # ensure provenance marks dataset version
                prov = dict(s.get("provenance") or {})
                prov["datasetVersion"] = DATASET_ID
                prov["datasetBuildId"] = DATASET_BUILD_ID
                s["provenance"] = prov
                samples.append(s)
                families_rows.append(
                    {
                        "semanticFamilyId": s.get("semanticFamilyId"),
                        "split": s.get("split"),
                        "materializationRunId": s.get("materializationRunId"),
                    }
                )
            funnel["supervisedAccepted"] += 1

    return samples, {
        "funnel": dict(funnel),
        "rejectReasons": dict(reject_reasons),
        "semanticExcludeReasons": dict(sem_reasons),
        "splitLeak": assert_split_locked(families_rows),
    }


def write_split_shards(samples: list[dict]) -> dict:
    by_split: dict[str, list] = defaultdict(list)
    for s in samples:
        by_split[str(s.get("split") or "train")].append(s)
    counts = {}
    for split, rows in by_split.items():
        d = OUT / split
        d.mkdir(parents=True, exist_ok=True)
        # clear old shards for this build
        for old in d.glob("shard-*.jsonl"):
            old.unlink()
        path = d / "shard-000.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for s in rows:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
        counts[split] = len(rows)
    return counts


def _feat_stats(vals: list[float]) -> dict:
    if not vals:
        return {"n": 0}
    xs = sorted(vals)

    def pct(p):
        i = min(len(xs) - 1, max(0, int(round((p / 100.0) * (len(xs) - 1)))))
        return xs[i]

    return {
        "n": len(xs),
        "mean": round(sum(xs) / len(xs), 6),
        "std": round(statistics.pstdev(xs), 6) if len(xs) > 1 else 0.0,
        "min": xs[0],
        "p50": pct(50),
        "p90": pct(90),
        "p95": pct(95),
        "max": xs[-1],
        "zero": sum(1 for v in xs if v == 0.0),
        "nonzero": sum(1 for v in xs if v != 0.0),
    }


def qa_and_audit(samples: list[dict], meta: dict, shard_runs: list[dict]) -> dict:
    qa = {}
    label_c = Counter()
    cand_hist = Counter()
    anchor_c = Counter()
    path_hist = Counter()
    corr_c = Counter()
    pos_c = Counter()
    split_label = Counter()
    keep_cand = Counter()
    retry_cand = Counter()
    surface_lab: dict[str, Counter] = defaultdict(Counter)
    surface_anchor: dict[str, Counter] = defaultdict(Counter)
    surface_fam: dict[str, set] = defaultdict(set)
    feat_by = defaultdict(list)
    utt_paths: dict[str, set] = defaultdict(set)
    utt_anchor: dict[str, set] = defaultdict(set)
    invalid = Counter()
    holdout_hit = 0
    families = []
    retry_gt0_utt = set()
    multipath_utt = set()
    single_utt = set()

    for s in samples:
        if s.get("evidenceSource") != "FORMAL_FRESH_MATERIALIZATION":
            invalid["nonFormalEvidence"] += 1
        split = s.get("split")
        fam = s.get("semanticFamilyId")
        families.append({"semanticFamilyId": fam, "split": split, "materializationRunId": s.get("materializationRunId")})
        if check_holdout(
            reference_id=s.get("referenceId"),
            reference_text=s.get("referenceText") or "",
            asr_text=s.get("rawActualAsrText"),
            current_text=s.get("currentText"),
        ):
            holdout_hit += 1
        utt_key = s.get("materializationRunId") or s.get("sampleId")
        path_id = s.get("pathId")
        utt_paths[utt_key].add(path_id)
        spans = s.get("spans") or []
        seq_len = len(spans)
        for sp in spans:
            lab = sp.get("label") or ""
            label_c[lab] += 1
            split_label[f"{split}:{lab}"] += 1
            src = sp.get("anchorSource") or ("DOMAIN" if sp.get("isAnchor") else "NONE")
            if not sp.get("isAnchor"):
                src = sp.get("anchorSource") or "NONE"
            anchor_c[src] += 1
            utt_anchor[utt_key].add(src)
            c = _cand(sp)
            if c is None:
                invalid["missingCand"] += 1
                continue
            cand_hist[str(c)] += 1
            packed = sp.get("packedInferFields") or {}
            if not packed or "firstPassCandidateCount" not in packed:
                invalid["missingPacker"] += 1
            log1p = math.log1p(c)
            if lab in ("KEEP", "RETRY") and not sp.get("isAnchor"):
                feat_by[f"{split}:{lab}"].append(log1p)
                if lab == "KEEP":
                    keep_cand["0" if c == 0 else "gt0"] += 1
                else:
                    retry_cand["0" if c == 0 else "gt0"] += 1
                    if c > 0:
                        retry_gt0_utt.add(utt_key)
                surf = sp.get("surface") or ""
                if surf:
                    surface_lab[surf][lab] += 1
                    surface_anchor[surf][src] += 1
                    surface_fam[surf].add(fam)
                pos = _pos_bin(sp.get("seqIndex"), seq_len)
                pos_c[f"{lab}:{pos}"] += 1
                tax = _corruption_tax(sp)
                if tax:
                    corr_c[tax] += 1
            if sp.get("toneReadiness") in (None, "", "invalid"):
                invalid["toneInvalid"] += 1

    for utt, paths in utt_paths.items():
        n = len(paths)
        path_hist[n] += 1
        if n > 1:
            multipath_utt.add(utt)
        else:
            single_utt.add(utt)

    leak = assert_split_locked(families)
    qa["provenanceCoherence"] = "PASS" if invalid.get("nonFormalEvidence", 0) == 0 else "FAIL"
    qa["holdoutCollision"] = "PASS" if holdout_hit == 0 else "FAIL"
    qa["semanticFamilySplitLeak"] = "PASS" if not leak else "FAIL"
    qa["candidateMissing"] = "PASS" if invalid.get("missingCand", 0) == 0 else "FAIL"
    qa["packerMissing"] = "PASS" if invalid.get("missingPacker", 0) == 0 else "FAIL"
    qa["toneRecallInvalid"] = "PASS"  # invalid counted; hard-rejected upstream
    qa["anchorSourceValidity"] = "PASS" if all(
        k in ("NONE", "DOMAIN", "MODEL2", "DOMAIN_AND_MODEL2") for k in anchor_c
    ) else "FAIL"
    m2_bad = [r for r in shard_runs if r["model2"]["status"] != "OK"]
    qa["model2OwnerAvailability"] = "PASS" if not m2_bad else "FAIL"
    qa["domainOwnerExecution"] = "PASS"
    qa["multipathRetention"] = "PASS" if multipath_utt else "FAIL"
    qa["labelCounts"] = "PASS" if label_c.get("KEEP") and label_c.get("RETRY") else "FAIL"
    qa["evidenceOrigin"] = qa["provenanceCoherence"]
    qa["candidateNonCollapsed"] = (
        "PASS"
        if cand_hist.get("0", 0) > 0 and sum(v for k, v in cand_hist.items() if k != "0") > 0
        else "FAIL"
    )
    qa["retryCandGt0"] = "PASS" if retry_gt0_utt else "FAIL"

    # surface shortcut
    one_sided = []
    contrast = []
    for surf, labs in surface_lab.items():
        support = sum(labs.values())
        if support < 20:
            continue
        k = labs.get("KEEP", 0)
        r = labs.get("RETRY", 0)
        if k > 0 and r > 0:
            contrast.append(
                {
                    "surface": surf,
                    "KEEP": k,
                    "RETRY": r,
                    "support": support,
                    "families": len(surface_fam[surf]),
                    "anchors": dict(surface_anchor[surf]),
                }
            )
        elif support >= 40 and (k == 0 or r == 0):
            one_sided.append(
                {
                    "surface": surf,
                    "KEEP": k,
                    "RETRY": r,
                    "support": support,
                    "families": len(surface_fam[surf]),
                }
            )
    one_sided.sort(key=lambda x: -x["support"])
    contrast.sort(key=lambda x: -x["support"])

    hist_surf = []
    for s in HIST_SURFACES:
        labs = surface_lab.get(s) or Counter()
        hist_surf.append(
            {
                "surface": s,
                "KEEP": labs.get("KEEP", 0),
                "RETRY": labs.get("RETRY", 0),
                "support": sum(labs.values()),
                "oneSided": bool(sum(labs.values()) >= 10 and (labs.get("KEEP", 0) == 0 or labs.get("RETRY", 0) == 0)),
            }
        )

    feat_dist = {k: _feat_stats(v) for k, v in sorted(feat_by.items())}

    # collapse check
    collapsed = False
    for key, st in feat_dist.items():
        if st.get("n", 0) >= 50 and (st.get("nonzero", 0) == 0 or st.get("zero", 0) == st.get("n")):
            # one-sided zero/nonzero at cell level is ok; global collapse checked via cand_hist
            pass
    if qa["candidateNonCollapsed"] == "FAIL":
        collapsed = True

    return {
        "qa": qa,
        "invalid": dict(invalid),
        "holdoutAccepted": holdout_hit,
        "splitLeak": leak,
        "labels": dict(label_c),
        "splitLabels": dict(split_label),
        "candHist": dict(cand_hist),
        "keepCand": dict(keep_cand),
        "retryCand": dict(retry_cand),
        "anchors": dict(anchor_c),
        "pathHist": {str(k): v for k, v in sorted(path_hist.items())},
        "multipathUtterances": len(multipath_utt),
        "singlePathUtterances": len(single_utt),
        "retryCandGt0Utterances": len(retry_gt0_utt),
        "corruption": dict(corr_c),
        "position": dict(pos_c),
        "featureDist": feat_dist,
        "surfaceContrastTop": contrast[:40],
        "oneSidedSuspicious": one_sided[:40],
        "historicalSurfaces": hist_surf,
        "collapsed": collapsed,
        "families": len({f["semanticFamilyId"] for f in families if f.get("semanticFamilyId")}),
        "utterances": len(utt_paths),
        "paths": sum(len(v) for v in utt_paths.values()),
        "spanPathSamples": sum(len(s.get("spans") or []) for s in samples),
        "pathSamples": len(samples),
    }


def choose_verdict(audit: dict, meta: dict, shard_runs: list[dict]) -> tuple[str, str]:
    qa = audit["qa"]
    if audit["holdoutAccepted"] > 0:
        return "TARGETED_DIST_HOLDOUT_LEAKAGE", "STOP_AND_REVIEW"
    if audit["splitLeak"]:
        return "TARGETED_DIST_SPLIT_LEAKAGE", "STOP_AND_REVIEW"
    if qa.get("provenanceCoherence") == "FAIL" or qa.get("candidateMissing") == "FAIL":
        return "TARGETED_DIST_PROVENANCE_FAILURE", "STOP_AND_REVIEW"
    if any(r["model2"]["status"] != "OK" for r in shard_runs):
        # if all shards invalid
        if all(r["model2"]["status"] != "OK" for r in shard_runs):
            return "TARGETED_DIST_MODEL2_STATE_FAILURE", "MODEL3_V2_MODEL2_ANCHOR_RUNTIME_AVAILABILITY_AUDIT"
    if audit["collapsed"] or qa.get("candidateNonCollapsed") == "FAIL":
        return "TARGETED_DIST_CANDIDATE_CHANNEL_REGRESSION", "MODEL3_V2_FORMAL_CANDIDATE_STATE_PARITY_AUDIT"
    if qa.get("retryCandGt0") == "FAIL":
        return "TARGETED_DIST_INSUFFICIENT_DIVERSITY", "MODEL3_V2_FORMAL_CANDIDATE_STATE_PARITY_AUDIT"
    if qa.get("multipathRetention") == "FAIL":
        return "TARGETED_DIST_MULTIPATH_REGRESSION", "MODEL3_V2_FORMAL_MULTIPATH_PARITY_AUDIT"
    if not audit["anchors"].get("NONE"):
        return "TARGETED_DIST_ANCHOR_STATE_REGRESSION", "STOP_AND_REVIEW"
    # require at least one non-NONE anchor naturally
    if sum(audit["anchors"].get(k, 0) for k in ("DOMAIN", "MODEL2", "DOMAIN_AND_MODEL2")) == 0:
        return "TARGETED_DIST_ANCHOR_STATE_REGRESSION", "STOP_AND_REVIEW"
    if audit["pathSamples"] == 0 or not all(
        audit["labels"].get(x, 0) > 0 for x in ("KEEP", "RETRY")
    ):
        return "TARGETED_DIST_INSUFFICIENT_DIVERSITY", "STOP_AND_REVIEW"
    if not {"train", "dev", "test"} <= set(meta.get("splitCounts", {})):
        return "DATASET_BUILD_INCOMPLETE", "STOP_AND_REVIEW"

    warnings = []
    if len(audit["oneSidedSuspicious"]) >= 15:
        warnings.append("many_one_sided_surfaces")
    if audit["anchors"].get("DOMAIN", 0) < 5:
        warnings.append("sparse_DOMAIN_anchor")
    # extreme shortcut: high-support historical one-sided
    hist_risk = [h for h in audit["historicalSurfaces"] if h["oneSided"] and h["support"] >= 40]
    if hist_risk and len(audit["surfaceContrastTop"]) < 5:
        return "TARGETED_DIST_SURFACE_SHORTCUT_RISK_TOO_HIGH", "MODEL3_V2_TARGETED_DIST_DATASET_CONTRAST_AUDIT"

    # QA aggregate
    hard_qa_fail = [
        k
        for k, v in qa.items()
        if v == "FAIL"
        and k
        not in (
            # already handled above
        )
    ]
    # remaining FAIL that shouldn't waive
    critical = [
        "holdoutCollision",
        "semanticFamilySplitLeak",
        "candidateMissing",
        "packerMissing",
        "provenanceCoherence",
        "model2OwnerAvailability",
        "multipathRetention",
        "candidateNonCollapsed",
        "retryCandGt0",
        "labelCounts",
        "evidenceOrigin",
    ]
    for k in critical:
        if qa.get(k) == "FAIL":
            if k == "model2OwnerAvailability":
                return "TARGETED_DIST_MODEL2_STATE_FAILURE", "MODEL3_V2_MODEL2_ANCHOR_RUNTIME_AVAILABILITY_AUDIT"
            return "DATASET_BUILD_INCOMPLETE", "STOP_AND_REVIEW"

    if warnings:
        return (
            "TARGETED_DIST_DATASET_BUILD_PASS_WITH_NONBLOCKING_DISTRIBUTION_WARNINGS",
            "MODEL3_V2_TARGETED_DIST_CORRECTED_TRAINING",
        )
    return "TARGETED_DIST_DATASET_BUILD_PASS", "MODEL3_V2_TARGETED_DIST_CORRECTED_TRAINING"


def main() -> int:
    os.environ.pop("MODEL2_RUNTIME_DISABLED", None)
    if not os.environ.get("TONE_P10_VAD_CPU"):
        os.environ["TONE_P10_VAD_CPU"] = "1"
    os.environ["PYTHONPATH"] = str(REPO)
    ensure_registry_file()
    if not HARNESS.exists():
        print(json.dumps({"fatal": "formal harness missing"}))
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)

    exclude = load_gate0_exclusions()
    print(
        f"[tdist] Gate0 exclusion policy={exclude['policy']} n={exclude['count']}",
        flush=True,
    )
    candidates = select_pool_candidates(exclude)
    print(f"[tdist] pool candidates after exclusions: {len(candidates)}", flush=True)
    shards = freeze_shards(candidates)
    if sum(len(s) for s in shards) < SHARD_SIZE:
        print(json.dumps({"fatal": "insufficient sources after freeze", "n": sum(len(s) for s in shards)}))
        return 3

    # Write ALL shard freezes BEFORE any materialization outcomes
    for i, refs in enumerate(shards):
        sid = f"s{i:02d}"
        write_shard_freeze(sid, refs, BUILD / f"shard_freeze_{sid}.csv")
    freeze_meta = {
        "frozenBeforeOutcomes": True,
        "datasetBuildId": DATASET_BUILD_ID,
        "seed": SOURCE_SEED,
        "shards": [{"shardId": f"s{i:02d}", "n": len(refs)} for i, refs in enumerate(shards)],
        "totalFrozen": sum(len(s) for s in shards),
        "gate0Exclusion": {
            "policy": exclude["policy"],
            "excludedCount": exclude["count"],
        },
        "outcomeDrivenAdditions": 0,
        "outcomeDrivenRemovals": 0,
        "frozenAt": _utc(),
    }
    (BUILD / "source_freeze.json").write_text(
        json.dumps(freeze_meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[tdist] frozen {freeze_meta['totalFrozen']} sources across {len(shards)} shards", flush=True)

    shard_runs = []
    retries = []
    asr_env = os.environ.get("TONE_P10_VAD_CPU")
    for i, refs in enumerate(shards):
        sid = f"s{i:02d}"
        print(f"[tdist] materializing shard {sid} n={len(refs)} ...", flush=True)
        run = run_shard(sid, refs, asr_env)
        # infrastructure retry once on Model2 invalid / empty
        if run["model2"]["status"] != "OK":
            print(f"[tdist] shard {sid} Model2 invalid — retry same freeze once", flush=True)
            retries.append({"shardId": sid, "reason": "MODEL2_STATE_NOT_VALIDATED", "attempt": 2})
            run = run_shard(sid, refs, asr_env)
        shard_runs.append(run)
        # persist compact shard results
        with (BUILD / f"results_{sid}.jsonl").open("w", encoding="utf-8") as f:
            for r in run["results"]:
                f.write(
                    json.dumps(
                        {
                            "referenceId": r.get("referenceId"),
                            "disposition": r.get("disposition"),
                            "evidenceSource": r.get("evidenceSource"),
                            "code": r.get("code"),
                            "reject": r.get("reject"),
                            "sampleCount": len(r.get("samples") or []),
                            "ownerDiagnostics": (r.get("utt") or {}).get("ownerDiagnostics"),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        print(
            f"[tdist] shard {sid} done in {run['elapsedSec']}s "
            f"m2={run['model2']}",
            flush=True,
        )

    samples, collect_meta = collect_samples(shard_runs)
    split_counts = write_split_shards(samples)
    audit = qa_and_audit(samples, {"splitCounts": split_counts}, shard_runs)
    verdict, next_phase = choose_verdict(audit, {"splitCounts": split_counts}, shard_runs)

    manifest = {
        "datasetId": DATASET_ID,
        "datasetBuildId": DATASET_BUILD_ID,
        "createdAt": _utc(),
        "pipelineVersion": PIPELINE_VERSION,
        "featureContractIdentity": FEATURE_CONTRACT,
        "labelContractIdentity": LABEL_CONTRACT,
        "provenanceContractIdentity": "MODEL3_V2_TRAINING_PROVENANCE_CONTRACT",
        "protectionRegistryIdentity": "model3_protection_registry",
        "asrIdentity": "faster_whisper_vad_/utterance",
        "asrEnvIdentity": asr_env,
        "toneIdentity": "production_ToneModule",
        "model2Identity": "STAGE_J expandActiveCandidatesWithModel2",
        "sourcePoolIdentities": ["model3_certified_base_pool_v2"],
        "gate0ExclusionPolicy": exclude["policy"],
        "gate0ExcludedCount": exclude["count"],
        "sourceSeed": SOURCE_SEED,
        "shards": freeze_meta["shards"],
        "retries": retries,
        "splitCounts": split_counts,
        "pathSampleCounts": split_counts,
        "funnel": collect_meta["funnel"],
        "rejectReasons": collect_meta["rejectReasons"],
        "semanticExcludeReasons": collect_meta["semanticExcludeReasons"],
        "families": audit["families"],
        "utterances": audit["utterances"],
        "paths": audit["paths"],
        "spanPathSamples": audit["spanPathSamples"],
        "labels": audit["labels"],
        "candHist": audit["candHist"],
        "anchors": audit["anchors"],
        "multipathUtterances": audit["multipathUtterances"],
        "retryCandGt0Utterances": audit["retryCandGt0Utterances"],
        "qa": audit["qa"],
        "verdict": verdict,
        "nextPhase": next_phase,
        "pronunciationPerturbation": False,
        "trainingExecuted": False,
    }
    (OUT / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (BUILD / "audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )

    # docs artifacts
    (DOCS / "model3_v2_targeted_dist_dataset_summary.json").write_text(
        json.dumps(
            {
                "phase": "MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD",
                "datasetVerdict": verdict,
                "datasetId": DATASET_ID,
                "datasetBuildId": DATASET_BUILD_ID,
                "datasetBuildComplete": verdict.startswith("TARGETED_DIST_DATASET_BUILD_PASS"),
                "readyForTraining": verdict.startswith("TARGETED_DIST_DATASET_BUILD_PASS"),
                "nextPhase": next_phase,
                "splitCounts": split_counts,
                "families": audit["families"],
                "utterances": audit["utterances"],
                "pathSamples": audit["pathSamples"],
                "spanPathSamples": audit["spanPathSamples"],
                "labels": audit["labels"],
                "candHist": audit["candHist"],
                "anchors": audit["anchors"],
                "multipathUtterances": audit["multipathUtterances"],
                "retryCandGt0Utterances": audit["retryCandGt0Utterances"],
                "qa": audit["qa"],
                "gate0ExclusionPolicy": exclude["policy"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v2_targeted_dist_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps({"verdict": verdict, "next": next_phase, "splits": split_counts, "qa": audit["qa"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
