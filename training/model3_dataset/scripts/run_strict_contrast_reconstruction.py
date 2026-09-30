# -*- coding: utf-8 -*-
"""Generate STRICT_ANCHOR_CONTRAST_PAIR_V1 reconstruction pilot (~8k groups).

Reuses Pilot dual-anchor templates + REACHABLE_PAIR_EXTRA semantics.
Materialize-once: harness RETRY side only; KEEP clones span geometry.
Does NOT mutate Full100K JSONL (safety mix is read-only copy).
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_common import (  # noqa: E402
    build_sample,
    label_spans,
    run_harness,
    validate_sample,
)
from training.model3_dataset.scripts.strict_contrast_pair_v1 import (  # noqa: E402
    CONTRACT_ID,
    CONTRACT_VERSION,
    SEMANTIC,
    STRICT,
    apply_retry_anchor,
    materialize_keep_clone_from_retry,
    validate_strict_anchor_contrast_pair_v1,
)
from training.model3_dataset.train.bigru_v1 import build_char_vocab  # noqa: E402

OUT = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction"
DOCS = REPO / "docs/user_correction/model3"
PILOT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot"
FULL = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
SEED = 2026082504
TARGET_GROUPS = 8000
MAX_CANDIDATE_GROUPS = 24000
SURFACE_CAP = 200
SHARD_SIZE = 5000
HARNESS_CHUNK = 200
HARNESS_WORKERS = 3
GEN_VERSION = "model3-v1-strict-contrast-reconstruction-1.0.0"
DATASET_VERSION = "model3_v1_strict_contrast_reconstruction_20260825"
HOLD_FAMILIES = {"h_f", "eng_en"}

# Mix of final utterances (experimental reconstruction diet)
MIX = {"STRICT": 0.56, "NATURAL": 0.20, "HARD_KEEP": 0.12, "NO_ANCHOR": 0.12}

ANCHOR_BANK = [
    "酒店", "机场", "养鸡", "农场", "医院", "银行", "学校", "餐厅", "超市", "车站",
    "快递", "外卖", "停车", "充电", "挂号", "开票", "退款", "预约", "装修", "搬家",
    "旅游", "机票", "门诊", "药房", "食堂", "宿舍", "仓库", "工地", "工厂", "加油",
]

DUAL_TEMPLATES = [
    "候选主题A={a_keep}；候选主题B={a_retry}。目标项：{target}",
    "上下文同时出现{a_keep}与{a_retry}。核验对象：{target}",
    "业务线索：{a_keep} / {a_retry}。关注：{target}",
    "【{a_keep}】与【{a_retry}】并存时，条目为{target}",
    "从{a_keep}和{a_retry}两侧看，对象是{target}",
    "关联词{a_keep}、{a_retry}；处理项{target}",
]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def assign_split(key: str) -> str:
    h = int(hashlib.sha256(f"{SEED}:{key}".encode()).hexdigest(), 16) % 100
    if h < 80:
        return "train"
    if h < 90:
        return "dev"
    return "test"


def load_reachable_pairs() -> list[dict]:
    pairs = {}
    for path in (
        PILOT / "_seed_pairs_reachable.json",
        PILOT / "_seed_pairs_multichar.json",
        PILOT / "_seed_pairs.json",
    ):
        if not path.exists():
            continue
        for r in json.loads(path.read_text(encoding="utf-8")):
            err = r.get("error_surface") or r.get("keep_surface")
            ref = r.get("retry_reference")
            if not err or not ref or err == ref:
                continue
            key = (err, ref)
            if key not in pairs:
                pairs[key] = {
                    "error_surface": err,
                    "retry_reference": ref,
                    "keep_surface": err,
                    "family": r.get("family") or "unknown",
                }
    # harvest from Full100K (read-only) — already Recall-validated RETRY
    for split in ("train", "dev", "test"):
        for p in (FULL / split).glob("shard-*.jsonl"):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    o = json.loads(line)
                    for sp in o.get("spans") or []:
                        if sp.get("label") != "RETRY":
                            continue
                        if (sp.get("repairability") or {}).get("referenceReachable") != "YES":
                            continue
                        err = sp.get("surface")
                        ref = sp.get("referenceSurface")
                        if not err or not ref or err == ref:
                            continue
                        key = (err, ref)
                        if key not in pairs:
                            pairs[key] = {
                                "error_surface": err,
                                "retry_reference": ref,
                                "keep_surface": err,
                                "family": sp.get("corruptionFamily") or "unknown",
                            }
    return list(pairs.values())


def pick_anchors(rng: random.Random, keep_surface: str, retry_ref: str) -> tuple[str, str]:
    bank = [a for a in ANCHOR_BANK if a not in (keep_surface, retry_ref)]
    rng.shuffle(bank)
    a_keep, a_retry = bank[0], bank[1]
    if a_retry == a_keep and len(bank) > 2:
        a_retry = bank[2]
    return a_keep, a_retry


def make_strict_plans(targets: list[dict], rng: random.Random, n_groups: int) -> list[dict]:
    """One plan per group (RETRY harness request). KEEP is cloned later."""
    fam_keys = sorted({f"{t['error_surface']}|{t['retry_reference']}" for t in targets})
    non_pron = [
        k
        for k in fam_keys
        if next((t["family"] for t in targets if f"{t['error_surface']}|{t['retry_reference']}" == k), "")
        not in HOLD_FAMILIES
    ]
    rng2 = random.Random(SEED + 9)
    rng2.shuffle(non_pron)
    n_hold = max(8, min(20, int(len(non_pron) * 0.1)))
    hold_surf = set(non_pron[:n_hold])

    plans = []
    per_surface: Counter = Counter()
    idx = 0
    bag = targets[:]
    rng.shuffle(bag)
    attempts = 0
    max_attempts = n_groups * 40
    while len(plans) < n_groups and attempts < max_attempts:
        attempts += 1
        t = bag[attempts % len(bag)]
        err = t["error_surface"]
        if per_surface[err] >= SURFACE_CAP:
            continue
        a_keep, a_retry = pick_anchors(rng, err, t["retry_reference"])
        tpl = rng.choice(DUAL_TEMPLATES)
        shared_err = tpl.format(a_keep=a_keep, a_retry=a_retry, target=err)
        shared_ref = tpl.format(a_keep=a_keep, a_retry=a_retry, target=t["retry_reference"])
        if shared_err.find(err) < 0 or a_keep not in shared_err or a_retry not in shared_err:
            continue
        if a_keep == a_retry:
            continue
        fam_key = f"{err}|{t['retry_reference']}"
        fam = t["family"]
        if fam in HOLD_FAMILIES:
            split = "test"
            held = ["held_out_pronunciation_family"]
        elif fam_key in hold_surf:
            split = "test"
            held = ["held_out_surface_pair"]
        else:
            split = assign_split(f"strict:{fam_key}:r{per_surface[err]}")
            held = []
        pos = shared_err.find(err)
        corr = {
            "spanStart": pos,
            "spanEnd": pos + len(err),
            "referenceSurface": t["retry_reference"],
            "errorSurface": err,
            "corruptionFamily": fam,
            "isPhonetic": True,
            "generationReason": "strict_reconstruction_same_text",
        }
        cg = f"strict:{fam_key}:r{per_surface[err]}:{idx}"
        plans.append(
            {
                "harnessId": f"strict_{SEED}_{idx:06d}",
                "contrastGroupId": cg,
                "contrastStrength": STRICT,
                "anchorKeep": a_keep,
                "anchorRetry": a_retry,
                "targetSurface": err,
                "retryReference": t["retry_reference"],
                "referenceText": shared_ref,
                "errorText": shared_err,
                "corruptions": [corr],
                "split": split,
                "heldOutAxes": held,
                "corruptionFamily": fam,
                "contrastFamilyKey": fam_key,
            }
        )
        per_surface[err] += 1
        idx += 1
    return plans


def harness_worker(args):
    wid, chunk, work_dir = args
    resp = work_dir / f"_harness_resp_{wid}.jsonl"
    return wid, run_harness(chunk, resp, work_dir, wid)


def run_harness_parallel(requests, work_dir, workers=HARNESS_WORKERS):
    mats = {}
    cache = work_dir / "_harness_all_resp.jsonl"
    if cache.exists():
        with cache.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    m = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if m.get("id"):
                    mats[m["id"]] = m
        print(f"cached harness {len(mats)}", flush=True)
    pending = [r for r in requests if r["id"] not in mats]
    chunks = []
    for i in range(0, len(pending), HARNESS_CHUNK):
        chunks.append((len(chunks), pending[i : i + HARNESS_CHUNK], work_dir))
    if chunks:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(harness_worker, c) for c in chunks]
            for fut in as_completed(futs):
                wid, outs = fut.result()
                for m in outs:
                    if m.get("id"):
                        mats[m["id"]] = m
                print(f"chunk done worker={wid} total_mats={len(mats)}", flush=True)
        with cache.open("w", encoding="utf-8") as f:
            for m in mats.values():
                f.write(json.dumps(m, ensure_ascii=False) + "\n")
    return mats


def load_full_bucket(bucket: str, n: int, rng: random.Random) -> list[dict]:
    rows = []
    for split in ("train", "dev", "test"):
        for p in (FULL / split).glob("shard-*.jsonl"):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    o = json.loads(line)
                    if (o.get("trainingBucket") or "NATURAL") == bucket:
                        rows.append(o)
    rng.shuffle(rows)
    out = []
    for o in rows[:n]:
        s = deepcopy(o)
        # re-id into reconstruction corpus; keep split
        s["sampleId"] = f"m3strict_mix_{SEED}_{s['sampleId']}"
        s["sourceCorpus"] = "strict_reconstruction_mix_from_full100k_readonly"
        s["trainingBucket"] = bucket
        s["groupKeys"] = dict(s.get("groupKeys") or {})
        s["groupKeys"]["contrastStrengthClass"] = SEMANTIC if bucket == "NATURAL" else bucket
        out.append(s)
    return out


def write_shards(samples: list[dict], out: Path):
    by_split = defaultdict(list)
    for s in samples:
        by_split[s["split"]].append(s)
    checksum = []
    for sp in ("train", "dev", "test"):
        d = out / sp
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("shard-*.jsonl"):
            old.unlink()
        rows = by_split[sp]
        for i in range(0, len(rows), SHARD_SIZE):
            path = d / f"shard-{i // SHARD_SIZE:05d}.jsonl"
            chunk = rows[i : i + SHARD_SIZE]
            with path.open("w", encoding="utf-8") as f:
                for s in chunk:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")
            checksum.append(
                {
                    "path": str(path.relative_to(REPO)).replace("\\", "/"),
                    "sha256": sha256_file(path),
                    "lines": len(chunk),
                    "split": sp,
                }
            )
    with (out / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256,lines,split\n")
        for r in checksum:
            f.write(f"{r['path']},{r['sha256']},{r['lines']},{r['split']}\n")
    return checksum


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for sp in ("train", "dev", "test"):
        (OUT / sp).mkdir(exist_ok=True)

    rng = random.Random(SEED)
    targets = load_reachable_pairs()
    # Prefer pilot-reachable families (historically YES under dual templates)
    pilot_pref = []
    pref_path = PILOT / "_seed_pairs_reachable.json"
    if pref_path.exists():
        for r in json.loads(pref_path.read_text(encoding="utf-8")):
            err = r.get("error_surface") or r.get("keep_surface")
            ref = r.get("retry_reference")
            if err and ref and err != ref:
                pilot_pref.append(
                    {
                        "error_surface": err,
                        "retry_reference": ref,
                        "keep_surface": err,
                        "family": r.get("family") or "unknown",
                    }
                )
    # overweight preferred
    targets = pilot_pref * 8 + targets
    print(f"reachable_targets_pool={len(targets)} unique_pref={len(pilot_pref)}", flush=True)

    reject_reasons = Counter()
    accepted = []
    sidecar_rows = []
    stage2_rejected = 0
    pair_not_materializable = 0
    vocab_chars = {"<pad>": 0, "<unk>": 1}
    all_plans = []
    wave = 0
    plan_idx_base = 0

    while len(accepted) < TARGET_GROUPS and wave < 4:
        wave += 1
        need = max(TARGET_GROUPS - len(accepted), 1000) * 3
        need = min(need, 8000)
        plans = make_strict_plans(targets, random.Random(SEED + wave * 17), need)
        # reindex harness ids to be globally unique across waves
        for i, p in enumerate(plans):
            p["harnessId"] = f"strict_{SEED}_{plan_idx_base + i:06d}"
            p["contrastGroupId"] = f"{p['contrastGroupId']}:w{wave}"
        plan_idx_base += len(plans)
        all_plans.extend(plans)
        print(f"wave={wave} plans={len(plans)} accepted_so_far={len(accepted)}", flush=True)

        requests = [
            {
                "id": p["harnessId"],
                "currentText": p["errorText"],
                "referenceText": p["referenceText"],
                "corruptions": p["corruptions"],
            }
            for p in plans
        ]
        mats = run_harness_parallel(requests, OUT)

        def ensure_vocab(text: str):
            for ch in text or "":
                if ch not in vocab_chars:
                    vocab_chars[ch] = len(vocab_chars)

        for p in plans:
            if len(accepted) >= TARGET_GROUPS:
                break
            mat0 = mats.get(p["harnessId"])
            if not mat0 or not mat0.get("ok"):
                reject_reasons["harness_fail"] += 1
                stage2_rejected += 1
                continue
            ensure_vocab(mat0.get("currentText") or "")
            for sp in mat0.get("spans") or []:
                ensure_vocab(sp.get("surface") or "")

            mat_r = apply_retry_anchor(mat0, p["anchorRetry"])
            if not mat_r.get("_simulatedAnchorSpanIds"):
                reject_reasons["retry_anchor_span_not_found"] += 1
                continue
            spans_r, _ = label_spans(mat_r)
            if not any(
                sp.get("surface") == p["targetSurface"]
                and sp.get("label") == "RETRY"
                and sp.get("targetMask") == 1
                for sp in spans_r
            ):
                reject_reasons["PAIR_NOT_MATERIALIZABLE_retry_label"] += 1
                pair_not_materializable += 1
                continue

            mat_k = materialize_keep_clone_from_retry(
                mat0,
                target_surface=p["targetSurface"],
                anchor_keep=p["anchorKeep"],
                harness_id=p["harnessId"] + "_keep",
            )
            if not mat_k.get("_simulatedAnchorSpanIds"):
                reject_reasons["keep_anchor_span_not_found"] += 1
                continue
            spans_k, _ = label_spans(mat_k)
            if not any(
                sp.get("surface") == p["targetSurface"]
                and sp.get("label") == "KEEP"
                and sp.get("targetMask") == 1
                for sp in spans_k
            ):
                reject_reasons["PAIR_NOT_MATERIALIZABLE_keep_label"] += 1
                pair_not_materializable += 1
                continue

            sid_k = f"m3strict_{SEED}_{p['harnessId']}_KEEP"
            sid_r = f"m3strict_{SEED}_{p['harnessId']}_RETRY"
            meta_base = {
                "sourceCorpus": "strict_contrast_reconstruction_v1",
                "sourceSentenceId": p["contrastFamilyKey"],
                "contrastGroupId": p["contrastGroupId"],
                "splitGroupKey": p["contrastGroupId"],
                "surfacePairKey": f"surf:{p['targetSurface']}",
                "source_type": "STRICT_ANCHOR_CONTRAST_RECONSTRUCTION",
                "heldOutAxes": p.get("heldOutAxes") or [],
            }
            sample_k = build_sample(
                mat_k,
                spans_k,
                {**meta_base, "sourceSampleId": p["harnessId"] + "_KEEP"},
                sid_k,
                p["split"],
                GEN_VERSION,
                DATASET_VERSION,
                "anchor_provenance_sidecar.jsonl",
            )
            sample_r = build_sample(
                mat_r,
                spans_r,
                {**meta_base, "sourceSampleId": p["harnessId"] + "_RETRY"},
                sid_r,
                p["split"],
                GEN_VERSION,
                DATASET_VERSION,
                "anchor_provenance_sidecar.jsonl",
            )
            sample_k["trainingBucket"] = "STRICT"
            sample_r["trainingBucket"] = "STRICT"
            sample_k["heldOutAxes"] = list(p.get("heldOutAxes") or [])
            sample_r["heldOutAxes"] = list(p.get("heldOutAxes") or [])

            bad = False
            for s in (sample_k, sample_r):
                errs = validate_sample(s)
                if errs:
                    reject_reasons["sample_validation:" + ",".join(errs[:3])] += 1
                    bad = True
                    break
            if bad:
                continue

            v = validate_strict_anchor_contrast_pair_v1(
                sample_k,
                sample_r,
                target_surface=p["targetSurface"],
                vocab=vocab_chars,
                require_tensor=True,
            )
            if not v["ok"]:
                for r in v["reasons"]:
                    reject_reasons[r] += 1
                continue

            accepted.append((p, sample_k, sample_r, v))
            for role, sample, mat, anchor in (
                ("KEEP", sample_k, mat_k, p["anchorKeep"]),
                ("RETRY", sample_r, mat_r, p["anchorRetry"]),
            ):
                sidecar_rows.append(
                    {
                        "sampleId": sample["sampleId"],
                        "harnessId": p["harnessId"],
                        "bucket": "STRICT",
                        "contrastStrength": STRICT,
                        "contrastStrengthClass": STRICT,
                        "contrastGroupId": p["contrastGroupId"],
                        "roleInPair": role,
                        "anchorSurface": anchor,
                        "targetSurface": p["targetSurface"],
                        "simulatedAnchorSpanIds": mat.get("_simulatedAnchorSpanIds") or [],
                        "trainingAnchorEvidence": "SIMULATED_TRAINING_ANCHOR",
                        "anchorDietBucket": "SIMULATED_TRAINING",
                        "corruptionFamily": p["corruptionFamily"],
                        "contract": CONTRACT_ID,
                        "contractVersion": CONTRACT_VERSION,
                        "materializeOnce": True,
                        "sameTextContrast": True,
                    }
                )

        print(f"wave={wave} done accepted={len(accepted)} reject_top={reject_reasons.most_common(8)}", flush=True)

    plans = all_plans
    print(
        f"strict_accepted={len(accepted)}/{len(plans)} "
        f"pair_not_materializable={pair_not_materializable} stage2_rej={stage2_rejected}",
        flush=True,
    )
    print(f"reject_top={reject_reasons.most_common(20)}", flush=True)

    if len(accepted) < 500:
        raise SystemExit("DATA_CONSTRUCTION_FAIL — insufficient STRICT pairs")

    # rebuild vocab from accepted for final QA rate
    final_samples = []
    for p, sk, sr, v in accepted:
        final_samples.extend([sk, sr])
    vocab = build_char_vocab(final_samples)
    # filter to tensor-ok only
    kept = []
    sidecar_keep_ids = set()
    for p, sk, sr, v in accepted:
        vv = validate_strict_anchor_contrast_pair_v1(
            sk, sr, target_surface=p["targetSurface"], vocab=vocab, require_tensor=True
        )
        if not vv["ok"] or not vv.get("anchor_removed_tensor_identical"):
            reject_reasons["late_tensor_fail"] += 1
            continue
        kept.append((p, sk, sr, vv))
        sidecar_keep_ids.add(sk["sampleId"])
        sidecar_keep_ids.add(sr["sampleId"])

    model_visible_strong_rate = len(kept) / max(len(accepted), 1)
    print(f"MODEL_VISIBLE_STRONG_RATE={model_visible_strong_rate:.4f} kept={len(kept)}", flush=True)
    if model_visible_strong_rate < 0.95:
        raise SystemExit("DATA_CONSTRUCTION_FAIL — MODEL_VISIBLE_STRONG_RATE < 0.95")

    strict_samples = []
    for p, sk, sr, vv in kept:
        strict_samples.append(sk)
        strict_samples.append(sr)

    n_strict = len(strict_samples)
    # target total from mix
    total_target = int(n_strict / MIX["STRICT"])
    n_nat = int(total_target * MIX["NATURAL"])
    n_hard = int(total_target * MIX["HARD_KEEP"])
    n_na = int(total_target * MIX["NO_ANCHOR"])
    print(f"mix STRICT={n_strict} NATURAL={n_nat} HARD_KEEP={n_hard} NO_ANCHOR={n_na}", flush=True)

    mix_samples = []
    mix_samples.extend(load_full_bucket("NATURAL", n_nat, random.Random(SEED + 1)))
    mix_samples.extend(load_full_bucket("HARD_KEEP", n_hard, random.Random(SEED + 2)))
    mix_samples.extend(load_full_bucket("NO_ANCHOR", n_na, random.Random(SEED + 3)))

    all_samples = strict_samples + mix_samples
    checksum = write_shards(all_samples, OUT)

    sidecar_path = OUT / "anchor_provenance_sidecar.jsonl"
    with sidecar_path.open("w", encoding="utf-8") as f:
        for r in sidecar_rows:
            if r["sampleId"] in sidecar_keep_ids:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        for s in mix_samples:
            f.write(
                json.dumps(
                    {
                        "sampleId": s["sampleId"],
                        "bucket": s.get("trainingBucket"),
                        "contrastStrength": "NONE",
                        "contrastStrengthClass": s.get("trainingBucket"),
                        "contrastGroupId": (s.get("groupKeys") or {}).get("contrastGroupId"),
                        "roleInPair": None,
                        "contract": CONTRACT_ID,
                        "materializeOnce": False,
                        "sameTextContrast": False,
                        "source": "full100k_readonly_mix",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    inv = {
        "same_currentText": 1.0,
        "same_target": 1.0,
        "same_offsets": 1.0,
        "anchor_removed_tensor_identical": sum(
            1 for _, _, _, vv in kept if vv.get("anchor_removed_tensor_identical")
        )
        / max(len(kept), 1),
    }
    surf_counts = Counter(p["targetSurface"] for p, _, _, _ in kept)
    manifest = {
        "datasetVersion": DATASET_VERSION,
        "contract": CONTRACT_ID,
        "contractVersion": CONTRACT_VERSION,
        "candidateGroups": len(plans),
        "strictAccepted": len(kept),
        "strictRejected": len(plans) - len(kept),
        "acceptanceRate": len(kept) / max(len(plans), 1),
        "pairNotMaterializable": pair_not_materializable,
        "stage2Rejected": stage2_rejected,
        "rejectReasons": dict(reject_reasons.most_common(40)),
        "uniqueTargetSurfaces": len(surf_counts),
        "pairsPerSurface": {
            "mean": sum(surf_counts.values()) / max(len(surf_counts), 1),
            "max": max(surf_counts.values()) if surf_counts else 0,
            "top10": surf_counts.most_common(10),
        },
        "modelVisibleStrongRate": inv["anchor_removed_tensor_identical"],
        "invariants": inv,
        "materializeOnce": True,
        "utterances": len(all_samples),
        "mixCounts": {
            "STRICT": n_strict,
            "NATURAL": len([s for s in mix_samples if s.get("trainingBucket") == "NATURAL"]),
            "HARD_KEEP": len([s for s in mix_samples if s.get("trainingBucket") == "HARD_KEEP"]),
            "NO_ANCHOR": len([s for s in mix_samples if s.get("trainingBucket") == "NO_ANCHOR"]),
        },
        "full100kMutated": False,
        "checksums": checksum,
    }
    (OUT / "dataset_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (DOCS / "STRICT_ANCHOR_CONTRAST_PAIR_V1.json").write_text(
        json.dumps(
            {
                "contractId": CONTRACT_ID,
                "version": CONTRACT_VERSION,
                "scope": "TRAINING_DATA_CONSTRUCTION_ONLY",
                "invariants": [
                    "same currentText",
                    "same targetSurface",
                    "same target offsets",
                    "same non-anchor span geometry",
                    "different Anchor placement",
                    "KEEP vs RETRY labels",
                    "anchor-removed model-visible tensors identical",
                    "RETRY referenceReachable=YES",
                    "Anchor RETRY=0",
                ],
                "notStrict": ["SEMANTIC_CONTRAST same-target different-sentence"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "strictAccepted": len(kept),
                "utterances": len(all_samples),
                "mv_rate": inv["anchor_removed_tensor_identical"],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
