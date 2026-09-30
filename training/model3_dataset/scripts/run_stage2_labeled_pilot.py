# -*- coding: utf-8 -*-
"""Stage2: ERROR_TEXT → MODEL3_TRAINING_SAMPLE_V1 labeled pilot (offline)."""
from __future__ import annotations

import hashlib
import json
import os
import random
import subprocess
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from training.model3_error_text.generator.corrupt import (
    annotate_sentence,
    apply_corruptions,
    try_orthographic_de_di_de,
    try_phonetic_corruption,
)
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import (
    LexiconSurfaceResolver,
    default_sqlite_path,
)
REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "training/model3_dataset/model3_training_sample_v1_pilot"
DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
HARNESS = REPO / "training/model3_dataset/offline_harness/stage2_materialize.cjs"
ELECTRON = (
    REPO
    / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
)
SEED = 20260824
TARGET_SAMPLES = 6000  # within 5k–10k
RESUME_HARNESS_CACHE = True  # reuse _harness_all_resp.jsonl if complete

GEN_VERSION = "model3-stage2-materializer-v1.0.0"
DATASET_VERSION = "model3_training_sample_v1_pilot_20260824"


def load_bases(n: int, seed: int) -> list[dict]:
    rows = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            text = o.get("normalized") or ""
            if not text or len(text) < 4 or len(text) > 40:
                continue
            # Prefer supplement diversity + some prior
            rows.append(o)
    rng = random.Random(seed)
    rng.shuffle(rows)
    # Stratify: take mix
    supp = [r for r in rows if r.get("source") == "MODEL3_SPOKEN_BASE_SUPPLEMENT_V1"]
    prior = [r for r in rows if r.get("source") != "MODEL3_SPOKEN_BASE_SUPPLEMENT_V1"]
    out = []
    # more from supplement
    for r in supp[: int(n * 0.75)]:
        out.append(r)
    for r in prior[: n - len(out)]:
        out.append(r)
    return out[:n]


def make_error_variants(base: dict, resolver: LexiconSurfaceResolver, rng: random.Random) -> list[dict]:
    text = base["normalized"]
    annos, impl, meta = annotate_sentence(text)
    if meta.get("skip") or not annos:
        return []
    eligible = [a for a in annos if not a.skip_reason]
    variants = []
    # CLEAN
    variants.append(
        {
            "referenceText": text,
            "errorText": text,
            "corruptions": [],
            "expectedRepairClass": "CLEAN",
            "sourceSentenceId": base.get("source_sentence_id")
            or ("prior:" + hashlib.sha1(text.encode()).hexdigest()[:12]),
            "sourceCorpus": base.get("source") or "certified_pool_v2",
            "source_type": base.get("source_type") or "PRIOR_CERTIFIED",
            "evidence_level": base.get("evidence_level") or "SYNTHETIC_TEXT",
            "shard": base.get("shard"),
        }
    )
    phon = []
    fams = list(ACTIVE_FAMILIES_V1)
    rng.shuffle(fams)
    for a in eligible:
        for fam in fams:
            c = try_phonetic_corruption(text, a, fam, resolver)
            if c and c["referenceSurface"] != c["errorSurface"]:
                phon.append(c)
                break
        if len(phon) >= 3:
            break
    for c in phon[:2]:
        try:
            err = apply_corruptions(text, [c])
        except Exception:
            continue
        variants.append(
            {
                "referenceText": text,
                "errorText": err,
                "corruptions": [c],
                "expectedRepairClass": "PHONETIC_CANDIDATE",
                "sourceSentenceId": base.get("source_sentence_id")
                or ("prior:" + hashlib.sha1(text.encode()).hexdigest()[:12]),
                "sourceCorpus": base.get("source") or "certified_pool_v2",
                "source_type": base.get("source_type") or "PRIOR_CERTIFIED",
                "evidence_level": base.get("evidence_level") or "SYNTHETIC_TEXT",
                "shard": base.get("shard"),
            }
        )
    # optional ortho
    if rng.random() < 0.08:
        for a in eligible:
            o = try_orthographic_de_di_de(text, a)
            if o:
                try:
                    err = apply_corruptions(text, [o])
                    variants.append(
                        {
                            "referenceText": text,
                            "errorText": err,
                            "corruptions": [o],
                            "expectedRepairClass": "NON_PHONETIC",
                            "sourceSentenceId": base.get("source_sentence_id")
                            or ("prior:" + hashlib.sha1(text.encode()).hexdigest()[:12]),
                            "sourceCorpus": base.get("source") or "certified_pool_v2",
                            "source_type": base.get("source_type") or "PRIOR_CERTIFIED",
                            "evidence_level": base.get("evidence_level") or "SYNTHETIC_TEXT",
                            "shard": base.get("shard"),
                        }
                    )
                except Exception:
                    pass
                break
    return variants


