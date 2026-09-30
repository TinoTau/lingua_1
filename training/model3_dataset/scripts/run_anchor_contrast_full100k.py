# -*- coding: utf-8 -*-
"""Generate ~100k MODEL3_TRAINING_SAMPLE_V1 Anchor-contrast full corpus.

Training diet (directional, not forced exact ratios):
  ~45–60% NATURAL_ANCHOR_CONDITIONED
  ~20–30% ANCHOR_DEPENDENT_CONTRAST
  ~15–20% NO_ANCHOR
  ~10–20% HARD_KEEP / uncommon / unreachable negatives

Seeds (MODEL3_ANCHOR_CONTEXT_SEED_V1) are construction hints only —
intendedRole never becomes the authoritative label.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.anchor_diet import apply_anchor_diet
from training.model3_dataset.scripts.stage2_common import (
    build_sample,
    label_spans,
    run_harness,
    validate_sample,
)
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

OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
DOCS = REPO / "docs/user_correction/model3"
SEED_DIR = DOCS / "model3_anchor_context_seed_v1"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
REACHABLE = (
    REPO
    / "training/model3_dataset/model3_v1_anchor_contrast_pilot/_seed_pairs_reachable.json"
)

SEED = 2026082420
TARGET_SAMPLES = 100000
SHARD_SIZE = 5000
HARNESS_CHUNK = 200
HARNESS_WORKERS = 4
HOLD_FAMILIES = {"h_f", "eng_en"}
GEN_VERSION = "model3-v1-anchor-contrast-full100k-1.0.0"
DATASET_VERSION = "model3_v1_anchor_contrast_full100k_20260824"

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
]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def assign_split(family_key: str) -> str:
    h = int(hashlib.sha256(f"{SEED}:{family_key}".encode()).hexdigest(), 16) % 100
    if h < 80:
        return "train"
    if h < 90:
        return "dev"
    return "test"


def force_anchor_on_surface(spans: list[dict], anchor_surface: str, current_text: str = "") -> list[str]:
    for s in spans:
        s["isAnchor"] = False
        s["anchorSource"] = "NONE"
    if not anchor_surface:
        return []
    text = current_text or ""
    pos = text.find(anchor_surface)
    if pos < 0:
        for s in spans:
            if s.get("surface") == anchor_surface:
                s["isAnchor"] = True
                s["anchorSource"] = "DOMAIN"
                return [s["spanId"]]
        return []
    end = pos + len(anchor_surface)
    best, best_ov = None, 0
    for s in spans:
        a, b = s["rawStart"], s["rawEnd"]
        ov = max(0, min(b, end) - max(a, pos))
        if ov > best_ov:
            best_ov = ov
            best = s
    if best and best_ov > 0:
        best["isAnchor"] = True
        best["anchorSource"] = "DOMAIN"
        return [best["spanId"]]
    return []


def load_seeds() -> list[dict]:
    rows = []
    for p in sorted(SEED_DIR.glob("model3_anchor_context_seed_v1_*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def load_bases() -> list[dict]:
    rows = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            text = o.get("normalized") or ""
            if not text or len(text) < 4 or len(text) > 48:
                continue
            if "dialog_200" in (o.get("source") or "").lower():
                continue
            rows.append(o)
    return rows


def seed_to_plan(seed: dict, split: str, held: list[str]) -> dict | None:
    st = seed["seedType"]
    cur = seed.get("currentText") or ""
    ref = seed.get("referenceText") or cur
    tgt = seed.get("targetSurface")
    ref_surf = seed.get("referenceSurface")
    corruptions = []
    if st == "ANCHOR_CONTRAST_RETRY_CANDIDATE" and tgt and ref_surf and tgt != ref_surf:
        pos = cur.find(tgt)
        if pos < 0:
            return None
        corruptions = [
            {
                "spanStart": pos,
                "spanEnd": pos + len(tgt),
                "referenceSurface": ref_surf,
                "errorSurface": tgt,
                "corruptionFamily": "seed_phonetic",
                "isPhonetic": True,
                "generationReason": "MODEL3_ANCHOR_CONTEXT_SEED_V1/RETRY_CANDIDATE",
            }
        ]
    bucket = {
        "ANCHOR_CONTRAST_KEEP_CANDIDATE": "CONTRAST",
        "ANCHOR_CONTRAST_RETRY_CANDIDATE": "CONTRAST",
        "NATURAL_ANCHOR_CONTEXT": "NATURAL",
        "HARD_KEEP_CANDIDATE": "HARD_KEEP",
        "NO_ANCHOR_CONTROL": "NO_ANCHOR",
    }.get(st, "NATURAL")
    return {
        "harnessId": f"f100k_seed_{seed['seedId']}",
        "bucket": bucket,
        "seedType": st,
        "contrastStrength": seed.get("contrastStrength") or "NONE",
        "contrastGroupId": seed.get("contrastGroupId") or f"seedsolo:{seed['seedId']}",
        "anchorSurface": seed.get("anchorCandidateSurface"),
        "targetSurface": tgt,
        "referenceText": ref,
        "errorText": cur,
        "corruptions": corruptions,
        "split": split,
        "heldOutAxes": list(held),
        "intendedDiet": "NO_ANCHOR" if bucket == "NO_ANCHOR" else "ANCHOR_CONDITIONED",
        "sourceKind": "SEED_V1",
        "seedId": seed["seedId"],
        # never used as label — sidecar only
        "intendedRoleHint": seed.get("intendedRole"),
    }


def make_seed_plans(seeds: list[dict], rng: random.Random) -> list[dict]:
    # Split by contrast group / seed id BEFORE materialization
    by_g = defaultdict(list)
    for s in seeds:
        g = s.get("contrastGroupId") or f"solo:{s['seedId']}"
        by_g[g].append(s)

    groups = list(by_g.keys())
    rng.shuffle(groups)
    n_hold_surf = max(40, int(len(groups) * 0.08))
    hold_surf = set(groups[:n_hold_surf])
    hold_ctx = set(groups[n_hold_surf : n_hold_surf + max(30, n_hold_surf // 2)])

    plans = []
    for g in groups:
        split = "test" if g in hold_surf else assign_split(g)
        held = []
        if g in hold_surf:
            held.append("held_out_surface_pair")
        if g in hold_ctx and split == "test":
            held.append("held_out_anchor_combination")
        for s in by_g[g]:
            p = seed_to_plan(s, split, held)
            if p:
                plans.append(p)
    return plans


def make_natural_plans(bases: list[dict], resolver: LexiconSurfaceResolver, rng: random.Random, n_target: int) -> list[dict]:
    """Natural + NO_ANCHOR from certified pool.

    Avoids mass Node annotate. Phonetic RETRY volume comes from seeds +
    reachable-pair STRONG contrast. Small annotate budget for HARD_KEEP.
    """
    for b in bases:
        sid = b.get("source_sentence_id") or (
            "prior:" + hashlib.sha1((b.get("normalized") or "").encode()).hexdigest()[:12]
        )
        b["_sid"] = sid
        b["_split"] = assign_split(sid)

    rng.shuffle(bases)
    plans = []
    idx = 0
    hold_bases = set(b["_sid"] for b in bases[: max(80, len(bases) // 25)])
    prefixes = ["", "嗯，", "那个，"]
    train_fams = [f for f in ACTIVE_FAMILIES_V1 if f not in HOLD_FAMILIES]

    for bi, b in enumerate(bases):
        text0 = b["normalized"]
        sid = b["_sid"]
        split = "test" if sid in hold_bases else b["_split"]
        held = ["held_out_source_sentence"] if sid in hold_bases else []
        for pi, pref in enumerate(prefixes):
            if len(plans) >= int(n_target * 0.92):
                break
            text = pref + text0
            diet = "NO_ANCHOR" if ((bi + pi) % 5 == 0) else "ANCHOR_CONDITIONED"
            plans.append(
                {
                    "harnessId": f"f100k_nat_{SEED}_{idx:06d}",
                    "bucket": "NO_ANCHOR" if diet == "NO_ANCHOR" else "NATURAL",
                    "seedType": None,
                    "contrastStrength": "NONE",
                    "contrastGroupId": f"nat:{sid}:p{pi}",
                    "anchorSurface": None,
                    "targetSurface": None,
                    "referenceText": text,
                    "errorText": text,
                    "corruptions": [],
                    "split": split,
                    "heldOutAxes": list(held),
                    "intendedDiet": diet,
                    "sourceKind": "CERTIFIED_POOL",
                    "sourceSentenceId": sid,
                }
            )
            idx += 1
        if len(plans) >= int(n_target * 0.92):
            break
    print(f"natural_clean_plans={len(plans)}", flush=True)

    annotate_budget = 600
    for bi, b in enumerate(bases[:annotate_budget]):
        if len(plans) >= n_target:
            break
        if bi % 150 == 0:
            print(f"natural_corrupt_progress={bi} plans={len(plans)}", flush=True)
        text = b["normalized"]
        sid = b["_sid"]
        split = "test" if sid in hold_bases else b["_split"]
        held = ["held_out_source_sentence"] if sid in hold_bases else []
        annos, _, meta = annotate_sentence(text)
        if meta.get("skip") or not annos:
            continue
        eligible = [a for a in annos if not a.skip_reason]
        if not eligible:
            continue
        a = rng.choice(eligible)
        fams = list(train_fams)
        rng.shuffle(fams)
        for fam in fams[:2]:
            c = try_phonetic_corruption(text, a, fam, resolver)
            if not c or c["referenceSurface"] == c["errorSurface"]:
                continue
            c["corruptionFamily"] = fam
            try:
                err = apply_corruptions(text, [c])
            except Exception:
                break
            plans.append(
                {
                    "harnessId": f"f100k_nat_{SEED}_{idx:06d}",
                    "bucket": "NATURAL",
                    "seedType": None,
                    "contrastStrength": "NONE",
                    "contrastGroupId": f"nat:{sid}:phon:{c['spanStart']}",
                    "anchorSurface": None,
                    "targetSurface": c["errorSurface"],
                    "referenceText": text,
                    "errorText": err,
                    "corruptions": [c],
                    "split": split,
                    "heldOutAxes": list(held),
                    "intendedDiet": "ANCHOR_CONDITIONED",
                    "sourceKind": "CERTIFIED_POOL",
                    "sourceSentenceId": sid,
                    "corruptionFamily": fam,
                }
            )
            idx += 1
            break
        if rng.random() < 0.4:
            for a2 in eligible:
                o = try_orthographic_de_di_de(text, a2)
                if not o:
                    continue
                try:
                    err = apply_corruptions(text, [o])
                except Exception:
                    break
                plans.append(
                    {
                        "harnessId": f"f100k_nat_{SEED}_{idx:06d}",
                        "bucket": "HARD_KEEP",
                        "seedType": None,
                        "contrastStrength": "NONE",
                        "contrastGroupId": f"nat:{sid}:ortho",
                        "anchorSurface": None,
                        "targetSurface": o["errorSurface"],
                        "referenceText": text,
                        "errorText": err,
                        "corruptions": [o],
                        "split": split,
                        "heldOutAxes": list(held),
                        "intendedDiet": "ANCHOR_CONDITIONED",
                        "sourceKind": "CERTIFIED_POOL",
                        "sourceSentenceId": sid,
                        "corruptionFamily": "ORTHOGRAPHIC_DE_DI_DE",
                    }
                )
                idx += 1
                break

    rng.shuffle(plans)
    print(f"natural_plans_done={len(plans)}", flush=True)
    return plans[:n_target]


def make_contrast_extra_plans(rng: random.Random, n_pairs: int) -> list[dict]:
    """Limited STRONG same-text dual-anchor contrast (not the whole corpus)."""
    if not REACHABLE.exists():
        return []
    pairs = json.loads(REACHABLE.read_text(encoding="utf-8"))
    rng.shuffle(pairs)
    # Hold out families / surfaces
    fam_keys = [f"{p['error_surface']}|{p['retry_reference']}" for p in pairs]
    hold_surf = set(fam_keys[: max(8, len(fam_keys) // 8)])
    plans = []
    idx = 0
    for p in pairs:
        if len(plans) // 2 >= n_pairs:
            break
        fam = p.get("family") or "unknown"
        fam_key = f"{p['error_surface']}|{p['retry_reference']}"
        if fam in HOLD_FAMILIES:
            split = "test"
            held = ["held_out_pronunciation_family"]
        elif fam_key in hold_surf:
            split = "test"
            held = ["held_out_surface_pair"]
        else:
            split = assign_split(fam_key)
            held = []
        # few replicates per family for diversity without dominating
        n_rep = 12 if split == "train" else 4
        bank = [a for a in ANCHOR_BANK if a not in (p["error_surface"], p["retry_reference"])]
        for rep in range(n_rep):
            if len(plans) // 2 >= n_pairs:
                break
            rng.shuffle(bank)
            a_keep, a_retry = bank[0], bank[1]
            tpl = rng.choice(DUAL_TEMPLATES)
            shared_err = tpl.format(a_keep=a_keep, a_retry=a_retry, target=p["error_surface"])
            shared_ref = tpl.format(a_keep=a_keep, a_retry=a_retry, target=p["retry_reference"])
            cg = f"xcg:{fam_key}:r{rep}"
            plans.append(
                {
                    "harnessId": f"f100k_xcg_{SEED}_{idx:06d}",
                    "bucket": "CONTRAST",
                    "seedType": None,
                    "contrastStrength": "STRONG",
                    "contrastGroupId": cg,
                    "anchorSurface": a_keep,
                    "targetSurface": p["error_surface"],
                    "referenceText": shared_err,
                    "errorText": shared_err,
                    "corruptions": [],
                    "split": split,
                    "heldOutAxes": list(held),
                    "intendedDiet": "ANCHOR_CONDITIONED",
                    "sourceKind": "REACHABLE_PAIR_EXTRA",
                    "roleInPair": "KEEP",
                    "corruptionFamily": fam,
                }
            )
            idx += 1
            pos = shared_err.find(p["error_surface"])
            if pos < 0:
                continue
            corr = {
                "spanStart": pos,
                "spanEnd": pos + len(p["error_surface"]),
                "referenceSurface": p["retry_reference"],
                "errorSurface": p["error_surface"],
                "corruptionFamily": fam,
                "isPhonetic": True,
                "generationReason": "full100k_strong_same_text",
            }
            plans.append(
                {
                    "harnessId": f"f100k_xcg_{SEED}_{idx:06d}",
                    "bucket": "CONTRAST",
                    "seedType": None,
                    "contrastStrength": "STRONG",
                    "contrastGroupId": cg,
                    "anchorSurface": a_retry,
                    "targetSurface": p["error_surface"],
                    "referenceText": shared_ref,
                    "errorText": shared_err,
                    "corruptions": [corr],
                    "split": split,
                    "heldOutAxes": list(held),
                    "intendedDiet": "ANCHOR_CONDITIONED",
                    "sourceKind": "REACHABLE_PAIR_EXTRA",
                    "roleInPair": "RETRY",
                    "corruptionFamily": fam,
                }
            )
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
    with cache.open("a", encoding="utf-8") as af:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(harness_worker, c) for c in chunks]
            for fut in as_completed(futs):
                _, outs = fut.result()
                for m in outs:
                    if m.get("id"):
                        mats[m["id"]] = m
                        af.write(json.dumps(m, ensure_ascii=False) + "\n")
                af.flush()
    return mats


def balance_plans(plans: list[dict], rng: random.Random, target: int) -> list[dict]:
    """Prefer natural majority; keep meaningful contrast/NO_ANCHOR/hard KEEP."""
    by = defaultdict(list)
    for p in plans:
        by[p["bucket"]].append(p)
    for k in by:
        rng.shuffle(by[k])
    # directional quotas
    quotas = {
        "NATURAL": int(target * 0.52),
        "CONTRAST": int(target * 0.24),
        "NO_ANCHOR": int(target * 0.16),
        "HARD_KEEP": int(target * 0.08),
    }
    selected = []
    for bucket, need in quotas.items():
        pool = by.get(bucket, [])
        selected.extend(pool[:need])
    if len(selected) < target:
        used = {p["harnessId"] for p in selected}
        rest = [p for p in plans if p["harnessId"] not in used]
        rng.shuffle(rest)
        selected.extend(rest[: target - len(selected)])
    # Keep STRONG contrast pairs intact when possible
    by_cg = defaultdict(list)
    for p in selected:
        if p.get("contrastStrength") == "STRONG":
            by_cg[p["contrastGroupId"]].append(p)
    drop = set()
    for g, rows in by_cg.items():
        roles = {r.get("roleInPair") for r in rows if r.get("roleInPair")}
        # seed contrast: KEEP/RETRY seedTypes
        types = {r.get("seedType") for r in rows}
        ok = (
            ("KEEP" in roles and "RETRY" in roles)
            or (
                "ANCHOR_CONTRAST_KEEP_CANDIDATE" in types
                and "ANCHOR_CONTRAST_RETRY_CANDIDATE" in types
            )
            or len(rows) == 1
        )
        if not ok and len(rows) >= 2:
            # incomplete pair from truncation — drop group
            for r in rows:
                drop.add(r["harnessId"])
    selected = [p for p in selected if p["harnessId"] not in drop]
    rng.shuffle(selected)
    return selected[:target]


def main():
    print("start full100k anchor-contrast dataset", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for sp in ("train", "dev", "test"):
        (OUT / sp).mkdir(exist_ok=True)

    rng = random.Random(SEED)
    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))

    seeds = load_seeds()
    assert len(seeds) == 16000, f"expected 16000 seeds, got {len(seeds)}"
    print(f"seeds={len(seeds)} types={Counter(s['seedType'] for s in seeds)}", flush=True)

    bases = load_bases()
    print(f"certified_bases={len(bases)}", flush=True)

    seed_plans = make_seed_plans(seeds, rng)
    natural_plans = make_natural_plans(bases, resolver, rng, n_target=72000)
    contrast_extra = make_contrast_extra_plans(rng, n_pairs=10000)
    print(
        f"plans seed={len(seed_plans)} natural={len(natural_plans)} contrast_extra={len(contrast_extra)}",
        flush=True,
    )

    all_plans = seed_plans + natural_plans + contrast_extra
    rng.shuffle(all_plans)
    plans = balance_plans(all_plans, rng, TARGET_SAMPLES)
    print(f"selected_plans={len(plans)} buckets={Counter(p['bucket'] for p in plans)}", flush=True)

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

    sidecar_path = OUT / "anchor_provenance_sidecar.jsonl"
    sidecar_path.write_text("", encoding="utf-8")
    samples = []
    excluded = []
    label_stats = Counter()
    bucket_stats = Counter()
    real_domain = 0

    for p in plans:
        mat = mats.get(p["harnessId"])
        if not mat or not mat.get("ok"):
            excluded.append({"id": p["harnessId"], "reason": "harness_fail"})
            continue

        # Anchor placement
        if p["intendedDiet"] == "NO_ANCHOR" or p["bucket"] == "NO_ANCHOR":
            for s in mat.get("spans") or []:
                s["isAnchor"] = False
                s["anchorSource"] = "NONE"
            sim_ids = []
            diet_info = {
                "intendedDiet": "NO_ANCHOR",
                "anchorDietBucket": "NO_ANCHOR",
                "trainingAnchorEvidence": "NONE",
                "simulatedAnchorSpanIds": [],
            }
        elif p.get("anchorSurface"):
            for s in mat.get("spans") or []:
                s["isAnchor"] = False
                s["anchorSource"] = "NONE"
            sim_ids = force_anchor_on_surface(
                mat.get("spans") or [], p["anchorSurface"], mat.get("currentText") or p["errorText"]
            )
            if not sim_ids:
                # fallback: diet-based simulated anchor
                diet_info = apply_anchor_diet(mat, "ANCHOR_CONDITIONED", random.Random(hash(p["harnessId"]) % (2**32)))
                sim_ids = diet_info.get("simulatedAnchorSpanIds") or []
            else:
                diet_info = {
                    "intendedDiet": "ANCHOR_CONDITIONED",
                    "anchorDietBucket": "SIMULATED_TRAINING",
                    "trainingAnchorEvidence": "SIMULATED_TRAINING_ANCHOR",
                    "simulatedAnchorSpanIds": sim_ids,
                }
        else:
            diet_info = apply_anchor_diet(mat, "ANCHOR_CONDITIONED", random.Random(hash(p["harnessId"]) % (2**32)))
            sim_ids = diet_info.get("simulatedAnchorSpanIds") or []
            if diet_info.get("anchorDietBucket") == "REAL_DOMAIN":
                real_domain += 1

        spans, st = label_spans(mat)
        # Hard rule: never keep illegal RETRY
        for sp in spans:
            if sp.get("label") == "RETRY" and (sp.get("repairability") or {}).get("referenceReachable") != "YES":
                sp["label"] = "KEEP"
                st["RETRY"] -= 1
                st["KEEP"] += 1
            if sp.get("isAnchor") and sp.get("label") == "RETRY":
                sp["label"] = "MASKED"
                sp["targetMask"] = 0
                st["RETRY"] -= 1
                st["MASKED"] += 1

        label_stats.update(st)
        bucket_stats[p["bucket"]] += 1

        sample_id = f"m3f100k_{SEED}_{p['harnessId']}"
        sidecar = {
            "sampleId": sample_id,
            "harnessId": p["harnessId"],
            "bucket": p["bucket"],
            "seedType": p.get("seedType"),
            "seedId": p.get("seedId"),
            "intendedRoleHint": p.get("intendedRoleHint"),  # NOT a label
            "anchorDietBucket": diet_info.get("anchorDietBucket"),
            "trainingAnchorEvidence": diet_info.get("trainingAnchorEvidence"),
            "simulatedAnchorSpanIds": sim_ids,
            "anchorSurface": p.get("anchorSurface"),
            "targetSurface": p.get("targetSurface"),
            "contrastStrength": p.get("contrastStrength"),
            "contrastGroupId": p.get("contrastGroupId"),
            "roleInPair": p.get("roleInPair"),
            "corruptionFamily": p.get("corruptionFamily"),
            "sourceKind": p.get("sourceKind"),
        }
        with sidecar_path.open("a", encoding="utf-8") as sf:
            sf.write(json.dumps(sidecar, ensure_ascii=False) + "\n")

        sample = build_sample(
            mat,
            spans,
            {
                "sourceSampleId": p["harnessId"],
                "sourceCorpus": "anchor_contrast_full100k_v1",
                "sourceSentenceId": p.get("sourceSentenceId") or p.get("contrastGroupId") or p["harnessId"],
                "contrastGroupId": p["contrastGroupId"],
                "splitGroupKey": p.get("contrastGroupId") or p["harnessId"],
                "surfacePairKey": f"surf:{p['targetSurface']}" if p.get("targetSurface") else None,
                "source_type": p.get("sourceKind") or "FULL100K",
                "heldOutAxes": p.get("heldOutAxes") or [],
            },
            sample_id,
            p["split"],
            GEN_VERSION,
            DATASET_VERSION,
            "anchor_provenance_sidecar.jsonl",
        )
        sample["heldOutAxes"] = p.get("heldOutAxes") or []
        sample["trainingBucket"] = p["bucket"]  # metadata only; not model feature
        errs = validate_sample(sample)
        if errs:
            excluded.append({"id": sample_id, "reason": "validation", "errs": errs})
            continue
        samples.append(sample)

    # write shards
    by_split = defaultdict(list)
    for s in samples:
        by_split[s["split"]].append(s)
    checksum_rows = []
    for sp in ("train", "dev", "test"):
        for old in (OUT / sp).glob("shard-*.jsonl"):
            old.unlink()
        rows = by_split[sp]
        for i in range(0, len(rows), SHARD_SIZE):
            path = OUT / sp / f"shard-{i // SHARD_SIZE:05d}.jsonl"
            chunk = rows[i : i + SHARD_SIZE]
            with path.open("w", encoding="utf-8") as f:
                for s in chunk:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")
            checksum_rows.append(
                {
                    "path": str(path.relative_to(REPO)).replace("\\", "/"),
                    "sha256": sha256_file(path),
                    "lines": len(chunk),
                    "split": sp,
                }
            )
    with (OUT / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256,lines,split\n")
        for r in checksum_rows:
            f.write(f"{r['path']},{r['sha256']},{r['lines']},{r['split']}\n")

    # surface entropy
    by_surf = defaultdict(Counter)
    for s in samples:
        for sp in s["spans"]:
            if sp.get("targetMask") == 1 and sp.get("label") in ("KEEP", "RETRY"):
                by_surf[sp["surface"]][sp["label"]] += 1
    mixed = sum(1 for c in by_surf.values() if c["KEEP"] and c["RETRY"])

    # strong pairs
    sidecar_rows = []
    with sidecar_path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                sidecar_rows.append(json.loads(line))
    by_cg = defaultdict(list)
    for r in sidecar_rows:
        by_cg[r.get("contrastGroupId")].append(r)
    strong_pairs = 0
    for g, rows in by_cg.items():
        if not any(r.get("contrastStrength") == "STRONG" for r in rows):
            continue
        roles = {r.get("roleInPair") for r in rows}
        types = {r.get("seedType") for r in rows}
        if ("KEEP" in roles and "RETRY" in roles) or (
            "ANCHOR_CONTRAST_KEEP_CANDIDATE" in types and "ANCHOR_CONTRAST_RETRY_CANDIDATE" in types
        ):
            strong_pairs += 1

    no_anchor_utt = sum(1 for s in samples if not any(sp.get("isAnchor") for sp in s["spans"]))
    anchor_utt = len(samples) - no_anchor_utt
    eligible = label_stats["KEEP"] + label_stats["RETRY"]

    manifest = {
        "datasetVersion": DATASET_VERSION,
        "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
        "generatorVersion": GEN_VERSION,
        "seed": SEED,
        "phase": "MODEL3_V1_ANCHOR_CONTRAST_FULL_100K_DEVELOPMENT",
        "sampleCount": len(samples),
        "excludedCount": len(excluded),
        "splitCounts": dict(Counter(s["split"] for s in samples)),
        "labelDistribution": dict(label_stats),
        "bucketDistribution": dict(bucket_stats),
        "retryRatioEligible": (label_stats["RETRY"] / eligible) if eligible else 0.0,
        "anchorConditionedUtterances": anchor_utt,
        "noAnchorUtterances": no_anchor_utt,
        "realDomainUtterances": real_domain,
        "strongPairs": strong_pairs,
        "sameTargetDifferentLabelSurfaces": mixed,
        "uniqueTargetSurfaces": len(by_surf),
        "seedIngested": 16000,
        "holdPronunciationFamilies": sorted(HOLD_FAMILIES),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "notes": [
            "intendedRole from seeds is construction hint only — not final label",
            "RETRY requires referenceReachable=YES via Stage2 harness",
            "SIMULATED_TRAINING anchors are training-only sidecar provenance",
        ],
    }
    (OUT / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "excluded.json").write_text(
        json.dumps(excluded[:2000], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)
    resolver.close()


if __name__ == "__main__":
    main()
