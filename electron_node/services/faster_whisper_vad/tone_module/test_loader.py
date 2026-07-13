"""ToneModelLoader contract — fail-closed, metadata, feature baseline."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tone_module.classifier import HIDDEN, N_CLASSES, ToneClassifier, reset_tone_classifier_singleton
from tone_module.contract import (
    METADATA_WARNING_FEATURE_VERSION_MISSING,
    P0_FEATURE_VERSION,
    P0_N_MELS,
)
from tone_module.loader import ToneModelLoader, reset_tone_loader_singleton


def _write_valid_model(path: Path, **extra) -> None:
    rng = np.random.default_rng(0)
    payload = dict(
        w1=rng.normal(0, 0.05, size=(P0_N_MELS, HIDDEN)).astype(np.float32),
        b1=np.zeros(HIDDEN, dtype=np.float32),
        w2=rng.normal(0, 0.05, size=(HIDDEN, N_CLASSES)).astype(np.float32),
        b2=np.zeros(N_CLASSES, dtype=np.float32),
    )
    payload.update(extra)
    np.savez(path, **payload)


class ToneModelLoaderTest(unittest.TestCase):
    def tearDown(self) -> None:
        reset_tone_classifier_singleton()
        reset_tone_loader_singleton()

    def test_missing_model(self) -> None:
        loader = ToneModelLoader()
        result = loader.load(str(Path(tempfile.gettempdir()) / "tone_missing_loader_xyz.npz"))
        self.assertFalse(result.ready)
        self.assertFalse(loader.ready)
        self.assertEqual(loader.load_error, "model_not_found")

    def test_valid_model_metadata_defaults(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as tmp:
            valid_path = Path(tmp.name)
        try:
            _write_valid_model(valid_path)
            loader = ToneModelLoader()
            result = loader.load(str(valid_path))
            self.assertTrue(result.ready)
            self.assertIsNotNone(result.metadata)
            assert result.metadata is not None
            self.assertEqual(result.metadata.feature_version, P0_FEATURE_VERSION)
            self.assertEqual(result.metadata.metadata_warning, METADATA_WARNING_FEATURE_VERSION_MISSING)
            self.assertEqual(result.metadata.backend, "numpy_p0")
            self.assertIsNotNone(result.metadata.model_hash)
        finally:
            os.unlink(valid_path)

    def test_feature_mismatch_fail_closed(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as tmp:
            valid_path = Path(tmp.name)
        try:
            _write_valid_model(valid_path, featureVersion=np.array("p0-v2"))
            loader = ToneModelLoader()
            result = loader.load(str(valid_path))
            self.assertFalse(result.ready)
            self.assertIn("feature mismatch", loader.load_error or "")
        finally:
            os.unlink(valid_path)

    def test_shape_mismatch_fail_closed(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as tmp:
            valid_path = Path(tmp.name)
        try:
            rng = np.random.default_rng(1)
            np.savez(
                valid_path,
                w1=rng.normal(0, 0.05, size=(64, HIDDEN)).astype(np.float32),
                b1=np.zeros(HIDDEN, dtype=np.float32),
                w2=rng.normal(0, 0.05, size=(HIDDEN, N_CLASSES)).astype(np.float32),
                b2=np.zeros(N_CLASSES, dtype=np.float32),
            )
            loader = ToneModelLoader()
            result = loader.load(str(valid_path))
            self.assertFalse(result.ready)
            self.assertIn("shape mismatch", loader.load_error or "")
        finally:
            os.unlink(valid_path)

    def test_classifier_uses_loader_metadata_diagnostics(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as tmp:
            valid_path = Path(tmp.name)
        try:
            _write_valid_model(valid_path, featureVersion=np.array(P0_FEATURE_VERSION))
            clf = ToneClassifier(model_path=str(valid_path))
            diag = clf.metadata_as_diagnostics()
            self.assertEqual(diag.get("featureVersion"), P0_FEATURE_VERSION)
            self.assertEqual(diag.get("backend"), "numpy_p0")
            self.assertNotIn("metadataWarning", diag)
        finally:
            os.unlink(valid_path)


if __name__ == "__main__":
    unittest.main()
