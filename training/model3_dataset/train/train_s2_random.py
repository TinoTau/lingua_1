# -*- coding: utf-8 -*-
"""MODEL3_V2_S2_RANDOM_INIT_V1 — one controlled S2 random-init training run."""
from __future__ import annotations

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

DATA = REPO / "training/model3_dataset/model3_v2_production_core_s2"
OUT = REPO / "training/model3_dataset/model3_v2_s2_random_init_v1_ckpts/seed_2026083011"
DOCS = REPO / "docs/user_correction/model3"

MODEL_ID = "MODEL3_V2_S2_RANDOM_INIT_V1"
SEED = 2026083011
EPOCHS = 8
BATCH = 64
LR = 1e-3
CLASS_WEIGHT_RETRY = 1.0


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


def main() -> int:
    # Hard gate: require pretrain QA authorization
    summary_path = DOCS / "model3_v2_production_core_s2_summary.json"
    if not summary_path.exists():
        print(json.dumps({"fatal": "missing S2 summary — finalize first"}))
        return 2
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if not summary.get("trainingAuthorized"):
        print(json.dumps({"fatal": "HARD STOP B: training not authorized", "verdict": summary.get("verdict")}))
        return 3

    set_seed(SEED)
    device = torch.device("cpu")
    train_samples = load_split("train")
    dev_samples = load_split("dev")
    test_samples = load_split("test")
    print(f"train={len(train_samples)} dev={len(dev_samples)} test={len(test_samples)}", flush=True)

    vocab = build_char_vocab(train_samples)
    config = {
        "modelId": MODEL_ID,
        "datasetId": "MODEL3_V2_PRODUCTION_CORE_S2",
        "datasetBuildId": "prod_core_s2_build_20260830_v1",
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
            f"[s2] epoch {epoch+1}/{EPOCHS} loss={row['train_loss']:.4f} "
            f"dev_retry_f1={dev_m['retry_f1']:.4f}",
            flush=True,
        )
        if dev_m["retry_f1"] >= best_f1:
            best_f1 = dev_m["retry_f1"]
            best_epoch = epoch + 1
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    OUT.mkdir(parents=True, exist_ok=True)
    save_model_bundle(OUT, model, vocab, config, model_name=MODEL_ID)
    weights_sha = file_sha(OUT / "weights.pt")
    test_m = compute_metrics(model, test_loader, device)
    dev_m = compute_metrics(model, dev_loader, device)
    metrics = {
        "phase": "MODEL3_V2_PRODUCTION_CORE_S2",
        "modelId": MODEL_ID,
        "seed": SEED,
        "checkpointDir": str(OUT.relative_to(REPO)).replace("\\", "/"),
        "weightsSha256": weights_sha,
        "bestEpoch": best_epoch,
        "trainSeconds": time.time() - t0,
        "config": config,
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
    (OUT / "training_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    (DOCS / "model3_v2_s2_checkpoint_manifest.json").write_text(
        json.dumps(
            {
                "modelId": MODEL_ID,
                "seed": SEED,
                "checkpointDir": str(OUT.relative_to(REPO)).replace("\\", "/"),
                "weightsSha256": weights_sha,
                "bestEpoch": best_epoch,
                "init": "random_from_scratch",
                "config": config,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"test_retry_f1": test_m["retry_f1"], "bestEpoch": best_epoch, "sha": weights_sha}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
