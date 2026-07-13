"""Phase 7-B2 Canonical Feature Shard acceptance gates."""
from __future__ import annotations

import inspect
import json
import os
import tempfile
import unittest

import numpy as np

from tone_module import contract
from tone_module import train_tone_cnn
from tone_module.dataset import default_data_mini_pipeline
from tone_module.training_io import (
    MiniBatchReader,
    SequentialFeatureReader,
    ShardReader,
    build_feature_shards,
    load_shard_manifest,
    load_split_meta,
    manifest_is_valid,
    split_speaker_holdout_samples,
)
from tone_module.training_io.probe_feature_shard import (
    CANONICAL_SYLLABLE_COUNT,
    _audit_build_source_no_audio_cache,
    _manifest_logical_digest,
    evaluate_acceptance_gates,
    validate_shard_files,
    validate_shard_reader_traversal,
    validate_speaker_holdout,
)

_CACHE = train_tone_cnn.CACHE_DIR
_CANONICAL_FEATURES = os.path.join(
    _CACHE,
    "datasets",
    "openslr_aishell3",
    "v1",
    "training_features",
)
_PHASE7A_JSON = os.path.join(_CACHE, "datasets", "openslr_aishell3", "v1", "phase7a_acceptance.json")


def _canonical_full_built() -> bool:
    try:
        manifest = load_shard_manifest(_CANONICAL_FEATURES)
        return int(manifest.get("sampleCount", 0)) == CANONICAL_SYLLABLE_COUNT
    except FileNotFoundError:
        return False


class BuildSourceAuditTest(unittest.TestCase):
    def test_no_audio_cache_in_shard_build(self) -> None:
        audit = _audit_build_source_no_audio_cache()
        self.assertTrue(audit["pass"])

    def test_train_tone_cnn_no_second_pipeline(self) -> None:
        source = inspect.getsource(train_tone_cnn)
        self.assertIn("build-feature-shards", source)
        self.assertNotIn("train_tone_p3", source)


class FixtureRepeatabilityTest(unittest.TestCase):
    def test_manifest_logical_digest_stable_across_rebuild(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:120]
        train, val, split_meta = split_speaker_holdout_samples(subset, val_ratio=0.15, seed=42)
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "tf")
            build_feature_shards(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta=split_meta,
                shard_target_rows=40,
                build_command="test_pass_1",
            )
            d1 = _manifest_logical_digest(load_shard_manifest(root))
            build_feature_shards(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta=split_meta,
                shard_target_rows=40,
                build_command="test_pass_2",
            )
            d2 = _manifest_logical_digest(load_shard_manifest(root))
            self.assertEqual(d1, d2)


class CanonicalAcceptanceTest(unittest.TestCase):
    @unittest.skipUnless(_canonical_full_built(), "canonical full Feature Shard not built yet")
    def test_level3_acceptance_pass(self) -> None:
        accept_path = os.path.join(
            _CACHE, "datasets", "openslr_aishell3", "v1", "phase7b2_acceptance.json"
        )
        if os.path.isfile(accept_path):
            with open(accept_path, encoding="utf-8") as handle:
                report = json.load(handle)
            self.assertEqual(report.get("final_verdict"), "PASS")
            self.assertTrue(report.get("acceptance_gates", {}).get("pass"))
            return
        report = evaluate_acceptance_gates(
            _CANONICAL_FEATURES,
            phase7a_path=_PHASE7A_JSON,
            full_reader_validation=True,
        )
        self.assertEqual(report["final_verdict"], "PASS", msg=json.dumps(report["acceptance_gates"], indent=2))

    @unittest.skipUnless(_canonical_full_built(), "canonical full Feature Shard not built yet")
    def test_speaker_holdout_on_canonical(self) -> None:
        holdout = validate_speaker_holdout(_CANONICAL_FEATURES)
        self.assertTrue(holdout["pass"])
        self.assertEqual(holdout["holdout"], "speaker")
        self.assertEqual(holdout["train_speakers"] + holdout["val_speakers"], 218)

    @unittest.skipUnless(_canonical_full_built(), "canonical full Feature Shard not built yet")
    def test_shard_files_and_spot_reader_on_canonical(self) -> None:
        self.assertTrue(validate_shard_files(_CANONICAL_FEATURES)["pass"])
        spot = validate_shard_reader_traversal(_CANONICAL_FEATURES, spot_checks=512)
        self.assertTrue(spot["pass"])


class ReaderFixtureTest(unittest.TestCase):
    def test_reader_stack_on_fixture(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:64]
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "tf")
            build_feature_shards(
                subset,
                [],
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta={"holdout": "utterance"},
                shard_target_rows=32,
            )
            self.assertTrue(manifest_is_valid(root))
            reader = ShardReader(root)
            try:
                seq = list(SequentialFeatureReader(reader, range(len(subset))))
                self.assertEqual(len(seq), len(subset))
                mean = np.zeros(contract.P0_N_MELS, dtype=np.float32)
                std = np.ones(contract.P0_N_MELS, dtype=np.float32)
                br = MiniBatchReader(reader, range(len(subset)), batch_size=16, mean=mean, std=std)
                seen = sum(xb.shape[0] for xb, _ in br.iter_epoch_batches(np.random.default_rng(0)))
                self.assertEqual(seen, len(subset))
            finally:
                reader.close()


if __name__ == "__main__":
    unittest.main()
