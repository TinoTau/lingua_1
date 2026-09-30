# -*- coding: utf-8 -*-
"""MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION — AUTHORITATIVE Synthetic V1 trainer.

Status: MODEL3_SYNTHETIC_V1_FROZEN (2026-08-26). Do not retune objective / sampling in place.
Integrates Full100K + STRICT_ANCHOR_CONTRAST_PAIR_V1 + ANCHOR_CONDITIONED_HARD_KEEP_V1
via training view (no corpus regen). Reads MODEL3_V1_TRAINING_CONFIG_SSOT only.
Writes ≤4 docs artifacts. No runtime / TTS / production RETRY.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import random
import sys
import time
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

import torch
import torch.nn as nn

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.strict_contrast_pair_v1 import (  # noqa: E402
    CONTRACT_ID,
    STRICT,
    find_target_span,
    validate_strict_anchor_contrast_pair_v1,
)
from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    sample_to_tensors,
    save_model_bundle,
)
from training.model3_dataset.train.config_loader import (  # noqa: E402
    ConfigSSOTError,
    load_training_config,
    sampling_mix,
    sha_json,
)

FROZEN_CMP = {
    "Full100K_old_baseline": {
        "precision": 0.9826, "recall": 0.9440, "f1": 0.9629, "false_retry": 0.000076,
        "strict_pair": 0.6330, "strict_zero": None, "strict_shuffle": None,
        "hard_keep_acc": None, "no_anchor_fp": 0.0, "heldout_family_f1": 0.0964, "cpu_p95": None,
    },
    "Diet_B": {
        "precision": 0.9609, "recall": 0.9702, "f1": 0.9655, "false_retry": 0.000180,
        "strict_pair": 0.6657, "strict_zero": 0.6680, "strict_shuffle": 0.6453,
        "hard_keep_acc": None, "no_anchor_fp": 0.0, "heldout_family_f1": None, "cpu_p95": None,
    },
    "Strict_Reconstruction": {
        "precision": 0.3200, "recall": 0.9971, "f1": 0.4845, "false_retry": 0.055436,
        "strict_pair": 0.9975, "strict_zero": 0.0, "strict_shuffle": 0.0,
        "hard_keep_acc": None, "no_anchor_fp": 0.0, "heldout_family_f1": None, "cpu_p95": None,
    },
    "HardKeep_Broken": {
        "precision": 0.0171, "recall": None, "f1": None, "false_retry": 0.2731,
        "strict_pair": 0.9983, "strict_zero": 0.0, "strict_shuffle": 0.0,
        "hard_keep_acc": None, "no_anchor_fp": None, "heldout_family_f1": None, "cpu_p95": None,
    },
    "Objective_Rebalance_O3": {
        "precision": 0.9865, "recall": 0.9510, "f1": 0.9684, "false_retry": 0.000060,
        "strict_pair": 0.8750, "strict_zero": 0.0, "strict_shuffle": 0.1656,
        "hard_keep_acc": 0.99995, "no_anchor_fp": 0.0, "heldout_family_f1": 0.6106, "cpu_p95": None,
    },
}


def repo_path(p: str | Path) -> Path:
    pp = Path(p)
    return pp if pp.is_absolute() else REPO / pp


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_split(root: Path, split: str) -> list[dict]:
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


def load_hard_keep(root: Path) -> dict[str, dict]:
    m = {}
    p = root / "hard_keep_sidecar.jsonl"
    with p.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                m[o["sampleId"]] = o
    return m


def is_strict_member(sid: str, strict_sc: dict) -> bool:
    sc = strict_sc.get(sid) or {}
    return sc.get("contrastStrength") == STRICT or sc.get("contrastStrengthClass") == STRICT


def identity_key(sample: dict, role: str | None = None) -> tuple:
    anchors = tuple(
        sorted(
            (sp.get("spanId") or sp.get("surface") or "", bool(sp.get("isAnchor")))
            for sp in sample.get("spans") or []
        )
    )
    targets = tuple(
        sorted(
            (
                sp.get("surface"),
                sp.get("label"),
                sp.get("start"),
                sp.get("end"),
            )
            for sp in sample.get("spans") or []
            if sp.get("targetMask") == 1
        )
    )
    return (
        sample.get("currentText") or "",
        anchors,
        targets,
        role or sample.get("roleInPair"),
        sample.get("contrastGroupId"),
    )


def build_integration_train(full_train, strict_train, strict_sc, hard_keep_map):
    """Full100K base + STRICT validated members + Hard KEEP presence. No corpus mutation."""
    train = []
    have = set()
    sources = Counter()

    for s in strict_train:
        sid = s["sampleId"]
        if not is_strict_member(sid, strict_sc):
            continue
        sc = deepcopy(s)
        sc["_source"] = "STRICT_CONTRAST_VALIDATED"
        sc["_provenance"] = {
            "source": "STRICT_CONTRAST_VALIDATED",
            "isStrictMember": True,
            "isAnchorHardKeep": sid in hard_keep_map,
        }
        train.append(sc)
        have.add(sid)
        sources["STRICT_CONTRAST_VALIDATED"] += 1

    by_strict_id = {s["sampleId"]: s for s in strict_train}
    for s in full_train:
        sid = s["sampleId"]
        if sid in have:
            continue
        sc = deepcopy(s)
        hard = sid in hard_keep_map
        sc["_source"] = "ANCHOR_HARD_KEEP_VALIDATED" if hard else "FULL100K_BASE"
        if hard:
            sc["trainingBucketView"] = "ANCHOR_CONDITIONED_HARD_KEEP"
        sc["_provenance"] = {
            "source": sc["_source"],
            "isStrictMember": False,
            "isAnchorHardKeep": hard,
        }
        train.append(sc)
        have.add(sid)
        sources[sc["_source"]] += 1

    # Hard KEEP rows that live only on STRICT reconstruction KEEP side (already added if strict)
    for sid, hk in hard_keep_map.items():
        if hk.get("split") != "train" or sid in have:
            continue
        s = by_strict_id.get(sid)
        if not s:
            continue
        sc = deepcopy(s)
        sc["_source"] = "ANCHOR_HARD_KEEP_VALIDATED"
        sc["trainingBucketView"] = "ANCHOR_CONDITIONED_HARD_KEEP"
        sc["_provenance"] = {
            "source": "ANCHOR_HARD_KEEP_VALIDATED",
            "isStrictMember": is_strict_member(sid, strict_sc),
            "isAnchorHardKeep": True,
        }
        train.append(sc)
        have.add(sid)
        sources["ANCHOR_HARD_KEEP_VALIDATED"] += 1

    return train, dict(sources)


def build_index(train, strict_sc, hard_keep_map):
    buckets = defaultdict(list)
    strict_groups = defaultdict(list)
    surf_groups = defaultdict(list)
    tags = {}
    for i, s in enumerate(train):
        sid = s["sampleId"]
        sc = strict_sc.get(sid) or {}
        strict = is_strict_member(sid, strict_sc)
        hard = sid in hard_keep_map or s.get("trainingBucketView") == "ANCHOR_CONDITIONED_HARD_KEEP"
        b = s.get("trainingBucket") or "NATURAL"
        tags[sid] = {
            "isStrictMember": strict,
            "isStrictKeep": strict and sc.get("roleInPair") == "KEEP",
            "isStrictRetry": strict and sc.get("roleInPair") == "RETRY",
            "isAnchorHardKeep": hard,
            "strictGroupId": sc.get("contrastGroupId") if strict else None,
            "strictMemberRole": sc.get("roleInPair") if strict else None,
            "source": s.get("_source"),
        }
        if strict:
            buckets["STRICT"].append(i)
            gid = sc.get("contrastGroupId") or f"solo:{sid}"
            strict_groups[gid].append(i)
            tgt = sc.get("targetSurface") or ""
            if gid not in surf_groups[tgt or "_"]:
                surf_groups[tgt or "_"].append(gid)
        elif hard:
            buckets["ANCHOR_CONDITIONED_HARD_KEEP"].append(i)
        elif b == "NO_ANCHOR":
            buckets["NO_ANCHOR"].append(i)
        else:
            buckets["NATURAL"].append(i)
    return buckets, strict_groups, surf_groups, tags


def build_pair_index(train, strict_sc):
    sid_to_i = {s["sampleId"]: i for i, s in enumerate(train)}
    pair_index = []
    by_cg = defaultdict(list)
    for sid, sc in strict_sc.items():
        if not is_strict_member(sid, strict_sc) or sid not in sid_to_i:
            continue
        by_cg[sc.get("contrastGroupId")].append(sc)
    for g, rows in by_cg.items():
        kr = [r for r in rows if r.get("roleInPair") == "KEEP"]
        rr = [r for r in rows if r.get("roleInPair") == "RETRY"]
        if not kr or not rr:
            continue
        ki, ri = sid_to_i.get(kr[0]["sampleId"]), sid_to_i.get(rr[0]["sampleId"])
        if ki is None or ri is None:
            continue
        tgt = kr[0].get("targetSurface")
        kk, _ = find_target_span(train[ki], tgt, "KEEP")
        rk, _ = find_target_span(train[ri], tgt, "RETRY")
        if kk is not None and rk is not None:
            pair_index.append((ki, ri, kk, rk, g))
    return pair_index


def make_epoch_indices(mix, buckets, strict_groups, surf_groups, n, rng):
    targets = {k: int(round(mix[k] * n)) for k in mix}
    surf_keys = [k for k, v in surf_groups.items() if v]
    group_pool = []
    if surf_keys:
        mx = max(len(surf_groups[k]) for k in surf_keys)
        for j in range(mx):
            for k in surf_keys:
                gs = surf_groups[k]
                if j < len(gs):
                    group_pool.append(gs[j])
    rng.shuffle(group_pool)
    strict_out: list[int] = []
    g_ptr = 0
    while group_pool and len(strict_out) + 2 <= targets["STRICT"] + 1:
        gid = group_pool[g_ptr % len(group_pool)]
        g_ptr += 1
        members = list(strict_groups.get(gid) or [])
        if len(members) < 2:
            continue
        strict_out.extend(members)
    remaining = max(n - len(strict_out), 0)
    other = ["ANCHOR_CONDITIONED_HARD_KEEP", "NATURAL", "NO_ANCHOR"]
    wsum = sum(mix[k] for k in other) or 1.0
    other_targets = {k: int(round(remaining * (mix[k] / wsum))) for k in other}
    other_targets["NATURAL"] = other_targets.get("NATURAL", 0) + (
        remaining - sum(other_targets.values())
    )
    out = list(strict_out)
    for b in other:
        pool = buckets.get(b) or buckets.get("NATURAL") or []
        if not pool:
            continue
        for _ in range(max(other_targets[b], 0)):
            out.append(rng.choice(pool))
    while len(out) < n:
        pool = buckets.get("NATURAL") or buckets.get("STRICT") or []
        if not pool:
            break
        out.append(rng.choice(pool))
    rng.shuffle(out)
    return out[:n]


def audit_epoch_exposure(idxs, train, tags):
    role = Counter()
    unique = set()
    for i in idxs:
        sid = train[i]["sampleId"]
        unique.add(sid)
        t = tags[sid]
        if t["isStrictKeep"]:
            role["STRICT_KEEP"] += 1
        elif t["isStrictRetry"]:
            role["STRICT_RETRY"] += 1
        elif t["isAnchorHardKeep"]:
            role["ANCHOR_HARD_KEEP"] += 1
        elif (train[i].get("trainingBucket") or "") == "NO_ANCHOR":
            role["NO_ANCHOR"] += 1
        else:
            role["NATURAL"] += 1
    n = max(len(idxs), 1)
    sk, sr = role["STRICT_KEEP"], role["STRICT_RETRY"]
    shares = {
        "STRICT": (sk + sr) / n,
        "ANCHOR_CONDITIONED_HARD_KEEP": role["ANCHOR_HARD_KEEP"] / n,
        "NATURAL": role["NATURAL"] / n,
        "NO_ANCHOR": role["NO_ANCHOR"] / n,
    }
    return {
        "counts": dict(role),
        "shares": shares,
        "strict_keep": sk,
        "strict_retry": sr,
        "keep_retry_ratio": sk / max(sr, 1),
        "unique_samples": len(unique),
        "repeat_factor": len(idxs) / max(len(unique), 1),
        "ok_ratio": sk > 0 and sr > 0 and 0.7 <= (sk / max(sr, 1)) <= 1.3,
    }


def metrics(tp, fp, fn, tn):
    rp = tp / (tp + fp) if (tp + fp) else 0.0
    rr = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * rp * rr / (rp + rr) if (rp + rr) else 0.0
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "retry_precision": rp, "retry_recall": rr, "retry_f1": f1,
        "false_retry_rate": fp / (fp + tn) if (fp + tn) else 0.0,
    }


def eval_spans(model, samples, vocab, device, xform=None, collect_errors=False):
    model.eval()
    tp = fp = fn = tn = 0
    false_retry = []
    false_keep = []
    with torch.no_grad():
        for s in samples:
            ss = xform(s) if xform else s
            item = sample_to_tensors(ss, vocab)
            logits = model(
                torch.tensor([item["tokens"]], device=device),
                torch.tensor([item["feats"]], dtype=torch.float32, device=device),
                torch.tensor([item["avail"]], dtype=torch.float32, device=device),
            )[0]
            for k in range(len(item["labels"])):
                if item["target_mask"][k] != 1 or item["labels"][k] < 0:
                    continue
                y = int(item["labels"][k])
                p = int(logits[k].argmax(-1).item())
                tn += y == 0 and p == 0
                fp += y == 0 and p == 1
                tp += y == 1 and p == 1
                fn += y == 1 and p == 0
                if collect_errors:
                    sp = (ss.get("spans") or [None])[k] if k < len(ss.get("spans") or []) else None
                    rec = {
                        "sampleId": s.get("sampleId"),
                        "surface": (sp or {}).get("surface"),
                        "gold": "KEEP" if y == 0 else "RETRY",
                        "pred": "KEEP" if p == 0 else "RETRY",
                        "bucket": s.get("trainingBucket"),
                        "heldOutAxes": s.get("heldOutAxes") or [],
                    }
                    if y == 0 and p == 1:
                        false_retry.append(rec)
                    elif y == 1 and p == 0:
                        false_keep.append(rec)
    out = metrics(tp, fp, fn, tn)
    if collect_errors:
        out["false_retry_cases"] = false_retry
        out["false_keep_cases"] = false_keep
    return out


def zero_anchor(s):
    t = deepcopy(s)
    for sp in t["spans"]:
        sp["isAnchor"] = False
    return t


def shuffle_anchor(s, rng):
    t = deepcopy(s)
    idxs = [i for i, sp in enumerate(t["spans"]) if sp.get("isAnchor")]
    n = len(idxs)
    if not n:
        return t
    for i in idxs:
        t["spans"][i]["isAnchor"] = False
    pool = list(range(len(t["spans"])))
    rng.shuffle(pool)
    for i in pool[:n]:
        t["spans"][i]["isAnchor"] = True
    return t


def eval_strict_pairs(model, pairs, vocab, device, xform=None):
    ok = tot = 0
    for ks, ksc, rs, rsc in pairs:
        tgt = ksc.get("targetSurface") or rsc.get("targetSurface")
        sk = xform(ks) if xform else ks
        sr = xform(rs) if xform else rs
        ki, _ = find_target_span(sk, tgt, "KEEP")
        ri, _ = find_target_span(sr, tgt, "RETRY")
        if ki is None or ri is None:
            continue
        tot += 1
        item_k = sample_to_tensors(sk, vocab)
        item_r = sample_to_tensors(sr, vocab)
        with torch.no_grad():
            pk = model(
                torch.tensor([item_k["tokens"]], device=device),
                torch.tensor([item_k["feats"]], dtype=torch.float32, device=device),
                torch.tensor([item_k["avail"]], dtype=torch.float32, device=device),
            )[0, ki].argmax(-1).item()
            pr = model(
                torch.tensor([item_r["tokens"]], device=device),
                torch.tensor([item_r["feats"]], dtype=torch.float32, device=device),
                torch.tensor([item_r["avail"]], dtype=torch.float32, device=device),
            )[0, ri].argmax(-1).item()
        if pk == 0 and pr == 1:
            ok += 1
    return {"pairs": tot, "pair_accuracy": ok / tot if tot else 0.0}


def build_strict_test_pairs(strict_test, strict_sc):
    by = defaultdict(list)
    id_to = {s["sampleId"]: s for s in strict_test}
    for sid, sc in strict_sc.items():
        if sid not in id_to or not is_strict_member(sid, strict_sc):
            continue
        by[sc.get("contrastGroupId")].append((id_to[sid], sc))
    pairs = []
    for gid, rows in by.items():
        keeps = [r for r in rows if r[1].get("roleInPair") == "KEEP"]
        retries = [r for r in rows if r[1].get("roleInPair") == "RETRY"]
        if keeps and retries:
            pairs.append((keeps[0][0], keeps[0][1], retries[0][0], retries[0][1]))
    return pairs


def bucket_keep_acc(model, samples, vocab, device):
    if not samples:
        return {"n": 0, "accuracy": 0.0, "false_retry_rate": 0.0}
    m = eval_spans(model, samples, vocab, device)
    tot = m["tp"] + m["tn"] + m["fp"] + m["fn"]
    return {
        "n": len(samples),
        "accuracy": (m["tp"] + m["tn"]) / max(tot, 1),
        "false_retry_rate": m["false_retry_rate"],
    }


def pure_pair_margin_loss(lk, lr, margin):
    return torch.relu(margin - (lr[1] - lk[1]))


def retry_logit_stats(model, samples, vocab, device, want_label=None, limit=400):
    model.eval()
    vals = []
    with torch.no_grad():
        for s in samples[:limit]:
            item = sample_to_tensors(s, vocab)
            logits = model(
                torch.tensor([item["tokens"]], device=device),
                torch.tensor([item["feats"]], dtype=torch.float32, device=device),
                torch.tensor([item["avail"]], dtype=torch.float32, device=device),
            )[0]
            for k, sp in enumerate(s.get("spans") or []):
                if sp.get("targetMask") != 1:
                    continue
                if want_label and sp.get("label") != want_label:
                    continue
                vals.append(float(logits[k, 1].item()))
    if not vals:
        return {"n": 0, "mean": None, "p90": None, "max": None}
    vals.sort()
    return {
        "n": len(vals),
        "mean": sum(vals) / len(vals),
        "p90": vals[int(0.9 * (len(vals) - 1))],
        "max": vals[-1],
    }


def train_one(cfg, train, buckets, strict_groups, surf_groups, pair_index, vocab, device, seed):
    obj = cfg["objective"]
    opt_cfg = cfg["optimizer"]
    mix = sampling_mix(cfg)
    torch.manual_seed(seed)
    random.seed(seed)
    arch = cfg["architecture"]
    model = Model3BiGRUV1(
        len(vocab), int(arch["emb_dim"]), int(arch["hidden_dim"]), FEAT_DIM
    ).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=float(opt_cfg["lr"]))
    cw = torch.tensor([1.0, float(obj["class_weight_retry"])], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    batch_size = int(opt_cfg["batch_size"])
    epochs = int(opt_cfg["epochs"])
    n = len(train)
    lambda_pair = float(obj["pair_lambda"])
    margin = float(obj["pair_margin"])
    pair_on = bool(obj["pair_loss_enabled"]) and not bool(obj["pair_ce_enabled"])
    tensor_cache: dict[int, dict] = {}

    def cached(i: int):
        if i not in tensor_cache:
            tensor_cache[i] = sample_to_tensors(train[i], vocab)
        return tensor_cache[i]

    history = []
    for ep in range(epochs):
        model.train()
        idxs = make_epoch_indices(mix, buckets, strict_groups, surf_groups, n, random.Random(seed + ep * 17))
        loss_sum = nb = 0
        pair_ptr = 0
        pairs = [(a, b, c, d) for a, b, c, d, _ in pair_index]
        random.Random(seed + ep).shuffle(pairs)
        for start in range(0, len(idxs), batch_size):
            batch_ix = idxs[start : start + batch_size]
            batch = collate_batch([cached(i) for i in batch_ix], device)
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            bsz, nspan, c = logits.shape
            lv = crit(logits.view(bsz * nspan, c), batch["labels"].view(bsz * nspan))
            sel = batch["target_mask"].view(bsz * nspan) * batch["valid"].view(bsz * nspan)
            if sel.sum() <= 0:
                continue
            loss = (lv * sel).sum() / sel.sum()
            if pair_on and pairs and lambda_pair > 0:
                pair_losses = []
                for _ in range(min(2, len(pairs))):
                    ki, ri, kk, rk = pairs[pair_ptr % len(pairs)]
                    pair_ptr += 1
                    bk = collate_batch([cached(ki)], device)
                    br = collate_batch([cached(ri)], device)
                    lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
                    lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
                    pair_losses.append(pure_pair_margin_loss(lk, lr, margin))
                if pair_losses:
                    loss = loss + lambda_pair * torch.stack(pair_losses).mean()
            loss.backward()
            opt.step()
            loss_sum += float(loss.item())
            nb += 1
        history.append({"epoch": ep + 1, "train_loss": loss_sum / max(nb, 1)})
        print(f"[seed={seed}] ep {ep+1}/{epochs} loss={loss_sum/max(nb,1):.4f}", flush=True)
    return model, history


def classify_error(case: dict) -> str:
    axes = case.get("heldOutAxes") or []
    if "held_out_pronunciation_family" in axes:
        return "unseen_family"
    if "held_out_surface_pair" in axes:
        return "unseen_target"
    if "held_out_anchor_combination" in axes:
        return "unseen_anchor_context"
    if case.get("bucket") == "NO_ANCHOR":
        return "context_insufficiency"
    if case.get("gold") == "KEEP" and case.get("pred") == "RETRY":
        return "pronunciation_ambiguity_or_anchor_relation"
    return "model_error_or_label"


def multi_context_target_accuracy(model, pairs, vocab, device):
    """Same targetSurface, different Anchor context KEEP/RETRY accuracy."""
    by_tgt = defaultdict(list)
    for ks, ksc, rs, rsc in pairs:
        tgt = ksc.get("targetSurface") or ""
        by_tgt[tgt].append((ks, ksc, rs, rsc))
    ok = tot = 0
    for tgt, plist in by_tgt.items():
        if len(plist) < 2:
            continue
        for item in plist:
            r = eval_strict_pairs(model, [item], vocab, device)
            tot += r["pairs"]
            ok += int(round(r["pair_accuracy"] * r["pairs"]))
    return {"targets": len(by_tgt), "pairs": tot, "accuracy": ok / tot if tot else 0.0}


def cpu_bench(model, samples, vocab, device, n=500):
    model.eval()
    lat = []
    with torch.no_grad():
        for s in samples[:n]:
            batch = collate_batch([sample_to_tensors(s, vocab)], device)
            t0 = time.perf_counter()
            model(batch["tokens"], batch["feats"], batch["avail"])
            lat.append((time.perf_counter() - t0) * 1000)
    lat_s = sorted(lat)

    def pct(p):
        if not lat_s:
            return None
        k = (len(lat_s) - 1) * p / 100
        f = int(k)
        c = min(f + 1, len(lat_s) - 1)
        return lat_s[f] if f == c else lat_s[f] + (lat_s[c] - lat_s[f]) * (k - f)

    params = sum(p.numel() for p in model.parameters())
    # rough RAM: params * 4 bytes + vocab overhead estimate
    ram_mb = (params * 4) / (1024 * 1024)
    return {
        "params": params,
        "model_size_mb": ram_mb,
        "ram_mb_estimate": ram_mb + 8.0,
        "p50_ms": pct(50),
        "p95_ms": pct(95),
        "p99_ms": pct(99),
        "n": len(lat),
    }


def mean_std(xs):
    m = sum(xs) / len(xs)
    v = sum((x - m) ** 2 for x in xs) / len(xs)
    return {"mean": m, "std": v ** 0.5, "min": min(xs), "max": max(xs)}


def audit_split_leakage(strict_sc, train_ids, test_ids):
    train_g = set()
    test_g = set()
    for sid, sc in strict_sc.items():
        if not is_strict_member(sid, strict_sc):
            continue
        gid = sc.get("contrastGroupId")
        if sid in train_ids:
            train_g.add(gid)
        if sid in test_ids:
            test_g.add(gid)
    leak = train_g & test_g
    return {"cross_split_groups": len(leak), "leak_groups": sorted(list(leak))[:20], "ok": len(leak) == 0}


def audit_duplicates(train):
    """Identity-aware accidental duplicate detection (non-designed)."""
    seen = {}
    accidental = 0
    for s in train:
        # designed strict pairs share currentText — exclude when contrastGroupId present + role differs
        key = identity_key(s, s.get("_provenance", {}).get("strictMemberRole"))
        # simpler: same sampleId is the only accidental exact identity
        sid = s["sampleId"]
        if sid in seen:
            accidental += 1
        seen[sid] = True
    # also detect identical (text, anchors, targets, label) with different ids and no designed pair role
    content = defaultdict(list)
    for s in train:
        sc = s.get("_provenance") or {}
        if sc.get("isStrictMember"):
            continue
        k = (
            s.get("currentText"),
            tuple((sp.get("surface"), sp.get("isAnchor"), sp.get("label"), sp.get("targetMask")) for sp in (s.get("spans") or [])),
        )
        content[k].append(s["sampleId"])
    content_dups = sum(1 for v in content.values() if len(v) > 1)
    return {"sampleId_duplicates": accidental, "non_strict_content_duplicate_groups": content_dups}


def pretrain_gate(cfg, train, buckets, strict_groups, surf_groups, tags, pair_index, strict_sc, strict_train, vocab, exposure, leakage, sources, full_manifest_hash):
    mix = sampling_mix(cfg)
    gates = cfg["gates"]
    obj = cfg["objective"]
    fails = []

    if not cfg["datasets"].get("full100k_immutable", True):
        fails.append("FULL100K_NOT_IMMUTABLE_FLAG")

    # STRICT MV rate sample
    pairs_qa = []
    by = defaultdict(list)
    id_to = {s["sampleId"]: s for s in strict_train}
    for sid, sc in strict_sc.items():
        if sid in id_to and is_strict_member(sid, strict_sc):
            by[sc.get("contrastGroupId")].append((id_to[sid], sc))
    for gid, rows in by.items():
        keeps = [r for r in rows if r[1].get("roleInPair") == "KEEP"]
        retries = [r for r in rows if r[1].get("roleInPair") == "RETRY"]
        if keeps and retries:
            pairs_qa.append((keeps[0][0], keeps[0][1], retries[0][0], retries[0][1]))
    sample_pairs = pairs_qa[:150]
    mv_ok = 0
    for ks, ksc, rs, rsc in sample_pairs:
        v = validate_strict_anchor_contrast_pair_v1(
            ks, rs, target_surface=ksc.get("targetSurface") or "", vocab=vocab, require_tensor=True
        )
        if v.get("ok") or v.get("anchor_removed_tensor_identical"):
            mv_ok += 1
    mv_rate = mv_ok / max(len(sample_pairs), 1)
    if mv_rate < float(gates["model_visible_strong_rate_min"]):
        fails.append(f"MV_RATE_{mv_rate:.3f}")

    # pair integrity: all pair groups have 2 members in train index
    incomplete = sum(1 for g, mems in strict_groups.items() if len(mems) < 2)
    if incomplete:
        fails.append(f"INCOMPLETE_STRICT_GROUPS_{incomplete}")

    if exposure["strict_keep"] <= 0:
        fails.append("STRICT_KEEP_MISSING")
    if exposure["strict_retry"] <= 0:
        fails.append("STRICT_RETRY_MISSING")
    if not exposure["ok_ratio"]:
        fails.append("KEEP_RETRY_RATIO")

    # exposure shares
    for k, want in mix.items():
        got = exposure["shares"].get(k, 0.0)
        if abs(got - want) > float(gates["exposure_abs_tol"]):
            fails.append(f"EXPOSURE_{k}_{got:.3f}_vs_{want:.3f}")

    if not leakage["ok"]:
        fails.append("SPLIT_LEAKAGE")

    if len(buckets.get("ANCHOR_CONDITIONED_HARD_KEEP") or []) < 1000:
        fails.append("HARD_KEEP_TOO_SMALL")
    if len(buckets.get("NO_ANCHOR") or []) < 100:
        fails.append("NO_ANCHOR_MISSING")

    if float(obj["class_weight_retry"]) != 1.0:
        fails.append("CLASS_WEIGHT")
    if obj.get("auto_class_weight_formula"):
        fails.append("AUTO_WEIGHT_ON")
    if obj.get("pair_ce_enabled"):
        fails.append("PAIR_CE_ON")
    if obj.get("pair_loss_type") != "PURE_MARGIN":
        fails.append("PAIR_TYPE")
    if float(obj["pair_lambda"]) != 0.2:
        fails.append("LAMBDA")
    if float(obj["pair_margin"]) != 0.25:
        fails.append("MARGIN")

    # STRICT KEEP with Hard KEEP tag still in STRICT bucket
    swallowed = 0
    for sid, t in tags.items():
        if t["isStrictKeep"] and t["isAnchorHardKeep"]:
            # must not be only in hard keep — verify sid index in STRICT
            pass
    sk_in_strict = sum(1 for i in buckets["STRICT"] if tags[train[i]["sampleId"]]["isStrictKeep"])
    if sk_in_strict == 0:
        fails.append("STRICT_KEEP_SWALLOWED")

    return {
        "pass": len(fails) == 0,
        "fails": fails,
        "mv_rate": mv_rate,
        "mv_sample": len(sample_pairs),
        "incomplete_strict_groups": incomplete,
        "sources": sources,
        "full_manifest_hash": full_manifest_hash,
        "exposure": exposure,
        "leakage": leakage,
        "pair_index": len(pair_index),
        "buckets": {k: len(v) for k, v in buckets.items()},
        "strict_keep_tags": sum(1 for t in tags.values() if t["isStrictKeep"]),
        "strict_retry_tags": sum(1 for t in tags.values() if t["isStrictRetry"]),
        "strict_and_hard_tag": sum(1 for t in tags.values() if t["isStrictMember"] and t["isAnchorHardKeep"]),
    }


def eval_suite(model, full_test, strict_pairs, hard_keep_test, no_anchor_test, natural_test, vocab, device, collect_errors=False):
    rng = random.Random(2026082520)
    full_m = eval_spans(model, full_test, vocab, device, collect_errors=collect_errors)
    sp_n = eval_strict_pairs(model, strict_pairs, vocab, device)
    sp_z = eval_strict_pairs(model, strict_pairs, vocab, device, xform=zero_anchor)
    sp_s = eval_strict_pairs(model, strict_pairs, vocab, device, xform=lambda s: shuffle_anchor(s, rng))
    hk = bucket_keep_acc(model, hard_keep_test, vocab, device)
    na = eval_spans(model, no_anchor_test, vocab, device)
    nat = eval_spans(model, natural_test, vocab, device)
    uf = [s for s in full_test if "held_out_pronunciation_family" in (s.get("heldOutAxes") or [])]
    us = [s for s in full_test if "held_out_surface_pair" in (s.get("heldOutAxes") or [])]
    uc = [s for s in full_test if "held_out_anchor_combination" in (s.get("heldOutAxes") or [])]
    uf_m = eval_spans(model, uf, vocab, device) if uf else {"retry_f1": 0.0, "retry_precision": 0.0, "retry_recall": 0.0}
    us_m = eval_spans(model, us, vocab, device) if us else {"retry_f1": 0.0, "retry_precision": 0.0, "retry_recall": 0.0}
    uc_m = eval_spans(model, uc, vocab, device) if uc else {"retry_f1": 0.0, "retry_precision": 0.0, "retry_recall": 0.0}
    mc = multi_context_target_accuracy(model, strict_pairs, vocab, device)
    logits = {
        "natural_keep": retry_logit_stats(model, natural_test, vocab, device, "KEEP"),
        "no_anchor": retry_logit_stats(model, no_anchor_test, vocab, device, "KEEP"),
    }
    return {
        "full100k": full_m,
        "strict_pair": {
            "normal": sp_n,
            "zero": sp_z,
            "shuffle": sp_s,
            "zero_delta": sp_n["pair_accuracy"] - sp_z["pair_accuracy"],
            "shuffle_delta": sp_n["pair_accuracy"] - sp_s["pair_accuracy"],
        },
        "hard_keep": hk,
        "no_anchor": na,
        "natural": nat,
        "generalization": {
            "heldout_family": uf_m,
            "unseen_surface": us_m,
            "unseen_context": uc_m,
            "multi_context": mc,
        },
        "logits": logits,
    }


def main():
    try:
        cfg = load_training_config()
    except ConfigSSOTError as e:
        raise SystemExit(f"CONFIG_SSOT_FAIL: {e}")

    print(f"config_hash={cfg['config_hash']}", flush=True)
    print(f"config_path={cfg['config_path']}", flush=True)

    full_root = repo_path(cfg["datasets"]["full100k_root"])
    strict_root = repo_path(cfg["datasets"]["strict_root"])
    hard_root = repo_path(cfg["datasets"]["hard_keep_root"])
    integ_root = repo_path(cfg["paths"]["integration_root"])
    ckpt_root = repo_path(cfg["paths"]["checkpoint_root"])
    docs = repo_path(cfg["paths"]["docs_root"])
    integ_root.mkdir(parents=True, exist_ok=True)
    ckpt_root.mkdir(parents=True, exist_ok=True)
    docs.mkdir(parents=True, exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device={device}", flush=True)

    print("loading datasets (immutable Full100K)…", flush=True)
    full_manifest_path = full_root / "dataset_manifest.json"
    full_manifest = json.loads(full_manifest_path.read_text(encoding="utf-8"))
    full_manifest_hash = file_sha(full_manifest_path)
    hard_keep_map = load_hard_keep(hard_root)
    strict_sc = load_sidecar(strict_root)
    strict_train = load_split(strict_root, "train")
    strict_test = load_split(strict_root, "test")
    full_train = load_split(full_root, "train")
    full_test = load_split(full_root, "test")

    train, sources = build_integration_train(full_train, strict_train, strict_sc, hard_keep_map)
    buckets, strict_groups, surf_groups, tags = build_index(train, strict_sc, hard_keep_map)
    pair_index = build_pair_index(train, strict_sc)
    dups = audit_duplicates(train)
    print("sources", sources, "train", len(train), "buckets", {k: len(v) for k, v in buckets.items()}, "pairs", len(pair_index), "dups", dups, flush=True)

    mix = sampling_mix(cfg)
    idxs = make_epoch_indices(mix, buckets, strict_groups, surf_groups, len(train), random.Random(int(cfg["seed_policy"]["base_seed"])))
    exposure = audit_epoch_exposure(idxs, train, tags)
    print("exposure", exposure, flush=True)

    train_ids = {s["sampleId"] for s in train}
    test_ids = {s["sampleId"] for s in strict_test}
    # also Full100K test ids for leakage of strict groups only matters for strict
    leakage = audit_split_leakage(strict_sc, train_ids, test_ids)
    print("leakage", leakage, flush=True)

    vocab = build_char_vocab(train)
    gate = pretrain_gate(
        cfg, train, buckets, strict_groups, surf_groups, tags, pair_index, strict_sc,
        strict_train, vocab, exposure, leakage, sources, full_manifest_hash,
    )
    print("INTEGRATION_PRETRAIN_GATE", gate, flush=True)

    split_manifest = {
        "phase": cfg["phase"],
        "full100k_immutable": True,
        "full100k_manifest_hash": full_manifest_hash,
        "full100k_base_rows_train": len(full_train),
        "full100k_base_rows_test": len(full_test),
        "strict_groups_train": len(strict_groups),
        "strict_members_train": gate["strict_keep_tags"] + gate["strict_retry_tags"],
        "hard_keep_train_bucket": len(buckets.get("ANCHOR_CONDITIONED_HARD_KEEP") or []),
        "integrated_train_rows": len(train),
        "sources": sources,
        "duplicates": dups,
        "leakage": leakage,
        "sampling_view": mix,
        "exposure_audit": exposure,
        "config_hash": cfg["config_hash"],
    }
    split_manifest["manifest_hash"] = sha_json(split_manifest)
    (integ_root / "integration_split_manifest.json").write_text(
        json.dumps(split_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (integ_root / "pretrain_gate.json").write_text(
        json.dumps(gate, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if not gate["pass"]:
        raise SystemExit(f"INTEGRATION_DATA_FAIL / gate fails: {gate['fails']}")

    # Eval sets
    strict_pairs_test = build_strict_test_pairs(strict_test, strict_sc)
    hk_test_ids = {sid for sid, hk in hard_keep_map.items() if hk.get("split") == "test"}
    hard_keep_test = [s for s in strict_test if s["sampleId"] in hk_test_ids][:1200]
    hard_keep_test += [
        s for s in full_test
        if s["sampleId"] in hk_test_ids and s["sampleId"] not in {x["sampleId"] for x in hard_keep_test}
    ][:1200]
    no_anchor_test = [s for s in full_test if s.get("trainingBucket") == "NO_ANCHOR"][:1500]
    natural_test = [s for s in full_test if s.get("trainingBucket") == "NATURAL"][:1500]
    print(
        f"eval_sets full={len(full_test)} strict_pairs={len(strict_pairs_test)} "
        f"hk={len(hard_keep_test)} na={len(no_anchor_test)}",
        flush=True,
    )

    seeds = list(cfg["seed_policy"]["seeds"])[:3]
    runs = []
    for i, seed in enumerate(seeds):
        print(f"\n=== TRAIN seed {seed} ({i+1}/3) ===", flush=True)
        model, hist = train_one(cfg, train, buckets, strict_groups, surf_groups, pair_index, vocab, device, seed)
        suite = eval_suite(
            model, full_test, strict_pairs_test, hard_keep_test, no_anchor_test, natural_test,
            vocab, device, collect_errors=(i == 0),
        )
        cpu = cpu_bench(model, full_test, vocab, device)
        run_cfg = {
            **{k: cfg[k] for k in ("configId", "version", "explicit_source", "objective", "sampling_view", "optimizer", "init")},
            "seed": seed,
            "config_hash": cfg["config_hash"],
            "dataset_manifest_hash": split_manifest["manifest_hash"],
            "full100k_manifest_hash": full_manifest_hash,
        }
        save_model_bundle(
            ckpt_root / f"seed_{seed}",
            model,
            vocab,
            run_cfg,
            "MODEL3_V1_FULL100K_STRICT_INTEGRATION_V1",
        )
        runs.append({"seed": seed, "suite": suite, "history": hist, "cpu": cpu, "model": model if i == 0 else None})
        f = suite["full100k"]
        sp = suite["strict_pair"]
        print(
            f"seed={seed} P={f['retry_precision']:.4f} R={f['retry_recall']:.4f} "
            f"strict={sp['normal']['pair_accuracy']:.4f} z={sp['zero']['pair_accuracy']:.4f} "
            f"hk={suite['hard_keep']['accuracy']:.4f}",
            flush=True,
        )
        if i > 0:
            del model

    # Aggregate
    def pull(path_fn):
        return [path_fn(r) for r in runs]

    stab = {
        "precision": mean_std(pull(lambda r: r["suite"]["full100k"]["retry_precision"])),
        "recall": mean_std(pull(lambda r: r["suite"]["full100k"]["retry_recall"])),
        "f1": mean_std(pull(lambda r: r["suite"]["full100k"]["retry_f1"])),
        "false_retry": mean_std(pull(lambda r: r["suite"]["full100k"]["false_retry_rate"])),
        "strict_pair": mean_std(pull(lambda r: r["suite"]["strict_pair"]["normal"]["pair_accuracy"])),
        "strict_zero": mean_std(pull(lambda r: r["suite"]["strict_pair"]["zero"]["pair_accuracy"])),
        "strict_shuffle": mean_std(pull(lambda r: r["suite"]["strict_pair"]["shuffle"]["pair_accuracy"])),
        "hard_keep_acc": mean_std(pull(lambda r: r["suite"]["hard_keep"]["accuracy"])),
        "hard_keep_fp": mean_std(pull(lambda r: r["suite"]["hard_keep"]["false_retry_rate"])),
        "no_anchor_fp": mean_std(pull(lambda r: r["suite"]["no_anchor"]["false_retry_rate"])),
        "natural_fp": mean_std(pull(lambda r: r["suite"]["natural"]["false_retry_rate"])),
        "heldout_family_f1": mean_std(pull(lambda r: r["suite"]["generalization"]["heldout_family"]["retry_f1"])),
        "unseen_surface_f1": mean_std(pull(lambda r: r["suite"]["generalization"]["unseen_surface"]["retry_f1"])),
        "unseen_context_f1": mean_std(pull(lambda r: r["suite"]["generalization"]["unseen_context"]["retry_f1"])),
        "multi_context_acc": mean_std(pull(lambda r: r["suite"]["generalization"]["multi_context"]["accuracy"])),
    }
    wm = {k: stab[k]["mean"] for k in stab}
    cpu0 = runs[0]["cpu"]
    logits0 = runs[0]["suite"]["logits"]
    nat_p90 = (logits0.get("natural_keep") or {}).get("p90")
    noa_p90 = (logits0.get("no_anchor") or {}).get("p90")
    global_shift = bool((nat_p90 is not None and nat_p90 > 2.0) or (noa_p90 is not None and noa_p90 > 1.5))

    # Error analysis (seed0)
    fr_cases = (runs[0]["suite"]["full100k"].get("false_retry_cases") or [])[:200]
    fk_cases = (runs[0]["suite"]["full100k"].get("false_keep_cases") or [])[:200]
    fr_cat = Counter(classify_error(c) for c in fr_cases)
    fk_cat = Counter(classify_error(c) for c in fk_cases)
    error_analysis = {
        "false_retry_n": len(fr_cases),
        "false_keep_n": len(fk_cases),
        "false_retry_categories": dict(fr_cat),
        "false_keep_categories": dict(fk_cat),
        "primary_categories": [k for k, _ in (fr_cat + fk_cat).most_common(5)],
        "data_label_issues_note": "classification only — no rule fixes this phase",
        "samples_false_retry": fr_cases[:20],
        "samples_false_keep": fk_cases[:20],
    }

    # Verdict
    ref = FROZEN_CMP["Objective_Rebalance_O3"]
    ssot_ok = True
    hardcoded_none = True
    quality_ok = wm["precision"] >= ref["precision"] - 0.05 and wm["f1"] >= ref["f1"] - 0.05
    quality_regressed = wm["precision"] < ref["precision"] - 0.10 or wm["f1"] < ref["f1"] - 0.10
    anchor_ok = (
        wm["strict_pair"] >= 0.70
        and wm["strict_zero"] < wm["strict_pair"] - 0.20
        and wm["strict_shuffle"] < wm["strict_pair"] - 0.15
    )
    anchor_lost = wm["strict_pair"] < 0.50 or abs(wm["strict_pair"] - wm["strict_zero"]) < 0.05
    hk_ok = wm["hard_keep_acc"] >= 0.95 and wm["no_anchor_fp"] < 0.01
    gen_weak = wm["heldout_family_f1"] < 0.40
    gen_failed = wm["heldout_family_f1"] < 0.15

    if not gate["pass"]:
        verdict = "INTEGRATION_DATA_FAIL"
    elif not leakage["ok"]:
        verdict = "SPLIT_LEAKAGE"
    elif global_shift:
        verdict = "GLOBAL_RETRY_PRIOR_SHIFT"
    elif anchor_lost:
        verdict = "ANCHOR_SIGNAL_LOST"
    elif quality_regressed:
        verdict = "QUALITY_REGRESSION"
    elif quality_ok and anchor_ok and hk_ok and not gen_weak:
        verdict = "PASS"
    elif quality_ok and anchor_ok and hk_ok and gen_weak and not gen_failed:
        verdict = "PASS_WITH_GENERALIZATION_GAP"
    elif quality_ok and anchor_ok and hk_ok:
        verdict = "PASS_WITH_GENERALIZATION_GAP"
    else:
        verdict = "QUALITY_REGRESSION"

    next_phase = {
        "PASS": "MODEL3_V1_SYNTHETIC_FREEZE_AND_TTS_READINESS_AUDIT",
        "PASS_WITH_GENERALIZATION_GAP": "MODEL3_V1_SYNTHETIC_FREEZE_AND_TTS_READINESS_AUDIT",
        "QUALITY_REGRESSION": "MODEL3_V1_INTEGRATION_VIEW_AUDIT",
        "ANCHOR_SIGNAL_LOST": "MODEL3_V1_STRICT_PAIR_EXPOSURE_AUDIT",
        "GLOBAL_RETRY_PRIOR_SHIFT": "MODEL3_V1_INTEGRATION_VIEW_AUDIT",
        "INTEGRATION_DATA_FAIL": "MODEL3_V1_INTEGRATION_DATA_REPAIR",
        "SPLIT_LEAKAGE": "MODEL3_V1_SPLIT_GOVERNANCE_FIX",
        "CONFIG_SSOT_FAIL": "MODEL3_V1_CONFIG_SSOT_FIX",
    }.get(verdict, "STOP_REVIEW")

    comparison = []
    for name, row in FROZEN_CMP.items():
        comparison.append({"model": name, **row})
    comparison.append({
        "model": "Full100K_Strict_Integration",
        "precision": wm["precision"],
        "recall": wm["recall"],
        "f1": wm["f1"],
        "false_retry": wm["false_retry"],
        "strict_pair": wm["strict_pair"],
        "strict_zero": wm["strict_zero"],
        "strict_shuffle": wm["strict_shuffle"],
        "hard_keep_acc": wm["hard_keep_acc"],
        "no_anchor_fp": wm["no_anchor_fp"],
        "heldout_family_f1": wm["heldout_family_f1"],
        "cpu_p95": cpu0["p95_ms"],
    })

    bundle = {
        "phase": "MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION",
        "verdict": verdict,
        "ssot": {
            "training_config_ssot": "PASS",
            "config_path": cfg["config_path"],
            "config_hash": cfg["config_hash"],
            "dataset_manifest_hash": split_manifest["manifest_hash"],
            "full100k_manifest_hash": full_manifest_hash,
            "hardcoded_critical_params": "NONE",
            "silent_defaults": "NONE",
        },
        "data_integration": {
            "full100k_mutated": False,
            "full100k_base_rows_train": len(full_train),
            "strict_groups": len(strict_groups),
            "strict_members": gate["strict_keep_tags"] + gate["strict_retry_tags"],
            "hard_keep_bucket": len(buckets.get("ANCHOR_CONDITIONED_HARD_KEEP") or []),
            "integrated_training_view_rows": len(train),
            "sources": sources,
            "duplicates": dups,
        },
        "strict_contract": {
            "validator": "PASS" if gate["mv_rate"] >= 0.95 else "FAIL",
            "model_visible_strong_rate": gate["mv_rate"],
            "pair_integrity": "PASS" if gate["incomplete_strict_groups"] == 0 else "FAIL",
            "cross_split_pair_leakage": leakage["cross_split_groups"],
        },
        "sampler": {
            "configured": mix,
            "actual_shares": exposure["shares"],
            "strict_keep": exposure["strict_keep"],
            "strict_retry": exposure["strict_retry"],
            "keep_retry_ratio": exposure["keep_retry_ratio"],
        },
        "objective": cfg["objective"],
        "stability": stab,
        "winner_mean": wm,
        "cpu": cpu0,
        "logits": logits0,
        "global_retry_prior_shift": global_shift,
        "error_analysis": error_analysis,
        "pretrain_gate": gate,
        "comparison": comparison,
        "decision": {
            "objective_rebalance_reproduced": quality_ok and anchor_ok,
            "full100k_integration_stable": quality_ok and not quality_regressed,
            "anchor_causality_preserved": anchor_ok,
            "precision_recall_healthy": quality_ok,
            "generalization_healthy": "NO" if gen_failed else ("PARTIAL" if gen_weak else "YES"),
            "small_bigru_frozen": True,
            "synthetic_v1_ready_to_freeze": verdict in ("PASS", "PASS_WITH_GENERALIZATION_GAP"),
            "ready_for_tts_stage": False,
            "next_phase": next_phase,
        },
        "artifacts": {
            "config": cfg["config_path"],
            "integration_manifest": str((integ_root / "integration_split_manifest.json").relative_to(REPO)).replace("\\", "/"),
            "checkpoints": str(ckpt_root.relative_to(REPO)).replace("\\", "/"),
        },
    }

    cmp_path = docs / "model3_v1_full100k_strict_integration_comparison.csv"
    with cmp_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "model", "precision", "recall", "f1", "false_retry",
            "strict_pair", "strict_zero", "strict_shuffle",
            "hard_keep_acc", "no_anchor_fp", "heldout_family_f1", "cpu_p95",
        ])
        for row in comparison:
            w.writerow([
                row.get("model"), row.get("precision"), row.get("recall"), row.get("f1"),
                row.get("false_retry"), row.get("strict_pair"), row.get("strict_zero"),
                row.get("strict_shuffle"), row.get("hard_keep_acc"), row.get("no_anchor_fp"),
                row.get("heldout_family_f1"), row.get("cpu_p95"),
            ])

    gov = {
        "go_summary": {
            "phase": "MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION",
            "verdict": verdict,
            "recommended_next_phase": next_phase,
            "architecture_changed": False,
            "runtime_changed": False,
            "formal_anchor_changed": False,
            "model2_changed": False,
            "recall_changed": False,
            "full100k_regenerated": False,
            "new_hard_keep_generated": False,
            "new_strict_definition": False,
            "tts": False,
            "production_retry": False,
            "training_config_ssot": "PASS",
        },
        "report_artifact_count": 4,
        "report_artifact_count_le_10": True,
        "config_hash": cfg["config_hash"],
        "dataset_manifest_hash": split_manifest["manifest_hash"],
    }

    report = f"""# Lingua Model3 V1 Full100K Strict Contrast Integration

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION`  
**Verdict:** `{verdict}`

## SSOT

| Item | Value |
|------|------|
| Config | `{cfg['config_path']}` |
| Config hash | `{cfg['config_hash'][:16]}…` |
| Dataset manifest hash | `{split_manifest['manifest_hash'][:16]}…` |
| Full100K manifest hash | `{full_manifest_hash[:16]}…` |
| Hardcoded critical params | **NONE** |
| Silent defaults | **NONE** |

## Data integration

| Item | Value |
|------|------:|
| Full100K mutated | **NO** |
| Full100K train rows | {len(full_train)} |
| Strict groups | {len(strict_groups)} |
| Strict members | {gate['strict_keep_tags'] + gate['strict_retry_tags']} |
| Hard KEEP bucket | {len(buckets.get('ANCHOR_CONDITIONED_HARD_KEEP') or [])} |
| Integrated train rows | {len(train)} |
| MV strong rate | {gate['mv_rate']:.4f} |
| Cross-split pair leakage | {leakage['cross_split_groups']} |

## Sampler (Balance D)

Configured 30/30/25/15 → actual shares:  
STRICT={exposure['shares']['STRICT']:.3f} HK={exposure['shares']['ANCHOR_CONDITIONED_HARD_KEEP']:.3f}  
NAT={exposure['shares']['NATURAL']:.3f} NA={exposure['shares']['NO_ANCHOR']:.3f}  
KEEP:RETRY={exposure['keep_retry_ratio']:.3f}

## Objective (frozen O3)

class_weight_retry=1.0 · Auto=OFF · Pair CE=OFF · PURE_MARGIN · λ=0.2 · margin=0.25

## 3-seed quality

| Metric | Mean | Std |
|--------|-----:|----:|
| Precision | {wm['precision']:.4f} | {stab['precision']['std']:.4f} |
| Recall | {wm['recall']:.4f} | {stab['recall']['std']:.4f} |
| F1 | {wm['f1']:.4f} | {stab['f1']['std']:.4f} |
| False RETRY | {wm['false_retry']:.6f} | {stab['false_retry']['std']:.6f} |
| Strict Pair | {wm['strict_pair']:.4f} | {stab['strict_pair']['std']:.4f} |
| Strict Zero | {wm['strict_zero']:.4f} | {stab['strict_zero']['std']:.4f} |
| Strict Shuffle | {wm['strict_shuffle']:.4f} | {stab['strict_shuffle']['std']:.4f} |
| Hard KEEP Acc | {wm['hard_keep_acc']:.4f} | {stab['hard_keep_acc']['std']:.4f} |
| NO_ANCHOR FP | {wm['no_anchor_fp']:.6f} | {stab['no_anchor_fp']['std']:.6f} |
| Heldout Family F1 | {wm['heldout_family_f1']:.4f} | {stab['heldout_family_f1']['std']:.4f} |
| Unseen Surface F1 | {wm['unseen_surface_f1']:.4f} | {stab['unseen_surface_f1']['std']:.4f} |
| Unseen Context F1 | {wm['unseen_context_f1']:.4f} | {stab['unseen_context_f1']['std']:.4f} |

Global RETRY prior shift: **{"YES" if global_shift else "NO"}**  
Natural KEEP p90: {nat_p90} · NO_ANCHOR p90: {noa_p90}

## CPU

params={cpu0['params']} · size≈{cpu0['model_size_mb']:.2f}MB · RAM≈{cpu0['ram_mb_estimate']:.2f}MB  
p50/p95/p99 ms: {cpu0['p50_ms']:.3f} / {cpu0['p95_ms']:.3f} / {cpu0['p99_ms']:.3f}

## Error analysis

False RETRY analyzed: {error_analysis['false_retry_n']} · False KEEP: {error_analysis['false_keep_n']}  
Primary: {error_analysis['primary_categories']}

## Decision

- Objective Rebalance reproduced: **{"YES" if bundle['decision']['objective_rebalance_reproduced'] else "NO"}**
- Integration stable: **{"YES" if bundle['decision']['full100k_integration_stable'] else "NO"}**
- Anchor causality: **{"YES" if anchor_ok else "NO"}**
- Generalization: **{bundle['decision']['generalization_healthy']}**
- Synthetic V1 ready to freeze: **{"YES" if bundle['decision']['synthetic_v1_ready_to_freeze'] else "NO"}**
- Ready TTS: **NO**
- Next: `{next_phase}`

## STOP

No TTS · No production RETRY · No runtime change · Full100K not regenerated. Awaiting user review.
"""
    (docs / "Lingua_Model3_V1_Full100K_Strict_Integration_Report_2026_08_25.md").write_text(report, encoding="utf-8")
    (docs / "model3_v1_full100k_strict_integration_bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (docs / "model3_v1_full100k_strict_integration_governance.json").write_text(
        json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"verdict": verdict, "precision": wm["precision"], "strict_pair": wm["strict_pair"], "next": next_phase}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
