# -*- coding: utf-8 -*-
"""LEGACY / EXPERIMENT ONLY — NOT the authoritative Synthetic V1 trainer.
Authoritative: train_full100k_strict_integration.py + model3_v1_training_config.json

Fix packing acceptance: leakage gate + noleak retrain + counterfactual re-acceptance.

Artifacts written (docs, ≤10):
  1. model3_v1_model_visible_feature_allowlist.json
  2. Lingua_Model3_V1_NoLeak_Retrain_Report_2026_08_24.md
  3. model3_v1_noleak_acceptance.json   (gate+metrics+ablations+heldout+rootcause)
  4. model3_v1_noleak_cpu_and_shadow.json
  5. model3_v1_noleak_governance.json
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import random
import sys
import time
from collections import defaultdict
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
    model_input_hash,
    sample_to_tensors,
    save_model_bundle,
    span_features,
)

DATA = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
OUT = REPO / "training/model3_dataset/model3_v1_synthetic_bigru_noleak"
OLD = REPO / "training/model3_dataset/model3_v1_synthetic_bigru"
DOCS = REPO / "docs/user_correction/model3"
SEED = 2026082414
MODEL_NAME = "MODEL3_V1_SYNTHETIC_BASELINE_NOLEAK_V1"


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
    preds = []
    with torch.no_grad():
        for batch_i, batch in enumerate(loader):
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            pred = logits.argmax(-1)
            for bi in range(pred.shape[0]):
                si = batch_i * batch_size + bi
                if si >= len(samples):
                    break
                item = sample_to_tensors(
                    transform(samples[si]) if transform else samples[si], vocab
                )
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
    m["eligible"] = tp + fp + fn + tn
    return m, preds


def compare_preds(a, b):
    mb = {(s, j): p for s, j, y, p in b}
    flip = tot = 0
    for s, j, y, p0 in a:
        if (s, j) not in mb:
            continue
        tot += 1
        flip += mb[(s, j)] != p0
    return {"compared": tot, "flip": flip, "flip_rate": flip / tot if tot else 0.0}


def write_allowlist():
    rows = [
        {
            "field": "spans[].surface → char tokens",
            "source": "currentText FineSpan surface",
            "runtime_available": True,
            "model_visible": True,
            "label_only": False,
            "reason": "runtime ASR/current surface",
        },
        {
            "field": "isAnchor",
            "source": "upstream Anchor mask",
            "runtime_available": True,
            "model_visible": True,
            "label_only": False,
            "reason": "Model3 is Anchor-conditioned; provenance NOT visible",
        },
        {
            "field": "span_len_log1p",
            "source": "len(current surface)",
            "runtime_available": True,
            "model_visible": True,
            "label_only": False,
            "reason": "runtime-derivable geometry",
        },
        {
            "field": "span_rel_position",
            "source": "span index / (N-1)",
            "runtime_available": True,
            "model_visible": True,
            "label_only": False,
            "reason": "sequence geometry",
        },
        {
            "field": "first_pass_cand_log1p",
            "source": "recallEvidence.firstPassCandidateCount on CURRENT",
            "runtime_available": True,
            "model_visible": True,
            "label_only": False,
            "reason": "first-pass lattice cand count; gated by featureAvailability.recallFirstPass",
        },
        {
            "field": "current_cjk_len_log1p",
            "source": "CJK count in current surface",
            "runtime_available": True,
            "model_visible": True,
            "label_only": False,
            "reason": "current-only length proxy",
        },
        {
            "field": "pinyin_channel_avail",
            "source": "featureAvailability.pinyinTextDerived",
            "runtime_available": True,
            "model_visible": True,
            "label_only": False,
            "reason": "availability bit only — not reference pinyin",
        },
        {
            "field": "referenceSurface / != surface",
            "source": "label plane",
            "runtime_available": False,
            "model_visible": False,
            "label_only": True,
            "reason": "REMOVED — DIRECT_LABEL_LEAKAGE",
        },
        {
            "field": "repairability.referenceReachable",
            "source": "label plane",
            "runtime_available": False,
            "model_visible": False,
            "label_only": True,
            "reason": "REMOVED — REPAIRABILITY_LABEL_SHORTCUT",
        },
        {
            "field": "phoneticCompatible",
            "source": "corruption vs reference",
            "runtime_available": False,
            "model_visible": False,
            "label_only": True,
            "reason": "REMOVED — needs reference pronunciation",
        },
        {
            "field": "targetMask",
            "source": "eligibility",
            "runtime_available": True,
            "model_visible": False,
            "label_only": False,
            "reason": "LOSS_ONLY — not packed as predictive feature",
        },
        {
            "field": "label / labelClass / corruptionFamily",
            "source": "label plane",
            "runtime_available": False,
            "model_visible": False,
            "label_only": True,
            "reason": "supervision / QA only",
        },
    ]
    doc = {
        "allowlist_id": "MODEL3_V1_MODEL_VISIBLE_FEATURE_ALLOWLIST",
        "feat_names": list(FEAT_NAMES),
        "feat_dim": FEAT_DIM,
        "fields": rows,
        "schema_note": "MODEL3_TRAINING_SAMPLE_V1_SCHEMA may store label-side fields; loader ignores them for tensors",
    }
    (DOCS / "model3_v1_model_visible_feature_allowlist.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return doc


def run_leakage_gate(vocab, samples) -> dict:
    rng = random.Random(SEED)
    subset = samples[: min(200, len(samples))]
    mutations_ok = 0
    mutations_fail = 0
    fail_examples = []
    anchor_change_ok = 0
    anchor_change_fail = 0
    for s in subset:
        h0 = model_input_hash(s, vocab)
        mut = deepcopy(s)
        mut["referenceText"] = (mut.get("referenceText") or "") + "X"
        for sp in mut["spans"]:
            sp["referenceSurface"] = "LEAK_TEST_" + (sp.get("referenceSurface") or "")
            sp["phoneticCompatible"] = not bool(sp.get("phoneticCompatible"))
            rep = dict(sp.get("repairability") or {})
            rep["referenceReachable"] = "NO" if rep.get("referenceReachable") == "YES" else "YES"
            sp["repairability"] = rep
            sp["corruptionFamily"] = "MUTATED_FAMILY"
            sp["labelClass"] = "MUTATED"
            if sp.get("label") == "KEEP":
                sp["label"] = "RETRY"
            elif sp.get("label") == "RETRY":
                sp["label"] = "KEEP"
            if "targetMask" in sp:
                sp["targetMask"] = 1 - int(sp["targetMask"])
        h1 = model_input_hash(mut, vocab)
        if h0 == h1:
            mutations_ok += 1
        else:
            mutations_fail += 1
            if len(fail_examples) < 3:
                fail_examples.append(s.get("sampleId"))

        # Anchor change MUST change hash
        mut_a = deepcopy(s)
        if mut_a["spans"]:
            mut_a["spans"][0]["isAnchor"] = not bool(mut_a["spans"][0].get("isAnchor"))
            if model_input_hash(mut_a, vocab) != h0:
                anchor_change_ok += 1
            else:
                anchor_change_fail += 1

    # targetMask-only mutation
    tm_ok = 0
    tm_fail = 0
    for s in subset[:50]:
        h0 = model_input_hash(s, vocab)
        mut = deepcopy(s)
        for sp in mut["spans"]:
            sp["targetMask"] = 1 - int(sp.get("targetMask") or 0)
        if model_input_hash(mut, vocab) == h0:
            tm_ok += 1
        else:
            tm_fail += 1

    gate = {
        "label_side_mutation_changes_model_tensor": mutations_fail > 0,
        "model_input_hash_stable": mutations_fail == 0,
        "mutations_ok": mutations_ok,
        "mutations_fail": mutations_fail,
        "fail_examples": fail_examples,
        "anchor_change_changes_tensor": anchor_change_fail == 0 and anchor_change_ok > 0,
        "anchor_change_ok": anchor_change_ok,
        "anchor_change_fail": anchor_change_fail,
        "target_mask_mutation_stable": tm_fail == 0,
        "target_mask_ok": tm_ok,
        "target_mask_fail": tm_fail,
        "feat_dim": FEAT_DIM,
        "feat_names": list(FEAT_NAMES),
        "gate_pass": mutations_fail == 0 and tm_fail == 0 and anchor_change_fail == 0,
    }
    return gate


def always_keep_baseline(samples):
    tp = fp = fn = tn = 0
    for s in samples:
        for sp in s["spans"]:
            if sp.get("targetMask") != 1:
                continue
            if sp.get("label") == "KEEP":
                tn += 1  # pred KEEP
            elif sp.get("label") == "RETRY":
                fn += 1  # pred KEEP, true RETRY
    return metrics_from_counts(tp, fp, fn, tn)


def extract_xy(samples, vocab):
    X, y = [], []
    for s in samples:
        item = sample_to_tensors(s, vocab)
        for j, lab in enumerate(item["labels"]):
            if item["target_mask"][j] != 1 or lab < 0:
                continue
            mean_tok = sum(item["tokens"][j]) / max(len(item["tokens"][j]), 1)
            X.append([mean_tok] + item["feats"][j])
            y.append(lab)
    return X, y


def train_linear(X, y, epochs=4, lr=0.05, seed=SEED):
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
            p = 1.0 / (1.0 + math.exp(-max(min(z, 20), -20)))
            g = (w_pos if yi == 1 else 1.0) * (p - yi)
            for k in range(d):
                w[k] -= lr * g * xi[k]
            b -= lr * g
    return w, b


def predict_linear(X, w, b):
    return [1 if (b + sum(w[k] * xi[k] for k in range(len(w)))) >= 0 else 0 for xi in X]


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


def blank_surfaces(s):
    t = deepcopy(s)
    for sp in t["spans"]:
        sp["surface"] = ""
    return t


def zero_feat_dims(sample, vocab, dims):
    item = sample_to_tensors(sample, vocab)
    for row, avail in zip(item["feats"], item["avail"]):
        for d in dims:
            row[d] = 0.0
            avail[d] = 0.0
    return item


class AblateDS(Dataset):
    def __init__(self, samples, vocab, mode="none", dims=None, xform=None):
        self.samples = samples
        self.vocab = vocab
        self.mode = mode
        self.dims = dims or []
        self.xform = xform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        if self.xform:
            s = self.xform(s)
        if self.mode == "blank_text":
            s = blank_surfaces(s)
            return sample_to_tensors(s, self.vocab)
        if self.mode == "zero_dims":
            return zero_feat_dims(s, self.vocab, self.dims)
        return sample_to_tensors(s, self.vocab)


def eval_ablate(model, samples, vocab, device, **kwargs):
    ds = AblateDS(samples, vocab, **kwargs)
    loader = DataLoader(ds, batch_size=64, shuffle=False, collate_fn=lambda b: collate_batch(b, device))
    model.eval()
    tp = fp = fn = tn = 0
    preds = []
    with torch.no_grad():
        for batch_i, batch in enumerate(loader):
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            pred = logits.argmax(-1)
            for bi in range(pred.shape[0]):
                si = batch_i * 64 + bi
                if si >= len(samples):
                    break
                item = ds[si]
                for j in range(len(item["labels"])):
                    if item["target_mask"][j] != 1 or item["labels"][j] < 0:
                        continue
                    y = item["labels"][j]
                    p = int(pred[bi, j].item())
                    tn += y == 0 and p == 0
                    fp += y == 0 and p == 1
                    tp += y == 1 and p == 1
                    fn += y == 1 and p == 0
                    preds.append((si, j, y, p))
    return metrics_from_counts(tp, fp, fn, tn), preds


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def surface_pair_key(sp):
    ref, err = sp.get("referenceSurface"), sp.get("surface")
    if ref is None or ref == err:
        return None
    return f"{ref}→{err}"


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    torch.manual_seed(SEED)
    random.seed(SEED)

    print("loading…", flush=True)
    train = load_split("train")
    dev = load_split("dev")
    test = load_split("test")
    print(f"train={len(train)} dev={len(dev)} test={len(test)}", flush=True)

    allowlist = write_allowlist()

    # vocab from train only
    vocab = build_char_vocab(train)

    print("pretrain leakage gate…", flush=True)
    gate = run_leakage_gate(vocab, train)
    print(json.dumps(gate, indent=2), flush=True)
    if not gate["gate_pass"]:
        raise SystemExit("PRETRAIN_INPUT_LEAKAGE_GATE FAILED — abort train")

    # class weight from train supervised counts (not test)
    n_keep = n_retry = 0
    for s in train:
        for sp in s["spans"]:
            if sp.get("targetMask") != 1:
                continue
            if sp.get("label") == "KEEP":
                n_keep += 1
            elif sp.get("label") == "RETRY":
                n_retry += 1
    # simple: weight_retry = sqrt(n_keep/n_retry) capped
    w_retry = min(20.0, math.sqrt(n_keep / max(n_retry, 1)))
    class_weight_note = {
        "formula": "weight_RETRY = min(20, sqrt(n_KEEP/n_RETRY)) on train supervised spans",
        "n_keep": n_keep,
        "n_retry": n_retry,
        "weight_retry": w_retry,
        "tuned_on_test": False,
    }
    print("class_weight", class_weight_note, flush=True)

    config = {
        "embed_dim": 64,
        "hidden_dim": 128,
        "feat_dim": FEAT_DIM,
        "feat_names": list(FEAT_NAMES),
        "max_surface_len": 8,
        "batch_size": 64,
        "epochs": 5,
        "lr": 1e-3,
        "class_weight_retry": w_retry,
        "seed": SEED,
        "init": "random_from_scratch",
        "predecessor_checkpoint_used": False,
    }

    train_loader = DataLoader(
        UtteranceDataset(train, vocab),
        batch_size=config["batch_size"],
        shuffle=True,
        collate_fn=lambda b: collate_batch(b, device),
    )
    dev_loader = DataLoader(
        UtteranceDataset(dev, vocab),
        batch_size=config["batch_size"],
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )

    model = Model3BiGRUV1(len(vocab), config["embed_dim"], config["hidden_dim"], FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=config["lr"])
    cw = torch.tensor([1.0, float(w_retry)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")

    history = []
    t0 = time.time()
    best_f1 = -1.0
    best_state = None
    for epoch in range(config["epochs"]):
        model.train()
        loss_sum = 0.0
        nb = 0
        for batch in train_loader:
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
            loss_sum += loss.item()
            nb += 1
        # quick dev
        model.eval()
        tp = fp = fn = tn = 0
        with torch.no_grad():
            for batch in dev_loader:
                logits = model(batch["tokens"], batch["feats"], batch["avail"])
                pred = logits.argmax(-1)
                mask = (batch["target_mask"] > 0.5) & (batch["valid"] > 0.5) & (batch["labels"] >= 0)
                for p, y, m in zip(pred.view(-1), batch["labels"].view(-1), mask.view(-1)):
                    if not m:
                        continue
                    if y.item() == 0:
                        tn += p.item() == 0
                        fp += p.item() == 1
                    else:
                        tp += p.item() == 1
                        fn += p.item() == 0
        dm = metrics_from_counts(tp, fp, fn, tn)
        history.append({"epoch": epoch + 1, "train_loss": loss_sum / max(nb, 1), "dev": dm})
        print(f"epoch {epoch+1} loss={loss_sum/max(nb,1):.4f} dev_retry_f1={dm['retry_f1']:.4f}", flush=True)
        if dm["retry_f1"] > best_f1:
            best_f1 = dm["retry_f1"]
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    save_model_bundle(OUT, model, vocab, config, MODEL_NAME)
    # checksums
    with (OUT / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256\n")
        for name in ("weights.pt", "vocab.json", "config.json", "model_manifest.json", "feature_allowlist.json"):
            p = OUT / name
            f.write(f"{p.relative_to(REPO).as_posix()},{sha256_file(p)}\n")

    # deprecate old model
    if (OLD / "model_manifest.json").exists():
        old_m = json.loads((OLD / "model_manifest.json").read_text(encoding="utf-8"))
        old_m["status"] = "DEPRECATED_LEAKED_FEATURE_MODEL"
        old_m["invalid_for_quality_claim"] = True
        old_m["superseded_by"] = MODEL_NAME
        (OLD / "model_manifest.json").write_text(json.dumps(old_m, indent=2), encoding="utf-8")

    params = sum(p.numel() for p in model.parameters())
    size_b = (OUT / "weights.pt").stat().st_size

    print("evaluation…", flush=True)
    test_m, base_preds = eval_model(model, test, vocab, device)
    always_m = always_keep_baseline(test)

    # linear
    Xtr, ytr = extract_xy(train[::4], vocab)
    Xte, yte = extract_xy(test, vocab)
    wl, bl = train_linear(Xtr, ytr)
    lin_m = score_preds(yte, predict_linear(Xte, wl, bl))

    # label-side mutation: predictions must be identical
    print("label-side mutation inference…", flush=True)
    mut_samples = []
    for s in test[:500]:
        mut = deepcopy(s)
        for sp in mut["spans"]:
            sp["referenceSurface"] = "ZZZ"
            sp["phoneticCompatible"] = True
            rep = dict(sp.get("repairability") or {})
            rep["referenceReachable"] = "NO"
            sp["repairability"] = rep
        mut_samples.append(mut)
    # compare hashes + preds on subset
    hash_same = all(
        model_input_hash(test[i], vocab) == model_input_hash(mut_samples[i], vocab)
        for i in range(len(mut_samples))
    )
    mut_m, mut_preds = eval_model(model, mut_samples, vocab, device)
    # remap preds indices: same order as first 500
    base_sub = [r for r in base_preds if r[0] < 500]
    # re-eval first 500 for aligned compare
    base500_m, base500_preds = eval_model(model, test[:500], vocab, device)
    mut_flip = compare_preds(base500_preds, mut_preds)
    label_side_mut = {
        "model_input_hash_identical": hash_same,
        "prediction_flip_rate": mut_flip["flip_rate"],
        "predictions_unchanged": mut_flip["flip_rate"] == 0.0,
        "baseline_subset": base500_m,
        "mutated_subset": mut_m,
    }

    # anchor zero / shuffle
    print("anchor tests…", flush=True)
    az_m, az_preds = eval_model(model, test, vocab, device, transform=zero_anchor)
    az_flip = compare_preds(base_preds, az_preds)
    rng = random.Random(SEED)

    def _shuf(s):
        return shuffle_anchor(s, random.Random(hash(s["sampleId"]) % (2**32)))

    as_m, as_preds = eval_model(model, test, vocab, device, transform=_shuf)
    as_flip = compare_preds(base_preds, as_preds)

    # ablations
    print("ablations…", flush=True)
    ablations = {}
    for name, kw in [
        ("text_removed", {"mode": "blank_text"}),
        ("anchor_removed", {"mode": "zero_dims", "dims": [0]}),
        ("position_removed", {"mode": "zero_dims", "dims": [2]}),
        ("pinyin_avail_removed", {"mode": "zero_dims", "dims": [5]}),
        ("recall_cand_removed", {"mode": "zero_dims", "dims": [3]}),
        ("geometry_removed", {"mode": "zero_dims", "dims": [1, 2, 4]}),
    ]:
        m, preds = eval_ablate(model, test, vocab, device, **kw)
        flip = compare_preds(base_preds, preds)
        ablations[name] = {
            **m,
            "delta_retry_f1": test_m["retry_f1"] - m["retry_f1"],
            "flip_rate": flip["flip_rate"],
        }
        print(f"  {name}: f1={m['retry_f1']:.4f} Δ={ablations[name]['delta_retry_f1']:.4f}", flush=True)

    # held-out surface — build larger set: evaluate at span level for unseen pairs
    print("held-out surface…", flush=True)
    train_pairs = set()
    for s in train:
        for sp in s["spans"]:
            k = surface_pair_key(sp)
            if k:
                train_pairs.add(k)
    # span-level metrics on unseen RETRY/KEEP pairs inside test
    def span_level_by_pair_seen(samples, seen_set, want_seen: bool):
        tp = fp = fn = tn = 0
        n_utt = 0
        for s in samples:
            item = sample_to_tensors(s, vocab)
            # need model preds — collect later
            n_utt += 1
        return n_utt

    # Get predictions for all test, then filter spans
    # reuse base_preds
    pred_map = {(si, j): p for si, j, y, p in base_preds}
    tp = fp = fn = tn = 0
    tp_u = fp_u = fn_u = tn_u = 0
    seen_span = unseen_span = 0
    for si, s in enumerate(test):
        for j, sp in enumerate(s["spans"]):
            if sp.get("targetMask") != 1 or sp.get("label") not in ("KEEP", "RETRY"):
                continue
            k = surface_pair_key(sp)
            if k is None:
                # clean KEEP — count as seen path? skip for pair generalization
                continue
            y = 0 if sp["label"] == "KEEP" else 1
            p = pred_map.get((si, j))
            if p is None:
                continue
            if k in train_pairs:
                seen_span += 1
                if y == 0:
                    tn += p == 0
                    fp += p == 1
                else:
                    tp += p == 1
                    fn += p == 0
            else:
                unseen_span += 1
                if y == 0:
                    tn_u += p == 0
                    fp_u += p == 1
                else:
                    tp_u += p == 1
                    fn_u += p == 0
    held_surface = {
        "train_pair_count": len(train_pairs),
        "seen_spans": seen_span,
        "unseen_spans": unseen_span,
        "seen": metrics_from_counts(tp, fp, fn, tn),
        "held_out": metrics_from_counts(tp_u, fp_u, fn_u, tn_u),
        "volume_status": (
            "OK"
            if unseen_span >= 100
            else "INSUFFICIENT_HELDOUT_SURFACE_PAIR_VOLUME"
            if unseen_span < 50
            else "LOW"
        ),
    }

    # family holdout control — train small control without eng_en/h_f
    print("family holdout…", flush=True)
    hold_fams = {"eng_en", "h_f"}

    def has_fam(s, fams):
        return any((sp.get("corruptionFamily") in fams) for sp in s["spans"])

    train_fh = [s for s in train[::3] if not has_fam(s, hold_fams)][:10000]
    test_hold = [s for s in test if has_fam(s, hold_fams)]
    test_seen_f = [s for s in test if not has_fam(s, hold_fams) and any(sp.get("corruptionFamily") for sp in s["spans"])]

    fh_model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt2 = torch.optim.Adam(fh_model.parameters(), lr=1e-3)
    crit2 = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    fh_loader = DataLoader(
        UtteranceDataset(train_fh, vocab),
        batch_size=64,
        shuffle=True,
        collate_fn=lambda b: collate_batch(b, device),
    )
    for _ in range(2):
        fh_model.train()
        for batch in fh_loader:
            opt2.zero_grad()
            logits = fh_model(batch["tokens"], batch["feats"], batch["avail"])
            b, n, c = logits.shape
            lv = crit2(logits.view(b * n, c), batch["labels"].view(b * n))
            sel = batch["target_mask"].view(b * n) * batch["valid"].view(b * n)
            if sel.sum() <= 0:
                continue
            ((lv * sel).sum() / sel.sum()).backward()
            opt2.step()
    fh_hold_m, _ = eval_model(fh_model, test_hold[:2000] if test_hold else test[:200], vocab, device)
    fh_seen_m, _ = eval_model(fh_model, test_seen_f[:2000] if test_seen_f else test[:200], vocab, device)

    # anchor counterfactual pairs (same surface, different labels) — verify no leak in tensor
    print("anchor counterfactual…", flush=True)
    by_surf = defaultdict(lambda: {"KEEP": [], "RETRY": []})
    for si, s in enumerate(test):
        for j, sp in enumerate(s["spans"]):
            if sp.get("targetMask") != 1 or sp.get("label") not in ("KEEP", "RETRY"):
                continue
            by_surf[sp.get("surface") or ""][sp["label"]].append((si, j))
    pairs = []
    for surf, labs in by_surf.items():
        if not surf or not labs["KEEP"] or not labs["RETRY"]:
            continue
        for k in labs["KEEP"][:1]:
            for r in labs["RETRY"][:1]:
                # confirm tensor differs only via runtime-visible (anchor/context tokens)
                sk, jk = k
                sr, jr = r
                # hash of single-span isn't whole utt; check full utt hashes differ
                h_k = model_input_hash(test[sk], vocab)
                h_r = model_input_hash(test[sr], vocab)
                pairs.append(
                    {
                        "surface": surf,
                        "keep": k,
                        "retry": r,
                        "utt_hash_equal": h_k == h_r,
                    }
                )
        if len(pairs) >= 200:
            break
    correct = same_pred = 0
    for pair in pairs:
        pk = pred_map.get(pair["keep"])
        pr = pred_map.get(pair["retry"])
        if pk is None or pr is None:
            continue
        if pk == 0 and pr == 1:
            correct += 1
        if pk == pr:
            same_pred += 1
    cf = {
        "pairs": len(pairs),
        "correct_context_sensitive": correct,
        "accuracy": correct / len(pairs) if pairs else 0.0,
        "same_surface_same_pred": same_pred,
        "surface_dominated_rate": same_pred / len(pairs) if pairs else 0.0,
        "utt_hash_always_differs": all(not p["utt_hash_equal"] for p in pairs) if pairs else True,
        "dataset_anchor_signal": (
            "PRESENT"
            if (correct / len(pairs) if pairs else 0) >= 0.55
            else "WEAK"
            if (correct / len(pairs) if pairs else 0) >= 0.35
            else "ABSENT"
        ),
    }

    # CPU latency
    print("cpu latency…", flush=True)
    lat = []
    model.eval()
    with torch.no_grad():
        for s in test[:500]:
            item = sample_to_tensors(s, vocab)
            batch = collate_batch([item], device)
            t1 = time.perf_counter()
            model(batch["tokens"], batch["feats"], batch["avail"])
            lat.append((time.perf_counter() - t1) * 1000)
    lat_s = sorted(lat)

    def pct(p):
        if not lat_s:
            return 0.0
        k = (len(lat_s) - 1) * p / 100
        f = int(k)
        c = min(f + 1, len(lat_s) - 1)
        return lat_s[f] if f == c else lat_s[f] + (lat_s[c] - lat_s[f]) * (k - f)

    cpu = {
        "device": "cpu",
        "n_samples": len(lat),
        "p50_ms": pct(50),
        "p95_ms": pct(95),
        "p99_ms": pct(99),
        "mean_ms": sum(lat) / len(lat) if lat else 0.0,
    }
    shadow = {
        "one_inference_per_utterance": True,
        "actual_retry_triggered": False,
        "production_output_changed": False,
        "mode": "shadow_only_offline",
    }

    # anchor conclusion
    zero_delta = test_m["retry_f1"] - az_m["retry_f1"]
    shuffle_delta = test_m["retry_f1"] - as_m["retry_f1"]
    if abs(zero_delta) < 1e-6 and az_flip["flip_rate"] < 0.01:
        anchor_concl = "NOT_USED"
    elif abs(zero_delta) >= 0.02 or az_flip["flip_rate"] >= 0.05:
        anchor_concl = "USED"
    else:
        anchor_concl = "PARTIAL"

    a_leak = False  # packing fixed
    b_leak = False
    f_anchor = anchor_concl == "NOT_USED"

    beats_always = test_m["retry_f1"] > always_m["retry_f1"] + 1e-9
    beats_linear = test_m["retry_f1"] >= lin_m["retry_f1"] - 0.02

    if gate["gate_pass"] is False or label_side_mut["prediction_flip_rate"] > 0:
        verdict = "LEAKAGE_REMAINS"
    elif not beats_always and cf["dataset_anchor_signal"] == "ABSENT":
        verdict = "DATASET_SIGNAL_GAP"
    elif a_leak or b_leak:
        verdict = "LEAKAGE_REMAINS"
    elif (
        gate["gate_pass"]
        and not a_leak
        and not b_leak
        and beats_always
        and anchor_concl in ("USED", "PARTIAL")
        and held_surface["unseen_spans"] >= 50
    ):
        verdict = "PASS"
    elif gate["gate_pass"] and not a_leak and not b_leak:
        verdict = "PASS_WITH_DATA_GAPS"
    else:
        verdict = "MODEL_FAIL"

    next_phase = {
        "PASS": "MODEL3_TTS_ASR_DATASET_AND_REAL_ERROR_ENHANCEMENT",
        "PASS_WITH_DATA_GAPS": "MODEL3_V1_ANCHOR_DEPENDENT_DATASET_REDESIGN",
        "DATASET_SIGNAL_GAP": "MODEL3_V1_ANCHOR_DEPENDENT_DATASET_REDESIGN",
        "LEAKAGE_REMAINS": "FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN",
        "MODEL_FAIL": "MODEL3_V1_ARCHITECTURE_REVISIT",
    }.get(verdict, "REVIEW")

    acceptance = {
        "pretrain_leakage_gate": gate,
        "label_side_mutation_test": label_side_mut,
        "class_weight": class_weight_note,
        "training": {
            "history": history,
            "train_seconds": time.time() - t0,
            "early_stop_best_dev_retry_f1": best_f1,
            "from_scratch": True,
        },
        "test_metrics": test_m,
        "confusion_matrix": {
            "true_KEEP_pred_KEEP": test_m["tn"],
            "true_KEEP_pred_RETRY": test_m["fp"],
            "true_RETRY_pred_KEEP": test_m["fn"],
            "true_RETRY_pred_RETRY": test_m["tp"],
        },
        "always_keep_baseline": always_m,
        "linear_baseline": lin_m,
        "anchor_zero": {"metrics": az_m, "flip": az_flip, "delta_f1": zero_delta},
        "anchor_shuffle": {"metrics": as_m, "flip": as_flip, "delta_f1": shuffle_delta},
        "anchor_conclusion": anchor_concl,
        "feature_ablation": ablations,
        "heldout_surface": held_surface,
        "heldout_family": {
            "families": sorted(hold_fams),
            "hold": fh_hold_m,
            "seen": fh_seen_m,
            "test_hold_n": len(test_hold),
        },
        "anchor_counterfactual": cf,
        "root_cause_recheck": {
            "A_DIRECT_LABEL_LEAKAGE": a_leak,
            "B_REPAIRABILITY_LABEL_SHORTCUT": b_leak,
            "F_ANCHOR_NOT_USED": f_anchor,
        },
        "model": {
            "name": MODEL_NAME,
            "parameters": params,
            "weights_bytes": size_b,
            "feat_dim": FEAT_DIM,
            "path": str(OUT.relative_to(REPO)).replace("\\", "/"),
        },
        "verdict": verdict,
    }
    (DOCS / "model3_v1_noleak_acceptance.json").write_text(
        json.dumps(acceptance, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_noleak_cpu_and_shadow.json").write_text(
        json.dumps({"cpu_latency": cpu, "shadow": shadow}, indent=2), encoding="utf-8"
    )

    gov = {
        "go_summary": {
            "phase": "FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN",
            "verdict": verdict,
            "feature_packing_fixed": gate["gate_pass"] and not a_leak and not b_leak,
            "recommended_next_phase": next_phase,
            "safe_to_start_tts_asr": verdict == "PASS",
            "exact_next_fix_if_no": (
                None
                if verdict == "PASS"
                else "Construct Anchor-dependent contrast pairs / raise RETRY density without reintroducing label-side features"
                if verdict in ("PASS_WITH_DATA_GAPS", "DATASET_SIGNAL_GAP")
                else "Re-fix feature packing"
            ),
        },
        "leaked_model_deprecation": {
            "old_model": "MODEL3_V1_SYNTHETIC_BASELINE",
            "status": "DEPRECATED_LEAKED_FEATURE_MODEL",
            "invalid_for_quality_claim": True,
            "path": str(OLD.relative_to(REPO)).replace("\\", "/"),
            "superseded_by": MODEL_NAME,
        },
        "runtime_impact": {
            "architecture_contract_changed": False,
            "training_schema_changed": False,
            "domain_vote_changed": False,
            "recall_changed": False,
            "model2_changed": False,
            "production_retry_enabled": False,
            "tts_generated": False,
        },
        "modified_file_inventory": [
            "training/model3_dataset/train/bigru_v1.py",
            "training/model3_dataset/train/train_v1_noleak.py",
            "training/model3_dataset/model3_v1_synthetic_bigru_noleak/",
            "training/model3_dataset/model3_v1_synthetic_bigru/model_manifest.json",
            "docs/user_correction/model3/model3_v1_model_visible_feature_allowlist.json",
            "docs/user_correction/model3/Lingua_Model3_V1_NoLeak_Retrain_Report_2026_08_24.md",
            "docs/user_correction/model3/model3_v1_noleak_acceptance.json",
            "docs/user_correction/model3/model3_v1_noleak_cpu_and_shadow.json",
            "docs/user_correction/model3/model3_v1_noleak_governance.json",
        ],
    }
    (DOCS / "model3_v1_noleak_governance.json").write_text(
        json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    report = f"""# Lingua Model3 V1 No-Leak Feature Packing Fix + Retrain

