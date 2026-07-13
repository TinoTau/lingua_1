"""Phase 9-C2 — parallel Feature Cache V2 gates (parity, anti-drift, integration)."""
from __future__ import annotations

import inspect
import json
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from tone_module import contract
from tone_module import feature_v2
from tone_module import inference
from tone_module import train_tone_v2_model
from tone_module.dataset import default_data_mini_pipeline
from tone_module.dataset.dataset_contract import SyllableSample
from tone_module.training_io import (
    build_feature_cache_v2_parallel,
    build_v2_training_batch,
    load_shard_manifest_v2,
    manifest_is_valid_v2,
    split_speaker_holdout_samples,
)
from tone_module.training_io import feature_cache_v2_parallel as parallel_mod
from tone_module.training_io import feature_shard_v2 as shard_mod
from tone_module.training_io import v2_training_path as path_mod
from tone_module.training_io.feature_cache_v2_parallel import (
    UtteranceWorkGroup,
    _extract_utterance_group,
    benchmark_parallel_vs_sequential,
)
from tone_module.training_io.shard_reader_v2 import ShardReaderV2
from tone_module import train_tone_cnn

_TONE_ROOT = Path(__file__).resolve().parent
_CACHE = train_tone_cnn.CACHE_DIR

_FORBIDDEN_IN_PARALLEL = (
    "extract_mel_features",
    "_build_feature_matrix",
    "training_feature_shard_v1",
    "ShardReader",
    "mel_mean_80_v1",
    "numpy_p0",
    "FeatureTimestampRecord",
)

_FORBIDDEN_IN_V2_TRAIN = _FORBIDDEN_IN_PARALLEL + (
    "build_feature_shards_v2",
)


class ParallelBuilderContractTest(unittest.TestCase):
    def test_parallel_module_uses_extract_feature_only(self) -> None:
        source = inspect.getsource(parallel_mod._extract_utterance_group)
        self.assertIn("extract_feature", source)
        self.assertNotIn("extract_mel_features", source)
        self.assertIn("syllable_sample_to_word_info", source)

    def test_no_forbidden_tokens_in_parallel_extract_path(self) -> None:
        source = inspect.getsource(parallel_mod._extract_utterance_group)
        for token in _FORBIDDEN_IN_PARALLEL:
            self.assertNotIn(token, source, msg=f"forbidden token in extract path: {token}")

    def test_cache_not_feature_contract_ssot(self) -> None:
        shard_text = Path(inspect.getfile(shard_mod)).read_text(encoding="utf-8").lower()
        parallel_text = Path(inspect.getfile(parallel_mod)).read_text(encoding="utf-8").lower()
        for text in (shard_text, parallel_text):
            self.assertIn("training cache", text)

    def test_v2_training_path_unchanged_no_shard_dependency(self) -> None:
        source = inspect.getsource(path_mod)
        self.assertNotIn("feature_cache_v2_parallel", source)
        self.assertNotIn("ShardReaderV2", source)
        self.assertIn("extract_feature", source)


class OnlineVsParallelParityTest(unittest.TestCase):
    def test_parallel_rows_match_online_batch(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:16]
        online = build_v2_training_batch(subset)

        indexed = [
            parallel_mod.IndexedSyllable(global_index=idx, sample=sample)
            for idx, sample in enumerate(subset)
        ]
        groups = parallel_mod._build_utterance_groups(indexed)
        rows = []
        for group in groups:
            rows.extend(_extract_utterance_group(group).rows)
        rows.sort(key=lambda row: row.global_index)
        cached = np.stack([row.feature for row in rows], axis=0)
        labels = np.array([row.label for row in rows], dtype=np.int64)

        self.assertEqual(cached.shape, online.features.shape)
        self.assertEqual(labels.tolist(), online.labels.tolist())
        for row, sample in zip(rows, subset):
            self.assertEqual(row.timestamp_start, float(sample.start))
            self.assertEqual(row.timestamp_end, float(sample.end))
        diff = float(np.max(np.abs(cached - online.features)))
        self.assertLessEqual(diff, contract.P1_FEATURE_EQUALITY_MAX_ABS_DIFF)

    def test_parallel_cache_build_matches_online(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:20]
        train, val, split_meta = split_speaker_holdout_samples(subset, val_ratio=0.25, seed=3)
        online = build_v2_training_batch(train + val)

        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "tfv2_parallel")
            payload = build_feature_cache_v2_parallel(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta=split_meta,
                shard_target_rows=12,
                num_workers=2,
                build_command="test_phase9c2",
            )
            self.assertEqual(payload["featureVersion"], contract.P1_FEATURE_VERSION)
            self.assertEqual(payload["featureShape"], [64, 83])
            self.assertEqual(payload.get("buildBackend"), "parallel_v2_cpu_extract")
            self.assertTrue(manifest_is_valid_v2(root))

            with ShardReaderV2(root) as reader:
                cached_x, cached_y = reader.get_rows(list(range(reader.sample_count)))
                shard_path = os.path.join(root, payload["shards"][0]["path"])
                with np.load(shard_path) as data:
                    self.assertEqual(data["features"].shape[1:], contract.P1_FEATURE_SHAPE)
                    self.assertIn("timestamp_start", data.files)
                    self.assertIn("timestamp_end", data.files)

        self.assertEqual(cached_x.shape, online.features.shape)
        self.assertEqual(cached_y.tolist(), online.labels.tolist())
        diff = float(np.max(np.abs(cached_x - online.features)))
        self.assertLessEqual(diff, contract.P1_FEATURE_EQUALITY_MAX_ABS_DIFF)


