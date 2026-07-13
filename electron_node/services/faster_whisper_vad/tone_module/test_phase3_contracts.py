"""Phase 3 contract regression gates (Addendum II §8)."""
from __future__ import annotations

import inspect
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tone_module import contract
from tone_module import mel
from tone_module import train_tone_cnn
from tone_module.backends import numpy_p0
from tone_module.offline_tone_eval import run_offline_evaluation
from tone_module.validate_artifact import validate_artifact

_TONE_ROOT = Path(__file__).resolve().parent
_PRODUCTION_RUNTIME_FILES = (
    Path(__file__).resolve().parents[1] / "api_routes.py",
    _TONE_ROOT / "inference.py",
    _TONE_ROOT / "__init__.py",
)

_FORBIDDEN_OFFLINE_IMPORTS = (
    "recall",
    "ranking",
    "assembly",
    "kenlm",
    "apply",
    "inference",
    "classifier",
    "get_tone_loader",
)


def _write_minimal_artifact(path: str) -> None:
    rng = np.random.default_rng(0)
    w1 = rng.normal(0, 0.01, size=(contract.P0_N_MELS, contract.P0_HIDDEN)).astype(np.float32)
    b1 = np.zeros(contract.P0_HIDDEN, dtype=np.float32)
    w2 = rng.normal(0, 0.01, size=(contract.P0_HIDDEN, contract.P0_N_CLASSES)).astype(np.float32)
    b2 = np.zeros(contract.P0_N_CLASSES, dtype=np.float32)
    mel_mean = np.zeros(contract.P0_N_MELS, dtype=np.float32)
    mel_std = np.ones(contract.P0_N_MELS, dtype=np.float32)
    np.savez(
        path,
        w1=w1,
        b1=b1,
        w2=w2,
        b2=b2,
        mel_mean=mel_mean,
        mel_std=mel_std,
        featureVersion=np.array(contract.P0_FEATURE_VERSION),
        backend=np.array(contract.P0_BACKEND),
    )


class FeatureParityTest(unittest.TestCase):
    def test_train_references_contract_ssot(self) -> None:
        source = inspect.getsource(train_tone_cnn)
        self.assertIn("contract.P0_N_MELS", source)
        self.assertIn("contract.P0_HIDDEN", source)
        self.assertIn("contract.P0_N_CLASSES", source)
        self.assertIn("contract.P0_FEATURE_VERSION", source)
        self.assertIn("contract.P0_BACKEND", source)
        self.assertNotIn("HIDDEN = 32", source)
        self.assertNotIn("N_MELS = 80", source)
        from tone_module.dataset.alignment_textgrid import TextGridPinyinAlignmentProvider

        align_src = inspect.getsource(TextGridPinyinAlignmentProvider)
        self.assertIn("contract.P0_MIN_SLICE_SEC", align_src)

    def test_train_cli_has_dataset_repo(self) -> None:
        source = inspect.getsource(train_tone_cnn.main)
        self.assertIn("--dataset-repo", source)
        self.assertIn("--dataset-zip", source)

    def test_train_uses_runtime_mel_extractor(self) -> None:
        source = inspect.getsource(train_tone_cnn)
        self.assertIn("extract_mel_features", source)
        self.assertEqual(mel.N_MELS, contract.P0_N_MELS)


class RuntimeAdapterValidationTest(unittest.TestCase):
    def test_artifact_passes_numpy_p0_infer_batch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "probe.npz")
            _write_minimal_artifact(path)
            mel_batch = np.zeros((3, contract.P0_N_MELS), dtype=np.float32)
            report = validate_artifact(path, acceptance_mel=mel_batch)
            self.assertTrue(report.adapter_ok, msg=report.to_notes())
            self.assertTrue(report.passed, msg=report.to_notes())


