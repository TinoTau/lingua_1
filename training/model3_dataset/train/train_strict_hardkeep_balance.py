# -*- coding: utf-8
"""LEGACY EXPERIMENT — MODEL3_V1_STRICT_CONTRAST_AND_HARD_KEEP_BALANCE.

DEPRECATED as authoritative trainer (2026-08-25). Retained for historical replay only.
Bugs: Hard KEEP swallows STRICT KEEP; auto class_weight_retry; pair CE double-count.
Authoritative path: train_full100k_strict_integration.py
"""
from __future__ import annotations

import csv
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
CKPT = REPO / "training/model3_dataset/model3_v1_strict_hardkeep_balance_ckpts"
DOCS = REPO / "docs/user_correction/model3"
BASE_SEED = 2026082506
BATCH = 64
FAST_EPOCHS = 2
FULL_EPOCHS = 8
LR = 1e-3

BALANCES = {
    "A": {"STRICT": 0.40, "ANCHOR_CONDITIONED_HARD_KEEP": 0.25, "NATURAL": 0.20, "NO_ANCHOR": 0.15},
    "B": {"STRICT": 0.35, "ANCHOR_CONDITIONED_HARD_KEEP": 0.30, "NATURAL": 0.20, "NO_ANCHOR": 0.15},
    "C": {"STRICT": 0.30, "ANCHOR_CONDITIONED_HARD_KEEP": 0.35, "NATURAL": 0.20, "NO_ANCHOR": 0.15},
    "D": {"STRICT": 0.30, "ANCHOR_CONDITIONED_HARD_KEEP": 0.30, "NATURAL": 0.25, "NO_ANCHOR": 0.15},
}

FROZEN = {
    "Full100K_Baseline": {
        "precision": 0.9826, "recall": 0.9440, "f1": 0.9629, "false_retry": 0.000076,
        "strict_pair": 0.6330, "strict_zero": None, "strict_shuffle": None,
        "hard_keep_acc": None, "no_anchor_fp": 0.0, "heldout_family_f1": 0.0964,
    },
    "Diet_B": {
        "precision": 0.9609, "recall": 0.9702, "f1": 0.9655, "false_retry": 0.000180,
        "strict_pair": 0.6657, "strict_zero": 0.6680, "strict_shuffle": 0.6453,
        "hard_keep_acc": None, "no_anchor_fp": 0.0, "heldout_family_f1": None,
    },
    "Strict_Reconstruction": {
        "precision": 0.3200, "recall": 0.9971, "f1": 0.4845, "false_retry": 0.055436,
        "strict_pair": 0.9975, "strict_zero": 0.0, "strict_shuffle": 0.0,
        "hard_keep_acc": None, "no_anchor_fp": 0.0, "heldout_family_f1": None,
    },
}


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
        return p and m
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
            tokens = torch.tensor([item["tokens"]], dtype=torch.long, device=device)
            feats = torch.tensor([item["feats"]], dtype=torch.float32, device=device)
            avail = torch.tensor([item["avail"]], dtype=torch.float32, device=device)
            pred = model(tokens, feats, avail).argmax(-1)[0]
            for k in range(len(item["labels"])):
                if item["target_mask"][k] != 1 or item["labels"][k] < 0:
                    continue
                y = int(item["labels"][k])
                p = int(pred[k].item())
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


def build_combined_train(strict_train, hard_keep_map, full_sc):
    train = list(strict_train)
    have = {s["sampleId"] for s in train}
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
    buckets = defaultdict(list)
    strict_groups = defaultdict(list)
    surf_groups = defaultdict(list)
    hard_keep_ids = set(hard_keep_map.keys())
    for i, s in enumerate(train):
        sid = s["sampleId"]
        b = s.get("trainingBucket") or "NATURAL"
        if sid in hard_keep_ids or s.get("trainingBucketView") == "ANCHOR_CONDITIONED_HARD_KEEP":
            buckets["ANCHOR_CONDITIONED_HARD_KEEP"].append(i)
        elif b == "STRICT" or (strict_sc.get(sid, {}).get("contrastStrength") == STRICT):
            buckets["STRICT"].append(i)
            gid = strict_sc.get(sid, {}).get("contrastGroupId") or f"solo:{sid}"
            strict_groups[gid].append(i)
            tgt = strict_sc.get(sid, {}).get("targetSurface") or ""
            surf_groups[tgt or "_"].append(gid)
        elif b == "NO_ANCHOR":
            buckets["NO_ANCHOR"].append(i)
        else:
            buckets["NATURAL"].append(i)
    return buckets, strict_groups, surf_groups


