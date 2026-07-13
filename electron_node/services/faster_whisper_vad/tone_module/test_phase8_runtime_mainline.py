"""Phase 8 — Runtime mainline frozen / P1 Full Direct Replacement."""
from __future__ import annotations

import inspect
import unittest
from pathlib import Path

from tone_module import classifier
from tone_module import inference
from tone_module import mel

_FW_ROOT = Path(__file__).resolve().parents[1]
_TONE_ROOT = Path(__file__).resolve().parent

_FORBIDDEN_DEPLOYMENT_TOKENS = (
    "get_backend",
    "backend_registry",
    "model_registry",
    "hot_reload",
    "model_switch",
    "active_model",
    "TONE_MODEL_ID",
    "feature_version_switch",
    "shadow_feature",
)


class RuntimeMainlineFrozenTest(unittest.TestCase):
    def test_p1_inference_uses_feature_v2_extractor(self) -> None:
        source = inspect.getsource(inference.run_tone_inference)
        self.assertIn("extract_feature", source)
        self.assertNotIn("extract_mel_features", source)
        self.assertNotIn("_slice_audio", source)

    def test_classifier_uses_p1_loader_and_backend(self) -> None:
        clf_source = inspect.getsource(classifier)
        self.assertIn("get_tone_loader_v1", clf_source)
        self.assertIn("numpy_p1", clf_source)
        self.assertNotIn("from tone_module.loader import get_tone_loader", clf_source)
        self.assertNotIn("numpy_p0", clf_source)

    def test_mel_py_retained_for_training_legacy_only(self) -> None:
        inf_source = inspect.getsource(inference)
        self.assertNotIn("from tone_module.mel import", inf_source)
        source = inspect.getsource(mel.extract_mel_features)
        self.assertIn("mean(axis=1)", source)

    def test_feature_v2_no_forbidden_registry_tokens(self) -> None:
        from tone_module import feature_v2

        source = inspect.getsource(feature_v2).lower()
        for token in _FORBIDDEN_DEPLOYMENT_TOKENS:
            self.assertNotIn(token, source)

    def test_api_routes_still_pre_dedup_tone(self) -> None:
        source = (_FW_ROOT / "api_routes.py").read_text(encoding="utf-8")
        tone_idx = source.index("tone_payload, tone_inference_ms = run_tone_inference")
        dedup_idx = source.index("full_text_trimmed = process_text_deduplication")
        self.assertLess(tone_idx, dedup_idx)


if __name__ == "__main__":
    unittest.main()
