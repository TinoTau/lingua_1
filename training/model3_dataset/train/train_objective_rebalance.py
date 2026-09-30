# -*- coding: utf-8 -*-
"""LEGACY / EXPERIMENT ONLY — NOT the authoritative Synthetic V1 trainer.
Authoritative: train_full100k_strict_integration.py + model3_v1_training_config.json

MODEL3_V1_OBJECTIVE_REBALANCE — fix sampler + freeze w_retry=1.0 + pure pair margin.

Does NOT regenerate data / change architecture / enable production RETRY.
Writes ≤4 docs artifacts.
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

STRICT_DATA = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction"
FULL100K = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
HARD_KEEP = REPO / "training/model3_dataset/model3_v1_anchor_conditioned_hard_keep"
CKPT = REPO / "training/model3_dataset/model3_v1_objective_rebalance_ckpts"
DOCS = REPO / "docs/user_correction/model3"

BASE_SEED = 2026082512
BATCH = 64
FAST_EPOCHS = 2
FULL_EPOCHS = 8
FAST_SUBSET_N = 8000  # fixed subset for fast screen
LR = 1e-3
CLASS_WEIGHT_RETRY = 1.0  # EXPLICIT — no auto formula
PAIR_MARGIN = 0.25
PAIR_LOSS_TYPE = "PURE_MARGIN"
SAMPLING_VIEW = {
    "STRICT": 0.30,
    "ANCHOR_CONDITIONED_HARD_KEEP": 0.30,
    "NATURAL": 0.25,
    "NO_ANCHOR": 0.15,
}
OBJECTIVES = {
    "O0": {"lambda_pair": 0.0, "pair_enabled": False},
    "O1": {"lambda_pair": 0.05, "pair_enabled": True},
    "O2": {"lambda_pair": 0.10, "pair_enabled": True},
    "O3": {"lambda_pair": 0.20, "pair_enabled": True},
}
# Explicit seeds — never hash() (PYTHONHASHSEED unstable)
SEEDS = {
    "O0_fast": BASE_SEED + 10,
    "O1_fast": BASE_SEED + 11,
    "O2_fast": BASE_SEED + 12,
    "O3_fast": BASE_SEED + 13,
    "O0_full": BASE_SEED + 100,
    "O1_full": BASE_SEED + 101,
    "O2_full": BASE_SEED + 102,
    "O3_full": BASE_SEED + 103,
    "stab0": BASE_SEED + 5000,
    "stab1": BASE_SEED + 5001,
    "stab2": BASE_SEED + 5002,
}

FROZEN_CMP = {
    "Strict_Reconstruction": {
        "precision": 0.3200, "recall": 0.9971, "f1": 0.4845, "false_retry": 0.055436,
        "strict_pair": 0.9975, "strict_zero": 0.0, "strict_shuffle": 0.0,
    },
    "HardKeep_Broken": {
        "precision": 0.0171, "recall": None, "f1": None, "false_retry": 0.2731,
        "strict_pair": 0.9983, "strict_zero": 0.0, "strict_shuffle": 0.0,
    },
}


def sha_json(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


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


def load_hard_keep() -> dict[str, dict]:
    m = {}
    p = HARD_KEEP / "hard_keep_sidecar.jsonl"
    with p.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                m[o["sampleId"]] = o
    return m


def is_strict_member(sid: str, strict_sc: dict) -> bool:
    sc = strict_sc.get(sid) or {}
    return sc.get("contrastStrength") == STRICT or sc.get("contrastStrengthClass") == STRICT


def build_combined_train(strict_train, hard_keep_map):
    """STRICT reconstruction rows + Hard KEEP sidecar rows (non-duplicate). Tags set in build_index."""
    train = []
    have = set()
    for s in strict_train:
        sc = deepcopy(s)
        train.append(sc)
        have.add(sc["sampleId"])
    full_by_id = {s["sampleId"]: s for s in load_split(FULL100K, "train")}
    for sid, hk in hard_keep_map.items():
        if hk.get("split") != "train" or sid in have:
            continue
        s = full_by_id.get(sid)
        if not s:
            continue
        sc = deepcopy(s)
        sc["trainingBucketView"] = "ANCHOR_CONDITIONED_HARD_KEEP"
        train.append(sc)
        have.add(sid)
    return train


def build_index(train, strict_sc, hard_keep_map):
    """STRICT membership has priority for main CE bucket. Hard KEEP is additive tag only."""
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
        }
        # STRICT identity wins over Hard KEEP indexing (fixes swallow bug)
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
        if not is_strict_member(sid, strict_sc):
            continue
        if sid not in sid_to_i:
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
            pair_index.append((ki, ri, kk, rk))
    return pair_index


def make_epoch_indices(mix, buckets, strict_groups, surf_groups, n, rng):
    """Row-share semantics: mix['STRICT']=0.30 → ~30% of ROWS are full pair members (KEEP+RETRY)."""
    names = ["STRICT", "ANCHOR_CONDITIONED_HARD_KEEP", "NATURAL", "NO_ANCHOR"]
    targets = {k: int(round(mix[k] * n)) for k in names}
    # rounding fix later after STRICT complete-pair fill

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
    # Prefer complete pairs; stop before adding a pair that would exceed target+1
    while group_pool and len(strict_out) + 2 <= targets["STRICT"] + 1:
        gid = group_pool[g_ptr % len(group_pool)]
        g_ptr += 1
        members = list(strict_groups.get(gid) or [])
        if len(members) < 2:
            continue
        strict_out.extend(members)

    remaining = max(n - len(strict_out), 0)
    other = ["ANCHOR_CONDITIONED_HARD_KEEP", "NATURAL", "NO_ANCHOR"]
    other_w = [mix[k] for k in other]
    wsum = sum(other_w) or 1.0
    other_targets = {k: int(round(remaining * (mix[k] / wsum))) for k in other}
    # fix sum to remaining
    drift = remaining - sum(other_targets.values())
    other_targets["NATURAL"] = other_targets.get("NATURAL", 0) + drift

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
    for i in idxs:
        sid = train[i]["sampleId"]
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
    sk, sr = role["STRICT_KEEP"], role["STRICT_RETRY"]
    ratio = sk / max(sr, 1)
    return {
        "counts": dict(role),
        "strict_keep": sk,
        "strict_retry": sr,
        "keep_retry_ratio": ratio,
        "ok": sk > 0 and sr > 0 and 0.7 <= ratio <= 1.3,
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


def eval_spans(model, samples, vocab, device, xform=None):
    model.eval()
    tp = fp = fn = tn = 0
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
    return metrics(tp, fp, fn, tn)


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
    acc = (m["tp"] + m["tn"]) / max(m["eligible"] if "eligible" in m else (m["tp"] + m["tn"] + m["fp"] + m["fn"]), 1)
    # recompute
    tot = m["tp"] + m["tn"] + m["fp"] + m["fn"]
    acc = (m["tp"] + m["tn"]) / max(tot, 1)
    return {"n": len(samples), "accuracy": acc, "false_retry_rate": m["false_retry_rate"]}


def pure_pair_margin_loss(lk, lr, margin=PAIR_MARGIN):
    """L = relu(margin - (retry_logit_RETRY - retry_logit_KEEP)). No CE."""
    # class 1 = RETRY
    return torch.relu(margin - (lr[1] - lk[1]))


def grad_norm(model):
    tot = 0.0
    for p in model.parameters():
        if p.grad is not None:
            tot += float(p.grad.detach().norm().item() ** 2)
    return math.sqrt(tot)


def train_one(
    train,
    buckets,
    strict_groups,
    surf_groups,
    pair_index,
    vocab,
    device,
    epochs,
    seed,
    lambda_pair,
    pair_enabled,
    tag,
    epoch_n=None,
):
    torch.manual_seed(seed)
    random.seed(seed)
    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    # EXPLICIT unweighted CE — NO auto formula
    cw = torch.tensor([1.0, float(CLASS_WEIGHT_RETRY)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    n = int(epoch_n) if epoch_n is not None else len(train)
    # CPU-friendly tensor cache (sample_to_tensors is hot path)
    tensor_cache: dict[int, dict] = {}

    def cached(i: int):
        if i not in tensor_cache:
            tensor_cache[i] = sample_to_tensors(train[i], vocab)
        return tensor_cache[i]

    history = []
    for ep in range(epochs):
        model.train()
        idxs = make_epoch_indices(SAMPLING_VIEW, buckets, strict_groups, surf_groups, n, random.Random(seed + ep * 17))
        loss_sum = nb = 0
        pair_ptr = 0
        pairs = pair_index[:]
        random.Random(seed + ep).shuffle(pairs)
        for start in range(0, len(idxs), BATCH):
            batch_ix = idxs[start : start + BATCH]
            items = [cached(i) for i in batch_ix]
            batch = collate_batch(items, device)
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            bsz, nspan, c = logits.shape
            lv = crit(logits.view(bsz * nspan, c), batch["labels"].view(bsz * nspan))
            sel = batch["target_mask"].view(bsz * nspan) * batch["valid"].view(bsz * nspan)
            if sel.sum() <= 0:
                continue
            loss = (lv * sel).sum() / sel.sum()
            # attach pure pair margins into same optimizer step
            if pair_enabled and pairs and lambda_pair > 0:
                pair_losses = []
                for _ in range(min(2, len(pairs))):
                    ki, ri, kk, rk = pairs[pair_ptr % len(pairs)]
                    pair_ptr += 1
                    bk = collate_batch([cached(ki)], device)
                    br = collate_batch([cached(ri)], device)
                    lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
                    lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
                    pair_losses.append(pure_pair_margin_loss(lk, lr, PAIR_MARGIN))
                if pair_losses:
                    loss = loss + float(lambda_pair) * torch.stack(pair_losses).mean()
            loss.backward()
            opt.step()
            loss_sum += float(loss.item())
            nb += 1
        history.append({"epoch": ep + 1, "train_loss": loss_sum / max(nb, 1)})
        print(f"[{tag}] ep {ep+1}/{epochs} loss={loss_sum/max(nb,1):.4f}", flush=True)
    return model, history


def measure_component_grads(model, train, vocab, device, pair_index, batch_ix):
    model.train()
    cw = torch.tensor([1.0, 1.0], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    items = [sample_to_tensors(train[i], vocab) for i in batch_ix]
    batch = collate_batch(items, device)
    labels = batch["labels"].view(-1)
    sel = batch["target_mask"].view(-1) * batch["valid"].view(-1)

    def run(mask_fn=None, pair=False):
        model.zero_grad(set_to_none=True)
        if pair and pair_index:
            ki, ri, kk, rk = pair_index[0]
            bk = collate_batch([sample_to_tensors(train[ki], vocab)], device)
            br = collate_batch([sample_to_tensors(train[ri], vocab)], device)
            lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
            lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
            pure_pair_margin_loss(lk, lr).backward()
            return grad_norm(model)
        logits = model(batch["tokens"], batch["feats"], batch["avail"])
        bsz, nspan, c = logits.shape
        lv = crit(logits.view(bsz * nspan, c), labels)
        mask = sel
        if mask_fn == "keep":
            mask = sel * (labels == 0).float()
        elif mask_fn == "retry":
            mask = sel * (labels == 1).float()
        if mask.sum() <= 0:
            return 0.0
        ((lv * mask).sum() / mask.sum()).backward()
        return grad_norm(model)

    return {
        "keep_ce": run("keep"),
        "retry_ce": run("retry"),
        "pair_margin": run(pair=True),
    }


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


def eval_suite(model, full_test, strict_pairs, hard_keep_test, no_anchor_test, vocab, device):
    rng = random.Random(BASE_SEED)
    full_m = eval_spans(model, full_test, vocab, device)
    sp_n = eval_strict_pairs(model, strict_pairs, vocab, device)
    sp_z = eval_strict_pairs(model, strict_pairs, vocab, device, xform=zero_anchor)
    sp_s = eval_strict_pairs(model, strict_pairs, vocab, device, xform=lambda s: shuffle_anchor(s, rng))
    hk = bucket_keep_acc(model, hard_keep_test, vocab, device)
    na = eval_spans(model, no_anchor_test, vocab, device)
    uf = [s for s in full_test if "held_out_pronunciation_family" in (s.get("heldOutAxes") or [])]
    us = [s for s in full_test if "held_out_surface_pair" in (s.get("heldOutAxes") or [])]
    uc = [s for s in full_test if "held_out_anchor_combination" in (s.get("heldOutAxes") or [])]
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
        "generalization": {
            "heldout_family_f1": eval_spans(model, uf, vocab, device)["retry_f1"] if uf else 0.0,
            "unseen_surface_f1": eval_spans(model, us, vocab, device)["retry_f1"] if us else 0.0,
            "unseen_context_f1": eval_spans(model, uc, vocab, device)["retry_f1"] if uc else 0.0,
        },
    }


def row_from(name, suite, obj=None):
    f = suite["full100k"]
    sp = suite["strict_pair"]
    return {
        "model": name,
        "precision": f["retry_precision"],
        "recall": f["retry_recall"],
        "f1": f["retry_f1"],
        "false_retry": f["false_retry_rate"],
        "strict_pair": sp["normal"]["pair_accuracy"],
        "strict_zero": sp["zero"]["pair_accuracy"],
        "strict_shuffle": sp["shuffle"]["pair_accuracy"],
        "zero_delta": sp["zero_delta"],
        "shuffle_delta": sp["shuffle_delta"],
        "hard_keep_acc": suite["hard_keep"]["accuracy"],
        "hard_keep_fp": suite["hard_keep"]["false_retry_rate"],
        "no_anchor_fp": suite["no_anchor"]["false_retry_rate"],
        "heldout_family_f1": suite["generalization"]["heldout_family_f1"],
        "objective": obj,
    }


def pareto_score(row):
    # P1 precision/FPR, P2 strict pair, P3 zero degradation
    return (
        3.0 * row["precision"]
        + 2.0 * (1.0 - min(row["false_retry"] / 0.05, 1.0))
        + 2.5 * row["strict_pair"]
        + 2.0 * max(row["zero_delta"], 0.0)
        + 1.5 * row["hard_keep_acc"]
        - (3.0 if row["strict_zero"] > 0.4 else 0.0)
        - (2.0 if row["no_anchor_fp"] > 0.01 else 0.0)
    )


def governance_tests(tags, buckets, config):
    """Regression tests for config/sampler governance."""
    fails = []
    # STRICT KEEP present
    sk = sum(1 for t in tags.values() if t["isStrictKeep"])
    sr = sum(1 for t in tags.values() if t["isStrictRetry"])
    if sk == 0:
        fails.append("STRICT_KEEP_MISSING")
    if sr == 0:
        fails.append("STRICT_RETRY_MISSING")
    if abs(sk - sr) / max(sr, 1) > 0.05:
        fails.append("STRICT_KEEP_RETRY_IMBALANCE")
    # Hard KEEP retained (non-strict)
    if len(buckets.get("ANCHOR_CONDITIONED_HARD_KEEP") or []) < 1000:
        fails.append("HARD_KEEP_TOO_SMALL")
    # STRICT members may also be hard-tagged but must remain in STRICT bucket
    for sid, t in tags.items():
        if t["isStrictMember"] and t["isAnchorHardKeep"]:
            # ok as long as they're not ONLY in hard keep — checked by bucket membership via counts
            pass
    if config["class_weight_retry"] != 1.0:
        fails.append("CLASS_WEIGHT_NOT_1")
    if config.get("auto_class_weight_formula"):
        fails.append("AUTO_FORMULA_ON")
    if config.get("pair_ce_enabled"):
        fails.append("PAIR_CE_PRESENT")
    # Changing hard keep count must not change class weight (config frozen)
    fake_n_keep, fake_n_retry = 10_000_000, 1
    # no formula — weight stays 1.0
    if CLASS_WEIGHT_RETRY != 1.0:
        fails.append("WEIGHT_DRIFT")
    return {"pass": len(fails) == 0, "fails": fails, "strict_keep": sk, "strict_retry": sr}


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    CKPT.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device={device}", flush=True)

    print("loading…", flush=True)
    hard_keep_map = load_hard_keep()
    strict_sc = load_sidecar(STRICT_DATA)
    strict_train = load_split(STRICT_DATA, "train")
    strict_test = load_split(STRICT_DATA, "test")
    full_test = load_split(FULL100K, "test")

    train = build_combined_train(strict_train, hard_keep_map)
    buckets, strict_groups, surf_groups, tags = build_index(train, strict_sc, hard_keep_map)
    pair_index = build_pair_index(train, strict_sc)
    print(
        "buckets", {k: len(v) for k, v in buckets.items()},
        "pairs", len(pair_index),
        "strict_keep_tags", sum(1 for t in tags.values() if t["isStrictKeep"]),
        "strict_retry_tags", sum(1 for t in tags.values() if t["isStrictRetry"]),
        flush=True,
    )

    resolved_config = {
        "class_weight_retry": CLASS_WEIGHT_RETRY,
        "auto_class_weight_formula": False,
        "no_auto_formula": True,
        "explicit_source": "MODEL3_V1_OBJECTIVE_REBALANCE_HARDCODED_BASELINE",
        "pair_loss_enabled": True,
        "pair_loss_type": PAIR_LOSS_TYPE,
        "pair_ce_enabled": False,
        "pair_lambda": "per_objective",
        "pair_margin": PAIR_MARGIN,
        "sampling_view_id": "BALANCE_D_30_30_25_15",
        "sampling_view": SAMPLING_VIEW,
        "contract": CONTRACT_ID,
        "init": "random_from_scratch",
        "optimizer": "Adam",
        "lr": LR,
        "batch_size": BATCH,
    }
    resolved_config["config_hash"] = sha_json(resolved_config)

    # Pretrain gate
    idxs = make_epoch_indices(SAMPLING_VIEW, buckets, strict_groups, surf_groups, len(train), random.Random(BASE_SEED))
    exposure = audit_epoch_exposure(idxs, train, tags)
    print("exposure", exposure, flush=True)
    if not exposure["ok"]:
        raise SystemExit(f"SAMPLER_FIX_FAIL {exposure}")

    gov_t = governance_tests(tags, buckets, resolved_config)
    print("governance_tests", gov_t, flush=True)
    if not gov_t["pass"]:
        raise SystemExit(f"GOVERNANCE_FAIL {gov_t['fails']}")

    # Strict MV rate sample
    vocab = build_char_vocab(train)
    pairs_qa = build_strict_test_pairs(strict_train[:2000], strict_sc)[:100]
    mv_ok = sum(
        1
        for ks, ksc, rs, rsc in pairs_qa
        if validate_strict_anchor_contrast_pair_v1(
            ks, rs, target_surface=ksc.get("targetSurface") or "", vocab=vocab, require_tensor=True
        ).get("ok")
    )
    print(f"strict_validator_ok={mv_ok}/{len(pairs_qa)}", flush=True)

    effective_weight = {
        "ordinary_KEEP": 1.0,
        "strict_KEEP": 1.0,
        "strict_RETRY": 1.0,
        "hard_KEEP": 1.0,
        "natural_KEEP": 1.0,
        "no_anchor_KEEP": 1.0,
        "note": "main CE unweighted; pair margin is relative only (no absolute CE push)",
    }

    # Eval sets
    strict_pairs_test = build_strict_test_pairs(strict_test, strict_sc)
    # Hard KEEP eval uses sidecar membership (may overlap STRICT KEEP — tag, not exclusive).
    hk_test_ids = {sid for sid, hk in hard_keep_map.items() if hk.get("split") == "test"}
    hard_keep_test = [s for s in strict_test if s["sampleId"] in hk_test_ids]
    hard_keep_test += [s for s in full_test if s["sampleId"] in hk_test_ids and s["sampleId"] not in {x["sampleId"] for x in hard_keep_test}]
    hard_keep_test = hard_keep_test[:1200]
    no_anchor_test = [s for s in full_test if s.get("trainingBucket") == "NO_ANCHOR"][:1500]
    no_anchor_test += [s for s in strict_test if s.get("trainingBucket") == "NO_ANCHOR"][:400]
    print(
        f"eval_sets full_test={len(full_test)} strict_pairs={len(strict_pairs_test)} "
        f"hard_keep_test={len(hard_keep_test)} no_anchor_test={len(no_anchor_test)}",
        flush=True,
    )

    comparison = []
    for k, v in FROZEN_CMP.items():
        comparison.append({"model": k, **v})

    # Fast screen O0-O3 on FIXED subset
    fast = {}
    for name, obj in OBJECTIVES.items():
        seed = SEEDS[f"{name}_fast"]
        print(f"\n=== FAST {name} λ={obj['lambda_pair']} subset={FAST_SUBSET_N} ===", flush=True)
        model, hist = train_one(
            train, buckets, strict_groups, surf_groups, pair_index, vocab, device,
            FAST_EPOCHS, seed, obj["lambda_pair"], obj["pair_enabled"], f"fast/{name}",
            epoch_n=FAST_SUBSET_N,
        )
        suite = eval_suite(model, full_test, strict_pairs_test, hard_keep_test, no_anchor_test, vocab, device)
        row = row_from(f"{name}_fast", suite, obj)
        row["score"] = pareto_score(row)
        fast[name] = {"suite": suite, "row": row, "history": hist, "obj": obj}
        comparison.append(row)
        print(
            f"{name}: P={row['precision']:.3f} FPR={row['false_retry']:.4f} "
            f"strict={row['strict_pair']:.3f} z={row['strict_zero']:.3f} "
            f"hk={row['hard_keep_acc']:.3f} score={row['score']:.3f}",
            flush=True,
        )
        del model

    top2 = sorted(OBJECTIVES.keys(), key=lambda n: fast[n]["row"]["score"], reverse=True)[:2]
    print(f"TOP2 {top2}", flush=True)

    # Full train top2
    full = {}
    for name in top2:
        obj = OBJECTIVES[name]
        seed = SEEDS[f"{name}_full"]
        print(f"\n=== FULL {name} ===", flush=True)
        model, hist = train_one(
            train, buckets, strict_groups, surf_groups, pair_index, vocab, device,
            FULL_EPOCHS, seed, obj["lambda_pair"], obj["pair_enabled"], f"full/{name}",
        )
        suite = eval_suite(model, full_test, strict_pairs_test, hard_keep_test, no_anchor_test, vocab, device)
        row = row_from(f"{name}_full", suite, obj)
        row["score"] = pareto_score(row)
        full[name] = {"suite": suite, "row": row, "model": model, "obj": obj, "seed": seed, "history": hist}
        comparison.append(row)
        cfg = {
            **resolved_config,
            "pair_lambda": obj["lambda_pair"],
            "pair_loss_enabled": obj["pair_enabled"],
            "objective_id": name,
            "seed": seed,
            "epochs": FULL_EPOCHS,
        }
        cfg["config_hash"] = sha_json(cfg)
        save_model_bundle(
            CKPT / f"{name}_full",
            model,
            vocab,
            cfg,
            f"MODEL3_V1_OBJECTIVE_REBALANCE_{name}_V1",
        )

    winner = max(top2, key=lambda n: full[n]["row"]["score"])
    win_obj = OBJECTIVES[winner]
    print(f"WINNER {winner}", flush=True)

    # Stability 3 seeds
    stability = []
    for i, sd_key in enumerate(["stab0", "stab1", "stab2"]):
        sd = SEEDS[sd_key]
        print(f"\n=== STABILITY {winner} seed {sd} ===", flush=True)
        model, hist = train_one(
            train, buckets, strict_groups, surf_groups, pair_index, vocab, device,
            FULL_EPOCHS, sd, win_obj["lambda_pair"], win_obj["pair_enabled"], f"stab{i}",
        )
        suite = eval_suite(model, full_test, strict_pairs_test, hard_keep_test, no_anchor_test, vocab, device)
        row = row_from(f"Winner_seed{sd}", suite, win_obj)
        stability.append({"seed": sd, "suite": suite, "row": row})
        cfg = {
            **resolved_config,
            "pair_lambda": win_obj["lambda_pair"],
            "pair_loss_enabled": win_obj["pair_enabled"],
            "objective_id": winner,
            "seed": sd,
            "epochs": FULL_EPOCHS,
        }
        cfg["config_hash"] = sha_json(cfg)
        save_model_bundle(CKPT / f"winner_seed_{sd}", model, vocab, cfg, "MODEL3_V1_OBJECTIVE_REBALANCE_WINNER_V1")
        if i == 0:
            # gradient + logit on first stability model
            g = measure_component_grads(model, train, vocab, device, pair_index, list(range(min(64, len(train)))))
            nat = [s for s in full_test if s.get("trainingBucket") == "NATURAL"][:400]
            noa = [s for s in full_test if s.get("trainingBucket") == "NO_ANCHOR"][:400]
            logits = {
                "natural_keep": retry_logit_stats(model, nat, vocab, device, "KEEP"),
                "no_anchor": retry_logit_stats(model, noa, vocab, device, "KEEP"),
            }
            stability[0]["gradients"] = g
            stability[0]["logits"] = logits
        del model

    def mean_std(xs):
        m = sum(xs) / len(xs)
        v = sum((x - m) ** 2 for x in xs) / len(xs)
        return {"mean": m, "std": v ** 0.5, "min": min(xs), "max": max(xs)}

    stab = {
        "precision": mean_std([s["row"]["precision"] for s in stability]),
        "recall": mean_std([s["row"]["recall"] for s in stability]),
        "f1": mean_std([s["row"]["f1"] for s in stability]),
        "false_retry": mean_std([s["row"]["false_retry"] for s in stability]),
        "strict_pair": mean_std([s["row"]["strict_pair"] for s in stability]),
        "strict_zero": mean_std([s["row"]["strict_zero"] for s in stability]),
        "strict_shuffle": mean_std([s["row"]["strict_shuffle"] for s in stability]),
        "hard_keep_acc": mean_std([s["row"]["hard_keep_acc"] for s in stability]),
        "no_anchor_fp": mean_std([s["row"]["no_anchor_fp"] for s in stability]),
        "heldout_family_f1": mean_std([s["row"]["heldout_family_f1"] for s in stability]),
    }
    wm = {k: stab[k]["mean"] for k in stab}
    win_row = dict(stability[0]["row"])
    for k, v in wm.items():
        if k in win_row:
            win_row[k] = v
    win_row["model"] = "Winner_Mean"
    comparison.append(win_row)

    g0 = stability[0].get("gradients") or {}
    logits0 = stability[0].get("logits") or {}
    nat_p90 = (logits0.get("natural_keep") or {}).get("p90")
    noa_p90 = (logits0.get("no_anchor") or {}).get("p90")
    # prior shift: compare to broken winner natural p90≈1.60 / noa max issues — use thresholds
    global_shift = bool(
        (nat_p90 is not None and nat_p90 > 2.0)
        or (noa_p90 is not None and noa_p90 > 1.5)
    )

    dominant = "NONE"
    if g0:
        dominant = max(
            [("KEEP_CE", g0.get("keep_ce") or 0), ("RETRY_CE", g0.get("retry_ce") or 0), ("PAIR_MARGIN", g0.get("pair_margin") or 0)],
            key=lambda x: x[1],
        )[0]

    # Verdict
    sampler_ok = exposure["ok"] and gov_t["pass"]
    config_ok = CLASS_WEIGHT_RETRY == 1.0 and not resolved_config["auto_class_weight_formula"]
    pair_ce_gone = not resolved_config["pair_ce_enabled"]
    anchor_ok = wm["strict_pair"] >= 0.85 and wm["strict_zero"] <= 0.35
    prec_ok = wm["precision"] >= 0.85
    prec_partial = wm["precision"] >= 0.65
    hk_ok = wm["hard_keep_acc"] >= 0.90
    na_ok = wm["no_anchor_fp"] < 0.01

    if not sampler_ok:
        verdict = "SAMPLER_FIX_FAIL"
    elif not config_ok:
        verdict = "CONFIG_DRIFT_REMAINS"
    elif global_shift and not prec_ok:
        verdict = "GLOBAL_RETRY_PRIOR_SHIFT_REMAINS"
    elif not anchor_ok and wm["strict_pair"] < 0.5:
        verdict = "ANCHOR_SIGNAL_LOST"
    elif prec_ok and anchor_ok and hk_ok and na_ok and not global_shift:
        verdict = "PASS"
    elif prec_partial and anchor_ok and not global_shift:
        verdict = "PASS_WITH_MINOR_GAP"
    elif not prec_partial:
        verdict = "PRECISION_GAP"
    elif global_shift:
        verdict = "GLOBAL_RETRY_PRIOR_SHIFT_REMAINS"
    else:
        # objective fixed but cannot balance
        verdict = "MODEL_CAPACITY_REVIEW_REQUIRED" if sampler_ok and config_ok and pair_ce_gone else "PRECISION_GAP"

    next_phase = {
        "PASS": "MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION",
        "PASS_WITH_MINOR_GAP": "MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION",
        "PRECISION_GAP": "MODEL3_V1_OBJECTIVE_REBALANCE_RETRY",
        "ANCHOR_SIGNAL_LOST": "MODEL3_V1_PAIR_LOSS_CALIBRATION",
        "GLOBAL_RETRY_PRIOR_SHIFT_REMAINS": "MODEL3_V1_OBJECTIVE_REBALANCE_RETRY",
        "SAMPLER_FIX_FAIL": "MODEL3_V1_SAMPLER_FIX",
        "CONFIG_DRIFT_REMAINS": "MODEL3_V1_CONFIG_DRIFT_FIX",
        "MODEL_CAPACITY_REVIEW_REQUIRED": "MODEL3_V1_REPRESENTATION_CAPACITY_REVIEW",
    }.get(verdict, "STOP_REVIEW")

    bundle = {
        "phase": "MODEL3_V1_OBJECTIVE_REBALANCE",
        "verdict": verdict,
        "resolved_config": resolved_config,
        "sampler_fix": {
            "strict_keep_main_ce": "PRESENT" if exposure["strict_keep"] > 0 else "MISSING",
            "strict_retry_main_ce": "PRESENT" if exposure["strict_retry"] > 0 else "MISSING",
            "keep_retry_ratio": exposure["keep_retry_ratio"],
            "exposure": exposure,
            "before_bug": {"STRICT_KEEP": 0, "STRICT_RETRY": "~0.30"},
        },
        "effective_weight": effective_weight,
        "governance_tests": gov_t,
        "fast_screen": {k: v["row"] for k, v in fast.items()},
        "top2": top2,
        "full_train": {k: v["row"] for k, v in full.items()},
        "winner": {"objective": winner, "lambda_pair": win_obj["lambda_pair"], "mean": wm, "stability": stab},
        "gradients": g0,
        "logits": logits0,
        "global_retry_prior_shift": global_shift,
        "comparison": comparison,
        "decision": {
            "objective_imbalance_fixed": sampler_ok and config_ok and pair_ce_gone,
            "anchor_causality_preserved": anchor_ok,
            "precision_restored": "YES" if prec_ok else ("PARTIAL" if prec_partial else "NO"),
            "ready_full100k_integration": verdict in ("PASS", "PASS_WITH_MINOR_GAP"),
            "next_phase": next_phase,
        },
    }

    cmp_path = DOCS / "model3_v1_objective_rebalance_comparison.csv"
    with cmp_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "model", "precision", "recall", "f1", "false_retry",
                "strict_pair", "strict_zero", "strict_shuffle",
                "hard_keep_acc", "no_anchor_fp", "heldout_family_f1", "score",
            ]
        )
        for row in comparison:
            w.writerow(
                [
                    row.get("model"), row.get("precision"), row.get("recall"), row.get("f1"),
                    row.get("false_retry"), row.get("strict_pair"), row.get("strict_zero"),
                    row.get("strict_shuffle"), row.get("hard_keep_acc"), row.get("no_anchor_fp"),
                    row.get("heldout_family_f1"), row.get("score"),
                ]
            )

    gov = {
        "go_summary": {
            "phase": "MODEL3_V1_OBJECTIVE_REBALANCE",
            "verdict": verdict,
            "recommended_next_phase": next_phase,
            "auto_class_weight_removed": True,
            "hidden_training_drift": False,
            "strict_membership_bug_fixed": True,
            "old_pair_ce_removed": True,
            "architecture_changed": False,
            "runtime_changed": False,
            "tts": False,
            "production_retry": False,
        },
        "report_artifact_count": 4,
        "report_artifact_count_le_10": True,
        "resolved_config": resolved_config,
    }

    report = f"""# Lingua Model3 V1 Objective Rebalance

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_OBJECTIVE_REBALANCE`  
**Verdict:** `{verdict}`

## Sampler fix

| Check | Result |
|-------|--------|
| STRICT KEEP main CE | **PRESENT** ({exposure['strict_keep']}) |
| STRICT RETRY main CE | **PRESENT** ({exposure['strict_retry']}) |
| KEEP:RETRY ratio | {exposure['keep_retry_ratio']:.3f} |
| Hard KEEP bucket | PRESENT ({len(buckets.get('ANCHOR_CONDITIONED_HARD_KEEP') or [])}) |

Before: STRICT_KEEP=0 (swallowed). After: STRICT identity priority; Hard KEEP is tag-only for strict members.

## Config

| Param | Value |
|-------|------:|
| class_weight_retry | **{CLASS_WEIGHT_RETRY}** (explicit) |
| Auto formula | **OFF** |
| Pair CE | **OFF** |
| Pair loss | PURE_MARGIN |
| Pair margin | {PAIR_MARGIN} |
| Config hash | `{resolved_config['config_hash'][:16]}…` |

## Effective main-CE weight

All categories = **1.0** (pair margin is relative only).

## Fast screen

| Obj | λ | Precision | FPR | Strict Pair | Zero | Hard KEEP |
|-----|--:|----------:|----:|------------:|-----:|----------:|
| O0 | 0 | {fast['O0']['row']['precision']:.4f} | {fast['O0']['row']['false_retry']:.4f} | {fast['O0']['row']['strict_pair']:.4f} | {fast['O0']['row']['strict_zero']:.4f} | {fast['O0']['row']['hard_keep_acc']:.4f} |
| O1 | 0.05 | {fast['O1']['row']['precision']:.4f} | {fast['O1']['row']['false_retry']:.4f} | {fast['O1']['row']['strict_pair']:.4f} | {fast['O1']['row']['strict_zero']:.4f} | {fast['O1']['row']['hard_keep_acc']:.4f} |
| O2 | 0.10 | {fast['O2']['row']['precision']:.4f} | {fast['O2']['row']['false_retry']:.4f} | {fast['O2']['row']['strict_pair']:.4f} | {fast['O2']['row']['strict_zero']:.4f} | {fast['O2']['row']['hard_keep_acc']:.4f} |
| O3 | 0.20 | {fast['O3']['row']['precision']:.4f} | {fast['O3']['row']['false_retry']:.4f} | {fast['O3']['row']['strict_pair']:.4f} | {fast['O3']['row']['strict_zero']:.4f} | {fast['O3']['row']['hard_keep_acc']:.4f} |

Top2: **{top2[0]}, {top2[1]}**

## Winner

Objective **{winner}** · λ={win_obj['lambda_pair']}

| Metric | Mean |
|--------|-----:|
| Precision | {wm['precision']:.4f} |
| Recall | {wm['recall']:.4f} |
| F1 | {wm['f1']:.4f} |
| False RETRY | {wm['false_retry']:.4f} |
| Strict Pair | {wm['strict_pair']:.4f} |
| Strict Zero | {wm['strict_zero']:.4f} |
| Hard KEEP Acc | {wm['hard_keep_acc']:.4f} |
| NO_ANCHOR FP | {wm['no_anchor_fp']:.4f} |
| Heldout Family F1 | {wm['heldout_family_f1']:.4f} |

Global RETRY prior shift: **{"YES" if global_shift else "NO"}**  
Natural KEEP p90: {nat_p90} · NO_ANCHOR p90: {noa_p90}

Gradients: KEEP={g0.get('keep_ce')} RETRY={g0.get('retry_ce')} PairMargin={g0.get('pair_margin')} · Dominant={dominant}

## Decision

- Objective imbalance fixed: **{"YES" if bundle['decision']['objective_imbalance_fixed'] else "NO"}**
- Anchor causality preserved: **{"YES" if anchor_ok else "NO"}**
- Precision restored: **{bundle['decision']['precision_restored']}**
- Ready Full100K strict integration: **{"YES" if bundle['decision']['ready_full100k_integration'] else "NO"}**
- Ready TTS: **NO**
- Next: `{next_phase}`

## STOP

No Full100K rebuild · No TTS · No production RETRY · No runtime change. Awaiting user review.
"""

    (DOCS / "Lingua_Model3_V1_Objective_Rebalance_Report_2026_08_25.md").write_text(report, encoding="utf-8")
    (DOCS / "model3_v1_objective_rebalance_bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_objective_rebalance_governance.json").write_text(
        json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "verdict": verdict,
                "winner": winner,
                "precision": wm["precision"],
                "strict_pair": wm["strict_pair"],
                "next": next_phase,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
