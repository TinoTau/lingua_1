"""Phase 6-D dataset pipeline foundation regression gates."""
from __future__ import annotations

import inspect
import os
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import numpy as np

from tone_module import contract
from tone_module import train_tone_cnn
from tone_module.dataset import (
    DEFAULT_DATASET_REPO,
    TextGridPinyinAlignmentProvider,
    default_data_mini_pipeline,
)
from tone_module.dataset.alignment_textgrid import tone_label_from_pinyin
from tone_module.dataset.cache_layout import CacheLayout
from tone_module.validate_artifact import validate_artifact

_TONE_ROOT = Path(__file__).resolve().parent
_RUNTIME_FROZEN = (
    _TONE_ROOT / "contract.py",
    _TONE_ROOT / "loader.py",
    _TONE_ROOT / "mel.py",
    _TONE_ROOT / "inference.py",
    _TONE_ROOT / "classifier.py",
    _TONE_ROOT / "backends" / "numpy_p0.py",
)

# Baseline from Phase 6-C audit (data_mini @ seed=42)
_BASELINE_TOTAL_SYLLABLES = 11820
_BASELINE_TRAIN_SYLLABLES = 10012
_BASELINE_VAL_SYLLABLES = 1808
_BASELINE_CLASS_TOTAL = {0: 2570, 1: 2702, 2: 1716, 3: 4314, 4: 518}


class DatasetContractTest(unittest.TestCase):
    def test_syllable_labels_in_range(self) -> None:
        for token, expected in [("ma1", 0), ("ma5", 4), ("guang3", 2)]:
            label = tone_label_from_pinyin(token)
            self.assertIsNotNone(label)
            assert label is not None
            self.assertEqual(label, expected)
            self.assertGreaterEqual(label, 0)
            self.assertLess(label, contract.P0_N_CLASSES)

    def test_alignment_uses_contract_min_slice(self) -> None:
        source = inspect.getsource(TextGridPinyinAlignmentProvider)
        self.assertIn("contract.P0_MIN_SLICE_SEC", source)


class DataMiniCompatibilityTest(unittest.TestCase):
    def test_sample_count_matches_baseline(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        self.assertEqual(len(samples), _BASELINE_TOTAL_SYLLABLES)
        self.assertEqual(manifest.metadata.syllable_count, _BASELINE_TOTAL_SYLLABLES)
        self.assertEqual(manifest.metadata.utterance_count, 466)

    def test_class_distribution_matches_baseline(self) -> None:
        samples, _ = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        counts = Counter(s.label for s in samples)
        self.assertEqual(dict(counts), _BASELINE_CLASS_TOTAL)

    def test_train_val_split_matches_baseline(self) -> None:
        samples, _ = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        train, val = train_tone_cnn.split_val_holdout_samples(samples, val_ratio=0.15, seed=42)
        self.assertEqual(len(train), _BASELINE_TRAIN_SYLLABLES)
        self.assertEqual(len(val), _BASELINE_VAL_SYLLABLES)

    def test_textgrid_provider_only_default_impl(self) -> None:
        train_src = inspect.getsource(train_tone_cnn)
        self.assertNotIn(".TextGrid", train_src)
        self.assertNotIn("_parse_textgrid_intervals", train_src)
        self.assertNotIn("AISHELL-3", train_src)


class CacheLayoutTest(unittest.TestCase):
    def test_multi_dataset_slot_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            layout = CacheLayout(tmp)
            a = layout.slot_dir("CS5647Team3_data_mini", "v1")
            b = layout.slot_dir("openslr_aishell3", "v1")
            self.assertNotEqual(a, b)
            self.assertTrue(a.endswith(os.path.join("datasets", "CS5647Team3_data_mini", "v1")))


class TrainOrchestratorSmokeTest(unittest.TestCase):
    def test_smoke_train_writes_valid_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "p6d_smoke.npz")
            metrics = train_tone_cnn.train_and_save(
                out,
                train_tone_cnn.CACHE_DIR,
                dataset_repo=DEFAULT_DATASET_REPO,
                dataset_zip=train_tone_cnn.DATASET_ZIP,
                model_version="tone_cnn_p6d_smoke",
                training_version="2026-06-29",
                epochs=1,
                batch_size=128,
            )
            self.assertTrue(os.path.isfile(out))
            self.assertEqual(metrics["dataset"], DEFAULT_DATASET_REPO)
            self.assertEqual(metrics["alignmentProvider"], "textgrid_pinyin_v1")
            report = validate_artifact(out)
            self.assertTrue(report.passed, msg=report.to_notes())
            with np.load(out, allow_pickle=True) as data:
                self.assertEqual(data["featureVersion"].item(), contract.P0_FEATURE_VERSION)
                self.assertEqual(data["backend"].item(), contract.P0_BACKEND)

    def test_offline_holdout_rebuild(self) -> None:
        mel, labels = train_tone_cnn.load_val_holdout_features(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
            val_ratio=0.15,
            seed=42,
        )
        self.assertEqual(mel.shape[0], _BASELINE_VAL_SYLLABLES)
        self.assertEqual(labels.shape[0], _BASELINE_VAL_SYLLABLES)
        self.assertEqual(mel.shape[1], contract.P0_N_MELS)


class RuntimeIsolationTest(unittest.TestCase):
    def test_train_tone_cnn_has_no_aishell_textgrid_hardcode(self) -> None:
        source = inspect.getsource(train_tone_cnn)
        self.assertIn("default_data_mini_pipeline", source)
        self.assertNotIn("huggingface_hub", source)

    def test_dataset_modules_do_not_import_runtime_decision(self) -> None:
        forbidden = ("inference", "classifier", "get_tone_loader", "api_routes")
        for path in (_TONE_ROOT / "dataset").rglob("*.py"):
            text = path.read_text(encoding="utf-8").lower()
            for token in forbidden:
                self.assertNotIn(token, text, msg=f"{path.name} imports {token}")


if __name__ == "__main__":
    unittest.main()