class ArtifactValidationTest(unittest.TestCase):
    def test_valid_artifact_passes_loader_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "valid.npz")
            _write_minimal_artifact(path)
            report = validate_artifact(path)
            self.assertTrue(report.schema_ok)
            self.assertTrue(report.shape_ok)
            self.assertTrue(report.loader_ok)
            self.assertTrue(report.passed)

    def test_missing_required_key_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.npz")
            np.savez(path, w1=np.zeros((80, 32), dtype=np.float32))
            report = validate_artifact(path)
            self.assertFalse(report.passed)
            self.assertFalse(report.schema_ok)


class OfflineEvaluationIsolationTest(unittest.TestCase):
    def test_offline_eval_module_has_no_runtime_decision_imports(self) -> None:
        from tone_module import offline_tone_eval

        source = inspect.getsource(offline_tone_eval).lower()
        for token in _FORBIDDEN_OFFLINE_IMPORTS:
            self.assertNotIn(token, source)

    def test_offline_eval_uses_infer_batch_only(self) -> None:
        from tone_module import offline_tone_eval

        source = inspect.getsource(offline_tone_eval)
        self.assertIn("infer_batch", source)
        self.assertNotIn("get_tone_loader", source)

    def test_offline_eval_does_not_touch_production_runtime_files(self) -> None:
        offline_path = _TONE_ROOT / "offline_tone_eval.py"
        offline_text = offline_path.read_text(encoding="utf-8")
        for path in _PRODUCTION_RUNTIME_FILES:
            runtime_text = path.read_text(encoding="utf-8")
            self.assertNotIn("offline_tone_eval", runtime_text, msg=path.name)

    def test_offline_evaluation_report_shape(self) -> None:
        rng = np.random.default_rng(1)
        w1 = rng.normal(0, 0.01, size=(contract.P0_N_MELS, contract.P0_HIDDEN)).astype(np.float32)
        b1 = np.zeros(contract.P0_HIDDEN, dtype=np.float32)
        w2 = rng.normal(0, 0.01, size=(contract.P0_HIDDEN, contract.P0_N_CLASSES)).astype(np.float32)
        b2 = np.zeros(contract.P0_N_CLASSES, dtype=np.float32)
        weights = contract.ToneModelWeights(
            w1=w1,
            b1=b1,
            w2=w2,
            b2=b2,
            mel_mean=np.zeros(contract.P0_N_MELS, dtype=np.float32),
            mel_std=np.ones(contract.P0_N_MELS, dtype=np.float32),
        )
        mel_batch = rng.normal(0, 1, size=(8, contract.P0_N_MELS)).astype(np.float32)
        labels = np.array([0, 1, 2, 3, 4, 0, 1, 2], dtype=np.int64)
        report = run_offline_evaluation(mel_batch, labels, weights)
        self.assertTrue(report.passed)
        self.assertEqual(len(report.confusion_matrix), contract.P0_N_CLASSES)
        self.assertEqual(len(report.posterior_mean), contract.P0_N_CLASSES)
        self.assertIn("offline evaluation only", report.notes)


class ValidationReportContractTest(unittest.TestCase):
    def test_no_validation_result_in_artifact_writer(self) -> None:
        source = inspect.getsource(train_tone_cnn)
        self.assertNotIn("validationResult", source)

    def test_validate_artifact_after_save(self) -> None:
        source = inspect.getsource(train_tone_cnn)
        self.assertIn("validate_artifact", source)

    def test_validate_artifact_has_cli_main(self) -> None:
        from tone_module import validate_artifact

        source = inspect.getsource(validate_artifact)
        self.assertIn("--artifact", source)
        self.assertIn("--json-out", source)

    def test_offline_eval_has_cli_main(self) -> None:
        from tone_module import offline_tone_eval

        source = inspect.getsource(offline_tone_eval)
        self.assertIn("--artifact", source)
        self.assertIn("--json-out", source)
        self.assertIn("--eval-json", source)


if __name__ == "__main__":
    unittest.main()