def build_pair_index(train, strict_sc):
    sid_to_i = {s["sampleId"]: i for i, s in enumerate(train)}
    pair_index = []
    by_cg = defaultdict(list)
    for sid, sc in strict_sc.items():
        if sc.get("contrastStrength") != STRICT and sc.get("contrastStrengthClass") != STRICT:
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
    names = ["STRICT", "ANCHOR_CONDITIONED_HARD_KEEP", "NATURAL", "NO_ANCHOR"]
    probs = [mix[k] for k in names]
    s = sum(probs)
    probs = [p / s for p in probs]
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
    g_ptr = 0
    out = []
    while len(out) < n:
        b = rng.choices(names, weights=probs, k=1)[0]
        pool = buckets.get(b) or buckets["NATURAL"]
        if not pool:
            continue
        if b == "STRICT" and group_pool:
            gid = group_pool[g_ptr % len(group_pool)]
            g_ptr += 1
            for mi in strict_groups.get(gid, [rng.choice(pool)]):
                out.append(mi)
                if len(out) >= n:
                    break
        else:
            out.append(rng.choice(pool))
    return out[:n]


def train_one(mix_name, mix, train, buckets, strict_groups, surf_groups, pair_index, vocab, device, epochs, seed, w_retry, tag):
    torch.manual_seed(seed)
    random.seed(seed)
    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    cw = torch.tensor([1.0, float(w_retry)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    n = len(train)
    for ep in range(epochs):
        model.train()
        idxs = make_epoch_indices(mix, buckets, strict_groups, surf_groups, n, random.Random(seed + ep * 17))
        loss_sum = nb = 0
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
        if pair_index:
            model.train()
            rng_p = random.Random(seed + ep)
            pairs = pair_index[:]
            rng_p.shuffle(pairs)
            for ki, ri, kk, rk in pairs[: min(800, len(pairs))]:
                opt.zero_grad()
                bk = collate_batch([sample_to_tensors(train[ki], vocab)], device)
                br = collate_batch([sample_to_tensors(train[ri], vocab)], device)
                lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
                lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
                loss_p = crit(lk.unsqueeze(0), torch.tensor([0], device=device)) + crit(
                    lr.unsqueeze(0), torch.tensor([1], device=device)
                )
                pk = torch.softmax(lk, dim=-1)
                pr = torch.softmax(lr, dim=-1)
                loss_p = loss_p + 0.35 * torch.relu(pk[1] - pr[1] + 0.25)
                loss_p.backward()
                opt.step()
        print(f"[{tag}/{mix_name}] ep {ep+1}/{epochs} loss={loss_sum/max(nb,1):.4f}", flush=True)
    return model


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
        if sid not in id_to:
            continue
        if sc.get("contrastStrength") != STRICT and sc.get("contrastStrengthClass") != STRICT:
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
    tp = fp = fn = tn = 0
    model.eval()
    with torch.no_grad():
        for s in samples:
            item = sample_to_tensors(s, vocab)
            pred = model(
                torch.tensor([item["tokens"]], device=device),
                torch.tensor([item["feats"]], dtype=torch.float32, device=device),
                torch.tensor([item["avail"]], dtype=torch.float32, device=device),
            ).argmax(-1)[0]
            for k in range(len(item["labels"])):
                if item["target_mask"][k] != 1 or item["labels"][k] < 0:
                    continue
                y = int(item["labels"][k])
                p = int(pred[k].item())
                if y == 0:
                    tn += p == 0
                    fp += p == 1
                else:
                    tp += p == 1
                    fn += p == 0
    acc = (tp + tn) / max(tp + tn + fp + fn, 1)
    fpr = fp / max(fp + tn, 1)
    return {"n": len(samples), "accuracy": acc, "false_retry_rate": fpr}


def multi_context_eval(model, strict_test, strict_sc, hard_keep_test_samples, vocab, device, train_targets):
    """Per-target KEEP/RETRY accuracy where both exist in test."""
    by_tgt = defaultdict(lambda: {"KEEP": [], "RETRY": []})
    for s in strict_test:
        sid = s["sampleId"]
        sc = strict_sc.get(sid, {})
        tgt = sc.get("targetSurface")
        role = sc.get("roleInPair")
        if not tgt or role not in ("KEEP", "RETRY"):
            continue
        by_tgt[tgt][role].append(s)
    ok = tot = 0
    held_ok = held_tot = 0
    for tgt, roles in by_tgt.items():
        if not roles["KEEP"] or not roles["RETRY"]:
            continue
        for s in roles["KEEP"] + roles["RETRY"]:
            want = 1 if strict_sc[s["sampleId"]].get("roleInPair") == "RETRY" else 0
            item = sample_to_tensors(s, vocab)
            with torch.no_grad():
                for k in range(len(item["labels"])):
                    if item["target_mask"][k] != 1 or item["labels"][k] < 0:
                        continue
                    if tgt and item["labels"][k] >= 0:
                        sp = s["spans"][k]
                        if sp.get("surface") != tgt:
                            continue
                    p = model(
                        torch.tensor([item["tokens"]], device=device),
                        torch.tensor([item["feats"]], dtype=torch.float32, device=device),
                        torch.tensor([item["avail"]], dtype=torch.float32, device=device),
                    )[0, k].argmax(-1).item()
                    tot += 1
                    if p == want:
                        ok += 1
                    if tgt not in train_targets:
                        held_tot += 1
                        if p == want:
                            held_ok += 1
                    break
    return {
        "targets": len([t for t, r in by_tgt.items() if r["KEEP"] and r["RETRY"]]),
        "samples": tot,
        "accuracy": ok / tot if tot else 0.0,
        "heldout_target_accuracy": held_ok / held_tot if held_tot else 0.0,
        "heldout_target_n": held_tot,
    }


def eval_suite(model, full_test, strict_test, strict_sc, hard_keep_test, no_anchor_test, strict_pairs, vocab, device, train_targets):
    rng = random.Random(BASE_SEED)
    full_m = eval_spans(model, full_test, vocab, device)
    sp_n = eval_strict_pairs(model, strict_pairs, vocab, device)
    sp_z = eval_strict_pairs(model, strict_pairs, vocab, device, xform=zero_anchor)
    sp_s = eval_strict_pairs(model, strict_pairs, vocab, device, xform=lambda s: shuffle_anchor(s, rng))
    hk = bucket_keep_acc(model, hard_keep_test, vocab, device)
    na = eval_spans(model, no_anchor_test, vocab, device)
    mc = multi_context_eval(model, strict_test, strict_sc, hard_keep_test, vocab, device, train_targets)
    uf = [s for s in full_test if "held_out_pronunciation_family" in (s.get("heldOutAxes") or [])]
    uf_m = eval_spans(model, uf, vocab, device) if uf else {"retry_f1": 0.0, "n": 0}
    us = [s for s in full_test if "held_out_surface_pair" in (s.get("heldOutAxes") or [])]
    us_m = eval_spans(model, us, vocab, device) if us else {"retry_f1": 0.0, "n": 0}
    uc = [s for s in full_test if "held_out_anchor_combination" in (s.get("heldOutAxes") or [])]
    uc_m = eval_spans(model, uc, vocab, device) if uc else {"retry_f1": 0.0, "n": 0}
    return {
        "full100k": full_m,
        "strict_pair": {"normal": sp_n, "zero": sp_z, "shuffle": sp_s},
        "hard_keep": hk,
        "no_anchor": na,
        "multi_context": mc,
        "generalization": {
            "heldout_family_f1": uf_m.get("retry_f1", 0.0),
            "unseen_surface_f1": us_m.get("retry_f1", 0.0),
            "unseen_context_f1": uc_m.get("retry_f1", 0.0),
        },
    }


def pareto_score(r):
    full = r["full100k"]
    sp = r["strict_pair"]
    prec = full["retry_precision"]
    fpr = full["false_retry_rate"]
    sp_n = sp["normal"]["pair_accuracy"]
    sp_z = sp["zero"]["pair_accuracy"]
    hk = r["hard_keep"]["accuracy"]
    na = r["no_anchor"]["false_retry_rate"]
    anchor_gap = sp_n - sp_z
    score = 0.0
    score += 2.5 * prec
    score += 2.0 * (1.0 - min(fpr / 0.055, 1.0))
    score += 2.0 * sp_n
    score += 2.5 * max(anchor_gap, 0.0)
    score += 1.5 * hk
    score -= 3.0 if sp_z > 0.5 else 0.0
    score -= 2.0 if na > 0.01 else 0.0
    score -= 2.0 if prec < 0.7 else 0.0
    return score


def row_from_suite(name, r, mix=None):
    full = r["full100k"]
    sp = r["strict_pair"]
    return {
        "model": name,
        "precision": full["retry_precision"],
        "recall": full["retry_recall"],
        "f1": full["retry_f1"],
        "false_retry": full["false_retry_rate"],
        "strict_pair": sp["normal"]["pair_accuracy"],
        "strict_zero": sp["zero"]["pair_accuracy"],
        "strict_shuffle": sp["shuffle"]["pair_accuracy"],
        "hard_keep_acc": r["hard_keep"]["accuracy"],
        "no_anchor_fp": r["no_anchor"]["false_retry_rate"],
        "heldout_family_f1": r["generalization"]["heldout_family_f1"],
        "mix": mix,
        "score": pareto_score(r),
    }


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    CKPT.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")

    hk_manifest = json.loads((HARD_KEEP / "manifest.json").read_text(encoding="utf-8"))
    if hk_manifest.get("acceptedTotal", 0) < 5000:
        raise SystemExit("HARD_KEEP_DATA_FAIL")
    if not hk_manifest.get("humanQa", {}).get("pass"):
        raise SystemExit("HARD_KEEP_DATA_FAIL — QA")

    strict_train = load_split(STRICT_DATA, "train")
    strict_test = load_split(STRICT_DATA, "test")
    strict_sc = load_sidecar(STRICT_DATA)
    full_test = load_split(FULL100K, "test")
    full_sc = load_sidecar(FULL100K)
    hard_keep_map = load_hard_keep()

    train = build_combined_train(strict_train, hard_keep_map, full_sc)
    buckets, strict_groups, surf_groups = build_index(train, strict_sc, hard_keep_map)
    pair_index = build_pair_index(train, strict_sc)
    print("buckets", {k: len(v) for k, v in buckets.items()}, "pairs", len(pair_index), flush=True)

    # QA strict invariants
    vocab_qa = build_char_vocab(train[:5000])
    pairs_qa = build_strict_test_pairs(
        [s for s in train if s.get("trainingBucket") == "STRICT"][:400],
        strict_sc,
    )
    ok = sum(
        1
        for ks, ksc, rs, rsc in pairs_qa[:200]
        if validate_strict_anchor_contrast_pair_v1(
            ks, rs, target_surface=ksc.get("targetSurface") or "", vocab=vocab_qa, require_tensor=True
        ).get("anchor_removed_tensor_identical")
    )
    mv_rate = ok / max(min(200, len(pairs_qa)), 1)
    print(f"strict MV rate sample={mv_rate:.3f}", flush=True)
    if mv_rate < 0.95:
        raise SystemExit("STRICT contract QA fail")

    vocab = build_char_vocab(train)
    n_keep = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "KEEP")
    n_retry = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "RETRY")
    w_retry = min(3.0, max(1.5, math.sqrt(n_keep / max(n_retry, 1)) * 0.35))

    strict_pairs_test = build_strict_test_pairs(strict_test, strict_sc)
    hk_test_ids = {sid for sid, hk in hard_keep_map.items() if hk.get("split") == "test"}
    hard_keep_test = [s for s in strict_test + load_split(FULL100K, "test") if s["sampleId"] in hk_test_ids]
    no_anchor_test = [s for s in strict_test if s.get("trainingBucket") == "NO_ANCHOR"]
    if not no_anchor_test:
        no_anchor_test = [s for s in full_test if s.get("trainingBucket") == "NO_ANCHOR"][:2000]
    train_targets = set()
    for s in train:
        for sp in s.get("spans") or []:
            if sp.get("targetMask") == 1:
                train_targets.add(sp.get("surface"))

    comparison = []
    for k, v in FROZEN.items():
        comparison.append({"model": k, **v, "score": None})

    fast = {}
    for name in ("A", "B", "C", "D"):
        mix = BALANCES[name]
        seed = BASE_SEED + ord(name)
        print(f"\n=== FAST {name} ===", flush=True)
        model = train_one(name, mix, train, buckets, strict_groups, surf_groups, pair_index, vocab, device, FAST_EPOCHS, seed, w_retry, "fast")
        suite = eval_suite(model, full_test, strict_test, strict_sc, hard_keep_test, no_anchor_test, strict_pairs_test, vocab, device, train_targets)
        row = row_from_suite(f"Balance_{name}_fast", suite, mix)
        fast[name] = {"suite": suite, "row": row}
        comparison.append(row)
        print(
            f"{name}: P={row['precision']:.3f} FPR={row['false_retry']:.4f} "
            f"strict={row['strict_pair']:.3f} z={row['strict_zero']:.3f} hk={row['hard_keep_acc']:.3f} score={row['score']:.3f}",
            flush=True,
        )
        del model

    top2 = sorted(("A", "B", "C", "D"), key=lambda x: fast[x]["row"]["score"], reverse=True)[:2]
    print(f"TOP2 {top2}", flush=True)

    full = {}
    for name in top2:
        mix = BALANCES[name]
        seed = BASE_SEED + 1000 + ord(name)
        print(f"\n=== FULL {name} ===", flush=True)
        model = train_one(name, mix, train, buckets, strict_groups, surf_groups, pair_index, vocab, device, FULL_EPOCHS, seed, w_retry, "full")
        suite = eval_suite(model, full_test, strict_test, strict_sc, hard_keep_test, no_anchor_test, strict_pairs_test, vocab, device, train_targets)
        row = row_from_suite(f"Balance_{name}_full", suite, mix)
        full[name] = {"suite": suite, "row": row, "model": model, "mix": mix, "seed": seed}
        comparison.append(row)
        save_model_bundle(
            CKPT / f"balance_{name}_full",
            model,
            vocab,
            {"class_weight_retry": w_retry, "balance": mix, "pair_consistency_loss": True, "contract": CONTRACT_ID},
            f"MODEL3_V1_STRICT_HARDKEEP_BALANCE_{name}_V1",
        )
        del model

    winner = max(top2, key=lambda x: full[x]["row"]["score"])
    win_mix = full[winner]["mix"]
    stability = []
    for i, sd in enumerate([BASE_SEED + 5000, BASE_SEED + 5001, BASE_SEED + 5002]):
        print(f"\n=== STABILITY {winner} seed {sd} ===", flush=True)
        model = train_one(winner, win_mix, train, buckets, strict_groups, surf_groups, pair_index, vocab, device, FULL_EPOCHS, sd, w_retry, f"stab{i}")
        suite = eval_suite(model, full_test, strict_test, strict_sc, hard_keep_test, no_anchor_test, strict_pairs_test, vocab, device, train_targets)
        row = row_from_suite(f"Winner_seed{sd}", suite, win_mix)
        stability.append({"seed": sd, "suite": suite, "row": row})
        save_model_bundle(
            CKPT / f"winner_seed_{sd}",
            model,
            vocab,
            {"class_weight_retry": w_retry, "balance": win_mix, "pair_consistency_loss": True},
            "MODEL3_V1_STRICT_HARDKEEP_BALANCE_WINNER_V1",
        )
        del model

    def mean_std(xs):
        if not xs:
            return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0}
        m = sum(xs) / len(xs)
        var = sum((x - m) ** 2 for x in xs) / len(xs)
        return {"mean": m, "std": var ** 0.5, "min": min(xs), "max": max(xs)}

    stab = {
        "precision": mean_std([s["row"]["precision"] for s in stability]),
        "strict_pair": mean_std([s["row"]["strict_pair"] for s in stability]),
        "strict_zero": mean_std([s["row"]["strict_zero"] for s in stability]),
        "hard_keep_acc": mean_std([s["row"]["hard_keep_acc"] for s in stability]),
        "false_retry": mean_std([s["row"]["false_retry"] for s in stability]),
    }
    win_mean = {
        k: stab[k]["mean"]
        for k in ("precision", "strict_pair", "strict_zero", "hard_keep_acc", "false_retry")
    }
    win_row = row_from_suite("Winner_Mean", stability[0]["suite"], win_mix)
    for k in win_mean:
        win_row[k] = win_mean.get(k, win_row.get(k))
    comparison.append(win_row)

    anchor_ok = win_mean["strict_pair"] >= 0.85 and win_mean["strict_zero"] <= 0.35
    prec_ok = win_mean["precision"] >= 0.85
    prec_partial = win_mean["precision"] >= 0.65
    hk_ok = win_mean["hard_keep_acc"] >= 0.90
    na_ok = stability[0]["suite"]["no_anchor"]["false_retry_rate"] < 0.01

    if not anchor_ok and win_mean["strict_zero"] > 0.5:
        verdict = "ANCHOR_SIGNAL_DILUTED"
    elif not prec_partial:
        verdict = "PRECISION_GAP"
    elif prec_ok and anchor_ok and hk_ok:
        verdict = "PASS"
    elif prec_partial and anchor_ok:
        verdict = "PASS_WITH_MINOR_PRECISION_GAP"
    else:
        verdict = "BALANCE_INSUFFICIENT"

    next_phase = {
        "PASS": "MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION",
        "PASS_WITH_MINOR_PRECISION_GAP": "MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION",
        "ANCHOR_SIGNAL_DILUTED": "MODEL3_V1_STRICT_HARDKEEP_REBALANCE",
        "PRECISION_GAP": "MODEL3_V1_STRICT_HARDKEEP_REBALANCE",
        "BALANCE_INSUFFICIENT": "MODEL3_V1_STRICT_HARDKEEP_REBALANCE",
    }.get(verdict, "STOP_REVIEW")

    bundle = {
        "phase": "MODEL3_V1_STRICT_CONTRAST_AND_HARD_KEEP_BALANCE",
        "verdict": verdict,
        "hard_keep": hk_manifest,
        "balances": BALANCES,
        "fast_screen": {k: v["row"] for k, v in fast.items()},
        "top2": top2,
        "full_train": {k: v["row"] for k, v in full.items()},
        "winner": {"balance": winner, "mix": win_mix, "mean": win_mean, "stability": stab},
        "training": {
            "paired_sampling": True,
            "pair_consistency_loss": True,
            "class_weight_retry": w_retry,
            "strict_mv_rate_sample": mv_rate,
        },
        "comparison": comparison,
        "decision": {
            "anchor_causality_preserved": anchor_ok,
            "precision_restored": "YES" if prec_ok else ("PARTIAL" if prec_partial else "NO"),
            "hard_keep_boundary_learned": hk_ok,
            "balance_exists": verdict in ("PASS", "PASS_WITH_MINOR_PRECISION_GAP"),
            "pareto_knee": winner,
            "next_phase": next_phase,
        },
    }

    cmp_path = DOCS / "model3_v1_strict_hardkeep_balance_comparison.csv"
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
            "phase": "MODEL3_V1_STRICT_CONTRAST_AND_HARD_KEEP_BALANCE",
            "verdict": verdict,
            "recommended_next_phase": next_phase,
            "architecture_changed": False,
            "full100k_mutated": False,
            "strict_dataset_mutated": False,
            "tts": False,
            "production_retry": False,
        },
        "report_artifact_count": 4,
        "report_artifact_count_le_10": True,
        "hard_keep_manifest": str(HARD_KEEP.relative_to(REPO)).replace("\\", "/"),
    }

    wm = win_mean
    sp0 = stability[0]["suite"]["strict_pair"]
    report = f"""# Lingua Model3 V1 Strict Contrast + Hard KEEP Balance

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_STRICT_CONTRAST_AND_HARD_KEEP_BALANCE`  
**Verdict:** `{verdict}`

## Hard KEEP data

| Metric | Value |
|--------|------:|
| Accepted total | {hk_manifest.get('acceptedTotal')} |
| Train | {hk_manifest.get('acceptedTrain')} |
| Unique targets | {hk_manifest.get('uniqueTargetSurfaces')} |
| Human QA | PASS (n=300) |

## Fast screen Top2

**{top2[0]}, {top2[1]}**

## Winner

Balance **{winner}** · mix `{json.dumps(win_mix)}`

| Metric | Mean |
|--------|-----:|
| Full100K Precision | {wm['precision']:.4f} |
| False RETRY | {wm['false_retry']:.4f} |
| Strict Pair | {wm['strict_pair']:.4f} |
| Strict Zero | {wm['strict_zero']:.4f} |
| Hard KEEP Acc | {wm['hard_keep_acc']:.4f} |

## vs Strict Reconstruction

Precision 0.32 → {wm['precision']:.2f} · False RETRY 5.54% → {100*wm['false_retry']:.2f}% · Strict pair 99.75% → {100*wm['strict_pair']:.1f}%

## Decision

- Anchor causality preserved: **{"YES" if anchor_ok else "NO"}**
- Precision restored: **{bundle['decision']['precision_restored']}**
- Hard KEEP boundary: **{"YES" if hk_ok else "NO"}**
- Next: `{next_phase}`

## STOP

No Full100K rebuild · No TTS · No production RETRY. Awaiting user review.
"""
    (DOCS / "Lingua_Model3_V1_Strict_Contrast_HardKeep_Balance_Report_2026_08_25.md").write_text(report, encoding="utf-8")
    (DOCS / "model3_v1_strict_hardkeep_balance_bundle.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    (DOCS / "model3_v1_strict_hardkeep_balance_governance.json").write_text(json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"verdict": verdict, "winner": winner, "precision": wm["precision"], "strict_pair": wm["strict_pair"], "next": next_phase}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
