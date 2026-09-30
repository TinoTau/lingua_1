# -*- coding: utf-8
"""MODEL3_V2_PRODUCTION_CORE_S1_TRAINING_EXPERIMENT — controlled init comparison."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
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
from training.model3_dataset.train.train_v2_labeled import compute_metrics  # noqa: E402

DATA = REPO / "training/model3_dataset/model3_v2_production_core_s1"
DOCS = REPO / "docs/user_correction/model3"
REALDIST_CKPT = REPO / "training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903"

EPOCHS = 8
BATCH = 64
LR = 1e-3
CLASS_WEIGHT_RETRY = 1.0

RUNS = {
    "random": {
        "modelId": "MODEL3_V2_S1_RANDOM_INIT_V1",
        "seed": 2026083007,
        "out": REPO / "training/model3_dataset/model3_v2_s1_random_init_v1_ckpts/seed_2026083007",
        "init": "random_from_scratch",
        "initSource": None,
    },
    "realdist": {
        "modelId": "MODEL3_V2_S1_REALDIST_INIT_V1",
        "seed": 2026083008,
        "out": REPO / "training/model3_dataset/model3_v2_s1_realdist_init_v1_ckpts/seed_2026083008",
        "init": "realdist_checkpoint_partial",
        "initSource": str(REALDIST_CKPT.relative_to(REPO)).replace("\\", "/"),
    },
}


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
                    s = json.loads(line)
                    s["split"] = split
                    rows.append(s)
    return rows


class UtteranceDataset(Dataset):
    def __init__(self, samples: list[dict], vocab: dict[str, int]):
        self.samples = samples
        self.vocab = vocab

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return sample_to_tensors(self.samples[idx], self.vocab)


def set_seed(seed: int):
    random.seed(seed)
    torch.manual_seed(seed)


def partial_load_realdist(model: Model3BiGRUV1, ckpt: Path) -> dict:
    state = torch.load(ckpt / "weights.pt", map_location="cpu")
    model_state = model.state_dict()
    filtered = {}
    skipped = []
    for k, v in state.items():
        if k not in model_state:
            skipped.append(f"missing_in_target:{k}")
            continue
        if model_state[k].shape != v.shape:
            skipped.append(f"shape_mismatch:{k}:{tuple(v.shape)}->{tuple(model_state[k].shape)}")
            continue
        filtered[k] = v
    model.load_state_dict(filtered, strict=False)
    return {
        "loadedKeys": len(filtered),
        "skippedKeys": skipped,
        "sourceCheckpoint": str(ckpt),
    }


def train_run(mode: str) -> dict:
    spec = RUNS[mode]
    set_seed(spec["seed"])
    device = torch.device("cpu")

    train_samples = load_split("train")
    dev_samples = load_split("dev")
    test_samples = load_split("test")

    vocab = build_char_vocab(train_samples)
    config = {
        "modelId": spec["modelId"],
        "datasetId": "MODEL3_V2_PRODUCTION_CORE_S1",
        "datasetBuildId": "prod_core_s1_build_20260830_v1",
        "seed": spec["seed"],
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
        "init": spec["init"],
        "initSourceCheckpoint": spec["initSource"],
        "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
        "featureContract": "packModel3SpanInferFields",
        "decisionThreshold": "argmax",
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
    init_meta = {}
    if mode == "realdist":
        init_meta = partial_load_realdist(model, REALDIST_CKPT)

    opt = torch.optim.Adam(model.parameters(), lr=LR)
    cw = torch.tensor([1.0, float(CLASS_WEIGHT_RETRY)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")

    history = []
    best_f1 = -1.0
    best_epoch = 0
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
        row = {"epoch": epoch + 1, "train_loss": epoch_loss / max(n_batches, 1), "dev": dev_m}
        history.append(row)
        print(
            f"[{mode}] epoch {epoch+1}/{EPOCHS} loss={row['train_loss']:.4f} "
            f"dev_retry_f1={dev_m['retry_f1']:.4f}",
            flush=True,
        )
        if dev_m["retry_f1"] >= best_f1:
            best_f1 = dev_m["retry_f1"]
            best_epoch = epoch + 1
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    out_dir = spec["out"]
    out_dir.mkdir(parents=True, exist_ok=True)
    save_model_bundle(out_dir, model, vocab, config, model_name=spec["modelId"])
    weights_sha = file_sha(out_dir / "weights.pt")

    test_m = compute_metrics(model, test_loader, device)
    dev_m = compute_metrics(model, dev_loader, device)
    summary = {
        "phase": "MODEL3_V2_PRODUCTION_CORE_S1_TRAINING_EXPERIMENT",
        "mode": mode,
        "modelId": spec["modelId"],
        "seed": spec["seed"],
        "checkpointDir": str(out_dir.relative_to(REPO)).replace("\\", "/"),
        "weightsSha256": weights_sha,
        "bestEpoch": best_epoch,
        "trainSeconds": time.time() - t0,
        "config": config,
        "initMeta": init_meta,
        "history": history,
        "dev": dev_m,
        "test": test_m,
        "classifierBehavior": {
            "ALL_KEEP": test_m["pred_retry"] == 0,
            "OVER_RETRY": test_m["pred_retry_rate"] > 0.5,
            "NEAR_ALL_KEEP": test_m["pred_retry_rate"] < 0.001,
            "pred_retry_rate": test_m["pred_retry_rate"],
            "true_retry_rate": test_m["true_retry_rate"],
        },
    }
    (out_dir / "training_metrics.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--init", choices=["random", "realdist", "both"], default="both")
    args = ap.parse_args()
    modes = ["random", "realdist"] if args.init == "both" else [args.init]
    results = {}
    for m in modes:
        results[m] = train_run(m)
    shared = {
        "datasetId": "MODEL3_V2_PRODUCTION_CORE_S1",
        "datasetBuildId": "prod_core_s1_build_20260830_v1",
        "epochs": EPOCHS,
        "batch_size": BATCH,
        "lr": LR,
        "class_weight_retry": CLASS_WEIGHT_RETRY,
        "optimizer": "Adam",
        "decisionThreshold": "argmax",
        "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
        "featureContract": "packModel3SpanInferFields",
    }
    (DOCS / "model3_v2_s1_training_config.json").write_text(
        json.dumps(shared, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    manifest = {
        "randomInit": {
            "modelId": RUNS["random"]["modelId"],
            "seed": RUNS["random"]["seed"],
            "checkpointDir": str(RUNS["random"]["out"].relative_to(REPO)).replace("\\", "/"),
            "weightsSha256": results.get("random", {}).get("weightsSha256"),
        },
        "realDistInit": {
            "modelId": RUNS["realdist"]["modelId"],
            "seed": RUNS["realdist"]["seed"],
            "checkpointDir": str(RUNS["realdist"]["out"].relative_to(REPO)).replace("\\", "/"),
            "initSource": RUNS["realdist"]["initSource"],
            "weightsSha256": results.get("realdist", {}).get("weightsSha256"),
        },
    }
    (DOCS / "model3_v2_s1_checkpoint_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: {"test_retry_f1": v["test"]["retry_f1"], "bestEpoch": v["bestEpoch"]} for k, v in results.items()}, indent=2))


if __name__ == "__main__":
    main()
