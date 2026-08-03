"""Tone Evidence production diagnostics — short skip / feature fail / posterior mismatch."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest import mock

import numpy as np

from shared_types import SegmentInfo, WordInfo
from tone_module import inference


def _seg(*words: WordInfo) -> list:
    return [SegmentInfo(text="".join(w.word for w in words), start=0.0, end=1.0, words=list(words))]


class FakeClassifier:
    ready = True

    def __init__(self, posteriors: np.ndarray):
        self._posteriors = posteriors

    def predict_batch(self, feature_batch):
        return self._posteriors


class ToneEvidenceProductionDiagnosticsTest(unittest.TestCase):
    def test_short_duration_skipped(self):
        words = [
            WordInfo(word="短", start=0.0, end=0.01, probability=0.9),
            WordInfo(word="长", start=0.1, end=0.3, probability=0.9),
        ]
        audio = np.zeros(16000, dtype=np.float32)
        feats = np.zeros((64, 83), dtype=np.float32)
        post = np.array([[0.1, 0.1, 0.1, 0.1, 0.6]], dtype=np.float32)

        with mock.patch.object(inference, "get_tone_classifier", return_value=FakeClassifier(post)):
            with mock.patch.object(inference, "extract_feature", return_value=feats):
                payload, _ = inference.run_tone_inference(audio, 16000, _seg(*words), "zh", "zh")

        statuses = [d.status for d in payload.evidence_production]
        self.assertIn("short_duration_skipped", statuses)
        self.assertIn("slice_created", statuses)
        self.assertEqual(payload.slice_count, 1)
        short = next(d for d in payload.evidence_production if d.status == "short_duration_skipped")
        self.assertEqual(short.word, "短")
        self.assertLess(short.duration, inference.MIN_SLICE_SEC)

    def test_feature_extraction_failed_continues(self):
        words = [
            WordInfo(word="坏", start=0.0, end=0.2, probability=0.9),
            WordInfo(word="好", start=0.2, end=0.4, probability=0.9),
        ]
        audio = np.zeros(16000, dtype=np.float32)
        feats = np.zeros((64, 83), dtype=np.float32)
        post = np.array([[0.6, 0.1, 0.1, 0.1, 0.1]], dtype=np.float32)

        def _extract(_audio, _sr, w):
            if w.word == "坏":
                raise ValueError("slice_too_short_for_feature")
            return feats

        with mock.patch.object(inference, "get_tone_classifier", return_value=FakeClassifier(post)):
            with mock.patch.object(inference, "extract_feature", side_effect=_extract):
                payload, _ = inference.run_tone_inference(audio, 16000, _seg(*words), "zh", "zh")

        statuses = [d.status for d in payload.evidence_production]
        self.assertIn("feature_extraction_failed", statuses)
        self.assertIn("slice_created", statuses)
        self.assertEqual(payload.slice_count, 1)
        failed = next(d for d in payload.evidence_production if d.status == "feature_extraction_failed")
        self.assertTrue(failed.error_code and "ValueError" in failed.error_code)

    def test_posterior_length_mismatch_no_silent_zip(self):
        words = [
            WordInfo(word="一", start=0.0, end=0.2, probability=0.9),
            WordInfo(word="二", start=0.2, end=0.4, probability=0.9),
            WordInfo(word="三", start=0.4, end=0.6, probability=0.9),
        ]
        audio = np.zeros(16000, dtype=np.float32)
        feats = np.zeros((64, 83), dtype=np.float32)
        # Only 2 posteriors for 3 valid words
        post = np.array(
            [
                [0.6, 0.1, 0.1, 0.1, 0.1],
                [0.1, 0.6, 0.1, 0.1, 0.1],
            ],
            dtype=np.float32,
        )

        with mock.patch.object(inference, "get_tone_classifier", return_value=FakeClassifier(post)):
            with mock.patch.object(inference, "extract_feature", return_value=feats):
                payload, _ = inference.run_tone_inference(audio, 16000, _seg(*words), "zh", "zh")

        self.assertEqual(payload.slice_count, 2)
        missing = [d for d in payload.evidence_production if d.status == "inference_output_missing"]
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0].word, "三")


if __name__ == "__main__":
    unittest.main()