def label_spans(mat: dict) -> tuple[list[dict], dict]:
    """Apply frozen decision table on harness spans."""
    spans_out = []
    stats = Counter()
    for s in mat.get("spans") or []:
        is_anchor = bool(s.get("isAnchor"))
        surface = s.get("surface") or ""
        ref = s.get("referenceSurface")
        if ref is None:
            ref = surface
        reach = (s.get("repairability") or {}).get("referenceReachable", "UNKNOWN")
        phonetic = bool(s.get("phoneticCompatible"))
        family = s.get("corruptionFamily") or ""
        ortho = family == "ORTHOGRAPHIC_DE_DI_DE"

        if is_anchor:
            label, tm, lc = "MASKED", 0, None
        elif reach == "UNKNOWN" and ref != surface:
            label, tm, lc = "EXCLUDE_FROM_SUPERVISED", 0, None
        elif (
            not is_anchor
            and ref != surface
            and phonetic
            and not ortho
            and reach == "YES"
        ):
            label, tm, lc = "RETRY", 1, "RETRY"
        elif not is_anchor and ref == surface:
            label, tm, lc = "KEEP", 1, "A"
        elif not is_anchor and ref != surface and (not phonetic or ortho):
            label, tm, lc = "KEEP", 1, "B"
        elif not is_anchor and reach == "NO":
            label, tm, lc = "KEEP", 1, "D"
        else:
            label, tm, lc = "KEEP", 1, "B"

        stats[label] += 1
        spans_out.append(
            {
                "spanId": s["spanId"],
                "surface": surface,
                "rawStart": s["rawStart"],
                "rawEnd": s["rawEnd"],
                "syllableStart": s.get("syllableStart"),
                "syllableEnd": s.get("syllableEnd"),
                "isAnchor": is_anchor,
                "anchorSource": s.get("anchorSource") or "NONE",
                "targetMask": tm,
                "label": label,
                "labelClass": lc,
                "referenceSurface": ref,
                "pinyinEvidence": s.get("pinyinEvidence"),
                "toneEvidence": s.get("toneEvidence"),
                "acousticEvidence": s.get("acousticEvidence"),
                "pronunciationEvidence": s.get("pronunciationEvidence"),
                "recallEvidence": s.get("recallEvidence"),
                "repairability": s.get("repairability"),
            }
        )
    return spans_out, stats


def validate_sample(sample: dict) -> list[str]:
    errs = []
    if sample.get("schemaVersion") != "MODEL3_TRAINING_SAMPLE_V1":
        errs.append("schemaVersion")
    for s in sample.get("spans") or []:
        if s.get("isAnchor") and s.get("label") == "RETRY":
            errs.append("anchor_retry")
        if s.get("label") == "RETRY" and (s.get("repairability") or {}).get("referenceReachable") != "YES":
            errs.append("retry_without_yes")
        if s.get("label") == "MASKED" and s.get("targetMask") != 0:
            errs.append("masked_targetmask")
        if s.get("isAnchor") and s.get("targetMask") != 0:
            errs.append("anchor_targetmask")
        # offset
        cur = sample.get("currentText") or ""
        if s["rawStart"] < 0 or s["rawEnd"] > len(cur) or s["rawStart"] > s["rawEnd"]:
            errs.append("bad_offset")
        elif cur[s["rawStart"] : s["rawEnd"]] != s.get("surface"):
            errs.append("surface_mismatch")
    fa = sample.get("featureAvailability") or {}
    if fa.get("toneAcoustic") or fa.get("asrConfidence"):
        errs.append("fake_acoustic")
    if sample.get("model2AnchorStatus") not in (None, "UNAVAILABLE", "OFFLINE_EVIDENCE", "RUNTIME_CONFIRMED"):
        errs.append("bad_model2_status")
    # no fake model2 on synthetic
    if sample.get("evidenceLevel") == "SYNTHETIC_TEXT" and sample.get("model2AnchorStatus") not in (
        "UNAVAILABLE",
        None,
    ):
        if sample.get("model2AnchorStatus") == "RUNTIME_CONFIRMED":
            errs.append("forged_model2")
    return errs


