# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_RANDOM_INIT_V1 — controlled S3 random-init training run."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
from datetime import datetime, timezone
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

DATA = REPO / "training/model3_dataset/model3_v2_production_core_s3"
BASELINE_OUT = REPO / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013"
DOCS = REPO / "docs/user_correction/model3"

PARENT_MODEL_ID = "MODEL3_V2_S3_RANDOM_INIT_V1"
PARENT_WEIGHTS_SHA = "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1"
SEED = 2026083013
EPOCHS = 8
BATCH = 64
LR = 1e-3
BASELINE_CLASS_WEIGHT_RETRY = 1.0

# Historical A1/A2 kept as artifacts only — never selected by force-fresh RERUN1 IDs.
EXP_OUT_DIRS = {
    "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1": REPO
    / "training/model3_dataset/model3_v2_s3_exp_class_weight_a1/seed_2026083013",
    "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2": REPO
    / "training/model3_dataset/model3_v2_s3_exp_class_weight_a2/seed_2026083013",
    "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1": REPO
    / "training/model3_dataset/model3_v2_s3_exp_class_weight_a1_rerun1/seed_2026083013",
    "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2_RERUN1": REPO
    / "training/model3_dataset/model3_v2_s3_exp_class_weight_a2_rerun1/seed_2026083013",
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


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="S3 random-init Model3 training")
    p.add_argument("--experiment-id", default=None)
    p.add_argument("--class-weight-retry", type=float, default=None)
    p.add_argument(
        "--force-fresh-run",
        action="store_true",
        help="Require fresh training; refuse if target weights.pt already exists (no reuse/skip/resume).",
    )
    p.add_argument("--run-id", default=None, help="Explicit runId recorded in provenance")
    return p.parse_args()


def resolve_run(args: argparse.Namespace) -> tuple[str, float, Path, str]:
    exp_id = args.experiment_id
    if exp_id is None and args.class_weight_retry is None:
        return PARENT_MODEL_ID, BASELINE_CLASS_WEIGHT_RETRY, BASELINE_OUT, "baseline"

    if not exp_id or args.class_weight_retry is None:
        raise SystemExit(
            "MODEL3_CLASS_WEIGHT_EXPERIMENT_CONFIG_INCOMPLETE:experiment requires --experiment-id and --class-weight-retry"
        )
    if args.class_weight_retry <= 0:
        raise SystemExit(f"MODEL3_CLASS_WEIGHT_INVALID:{args.class_weight_retry}")
    if exp_id not in EXP_OUT_DIRS:
        raise SystemExit(f"MODEL3_UNKNOWN_EXPERIMENT_ID:{exp_id}")
    return exp_id, float(args.class_weight_retry), EXP_OUT_DIRS[exp_id], "experiment"


