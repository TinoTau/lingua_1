"""Phase 7-B1 Training IO Engineering regression gates."""
from __future__ import annotations

import inspect
import json
import os
import tempfile
import unittest
from collections import Counter

import numpy as np

from tone_module import contract
from tone_module import train_tone_cnn
from tone_module.dataset import DEFAULT_DATASET_REPO, SyllableSample, default_data_mini_pipeline
from tone_module.training_io import (
    MiniBatchReader,
    SequentialFeatureReader,
    ShardReader,
    build_feature_shards,
    filter_samples_by_max_speakers,
    fit_norm_stats,
    load_shard_manifest,
    load_split_meta,
    manifest_is_valid,
    split_speaker_holdout_samples,
    speaker_id_from_path,
    training_features_root,
    truncate_samples,
)
from tone_module.validate_artifact import validate_artifact

_BASELINE_TOTAL_SYLLABLES = 11820
_BASELINE_TRAIN_SYLLABLES = 10012
_BASELINE_VAL_SYLLABLES = 1808


def _fake_aishell_sample(speaker: str, utterance: str, label: int, idx: int) -> SyllableSample:
    wav = f"/data/wav/{speaker}/{utterance}.wav"
    return SyllableSample(
        wav_path=wav,
        start=0.1 * idx,
        end=0.1 * idx + 0.08,
        label=label,
    )


class SpeakerHoldoutTest(unittest.TestCase):
    def test_speaker_id_from_path(self) -> None:
        self.assertEqual(speaker_id_from_path("/wav/SSB1234/foo.wav"), "SSB1234")
        self.assertEqual(speaker_id_from_path(r"C:\data\ssb0001\a.wav"), "SSB0001")
        self.assertIsNone(speaker_id_from_path("/wav/unknown/foo.wav"))

    def test_speaker_holdout_no_overlap(self) -> None:
        samples = []
        for spk in ("SSB0001", "SSB0002", "SSB0003", "SSB0004"):
            for i in range(5):
                samples.append(_fake_aishell_sample(spk, f"utt{i}", i % 5, i))
        train, val, meta = split_speaker_holdout_samples(samples, val_ratio=0.25, seed=42)
        train_speakers = {speaker_id_from_path(s.wav_path) for s in train}
        val_speakers = {speaker_id_from_path(s.wav_path) for s in val}
        self.assertTrue(train_speakers.isdisjoint(val_speakers))
        self.assertEqual(meta["holdout"], "speaker")
        self.assertEqual(len(train) + len(val), len(samples))

    def test_filter_and_truncate(self) -> None:
        samples = []
        for spk in ("SSB0001", "SSB0002", "SSB0003"):
            for i in range(3):
                samples.append(_fake_aishell_sample(spk, f"u{i}", 0, i))
        kept = filter_samples_by_max_speakers(samples, 2)
        speakers = {speaker_id_from_path(s.wav_path) for s in kept}
        self.assertEqual(len(speakers), 2)
        truncated = truncate_samples(samples, 4)
        self.assertEqual(len(truncated), 4)


