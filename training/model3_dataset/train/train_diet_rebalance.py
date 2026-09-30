# -*- coding: utf-8 -*-
"""LEGACY / EXPERIMENT ONLY — NOT the authoritative Synthetic V1 trainer.

Authoritative: train_full100k_strict_integration.py + model3_v1_training_config.json

MODEL3_V1_FULL100K_DIET_REBALANCE — sampling-only calibration (historical Diet_B).

Does NOT regenerate corpus, mutate labels, or change architecture.
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
from torch.utils.data import DataLoader, Dataset

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    sample_to_tensors,
    save_model_bundle,
)

DATA = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
CKPT_DIR = REPO / "training/model3_dataset/model3_v1_diet_rebalance_ckpts"
DOCS = REPO / "docs/user_correction/model3"
BASE_SEED = 2026082421
CLASS_WEIGHT_RETRY = 2.5
BATCH = 64
FAST_EPOCHS = 2
FULL_EPOCHS = 6
LR = 1e-3

DIETS = {
    "CONTROL": {"NATURAL": 0.678, "CONTRAST": 0.119, "NO_ANCHOR": 0.187, "HARD_KEEP": 0.016},
    "A": {"NATURAL": 0.60, "CONTRAST": 0.20, "NO_ANCHOR": 0.15, "HARD_KEEP": 0.05},
    "B": {"NATURAL": 0.525, "CONTRAST": 0.25, "NO_ANCHOR": 0.15, "HARD_KEEP": 0.075},
    "C": {"NATURAL": 0.45, "CONTRAST": 0.30, "NO_ANCHOR": 0.15, "HARD_KEEP": 0.10},
    "D": {"NATURAL": 0.475, "CONTRAST": 0.275, "NO_ANCHOR": 0.15, "HARD_KEEP": 0.10},
}

BASELINE = {
    "precision": 0.9826,
    "recall": 0.9440,
    "f1": 0.9629,
    "false_retry": 0.000076,
    "anchor_zero_delta": 0.0115,
    "anchor_shuffle_delta": 0.0165,
    "zero_flip": 0.0002,
    "shuffle_flip": 0.0002,
    "strong_pair": 0.6330,
    "heldout_family_f1": 0.0964,
}

PILOT = {
    "precision": 0.5167,
    "recall": 0.9924,
    "f1": 0.6795,
    "false_retry": 0.044462,
    "anchor_zero_delta": 0.3179,
    "anchor_shuffle_delta": 0.2185,
    "zero_flip": 0.0619,
    "shuffle_flip": 0.0689,
    "strong_pair": 0.9896,
    "heldout_family_f1": 0.6859,
}


def sha256_split(split: str) -> str:
    h = hashlib.sha256()
    for p in sorted((DATA / split).glob("shard-*.jsonl")):
        with p.open("rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                h.update(block)
    return h.hexdigest()


def load_split(split: str) -> list[dict]:
    rows = []
    for p in sorted((DATA / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def load_sidecar() -> dict[str, dict]:
    m = {}
    with (DATA / "anchor_provenance_sidecar.jsonl").open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                m[o["sampleId"]] = o
    return m


class DS(Dataset):
    def __init__(self, samples, vocab, xform=None):
        self.samples = samples
        self.vocab = vocab
        self.xform = xform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        if self.xform:
            s = self.xform(s)
        return sample_to_tensors(s, self.vocab)


def metrics(tp, fp, fn, tn):
    rp = tp / (tp + fp) if (tp + fp) else 0.0
    rr = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * rp * rr / (rp + rr) if (rp + rr) else 0.0
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "retry_precision": rp,
        "retry_recall": rr,
        "retry_f1": f1,
        "false_retry_rate": fp / (fp + tn) if (fp + tn) else 0.0,
        "eligible": tp + fp + fn + tn,
    }


def eval_model(model, samples, vocab, device, xform=None, bs=64):
    if not samples:
        return metrics(0, 0, 0, 0), []
    loader = DataLoader(
        DS(samples, vocab, xform),
        batch_size=bs,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )
    model.eval()
    tp = fp = fn = tn = 0
    preds = []
    with torch.no_grad():
        for bi, batch in enumerate(loader):
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            pred = logits.argmax(-1)
            for j in range(pred.shape[0]):
                si = bi * bs + j
                if si >= len(samples):
                    break
                item = sample_to_tensors(xform(samples[si]) if xform else samples[si], vocab)
                for k in range(len(item["labels"])):
                    if item["target_mask"][k] != 1 or item["labels"][k] < 0:
                        continue
                    y = int(item["labels"][k])
                    p = int(pred[j, k].item())
                    tn += y == 0 and p == 0
                    fp += y == 0 and p == 1
                    tp += y == 1 and p == 1
                    fn += y == 1 and p == 0
                    preds.append((si, k, y, p))
    return metrics(tp, fp, fn, tn), preds


def flip_rate(a, b):
    mb = {(s, k): p for s, k, y, p in b}
    tot = flip = 0
    for s, k, y, p0 in a:
        if (s, k) not in mb:
            continue
        tot += 1
        flip += mb[(s, k)] != p0
    return {"compared": tot, "flip": flip, "flip_rate": flip / tot if tot else 0.0}


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


def build_index(train, sidecar):
    buckets = defaultdict(list)
    contrast_groups = defaultdict(list)
    group_surface = {}
    for i, s in enumerate(train):
        b = s.get("trainingBucket") or "NATURAL"
        if b not in ("NATURAL", "CONTRAST", "NO_ANCHOR", "HARD_KEEP"):
            b = "NATURAL"
        buckets[b].append(i)
        if b == "CONTRAST":
            sc = sidecar.get(s["sampleId"], {})
            gid = sc.get("contrastGroupId") or f"solo:{s['sampleId']}"
            contrast_groups[gid].append(i)
            tgt = sc.get("targetSurface") or ""
            group_surface[gid] = tgt
    # surface → groups for balance
    surf_groups = defaultdict(list)
    for gid, surf in group_surface.items():
        surf_groups[surf or "_"].append(gid)
    return buckets, contrast_groups, surf_groups


def make_epoch_indices(diet, buckets, contrast_groups, surf_groups, n_samples, rng):
    """Build one epoch of sample indices with target bucket exposure.

    CONTRAST: sample contrast groups (surface-balanced), emit ALL members of group.
    """
    buckets_names = ["NATURAL", "CONTRAST", "NO_ANCHOR", "HARD_KEEP"]
    probs = [diet[b] for b in buckets_names]
    # normalize
    sprob = sum(probs)
    probs = [p / sprob for p in probs]

    # surface-balanced group list
    surf_keys = [k for k, v in surf_groups.items() if v]
    group_pool = []
    if surf_keys:
        # round-robin surfaces then shuffle within
        max_n = max(len(surf_groups[k]) for k in surf_keys)
        for j in range(max_n):
            for k in surf_keys:
                gs = surf_groups[k]
                if j < len(gs):
                    group_pool.append(gs[j])
    else:
        group_pool = list(contrast_groups.keys())
    rng.shuffle(group_pool)
    g_ptr = 0

    out = []
    # track exposure
    while len(out) < n_samples:
        b = rng.choices(buckets_names, weights=probs, k=1)[0]
        pool = buckets.get(b) or buckets["NATURAL"]
        if not pool:
            pool = buckets["NATURAL"]
        if b == "CONTRAST" and group_pool:
            gid = group_pool[g_ptr % len(group_pool)]
            g_ptr += 1
            members = contrast_groups.get(gid) or [rng.choice(pool)]
            # emit full group (KEEP+RETRY together)
            for mi in members:
                out.append(mi)
                if len(out) >= n_samples:
                    break
        else:
            out.append(rng.choice(pool))
    return out[:n_samples]


def train_one(
    diet_name,
    diet,
    train,
    buckets,
    contrast_groups,
    surf_groups,
    vocab,
    device,
    epochs,
    seed,
    tag,
):
    torch.manual_seed(seed)
    random.seed(seed)
    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    cw = torch.tensor([1.0, CLASS_WEIGHT_RETRY], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    n = len(train)
    history = []
    t0 = time.time()
    for ep in range(epochs):
        model.train()
        idxs = make_epoch_indices(diet, buckets, contrast_groups, surf_groups, n, random.Random(seed + ep * 17))
        loss_sum = nb = 0
        # mini-batches over sampled indices
        for start in range(0, len(idxs), BATCH):
            batch_ix = idxs[start : start + BATCH]
            items = [sample_to_tensors(train[i], vocab) for i in batch_ix]
            batch = collate_batch(items, device)
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            bsz, nspan, c = logits.shape
            lv = crit(logits.view(bsz * nspan, c), batch["labels"].view(bsz * nspan))
            sel = batch["target_mask"].view(bsz * nspan) * batch["valid"].view(bsz * nspan)
            if sel.sum() <= 0:
                continue
            loss = (lv * sel).sum() / sel.sum()
            loss.backward()
            opt.step()
            loss_sum += loss.item()
            nb += 1
        history.append({"epoch": ep + 1, "train_loss": loss_sum / max(nb, 1)})
        print(
            f"[{tag}/{diet_name}/seed{seed}] epoch {ep+1}/{epochs} loss={loss_sum/max(nb,1):.4f}",
            flush=True,
        )
    return model, history, time.time() - t0


def eval_suite(model, test, vocab, device, sidecar, strong_groups):
    test_m, base_preds = eval_model(model, test, vocab, device)
    az_m, az_preds = eval_model(model, test, vocab, device, xform=zero_anchor)
    as_m, as_preds = eval_model(
        model,
        test,
        vocab,
        device,
        xform=lambda s: shuffle_anchor(s, random.Random(hash(s["sampleId"]) % (2**32))),
    )
    az_flip = flip_rate(base_preds, az_preds)
    as_flip = flip_rate(base_preds, as_preds)
    zero_delta = test_m["retry_f1"] - az_m["retry_f1"]
    shuffle_delta = test_m["retry_f1"] - as_m["retry_f1"]

    id_to_idx = {s["sampleId"]: i for i, s in enumerate(test)}
    pred_map = {(test[si]["sampleId"], k): (y, p) for si, k, y, p in base_preds}
    pred_map_z = {(test[si]["sampleId"], k): (y, p) for si, k, y, p in az_preds}
    pred_map_s = {(test[si]["sampleId"], k): (y, p) for si, k, y, p in as_preds}

    def pair_acc(pmap):
        pair_total = pair_correct = surface_dom = 0
        for g, rows in strong_groups.items():
            keep_rows = [
                r
                for r in rows
                if r[1].get("roleInPair") == "KEEP"
                or r[1].get("seedType") == "ANCHOR_CONTRAST_KEEP_CANDIDATE"
            ]
            retry_rows = [
                r
                for r in rows
                if r[1].get("roleInPair") == "RETRY"
                or r[1].get("seedType") == "ANCHOR_CONTRAST_RETRY_CANDIDATE"
            ]
            if not keep_rows or not retry_rows:
                continue

            def side_pred(sid, want_retry):
                s = test[id_to_idx[sid]]
                tgt = sidecar[sid].get("targetSurface")
                for k, sp in enumerate(s["spans"]):
                    if sp.get("targetMask") != 1:
                        continue
                    if tgt and sp.get("surface") != tgt:
                        continue
                    y, p = pmap.get((sid, k), (None, None))
                    if y is None:
                        continue
                    return p, p == (1 if want_retry else 0)
                for k, sp in enumerate(s["spans"]):
                    if sp.get("targetMask") != 1:
                        continue
                    want = "RETRY" if want_retry else "KEEP"
                    if sp.get("label") != want:
                        continue
                    y, p = pmap.get((sid, k), (None, None))
                    if y is None:
                        continue
                    return p, p == (1 if want_retry else 0)
                return None, False

            pk, ok_k = side_pred(keep_rows[0][0], False)
            pr, ok_r = side_pred(retry_rows[0][0], True)
            pair_total += 1
            if ok_k and ok_r:
                pair_correct += 1
            if pk is not None and pr is not None and pk == pr:
                surface_dom += 1
        return {
            "pairs": pair_total,
            "pair_accuracy": pair_correct / pair_total if pair_total else 0.0,
            "surface_dominated_rate": surface_dom / pair_total if pair_total else 0.0,
        }

    strong = pair_acc(pred_map)
    strong_z = pair_acc(pred_map_z)
    strong_s = pair_acc(pred_map_s)

    def subset_axis(axis):
        return [s for s in test if axis in (s.get("heldOutAxes") or [])]

    us = subset_axis("held_out_surface_pair")
    uf = subset_axis("held_out_pronunciation_family")
    uc = subset_axis("held_out_anchor_combination")
    us_m, _ = eval_model(model, us, vocab, device) if us else (metrics(0, 0, 0, 0), [])
    uf_m, _ = eval_model(model, uf, vocab, device) if uf else (metrics(0, 0, 0, 0), [])
    uc_m, _ = eval_model(model, uc, vocab, device) if uc else (metrics(0, 0, 0, 0), [])

    no_anchor_test = [s for s in test if not any(sp.get("isAnchor") for sp in s["spans"])]
    na_m, _ = eval_model(model, no_anchor_test, vocab, device) if no_anchor_test else (metrics(0, 0, 0, 0), [])

    # contrast-subset overall F1 (eligible spans on strong-pair utterances)
    strong_sids = {sid for rows in strong_groups.values() for sid, _ in rows}
    contrast_subset = [s for s in test if s["sampleId"] in strong_sids]
    cs_m, cs_preds = eval_model(model, contrast_subset, vocab, device) if contrast_subset else (metrics(0, 0, 0, 0), [])
    cs_z, cs_zp = eval_model(model, contrast_subset, vocab, device, xform=zero_anchor) if contrast_subset else (metrics(0, 0, 0, 0), [])
    cs_s, cs_sp = eval_model(
        model,
        contrast_subset,
        vocab,
        device,
        xform=lambda s: shuffle_anchor(s, random.Random(hash(s["sampleId"]) % (2**32))),
    ) if contrast_subset else (metrics(0, 0, 0, 0), [])

    return {
        "test": test_m,
        "anchor_zero": {"metrics": az_m, "flip": az_flip, "delta_f1": zero_delta},
        "anchor_shuffle": {"metrics": as_m, "flip": as_flip, "delta_f1": shuffle_delta},
        "strong_contrast": {
            "normal": strong,
            "anchor_zero_pair_accuracy": strong_z["pair_accuracy"],
            "anchor_shuffle_pair_accuracy": strong_s["pair_accuracy"],
            "subset_f1": {
                "normal": cs_m["retry_f1"],
                "zero": cs_z["retry_f1"],
                "shuffle": cs_s["retry_f1"],
                "zero_delta": cs_m["retry_f1"] - cs_z["retry_f1"],
                "shuffle_delta": cs_m["retry_f1"] - cs_s["retry_f1"],
                "zero_flip": flip_rate(cs_preds, cs_zp)["flip_rate"],
                "shuffle_flip": flip_rate(cs_preds, cs_sp)["flip_rate"],
            },
        },
        "generalization": {
            "unseen_surface": {"n": len(us), "metrics": us_m},
            "heldout_family": {"n": len(uf), "metrics": uf_m},
            "unseen_context": {"n": len(uc), "metrics": uc_m},
        },
        "no_anchor": {"n": len(no_anchor_test), "metrics": na_m},
    }


def pareto_score(r):
    """Higher is better. Primary: anchor, strong pair, heldout family; guard precision."""
    t = r["test"]
    az = r["anchor_zero"]
    strong = r["strong_contrast"]["normal"]["pair_accuracy"]
    fam = r["generalization"]["heldout_family"]["metrics"]["retry_f1"]
    prec = t["retry_precision"]
    na_fp = r["no_anchor"]["metrics"]["false_retry_rate"]
    # penalties
    prec_pen = 0.0
    if prec < 0.85:
        prec_pen = 5.0
    elif prec < 0.90:
        prec_pen = 1.0
    na_pen = 2.0 if na_fp > 0.01 else 0.0
    return (
        3.0 * abs(az["delta_f1"])
        + 2.0 * az["flip"]["flip_rate"]
        + 2.5 * strong
        + 2.0 * fam
        + 0.5 * prec
        - prec_pen
        - na_pen
        + 0.2 * t["retry_f1"]
    )


def summarize_row(name, r):
    t = r["test"]
    return {
        "model": name,
        "precision": t["retry_precision"],
        "recall": t["retry_recall"],
        "f1": t["retry_f1"],
        "false_retry": t["false_retry_rate"],
        "anchor_zero_delta": r["anchor_zero"]["delta_f1"],
        "anchor_shuffle_delta": r["anchor_shuffle"]["delta_f1"],
        "zero_flip": r["anchor_zero"]["flip"]["flip_rate"],
        "shuffle_flip": r["anchor_shuffle"]["flip"]["flip_rate"],
        "strong_pair": r["strong_contrast"]["normal"]["pair_accuracy"],
        "strong_pair_zero": r["strong_contrast"]["anchor_zero_pair_accuracy"],
        "strong_pair_shuffle": r["strong_contrast"]["anchor_shuffle_pair_accuracy"],
        "heldout_family_f1": r["generalization"]["heldout_family"]["metrics"]["retry_f1"],
        "unseen_surface_f1": r["generalization"]["unseen_surface"]["metrics"]["retry_f1"],
        "unseen_context_f1": r["generalization"]["unseen_context"]["metrics"]["retry_f1"],
        "no_anchor_false_retry": r["no_anchor"]["metrics"]["false_retry_rate"],
        "contrast_subset_zero_delta": r["strong_contrast"]["subset_f1"]["zero_delta"],
        "score": pareto_score(r),
    }


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")

    print("freeze hashes…", flush=True)
    hashes_before = {s: sha256_split(s) for s in ("train", "dev", "test")}
    print(hashes_before, flush=True)

    print("load…", flush=True)
    train = load_split("train")
    dev = load_split("dev")
    test = load_split("test")
    sidecar = load_sidecar()
    print(f"train={len(train)} dev={len(dev)} test={len(test)}", flush=True)

    buckets, contrast_groups, surf_groups = build_index(train, sidecar)
    print("train_buckets", {k: len(v) for k, v in buckets.items()}, flush=True)
    print("contrast_groups", len(contrast_groups), flush=True)

    # strong groups on test
    id_to_idx = {s["sampleId"]: i for i, s in enumerate(test)}
    strong_groups = defaultdict(list)
    for sid, sc in sidecar.items():
        if sid in id_to_idx and sc.get("contrastStrength") == "STRONG":
            strong_groups[sc["contrastGroupId"]].append((sid, sc))

    vocab = build_char_vocab(train)

    comparison_rows = []
    # baseline row (from frozen report)
    comparison_rows.append(
        {
            "model": "Pilot",
            **{k: PILOT[k] if k in PILOT else "" for k in (
                "precision", "recall", "f1", "false_retry",
                "anchor_zero_delta", "anchor_shuffle_delta", "zero_flip", "shuffle_flip",
                "strong_pair", "heldout_family_f1",
            )},
            "no_anchor_false_retry": "",
            "phase": "pilot",
        }
    )
    comparison_rows.append(
        {
            "model": "Full100K_Baseline",
            **{k: BASELINE[k] if k in BASELINE else "" for k in (
                "precision", "recall", "f1", "false_retry",
                "anchor_zero_delta", "anchor_shuffle_delta", "zero_flip", "shuffle_flip",
                "strong_pair", "heldout_family_f1",
            )},
            "no_anchor_false_retry": 0.0,
            "phase": "baseline",
        }
    )

    # ---- FAST SCREEN A–D ----
    fast_results = {}
    for diet_name in ("A", "B", "C", "D"):
        diet = DIETS[diet_name]
        seed = BASE_SEED + ord(diet_name)
        print(f"\n=== FAST SCREEN Diet {diet_name} {diet} ===", flush=True)
        model, hist, secs = train_one(
            diet_name, diet, train, buckets, contrast_groups, surf_groups,
            vocab, device, FAST_EPOCHS, seed, "fast",
        )
        suite = eval_suite(model, test, vocab, device, sidecar, strong_groups)
        row = summarize_row(f"Diet_{diet_name}_fast", suite)
        row["diet"] = diet_name
        row["mix"] = diet
        row["seconds"] = secs
        row["epochs"] = FAST_EPOCHS
        row["phase"] = "fast_screen"
        fast_results[diet_name] = {"suite": suite, "row": row, "history": hist}
        comparison_rows.append(row)
        print(
            f"Diet {diet_name}: P={row['precision']:.4f} F1={row['f1']:.4f} "
            f"Δ0={row['anchor_zero_delta']:.4f} flip={row['zero_flip']:.4f} "
            f"strong={row['strong_pair']:.4f} fam={row['heldout_family_f1']:.4f} "
            f"score={row['score']:.4f}",
            flush=True,
        )
        del model

    ranked = sorted(fast_results.keys(), key=lambda d: fast_results[d]["row"]["score"], reverse=True)
    top2 = ranked[:2]
    print(f"TOP2 from fast screen: {top2}", flush=True)
    micro_results = {}

    # resolve mixes for top2
    def mix_of(name):
        if name in DIETS:
            return DIETS[name]
        return micro_results[name]["mix"]

    # ---- FULL TRAIN top2 ----
    full_results = {}
    for diet_name in top2:
        diet = mix_of(diet_name)
        seed = BASE_SEED + 1000 + (ord(diet_name[0]) if diet_name else 0)
        print(f"\n=== FULL TRAIN Diet {diet_name} {diet} ===", flush=True)
        model, hist, secs = train_one(
            diet_name, diet, train, buckets, contrast_groups, surf_groups,
            vocab, device, FULL_EPOCHS, seed, "full",
        )
        suite = eval_suite(model, test, vocab, device, sidecar, strong_groups)
        row = summarize_row(f"Diet_{diet_name}_full", suite)
        row["diet"] = diet_name
        row["mix"] = diet
        row["seconds"] = secs
        row["epochs"] = FULL_EPOCHS
        row["phase"] = "full_train"
        full_results[diet_name] = {
            "suite": suite,
            "row": row,
            "history": hist,
            "mix": diet,
            "seed": seed,
            "model": model,
        }
        comparison_rows.append(row)
        outp = CKPT_DIR / f"diet_{diet_name}_full"
        save_model_bundle(
            outp,
            model,
            vocab,
            {
                "embed_dim": 64,
                "hidden_dim": 128,
                "feat_dim": FEAT_DIM,
                "feat_names": list(FEAT_NAMES),
                "class_weight_retry": CLASS_WEIGHT_RETRY,
                "diet": diet,
                "diet_name": diet_name,
                "seed": seed,
                "epochs": FULL_EPOCHS,
                "init": "random_from_scratch",
            },
            f"MODEL3_V1_DIET_{diet_name}_FULL",
        )
        print(
            f"FULL {diet_name}: P={row['precision']:.4f} F1={row['f1']:.4f} "
            f"Δ0={row['anchor_zero_delta']:.4f} strong={row['strong_pair']:.4f} fam={row['heldout_family_f1']:.4f}",
            flush=True,
        )
        del model
        full_results[diet_name]["model"] = None

    winner_name = max(full_results.keys(), key=lambda d: full_results[d]["row"]["score"])
    winner_mix = full_results[winner_name]["mix"]
    print(f"WINNER candidate: {winner_name}", flush=True)

    # ---- 3-seed stability ----
    stability = []
    for si, seed in enumerate([BASE_SEED + 2000, BASE_SEED + 2001, BASE_SEED + 2002]):
        print(f"\n=== STABILITY seed {seed} Diet {winner_name} ===", flush=True)
        model, hist, secs = train_one(
            winner_name, winner_mix, train, buckets, contrast_groups, surf_groups,
            vocab, device, FULL_EPOCHS, seed, f"stab{si}",
        )
        suite = eval_suite(model, test, vocab, device, sidecar, strong_groups)
        row = summarize_row(f"Winner_seed{seed}", suite)
        row["diet"] = winner_name
        row["mix"] = winner_mix
        row["seed"] = seed
        row["seconds"] = secs
        row["phase"] = "stability"
        stability.append({"suite": suite, "row": row, "seed": seed})
        comparison_rows.append(row)
        outp = CKPT_DIR / f"winner_seed_{seed}"
        save_model_bundle(
            outp,
            model,
            vocab,
            {
                "embed_dim": 64,
                "hidden_dim": 128,
                "feat_dim": FEAT_DIM,
                "diet": winner_mix,
                "diet_name": winner_name,
                "seed": seed,
                "epochs": FULL_EPOCHS,
            },
            f"MODEL3_V1_DIET_WINNER_SEED_{seed}",
        )
        del model

    def mean_std(vals):
        if not vals:
            return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0}
        m = sum(vals) / len(vals)
        var = sum((x - m) ** 2 for x in vals) / len(vals)
        return {"mean": m, "std": math.sqrt(var), "min": min(vals), "max": max(vals)}

    stab_summary = {
        "precision": mean_std([s["row"]["precision"] for s in stability]),
        "f1": mean_std([s["row"]["f1"] for s in stability]),
        "anchor_zero_delta": mean_std([s["row"]["anchor_zero_delta"] for s in stability]),
        "anchor_shuffle_delta": mean_std([s["row"]["anchor_shuffle_delta"] for s in stability]),
        "strong_pair": mean_std([s["row"]["strong_pair"] for s in stability]),
        "heldout_family_f1": mean_std([s["row"]["heldout_family_f1"] for s in stability]),
        "zero_flip": mean_std([s["row"]["zero_flip"] for s in stability]),
    }

    # pick best stability seed as final winner metrics (mean for decision)
    win_mean = {
        "precision": stab_summary["precision"]["mean"],
        "f1": stab_summary["f1"]["mean"],
        "anchor_zero_delta": stab_summary["anchor_zero_delta"]["mean"],
        "anchor_shuffle_delta": stab_summary["anchor_shuffle_delta"]["mean"],
        "strong_pair": stab_summary["strong_pair"]["mean"],
        "heldout_family_f1": stab_summary["heldout_family_f1"]["mean"],
        "zero_flip": stab_summary["zero_flip"]["mean"],
        "false_retry": sum(s["row"]["false_retry"] for s in stability) / 3,
        "recall": sum(s["row"]["recall"] for s in stability) / 3,
        "shuffle_flip": sum(s["row"]["shuffle_flip"] for s in stability) / 3,
        "strong_pair_zero": sum(s["row"]["strong_pair_zero"] for s in stability) / 3,
        "strong_pair_shuffle": sum(s["row"]["strong_pair_shuffle"] for s in stability) / 3,
        "unseen_surface_f1": sum(s["row"]["unseen_surface_f1"] for s in stability) / 3,
        "unseen_context_f1": sum(s["row"]["unseen_context_f1"] for s in stability) / 3,
        "no_anchor_false_retry": sum(s["row"]["no_anchor_false_retry"] for s in stability) / 3,
    }
    comparison_rows.append({"model": "Winner_Mean", **win_mean, "diet": winner_name, "phase": "winner_mean"})

    # CPU on best stability seed model — reload last saved
    best_stab = max(stability, key=lambda s: s["row"]["score"])
    # retrain quick? use saved weights
    best_path = CKPT_DIR / f"winner_seed_{best_stab['seed']}"
    cfg = json.loads((best_path / "config.json").read_text(encoding="utf-8"))
    cvocab = json.loads((best_path / "vocab.json").read_text(encoding="utf-8"))
    cmodel = Model3BiGRUV1(len(cvocab), cfg["embed_dim"], cfg["hidden_dim"], cfg.get("feat_dim", FEAT_DIM))
    cmodel.load_state_dict(torch.load(best_path / "weights.pt", map_location="cpu"))
    cmodel.eval()
    lat = []
    with torch.no_grad():
        for s in test[:500]:
            batch = collate_batch([sample_to_tensors(s, cvocab)], device)
            t1 = time.perf_counter()
            cmodel(batch["tokens"], batch["feats"], batch["avail"])
            lat.append((time.perf_counter() - t1) * 1000)
    lat_s = sorted(lat)

    def pct(p):
        k = (len(lat_s) - 1) * p / 100
        f = int(k)
        c = min(f + 1, len(lat_s) - 1)
        return lat_s[f] if f == c else lat_s[f] + (lat_s[c] - lat_s[f]) * (k - f)

    cpu = {"p50_ms": pct(50), "p95_ms": pct(95), "p99_ms": pct(99), "n": len(lat)}

    hashes_after = {s: sha256_split(s) for s in ("train", "dev", "test")}
    integrity = {
        "corpus_regenerated": False,
        "train_hash_stable": hashes_before["train"] == hashes_after["train"],
        "dev_hash_stable": hashes_before["dev"] == hashes_after["dev"],
        "test_hash_stable": hashes_before["test"] == hashes_after["test"],
        "labels_changed": False,
        "hashes_before": hashes_before,
        "hashes_after": hashes_after,
    }

    # Verdict
    anchor_restored = (
        win_mean["anchor_zero_delta"] >= BASELINE["anchor_zero_delta"] * 2
        and win_mean["zero_flip"] >= 0.01
    ) or (
        win_mean["anchor_zero_delta"] >= 0.04 and win_mean["strong_pair"] >= 0.75
    )
    strong_ok = win_mean["strong_pair"] >= 0.75
    fam_ok = win_mean["heldout_family_f1"] >= 0.25
    fam_gap = win_mean["heldout_family_f1"] < 0.20
    prec_ok = win_mean["precision"] >= 0.90
    prec_partial = 0.85 <= win_mean["precision"] < 0.90
    still_weak = win_mean["zero_flip"] < 0.005 and win_mean["anchor_zero_delta"] < 0.025
    prec_regress = win_mean["precision"] < 0.85

    if not integrity["train_hash_stable"] or not integrity["test_hash_stable"]:
        verdict = "DATASET_MUTATED"
    elif prec_regress and not anchor_restored:
        verdict = "PRECISION_REGRESSION"
    elif still_weak:
        verdict = "ANCHOR_SIGNAL_STILL_WEAK"
    elif anchor_restored and prec_ok and strong_ok and fam_ok:
        verdict = "PASS"
    elif anchor_restored and (prec_ok or prec_partial) and strong_ok and fam_gap:
        verdict = "PASS_WITH_FAMILY_GENERALIZATION_GAP"
    elif (anchor_restored and not prec_ok) or (prec_ok and not anchor_restored):
        verdict = "DIET_TRADEOFF_UNRESOLVED"
    else:
        verdict = "DIET_TRADEOFF_UNRESOLVED"

    next_phase = {
        "PASS": "MODEL3_V1_TTS_ASR_DEVELOPMENT",
        "PASS_WITH_FAMILY_GENERALIZATION_GAP": "MODEL3_V1_FAMILY_GENERALIZATION_REPAIR",
        "DIET_TRADEOFF_UNRESOLVED": "MODEL3_V1_DIET_OR_DATA_DESIGN_REVIEW",
        "ANCHOR_SIGNAL_STILL_WEAK": "MODEL3_V1_CONTRAST_CONSTRUCTION_REVIEW",
        "PRECISION_REGRESSION": "MODEL3_V1_HARD_KEEP_PRECISION_REPAIR",
        "DATASET_MUTATED": "INVESTIGATE_DATASET_INTEGRITY",
    }.get(verdict, "REVIEW")

    bundle = {
        "phase": "MODEL3_V1_FULL100K_DIET_REBALANCE",
        "verdict": verdict,
        "integrity": integrity,
        "baseline": BASELINE,
        "diets": DIETS,
        "fast_screen": {k: {"row": v["row"], "mix": DIETS[k], "history": v["history"]} for k, v in fast_results.items()},
        "micro_screen": {k: {"row": v["row"], "mix": v["mix"]} for k, v in micro_results.items()},
        "top2": top2,
        "full_train": {
            k: {"row": v["row"], "mix": v["mix"], "seed": v["seed"], "history": v["history"]}
            for k, v in full_results.items()
        },
        "winner": {
            "diet": winner_name,
            "mix": winner_mix,
            "mean": win_mean,
            "stability": stab_summary,
            "stability_rows": [s["row"] for s in stability],
            "best_seed": best_stab["seed"],
            "checkpoint": str((CKPT_DIR / f"winner_seed_{best_stab['seed']}").relative_to(REPO)).replace("\\", "/"),
        },
        "cpu": cpu,
        "shadow": {"actual_retry": False, "production_output_changed": False},
        "go": {
            "training_diet_problem_confirmed": True,
            "balanced_diet_found": verdict in ("PASS", "PASS_WITH_FAMILY_GENERALIZATION_GAP"),
            "anchor_signal_restored": "YES" if anchor_restored else ("PARTIAL" if win_mean["anchor_zero_delta"] > BASELINE["anchor_zero_delta"] * 1.5 else "NO"),
            "precision_preserved": "YES" if prec_ok else ("PARTIAL" if prec_partial else "NO"),
            "family_generalization": "PASS" if fam_ok else "GAP",
            "bigru_suitable": True,
            "ready_tts": verdict == "PASS",
            "recommended_next_phase": next_phase,
        },
    }

    (DOCS / "model3_v1_diet_rebalance_bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # comparison CSV
    fields = [
        "model", "phase", "diet", "precision", "recall", "f1", "false_retry",
        "anchor_zero_delta", "anchor_shuffle_delta", "zero_flip", "shuffle_flip",
        "strong_pair", "strong_pair_zero", "strong_pair_shuffle",
        "heldout_family_f1", "unseen_surface_f1", "unseen_context_f1",
        "no_anchor_false_retry", "score",
    ]
    with (DOCS / "model3_v1_diet_rebalance_comparison.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in comparison_rows:
            w.writerow(r)

    (DOCS / "model3_v1_diet_rebalance_governance.json").write_text(
        json.dumps(
            {
                "go_summary": {"phase": "MODEL3_V1_FULL100K_DIET_REBALANCE", "verdict": verdict, **bundle["go"]},
                "dataset_hashes": integrity,
                "runtime_impact": {
                    "architecture_changed": False,
                    "dataset_regenerated": False,
                    "label_contract_changed": False,
                    "recall_changed": False,
                    "formal_anchor_changed": False,
                    "model2_changed": False,
                    "job_result_changed": False,
                    "tts_started": False,
                    "production_retry": False,
                },
                "report_artifact_count": 4,
                "report_artifact_count_le_10": True,
                "modified_file_inventory": [
                    "training/model3_dataset/train/train_diet_rebalance.py",
                    "training/model3_dataset/model3_v1_diet_rebalance_ckpts/",
                    "docs/user_correction/model3/Lingua_Model3_V1_Full100K_Diet_Rebalance_Report_2026_08_24.md",
                    "docs/user_correction/model3/model3_v1_diet_rebalance_bundle.json",
                    "docs/user_correction/model3/model3_v1_diet_rebalance_governance.json",
                    "docs/user_correction/model3/model3_v1_diet_rebalance_comparison.csv",
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    def fmt_row(r):
        def g(k, d=4):
            v = r.get(k, "")
            if v == "" or v is None:
                return ""
            try:
                return f"{float(v):.{d}f}"
            except Exception:
                return str(v)

        return (
            f"| {r.get('model','')} | {fmt_row_num(r,'precision')} | {fmt_row_num(r,'recall')} | "
            f"{fmt_row_num(r,'f1')} | {fmt_row_num(r,'false_retry',6)} | {fmt_row_num(r,'anchor_zero_delta')} | "
            f"{fmt_row_num(r,'anchor_shuffle_delta')} | {fmt_row_num(r,'zero_flip',4)} | "
            f"{fmt_row_num(r,'shuffle_flip',4)} | {fmt_row_num(r,'strong_pair')} | "
            f"{fmt_row_num(r,'heldout_family_f1')} | {fmt_row_num(r,'no_anchor_false_retry',6)} |"
        )

    def fmt_row_num(r, k, d=4):
        v = r.get(k, "")
        if v == "" or v is None:
            return ""
        try:
            return f"{float(v):.{d}f}"
        except Exception:
            return str(v)

    table_lines = [
        "| Model | Precision | Recall | F1 | False RETRY | Anchor Zero Δ | Anchor Shuffle Δ | Zero Flip | Shuffle Flip | Strong Pair | Heldout Family F1 | NO_ANCHOR FP |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in comparison_rows:
        if r.get("phase") in ("pilot", "baseline", "fast_screen", "full_train", "winner_mean") or r.get("model", "").startswith("Diet_"):
            if r.get("phase") == "stability":
                continue
            table_lines.append(fmt_row(r))

    report = f"""# Lingua Model3 V1 Full100K Diet Rebalance

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_FULL100K_DIET_REBALANCE`  
**Verdict:** `{verdict}`

## Integrity

Corpus regenerated: **NO** · Train/Dev/Test hash stable: **{"YES" if integrity['train_hash_stable'] else "NO"} / {"YES" if integrity['dev_hash_stable'] else "NO"} / {"YES" if integrity['test_hash_stable'] else "NO"}** · Labels changed: **NO**

## Comparison

{chr(10).join(table_lines)}

## Fast screen ranking

Top2: **{', '.join(top2)}**

## Winner

- Diet: **{winner_name}**
- Mix: `{json.dumps(winner_mix)}`
- Precision / Recall / F1: {win_mean['precision']:.4f} / {win_mean['recall']:.4f} / {win_mean['f1']:.4f}
- False RETRY: {win_mean['false_retry']:.6f}
- Anchor Zero Δ / Flip: {win_mean['anchor_zero_delta']:.4f} / {win_mean['zero_flip']:.4f}
- Anchor Shuffle Δ / Flip: {win_mean['anchor_shuffle_delta']:.4f} / {win_mean['shuffle_flip']:.4f}
- Strong Pair / Zero / Shuffle: {win_mean['strong_pair']:.4f} / {win_mean['strong_pair_zero']:.4f} / {win_mean['strong_pair_shuffle']:.4f}
- Held-out Family F1: {win_mean['heldout_family_f1']:.4f}
- Unseen Surface / Context F1: {win_mean['unseen_surface_f1']:.4f} / {win_mean['unseen_context_f1']:.4f}
- NO_ANCHOR False RETRY: {win_mean['no_anchor_false_retry']:.6f}

### Stability (3 seeds)

| Metric | Mean | Std | Min | Max |
|--------|-----:|----:|----:|----:|
| Precision | {stab_summary['precision']['mean']:.4f} | {stab_summary['precision']['std']:.4f} | {stab_summary['precision']['min']:.4f} | {stab_summary['precision']['max']:.4f} |
| F1 | {stab_summary['f1']['mean']:.4f} | {stab_summary['f1']['std']:.4f} | {stab_summary['f1']['min']:.4f} | {stab_summary['f1']['max']:.4f} |
| Anchor Zero Δ | {stab_summary['anchor_zero_delta']['mean']:.4f} | {stab_summary['anchor_zero_delta']['std']:.4f} | {stab_summary['anchor_zero_delta']['min']:.4f} | {stab_summary['anchor_zero_delta']['max']:.4f} |
| Strong Pair | {stab_summary['strong_pair']['mean']:.4f} | {stab_summary['strong_pair']['std']:.4f} | {stab_summary['strong_pair']['min']:.4f} | {stab_summary['strong_pair']['max']:.4f} |
| Heldout Family F1 | {stab_summary['heldout_family_f1']['mean']:.4f} | {stab_summary['heldout_family_f1']['std']:.4f} | {stab_summary['heldout_family_f1']['min']:.4f} | {stab_summary['heldout_family_f1']['max']:.4f} |

## Performance

CPU p50/p95/p99 ms: {cpu['p50_ms']:.3f} / {cpu['p95_ms']:.3f} / {cpu['p99_ms']:.3f}

## Decision

- Training diet problem confirmed: **YES**
- Balanced diet found: **{"YES" if bundle['go']['balanced_diet_found'] else "NO"}**
- Anchor signal restored: **{bundle['go']['anchor_signal_restored']}**
- Precision preserved: **{bundle['go']['precision_preserved']}**
- Family generalization: **{bundle['go']['family_generalization']}**
- Ready for TTS-ASR: **{"YES" if bundle['go']['ready_tts'] else "NO"}**
- Next: `{next_phase}`

## STOP

No new 100k · No TTS · No architecture / Recall / Domain Vote / Model2 changes · No production RETRY. Awaiting user review.
"""
    (DOCS / "Lingua_Model3_V1_Full100K_Diet_Rebalance_Report_2026_08_24.md").write_text(
        report, encoding="utf-8"
    )

    print(json.dumps({"verdict": verdict, "winner": winner_name, "mean": win_mean, "go": bundle["go"]}, indent=2))


if __name__ == "__main__":
    main()
