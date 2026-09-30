# -*- coding: utf-8
"""LEGACY / EXPERIMENT ONLY — NOT the authoritative Synthetic V1 trainer.
Authoritative: train_full100k_strict_integration.py + model3_v1_training_config.json

Train MODEL3_V1_SYNTHETIC_BASELINE BiGRU."""
from __future__ import annotations

import csv
import hashlib
import json
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

from training.model3_dataset.train.bigru_v1 import (
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    sample_to_tensors,
    save_model_bundle,
)

DATA = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
OUT = REPO / "training/model3_dataset/model3_v1_synthetic_bigru"
DOCS = REPO / "docs/user_correction/model3"
SIDECAR = DATA / "anchor_provenance_sidecar.jsonl"


def load_jsonl_split(split: str) -> list[dict]:
    rows = []
    for p in sorted((DATA / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def load_sidecar() -> dict[str, dict]:
    m = {}
    if SIDECAR.exists():
        with SIDECAR.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    o = json.loads(line)
                    m[o["sampleId"]] = o
    return m


class UtteranceDataset(Dataset):
    def __init__(self, samples: list[dict], vocab: dict[str, int]):
        self.samples = samples
        self.vocab = vocab

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return sample_to_tensors(self.samples[idx], self.vocab)


def compute_metrics(model, loader, device, class_weight=None):
    model.eval()
    crit = nn.CrossEntropyLoss(weight=class_weight, ignore_index=-100, reduction="none")
    tp = fp = fn = tn = 0
    losses = []
    with torch.no_grad():
        for batch in loader:
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            b, n, c = logits.shape
            flat_logits = logits.view(b * n, c)
            flat_labels = batch["labels"].view(b * n)
            flat_mask = batch["target_mask"].view(b * n) * batch["valid"].view(b * n)
            loss_vec = crit(flat_logits, flat_labels)
            sel = flat_mask > 0.5
            if sel.any():
                losses.extend(loss_vec[sel].tolist())
            pred = flat_logits.argmax(dim=-1)
            for p, y, m in zip(pred[sel], flat_labels[sel], flat_mask[sel]):
                if y.item() == 0:
                    if p.item() == 0:
                        tn += 1
                    else:
                        fp += 1
                elif y.item() == 1:
                    if p.item() == 1:
                        tp += 1
                    else:
                        fn += 1
    keep_prec = tn / (tn + fn) if (tn + fn) else 0.0
    keep_rec = tn / (tn + fp) if (tn + fp) else 0.0
    retry_prec = tp / (tp + fp) if (tp + fp) else 0.0
    retry_rec = tp / (tp + fn) if (tp + fn) else 0.0
    retry_f1 = (
        2 * retry_prec * retry_rec / (retry_prec + retry_rec)
        if (retry_prec + retry_rec)
        else 0.0
    )
    macro_f1 = (
        (keep_prec + retry_prec) / 2
        if keep_prec or retry_prec
        else 0.0
    )
    false_retry = fp / (fp + tn) if (fp + tn) else 0.0
    return {
        "loss": sum(losses) / len(losses) if losses else 0.0,
        "keep_precision": keep_prec,
        "keep_recall": keep_rec,
        "retry_precision": retry_prec,
        "retry_recall": retry_rec,
        "retry_f1": retry_f1,
        "macro_f1": macro_f1,
        "false_retry_rate": false_retry,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
    }


def bucket_eval(model, samples, vocab, sidecar, device):
    buckets = Counter()
    for s in samples:
        sc = sidecar.get(s["sampleId"], {})
        buckets[sc.get("anchorDietBucket", "UNKNOWN")] += 1
    results = {}
    for bucket in sorted(buckets):
        subset = [s for s in samples if sidecar.get(s["sampleId"], {}).get("anchorDietBucket") == bucket]
        if not subset:
            continue
        ds = UtteranceDataset(subset, vocab)
        loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=lambda b: collate_batch(b, device))
        results[bucket] = compute_metrics(model, loader, device)
        results[bucket]["samples"] = len(subset)
    return results


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    device = torch.device("cpu")
    train_samples = load_jsonl_split("train")
    dev_samples = load_jsonl_split("dev")
    test_samples = load_jsonl_split("test")
    sidecar = load_sidecar()
    vocab = build_char_vocab(train_samples)
    config = {
        "embed_dim": 64,
        "hidden_dim": 128,
        "feat_dim": 8,
        "max_surface_len": 8,
        "batch_size": 64,
        "epochs": 5,
        "lr": 1e-3,
        "class_weight_retry": 4.0,
    }

    train_ds = UtteranceDataset(train_samples, vocab)
    dev_ds = UtteranceDataset(dev_samples, vocab)
    train_loader = DataLoader(
        train_ds,
        batch_size=config["batch_size"],
        shuffle=True,
        collate_fn=lambda b: collate_batch(b, device),
    )
    dev_loader = DataLoader(
        dev_ds,
        batch_size=config["batch_size"],
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )

    model = Model3BiGRUV1(len(vocab), config["embed_dim"], config["hidden_dim"], config["feat_dim"]).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=config["lr"])
    class_weight = torch.tensor([1.0, config["class_weight_retry"]], device=device)
    crit = nn.CrossEntropyLoss(weight=class_weight, ignore_index=-100, reduction="none")

    history = []
    t0 = time.time()
    for epoch in range(config["epochs"]):
        model.train()
        epoch_loss = 0.0
        n_batches = 0
        for batch in train_loader:
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            b, n, c = logits.shape
            loss_vec = crit(
                logits.view(b * n, c),
                batch["labels"].view(b * n),
            )
            sel = batch["target_mask"].view(b * n) * batch["valid"].view(b * n)
            if sel.sum() > 0:
                loss = (loss_vec * sel).sum() / sel.sum()
            else:
                continue
            loss.backward()
            opt.step()
            epoch_loss += loss.item()
            n_batches += 1
        dev_m = compute_metrics(model, dev_loader, device, class_weight)
        history.append({"epoch": epoch + 1, "train_loss": epoch_loss / max(n_batches, 1), "dev": dev_m})
        print(f"epoch {epoch+1} dev retry_f1={dev_m['retry_f1']:.4f}")

    save_model_bundle(OUT, model, vocab, config)
    param_count = sum(p.numel() for p in model.parameters())
    weights_size = (OUT / "weights.pt").stat().st_size

    test_loader = DataLoader(
        UtteranceDataset(test_samples, vocab),
        batch_size=32,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )
    test_m = compute_metrics(model, test_loader, device, class_weight)
    dev_m = compute_metrics(model, dev_loader, device, class_weight)
    bucket_m = bucket_eval(model, test_samples, vocab, sidecar, device)

    real_subset = [s for s in test_samples if sidecar.get(s["sampleId"], {}).get("anchorDietBucket") == "REAL_DOMAIN"]
    real_metrics = None
    if len(real_subset) >= 50:
        real_loader = DataLoader(
            UtteranceDataset(real_subset, vocab),
            batch_size=32,
            shuffle=False,
            collate_fn=lambda b: collate_batch(b, device),
        )
        real_metrics = compute_metrics(model, real_loader, device, class_weight)
        real_metrics["samples"] = len(real_subset)
    else:
        real_metrics = {"status": "INSUFFICIENT_REAL_DOMAIN_SAMPLE", "samples": len(real_subset)}

    (DOCS / "model3_v1_training_metrics.json").write_text(
        json.dumps({"history": history, "train_seconds": time.time() - t0}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_dev_metrics.json").write_text(json.dumps(dev_m, ensure_ascii=False, indent=2), encoding="utf-8")
    (DOCS / "model3_v1_test_metrics.json").write_text(json.dumps(test_m, ensure_ascii=False, indent=2), encoding="utf-8")
    with (DOCS / "model3_v1_confusion_matrix.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["", "pred_KEEP", "pred_RETRY"])
        w.writerow(["true_KEEP", test_m["tn"], test_m["fp"]])
        w.writerow(["true_RETRY", test_m["fn"], test_m["tp"]])
    (DOCS / "model3_v1_bucket_metrics.csv").write_text(
        json.dumps(bucket_m, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    checksum_rows = []
    for name in ("weights.pt", "vocab.json", "config.json", "model_manifest.json"):
        p = OUT / name
        checksum_rows.append({"path": str(p.relative_to(REPO)).replace("\\", "/"), "sha256": sha256_file(p)})
    with (OUT / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256\n")
        for row in checksum_rows:
            f.write(f"{row['path']},{row['sha256']}\n")

    print(json.dumps({"test": test_m, "params": param_count, "size_bytes": weights_size}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
