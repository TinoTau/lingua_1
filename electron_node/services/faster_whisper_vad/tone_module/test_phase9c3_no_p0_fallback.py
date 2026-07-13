"""P9-C3 anti-p0-fallback gates for GPU training path."""
from __future__ import annotations

import inspect
import unittest

from tone_module import train_tone_v2_model

_FORBIDDEN = (
    "extract_mel_features",
    "_build_feature_matrix",
    "training_feature_shard_v1",
    "mel_mean_80_v1",
    "numpy_p0",
    "ShardReader",
)


class NoP0FallbackGpuTest(unittest.TestCase):
    def test_train_v2_no_p0_tokens(self) -> None:
        source = inspect.getsource(train_tone_v2_model)
        for token in _FORBIDDEN:
            self.assertNotIn(token, source, msg=token)

    def test_torch_backend_present(self) -> None:
        source = inspect.getsource(train_tone_v2_model)
        self.assertIn("training_backend", source)
        self.assertIn("torch_cuda_v1", source)
        self.assertIn("_train_weights_torch", source)


if __name__ == "__main__":
    unittest.main()