def main() -> int:
    args = parse_args()
    try:
        model_id, class_weight_retry, out_dir, run_kind = resolve_run(args)
    except SystemExit as e:
        print(json.dumps({"fatal": str(e)}))
        return 2

    run_id = args.run_id or f"{model_id}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    training_start = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if run_kind == "experiment":
        if not args.force_fresh_run:
            print(json.dumps({"fatal": "MODEL3_FORCE_FRESH_REQUIRED:experiment runs require --force-fresh-run"}))
            return 2
        if (out_dir / "weights.pt").exists():
            print(
                json.dumps(
                    {
                        "fatal": "MODEL3_CHECKPOINT_EXISTS_NO_REUSE",
                        "out_dir": str(out_dir),
                        "hint": "Use a new experimentId / empty directory; do not skip or resume",
                    }
                )
            )
            return 2

    summary_path = DOCS / "model3_v2_production_core_s3_summary.json"
    if not summary_path.exists():
        print(json.dumps({"fatal": "missing S3 summary — finalize first"}))
        return 2
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if not summary.get("trainingAuthorized"):
        print(json.dumps({"fatal": "HARD STOP C: training not authorized", "verdict": summary.get("verdict")}))
        return 3

    print(
        json.dumps(
            {
                "trainingExecuted": True,
                "skipped": False,
                "resumed": False,
                "reusedCheckpoint": False,
                "experimentId": model_id,
                "runId": run_id,
                "trainingStartTime": training_start,
                "outputDirectory": str(out_dir.relative_to(REPO)).replace("\\", "/"),
                "classWeightRetry": class_weight_retry,
                "forceFreshRun": bool(args.force_fresh_run),
            }
        ),
        flush=True,
    )

    set_seed(SEED)
    device = torch.device("cpu")
    train_samples = load_split("train")
    dev_samples = load_split("dev")
    test_samples = load_split("test")
    print(f"train={len(train_samples)} dev={len(dev_samples)} test={len(test_samples)}", flush=True)

    vocab = build_char_vocab(train_samples)
    config = {
        "modelId": model_id,
        "parentModelId": PARENT_MODEL_ID,
        "parentWeightsSha256": PARENT_WEIGHTS_SHA,
        "experimentId": model_id if run_kind == "experiment" else None,
        "runId": run_id,
        "datasetId": "MODEL3_V2_PRODUCTION_CORE_S3",
        "datasetBuildId": "prod_core_s3_build_20260830_v1",
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
        "class_weight_retry": class_weight_retry,
        "keep_class_weight": 1.0,
        "auto_class_weight_formula": False,
        "sampling": "uniform_shuffle_utterance",
        "hardNegativeMode": "NONE",
        "pair_loss_enabled": False,
        "init": "random_from_scratch",
        "initializationMode": "random_from_scratch",
        "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
        "featureContract": "packModel3SpanInferFields",
        "decisionThreshold": "argmax",
        "checkpointSelectionCriterion": "best_dev_retry_f1",
        "parentExperimentDesign": "MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT",
        "trainingStartTime": training_start,
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
    cw = torch.tensor([1.0, float(class_weight_retry)], device=device)
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
        train_m = compute_metrics(model, train_loader, device)
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
            "train": train_m,
            "dev": dev_m,
        }
        history.append(row)
        print(
            f"[s3] {model_id} epoch {epoch+1}/{EPOCHS} loss={row['train_loss']:.4f} "
            f"dev_retry_f1={dev_m['retry_f1']:.4f} cw={class_weight_retry}",
            flush=True,
        )
        if dev_m["retry_f1"] >= best_f1:
            best_f1 = dev_m["retry_f1"]
            best_epoch = epoch + 1
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    training_end = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out_dir.mkdir(parents=True, exist_ok=True)
    config["trainingEndTime"] = training_end
    config["selectedEpoch"] = best_epoch
    save_model_bundle(out_dir, model, vocab, config, model_name=model_id)
    weights_sha = file_sha(out_dir / "weights.pt")
    config["weightsSha256"] = weights_sha
    (out_dir / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    config_sha = file_sha(out_dir / "config.json")

    test_m = compute_metrics(model, test_loader, device)
    dev_m = compute_metrics(model, dev_loader, device)
    train_m = compute_metrics(model, train_loader, device)

    def false_retry_rate(m: dict) -> float:
        return m["fp"] / max(m["tn"] + m["fp"], 1)

    metrics = {
        "phase": "MODEL3_V2_S3_CLASS_WEIGHT_FORCED_RETRAIN" if run_kind == "experiment" else "MODEL3_V2_PRODUCTION_CORE_S3",
        "experimentId": model_id if run_kind == "experiment" else PARENT_MODEL_ID,
        "runId": run_id,
        "parentModelId": PARENT_MODEL_ID,
        "parentWeightsSha256": PARENT_WEIGHTS_SHA,
        "modelId": model_id,
        "seed": SEED,
        "checkpointDir": str(out_dir.relative_to(REPO)).replace("\\", "/"),
        "weightsSha256": weights_sha,
        "configSha256": config_sha,
        "bestEpoch": best_epoch,
        "selectedEpoch": best_epoch,
        "checkpointSelectionCriterion": "best_dev_retry_f1",
        "classWeightRetry": class_weight_retry,
        "keepClassWeight": 1.0,
        "samplingMode": "uniform_shuffle_utterance",
        "hardNegativeMode": "NONE",
        "initializationMode": "random_from_scratch",
        "trainingStartTime": training_start,
        "trainingEndTime": training_end,
        "trainingExecuted": True,
        "skipped": False,
        "resumed": False,
        "reusedCheckpoint": False,
        "trainSeconds": time.time() - t0,
        "config": config,
        "history": history,
        "trainMetrics": {**train_m, "keepFalseRetryRate": false_retry_rate(train_m)},
        "devMetrics": {**dev_m, "keepFalseRetryRate": false_retry_rate(dev_m)},
        "test": test_m,
        "dev": dev_m,
        "train": train_m,
        "classifierBehavior": {
            "ALL_KEEP": test_m["pred_retry"] == 0,
            "OVER_RETRY": test_m["pred_retry_rate"] > 0.5,
            "NEAR_ALL_KEEP": test_m["pred_retry_rate"] < 0.001,
            "pred_retry_rate": test_m["pred_retry_rate"],
            "true_retry_rate": test_m["true_retry_rate"],
        },
    }
    metrics_path = out_dir / "training_metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    metrics_sha = file_sha(metrics_path)

    exp_manifest = {
        "experimentId": model_id,
        "runId": run_id,
        "parentExperimentDesign": "MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT",
        "parentModelId": PARENT_MODEL_ID,
        "parentWeightsSha256": PARENT_WEIGHTS_SHA,
        "datasetId": "MODEL3_V2_PRODUCTION_CORE_S3",
        "datasetBuildId": "prod_core_s3_build_20260830_v1",
        "featureContract": "packModel3SpanInferFields",
        "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
        "seed": SEED,
        "initializationMode": "random_from_scratch",
        "classWeightRetry": class_weight_retry,
        "keepClassWeight": 1.0,
        "samplingMode": "uniform_shuffle_utterance",
        "hardNegativeMode": "NONE",
        "optimizer": "Adam",
        "learningRate": LR,
        "batchSize": BATCH,
        "epochBudget": EPOCHS,
        "checkpointSelectionCriterion": "best_dev_retry_f1",
        "trainingStartTime": training_start,
        "trainingEndTime": training_end,
        "selectedEpoch": best_epoch,
        "weightsSha256": weights_sha,
        "configSha256": config_sha,
        "metricsSha256": metrics_sha,
        "checkpointDir": str(out_dir.relative_to(REPO)).replace("\\", "/"),
        "trainingExecuted": True,
        "skipped": False,
        "resumed": False,
        "reusedCheckpoint": False,
    }
    (out_dir / "experiment_manifest.json").write_text(
        json.dumps(exp_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if run_kind == "baseline":
        (DOCS / "model3_v2_s3_checkpoint_manifest.json").write_text(
            json.dumps(
                {
                    "modelId": PARENT_MODEL_ID,
                    "seed": SEED,
                    "checkpointDir": str(out_dir.relative_to(REPO)).replace("\\", "/"),
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

    print(
        json.dumps(
            {
                "experimentId": model_id,
                "runId": run_id,
                "classWeightRetry": class_weight_retry,
                "dev_retry_f1": dev_m["retry_f1"],
                "bestEpoch": best_epoch,
                "sha": weights_sha,
                "trainingExecuted": True,
                "skipped": False,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
