"""P9-C3 Torch GPU smoke training tests."""
from __future__ import annotations

import os
import tempfile
import unittest

import numpy as np

from tone_module import contract
from tone_module.loader_v1 import save_artifact_v1
from tone_module.training.gpu.env_probe import require_cuda_for_training
from tone_module.training.gpu.trainer import train_cnn_p1_torch
from tone_module.validate_artifact_v1 import validate_artifact_v1


class TorchTrainSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        require_cuda_for_training()

    def test_gpu_smoke_one_epoch(self) -> None:
        rng = np.random.default_rng(0)
        n_train, n_val = 512, 128
        x_train = rng.normal(size=(n_train, *contract.P1_FEATURE_SHAPE)).astype(np.float32)
        y_train = rng.integers(0, 5, size=n_train, dtype=np.int64)
        x_val = rng.normal(size=(n_val, *contract.P1_FEATURE_SHAPE)).astype(np.float32)
        y_val = rng.integers(0, 5, size=n_val, dtype=np.int64)

        weights, metrics = train_cnn_p1_torch(
            x_train,
            y_train,
            x_val,
            y_val,
            epochs=1,
            batch_size=128,
            learning_rate=0.01,
            seed=7,
        )
        self.assertEqual(weights.conv1_w.shape, (32, 83, 3))
        self.assertEqual(metrics.best_val_acc, metrics.epoch_history[0]["val_acc"])
        self.assertGreater(metrics.max_vram_bytes, 0)

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "smoke.npz")
            save_artifact_v1(
                path,
                weights,
                model_version="tone_cnn_p1_smoke",
                training_version="p9c3-smoke",
                dataset_version="synthetic",
                metrics={"val_acc": metrics.best_val_acc},
            )
            report = validate_artifact_v1(path, acceptance_features=x_val, acceptance_labels=y_val)
            self.assertTrue(report.passed, msg=report.to_notes())


if __name__ == "__main__":
  unittest.main()