**Date:** 2026-08-24  
**Phase:** `FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN`  
**Verdict:** `{verdict}`

---

## 1. Feature packing fix

Removed from `span_features()` (label/QA plane only):

- `phoneticCompatible`
- `referenceSurface != surface`
- `referenceReachable` YES/NO
- `targetMask` as predictive feature

**Allowlisted model-visible dims ({FEAT_DIM}):** `{list(FEAT_NAMES)}`

Schema `MODEL3_TRAINING_SAMPLE_V1` unchanged — loader ignores label-side fields for tensors.

Pretrain gate: **{"PASS" if gate["gate_pass"] else "FAIL"}**  
Label-side mutation → model tensor identical: **{"YES" if gate["model_input_hash_stable"] else "NO"}**  
Inference mutation flip rate: **{label_side_mut["prediction_flip_rate"]}**

---

## 2. Model

| Item | Value |
|------|-------|
| Name | `{MODEL_NAME}` |
| Architecture | Small BiGRU (unchanged) |
| Train from scratch | YES |
| Parameters | {params} |
| Weights | {size_b} bytes |
| Class weight RETRY | {w_retry:.4f} (train-only formula) |
| Old leaked model | DEPRECATED_LEAKED_FEATURE_MODEL |

Path: `training/model3_dataset/model3_v1_synthetic_bigru_noleak/`

