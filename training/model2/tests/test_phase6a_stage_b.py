"""Phase 6A Stage B unit tests."""

from __future__ import annotations

import unittest

from training.model2.contract import PHONETIC_FEATURE_INDEX_V1, PHONETIC_FEATURE_KEYS
from training.model2.stage_b.condition import (
    OPPOSITE_DIRECTION,
    fidelity_supervision_weight,
    profile_vectors_from_bias,
    strength_to_prob,
)
from training.model2.training.losses import condition_margin_loss
import torch


class TestPhoneticIndex(unittest.TestCase):
    def test_stable_order(self):
        self.assertEqual(PHONETIC_FEATURE_KEYS[0], "n_l")
        self.assertEqual(PHONETIC_FEATURE_KEYS[15], "h_f")
        self.assertEqual(PHONETIC_FEATURE_INDEX_V1["n_l"], 0)
        self.assertEqual(len(PHONETIC_FEATURE_INDEX_V1), 16)

    def test_opposite(self):
        self.assertEqual(OPPOSITE_DIRECTION["n_l"], "l_n")
        self.assertEqual(OPPOSITE_DIRECTION["ing_in"], "in_ing")


class TestProfileContracts(unittest.TestCase):
    def test_unavailable_vs_neutral(self):
        mask = [1] * 16
        u = profile_vectors_from_bias({"n_l": 0.8}, trainable_mask=mask, mode="unavailable")
        n = profile_vectors_from_bias({}, trainable_mask=mask, mode="neutral")
        self.assertEqual(u["phonetic_mask"], [0] * 16)
        self.assertEqual(u["profile_available"], 0)
        self.assertEqual(n["phonetic_mask"], mask)
        self.assertEqual(n["phonetic_condition"], [0.0] * 16)
        self.assertEqual(n["profile_available"], 1)

    def test_correct_snapshot(self):
        mask = [1] * 16
        p = profile_vectors_from_bias({"n_l": 0.8, "zh_z": 0.5}, trainable_mask=mask, mode="correct")
        self.assertAlmostEqual(p["phonetic_condition"][0], 0.8)
        self.assertAlmostEqual(p["phonetic_condition"][2], 0.5)

    def test_strength(self):
        self.assertEqual(strength_to_prob("HIGH"), 0.8)
        self.assertEqual(strength_to_prob("NONE"), 0.0)

    def test_fidelity_weight_ing(self):
        w = fidelity_supervision_weight("USABLE", base_realization=0.235)
        self.assertLessEqual(w, 0.55)


class TestConditionLoss(unittest.TestCase):
    def test_margin(self):
        sc = torch.tensor([0.5, 0.2])
        se = torch.tensor([0.1, 0.3])
        w = torch.tensor([1.0, 1.0])
        valid = torch.tensor([True, True])
        loss = condition_margin_loss(sc, se, None, valid, w, margin=0.05)
        self.assertTrue(float(loss) >= 0)


if __name__ == "__main__":
    unittest.main()
