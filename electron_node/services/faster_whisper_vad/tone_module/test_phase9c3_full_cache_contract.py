"""P9-C3 full cache contract tests (uses data_mini subset)."""
from __future__ import annotations

import os
import tempfile
import unittest

from tone_module import contract
from tone_module import train_tone_cnn
from tone_module.dataset import default_data_mini_pipeline
from tone_module.training_io import (
    build_feature_cache_v2_parallel,
    manifest_is_valid_v2,
    split_speaker_holdout_samples,
)
from tone_module.training_io.cache_parity_v2 import verify_cache_parity_random
from tone_module.training_io.shard_reader_v2 import ShardReaderV2

_CACHE = train_tone_cnn.CACHE_DIR


class FullCacheContractTest(unittest.TestCase):
    def test_cache_readable_and_parity(self) -> None:
        samples, manifest = default_data_mini_pipeline(
            _CACHE,
            dataset_repo=train_tone_cnn.DATASET_REPO,
            dataset_zip=train_tone_cnn.DATASET_ZIP,
        )
        subset = samples[:128]
        train, val, split_meta = split_speaker_holdout_samples(subset, val_ratio=0.2, seed=9)
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "cache")
            payload = build_feature_cache_v2_parallel(
                train,
                val,
                dataset_manifest=manifest,
                training_features_root=root,
                split_meta=split_meta,
                num_workers=2,
            )
            self.assertTrue(manifest_is_valid_v2(root))
            self.assertEqual(payload["featureVersion"], contract.P1_FEATURE_VERSION)
            with ShardReaderV2(root) as reader:
                self.assertEqual(reader.sample_count, len(train) + len(val))
            cached_order = train + val
            parity = verify_cache_parity_random(cached_order, root, sample_size=32, seed=1)
            self.assertTrue(parity["parityPass"], msg=parity)


if __name__ == "__main__":
    unittest.main()