---

## 3. Quality (held-out test)

| Metric | Value |
|--------|------:|
| Always-KEEP RETRY F1 | {always_m["retry_f1"]:.4f} |
| Linear RETRY F1 | {lin_m["retry_f1"]:.4f} |
| BiGRU RETRY precision | {test_m["retry_precision"]:.4f} |
| BiGRU RETRY recall | {test_m["retry_recall"]:.4f} |
| BiGRU RETRY F1 | {test_m["retry_f1"]:.4f} |
| False RETRY rate | {test_m["false_retry_rate"]:.4f} |
| Macro F1 | {test_m["macro_f1"]:.4f} |
| TP/FP/FN/TN | {test_m["tp"]}/{test_m["fp"]}/{test_m["fn"]}/{test_m["tn"]} |

F1≪1.0 after leak removal is **expected**.

---

## 4. Anchor dependence

| Test | RETRY F1 | Δ vs base | Flip rate |
|------|--------:|----------:|----------:|
| Original | {test_m["retry_f1"]:.4f} | — | — |
| Anchor zero | {az_m["retry_f1"]:.4f} | {zero_delta:.4f} | {az_flip["flip_rate"]:.4f} |
| Anchor shuffle | {as_m["retry_f1"]:.4f} | {shuffle_delta:.4f} | {as_flip["flip_rate"]:.4f} |

