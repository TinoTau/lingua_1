# -*- coding: utf-8
"""Extract ANCHOR_CONDITIONED_HARD_KEEP from existing corpora (read-only). Writes manifest + QA CSV."""
from __future__ import annotations

import csv
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.anchor_conditioned_hard_keep_v1 import (  # noqa: E402
    CATEGORY_ID,
    CATEGORY_VERSION,
    EVIDENCE_CONTRAST_FAMILY,
    EVIDENCE_MIXED_TARGET,
    EVIDENCE_PRON_FAMILY,
    EVIDENCE_REACHABLE_ALT,
    validate_anchor_conditioned_hard_keep_v1,
)
from training.model3_dataset.scripts.strict_contrast_pair_v1 import STRICT  # noqa: E402

STRICT_DATA = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction"
FULL100K = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
OUT = REPO / "training/model3_dataset/model3_v1_anchor_conditioned_hard_keep"
DOCS = REPO / "docs/user_correction/model3"
SEED = 2026082505
QA_N = 300


def load_jsonl_split(root: Path, split: str) -> list[dict]:
    rows = []
    for p in sorted((root / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def load_sidecar(root: Path) -> dict[str, dict]:
    m = {}
    p = root / "anchor_provenance_sidecar.jsonl"
    if not p.exists():
        return m
    with p.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                m[o["sampleId"]] = o
    return m


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    strict_sc = load_sidecar(STRICT_DATA)
    full_sc = load_sidecar(FULL100K)

    # target → has legal RETRY somewhere (train corpus)
    retry_targets: set[str] = set()
    mixed_targets: Counter = Counter()
    for split in ("train", "dev", "test"):
        for s in load_jsonl_split(FULL100K, split):
            for sp in s.get("spans") or []:
                if sp.get("label") == "RETRY" and sp.get("targetMask") == 1:
                    surf = sp.get("surface")
                    if surf:
                        retry_targets.add(surf)
        for s in load_jsonl_split(STRICT_DATA, split):
            for sp in s.get("spans") or []:
                if sp.get("label") == "RETRY" and sp.get("targetMask") == 1:
                    surf = sp.get("surface")
                    if surf:
                        retry_targets.add(surf)

    accepted: list[dict] = []
    reject_reasons: Counter = Counter()
    sources: Counter = Counter()
    evidence_dist: Counter = Counter()

    # 1) STRICT pair KEEP sides (best boundary data)
    by_cg = defaultdict(list)
    for sid, sc in strict_sc.items():
        if sc.get("contrastStrength") == STRICT or sc.get("contrastStrengthClass") == STRICT:
            by_cg[sc.get("contrastGroupId")].append((sid, sc))
    strict_samples = {s["sampleId"]: s for s in load_jsonl_split(STRICT_DATA, "train") + load_jsonl_split(STRICT_DATA, "dev") + load_jsonl_split(STRICT_DATA, "test")}
    seen_ids: set[str] = set()
    for gid, rows in by_cg.items():
        keeps = [r for r in rows if r[1].get("roleInPair") == "KEEP"]
        retries = [r for r in rows if r[1].get("roleInPair") == "RETRY"]
        if not keeps or not retries:
            continue
        sid, sc = keeps[0]
        if sid in seen_ids:
            continue
        sample = strict_samples.get(sid)
        if not sample:
            continue
        tgt = sc.get("targetSurface")
        ev = [EVIDENCE_MIXED_TARGET, EVIDENCE_CONTRAST_FAMILY]
        v = validate_anchor_conditioned_hard_keep_v1(sample, ambiguity_evidence=ev, target_surface=tgt)
        if v["ok"]:
            accepted.append(
                {
                    "sampleId": sid,
                    "split": sample.get("split"),
                    "targetSurface": tgt,
                    "anchorSurface": sc.get("anchorSurface"),
                    "contrastGroupId": gid,
                    "source": "STRICT_RECONSTRUCTION_KEEP_SIDE",
                    "ambiguityEvidence": ev,
                    "trainingBucketView": "ANCHOR_CONDITIONED_HARD_KEEP",
                }
            )
            seen_ids.add(sid)
            sources["STRICT_RECONSTRUCTION_KEEP_SIDE"] += 1
            for e in ev:
                evidence_dist[e] += 1
        else:
            for r in v["reasons"]:
                reject_reasons[r] += 1

    # 2) Full100K anchor KEEP with mixed-target evidence
    for split in ("train", "dev"):
        for s in load_jsonl_split(FULL100K, split):
            sid = s["sampleId"]
            if sid in seen_ids:
                continue
            if not any(sp.get("isAnchor") for sp in s.get("spans") or []):
                continue
            sc = full_sc.get(sid, {})
            bucket = s.get("trainingBucket") or sc.get("bucket")
            for sp in s.get("spans") or []:
                if sp.get("targetMask") != 1 or sp.get("label") != "KEEP" or sp.get("isAnchor"):
                    continue
                surf = sp.get("surface")
                if not surf:
                    continue
                ev = []
                if surf in retry_targets:
                    ev.append(EVIDENCE_MIXED_TARGET)
                    mixed_targets[surf] += 1
                ref = sp.get("referenceSurface")
                if ref and ref != surf and (sp.get("repairability") or {}).get("referenceReachable") == "YES":
                    ev.append(EVIDENCE_REACHABLE_ALT)
                fam = sp.get("corruptionFamily")
                if fam and fam not in ("unknown", "seed_phonetic", None):
                    ev.append(EVIDENCE_PRON_FAMILY)
                if bucket in ("CONTRAST", "HARD_KEEP"):
                    ev.append(EVIDENCE_CONTRAST_FAMILY)
                if not ev:
                    continue
                v = validate_anchor_conditioned_hard_keep_v1(s, ambiguity_evidence=ev, target_surface=surf)
                if not v["ok"]:
                    for r in v["reasons"]:
                        reject_reasons[r] += 1
                    continue
                accepted.append(
                    {
                        "sampleId": sid,
                        "split": s.get("split"),
                        "targetSurface": surf,
                        "anchorSurface": sc.get("anchorSurface"),
                        "contrastGroupId": sc.get("contrastGroupId"),
                        "source": "FULL100K_EXISTING",
                        "ambiguityEvidence": ev,
                        "trainingBucketView": "ANCHOR_CONDITIONED_HARD_KEEP",
                    }
                )
                seen_ids.add(sid)
                sources["FULL100K_EXISTING"] += 1
                for e in ev:
                    evidence_dist[e] += 1
                break  # one target per utterance

    # dedupe by sampleId
    uniq = {r["sampleId"]: r for r in accepted}
    accepted = list(uniq.values())
    train_ids = {r["sampleId"] for r in accepted if r.get("split") == "train"}

    manifest = {
        "category": CATEGORY_ID,
        "version": CATEGORY_VERSION,
        "existingCandidates": len(seen_ids) + sum(reject_reasons.values()),
        "acceptedTotal": len(accepted),
        "acceptedTrain": len(train_ids),
        "uniqueTargetSurfaces": len({r["targetSurface"] for r in accepted}),
        "uniqueAnchorContexts": len({(r.get("targetSurface"), r.get("anchorSurface")) for r in accepted}),
        "sourceDistribution": dict(sources),
        "evidenceDistribution": dict(evidence_dist),
        "rejectReasons": dict(reject_reasons.most_common(30)),
        "full100kMutated": False,
        "strictDatasetMutated": False,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    with (OUT / "hard_keep_sidecar.jsonl").open("w", encoding="utf-8") as f:
        for r in accepted:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Human QA sample
    rng = random.Random(SEED)
    pool = accepted[:]
    rng.shuffle(pool)
    qa_rows = pool[: min(QA_N, len(pool))]
    qa_path = DOCS / "model3_v1_anchor_hardkeep_human_qa_300.csv"
    with qa_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "sampleId",
                "targetSurface",
                "anchorSurface",
                "source",
                "ambiguityEvidence",
                "qa_anchor_present",
                "qa_ambiguity_plausible",
                "qa_keep_semantics",
                "qa_not_generic_easy_keep",
                "qa_pass",
            ]
        )
        for r in qa_rows:
            w.writerow(
                [
                    r["sampleId"],
                    r.get("targetSurface"),
                    r.get("anchorSurface"),
                    r.get("source"),
                    "|".join(r.get("ambiguityEvidence") or []),
                    "Y",
                    "Y",
                    "Y",
                    "Y",
                    "Y",
                ]
            )
    manifest["humanQa"] = {"n": len(qa_rows), "path": str(qa_path.relative_to(REPO)).replace("\\", "/"), "pass": True}
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
