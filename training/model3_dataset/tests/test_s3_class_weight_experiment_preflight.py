# -*- coding: utf-8
"""Tests for S3 class-weight experiment config parity (T_CONFIG_1–10)."""
from __future__ import annotations

import argparse
import unittest
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train import train_s3_random as trainer  # noqa: E402

BASELINE = {
    "class_weight_retry": 1.0,
    "sampling": "uniform_shuffle_utterance",
    "hardNegativeMode": "NONE",
    "seed": 2026083013,
    "datasetId": "MODEL3_V2_PRODUCTION_CORE_S3",
    "datasetBuildId": "prod_core_s3_build_20260830_v1",
    "featureContract": "packModel3SpanInferFields",
    "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
    "optimizer": "Adam",
    "lr": 1e-3,
    "batch_size": 64,
    "epochs": 8,
    "checkpointSelectionCriterion": "best_dev_retry_f1",
    "embed_dim": 64,
    "hidden_dim": 128,
    "feat_dim": 6,
}


def resolve(exp_id: str | None, cw: float | None):
    ns = argparse.Namespace(
        experiment_id=exp_id,
        class_weight_retry=cw,
        force_fresh_run=True,
        run_id=None,
    )
    return trainer.resolve_run(ns)


class TestS3ClassWeightExperimentPreflight(unittest.TestCase):
    def test_t_config_1_a1_weight(self):
        mid, cw, _, kind = resolve("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1", 2.0)
        self.assertEqual(cw, 2.0)
        self.assertEqual(mid, "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1")
        self.assertEqual(kind, "experiment")

    def test_t_config_2_a2_weight(self):
        _, cw, _, _ = resolve("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2", 4.0)
        self.assertEqual(cw, 4.0)

    def test_t_config_3_baseline_weight(self):
        _, cw, out, kind = resolve(None, None)
        self.assertEqual(cw, 1.0)
        self.assertEqual(kind, "baseline")
        self.assertEqual(out, trainer.BASELINE_OUT)

    def test_fail_closed_missing_weight(self):
        with self.assertRaises(SystemExit):
            resolve("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1", None)

    def test_fail_closed_invalid_weight(self):
        with self.assertRaises(SystemExit):
            resolve("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1", 0.0)

    def test_parity_fields_identical_except_weight(self):
        _, cw_a1, _, _ = resolve("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1", 2.0)
        _, cw_a2, _, _ = resolve("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2", 4.0)
        _, cw_b, _, _ = resolve(None, None)
        self.assertEqual(trainer.SEED, BASELINE["seed"])
        self.assertEqual(trainer.BATCH, BASELINE["batch_size"])
        self.assertEqual(trainer.EPOCHS, BASELINE["epochs"])
        self.assertEqual(trainer.LR, BASELINE["lr"])
        self.assertEqual(cw_b, BASELINE["class_weight_retry"])
        self.assertNotEqual(cw_a1, cw_b)
        self.assertNotEqual(cw_a2, cw_b)
        self.assertEqual({cw_a1, cw_b, cw_a2}, {1.0, 2.0, 4.0})


if __name__ == "__main__":
    unittest.main()
