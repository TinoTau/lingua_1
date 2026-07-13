"""P9-C3 Torch→NumPy export parity tests."""
from __future__ import annotations

import unittest

import numpy as np
import torch

from tone_module import contract
from tone_module.models.cnn_p1 import forward_logits, init_cnn_p1_weights
from tone_module.models.cnn_p1_torch import CnnP1Torch
from tone_module.training.gpu.export import logits_parity_report, torch_model_to_weights_v1


class TorchNumpyExportParityTest(unittest.TestCase):
    def test_export_logits_match_numpy(self) -> None:
        rng = np.random.default_rng(11)
        init_w = init_cnn_p1_weights(rng)
        mean = np.zeros(contract.P1_N_CHANNELS, dtype=np.float32)
        std = np.ones(contract.P1_N_CHANNELS, dtype=np.float32)
        weights = contract.ToneModelWeightsV1(
            conv1_w=init_w.conv1_w,
            conv1_b=init_w.conv1_b,
            conv2_w=init_w.conv2_w,
            conv2_b=init_w.conv2_b,
            fc_w=init_w.fc_w,
            fc_b=init_w.fc_b,
            feature_mean=mean,
            feature_std=std,
        )
        features = rng.normal(size=(16, *contract.P1_FEATURE_SHAPE)).astype(np.float32)

        model = CnnP1Torch.from_numpy_weights(weights, device="cpu")
        exported = torch_model_to_weights_v1(model, feature_mean=mean, feature_std=std)
        numpy_logits, _ = forward_logits(features, exported)

        model.eval()
        with torch.no_grad():
            x = torch.from_numpy(features)
            torch_logits = model(x).numpy()

        max_diff = float(np.max(np.abs(torch_logits - numpy_logits)))
        self.assertLessEqual(max_diff, 1e-4)
        self.assertTrue(np.all(np.argmax(torch_logits, 1) == np.argmax(numpy_logits, 1)))

    @unittest.skipUnless(torch.cuda.is_available(), "CUDA required")
    def test_cuda_export_parity_report(self) -> None:
        rng = np.random.default_rng(3)
        weights = init_cnn_p1_weights(rng)
        weights = contract.ToneModelWeightsV1(
            conv1_w=weights.conv1_w,
            conv1_b=weights.conv1_b,
            conv2_w=weights.conv2_w,
            conv2_b=weights.conv2_b,
            fc_w=weights.fc_w,
            fc_b=weights.fc_b,
            feature_mean=np.zeros(contract.P1_N_CHANNELS, dtype=np.float32),
            feature_std=np.ones(contract.P1_N_CHANNELS, dtype=np.float32),
        )
        features = rng.normal(size=(8, *contract.P1_FEATURE_SHAPE)).astype(np.float32)
        model = CnnP1Torch.from_numpy_weights(weights, device="cuda")
        report = logits_parity_report(
            model, features, weights, device=torch.device("cuda"), max_abs_diff_threshold=1e-3
        )
        self.assertTrue(report["parityPass"])


if __name__ == "__main__":
    unittest.main()
