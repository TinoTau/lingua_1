"""ToneClassifier fail-closed contract — missing / corrupt / invalid / valid P1 model."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tone_module import contract
from tone_module.classifier import FEATURE_SHAPE, N_CLASSES, ToneClassifier
from tone_module.loader_v1 import save_artifact_v1
from tone_module.models.cnn_p1 import init_cnn_p1_weights


def _write_valid_p1_model(path: Path) -> None:
    rng = np.random.default_rng(0)
    raw = init_cnn_p1_weights(rng)
    weights = contract.ToneModelWeightsV1(
        conv1_w=raw.conv1_w,
        conv1_b=raw.conv1_b,
        conv2_w=raw.conv2_w,
        conv2_b=raw.conv2_b,
        fc_w=raw.fc_w,
        fc_b=raw.fc_b,
        feature_mean=np.zeros(contract.P1_N_CHANNELS, dtype=np.float32),
        feature_std=np.ones(contract.P1_N_CHANNELS, dtype=np.float32),
    )
    save_artifact_v1(
        str(path),
        weights,
        model_version="tone_cnn_p1_test",
        training_version="test",
        dataset_version="test",
        metrics={"val_acc": 0.0},
    )


class ToneClassifierFailClosedTest(unittest.TestCase):
    def test_missing_model(self) -> None:
        clf = ToneClassifier(model_path=str(Path(tempfile.gettempdir()) / "tone_missing_xyz.npz"))
        self.assertFalse(clf.ready)
        self.assertIsNotNone(clf.load_error)
        out = clf.predict_batch(np.ones((2, *FEATURE_SHAPE), dtype=np.float32))
        self.assertEqual(out.shape, (0, N_CLASSES))

    def test_corrupt_model(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as tmp:
            tmp.write(b"not-a-valid-npz")
            corrupt_path = tmp.name
        try:
            clf = ToneClassifier(model_path=corrupt_path)
            self.assertFalse(clf.ready)
            self.assertIsNotNone(clf.load_error)
        finally:
            os.unlink(corrupt_path)

    def test_invalid_model_format(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as tmp:
            np.savez(tmp.name, foo=np.zeros(1, dtype=np.float32))
            invalid_path = tmp.name
        try:
            clf = ToneClassifier(model_path=invalid_path)
            self.assertFalse(clf.ready)
            self.assertIn("missing required weight key", clf.load_error or "")
        finally:
            os.unlink(invalid_path)

    def test_valid_model(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as tmp:
            valid_path = Path(tmp.name)
        try:
            _write_valid_p1_model(valid_path)
            clf = ToneClassifier(model_path=str(valid_path))
            self.assertTrue(clf.ready)
            self.assertIsNone(clf.load_error)
            diag = clf.metadata_as_diagnostics()
            self.assertEqual(diag.get("backend"), contract.P1_BACKEND)
            self.assertEqual(diag.get("featureVersion"), contract.P1_FEATURE_VERSION)
            out = clf.predict_batch(np.ones((3, *FEATURE_SHAPE), dtype=np.float32))
            self.assertEqual(out.shape, (3, N_CLASSES))
            self.assertTrue(np.all(out >= 0))
            self.assertTrue(np.allclose(out.sum(axis=-1), 1.0, atol=1e-5))
        finally:
            os.unlink(valid_path)


if __name__ == "__main__":
    unittest.main()