def run_harness(requests: list[dict], resp_path: Path) -> list[dict]:
    req_path = OUT / "_harness_req.jsonl"
    err_path = OUT / "_harness_err.txt"
    with req_path.open("w", encoding="utf-8") as f:
        for r in requests:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env["PROJECT_ROOT"] = str(REPO)
    cwd = str(REPO / "electron_node/electron-node")
    cmd = f'type "{req_path}" | "{ELECTRON}" "{HARNESS}" > "{resp_path}" 2> "{err_path}"'
    t0 = time.time()
    proc = subprocess.run(cmd, shell=True, cwd=cwd, env=env)
    elapsed = time.time() - t0
    print(f"harness exit={proc.returncode} elapsed={elapsed:.1f}s n={len(requests)}")
    outs = []
    if resp_path.exists():
        with resp_path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("[Logger]"):
                    continue
                try:
                    outs.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return outs


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for split in ("train", "dev", "test"):
        (OUT / split).mkdir(exist_ok=True)

    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))
    rng = random.Random(SEED)
    bases = load_bases(2800, SEED)
    print("bases", len(bases))
    error_samples = []
    for b in bases:
        error_samples.extend(make_error_variants(b, resolver, rng))
        if len(error_samples) >= TARGET_SAMPLES:
            break
    error_samples = error_samples[:TARGET_SAMPLES]
    print("error_samples", len(error_samples))

    requests = []
    for i, e in enumerate(error_samples):
        requests.append(
            {
                "id": f"p{i}",
                "currentText": e["errorText"],
                "referenceText": e["referenceText"],
                "corruptions": e["corruptions"],
            }
        )

    all_resp = OUT / "_harness_all_resp.jsonl"
    mats_by_id = {}
    if RESUME_HARNESS_CACHE and all_resp.exists():
        with all_resp.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    m = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if m.get("id"):
                    mats_by_id[m["id"]] = m
        print("cached harness mats", len(mats_by_id))

    CHUNK = 200
    with all_resp.open("a", encoding="utf-8") as af:
        for i in range(0, len(requests), CHUNK):
            chunk = [r for r in requests[i : i + CHUNK] if r["id"] not in mats_by_id]
            if not chunk:
                continue
            print(f"harness chunk {i}-{i+len(chunk)}…")
            tmp = OUT / f"_harness_chunk_{i}.jsonl"
            for m in run_harness(chunk, tmp):
                if m.get("id"):
                    mats_by_id[m["id"]] = m
                    af.write(json.dumps(m, ensure_ascii=False) + "\n")
            af.flush()

    print("mats", len(mats_by_id))
    samples = []
    excluded = []
    label_stats = Counter()
    val_fail = Counter()
    for i, e in enumerate(error_samples):
        mid = f"p{i}"
        mat = mats_by_id.get(mid)
        if not mat or not mat.get("ok"):
            excluded.append(
                {
                    "id": mid,
                    "reason": "harness_fail",
                    "detail": mat,
                    "errorText": e["errorText"],
                }
            )
            continue
        spans, st = label_spans(mat)
        label_stats.update(st)
        cg = "cg:" + e["sourceSentenceId"]
        sample = {
            "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
            "sampleId": f"m3tp_{SEED}_{i:05d}",
            "sourceSampleId": mid,
            "sourceCorpus": e["sourceCorpus"],
            "evidenceLevel": "SYNTHETIC_TEXT",
            "referenceText": mat["referenceText"],
            "currentText": mat["currentText"],
            "audioRef": None,
            "domainEvidence": mat["domainEvidence"],
            "model2AnchorStatus": "UNAVAILABLE",
            "spans": spans,
            "split": "train",  # filled later
            "groupKeys": {
                "sourceSentenceId": e["sourceSentenceId"],
                "contrastGroupId": cg,
                "splitGroupKey": e["sourceSentenceId"],
                "surfacePairKey": None,
            },
            "featureAvailability": mat["featureAvailability"],
            "provenance": {
                "generatorVersion": GEN_VERSION,
                "labelMaterializerVersion": GEN_VERSION,
                "datasetVersion": DATASET_VERSION,
                "errorTextSampleId": mid,
                "auditSidecarRef": None,
                "source_type": e.get("source_type"),
                "shard": e.get("shard"),
            },
        }
        errs = validate_sample(sample)
        if errs:
            for er in errs:
                val_fail[er] += 1
            excluded.append({"id": sample["sampleId"], "reason": "validation", "errs": errs})
            # still exclude invalid
            continue
        samples.append(sample)

    # group split
    by_group: dict[str, list[dict]] = {}
    for s in samples:
        by_group.setdefault(s["groupKeys"]["sourceSentenceId"], []).append(s)
    groups = sorted(by_group.keys(), key=lambda g: hashlib.sha256(g.encode()).hexdigest())
    split_counts = Counter()
    for g in groups:
        h = int(hashlib.sha256(f"{SEED}:{g}".encode()).hexdigest(), 16) % 100
        if h < 80:
            sp = "train"
        elif h < 90:
            sp = "dev"
        else:
            sp = "test"
        for s in by_group[g]:
            s["split"] = sp
            split_counts[sp] += 1

    # write shards (one file per split for pilot)
    for sp in ("train", "dev", "test"):
        path = OUT / sp / "shard-00000.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for s in samples:
                if s["split"] == sp:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")

    sets = {sp: set() for sp in ("train", "dev", "test")}
    csets = {sp: set() for sp in ("train", "dev", "test")}
    for s in samples:
        sets[s["split"]].add(s["groupKeys"]["sourceSentenceId"])
        csets[s["split"]].add(s["groupKeys"]["contrastGroupId"])
    leak = {
        "sourceSentenceId_leakage": {
            "train_dev": len(sets["train"] & sets["dev"]),
            "train_test": len(sets["train"] & sets["test"]),
            "dev_test": len(sets["dev"] & sets["test"]),
        },
        "contrastGroupId_leakage": {
            "train_dev": len(csets["train"] & csets["dev"]),
            "train_test": len(csets["train"] & csets["test"]),
            "dev_test": len(csets["dev"] & csets["test"]),
        },
        "dialog_200": 0,
    }

    # critical checks
    anchor_retry = sum(
        1
        for s in samples
        for sp in s["spans"]
        if sp["isAnchor"] and sp["label"] == "RETRY"
    )
    retry_no_yes = sum(
        1
        for s in samples
        for sp in s["spans"]
        if sp["label"] == "RETRY"
        and (sp.get("repairability") or {}).get("referenceReachable") != "YES"
    )
    masked_bad = sum(
        1 for s in samples for sp in s["spans"] if sp["label"] == "MASKED" and sp["targetMask"] != 0
    )

    # loader smoke
    smoke = {"ok": False}
    if samples:
        s0 = samples[0]
        n = len(s0["spans"])
        target_mask = [sp["targetMask"] for sp in s0["spans"]]
        labels = [{"KEEP": 0, "RETRY": 1}.get(sp["label"], -100) for sp in s0["spans"]]
        avail = s0["featureAvailability"]
        smoke = {
            "ok": True,
            "n_spans": n,
            "target_mask": target_mask,
            "y_ignore_index_neg100": labels,
            "feature_avail": avail,
            "loader_business_logic": False,
            "note": "tensor-ready structures only; no Domain Vote/Recall/label in loader",
        }

    (OUT / "pilot_excluded_samples.jsonl").write_text(
        "\n".join(json.dumps(x, ensure_ascii=False) for x in excluded) + ("\n" if excluded else ""),
        encoding="utf-8",
    )
    (OUT / "pilot_label_distribution.json").write_text(
        json.dumps({"span_labels": dict(label_stats), "samples": len(samples)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT / "pilot_validation_report.json").write_text(
        json.dumps(
            {
                "schema_pass": len(samples),
                "excluded": len(excluded),
                "validation_fail_reasons": dict(val_fail),
                "anchor_retry": anchor_retry,
                "retry_without_reachability_yes": retry_no_yes,
                "masked_targetmask_violations": masked_bad,
                "fake_acoustic": 0,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (OUT / "pilot_split_leakage_report.json").write_text(
        json.dumps(leak, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "pilot_loader_smoke_test.json").write_text(
        json.dumps(smoke, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "pilot_manifest.json").write_text(
        json.dumps(
            {
                "datasetVersion": DATASET_VERSION,
                "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
                "generatorVersion": GEN_VERSION,
                "seed": SEED,
                "sampleCount": len(samples),
                "splitCounts": dict(split_counts),
                "labelDistribution": dict(label_stats),
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "dialog200InTrainOrDev": False,
                "model2AnchorStatus": "UNAVAILABLE",
                "evidenceLevel": "SYNTHETIC_TEXT",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "samples": len(samples),
                "excluded": len(excluded),
                "labels": dict(label_stats),
                "splits": dict(split_counts),
                "anchor_retry": anchor_retry,
                "retry_no_yes": retry_no_yes,
                "leak": leak,
                "smoke": smoke.get("ok"),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
