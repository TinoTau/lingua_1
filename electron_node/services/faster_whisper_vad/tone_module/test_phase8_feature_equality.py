"""Phase 8 — Feature Equality / Training-Runtime shared Extractor gate."""
from __future__ import annotations

import unittest

import numpy as np

from shared_types import WordInfo
from tone_module import contract
from tone_module import feature_v2
from tone_module.dataset.dataset_contract import SyllableSample
from tone_module.training_io.syllable_to_wordinfo import syllable_sample_to_word_info


def _sine_clip(duration_sec: float = 0.24, freq_hz: float = 220.0) -> tuple[np.ndarray, int]:
    sr = contract.P1_SAMPLE_RATE
    t = np.linspace(0, duration_sec, int(duration_sec * sr), endpoint=False, dtype=np.float32)
    audio = (0.25 * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)
    return audio, sr


class FeatureEqualityTest(unittest.TestCase):
    def test_repeat_calls_bit_equal(self) -> None:
        audio, sr = _sine_clip()
        word = WordInfo(word="a", start=0.02, end=0.22, probability=1.0)
        a = feature_v2.extract_feature(audio, sr, word)
        b = feature_v2.extract_feature(audio, sr, word)
        diff = float(np.max(np.abs(a - b)))
        self.assertLessEqual(diff, contract.P1_FEATURE_EQUALITY_MAX_ABS_DIFF)

    def test_adapter_path_matches_direct_wordinfo(self) -> None:
        audio, sr = _sine_clip()
        sample = SyllableSample(wav_path="dummy.wav", start=0.02, end=0.22, label=2)
        word = syllable_sample_to_word_info(sample, syllable_index=0)
        direct = feature_v2.extract_feature(audio, sr, word)
        word2 = WordInfo(word=word.word, start=sample.start, end=sample.end, probability=word.probability)
        via_sample = feature_v2.extract_feature(audio, sr, word2)
        diff = float(np.max(np.abs(direct - via_sample)))
        self.assertLessEqual(diff, contract.P1_FEATURE_EQUALITY_MAX_ABS_DIFF)

    def test_tensor_changes_with_audio(self) -> None:
        audio_a, sr = _sine_clip(freq_hz=180.0)
        audio_b, _ = _sine_clip(freq_hz=320.0)
        word = WordInfo(word="a", start=0.02, end=0.22, probability=1.0)
        ta = feature_v2.extract_feature(audio_a, sr, word)
        tb = feature_v2.extract_feature(audio_b, sr, word)
        diff = float(np.max(np.abs(ta - tb)))
        self.assertGreater(diff, contract.P1_FEATURE_EQUALITY_MAX_ABS_DIFF)


if __name__ == "__main__":
    unittest.main()
