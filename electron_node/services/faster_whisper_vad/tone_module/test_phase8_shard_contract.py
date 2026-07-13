"""Phase 8 — Feature Shard V2 training cache contract gates (regression only)."""
from __future__ import annotations

import inspect
import os
import tempfile
import unittest

import numpy as np

from tone_module import contract
from tone_module import train_tone_cnn
from tone_module.dataset import default_data_mini_pipeline
from tone_module.training_io import (
    build_feature_shards_v2,
    load_shard_manifest_v2,
    manifest_is_valid_v2,
    split_speaker_holdout_samples,
)
from tone_module.training_io.feature_shard_v2 import SCHEMA_VERSION

_CACHE = train_tone_cnn.CACHE_DIR


class ShardV2BuildAuditTest(unittest.TestCase):
    def test_v2_build_uses_extract_feature_not_mel(self) -> None:
        from tone_module.training_io import feature_shard_v2 as mod

        source = inspect.getsource(mod._build_shards_from_samples)
        self.assertIn("extract_feature", source)
        self.assertNotIn("extract_mel_features", source)
        self.assertIn("syllable_sample_to_word_info", source)

    def test_manifest_and_npz_contract(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:24]
        train, val, split_meta = split_speaker_holdout_samples(subset, val_ratio=0.25, seed=7)
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "tfv2")
            payload = build_feature_shards_v2(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta=split_meta,
                shard_target_rows=12,
                build_command="test_phase8",
            )
            self.assertEqual(payload["schemaVersion"], SCHEMA_VERSION)
            self.assertEqual(payload["featureVersion"], contract.P1_FEATURE_VERSION)
            self.assertEqual(payload["featureShape"], [64, 83])
            self.assertTrue(manifest_is_valid_v2(root))
            loaded = load_shard_manifest_v2(root)
            self.assertEqual(loaded["fixedFrames"], 64)
            self.assertEqual(loaded["channels"], 83)
            shard_path = os.path.join(root, loaded["shards"][0]["path"])
            with np.load(shard_path) as data:
                self.assertEqual(data["features"].shape[1:], contract.P1_FEATURE_SHAPE)
                self.assertNotIn("mel", data.files)


if __name__ == "__main__":
    unittest.main()