class WorkerFailureReportingTest(unittest.TestCase):
    def test_audio_read_failure_recorded(self) -> None:
        sample = SyllableSample(wav_path="missing.wav", start=0.1, end=0.2, label=1)
        group = UtteranceWorkGroup(
            wav_path="missing.wav",
            syllables=(parallel_mod.IndexedSyllable(0, sample),),
        )
        report = _extract_utterance_group(group)
        self.assertEqual(len(report.rows), 0)
        self.assertEqual(len(report.failures), 1)
        self.assertEqual(report.failures[0]["stage"], "audio_read")


class UtteranceAudioReuseTest(unittest.TestCase):
    def test_one_wav_multiple_syllables_single_group(self) -> None:
        import soundfile as sf

        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, "utt.wav")
            sr = contract.P1_SAMPLE_RATE
            t = np.linspace(0, 0.5, int(0.5 * sr), endpoint=False, dtype=np.float32)
            sf.write(wav, (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr)
            samples = [
                SyllableSample(wav_path=wav, start=0.05, end=0.15, label=0),
                SyllableSample(wav_path=wav, start=0.20, end=0.35, label=2),
                SyllableSample(wav_path=wav, start=0.36, end=0.45, label=4),
            ]
            indexed = [
                parallel_mod.IndexedSyllable(global_index=i, sample=s) for i, s in enumerate(samples)
            ]
            groups = parallel_mod._build_utterance_groups(indexed)
            self.assertEqual(len(groups), 1)
            self.assertEqual(len(groups[0].syllables), 3)
            online = build_v2_training_batch(samples)
            report = _extract_utterance_group(groups[0])
            self.assertEqual(len(report.rows), 3)
            feats = np.stack([row.feature for row in sorted(report.rows, key=lambda r: r.global_index)])
            np.testing.assert_allclose(feats, online.features, atol=contract.P1_FEATURE_EQUALITY_MAX_ABS_DIFF)


class AntiDriftTest(unittest.TestCase):
    def test_train_v2_no_p0_fallback(self) -> None:
        source = inspect.getsource(train_tone_v2_model)
        for token in _FORBIDDEN_IN_V2_TRAIN:
            self.assertNotIn(token, source, msg=f"forbidden in train_tone_v2_model: {token}")
        self.assertIn("build_v2_training_batch", source)
        self.assertIn("extract_v2_features_via_wordinfo", source)

    def test_runtime_inference_unchanged(self) -> None:
        source = inspect.getsource(inference)
        self.assertNotIn("feature_cache_v2_parallel", source)
        self.assertNotIn("torch", source.lower())

    def test_single_extractor_entry_unchanged(self) -> None:
        sig = inspect.signature(feature_v2.extract_feature)
        self.assertEqual(list(sig.parameters), ["audio", "sample_rate", "word_info"])


class CacheTrainingIntegrationTest(unittest.TestCase):
    def test_load_features_from_cache_helper(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:12]
        train, val, split_meta = split_speaker_holdout_samples(subset, val_ratio=0.25, seed=5)
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "cache")
            build_feature_cache_v2_parallel(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta=split_meta,
                num_workers=2,
                shard_target_rows=8,
            )
            x_train, y_train, x_val, y_val = train_tone_v2_model.extract_v2_features_for_training(
                train,
                val,
                feature_cache_dir=root,
            )
            self.assertEqual(x_train.shape[1:], contract.P1_FEATURE_SHAPE)
            self.assertEqual(x_val.shape[1:], contract.P1_FEATURE_SHAPE)
            self.assertEqual(x_train.shape[0], len(train))
            self.assertEqual(x_val.shape[0], len(val))


class BenchmarkSmokeTest(unittest.TestCase):
    def test_benchmark_runs_on_data_mini(self) -> None:
        samples, _manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        report = benchmark_parallel_vs_sequential(samples[:24], num_workers=2, max_syllables=24)
        self.assertTrue(report["parityPass"])
        self.assertTrue(report["labelsMatch"])
        self.assertGreater(report["sampleCount"], 0)
        self.assertIn("speedup", report)


class ManifestContractTest(unittest.TestCase):
    def test_manifest_has_training_cache_markers(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:10]
        train, val, split_meta = split_speaker_holdout_samples(subset, val_ratio=0.2, seed=1)
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "cache")
            build_feature_cache_v2_parallel(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta=split_meta,
                num_workers=2,
            )
            loaded = load_shard_manifest_v2(root)
            self.assertEqual(loaded["schemaVersion"], contract.P1_SHARD_SCHEMA_VERSION)
            self.assertEqual(loaded["featureVersion"], contract.P1_FEATURE_VERSION)
            state_path = os.path.join(root, shard_mod.BUILD_STATE_NAME)
            self.assertTrue(os.path.isfile(state_path))
            with open(state_path, encoding="utf-8") as handle:
                state = json.load(handle)
            self.assertIn("completedCount", state)


if __name__ == "__main__":
    unittest.main()
