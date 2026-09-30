# -*- coding: utf-8 -*-
"""MODEL3_V1_V2_DATASET_TRAINING — train ONE controlled V2 checkpoint.

Uses MODEL3_V2_LABELED as-is. Small BiGRU unchanged.
class_weight_retry=1.0 (baseline-comparable; no aggressive rebalancing).
Does NOT overwrite MODEL3_SYNTHETIC_V1 / seed_2026082520.
"""
from __future__ import annotations

import hashlib
import json
import random
import sys
import time
from collections import Counter
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    sample_to_tensors,
    save_model_bundle,
)

DATA = REPO / "training/model3_dataset/model3_v2_labeled"
OUT = REPO / "training/model3_dataset/model3_v2_region_label_v1_ckpts/seed_2026082901"
DOCS = REPO / "docs/user_correction/model3"

MODEL_ID = "MODEL3_V2_REGION_LABEL_V1"
SEED = 2026082901
EPOCHS = 8
BATCH = 64
LR = 1e-3
CLASS_WEIGHT_RETRY = 1.0  # frozen baseline-comparable; do not tune


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_split(split: str) -> list[dict]:
    rows = []
    for p in sorted((DATA / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


class UtteranceDataset(Dataset):
    def __init__(self, samples: list[dict], vocab: dict[str, int]):
        self.samples = samples
        self.vocab = vocab

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return sample_to_tensors(self.samples[idx], self.vocab)


def compute_metrics(model, loader, device):
    model.eval()
    tp = fp = fn = tn = 0
    pred_keep = pred_retry = 0
    with torch.no_grad():
        for batch in loader:
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            b, n, c = logits.shape
            flat_logits = logits.view(b * n, c)
            flat_labels = batch["labels"].view(b * n)
            flat_mask = batch["target_mask"].view(b * n) * batch["valid"].view(b * n)
            sel = flat_mask > 0.5
            pred = flat_logits.argmax(dim=-1)
            for p, y in zip(pred[sel], flat_labels[sel]):
                pi, yi = p.item(), y.item()
                if pi == 0:
                    pred_keep += 1
                else:
                    pred_retry += 1
                if yi == 0:
                    if pi == 0:
                        tn += 1
                    else:
                        fp += 1
                elif yi == 1:
                    if pi == 1:
                        tp += 1
                    else:
                        fn += 1
    keep_prec = tn / (tn + fp) if (tn + fp) else 0.0
    keep_rec = tn / (tn + fn) if (tn + fn) else 0.0
    # standard: KEEP is class 0 — precision = TN/(TN+FN) wait that's wrong for KEEP as positive
    # KEEP precision = TN / (TN + FN) if KEEP predictions? No:
    # KEEP as class: precision = tn/(tn+fn) when treating KEEP as negative of RETRY
    # Convention matching train_v1_bigru:
    # keep_prec = tn / (tn + fn)  -- incorrect naming in legacy; they used KEEP-as-negative confusion
    # Actually: tn=true KEEP, fp=false RETRY, fn=missed RETRY, tp=true RETRY
    # KEEP precision = tn/(tn+fn) ? No — predicted KEEP = tn+fn, so KEEP prec = tn/(tn+fn)
    # KEEP recall = tn/(tn+fp)
    keep_prec = tn / (tn + fn) if (tn + fn) else 0.0
    keep_rec = tn / (tn + fp) if (tn + fp) else 0.0
    retry_prec = tp / (tp + fp) if (tp + fp) else 0.0
    retry_rec = tp / (tp + fn) if (tp + fn) else 0.0
    retry_f1 = (
        2 * retry_prec * retry_rec / (retry_prec + retry_rec) if (retry_prec + retry_rec) else 0.0
    )
    true_retry = tp + fn
    true_keep = tn + fp
    return {
        "keep_precision": keep_prec,
        "keep_recall": keep_rec,
        "retry_precision": retry_prec,
        "retry_recall": retry_rec,
        "retry_f1": retry_f1,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "pred_keep": pred_keep,
        "pred_retry": pred_retry,
        "true_retry_rate": true_retry / (true_retry + true_keep) if (true_retry + true_keep) else 0.0,
        "pred_retry_rate": pred_retry / (pred_retry + pred_keep) if (pred_retry + pred_keep) else 0.0,
    }


def set_seed(seed: int):
    random.seed(seed)
    torch.manual_seed(seed)


def main():
    set_seed(SEED)
    device = torch.device("cpu")
    print("loading V2 dataset...", flush=True)
    train_samples = load_split("train")
    dev_samples = load_split("dev")
    test_samples = load_split("test")
    print(
        f"train={len(train_samples)} dev={len(dev_samples)} test={len(test_samples)}",
        flush=True,
    )

    # Retry presence check — if zero, training is pointless
    train_retry = sum(
        1 for s in train_samples for sp in s.get("spans") or [] if sp.get("label") == "RETRY"
    )
    train_eligible = sum(
        1
        for s in train_samples
        for sp in s.get("spans") or []
        if sp.get("targetMask") == 1 and not sp.get("isAnchor")
    )
    print(f"train_retry_spans={train_retry} eligible={train_eligible}", flush=True)
    if train_retry == 0:
        print("TRAINING_BALANCE_INTERVENTION_REQUIRED: no RETRY spans", flush=True)
        sys.exit(2)

    vocab = build_char_vocab(train_samples)
    config = {
        "modelId": MODEL_ID,
        "datasetId": "MODEL3_V2_LABELED",
        "datasetVersion": "model3_v2_labeled_20260829",
        "seed": SEED,
        "embed_dim": 64,
        "hidden_dim": 128,
        "feat_dim": FEAT_DIM,
        "feat_names": list(FEAT_NAMES),
        "max_surface_len": 8,
        "batch_size": BATCH,
        "epochs": EPOCHS,
        "lr": LR,
        "optimizer": "Adam",
        "class_weight_retry": CLASS_WEIGHT_RETRY,
        "auto_class_weight_formula": False,
        "sampling": "uniform_shuffle_utterance",
        "pair_loss_enabled": False,
        "init": "random_from_scratch",
        "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
    }

    train_loader = DataLoader(
        UtteranceDataset(train_samples, vocab),
        batch_size=BATCH,
        shuffle=True,
        collate_fn=lambda b: collate_batch(b, device),
    )
    dev_loader = DataLoader(
        UtteranceDataset(dev_samples, vocab),
        batch_size=BATCH,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )
    test_loader = DataLoader(
        UtteranceDataset(test_samples, vocab),
        batch_size=BATCH,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )

    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=LR)
    cw = torch.tensor([1.0, float(CLASS_WEIGHT_RETRY)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")

    history = []
    best_f1 = -1.0
    best_state = None
    t0 = time.time()
    for epoch in range(EPOCHS):
        model.train()
        epoch_loss = 0.0
        n_batches = 0
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
            epoch_loss += loss.item()
            n_batches += 1
        dev_m = compute_metrics(model, dev_loader, device)
        row = {
            "epoch": epoch + 1,
            "train_loss": epoch_loss / max(n_batches, 1),
            "dev": dev_m,
        }
        history.append(row)
        print(
            f"epoch {epoch+1}/{EPOCHS} loss={row['train_loss']:.4f} "
            f"dev_retry_f1={dev_m['retry_f1']:.4f} "
            f"retry_rec={dev_m['retry_recall']:.4f} "
            f"retry_prec={dev_m['retry_precision']:.4f} "
            f"pred_retry_rate={dev_m['pred_retry_rate']:.4f}",
            flush=True,
        )
        if dev_m["retry_f1"] >= best_f1:
            best_f1 = dev_m["retry_f1"]
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    OUT.mkdir(parents=True, exist_ok=True)
    save_model_bundle(OUT, model, vocab, config, model_name=MODEL_ID)
    weights_sha = file_sha(OUT / "weights.pt")
    (OUT / "model_manifest.json").write_text(
        json.dumps(
            {
                "modelName": MODEL_ID,
                "architecture": "Small BiGRU",
                "status": "CANDIDATE",
                "seed": SEED,
                "weightsSha256": weights_sha,
                "config": config,
                "vocabSize": len(vocab),
                "featNames": list(FEAT_NAMES),
                "featDim": FEAT_DIM,
                "v1BaselinePreserved": "MODEL3_SYNTHETIC_V1 seed_2026082520",
                "trainSeconds": time.time() - t0,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    test_m = compute_metrics(model, test_loader, device)
    dev_m = compute_metrics(model, dev_loader, device)
    all_keep = test_m["pred_retry"] == 0
    over_retry = test_m["pred_retry_rate"] > 0.5

    summary = {
        "phase": "MODEL3_V1_V2_DATASET_TRAINING",
        "modelId": MODEL_ID,
        "seed": SEED,
        "checkpointDir": str(OUT.relative_to(REPO)).replace("\\", "/"),
        "weightsSha256": weights_sha,
        "trainSeconds": time.time() - t0,
        "config": config,
        "history": history,
        "dev": dev_m,
        "test": test_m,
        "classifierBehavior": {
            "ALL_KEEP": all_keep,
            "OVER_RETRY": over_retry,
            "NEAR_ALL_KEEP": test_m["pred_retry_rate"] < 0.001,
            "pred_retry_rate": test_m["pred_retry_rate"],
            "true_retry_rate": test_m["true_retry_rate"],
        },
        "v1BaselinePreserved": True,
    }
    (OUT / "training_metrics.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v2_training_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"test": test_m, "ALL_KEEP": all_keep, "weightsSha256": weights_sha}, indent=2))


if __name__ == "__main__":
    main()