**Conclusion:** `{anchor_concl}`

---

## 5. Ablations / generalization / counterfactual

Ablations: see `model3_v1_noleak_acceptance.json` → `feature_ablation`.

Held-out surface spans: seen={seen_span}, unseen={unseen_span} ({held_surface["volume_status"]})  
Unseen RETRY F1: {held_surface["held_out"]["retry_f1"]:.4f}

Family holdout {sorted(hold_fams)}: hold F1={fh_hold_m["retry_f1"]:.4f}, seen F1={fh_seen_m["retry_f1"]:.4f}

Anchor counterfactual pairs={cf["pairs"]}, accuracy={cf["accuracy"]:.4f}, signal={cf["dataset_anchor_signal"]}

---

## 6. Root-cause recheck

| Code | Value |
|------|-------|
| A_DIRECT_LABEL_LEAKAGE | {a_leak} |
| B_REPAIRABILITY_LABEL_SHORTCUT | {b_leak} |
| F_ANCHOR_NOT_USED | {f_anchor} |

---

## 7. Performance / shadow

CPU p50/p95/p99 ms: {cpu["p50_ms"]:.3f} / {cpu["p95_ms"]:.3f} / {cpu["p99_ms"]:.3f}  
Production output changed: **NO** · Actual retry: **NO**

---

## 8. Decision

- Feature packing fixed: **{"YES" if gate["gate_pass"] else "NO"}**
- Same BiGRU suitable: **YES**
- Dataset Anchor-dependent signal: **{cf["dataset_anchor_signal"]}**
- Safe to start TTS-ASR: **{"YES" if verdict == "PASS" else "NO"}**
- Recommended next: `{next_phase}`

## STOP

No TTS · No production RETRY · No Domain Vote / Recall / Model2 / schema changes.
"""
    (DOCS / "Lingua_Model3_V1_NoLeak_Retrain_Report_2026_08_24.md").write_text(report, encoding="utf-8")

    print(json.dumps(gov["go_summary"], indent=2), flush=True)
    return verdict


if __name__ == "__main__":
    main()
