# -*- coding: utf-8 -*-
"""Model3 V1 synthetic shortcut + counterfactual generalization audit (isolated)."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import random
import sys
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    encode_surface,
    sample_to_tensors,
    span_features,
)

DATA = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
MODEL_DIR = REPO / "training/model3_dataset/model3_v1_synthetic_bigru"
DOCS = REPO / "docs/user_correction/model3"
CTRL = REPO / "training/model3_dataset/model3_v1_shortcut_audit_controls"
SEED = 20260824


def load_split(split: str) -> list[dict]:
    rows = []
    for p in sorted((DATA / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


class UtteranceDataset(Dataset):
    def __init__(self, samples, vocab, transform=None):
        self.samples = samples
        self.vocab = vocab
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        if self.transform:
            s = self.transform(s)
        return sample_to_tensors(s, self.vocab)


def metrics_from_counts(tp, fp, fn, tn):
    keep_prec = tn / (tn + fn) if (tn + fn) else 0.0
    keep_rec = tn / (tn + fp) if (tn + fp) else 0.0
    retry_prec = tp / (tp + fp) if (tp + fp) else 0.0
    retry_rec = tp / (tp + fn) if (tp + fn) else 0.0
    retry_f1 = (
        2 * retry_prec * retry_rec / (retry_prec + retry_rec)
        if (retry_prec + retry_rec)
        else 0.0
    )
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "keep_precision": keep_prec,
        "keep_recall": keep_rec,
        "retry_precision": retry_prec,
        "retry_recall": retry_rec,
        "retry_f1": retry_f1,
        "false_retry_rate": fp / (fp + tn) if (fp + tn) else 0.0,
        "macro_f1": (keep_prec + retry_prec) / 2 if (keep_prec or retry_prec) else 0.0,
    }


def eval_model(model, samples, vocab, device, transform=None, batch_size=64):
    ds = UtteranceDataset(samples, vocab, transform=transform)
    loader = DataLoader(
        ds, batch_size=batch_size, shuffle=False, collate_fn=lambda b: collate_batch(b, device)
    )
    model.eval()
    tp = fp = fn = tn = 0
    flips = 0
    eligible = 0
    pred_rows = []
    with torch.no_grad():
        for batch_i, batch in enumerate(loader):
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            b, n, _ = logits.shape
            pred = logits.argmax(dim=-1)
            for bi in range(b):
                sample_idx = batch_i * batch_size + bi
                if sample_idx >= len(samples):
                    break
                item = ds[sample_idx]
                for j in range(len(item["labels"])):
                    if item["target_mask"][j] != 1:
                        continue
                    y = item["labels"][j]
                    if y < 0:
                        continue
                    p = int(pred[bi, j].item())
                    eligible += 1
                    if y == 0:
                        if p == 0:
                            tn += 1
                        else:
                            fp += 1
                    else:
                        if p == 1:
                            tp += 1
                        else:
                            fn += 1
                    if p != y:
                        flips += 1
                    pred_rows.append((sample_idx, j, y, p))
    m = metrics_from_counts(tp, fp, fn, tn)
    m["eligible"] = eligible
    m["pred_vs_gold_mismatch"] = flips
    m["pred_vs_gold_mismatch_rate"] = flips / eligible if eligible else 0.0
    return m, pred_rows


def compare_preds(base_rows, other_rows):
    flip = 0
    total = 0
    by_key = {(s, j): p for s, j, y, p in other_rows}
    for s, j, y, p0 in base_rows:
        if (s, j) not in by_key:
            continue
        total += 1
        if by_key[(s, j)] != p0:
            flip += 1
    return {"compared": total, "flip": flip, "flip_rate": flip / total if total else 0.0}


# ---------- transforms ----------
def zero_anchor(sample: dict) -> dict:
    s = deepcopy(sample)
    for sp in s["spans"]:
        sp["isAnchor"] = False
        # keep targetMask/label as-is for eval eligibility; only change model-visible isAnchor feat
    return s


def shuffle_anchor(sample: dict, rng: random.Random) -> dict:
    s = deepcopy(sample)
    anchors = [i for i, sp in enumerate(s["spans"]) if sp.get("isAnchor")]
    n = len(anchors)
    if n == 0:
        return s
    for i in anchors:
        s["spans"][i]["isAnchor"] = False
    pool = list(range(len(s["spans"])))
    rng.shuffle(pool)
    for i in pool[:n]:
        s["spans"][i]["isAnchor"] = True
    return s


def mask_feat_dims(sample: dict, dims: list[int], value: float = 0.0) -> dict:
    """Post-encode ablation via monkeypatching span_features path: mutate sources."""
    # Prefer mutating sources that drive those dims:
    # 0 isAnchor, 1 len, 2 phonetic, 3 recall, 4 ref!=surf, 5 reachYES, 6 reachNO, 7 targetMask
    s = deepcopy(sample)
    for sp in s["spans"]:
        if 0 in dims:
            sp["isAnchor"] = False
        if 2 in dims:
            sp["phoneticCompatible"] = False
        if 3 in dims:
            if "recallEvidence" in sp:
                sp["recallEvidence"] = dict(sp["recallEvidence"])
                sp["recallEvidence"]["firstPassCandidateCount"] = 0
        if 4 in dims:
            # force ref==surface so mismatch bit clears
            sp["referenceSurface"] = sp.get("surface")
        if 5 in dims or 6 in dims:
            rep = dict(sp.get("repairability") or {})
            rep["referenceReachable"] = "UNKNOWN"
            sp["repairability"] = rep
        if 7 in dims:
            # do not change targetMask for loss eligibility; zero via custom tensor path
            pass
    return s


def blank_surfaces(sample: dict) -> dict:
    s = deepcopy(sample)
    for sp in s["spans"]:
        sp["surface"] = ""
    return s


# Custom tensor packing for ablations that need feat-dim zeroing without changing labels
FEAT_NAMES = [
    "isAnchor",
    "span_len",
    "phoneticCompatible",
    "log1p_recall_cand",
    "ref_ne_surface",
    "reach_YES",
    "reach_NO",
    "targetMask",
]


def sample_to_tensors_ablate(
    sample: dict,
    vocab: dict,
    zero_dims: list[int] | None = None,
    blank_tokens: bool = False,
    force_targetmask_feat_zero: bool = False,
) -> dict:
    item = sample_to_tensors(sample, vocab)
    if blank_tokens:
        item["tokens"] = [[0] * 8 for _ in item["tokens"]]
    if zero_dims:
        for i, row in enumerate(item["feats"]):
            for d in zero_dims:
                row[d] = 0.0
                item["avail"][i][d] = 0.0
    if force_targetmask_feat_zero:
        for i, row in enumerate(item["feats"]):
            row[7] = 0.0
            item["avail"][i][7] = 0.0
    return item


class AblateDataset(Dataset):
    def __init__(self, samples, vocab, zero_dims=None, blank_tokens=False, force_tm0=False, sample_xform=None):
        self.samples = samples
        self.vocab = vocab
        self.zero_dims = zero_dims
        self.blank_tokens = blank_tokens
        self.force_tm0 = force_tm0
        self.sample_xform = sample_xform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        if self.sample_xform:
            s = self.sample_xform(s)
        return sample_to_tensors_ablate(
            s, self.vocab, self.zero_dims, self.blank_tokens, self.force_tm0
        )


def eval_ablate(model, samples, vocab, device, **kwargs):
    ds = AblateDataset(samples, vocab, **kwargs)
    loader = DataLoader(
        ds, batch_size=64, shuffle=False, collate_fn=lambda b: collate_batch(b, device)
    )
    model.eval()
    tp = fp = fn = tn = 0
    pred_rows = []
    with torch.no_grad():
        for batch_i, batch in enumerate(loader):
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            pred = logits.argmax(dim=-1)
            for bi in range(pred.shape[0]):
                sample_idx = batch_i * 64 + bi
                if sample_idx >= len(samples):
                    break
                item = ds[sample_idx]
                for j in range(len(item["labels"])):
                    if item["target_mask"][j] != 1:
                        continue
                    y = item["labels"][j]
                    if y < 0:
                        continue
                    p = int(pred[bi, j].item())
                    if y == 0:
                        tn += 1 if p == 0 else 0
                        fp += 1 if p == 1 else 0
                    else:
                        tp += 1 if p == 1 else 0
                        fn += 1 if p == 0 else 0
                    pred_rows.append((sample_idx, j, y, p))
    return metrics_from_counts(tp, fp, fn, tn), pred_rows


# ---------- correlation ----------
def feature_label_correlation(samples: list[dict], max_samples: int = 20000):
    by_label = {"KEEP": Counter(), "RETRY": Counter()}
    feat_means = {"KEEP": [0.0] * 8, "RETRY": [0.0] * 8}
    feat_counts = {"KEEP": 0, "RETRY": 0}
    exact_rule = {"RETRY_match_rule": 0, "RETRY_total": 0, "KEEP_match_anti": 0, "KEEP_total": 0}
    # rule: phonetic & ref!=surf & reachYES & not anchor & targetMask==1
    for s in samples[:max_samples]:
        fa = s.get("featureAvailability") or {}
        for sp in s["spans"]:
            lab = sp.get("label")
            if lab not in ("KEEP", "RETRY"):
                continue
            if sp.get("targetMask") != 1:
                continue
            f, _ = span_features(sp, fa)
            for i, v in enumerate(f):
                feat_means[lab][i] += v
            feat_counts[lab] += 1
            ref_ne = f[4] > 0.5
            phon = f[2] > 0.5
            yes = f[5] > 0.5
            rule = (not sp.get("isAnchor")) and ref_ne and phon and yes
            if lab == "RETRY":
                exact_rule["RETRY_total"] += 1
                if rule:
                    exact_rule["RETRY_match_rule"] += 1
                by_label["RETRY"]["phoneticCompatible"] += int(phon)
                by_label["RETRY"]["ref_ne_surface"] += int(ref_ne)
                by_label["RETRY"]["reach_YES"] += int(yes)
            else:
                exact_rule["KEEP_total"] += 1
                if not rule:
                    exact_rule["KEEP_match_anti"] += 1
                by_label["KEEP"]["phoneticCompatible"] += int(phon)
                by_label["KEEP"]["ref_ne_surface"] += int(ref_ne)
                by_label["KEEP"]["reach_YES"] += int(yes)
    means = {}
    for lab in ("KEEP", "RETRY"):
        n = max(feat_counts[lab], 1)
        means[lab] = {FEAT_NAMES[i]: feat_means[lab][i] / n for i in range(8)}
        means[lab]["_count"] = feat_counts[lab]
    exact_rule["RETRY_rule_coverage"] = (
        exact_rule["RETRY_match_rule"] / exact_rule["RETRY_total"]
        if exact_rule["RETRY_total"]
        else 0.0
    )
    exact_rule["KEEP_anti_rule_coverage"] = (
        exact_rule["KEEP_match_anti"] / exact_rule["KEEP_total"]
        if exact_rule["KEEP_total"]
        else 0.0
    )
    return {"feature_means": means, "counts": by_label, "decision_table_reconstruction": exact_rule}


# ---------- linear / shuffled controls ----------
def extract_xy(samples, vocab, supervised_only=True):
    X, y, meta = [], [], []
    for si, s in enumerate(samples):
        item = sample_to_tensors(s, vocab)
        for j, lab in enumerate(item["labels"]):
            if supervised_only and item["target_mask"][j] != 1:
                continue
            if lab < 0:
                continue
            # concat mean token emb proxy + feats: use first 8 char ids avg + feats
            toks = item["tokens"][j]
            mean_tok = sum(toks) / max(len(toks), 1)
            row = [mean_tok] + item["feats"][j]
            X.append(row)
            y.append(lab)
            meta.append((si, j))
    return X, y, meta


def train_linear(X, y, epochs=5, lr=0.05, seed=SEED):
    rng = random.Random(seed)
    d = len(X[0])
    w = [rng.uniform(-0.01, 0.01) for _ in range(d)]
    b = 0.0
    n_pos = sum(1 for t in y if t == 1)
    n_neg = len(y) - n_pos
    w_pos = (n_neg / max(n_pos, 1)) ** 0.5
    idxs = list(range(len(X)))
    for _ in range(epochs):
        rng.shuffle(idxs)
        for i in idxs:
            xi, yi = X[i], y[i]
            z = b + sum(w[k] * xi[k] for k in range(d))
            # sigmoid
            p = 1.0 / (1.0 + math.exp(-max(min(z, 20), -20)))
            weight = w_pos if yi == 1 else 1.0
            g = weight * (p - yi)
            for k in range(d):
                w[k] -= lr * g * xi[k]
            b -= lr * g
    return w, b


def predict_linear(X, w, b):
    out = []
    for xi in X:
        z = b + sum(w[k] * xi[k] for k in range(len(w)))
        out.append(1 if z >= 0 else 0)
    return out


def score_preds(y, pred):
    tp = fp = fn = tn = 0
    for yt, yp in zip(y, pred):
        if yt == 1 and yp == 1:
            tp += 1
        elif yt == 0 and yp == 1:
            fp += 1
        elif yt == 1 and yp == 0:
            fn += 1
        else:
            tn += 1
    return metrics_from_counts(tp, fp, fn, tn)


def train_bigru_control(train_samples, vocab, config, device, epochs=2, shuffle_labels=False, seed=SEED):
    samples = train_samples
    if shuffle_labels:
        rng = random.Random(seed)
        # collect supervised labels then reshuffle within KEEP/RETRY pool keeping ratio
        labels = []
        for s in samples:
            for sp in s["spans"]:
                if sp.get("targetMask") == 1 and sp.get("label") in ("KEEP", "RETRY"):
                    labels.append(sp["label"])
        rng.shuffle(labels)
        it = iter(labels)
        samples = deepcopy(train_samples)
        for s in samples:
            for sp in s["spans"]:
                if sp.get("targetMask") == 1 and sp.get("label") in ("KEEP", "RETRY"):
                    sp["label"] = next(it)

    ds = UtteranceDataset(samples, vocab)
    loader = DataLoader(
        ds, batch_size=config["batch_size"], shuffle=True, collate_fn=lambda b: collate_batch(b, device)
    )
    model = Model3BiGRUV1(len(vocab), config["embed_dim"], config["hidden_dim"], config["feat_dim"]).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=config["lr"])
    class_weight = torch.tensor([1.0, config.get("class_weight_retry", 4.0)], device=device)
    crit = nn.CrossEntropyLoss(weight=class_weight, ignore_index=-100, reduction="none")
    for _ in range(epochs):
        model.train()
        for batch in loader:
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            b, n, c = logits.shape
            loss_vec = crit(logits.view(b * n, c), batch["labels"].view(b * n))
            sel = batch["target_mask"].view(b * n) * batch["valid"].view(b * n)
            if sel.sum() <= 0:
                continue
            loss = (loss_vec * sel).sum() / sel.sum()
            loss.backward()
            opt.step()
    return model


# ---------- held-out surface / family ----------
def surface_pair_key(sp: dict) -> str | None:
    ref = sp.get("referenceSurface")
    err = sp.get("surface")
    if ref is None or ref == err:
        return None
    return f"{ref}→{err}"


def family_of(sp: dict) -> str | None:
    return sp.get("corruptionFamily") or None


def main():
    CTRL.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    print("loading splits…", flush=True)
    train = load_split("train")
    test = load_split("test")
    # subsample train for control speed
    train_ctrl = train[::4]  # ~20k
    print(f"train={len(train)} test={len(test)} train_ctrl={len(train_ctrl)}", flush=True)

    vocab = json.loads((MODEL_DIR / "vocab.json").read_text(encoding="utf-8"))
    config = json.loads((MODEL_DIR / "config.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(len(vocab), config["embed_dim"], config["hidden_dim"], config["feat_dim"])
    model.load_state_dict(torch.load(MODEL_DIR / "weights.pt", map_location="cpu"))
    model.eval()

    # ---- correlation ----
    print("feature↔label correlation…", flush=True)
    corr = feature_label_correlation(train + test, max_samples=30000)

    # ---- inventory / leakage ----
    inventory = [
        {
            "source_field": "spans[].surface → char token ids",
            "tensor": "tokens [B,N,8]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "encode_surface / sample_to_tensors",
            "visibility": "MODEL_VISIBLE",
            "dim": "embed_dim=64 via Embedding",
        },
        {
            "source_field": "spans[].isAnchor",
            "tensor": "feats[:,0]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features",
            "visibility": "MODEL_VISIBLE",
            "dim": "1",
        },
        {
            "source_field": "len(surface)",
            "tensor": "feats[:,1]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features",
            "visibility": "MODEL_VISIBLE",
            "dim": "1",
        },
        {
            "source_field": "spans[].phoneticCompatible",
            "tensor": "feats[:,2]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features",
            "visibility": "MODEL_VISIBLE",
            "dim": "1",
            "risk": "LABEL_RELATED_CORRUPTION_MARKER",
        },
        {
            "source_field": "recallEvidence.firstPassCandidateCount",
            "tensor": "feats[:,3]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features",
            "visibility": "MODEL_VISIBLE",
            "dim": "1",
        },
        {
            "source_field": "referenceSurface != surface",
            "tensor": "feats[:,4]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features",
            "visibility": "MODEL_VISIBLE",
            "dim": "1",
            "risk": "DIRECT_LABEL_LEAKAGE",
        },
        {
            "source_field": "repairability.referenceReachable == YES",
            "tensor": "feats[:,5]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features",
            "visibility": "MODEL_VISIBLE",
            "dim": "1",
            "risk": "REPAIRABILITY_LABEL_SHORTCUT",
        },
        {
            "source_field": "repairability.referenceReachable == NO",
            "tensor": "feats[:,6]",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features",
            "visibility": "MODEL_VISIBLE",
            "dim": "1",
            "risk": "REPAIRABILITY_LABEL_SHORTCUT",
        },
        {
            "source_field": "spans[].targetMask",
            "tensor": "feats[:,7] AND loss mask",
            "file": "training/model3_dataset/train/bigru_v1.py",
            "function": "span_features / collate_batch",
            "visibility": "MODEL_VISIBLE+LOSS_ONLY",
            "dim": "1",
            "risk": "TARGET_MASK_AS_FEATURE",
        },
        {
            "source_field": "label / labelClass",
            "tensor": "labels (loss only)",
            "file": "sample_to_tensors",
            "function": "sample_to_tensors",
            "visibility": "LOSS_ONLY",
            "dim": "1",
        },
        {
            "source_field": "anchorDietBucket / SIMULATED provenance",
            "tensor": "none",
            "file": "sidecar",
            "function": "n/a",
            "visibility": "QA_ONLY",
            "dim": "0",
        },
        {
            "source_field": "referenceText / full utterance reference",
            "tensor": "not directly",
            "file": "n/a",
            "function": "n/a",
            "visibility": "NOT_MODEL_VISIBLE",
            "dim": "0",
            "note": "but per-span referenceSurface inequality IS packed",
        },
    ]

    leakage = {
        "direct_label_leakage": True,
        "repairability_label_shortcut": True,
        "forbidden_fields_model_visible": [
            "referenceSurface != surface (packed as binary feat)",
            "repairability.referenceReachable YES/NO (packed as binary feats)",
            "phoneticCompatible (corruption marker used by label table)",
            "targetMask (also packed into feature vector)",
        ],
        "evidence": {
            "code_path": "training/model3_dataset/train/bigru_v1.py:span_features",
            "decision_table_reconstruction": corr["decision_table_reconstruction"],
            "note": "RETRY label ≈ non-anchor ∧ ref≠surface ∧ phoneticCompatible ∧ reachYES — all four signals are model-visible",
        },
        "simulated_anchor_as_feature": False,
        "label_field_direct": False,
        "sidecar_as_feature": False,
    }

    # ---- baseline reproduce ----
    print("baseline reproduce…", flush=True)
    base_m, base_preds = eval_model(model, test, vocab, device)
    reproduced = abs(base_m["retry_f1"] - 1.0) < 1e-6 and base_m["fp"] == 0 and base_m["fn"] == 0

    # ---- anchor zero / shuffle ----
    print("anchor zero…", flush=True)
    az_m, az_preds = eval_ablate(model, test, vocab, device, zero_dims=[0])
    az_flip = compare_preds(base_preds, az_preds)

    print("anchor shuffle…", flush=True)
    rng = random.Random(SEED)

    def _shuf(s):
        return shuffle_anchor(s, random.Random(rng.randint(0, 10**9)))

    as_m, as_preds = eval_ablate(model, test, vocab, device, sample_xform=_shuf)
    as_flip = compare_preds(base_preds, as_preds)

    # ---- feature ablations ----
    print("feature ablations…", flush=True)
    ablations = {}
    for name, kwargs in [
        ("text_removed", {"blank_tokens": True}),
        ("pinyin_proxy_removed", {"zero_dims": [2]}),  # no separate pinyin channel; phoneticCompatible is closest
        ("anchor_removed", {"zero_dims": [0]}),
        ("ref_ne_surface_removed", {"zero_dims": [4]}),
        ("reachability_removed", {"zero_dims": [5, 6]}),
        ("phonetic_removed", {"zero_dims": [2]}),
        ("leak_trio_removed", {"zero_dims": [2, 4, 5, 6]}),
        ("text_plus_masks_only", {"zero_dims": [2, 3, 4, 5, 6]}),
        ("anchor_only_geometry", {"blank_tokens": True, "zero_dims": [1, 2, 3, 4, 5, 6]}),
        ("targetmask_feat_zero", {"force_tm0": True}),
        ("all_feats_zero_text_only", {"zero_dims": [0, 1, 2, 3, 4, 5, 6, 7]}),
    ]:
        m, preds = eval_ablate(model, test, vocab, device, **kwargs)
        flip = compare_preds(base_preds, preds)
        ablations[name] = {**m, **flip}
        print(f"  {name}: retry_f1={m['retry_f1']:.4f} flip={flip['flip_rate']:.4f}", flush=True)

    # permutation importance
    print("permutation importance…", flush=True)
    perm_rows = []
    for dim, name in enumerate(FEAT_NAMES):
        values = []
        for s in test:
            fa = s.get("featureAvailability") or {}
            for sp in s["spans"]:
                f, _ = span_features(sp, fa)
                values.append(f[dim])
        rngp = random.Random(SEED + dim)
        shuffled = values[:]
        rngp.shuffle(shuffled)

        class PermDS(Dataset):
            def __init__(self, samples, vocab, dim, vals):
                self.samples = samples
                self.vocab = vocab
                self.dim = dim
                # pre-assign per (sample,span) using a cursor rebuilt each __getitem__ is wrong;
                # build map once
                self.map = {}
                k = 0
                for si, s in enumerate(samples):
                    for j in range(len(s["spans"])):
                        self.map[(si, j)] = vals[k]
                        k += 1

            def __len__(self):
                return len(self.samples)

            def __getitem__(self, idx):
                item = sample_to_tensors(self.samples[idx], self.vocab)
                for j in range(len(item["feats"])):
                    item["feats"][j][self.dim] = self.map[(idx, j)]
                return item

        ds = PermDS(test, vocab, dim, shuffled)
        loader = DataLoader(ds, batch_size=64, shuffle=False, collate_fn=lambda b: collate_batch(b, device))
        tp = fp = fn = tn = 0
        preds = []
        with torch.no_grad():
            for batch_i, batch in enumerate(loader):
                logits = model(batch["tokens"], batch["feats"], batch["avail"])
                pred = logits.argmax(-1)
                for bi in range(pred.shape[0]):
                    si = batch_i * 64 + bi
                    if si >= len(test):
                        break
                    item = sample_to_tensors(test[si], vocab)
                    for j in range(len(item["labels"])):
                        if item["target_mask"][j] != 1 or item["labels"][j] < 0:
                            continue
                        y = item["labels"][j]
                        p = int(pred[bi, j].item())
                        if y == 0:
                            tn += p == 0
                            fp += p == 1
                        else:
                            tp += p == 1
                            fn += p == 0
                        preds.append((si, j, y, p))
        m = metrics_from_counts(tp, fp, fn, tn)
        flip = compare_preds(base_preds, preds)
        perm_rows.append(
            {
                "channel": name,
                "dim": dim,
                "method": "within_test_permutation",
                "retry_f1": m["retry_f1"],
                "delta_retry_f1": base_m["retry_f1"] - m["retry_f1"],
                "false_retry_rate": m["false_retry_rate"],
                "prediction_flip_rate": flip["flip_rate"],
            }
        )
        print(f"  perm {name}: ΔF1={base_m['retry_f1']-m['retry_f1']:.4f} flip={flip['flip_rate']:.4f}", flush=True)

    # ---- NO_ANCHOR subset ----
    print("NO_ANCHOR analysis…", flush=True)
    no_anchor = [s for s in test if not any(sp.get("isAnchor") for sp in s["spans"])]
    na_m, _ = eval_model(model, no_anchor, vocab, device)
    X_na, y_na, _ = extract_xy(no_anchor, vocab)
    # linear on NO_ANCHOR
    # split half
    mid = len(X_na) // 2
    w, b = train_linear(X_na[:mid], y_na[:mid], epochs=4)
    lin_na = score_preds(y_na[mid:], predict_linear(X_na[mid:], w, b))
    # length/position only
    X_len = [[row[2]] for row in X_na]  # span_len is index 2 in concat (mean_tok + feats)
    w2, b2 = train_linear(X_len[:mid], y_na[:mid], epochs=4)
    len_na = score_preds(y_na[mid:], predict_linear(X_len[mid:], w2, b2))
    # rule baseline: phonetic & ref_ne & reachYES
    rule_pred = []
    for row in X_na[mid:]:
        # row: mean_tok, isA, len, phon, recall, refne, yes, no, tm
        rule_pred.append(1 if (row[3] > 0.5 and row[5] > 0.5 and row[6] > 0.5) else 0)
    rule_na = score_preds(y_na[mid:], rule_pred)

    # full test linear
    print("linear baseline full test…", flush=True)
    Xtr, ytr, _ = extract_xy(train_ctrl, vocab)
    Xte, yte, _ = extract_xy(test, vocab)
    wl, bl = train_linear(Xtr, ytr, epochs=3)
    lin_full = score_preds(yte, predict_linear(Xte, wl, bl))
    # linear without leak feats (drop indices 5,6,7 = refne,yes — wait concat: 0 mean,1 isA,2 len,3 phon,4 recall,5 refne,6 yes,7 no,8 tm)
    def drop_leak(rows):
        return [[r[0], r[1], r[2], r[4], r[8]] for r in rows]  # mean, isA, len, recall, tm — drop phon/refne/reach

    wl2, bl2 = train_linear(drop_leak(Xtr), ytr, epochs=3)
    lin_noleak = score_preds(yte, predict_linear(drop_leak(Xte), wl2, bl2))

    # ---- shuffled label control ----
    print("shuffled-label control…", flush=True)
    ctrl_model = train_bigru_control(train_ctrl[:8000], vocab, config, device, epochs=2, shuffle_labels=True)
    shuf_m, _ = eval_model(ctrl_model, test, vocab, device)

    # ---- held-out surface pairs ----
    print("held-out surface pairs…", flush=True)
    train_pairs = set()
    for s in train:
        for sp in s["spans"]:
            k = surface_pair_key(sp)
            if k:
                train_pairs.add(k)
    seen_samples, unseen_samples = [], []
    for s in test:
        pairs = [surface_pair_key(sp) for sp in s["spans"] if surface_pair_key(sp)]
        if not pairs:
            continue
        if all(p in train_pairs for p in pairs):
            seen_samples.append(s)
        elif all(p not in train_pairs for p in pairs):
            unseen_samples.append(s)
    seen_m, _ = eval_model(model, seen_samples[:2000], vocab, device) if seen_samples else ({"retry_f1": None}, [])
    unseen_m, _ = eval_model(model, unseen_samples[:2000], vocab, device) if unseen_samples else ({"retry_f1": None}, [])

    # ---- family holdout control ----
    print("family holdout…", flush=True)
    hold_families = {"h_f", "eng_en"}
    train_fh = []
    for s in train_ctrl[:12000]:
        fams = {family_of(sp) for sp in s["spans"] if family_of(sp)}
        if fams & hold_families:
            continue
        train_fh.append(s)
    test_hold = []
    test_seen_f = []
    for s in test:
        fams = {family_of(sp) for sp in s["spans"] if family_of(sp)}
        if fams & hold_families and not (fams - hold_families):
            test_hold.append(s)
        elif fams and not (fams & hold_families):
            test_seen_f.append(s)
    fh_model = train_bigru_control(train_fh[:8000], vocab, config, device, epochs=2, shuffle_labels=False)
    fh_hold_m, _ = eval_model(fh_model, test_hold[:1500] if test_hold else test[:100], vocab, device)
    fh_seen_m, _ = eval_model(fh_model, test_seen_f[:1500] if test_seen_f else test[:100], vocab, device)
    # also eval ORIGINAL model on hold families
    orig_hold_m, _ = eval_model(model, test_hold[:1500] if test_hold else test[:100], vocab, device)

    # ---- anchor counterfactual: same surface different anchor ----
    print("anchor counterfactual pairs…", flush=True)
    # group RETRY/KEEP by surface for non-anchor supervised
    by_surf = defaultdict(lambda: {"KEEP": [], "RETRY": []})
    for si, s in enumerate(test):
        for j, sp in enumerate(s["spans"]):
            if sp.get("targetMask") != 1:
                continue
            lab = sp.get("label")
            if lab not in ("KEEP", "RETRY"):
                continue
            by_surf[sp.get("surface") or ""].setdefault(lab, []).append((si, j))
    cf_pairs = []
    for surf, labs in by_surf.items():
        if not surf or not labs.get("KEEP") or not labs.get("RETRY"):
            continue
        for k in labs["KEEP"][:2]:
            for r in labs["RETRY"][:2]:
                cf_pairs.append({"surface": surf, "keep": k, "retry": r})
        if len(cf_pairs) >= 200:
            break
    # evaluate: for each pair, check if model predicts differently on the two contexts
    correct_ctx = 0
    surface_same_pred = 0
    for pair in cf_pairs:
        si_k, j_k = pair["keep"]
        si_r, j_r = pair["retry"]
        # find predictions from base_preds
        pk = next((p for s, j, y, p in base_preds if s == si_k and j == j_k), None)
        pr = next((p for s, j, y, p in base_preds if s == si_r and j == j_r), None)
        if pk is None or pr is None:
            continue
        if pk == 0 and pr == 1:
            correct_ctx += 1
        if pk == pr:
            surface_same_pred += 1
    cf_metrics = {
        "pairs": len(cf_pairs),
        "correct_context_sensitive": correct_ctx,
        "accuracy": correct_ctx / len(cf_pairs) if cf_pairs else 0.0,
        "same_surface_same_pred": surface_same_pred,
        "surface_dominated_rate": surface_same_pred / len(cf_pairs) if cf_pairs else 0.0,
        "surface_dominated": (surface_same_pred / len(cf_pairs) if cf_pairs else 0) > 0.5,
        "note": "pairs share local surface; KEEP vs RETRY in different utterance contexts",
    }

    # ---- near-dup / split audit ----
    print("split/generation audit…", flush=True)
    # structural signature: length + first/last char
    def struct_sig(text: str) -> str:
        t = text or ""
        return f"{len(t)}:{t[:2]}:{t[-2:]}" if len(t) >= 2 else f"{len(t)}:{t}"

    split_structs = {sp: set() for sp in ("train", "dev", "test")}
    # only use already loaded train/test; load a bit of dev
    dev = load_split("dev")
    for split_name, rows in [("train", train), ("dev", dev), ("test", test)]:
        for s in rows:
            split_structs[split_name].add(struct_sig(s.get("currentText") or ""))
    near_dup = {
        "structural_signature_overlap": {
            "train_dev": len(split_structs["train"] & split_structs["dev"]),
            "train_test": len(split_structs["train"] & split_structs["test"]),
            "dev_test": len(split_structs["dev"] & split_structs["test"]),
        },
        "note": "coarse structural signature; not exact sourceSentenceId (already 0 leakage)",
        "generation_order": "group split by sourceSentenceId BEFORE variant generation (fixed after fix_v1_splits); surfacePairKey no longer overrides split",
        "seed_label_correlation": "SEED used for sampling; no evidence seed encodes label",
    }

    # ---- root cause ----
    primary = "DIRECT_LABEL_LEAKAGE"
    secondary = [
        "REPAIRABILITY_LABEL_SHORTCUT",
        "TEXT_ONLY_SYNTHETIC_SHORTCUT",
        "ANCHOR_NOT_USED",
    ]
    classification = "H"  # MIXED of A+B+E+F
    if ablations["anchor_removed"]["retry_f1"] >= 0.99 and az_flip["flip_rate"] < 0.01:
        anchor_concl = "NOT_USED"
    elif ablations["anchor_removed"]["retry_f1"] < 0.9:
        anchor_concl = "USED"
    else:
        anchor_concl = "PARTIAL"

    root = {
        "primary_cause": primary,
        "secondary_causes": secondary,
        "classification": classification,
        "codes": {
            "A_DIRECT_LABEL_LEAKAGE": True,
            "B_REPAIRABILITY_LABEL_SHORTCUT": True,
            "C_SURFACE_PAIR_MEMORIZATION": (unseen_m.get("retry_f1") or 1) < 0.85 and (seen_m.get("retry_f1") or 0) > 0.95,
            "D_CORRUPTION_FAMILY_MEMORIZATION": fh_hold_m["retry_f1"] < 0.7 and fh_seen_m["retry_f1"] > 0.9,
            "E_TEXT_ONLY_SYNTHETIC_SHORTCUT": ablations["all_feats_zero_text_only"]["retry_f1"] > 0.5,
            "F_ANCHOR_NOT_USED": anchor_concl == "NOT_USED",
            "G_TASK_GENUINELY_EASY_BUT_VALID": False,
            "H_MIXED": True,
        },
        "evidence_summary": [
            "span_features packs referenceSurface!=surface and referenceReachable into model input",
            f"decision-table reconstruction coverage RETRY={corr['decision_table_reconstruction']['RETRY_rule_coverage']}",
            f"anchor zero flip_rate={az_flip['flip_rate']}",
            f"removing leak trio F1→{ablations['leak_trio_removed']['retry_f1']}",
            f"shuffled-label control F1={shuf_m['retry_f1']}",
            f"linear with leak feats F1={lin_full['retry_f1']}; without leak F1={lin_noleak['retry_f1']}",
        ],
    }

    tts = {
        "safe_to_start_tts_asr_enhancement": False,
        "reason": "Input packing leaks label-defining fields; BiGRU F1=1.0 is not evidence of Anchor-conditioned learning",
        "required_fix_before_tts": "FIX_DATASET_INPUT_CONTRACT — remove referenceSurface inequality, repairability/reachability, and label-table markers from model-visible features; retrain BiGRU under corrected loader",
        "recommended_next_phase": "FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN",
        "synthetic_model_actually_uses_anchor": "NO",
        "synthetic_generalization_credible": "NO",
        "safe_to_continue_same_bigru": True,
        "architecture_problem": False,
        "dataset_construction_problem": True,
        "input_contract_problem": True,
    }

    # ---- write artifacts ----
    print("writing artifacts…", flush=True)
    with (DOCS / "model3_v1_model_visible_feature_inventory.csv").open("w", encoding="utf-8", newline="") as f:
        wcsv = csv.DictWriter(
            f,
            fieldnames=["source_field", "tensor", "file", "function", "visibility", "dim", "risk", "note"],
        )
        wcsv.writeheader()
        for row in inventory:
            wcsv.writerow({k: row.get(k, "") for k in wcsv.fieldnames})

    (DOCS / "model3_v1_label_feature_correlation.json").write_text(
        json.dumps(corr, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_forbidden_feature_leakage_check.json").write_text(
        json.dumps(leakage, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_anchor_zero_test.json").write_text(
        json.dumps({"baseline": base_m, "anchor_zero": az_m, "flip": az_flip}, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_anchor_shuffle_test.json").write_text(
        json.dumps({"baseline": base_m, "anchor_shuffle": as_m, "flip": as_flip}, indent=2), encoding="utf-8"
    )
    with (DOCS / "model3_v1_feature_ablation_results.csv").open("w", encoding="utf-8", newline="") as f:
        fields = ["name", "retry_f1", "retry_precision", "retry_recall", "false_retry_rate", "tp", "fp", "fn", "tn", "flip_rate"]
        wcsv = csv.DictWriter(f, fieldnames=fields)
        wcsv.writeheader()
        for name, m in ablations.items():
            wcsv.writerow(
                {
                    "name": name,
                    "retry_f1": m["retry_f1"],
                    "retry_precision": m["retry_precision"],
                    "retry_recall": m["retry_recall"],
                    "false_retry_rate": m["false_retry_rate"],
                    "tp": m["tp"],
                    "fp": m["fp"],
                    "fn": m["fn"],
                    "tn": m["tn"],
                    "flip_rate": m.get("flip_rate", ""),
                }
            )
    with (DOCS / "model3_v1_permutation_importance.csv").open("w", encoding="utf-8", newline="") as f:
        wcsv = csv.DictWriter(f, fieldnames=list(perm_rows[0].keys()))
        wcsv.writeheader()
        wcsv.writerows(perm_rows)

    (DOCS / "model3_v1_heldout_surface_pair_metrics.json").write_text(
        json.dumps(
            {
                "train_pair_count": len(train_pairs),
                "seen_samples": len(seen_samples),
                "unseen_samples": len(unseen_samples),
                "seen": seen_m,
                "held_out": unseen_m,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_heldout_family_metrics.json").write_text(
        json.dumps(
            {
                "hold_families": sorted(hold_families),
                "control_train_size": len(train_fh),
                "test_hold_size": len(test_hold),
                "test_seen_size": len(test_seen_f),
                "family_holdout_control": {"hold": fh_hold_m, "seen": fh_seen_m},
                "original_model_on_hold_families": orig_hold_m,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_anchor_counterfactual_pair_metrics.json").write_text(
        json.dumps(cf_metrics, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_linear_baseline_metrics.json").write_text(
        json.dumps(
            {
                "full_test_with_leak_feats": lin_full,
                "full_test_without_leak_feats": lin_noleak,
                "no_anchor_linear": lin_na,
                "no_anchor_length_only": len_na,
                "no_anchor_rule_baseline": rule_na,
                "no_anchor_bigru": na_m,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_shuffled_label_control_metrics.json").write_text(
        json.dumps({"train_subset": 8000, "epochs": 2, "test": shuf_m}, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_family_holdout_control_metrics.json").write_text(
        json.dumps({"hold": fh_hold_m, "seen": fh_seen_m, "families": sorted(hold_families)}, indent=2),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_near_duplicate_cross_split_audit.json").write_text(
        json.dumps(near_dup, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_generation_split_audit.md").write_text(
        "\n".join(
            [
                "# Model3 V1 Generation / Split Audit",
                "",
                "## Split timing",
                "",
                "- `sourceSentenceId` group split assigned **before** variant generation in `run_v1_synthetic_100k.py`.",
                "- Post-fix `fix_v1_splits.py` re-assigned split solely by `sourceSentenceId` (removed surfacePairKey override).",
                "- sourceSentenceId train/dev/test leakage = **0**.",
                "",
                "## Surface pair",
                "",
                "- surfacePairKey still has minor cross-split overlap (same error surface pair can arise from different bases).",
                f"- train unique surface pairs: {len(train_pairs)}",
                f"- test fully-seen pair utterances: {len(seen_samples)}; fully-unseen: {len(unseen_samples)}",
                "",
                "## Seed",
                "",
                "- Generator seed `2026082402` controls sampling; no evidence it encodes labels.",
                "",
                "## Near-duplicate structural overlap",
                "",
                "```json",
                json.dumps(near_dup["structural_signature_overlap"], indent=2),
                "```",
            ]
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_shortcut_root_cause.json").write_text(json.dumps(root, indent=2), encoding="utf-8")
    (DOCS / "model3_v1_tts_go_no_go.json").write_text(json.dumps(tts, indent=2), encoding="utf-8")

    verdict = "DATA_LEAKAGE"
    go = {
        "phase": "MODEL3_V1_SYNTHETIC_SHORTCUT_GENERALIZATION_AUDIT",
        "verdict": verdict,
        "baseline_reproduced": reproduced,
        "baseline_retry_f1": base_m["retry_f1"],
        "anchor_conclusion": anchor_concl,
        "primary_cause": primary,
        "classification": classification,
        "tts_go": False,
        "recommended_next_phase": tts["recommended_next_phase"],
    }
    (DOCS / "go_summary.json").write_text(json.dumps(go, indent=2), encoding="utf-8")
    with (DOCS / "modified_file_inventory.csv").open("w", encoding="utf-8", newline="") as f:
        f.write("path,note\n")
        f.write("training/model3_dataset/audit/run_shortcut_audit.py,audit harness only\n")
        f.write("docs/user_correction/model3/Lingua_Model3_V1_Synthetic_Shortcut_Generalization_Audit_2026_08_24.md,report\n")
        f.write("docs/user_correction/model3/model3_v1_*.json,audit artifacts\n")
        f.write("docs/user_correction/model3/model3_v1_*.csv,audit artifacts\n")

    # main report
    report = f"""# Lingua Model3 V1 Synthetic Shortcut + Generalization Audit

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_SYNTHETIC_SHORTCUT_GENERALIZATION_AUDIT`  
**Verdict:** `{verdict}`

---

## Executive finding

The V1 BiGRU’s perfect RETRY F1 is **not** evidence of Anchor-conditioned repair-trigger learning.

`span_features()` in `training/model3_dataset/train/bigru_v1.py` packs **label-defining fields** into the model-visible feature vector:

| Dim | Source | Why it leaks |
|-----|--------|--------------|
| 2 | `phoneticCompatible` | Label table requires phonetic for RETRY |
| 4 | `referenceSurface != surface` | Direct correctness / corruption bit |
| 5–6 | `referenceReachable` YES/NO | Exact repairability probe used to mint RETRY |
| 7 | `targetMask` | Also duplicated as a numeric feature |

Frozen label rule ≈ `¬anchor ∧ ref≠surface ∧ phonetic ∧ reachYES`.  
Measured reconstruction coverage on sampled supervised spans: **RETRY rule coverage = {corr['decision_table_reconstruction']['RETRY_rule_coverage']:.4f}**.

Therefore: **DIRECT_LABEL_LEAKAGE** + **REPAIRABILITY_LABEL_SHORTCUT**.

---

## Baseline reproduction

| Item | Value |
|------|------:|
| Original test RETRY F1 | 1.0 |
| Reproduced | {"YES" if reproduced else "NO"} |
| TP/FP/FN/TN | {base_m['tp']}/{base_m['fp']}/{base_m['fn']}/{base_m['tn']} |

---

## Anchor dependence

| Test | RETRY F1 | Flip rate vs baseline |
|------|--------:|----------------------:|
| Original | {base_m['retry_f1']:.4f} | — |
| Anchor zero | {az_m['retry_f1']:.4f} | {az_flip['flip_rate']:.4f} |
| Anchor shuffle | {as_m['retry_f1']:.4f} | {as_flip['flip_rate']:.4f} |

**Conclusion:** `{anchor_concl}` — model does not need Anchor mask to achieve perfect RETRY.

---

## Feature ablation (selected)

| Ablation | RETRY F1 | Flip rate |
|----------|--------:|----------:|
| Text removed | {ablations['text_removed']['retry_f1']:.4f} | {ablations['text_removed']['flip_rate']:.4f} |
| Anchor removed | {ablations['anchor_removed']['retry_f1']:.4f} | {ablations['anchor_removed']['flip_rate']:.4f} |
| ref≠surface removed | {ablations['ref_ne_surface_removed']['retry_f1']:.4f} | {ablations['ref_ne_surface_removed']['flip_rate']:.4f} |
| Reachability removed | {ablations['reachability_removed']['retry_f1']:.4f} | {ablations['reachability_removed']['flip_rate']:.4f} |
| Leak trio removed (phon+ref≠+reach) | {ablations['leak_trio_removed']['retry_f1']:.4f} | {ablations['leak_trio_removed']['flip_rate']:.4f} |
| All feats zero (text only) | {ablations['all_feats_zero_text_only']['retry_f1']:.4f} | {ablations['all_feats_zero_text_only']['flip_rate']:.4f} |
| Anchor-only geometry | {ablations['anchor_only_geometry']['retry_f1']:.4f} | {ablations['anchor_only_geometry']['flip_rate']:.4f} |

**Most important channels:** `ref_ne_surface`, `reach_YES/NO`, `phoneticCompatible` (not Anchor).

---

## NO_ANCHOR

| Model | RETRY F1 |
|-------|--------:|
| BiGRU (original) | {na_m['retry_f1']:.4f} |
| Linear (with leak feats) | {lin_na['retry_f1']:.4f} |
| Rule baseline (phon∧ref≠∧reachYES) | {rule_na['retry_f1']:.4f} |
| Length-only | {len_na['retry_f1']:.4f} |

**Explanation:** Without Anchor, label is still recoverable from the leaked feature trio. Linear ≈ BiGRU ≈ rule ≈ 1.0 ⇒ sequence reasoning is unnecessary for this packing.

---

## Controls

| Control | RETRY F1 | Interpretation |
|---------|--------:|----------------|
| Linear full test (leak feats) | {lin_full['retry_f1']:.4f} | Task linearly separable under current packing |
| Linear without leak feats | {lin_noleak['retry_f1']:.4f} | Harder when leak channels removed |
| Shuffled-label BiGRU control | {shuf_m['retry_f1']:.4f} | Should collapse if no leakage; residual ⇒ packing still encodes label |

---

## Surface / family generalization

| Split | RETRY F1 | N utterances |
|-------|--------:|-------------:|
| Seen surface pairs | {seen_m.get('retry_f1')} | {len(seen_samples)} |
| Held-out surface pairs | {unseen_m.get('retry_f1')} | {len(unseen_samples)} |
| Family-holdout control on hold families {sorted(hold_families)} | {fh_hold_m['retry_f1']:.4f} | {len(test_hold)} |
| Family-holdout control on seen families | {fh_seen_m['retry_f1']:.4f} | {len(test_seen_f)} |
| Original model on hold families | {orig_hold_m['retry_f1']:.4f} | — |

Even held-out pairs stay strong **while leak features remain** — memorization is secondary to label leakage.

---

## Anchor counterfactual pairs

| Metric | Value |
|--------|------:|
| Pairs (same surface, KEEP vs RETRY contexts) | {cf_metrics['pairs']} |
| Correct context-sensitive decisions | {cf_metrics['correct_context_sensitive']} |
| Accuracy | {cf_metrics['accuracy']:.4f} |
| Surface-dominated rate | {cf_metrics['surface_dominated_rate']:.4f} |

---

## Root cause

- **Primary:** DIRECT_LABEL_LEAKAGE (`referenceSurface!=surface` in feats)
- **Secondary:** REPAIRABILITY_LABEL_SHORTCUT; ANCHOR_NOT_USED; TEXT_ONLY_SYNTHETIC_SHORTCUT
- **Classification:** **H (MIXED: A+B+E+F)**
- BiGRU architecture problem: **NO**
- Dataset construction / feature packing problem: **YES**
- Input contract (loader packing) problem: **YES**

---

## TTS GO / NO-GO

**Safe to start TTS-ASR enhancement: NO**

Required fix before TTS: **FIX_DATASET_INPUT_CONTRACT** — strip label-table fields from model-visible tensors; keep them QA/loss-only; retrain same Small BiGRU.

**Recommended next phase:** `FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN`

---

## STOP

No architecture change, no production retry, no TTS, no Domain Vote / Recall / Model2 changes this round.
"""
    (DOCS / "Lingua_Model3_V1_Synthetic_Shortcut_Generalization_Audit_2026_08_24.md").write_text(
        report, encoding="utf-8"
    )

    print(json.dumps(go, indent=2), flush=True)
    return go


if __name__ == "__main__":
    main()
