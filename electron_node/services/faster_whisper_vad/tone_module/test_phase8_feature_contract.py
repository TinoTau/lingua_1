"""Phase 8 — Feature Contract / DSP / Version gates."""
from __future__ import annotations

import inspect
import unittest

import numpy as np

from tone_module import contract
from tone_module import feature_v2


class DspContractTest(unittest.TestCase):
    def test_p1_dsp_matches_feature_contract_spec(self) -> None:
        self.assertEqual(contract.P1_SAMPLE_RATE, 16000)
        self.assertEqual(contract.P1_N_FFT, 400)
        self.assertEqual(contract.P1_HOP_LENGTH, 160)
        self.assertEqual(contract.P1_FRAME_LENGTH_MS, 25)
        self.assertEqual(contract.P1_HOP_LENGTH_MS, 10)
        self.assertEqual(contract.P1_N_MELS, 80)
        self.assertEqual(contract.P1_FMIN, 50.0)
        self.assertEqual(contract.P1_FMAX, 7600.0)
        self.assertEqual(contract.P1_LOG_SCALE, "log10")

    def test_tensor_contract_shape(self) -> None:
        self.assertEqual(contract.P1_FIXED_FRAMES, 64)
        self.assertEqual(contract.P1_N_CHANNELS, 83)
        self.assertEqual(contract.P1_FEATURE_SHAPE, (64, 83))

    def test_channel_layout(self) -> None:
        self.assertEqual(contract.P1_CH_LOG_F0, 80)
        self.assertEqual(contract.P1_CH_DELTA_LOG_F0, 81)
        self.assertEqual(contract.P1_CH_VOICED, 82)

    def test_feature_version(self) -> None:
        self.assertEqual(contract.P1_FEATURE_VERSION, "p1-frame-mel-f0-v1")

    def test_policy_strings(self) -> None:
        self.assertEqual(contract.P1_RESAMPLE_POLICY, "duration_normalized_linear_interp")
        self.assertEqual(contract.P1_OVERFLOW_POLICY, "center_crop_if_raw_frames_gt_fixed")


class ExtractorContractTest(unittest.TestCase):
    def test_single_extract_feature_entry(self) -> None:
        sig = inspect.signature(feature_v2.extract_feature)
        self.assertEqual(list(sig.parameters), ["audio", "sample_rate", "word_info"])

    def test_extract_feature_output_shape(self) -> None:
        sr = contract.P1_SAMPLE_RATE
        t = np.linspace(0, 0.25, int(0.25 * sr), endpoint=False, dtype=np.float32)
        audio = (0.2 * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)
        from shared_types import WordInfo

        word = WordInfo(word="测", start=0.02, end=0.22, probability=1.0)
        tensor = feature_v2.extract_feature(audio, sr, word)
        self.assertEqual(tensor.shape, contract.P1_FEATURE_SHAPE)
        self.assertEqual(tensor.dtype, np.float32)


if __name__ == "__main__":
    unittest.main()
