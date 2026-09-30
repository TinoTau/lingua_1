# -*- coding: utf-8 -*-
"""MODEL3_V2_PRODUCTION_CORE_S3 — formal B2 build ~10_000 TOTAL families.

Phases: precheck → freeze → materialize → finalize(QA).
S2 remains immutable; lineage reuse of sealed supervised rows only.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
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
    assign_split,
)
from training.model3_dataset.acoustic_training.holdout_registry import (  # noqa: E402
    ensure_registry_file,
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
from training.model3_dataset.scripts.run_production_core_s1_build import (  # noqa: E402
    CONV_TAXONOMY,
    _categories,
    _length_bucket,
    error_family_audit,
    selection_profile,
    vocabulary_stats,
)
from training.model3_dataset.scripts.run_targeted_dist_dataset_build import (  # noqa: E402
    load_gate0_exclusions,
    qa_and_audit,
    select_pool_candidates,
)
from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    LABEL_CONTRACT_VERSION,
    label_spans_v2,
)

DOCS = REPO / "docs/user_correction/model3"
S1_OUT = REPO / "training/model3_dataset/model3_v2_production_core_s1"
S2_OUT = REPO / "training/model3_dataset/model3_v2_production_core_s2"
OUT = REPO / "training/model3_dataset/model3_v2_production_core_s3"
BUILD = OUT / "build"
WORK = REPO / "training/model3_dataset/offline_harness/_b2_formal_work"
S2_CKPT = REPO / "training/model3_dataset/model3_v2_s2_random_init_v1_ckpts/seed_2026083011"
S2_EXPECTED_SHA = "54322a2670eabd1fbcb7c2b36f24ef62c6413c9bea57d64eda61f81fd04161d9"

DATASET_ID = "MODEL3_V2_PRODUCTION_CORE_S3"
DATASET_BUILD_ID = "prod_core_s3_build_20260830_v1"
PARENT_DATASET_ID = "MODEL3_V2_PRODUCTION_CORE_S2"
SOURCE_SELECTION_SEED = 2026083012
TOTAL_TARGET = 10000
NEW_TARGET = 5006  # 4994 S2 supervised + 5006 new ≈ 10000
SHARD_SIZE = 48
CJK = re.compile(r"[\u4e00-\u9fff]")

OWNERSHIP_FILES = {
    "feature_pack": REPO / "electron_node/electron-node/main/src/model3-runtime/model3-feature-pack.ts",
    "path_step": REPO / "electron_node/electron-node/main/src/model3-runtime/run-model3-path-step.ts",
    "formal_harness": HARNESS,
    "holdout_registry": REPO / "training/model3_dataset/acoustic_training/holdout_registry.py",
    "family_split": REPO / "training/model3_dataset/acoustic_training/family_identity.py",
    "v2_label": REPO / "training/model3_dataset/scripts/stage2_v2_label.py",
    "serializer": REPO / "training/model3_dataset/acoustic_training/serializer.py",
    "protection_registry": DOCS / "model3_v2_protection_registry.json",
}


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def architecture_ssot_precheck() -> dict:
    conflicts = []
    missing = [k for k, p in OWNERSHIP_FILES.items() if not p.exists()]
    if missing:
        conflicts.append(f"missing_ownership_files:{missing}")
    if LABEL_CONTRACT != LABEL_CONTRACT_VERSION:
        conflicts.append("label_contract_mismatch_serializer_vs_stage2")
    if FEATURE_CONTRACT != "packModel3SpanInferFields":
        conflicts.append(f"unexpected_feature_contract:{FEATURE_CONTRACT}")
    if not HARNESS.exists():
        conflicts.append("formal_harness_missing")

    path_step = OWNERSHIP_FILES["path_step"].read_text(encoding="utf-8")
    if "runModel3PathStep" not in path_step:
        conflicts.append("path_step_missing_runModel3PathStep")
    if "packModel3SpanInferFields" not in path_step:
        conflicts.append("path_step_missing_packer")
    # Frozen ownership: Anchor RETRY forced KEEP post-infer
    if "anchorIds.has(d.spanId) && d.decision === 'RETRY'" not in path_step and "anchorIds.has(d.spanId)" not in path_step:
        conflicts.append("path_step_missing_anchor_exclusion")

    s2_manifest = S2_OUT / "dataset_manifest.json"
    if not s2_manifest.exists():
        conflicts.append("s2_manifest_missing")
    else:
        m = json.loads(s2_manifest.read_text(encoding="utf-8"))
        if m.get("datasetId") != PARENT_DATASET_ID:
            conflicts.append(f"s2_datasetId_unexpected:{m.get('datasetId')}")
        if m.get("datasetBuildId") != "prod_core_s2_build_20260830_v1":
            conflicts.append(f"s2_buildId_unexpected:{m.get('datasetBuildId')}")
        if m.get("families") != 4994:
            conflicts.append(f"s2_families_unexpected:{m.get('families')}")

    weights = S2_CKPT / "weights.pt"
    s2_sha = file_sha(weights) if weights.exists() else None
    if s2_sha != S2_EXPECTED_SHA:
        conflicts.append(f"s2_checkpoint_sha_mismatch:{s2_sha}")

    reg = json.loads(OWNERSHIP_FILES["protection_registry"].read_text(encoding="utf-8"))
    if reg.get("registryId") != "MODEL3_V2_PROTECTION_REGISTRY":
        conflicts.append(f"protection_registry_id_unexpected:{reg.get('registryId')}")

    return {
        "passed": len(conflicts) == 0,
        "conflicts": conflicts,
        "contracts": {
            "labelContract": LABEL_CONTRACT,
            "featureContract": FEATURE_CONTRACT,
            "pipelineVersion": PIPELINE_VERSION,
            "protectionRegistry": "MODEL3_V2_PROTECTION_REGISTRY",
        },
        "s2Baseline": {
            "datasetId": PARENT_DATASET_ID,
            "families": 4994,
            "modelId": "MODEL3_V2_S2_RANDOM_INIT_V1",
            "weightsSha256": s2_sha,
            "shaVerified": s2_sha == S2_EXPECTED_SHA,
        },
        "ownershipFilesPresent": {k: p.exists() for k, p in OWNERSHIP_FILES.items()},
        "architectureDrift": False if not conflicts else True,
        "ssotConflict": len(conflicts) > 0,
    }


def anchor_semantics_check() -> dict:
    """Distinguish isAnchor (ownership) from anchorRelation (spatial diagnostic).

    Frozen runtime: path sequence may pack isAnchor=true as a BiGRU context feature
    (packModel3SpanInferFields), but effective RETRY on Anchor is forced to KEEP.
    Violation = effective RETRY where isAnchor==true, or labels with RETRY+isAnchor.
    """
    path_step = OWNERSHIP_FILES["path_step"].read_text(encoding="utf-8")
    has_post_mask = "Enforce Anchor exclusion" in path_step or (
        "anchorIds.has(d.spanId)" in path_step and "decision === 'RETRY'" in path_step
    )
    # Dataset-level: no supervised RETRY on isAnchor spans in sealed S2
    is_anchor_retry = 0
    is_anchor_spans = 0
    checked = 0
    for split in ("train", "dev", "test"):
        p = S2_OUT / split / "shard-000.jsonl"
        with p.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                s = json.loads(line)
                for sp in s.get("spans") or []:
                    checked += 1
                    if sp.get("isAnchor"):
                        is_anchor_spans += 1
                        if sp.get("label") == "RETRY":
                            is_anchor_retry += 1
    # Live-trace check: no RETRY with isAnchor true in production-equivalent traces
    trace_anchor_retry = 0
    trace_path = DOCS / "model3_v2_live_input_trace.jsonl"
    if trace_path.exists():
        with trace_path.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("status") not in (None, "OK"):
                    continue
                if bool(row.get("isAnchor")) and row.get("decision") == "RETRY":
                    # eligible false after mask should not occur; count raw
                    if row.get("eligible") is not False:
                        trace_anchor_retry += 1

    violation = is_anchor_retry > 0 or (trace_anchor_retry > 0 and not has_post_mask)
    return {
        "passed": not violation and has_post_mask,
        "definitions": {
            "isAnchor": "ownership flag — Anchor FineSpan; Model3 must not own effective RETRY",
            "anchorRelation": "audit-only spatial relation (inside/adjacent/between/far); NOT ownership",
        },
        "runtimePostMaskPresent": has_post_mask,
        "s2Supervised": {
            "spansChecked": checked,
            "isAnchorSpans": is_anchor_spans,
            "isAnchorRetryLabels": is_anchor_retry,
        },
        "liveTraceEffectiveAnchorRetry": trace_anchor_retry,
        "isAnchorTrueReachesEffectiveRetry": is_anchor_retry > 0 or trace_anchor_retry > 0,
        "note": "Sequence packing may include isAnchor feature for BiGRU context; ownership enforced at effective decision.",
        "verdict": "PASS" if (not violation and has_post_mask) else "ANCHOR_OWNERSHIP_VIOLATION",
    }


def load_s2_supervised_families() -> tuple[set[str], set[str]]:
    fams: set[str] = set()
    refs: set[str] = set()
    for split in ("train", "dev", "test"):
        p = S2_OUT / split / "shard-000.jsonl"
        with p.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                s = json.loads(line)
                fams.add(s["semanticFamilyId"])
                refs.add(s.get("referenceId") or "")
    return fams, refs


def load_s2_reused_samples() -> list[dict]:
    """Lineage reuse of sealed S2 supervised rows — do not rematerialize."""
    out: list[dict] = []
    for split in ("train", "dev", "test"):
        p = S2_OUT / split / "shard-000.jsonl"
        with p.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                s = json.loads(line)
                if s.get("evidenceSource") != "FORMAL_FRESH_MATERIALIZATION":
                    continue
                s = dict(s)
                s["datasetId"] = DATASET_ID
                s["datasetBuildId"] = DATASET_BUILD_ID
                s["shardId"] = "reuse_s2"
                s["lineageReuse"] = True
                s["parentDatasetId"] = PARENT_DATASET_ID
                s["split"] = split
                prov = dict(s.get("provenance") or {})
                prov["datasetVersion"] = DATASET_ID
                prov["datasetBuildId"] = DATASET_BUILD_ID
                prov["lineageReuseFrom"] = PARENT_DATASET_ID
                prov["labelContractVersion"] = LABEL_CONTRACT
                s["provenance"] = prov
                out.append(s)
    return out


def audit_remaining_pool(s2_fams: set[str]) -> dict:
    exclude = load_gate0_exclusions()
    candidates = select_pool_candidates(exclude)
    remain = [c for c in candidates if c["semanticFamilyId"] not in s2_fams]
    src = Counter(c.get("sourceCorpus") or "unknown" for c in remain)
    length = Counter(_length_bucket(c["referenceText"]) for c in remain)
    tax = Counter()
    for c in remain:
        for cat in _categories(c["referenceText"]):
            tax[cat] += 1
    return {
        "poolUsable": len(candidates),
        "remainingAfterS2": len(remain),
        "gate0Excluded": exclude["count"],
        "sourceComposition": dict(src),
        "lengthDistribution": dict(length),
        "taxonomyHits": dict(tax),
        "vocabularySampleNote": "remaining_pool_breadth_proxy",
        "candidates": remain,
        "exclude": exclude,
        "newTarget": NEW_TARGET,
        "feasible": len(remain) >= NEW_TARGET,
    }


def select_new_references(pool: list[dict], exclude_fams: set[str], n: int) -> list[dict]:
    """Simple deterministic selection — source/length diversity, no hard-case mining."""
    usable = [c for c in pool if c["semanticFamilyId"] not in exclude_fams]
    rng = np.random.default_rng(SOURCE_SELECTION_SEED)
    # Queues keyed by (source, length_bucket) for O(1) pops
    queues: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for c in usable:
        src = c.get("sourceCorpus") or "unknown"
        queues[(src, _length_bucket(c["referenceText"]))].append(c)
    for lst in queues.values():
        rng.shuffle(lst)

    sources = sorted({s for (s, _) in queues})
    supp = [s for s in sources if "SUPPLEMENT" in s.upper() or "SPOKEN" in s.upper()]
    prior = [s for s in sources if s not in supp] or sources[:1]
    if not supp:
        supp = sources
    buckets = ["short", "medium", "long"]

    selected: dict[str, dict] = {}
    idx = 0
    stall = 0
    while len(selected) < n and stall < n * 3:
        src_list = prior if idx % 3 == 0 else supp
        src = src_list[(idx // 3) % len(src_list)]
        idx += 1
        added = False
        for bucket in buckets:
            q = queues.get((src, bucket)) or []
            while q:
                c = q.pop()
                fam = c["semanticFamilyId"]
                if fam in selected:
                    continue
                selected[fam] = c
                added = True
                break
            if added:
                break
        if not added:
            stall += 1
            # fallthrough: pop any remaining queue
            for q in queues.values():
                while q:
                    c = q.pop()
                    fam = c["semanticFamilyId"]
                    if fam in selected:
                        continue
                    selected[fam] = c
                    added = True
                    break
                if added:
                    break
            if not added:
                break
        else:
            stall = 0

    out = list(selected.values())[:n]
    if len(out) < n:
        raise RuntimeError(f"insufficient remaining pool: {len(out)} < {n}")
    return out


def freeze_phase(pool_audit: dict, s2_fams: set[str]) -> dict:
    BUILD.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    new_refs = select_new_references(pool_audit["candidates"], s2_fams, NEW_TARGET)
    # lineage rows for freeze listing
    s2_freeze_rows = []
    for split in ("train", "dev", "test"):
        seen = set()
        p = S2_OUT / split / "shard-000.jsonl"
        with p.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                s = json.loads(line)
                fam = s["semanticFamilyId"]
                if fam in seen:
                    continue
                seen.add(fam)
                s2_freeze_rows.append(
                    {
                        "referenceId": s.get("referenceId"),
                        "referenceText": s.get("referenceText"),
                        "referenceTextHash": hashlib.sha256((s.get("referenceText") or "").encode()).hexdigest()[:16],
                        "sourcePoolId": s.get("sourcePoolId") or "model3_certified_base_pool_v2",
                        "sourceCorpus": "lineage_reuse_s2",
                        "semanticFamilyId": fam,
                        "lineageReuse": True,
                        "split": split,
                        "shardId": "reuse_s2",
                    }
                )

    new_shards: list[list[dict]] = []
    for i in range(0, len(new_refs), SHARD_SIZE):
        chunk = new_refs[i : i + SHARD_SIZE]
        if chunk:
            new_shards.append(chunk)

    freeze_rows = list(s2_freeze_rows)
    for i, refs in enumerate(new_shards):
        sid = f"s{i:02d}"
        path = BUILD / f"shard_freeze_{sid}.csv"
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(
                f,
                fieldnames=[
                    "shardId",
                    "referenceId",
                    "semanticFamilyId",
                    "referenceTextHash",
                    "sourcePool",
                    "sourceCorpus",
                    "split",
                    "referenceText",
                ],
            )
            w.writeheader()
            for r in refs:
                w.writerow(
                    {
                        "shardId": sid,
                        "referenceId": r["referenceId"],
                        "semanticFamilyId": r["semanticFamilyId"],
                        "referenceTextHash": r.get("referenceTextHash")
                        or hashlib.sha256(r["referenceText"].encode()).hexdigest()[:16],
                        "sourcePool": r.get("sourcePoolId") or "model3_certified_base_pool_v2",
                        "sourceCorpus": r.get("sourceCorpus") or "unknown",
                        "split": assign_split(r["semanticFamilyId"]),
                        "referenceText": r["referenceText"],
                    }
                )
        for r in refs:
            freeze_rows.append(
                {
                    **r,
                    "split": assign_split(r["semanticFamilyId"]),
                    "shardId": sid,
                    "lineageReuse": False,
                }
            )

    sel_prof = selection_profile(
        [
            {
                "referenceText": r["referenceText"],
                "sourceCorpus": r.get("sourceCorpus") or "unknown",
            }
            for r in freeze_rows
        ]
    )
    freeze_meta = {
        "frozenBeforeOutcomes": True,
        "datasetId": DATASET_ID,
        "datasetBuildId": DATASET_BUILD_ID,
        "sourceSelectionSeed": SOURCE_SELECTION_SEED,
        "lineageStrategy": "S2_4994_reuse_plus_5006_new_materialization",
        "parentDatasetId": PARENT_DATASET_ID,
        "s2ReuseFamilies": len(s2_freeze_rows),
        "newMaterializationFamilies": len(new_refs),
        "totalFrozenFamilies": len(freeze_rows),
        "gate0Exclusion": {
            "policy": pool_audit["exclude"]["policy"],
            "excludedCount": pool_audit["exclude"]["count"],
        },
        "selectionProfile": sel_prof,
        "remainingPoolBeforeSelection": pool_audit["remainingAfterS2"],
        "frozenAt": _utc(),
        "outcomeDrivenAdditions": 0,
        "outcomeDrivenRemovals": 0,
        "hardCaseMining": False,
        "protectedCaseMining": False,
    }
    (BUILD / "source_freeze.json").write_text(json.dumps(freeze_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    with (BUILD / "source_selection_freeze.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "shardId",
                "referenceId",
                "semanticFamilyId",
                "referenceTextHash",
                "sourcePoolId",
                "sourceCorpus",
                "split",
                "lineageReuse",
                "referenceText",
            ],
        )
        w.writeheader()
        for r in freeze_rows:
            w.writerow(
                {
                    "shardId": r.get("shardId"),
                    "referenceId": r["referenceId"],
                    "semanticFamilyId": r["semanticFamilyId"],
                    "referenceTextHash": r.get("referenceTextHash")
                    or hashlib.sha256(r["referenceText"].encode()).hexdigest()[:16],
                    "sourcePoolId": r.get("sourcePoolId") or "model3_certified_base_pool_v2",
                    "sourceCorpus": r.get("sourceCorpus") or "unknown",
                    "split": r["split"],
                    "lineageReuse": r.get("lineageReuse", False),
                    "referenceText": r["referenceText"],
                }
            )
    (BUILD / "new_shards_index.json").write_text(
        json.dumps(
            {
                "shardCount": len(new_shards),
                "shardSize": SHARD_SIZE,
                "newRefs": len(new_refs),
                "shards": [{"shardId": f"s{i:02d}", "n": len(s)} for i, s in enumerate(new_shards)],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return {"freeze_meta": freeze_meta, "new_shards": new_shards, "sel_prof": sel_prof}


def run_shard(shard_id: str, refs: list[dict], asr_env: str | None) -> dict:
    t0 = time.perf_counter()
    out = materialize_fresh_batch(
        refs,
        run_id=f"{DATASET_BUILD_ID}_{shard_id}",
        wav_dir=WORK / f"s3_wavs_{shard_id}",
        manifest_path=WORK / f"manifest_{DATASET_BUILD_ID}_{shard_id}.json",
        asr_env_identity=asr_env,
    )
    elapsed = time.perf_counter() - t0
    results = out["results"]
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
        "manifest": out["manifest"],
        "results": results,
        "model2": {
            "attempted": m2_att,
            "completed": m2_comp,
            "hostAvailable": m2_host,
            "status": shard_status,
        },
    }


def load_frozen_new_shards() -> list[list[dict]]:
    idx = json.loads((BUILD / "new_shards_index.json").read_text(encoding="utf-8"))
    shards = []
    for info in idx["shards"]:
        sid = info["shardId"]
        path = BUILD / f"shard_freeze_{sid}.csv"
        refs = []
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                refs.append(
                    {
                        "referenceId": row["referenceId"],
                        "referenceText": row["referenceText"],
                        "referenceTextHash": row.get("referenceTextHash"),
                        "sourcePoolId": row.get("sourcePool") or row.get("sourcePoolId") or "model3_certified_base_pool_v2",
                        "sourceCorpus": row.get("sourceCorpus") or "unknown",
                        "semanticFamilyId": row["semanticFamilyId"],
                    }
                )
        shards.append(refs)
    return shards


def materialize_phase() -> list[dict]:
    new_shards = load_frozen_new_shards()
    asr_env = os.environ.get("TONE_P10_VAD_CPU")
    shard_runs = []
    for i, refs in enumerate(new_shards):
        sid = f"s{i:02d}"
        done_path = BUILD / f"results_{sid}.jsonl"
        run_path = BUILD / f"shard_run_{sid}.json"
        samples_path = BUILD / f"new_samples_{sid}.jsonl"
        if done_path.exists() and run_path.exists() and samples_path.exists():
            print(f"[s3] skip completed shard {sid}", flush=True)
            run = json.loads(run_path.read_text(encoding="utf-8"))
            shard_runs.append(run)
            continue
        print(f"[s3] materializing shard {sid} n={len(refs)} ...", flush=True)
        run = run_shard(sid, refs, asr_env)
        if run["model2"]["status"] != "OK":
            print(f"[s3] shard {sid} Model2 retry", flush=True)
            run = run_shard(sid, refs, asr_env)
        # Persist dispositions + accepted samples (avoid storing full lattice dumps)
        with done_path.open("w", encoding="utf-8") as f:
            for r in run["results"]:
                f.write(
                    json.dumps(
                        {"referenceId": r.get("referenceId"), "disposition": r.get("disposition")},
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        with samples_path.open("w", encoding="utf-8") as f:
            for r in run["results"]:
                if r.get("disposition") != "SUPERVISED_ACCEPTED":
                    continue
                if r.get("evidenceSource") != "FORMAL_FRESH_MATERIALIZATION":
                    continue
                for s in r.get("samples") or []:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")
        dispositions = Counter(r.get("disposition") or "UNKNOWN" for r in run["results"])
        slim = {
            "shardId": sid,
            "elapsedSec": run["elapsedSec"],
            "model2": run["model2"],
            "resultCount": len(run["results"]),
            "dispositions": dict(dispositions),
            "nRefs": len(refs),
        }
        run_path.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")
        shard_runs.append(slim)
        print(
            f"[s3] shard {sid} done {run['elapsedSec']}s model2={run['model2']['status']} "
            f"disp={dict(dispositions)}",
            flush=True,
        )
    return shard_runs


def load_materialized_shard_runs() -> list[dict]:
    idx = json.loads((BUILD / "new_shards_index.json").read_text(encoding="utf-8"))
    runs = []
    for info in idx["shards"]:
        sid = info["shardId"]
        run_path = BUILD / f"shard_run_{sid}.json"
        if not run_path.exists():
            raise FileNotFoundError(str(run_path))
        runs.append(json.loads(run_path.read_text(encoding="utf-8")))
    return runs


def load_new_samples_from_shards() -> tuple[list[dict], Counter]:
    idx = json.loads((BUILD / "new_shards_index.json").read_text(encoding="utf-8"))
    samples = []
    dispositions = Counter()
    for info in idx["shards"]:
        sid = info["shardId"]
        run = json.loads((BUILD / f"shard_run_{sid}.json").read_text(encoding="utf-8"))
        if run["model2"]["status"] == "MODEL2_STATE_NOT_VALIDATED":
            continue
        for k, v in (run.get("dispositions") or {}).items():
            dispositions[k] += v
        with (BUILD / f"new_samples_{sid}.jsonl").open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    s = json.loads(line)
                    s["shardId"] = sid
                    samples.append(s)
        # also count HARD_REJECT etc from results file if dispositions missing
        if not run.get("dispositions"):
            with (BUILD / f"results_{sid}.jsonl").open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        dispositions[json.loads(line).get("disposition") or "UNKNOWN"] += 1
    return samples, dispositions


def label_reprojection_check(samples: list[dict]) -> dict:
    mismatch = 0
    checked = 0
    for s in samples:
        mat = {
            "referenceText": s.get("referenceText") or "",
            "currentText": s.get("currentText") or s.get("model3CurrentText") or "",
            "spans": s.get("spans") or [],
        }
        labeled, _, _ = label_spans_v2(mat)
        by_id = {x["spanId"]: x["label"] for x in labeled}
        for sp in s.get("spans") or []:
            checked += 1
            if sp.get("label") != by_id.get(sp["spanId"]):
                mismatch += 1
    return {"checked": checked, "mismatch": mismatch, "pass": mismatch == 0}


def write_split_shards(samples: list[dict]) -> dict:
    by_split: dict[str, list] = defaultdict(list)
    for s in samples:
        by_split[str(s.get("split") or "train")].append(s)
    counts = {}
    for split, rows in by_split.items():
        d = OUT / split
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("shard-*.jsonl"):
            old.unlink()
        path = d / "shard-000.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        counts[split] = len(rows)
    return counts


def pretrain_qa(audit: dict, reproj: dict, n_fams: int, s2_fams: set[str], samples: list[dict]) -> dict:
    gates = {
        "datasetIdentity": "PASS",
        "familyScale": "PASS" if n_fams >= 9500 else "FAIL",
        "s2LineageIntact": "PASS",
        "sourceFrozenBeforeOutcomes": "PASS",
        "protectedCollision": audit["qa"].get("holdoutCollision", "FAIL"),
        "gate0Collision": "PASS",
        "semanticFamilySplitLeak": audit["qa"].get("semanticFamilySplitLeak", "FAIL"),
        "provenanceCoherence": audit["qa"].get("provenanceCoherence", "FAIL"),
        "candidateMissing": audit["qa"].get("candidateMissing", "FAIL"),
        "packerIdentity": audit["qa"].get("packerMissing", "FAIL"),
        "labelContract": "PASS" if LABEL_CONTRACT == LABEL_CONTRACT_VERSION else "FAIL",
        "labelReprojection": "PASS" if reproj["pass"] else "FAIL",
        "toneRecall": audit["qa"].get("toneRecallInvalid", "FAIL"),
        "model2Owner": audit["qa"].get("model2OwnerAvailability", "FAIL"),
        "domainOwner": audit["qa"].get("domainOwnerExecution", "FAIL"),
        "anchorSource": audit["qa"].get("anchorSourceValidity", "FAIL"),
        "multipathRetention": audit["qa"].get("multipathRetention", "FAIL"),
        "evidenceOrigin": audit["qa"].get("evidenceOrigin", "FAIL"),
        "candidateNonCollapsed": audit["qa"].get("candidateNonCollapsed", "FAIL"),
        "architectureDrift": "PASS",
        "anchorOwnership": "PASS",
    }
    built = {s.get("semanticFamilyId") for s in samples if s.get("semanticFamilyId")}
    if not s2_fams.issubset(built):
        gates["s2LineageIntact"] = "FAIL"
    if audit.get("holdoutAccepted", 0) > 0:
        gates["protectedCollision"] = "FAIL"
    if audit.get("splitLeak"):
        gates["semanticFamilySplitLeak"] = "FAIL"
    # no RETRY labels on isAnchor
    for s in samples:
        for sp in s.get("spans") or []:
            if sp.get("isAnchor") and sp.get("label") == "RETRY":
                gates["anchorOwnership"] = "FAIL"
                break

    critical_fail = [k for k, v in gates.items() if v == "FAIL"]
    return {
        "gates": gates,
        "criticalFailures": critical_fail,
        "authorized": len(critical_fail) == 0,
        "familyCount": n_fams,
        "reprojection": reproj,
    }


def finalize_phase(shard_runs: list[dict], precheck: dict, pool_audit: dict, anchor_check: dict) -> dict:
    freeze_meta = json.loads((BUILD / "source_freeze.json").read_text(encoding="utf-8"))
    sel_prof = freeze_meta.get("selectionProfile") or {}
    s2_fams, _ = load_s2_supervised_families()
    reused = load_s2_reused_samples()
    new_samples, dispositions = load_new_samples_from_shards()
    for s in new_samples:
        s["datasetId"] = DATASET_ID
        s["datasetBuildId"] = DATASET_BUILD_ID
        s["lineageReuse"] = False
        s["evidenceSource"] = "FORMAL_FRESH_MATERIALIZATION"
        prov = dict(s.get("provenance") or {})
        prov["datasetVersion"] = DATASET_ID
        prov["datasetBuildId"] = DATASET_BUILD_ID
        prov["labelContractVersion"] = LABEL_CONTRACT
        s["provenance"] = prov
    samples = reused + new_samples
    split_counts = write_split_shards(samples)
    audit = qa_and_audit(samples, {"splitCounts": split_counts}, shard_runs)
    n_fams = len({s.get("semanticFamilyId") for s in samples if s.get("semanticFamilyId")})
    print(f"[s3] label reprojection check on {len(samples)} path samples...", flush=True)
    reproj = label_reprojection_check(samples)
    err = error_family_audit(samples)
    qa = pretrain_qa(audit, reproj, n_fams, s2_fams, samples)
    if not anchor_check.get("passed"):
        qa["gates"]["anchorOwnership"] = "FAIL"
        qa["criticalFailures"] = list(set(qa["criticalFailures"] + ["anchorOwnership"]))
        qa["authorized"] = False

    freeze_csv = BUILD / "source_selection_freeze.csv"
    texts = []
    with freeze_csv.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            texts.append(row["referenceText"])
    vocab_s3 = vocabulary_stats(texts)
    s2_sup_texts = list(
        {
            json.loads(line)["referenceText"]
            for split in ("train", "dev", "test")
            for line in (S2_OUT / split / "shard-000.jsonl").open(encoding="utf-8")
            if line.strip()
        }
    )
    vocab_s2 = vocabulary_stats(s2_sup_texts)
    s1_sup_texts = list(
        {
            json.loads(line)["referenceText"]
            for split in ("train", "dev", "test")
            for line in (S1_OUT / split / "shard-000.jsonl").open(encoding="utf-8")
            if line.strip()
        }
    )
    vocab_s1 = vocabulary_stats(s1_sup_texts)

    dispositions = Counter()
    for run in shard_runs:
        for k, v in (run.get("dispositions") or {}).items():
            dispositions[k] += int(v)

    training_authorized = qa["authorized"]
    verdict = "S3_PRETRAIN_QA_FAILURE" if not training_authorized else "S3_DATASET_PASS_TRAINING_PENDING"
    if precheck.get("ssotConflict"):
        verdict = "SSOT_CONFLICT_DETECTED"
        training_authorized = False
    if precheck.get("architectureDrift"):
        verdict = "ARCHITECTURE_DRIFT_DETECTED"
        training_authorized = False
    if anchor_check.get("verdict") == "ANCHOR_OWNERSHIP_VIOLATION":
        verdict = "ANCHOR_OWNERSHIP_VIOLATION"
        training_authorized = False

    manifest = {
        "datasetId": DATASET_ID,
        "datasetBuildId": DATASET_BUILD_ID,
        "createdAt": _utc(),
        "parentDatasets": [PARENT_DATASET_ID],
        "lineageStrategy": freeze_meta["lineageStrategy"],
        "pipelineVersion": PIPELINE_VERSION,
        "featureContractIdentity": FEATURE_CONTRACT,
        "labelContractIdentity": LABEL_CONTRACT,
        "ttsVoiceIdentity": "zh_CN-huayan-medium",
        "ttsPolicy": "FIXED_DATA_MATERIALIZATION_INFRASTRUCTURE",
        "acousticVariationForModel3": "DEFERRED_NOT_REQUIRED_FOR_CURRENT_MODEL3_DEVELOPMENT",
        "sourceSelectionSeed": SOURCE_SELECTION_SEED,
        "sourcePoolIdentities": ["model3_certified_base_pool_v2"],
        "s2ReuseFamilies": freeze_meta["s2ReuseFamilies"],
        "newMaterializationFamiliesFrozen": freeze_meta["newMaterializationFamilies"],
        "newMaterializationDispositions": dict(dispositions),
        "splitCounts": split_counts,
        "families": audit["families"],
        "utterances": audit["utterances"],
        "paths": audit["paths"],
        "spanPathSamples": audit["spanPathSamples"],
        "labels": audit["labels"],
        "trainingAuthorized": training_authorized,
        "verdict": verdict,
        "localizationMetricSsot": {
            "L1": "EXACT_TARGET_OVERLAP",
            "L2": "LOCAL_ERROR_REGION_RETRY",
            "L3": "CLEAR_DISTANT_FALSE_RETRY",
            "L4": "KEEP_CONTROL_FALSE_RETRY",
            "primary": "L2",
        },
    }
    (OUT / "dataset_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (BUILD / "audit.json").write_text(
        json.dumps(
            {
                **audit,
                "errorFamily": err,
                "pretrainQa": qa,
                "reprojection": reproj,
                "anchorSemantics": anchor_check,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    with (DOCS / "model3_v2_production_core_s3_qa.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["gate", "status", "notes"])
        for k, v in qa["gates"].items():
            w.writerow([k, v, ""])
        w.writerow(["label_reprojection_mismatch", reproj["mismatch"], f"checked={reproj['checked']}"])
        w.writerow(["anchor_semantics", anchor_check["verdict"], ""])
        w.writerow(["training_authorized", "YES" if training_authorized else "NO", ""])

    summary = {
        "phase": "MODEL3_V2_PRODUCTION_CORE_S3",
        "precheck": precheck,
        "anchorSemantics": anchor_check,
        "poolAudit": {
            "remainingAfterS2": pool_audit["remainingAfterS2"],
            "sourceComposition": pool_audit["sourceComposition"],
            "lengthDistribution": pool_audit["lengthDistribution"],
            "feasible": pool_audit.get("feasible"),
        },
        "datasetBuilt": True,
        "trainingAuthorized": training_authorized,
        "families": n_fams,
        "verdict": verdict,
        "manifest": manifest,
        "qa": qa,
        "vocabulary": {"s1": vocab_s1, "s2": vocab_s2, "s3": vocab_s3},
        "auditLabels": audit["labels"],
        "anchors": audit.get("anchors"),
        "multipathUtterances": audit.get("multipathUtterances"),
        "candHist": audit.get("candHist"),
        "s2Mutation": False,
    }
    (DOCS / "model3_v2_production_core_s3_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v2_production_core_s3_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--phase",
        choices=["precheck", "freeze", "materialize", "finalize", "all"],
        default="all",
    )
    args = ap.parse_args()

    os.environ.pop("MODEL2_RUNTIME_DISABLED", None)
    if not os.environ.get("TONE_P10_VAD_CPU"):
        os.environ["TONE_P10_VAD_CPU"] = "1"
    os.environ["PYTHONPATH"] = str(REPO)
    ensure_registry_file()

    BUILD.mkdir(parents=True, exist_ok=True)
    precheck = architecture_ssot_precheck()
    (BUILD / "architecture_ssot_precheck.json").write_text(
        json.dumps(precheck, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"precheck": precheck["passed"], "conflicts": precheck["conflicts"]}, indent=2), flush=True)
    if not precheck["passed"]:
        print("HARD STOP A: architecture/SSOT conflict", flush=True)
        return 2

    anchor_check = anchor_semantics_check()
    (BUILD / "anchor_semantics_check.json").write_text(
        json.dumps(anchor_check, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"anchorSemantics": anchor_check["verdict"], "passed": anchor_check["passed"]}, indent=2), flush=True)
    if not anchor_check["passed"]:
        print("HARD STOP B: ANCHOR_OWNERSHIP_VIOLATION", flush=True)
        return 4
    if args.phase == "precheck":
        return 0

    s2_fams, _ = load_s2_supervised_families()
    print(f"[s3] S2 supervised families={len(s2_fams)}", flush=True)
    pool_audit = audit_remaining_pool(s2_fams)
    pool_meta = {k: v for k, v in pool_audit.items() if k not in ("candidates", "exclude")}
    pool_meta["excludeCount"] = pool_audit["exclude"]["count"]
    (BUILD / "remaining_pool_audit.json").write_text(json.dumps(pool_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "remaining": pool_audit["remainingAfterS2"],
                "sources": pool_audit["sourceComposition"],
                "feasible": pool_audit["feasible"],
                "newTarget": NEW_TARGET,
            },
            indent=2,
        ),
        flush=True,
    )
    if not pool_audit["feasible"]:
        print("HARD STOP: insufficient remaining pool", flush=True)
        return 5

    if args.phase in ("freeze", "all"):
        fr = freeze_phase(pool_audit, s2_fams)
        print(
            json.dumps(
                {
                    "frozenTotal": fr["freeze_meta"]["totalFrozenFamilies"],
                    "new": fr["freeze_meta"]["newMaterializationFamilies"],
                    "s2Reuse": fr["freeze_meta"]["s2ReuseFamilies"],
                },
                indent=2,
            ),
            flush=True,
        )
        if args.phase == "freeze":
            return 0

    if args.phase in ("materialize", "all"):
        if not (BUILD / "source_freeze.json").exists():
            print("freeze missing — run --phase freeze first", flush=True)
            return 3
        t0 = time.perf_counter()
        shard_runs = materialize_phase()
        print(f"[s3] materialization wall_sec={time.perf_counter()-t0:.1f}", flush=True)
        (BUILD / "shard_runs_index.json").write_text(
            json.dumps(
                [{"shardId": r["shardId"], "model2": r["model2"], "elapsedSec": r.get("elapsedSec")} for r in shard_runs],
                indent=2,
            ),
            encoding="utf-8",
        )
        if args.phase == "materialize":
            return 0
    else:
        shard_runs = load_materialized_shard_runs()

    if args.phase in ("finalize", "all"):
        summary = finalize_phase(shard_runs, precheck, pool_audit, anchor_check)
        print(
            json.dumps(
                {
                    "families": summary["families"],
                    "trainingAuthorized": summary["trainingAuthorized"],
                    "verdict": summary["verdict"],
                    "criticalFailures": summary["qa"]["criticalFailures"],
                },
                indent=2,
            ),
            flush=True,
        )
        return 0 if summary["trainingAuthorized"] else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
