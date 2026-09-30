# -*- coding: utf-8 -*-
"""Generate Model3 V1 Anchor-dependent contrast pilot (10k–20k).

Core structure:
  same target surface X + Anchor A → KEEP
  same target surface X + Anchor B → RETRY (reference reachable)

Simulated training anchors only (sidecar). Schema/runtime Anchor enum unchanged.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_common import (
    build_sample,
    label_spans,
    run_harness,
    validate_sample,
)
from training.model3_error_text.generator.corrupt import annotate_sentence, try_phonetic_corruption
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import (
    LexiconSurfaceResolver,
    default_sqlite_path,
)

OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot"
DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
SEED = 2026082415
TARGET_UTTERANCES = 18000
SHARD_SIZE = 5000
HARNESS_CHUNK = 200
HARNESS_WORKERS = 3
NO_ANCHOR_RATIO = 0.12
GEN_VERSION = "model3-v1-anchor-contrast-pilot-1.2.0"
DATASET_VERSION = "model3_v1_anchor_contrast_pilot_20260824"
HOLD_FAMILIES = {"h_f", "eng_en"}  # held-out from train

# Contentful simulated anchors — prefer 2-char atoms
ANCHOR_BANK = [
    "酒店", "机场", "养鸡", "农场", "医院", "银行", "学校", "餐厅", "超市", "车站",
    "快递", "外卖", "停车", "充电", "挂号", "开票", "退款", "预约", "装修", "搬家",
    "旅游", "机票", "门诊", "药房", "食堂", "宿舍", "仓库", "工地", "工厂", "加油",
]

# Dual-candidate templates: BOTH anchors appear in the SAME utterance.
# STRONG KEEP/RETRY share identical currentText; only isAnchor placement differs.
DUAL_TEMPLATES = [
    "候选主题A={a_keep}；候选主题B={a_retry}。目标项：{target}",
    "上下文同时出现{a_keep}与{a_retry}。核验对象：{target}",
    "业务线索：{a_keep} / {a_retry}。关注：{target}",
    "【{a_keep}】与【{a_retry}】并存时，条目为{target}",
    "从{a_keep}和{a_retry}两侧看，对象是{target}",
    "关联词{a_keep}、{a_retry}；处理项{target}",
]

# Single-anchor templates for MEDIUM / NO_ANCHOR
TEMPLATES = [
    "关于{anchor}，请核对：{target}",
    "业务={anchor}。目标项：{target}",
    "{anchor}场景下，关注对象是{target}",
    "主题【{anchor}】；条目【{target}】",
]

_CJK = re.compile(r"[\u4e00-\u9fff]")


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
    """Simulated training anchor via char-range overlap with anchor substring."""
    for s in spans:
        s["isAnchor"] = False
        s["anchorSource"] = "NONE"
    if not anchor_surface:
        return []
    text = current_text or ""
    pos = text.find(anchor_surface)
    if pos < 0:
        # fallback exact surface match
        for s in spans:
            if s.get("surface") == anchor_surface:
                s["isAnchor"] = True
                s["anchorSource"] = "DOMAIN"
                return [s["spanId"]]
        return []
    end = pos + len(anchor_surface)
    # pick span with max overlap with [pos, end)
    best = None
    best_ov = 0
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


def build_ambiguous_targets(resolver: LexiconSurfaceResolver, rng: random.Random, n: int = 2000) -> list[dict]:
    """Prefer reachability-validated seeds (volume); optional multi-char minority."""
    preferred = OUT / "_seed_pairs_reachable.json"
    seed_path = preferred if preferred.exists() else (OUT / "_seed_pairs.json")
    if not seed_path.exists():
        print("seed pairs missing", flush=True)
        return []
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    multi_path = OUT / "_seed_pairs_multichar.json"
    if multi_path.exists():
        mrows = [
            r
            for r in json.loads(multi_path.read_text(encoding="utf-8"))
            if len(r.get("error_surface") or "") >= 2
        ]
        rng.shuffle(mrows)
        rows = mrows[:15] + rows
    rng.shuffle(rows)
    rows = rows[:n]
    print(
        f"ambiguous_targets_done={len(rows)} multi={sum(1 for r in rows if len(r.get('error_surface',''))>=2)}",
        flush=True,
    )
    return rows


def pick_anchors(rng: random.Random, keep_surface: str, retry_ref: str) -> tuple[str, str]:
    """Pick two distinct contentful anchors; prefer not equal to target words."""
    bank = [a for a in ANCHOR_BANK if a not in (keep_surface, retry_ref)]
    rng.shuffle(bank)
    a_keep = bank[0]
    a_retry = bank[1] if len(bank) > 1 else bank[0]
    if a_retry == a_keep and len(bank) > 2:
        a_retry = bank[2]
    return a_keep, a_retry


def fill_template(tpl: str, anchor: str, target: str) -> str:
    return tpl.format(anchor=anchor, target=target)


def fill_dual(tpl: str, a_keep: str, a_retry: str, target: str) -> str:
    return tpl.format(a_keep=a_keep, a_retry=a_retry, target=target)


def make_plans(resolver: LexiconSurfaceResolver, rng: random.Random) -> list[dict]:
    targets = build_ambiguous_targets(resolver, rng, n=800)
    print(f"ambiguous_targets={len(targets)}", flush=True)
    plans = []
    idx = 0

    family_keys = sorted({f"{t['keep_surface']}|{t['retry_reference']}" for t in targets})
    rng2 = random.Random(SEED + 7)
    rng2.shuffle(family_keys)
    # Hold out surface families for unseen-surface axis — but keep train majority.
    # Exclude pronunciation-hold families from surface-hold pool (they already go to test).
    non_pron_hold = [
        k
        for k in family_keys
        if next((t["family"] for t in targets if f"{t['keep_surface']}|{t['retry_reference']}" == k), "")
        not in HOLD_FAMILIES
    ]
    n_hold_surface = max(12, min(24, int(len(non_pron_hold) * 0.12)))
    hold_surface_fams = set(non_pron_hold[:n_hold_surface])
    hold_context_fams = set(non_pron_hold[n_hold_surface : n_hold_surface + max(8, n_hold_surface // 2)])

    # Scale replicates so STRONG+MEDIUM stay majority within ~18k utterances.
    n_targets_eff = max(1, len(targets))
    contrast_budget = int(TARGET_UTTERANCES * (1.0 - NO_ANCHOR_RATIO))
    per_family = max(6, contrast_budget // max(n_targets_eff, 1))
    n_strong = max(3, int(per_family * 0.7) // 2)
    n_med = max(1, int(per_family * 0.3) // 2)
    print(f"reps_per_family strong={n_strong} medium={n_med}", flush=True)

    def add_strong_pair(t, split, held, context_hold):
        nonlocal idx
        fam_key = f"{t['keep_surface']}|{t['retry_reference']}"
        for strength, n_rep in (("STRONG", n_strong), ("MEDIUM", n_med)):
            for rep_i in range(n_rep):
                a_keep, a_retry = pick_anchors(rng, t["keep_surface"], t["retry_reference"])
                cg = f"cg:{fam_key}:{strength}:r{rep_i}"
                if strength == "STRONG":
                    # Identical currentText; only active simulated Anchor differs.
                    tpl = rng.choice(DUAL_TEMPLATES)
                    shared_err = fill_dual(tpl, a_keep, a_retry, t["error_surface"])
                    shared_ref = fill_dual(tpl, a_keep, a_retry, t["retry_reference"])
                    plans.append(
                        {
                            "harnessId": f"ac{SEED}_{idx:06d}",
                            "variantKind": f"{strength}_KEEP",
                            "contrastStrength": strength,
                            "contrastGroupId": cg,
                            "contrastFamilyKey": fam_key,
                            "roleInPair": "KEEP",
                            "anchorSurface": a_keep,
                            "targetSurface": t["error_surface"],
                            "referenceText": shared_err,
                            "errorText": shared_err,
                            "corruptions": [],
                            "split": split,
                            "heldOutAxes": list(held),
                            "contextHoldFamily": context_hold,
                            "corruptionFamily": t["family"],
                            "intendedDiet": "ANCHOR_CONDITIONED",
                            "sameTextContrast": True,
                        }
                    )
                    idx += 1
                    pos = shared_err.find(t["error_surface"])
                    if pos < 0:
                        continue
                    corr = {
                        "spanStart": pos,
                        "spanEnd": pos + len(t["error_surface"]),
                        "referenceSurface": t["retry_reference"],
                        "errorSurface": t["error_surface"],
                        "corruptionFamily": t["family"],
                        "isPhonetic": True,
                        "generationReason": f"anchor_contrast_pilot/{strength}_same_text",
                    }
                    held_r = list(held)
                    if context_hold and split == "test":
                        held_r.append("held_out_anchor_combination")
                    plans.append(
                        {
                            "harnessId": f"ac{SEED}_{idx:06d}",
                            "variantKind": f"{strength}_RETRY",
                            "contrastStrength": strength,
                            "contrastGroupId": cg,
                            "contrastFamilyKey": fam_key,
                            "roleInPair": "RETRY",
                            "anchorSurface": a_retry,
                            "targetSurface": t["error_surface"],
                            "referenceText": shared_ref,
                            "errorText": shared_err,
                            "corruptions": [corr],
                            "split": split,
                            "heldOutAxes": held_r,
                            "contextHoldFamily": context_hold,
                            "corruptionFamily": t["family"],
                            "intendedDiet": "ANCHOR_CONDITIONED",
                            "sameTextContrast": True,
                        }
                    )
                    idx += 1
                    continue

                # MEDIUM: different single-anchor contexts
                tpl = rng.choice(TEMPLATES)
                keep_text = fill_template(tpl, a_keep, t["keep_surface"])
                plans.append(
                    {
                        "harnessId": f"ac{SEED}_{idx:06d}",
                        "variantKind": f"{strength}_KEEP",
                        "contrastStrength": strength,
                        "contrastGroupId": cg,
                        "contrastFamilyKey": fam_key,
                        "roleInPair": "KEEP",
                        "anchorSurface": a_keep,
                        "targetSurface": t["keep_surface"],
                        "referenceText": keep_text,
                        "errorText": keep_text,
                        "corruptions": [],
                        "split": split,
                        "heldOutAxes": list(held),
                        "contextHoldFamily": context_hold,
                        "corruptionFamily": t["family"],
                        "intendedDiet": "ANCHOR_CONDITIONED",
                        "sameTextContrast": False,
                    }
                )
                idx += 1

                tpl2 = rng.choice(TEMPLATES)
                ref_text = fill_template(tpl2, a_retry, t["retry_reference"])
                err_text = fill_template(tpl2, a_retry, t["error_surface"])
                pos = err_text.find(t["error_surface"])
                if pos < 0:
                    continue
                corr = {
                    "spanStart": pos,
                    "spanEnd": pos + len(t["error_surface"]),
                    "referenceSurface": t["retry_reference"],
                    "errorSurface": t["error_surface"],
                    "corruptionFamily": t["family"],
                    "isPhonetic": True,
                    "generationReason": f"anchor_contrast_pilot/{strength}",
                }
                held_r = list(held)
                if context_hold and split == "test":
                    held_r.append("held_out_anchor_combination")
                plans.append(
                    {
                        "harnessId": f"ac{SEED}_{idx:06d}",
                        "variantKind": f"{strength}_RETRY",
                        "contrastStrength": strength,
                        "contrastGroupId": cg,
                        "contrastFamilyKey": fam_key,
                        "roleInPair": "RETRY",
                        "anchorSurface": a_retry,
                        "targetSurface": t["error_surface"],
                        "referenceText": ref_text,
                        "errorText": err_text,
                        "corruptions": [corr],
                        "split": split,
                        "heldOutAxes": held_r,
                        "contextHoldFamily": context_hold,
                        "corruptionFamily": t["family"],
                        "intendedDiet": "ANCHOR_CONDITIONED",
                        "sameTextContrast": False,
                    }
                )
                idx += 1

    for t in targets:
        fam_key = f"{t['keep_surface']}|{t['retry_reference']}"
        if fam_key in hold_surface_fams:
            split = "test"
            held = ["held_out_surface_pair", "held_out_source_sentence"]
        else:
            split = assign_split(fam_key)
            held = []
        # Hold pronunciation families entirely out of train (test-only)
        if t["family"] in HOLD_FAMILIES:
            split = "test"
            held = list(set(held + ["held_out_pronunciation_family"]))
        context_hold = fam_key in hold_context_fams
        add_strong_pair(t, split, held, context_hold)

    # NO_ANCHOR controls
    no_anchor_n = int(TARGET_UTTERANCES * NO_ANCHOR_RATIO)
    added_na = 0
    for t in targets:
        if added_na >= no_anchor_n:
            break
        fam_key = f"{t['keep_surface']}|{t['retry_reference']}"
        if fam_key in hold_surface_fams or t["family"] in HOLD_FAMILIES:
            continue
        split = assign_split(fam_key + ":na")
        tpl = rng.choice(TEMPLATES)
        a, _ = pick_anchors(rng, t["keep_surface"], t["retry_reference"])
        text = fill_template(tpl, a, t["keep_surface"])
        plans.append(
            {
                "harnessId": f"ac{SEED}_{idx:06d}",
                "variantKind": "NO_ANCHOR_KEEP",
                "contrastStrength": "NONE",
                "contrastGroupId": f"cg:{fam_key}:na",
                "contrastFamilyKey": fam_key,
                "roleInPair": "KEEP",
                "anchorSurface": None,
                "targetSurface": t["keep_surface"],
                "referenceText": text,
                "errorText": text,
                "corruptions": [],
                "split": split,
                "heldOutAxes": [],
                "corruptionFamily": None,
                "intendedDiet": "NO_ANCHOR",
            }
        )
        idx += 1
        added_na += 1

    rng.shuffle(plans)
    if len(plans) > TARGET_UTTERANCES:
        by_g = defaultdict(list)
        for p in plans:
            by_g[p["contrastGroupId"]].append(p)
        selected = []
        groups = list(by_g.keys())
        rng.shuffle(groups)
        for g in groups:
            roles = {x["roleInPair"] for x in by_g[g]}
            if "KEEP" in roles and "RETRY" in roles:
                selected.extend(by_g[g])
            if len(selected) >= TARGET_UTTERANCES:
                break
        if len(selected) < TARGET_UTTERANCES:
            for g in groups:
                if any(x in selected for x in by_g[g]):
                    continue
                selected.extend(by_g[g])
                if len(selected) >= TARGET_UTTERANCES:
                    break
        plans = selected[:TARGET_UTTERANCES]

    meta = {
        "hold_surface_families": len(hold_surface_fams),
        "hold_context_families": len(hold_context_fams),
        "hold_pronunciation_families": sorted(HOLD_FAMILIES),
        "n_ambiguous_targets": len(targets),
    }
    return plans, meta


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
        if workers <= 1:
            for wid, chunk, wd in chunks:
                _, outs = harness_worker((wid, chunk, wd))
                for m in outs:
                    if m.get("id"):
                        mats[m["id"]] = m
                        af.write(json.dumps(m, ensure_ascii=False) + "\n")
                af.flush()
        else:
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


def main():
    print("start anchor contrast pilot", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for sp in ("train", "dev", "test"):
        (OUT / sp).mkdir(exist_ok=True)

    rng = random.Random(SEED)
    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))
    plans, plan_meta = make_plans(resolver, rng)
    print(f"plans={len(plans)} meta={plan_meta}", flush=True)

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
    strength_stats = Counter()

    for p in plans:
        mat = mats.get(p["harnessId"])
        if not mat or not mat.get("ok"):
            excluded.append({"id": p["harnessId"], "reason": "harness_fail"})
            continue
        # force simulated anchor (or strip for NO_ANCHOR)
        if p["intendedDiet"] == "NO_ANCHOR" or not p.get("anchorSurface"):
            for s in mat.get("spans") or []:
                s["isAnchor"] = False
                s["anchorSource"] = "NONE"
            sim_ids = []
            bucket = "NO_ANCHOR"
        else:
            # clear production domain anchors then force simulated
            for s in mat.get("spans") or []:
                s["isAnchor"] = False
                s["anchorSource"] = "NONE"
            sim_ids = force_anchor_on_surface(
                mat.get("spans") or [], p["anchorSurface"], mat.get("currentText") or p["errorText"]
            )
            if not sim_ids:
                excluded.append({"id": p["harnessId"], "reason": "anchor_span_not_found", "anchor": p["anchorSurface"]})
                continue
            bucket = "SIMULATED_TRAINING"

        spans, st = label_spans(mat)
        # Ensure target span of interest isn't accidentally MASKED
        # (anchor and target are different surfaces by construction)
        label_stats.update(st)
        strength_stats[p.get("contrastStrength") or "NONE"] += 1

        sample_id = f"m3ac_{SEED}_{p['harnessId']}"
        sidecar = {
            "sampleId": sample_id,
            "harnessId": p["harnessId"],
            "anchorDietBucket": bucket,
            "trainingAnchorEvidence": "SIMULATED_TRAINING_ANCHOR" if bucket == "SIMULATED_TRAINING" else "NONE",
            "simulatedAnchorSpanIds": sim_ids,
            "anchorSurface": p.get("anchorSurface"),
            "targetSurface": p.get("targetSurface"),
            "contrastStrength": p.get("contrastStrength"),
            "contrastGroupId": p.get("contrastGroupId"),
            "contrastFamilyKey": p.get("contrastFamilyKey"),
            "roleInPair": p.get("roleInPair"),
            "variantKind": p.get("variantKind"),
            "corruptionFamily": p.get("corruptionFamily"),
        }
        with sidecar_path.open("a", encoding="utf-8") as sf:
            sf.write(json.dumps(sidecar, ensure_ascii=False) + "\n")

        sample = build_sample(
            mat,
            spans,
            {
                "sourceSampleId": p["harnessId"],
                "sourceCorpus": "anchor_contrast_pilot_v1",
                "sourceSentenceId": p["contrastFamilyKey"],
                "contrastGroupId": p["contrastGroupId"],
                "splitGroupKey": p["contrastFamilyKey"],
                "surfacePairKey": f"surf:{p['targetSurface']}",
                "source_type": "ANCHOR_CONTRAST_PILOT",
                "heldOutAxes": p.get("heldOutAxes") or [],
            },
            sample_id,
            p["split"],
            GEN_VERSION,
            DATASET_VERSION,
            "anchor_provenance_sidecar.jsonl",
        )
        sample["heldOutAxes"] = p.get("heldOutAxes") or []
        errs = validate_sample(sample)
        if errs:
            excluded.append({"id": sample_id, "reason": "validation", "errs": errs})
            continue
        # Drop RETRY without YES (should already be caught)
        samples.append(sample)

    # Keep only contrast groups where RETRY side actually materialized as RETRY
    # (referenceReachable=YES). Otherwise same-surface KEEP/RETRY contrast collapses.
    sid_to_sample = {s["sampleId"]: s for s in samples}
    sidecar_tmp = []
    with sidecar_path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                sidecar_tmp.append(json.loads(line))
    by_cg_tmp = defaultdict(list)
    for r in sidecar_tmp:
        by_cg_tmp[r.get("contrastGroupId")].append(r)

    def target_has_label(sample_id: str, want: str) -> bool:
        s = sid_to_sample.get(sample_id)
        if not s:
            return False
        tgt = next((r.get("targetSurface") for r in sidecar_tmp if r["sampleId"] == sample_id), None)
        for sp in s["spans"]:
            if sp.get("targetMask") != 1:
                continue
            if tgt and sp.get("surface") != tgt:
                continue
            if sp.get("label") == want:
                return True
        return False

    keep_ids = set()
    for g, rows in by_cg_tmp.items():
        if rows and rows[0].get("contrastStrength") == "NONE":
            for r in rows:
                keep_ids.add(r["sampleId"])
            continue
        keep_r = [r for r in rows if r.get("roleInPair") == "KEEP"]
        retry_r = [r for r in rows if r.get("roleInPair") == "RETRY"]
        if not keep_r or not retry_r:
            continue
        if target_has_label(keep_r[0]["sampleId"], "KEEP") and target_has_label(
            retry_r[0]["sampleId"], "RETRY"
        ):
            keep_ids.add(keep_r[0]["sampleId"])
            keep_ids.add(retry_r[0]["sampleId"])
    before = len(samples)
    samples = [s for s in samples if s["sampleId"] in keep_ids]
    # rewrite sidecar to surviving samples
    sidecar_path.write_text(
        "".join(
            json.dumps(r, ensure_ascii=False) + "\n"
            for r in sidecar_tmp
            if r["sampleId"] in keep_ids
        ),
        encoding="utf-8",
    )
    print(f"contrast_filter kept={len(samples)}/{before}", flush=True)
    # refresh label stats after filter
    label_stats = Counter()
    strength_stats = Counter()
    for s in samples:
        for sp in s["spans"]:
            label_stats[sp.get("label")] += 1
        # recover strength from sidecar
    sid_strength = {r["sampleId"]: r.get("contrastStrength") for r in sidecar_tmp if r["sampleId"] in keep_ids}
    for s in samples:
        strength_stats[sid_strength.get(s["sampleId"], "NONE")] += 1

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

    # contrast stats
    by_target = defaultdict(lambda: Counter())
    for s in samples:
        sc_target = None
        # from sidecar prefer
        for sp in s["spans"]:
            if sp.get("label") in ("KEEP", "RETRY") and sp.get("targetMask") == 1:
                by_target[sp["surface"]][sp["label"]] += 1
    same_diff = sum(1 for t, c in by_target.items() if c.get("KEEP") and c.get("RETRY"))

    # strong pairs: groups with both KEEP and RETRY roles in sidecar
    sidecar_rows = []
    with sidecar_path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                sidecar_rows.append(json.loads(line))
    by_cg = defaultdict(list)
    for r in sidecar_rows:
        by_cg[r.get("contrastGroupId")].append(r)
    strong_pairs = 0
    medium_pairs = 0
    for g, rows in by_cg.items():
        roles = {r.get("roleInPair") for r in rows}
        strengths = {r.get("contrastStrength") for r in rows}
        if "KEEP" in roles and "RETRY" in roles:
            if "STRONG" in strengths:
                strong_pairs += 1
            elif "MEDIUM" in strengths:
                medium_pairs += 1

    anchor_utt = sum(1 for s in samples if any(sp.get("isAnchor") for sp in s["spans"]))
    manifest = {
        "datasetVersion": DATASET_VERSION,
        "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
        "generatorVersion": GEN_VERSION,
        "seed": SEED,
        "sampleCount": len(samples),
        "excludedCount": len(excluded),
        "splitCounts": dict(Counter(s["split"] for s in samples)),
        "labelDistribution": dict(label_stats),
        "contrastStrengthUtterances": dict(strength_stats),
        "strongPairs": strong_pairs,
        "mediumPairs": medium_pairs,
        "sameTargetDifferentLabelSurfaces": same_diff,
        "anchorConditionedUtterances": anchor_utt,
        "noAnchorUtterances": len(samples) - anchor_utt,
        "planMeta": plan_meta,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "holdPronunciationFamilies": sorted(HOLD_FAMILIES),
    }
    (OUT / "dataset_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "excluded_samples.jsonl").write_text(
        "\n".join(json.dumps(x, ensure_ascii=False) for x in excluded) + ("\n" if excluded else ""),
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
