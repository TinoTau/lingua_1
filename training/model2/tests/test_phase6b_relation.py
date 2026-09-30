"""Phase 6B relation contract + ranking helper tests."""

from __future__ import annotations

import unittest

from training.model2.contract import PHONETIC_FEATURE_INDEX_V1
from training.model2.model.condition_relation import (
    assert_contract_examples,
    relation_features_for_pair,
)
from training.model2.model.condition_scorer import ConditionCompatibilityScorer, build_interaction
import torch


class TestRelationDirection(unittest.TestCase):
    def test_contract_examples(self):
        assert_contract_examples()

    def test_nai_lai(self):
        rel = relation_features_for_pair(["lai3"], ["nai3"])
        self.assertGreater(rel[PHONETIC_FEATURE_INDEX_V1["n_l"]], 0.0)
        self.assertEqual(rel[PHONETIC_FEATURE_INDEX_V1["l_n"]], 0.0)

    def test_normalized_multi(self):
        rel = relation_features_for_pair(["lai3", "foo1"], ["nai3", "foo1"])
        self.assertAlmostEqual(rel[PHONETIC_FEATURE_INDEX_V1["n_l"]], 0.5)


class TestInteraction(unittest.TestCase):
    def test_unavailable_zero_delta(self):
        scorer = ConditionCompatibilityScorer(delta_cap=0.35)
        inter = torch.zeros(2, 4, 16)
        base = torch.randn(2, 4)
        active = torch.zeros(2)
        delta = scorer(inter, base, profile_active=active)
        self.assertTrue(torch.allclose(delta, torch.zeros_like(delta)))

    def test_build_interaction_mask(self):
        cond = torch.zeros(1, 16)
        cond[0, 0] = 0.8
        mask = torch.zeros(1, 16, dtype=torch.long)
        mask[0, 0] = 1
        rel = torch.zeros(1, 3, 16)
        rel[0, 0, 0] = 1.0
        realized = torch.ones(1, dtype=torch.long)
        inter, active = build_interaction(cond, mask, rel, realized)
        self.assertAlmostEqual(float(inter[0, 0, 0]), 0.8)
        self.assertEqual(float(active[0]), 1.0)


if __name__ == "__main__":
    unittest.main()