class FeatureShardFixtureTest(unittest.TestCase):
    def test_build_shard_manifest_and_split_meta(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        train, val = train_tone_cnn.split_val_holdout_samples(samples[:200], val_ratio=0.15, seed=42)
        with tempfile.TemporaryDirectory() as tmp:
            features_root = os.path.join(tmp, "training_features")
            split_meta = {
                "holdout": "utterance",
                "valRatio": 0.15,
                "seed": 42,
                "trainSampleCount": len(train),
                "valSampleCount": len(val),
            }
            payload = build_feature_shards(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=features_root,
                split_meta=split_meta,
                shard_target_rows=50,
            )
            self.assertTrue(manifest_is_valid(features_root))
            self.assertEqual(payload["schemaVersion"], "training_feature_shard_v1")
            self.assertEqual(payload["featureVersion"], contract.P0_FEATURE_VERSION)
            self.assertEqual(payload["sampleCount"], len(train) + len(val))
            meta = load_split_meta(features_root)
            self.assertEqual(len(meta["trainGlobalIndices"]), len(train))
            self.assertEqual(len(meta["valGlobalIndices"]), len(val))


class ShardReaderParityTest(unittest.TestCase):
    def test_shard_reader_matches_build_feature_matrix(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:80]
        with tempfile.TemporaryDirectory() as tmp:
            features_root = os.path.join(tmp, "training_features")
            build_feature_shards(
                subset,
                [],
                dataset_manifest=manifest,
                training_features_root=features_root,
                split_meta={"holdout": "utterance"},
                shard_target_rows=30,
            )
            reader = ShardReader(features_root)
            try:
                x_ref, y_ref = train_tone_cnn._build_feature_matrix(subset)
                x_shard, y_shard = reader.get_rows(range(len(subset)))
                np.testing.assert_allclose(x_shard, x_ref, rtol=1e-5, atol=1e-5)
                np.testing.assert_array_equal(y_shard, y_ref)
            finally:
                reader.close()


class MiniBatchReaderTest(unittest.TestCase):
    def test_iter_epoch_batches_cover_train_indices(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:64]
        with tempfile.TemporaryDirectory() as tmp:
            features_root = os.path.join(tmp, "training_features")
            build_feature_shards(
                subset,
                [],
                dataset_manifest=manifest,
                training_features_root=features_root,
                split_meta={"holdout": "utterance"},
                shard_target_rows=32,
            )
            reader = ShardReader(features_root)
            try:
                indices = list(range(len(subset)))
                mean, std = fit_norm_stats(reader, indices)
                batch_reader = MiniBatchReader(reader, indices, batch_size=16, mean=mean, std=std)
                rng = np.random.default_rng(0)
                seen = 0
                for xb, yb in batch_reader.iter_epoch_batches(rng):
                    self.assertEqual(xb.shape[1], contract.P0_N_MELS)
                    self.assertEqual(xb.shape[0], yb.shape[0])
                    seen += xb.shape[0]
                self.assertEqual(seen, len(subset))
            finally:
                reader.close()

    def test_sequential_feature_reader(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:10]
        with tempfile.TemporaryDirectory() as tmp:
            features_root = os.path.join(tmp, "training_features")
            build_feature_shards(
                subset,
                [],
                dataset_manifest=manifest,
                training_features_root=features_root,
                split_meta={"holdout": "utterance"},
                shard_target_rows=10,
            )
            reader = ShardReader(features_root)
            try:
                seq = SequentialFeatureReader(reader, range(len(subset)))
                rows = list(seq)
                self.assertEqual(len(rows), len(subset))
                for mel, label in rows:
                    self.assertEqual(mel.shape, (contract.P0_N_MELS,))
            finally:
                reader.close()


class DataMiniDefaultRegressionTest(unittest.TestCase):
    def test_train_and_save_defaults_unchanged(self) -> None:
        samples, _ = default_data_mini_pipeline(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        self.assertEqual(len(samples), _BASELINE_TOTAL_SYLLABLES)
        train, val = train_tone_cnn.split_val_holdout_samples(samples, val_ratio=0.15, seed=42)
        self.assertEqual(len(train), _BASELINE_TRAIN_SYLLABLES)
        self.assertEqual(len(val), _BASELINE_VAL_SYLLABLES)

    def test_main_backward_compat_no_subcommand(self) -> None:
        source = inspect.getsource(train_tone_cnn.main)
        self.assertIn('argv = ["train"] + argv', source)
        self.assertIn("default_data_mini_pipeline", source)
        self.assertNotIn("aishell3_pipeline", source)

    def test_load_val_holdout_default_data_mini(self) -> None:
        mel, labels = train_tone_cnn.load_val_holdout_features(
            train_tone_cnn.CACHE_DIR,
            dataset_repo=DEFAULT_DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        self.assertEqual(mel.shape[0], _BASELINE_VAL_SYLLABLES)
        self.assertEqual(labels.shape[0], _BASELINE_VAL_SYLLABLES)

    def test_smoke_train_default_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "p7b1_mini_smoke.npz")
            metrics = train_tone_cnn.train_and_save(
                out,
                train_tone_cnn.CACHE_DIR,
                dataset_repo=DEFAULT_DATASET_REPO,
                dataset_zip=train_tone_cnn.DATASET_ZIP,
                model_version="tone_cnn_p7b1_smoke",
                training_version="2026-06-29",
                epochs=1,
                batch_size=128,
            )
            self.assertTrue(os.path.isfile(out))
            report = validate_artifact(out)
            self.assertTrue(report.passed, msg=report.to_notes())
            self.assertEqual(metrics["train_samples"], _BASELINE_TRAIN_SYLLABLES)
            self.assertEqual(metrics["val_samples"], _BASELINE_VAL_SYLLABLES)


class TrainingIoIsolationTest(unittest.TestCase):
    def test_no_streaming_terminology_in_training_io(self) -> None:
        root = os.path.join(os.path.dirname(__file__), "training_io")
        for name in os.listdir(root):
            if not name.endswith(".py"):
                continue
            with open(os.path.join(root, name), encoding="utf-8") as handle:
                text = handle.read().lower()
            self.assertNotIn("streaming feature", text, msg=name)
            self.assertNotIn("streaming training", text, msg=name)


if __name__ == "__main__":
    unittest.main()
