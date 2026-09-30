"""Phase 6C metric contract + interaction gates + listwise loss tests."""

from __future__ import annotations

import unittest

import torch

from training.model2.contract import PHONETIC_FEATURE_INDEX_V1
from training.model2.evaluation.condition_ranking_metrics import compare_correct_vs_other_score
from training.model2.model.condition_scorer_v2 import ConditionCompatibilityScorerV2, build_interaction_v2
from training.model2.stage_b.active_feature_mask import (
    BOUND_FEATURES_V1,
    REVERSED_FEATURES_V1,
    active_mask_bound_only,
)
from training.model2.training.listwise_cf_losses import compose_listwise_cf_loss, target_prob_from_scores


class TestMetricSemantics(unittest.TestCase):
    def test_correct_gt_wrong(self):
        self.assertEqual(compare_correct_vs_other_score(correct=1.0, other=0.5), "better")

    def test_correct_lt_wrong(self):
        self.assertEqual(compare_correct_vs_other_score(correct=0.2, other=0.9), "worse")

    def test_tie(self):
        self.assertEqual(compare_correct_vs_other_score(correct=0.5, other=0.5), "tie")


class TestRelationInteractionGates(unittest.TestCase):
    def test_user_zero_delta_zero(self):
        scorer = ConditionCompatibilityScorerV2(delta_cap=0.5)
        cond = torch.zeros(1, 16)
        mask = torch.ones(1, 16, dtype=torch.long)
        rel = torch.zeros(1, 4, 16)
        rel[0, 0, PHONETIC_FEATURE_INDEX_V1["n_l"]] = 1.0
        inter, active = build_interaction_v2(cond, mask, rel, torch.ones(1, dtype=torch.long))
        delta = scorer(inter, torch.randn(1, 4), profile_active=active)
        self.assertTrue(torch.allclose(delta, torch.zeros_like(delta)))
        self.assertEqual(float(active[0]), 0.0)

    def test_relation_zero_delta_zero(self):
        scorer = ConditionCompatibilityScorerV2(delta_cap=0.5)
        cond = torch.zeros(1, 16)
        cond[0, PHONETIC_FEATURE_INDEX_V1["n_l"]] = 0.8
        mask = torch.ones(1, 16, dtype=torch.long)
        rel = torch.zeros(1, 4, 16)
        inter, active = build_interaction_v2(cond, mask, rel, torch.ones(1, dtype=torch.long))
        base = torch.tensor([[0.1, 0.2, 0.0, -0.1]])
        delta = scorer(inter, base, profile_active=active)
        self.assertTrue(torch.allclose(delta, torch.zeros_like(delta), atol=1e-6))

    def test_both_active_candidate_specific(self):
        scorer = ConditionCompatibilityScorerV2(delta_cap=0.5)
        # force nonzero weights so delta can differ
        with torch.no_grad():
            for m in scorer.mlp.modules():
                if isinstance(m, torch.nn.Linear):
                    m.weight.fill_(0.2)
                    m.bias.zero_()
        cond = torch.zeros(1, 16)
        cond[0, PHONETIC_FEATURE_INDEX_V1["n_l"]] = 0.8
        mask = torch.ones(1, 16, dtype=torch.long)
        rel = torch.zeros(1, 3, 16)
        rel[0, 0, PHONETIC_FEATURE_INDEX_V1["n_l"]] = 1.0  # relevant
        # cand1/2 no relation
        inter, active = build_interaction_v2(cond, mask, rel, torch.ones(1, dtype=torch.long))
        base = torch.zeros(1, 3)
        delta = scorer(inter, base, profile_active=active)
        self.assertGreater(abs(float(delta[0, 0])), 1e-6)
        self.assertAlmostEqual(float(delta[0, 1]), 0.0, places=5)
        self.assertAlmostEqual(float(delta[0, 2]), 0.0, places=5)
        self.assertGreater(float(delta[0, 0].abs() - delta[0, 1].abs()), 0.0)


class TestListwiseLoss(unittest.TestCase):
    def test_correct_prob_preferred(self):
        bsz, p = 2, 4
        # correct: target (idx0) highest; empty/wrong: target lower
        sc_c = torch.tensor([[2.0, 0.0, 0.0, 0.0], [1.5, 0.1, 0.0, 0.0]], requires_grad=True)
        sc_e = torch.tensor([[0.0, 1.0, 0.5, 0.0], [0.2, 1.0, 0.0, 0.0]])
        sc_w = torch.tensor([[0.1, 2.0, 0.0, 0.0], [0.0, 0.0, 1.5, 0.0]])
        batch = {
            "positive_pool_index": torch.tensor([0, 0]),
            "pool_len": torch.tensor([4, 4]),
            "is_pronunciation_positive": torch.tensor([1, 1]),
            "is_no_change": torch.tensor([0, 0]),
            "condition_supervision_weight": torch.tensor([1.0, 1.0]),
        }
        parts = compose_listwise_cf_loss(
            {"scores": sc_c},
            {"scores": sc_e},
            {"scores": sc_w},
            batch,
            prob_margin=0.02,
        )
        self.assertTrue(parts["loss"].requires_grad)
        pc = target_prob_from_scores(sc_c.detach(), batch["positive_pool_index"], batch["pool_len"])
        pe = target_prob_from_scores(sc_e, batch["positive_pool_index"], batch["pool_len"])
        self.assertTrue(torch.all(pc > pe))

    def test_wrong_does_not_match_correct_gain(self):
        sc_c = torch.tensor([[3.0, 0.0, 0.0]], requires_grad=True)
        sc_e = torch.tensor([[0.5, 0.4, 0.3]])
        sc_w = torch.tensor([[0.4, 0.5, 0.3]])
        batch = {
            "positive_pool_index": torch.tensor([0]),
            "pool_len": torch.tensor([3]),
            "is_pronunciation_positive": torch.tensor([1]),
            "is_no_change": torch.tensor([0]),
        }
        parts = compose_listwise_cf_loss(
            {"scores": sc_c}, {"scores": sc_e}, {"scores": sc_w}, batch, prob_margin=0.05
        )
        # cf_wrong should be near zero when correct already >> wrong
        self.assertLessEqual(float(parts["l_cf_wrong"]), 1e-5)


class TestActiveMask(unittest.TestCase):
    def test_reversed_masked(self):
        m = active_mask_bound_only()
        for f in BOUND_FEATURES_V1:
            self.assertEqual(m[PHONETIC_FEATURE_INDEX_V1[f]], 1)
        for f in REVERSED_FEATURES_V1:
            self.assertEqual(m[PHONETIC_FEATURE_INDEX_V1[f]], 0)


class TestCounterfactualGrouping(unittest.TestCase):
    def test_same_pool_ids_across_profiles(self):
        # structural: listwise loss compares three score tensors with shared pos_idx/pool_len
        pos = torch.tensor([1, 2])
        plen = torch.tensor([4, 5])
        sc = torch.randn(2, 6)
        p1 = target_prob_from_scores(sc, pos, plen)
        p2 = target_prob_from_scores(sc, pos, plen)
        self.assertTrue(torch.allclose(p1, p2))


if __name__ == "__main__":
    unittest.main()
