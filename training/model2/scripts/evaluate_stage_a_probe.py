#!/usr/bin/env python
"""Re-evaluate existing Stage A probe checkpoints (offline)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.evaluation.evaluate import evaluate_model_on_rows
from training.model2.model.model_v1 import Model2Config, Model2StageAV1
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import (
    enrich_trainrows,
    load_candidate_index,
    load_jsonl,
    precompute_candidate_tensors,
)
from training.model2.evaluation.slices import slice_rows


def main() -> int:
    exp = ROOT / "training/model2/experiments/stage_a_probe_v1"
    trainrow_dir = ROOT / "training/model2/dataset/probe_trainrow_v1"
    ckpt_path = exp / "model2-stageA-probe-m0.pt"
    if not ckpt_path.exists():
        print("missing checkpoint", ckpt_path)
        return 1
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    model = Model2StageAV1(Model2Config(**{k: v for k, v in ckpt["config"].items() if k in Model2Config.__dataclass_fields__}))
    model.load_state_dict(ckpt["state_dict"])
    rows = load_jsonl(exp / "enriched_train_rows.jsonl") if (exp / "enriched_train_rows.jsonl").exists() else None
    if rows is None:
        raw = load_jsonl(trainrow_dir / "model2_train_rows.jsonl")
        samples = {
            s["sample_id"]: s
            for s in load_jsonl(ROOT / "training/model2/dataset/probe_v1/training_samples.jsonl")
        }
        index = load_candidate_index(
            trainrow_dir / "candidate_index.jsonl", trainrow_dir / "candidate_index_meta.json"
        )
        vocab = SyllableVocabV1.load(trainrow_dir / "syl-vocab-v1.json")
        rows = enrich_trainrows(raw, samples, index, vocab)
    else:
        index = load_candidate_index(
            trainrow_dir / "candidate_index.jsonl", trainrow_dir / "candidate_index_meta.json"
        )
        vocab = SyllableVocabV1.load(trainrow_dir / "syl-vocab-v1.json")
    cand_cache = precompute_candidate_tensors(index, vocab)
    cfg = StageATrainConfig()
    metrics = evaluate_model_on_rows(model, slice_rows(rows), cand_cache, cfg)
    print(json.dumps(metrics, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
