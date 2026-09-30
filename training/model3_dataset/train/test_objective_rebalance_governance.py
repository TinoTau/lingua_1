# -*- coding: utf-8 -*-
"""Governance regression tests for MODEL3_V1_OBJECTIVE_REBALANCE."""
from __future__ import annotations

import unittest

from training.model3_dataset.train import train_objective_rebalance as tor


class ObjectiveRebalanceGovernanceTests(unittest.TestCase):
    def test_class_weight_not_auto_from_hard_keep_count(self):
        # Changing Hard KEEP volume must NOT change class_weight_retry.
        self.assertEqual(tor.CLASS_WEIGHT_RETRY, 1.0)
        # Simulated dataset swing — formula must not be consulted.
        fake_formula = min(3.0, max(1.5, (10_000_000 / 1) ** 0.5 * 0.35))
        self.assertNotEqual(fake_formula, tor.CLASS_WEIGHT_RETRY)
        self.assertEqual(tor.CLASS_WEIGHT_RETRY, 1.0)

    def test_pair_lambda_not_auto_from_buckets(self):
        # Adding a new bucket must not mutate explicit lambdas.
        lambdas = {k: v["lambda_pair"] for k, v in tor.OBJECTIVES.items()}
        self.assertEqual(lambdas["O0"], 0.0)
        self.assertEqual(lambdas["O1"], 0.05)
        self.assertEqual(lambdas["O2"], 0.10)
        self.assertEqual(lambdas["O3"], 0.20)
        # Sampling view frozen Balance D
        self.assertEqual(tor.SAMPLING_VIEW["STRICT"], 0.30)

    def test_strict_membership_not_swallowed_by_hard_keep(self):
        # Synthetic: sample is both STRICT KEEP and Hard KEEP.
        train = [
            {"sampleId": "A_KEEP", "trainingBucket": "NATURAL", "spans": []},
            {"sampleId": "A_RETRY", "trainingBucket": "NATURAL", "spans": []},
            {"sampleId": "HK_ONLY", "trainingBucket": "NATURAL", "spans": []},
        ]
        strict_sc = {
            "A_KEEP": {
                "contrastStrength": tor.STRICT,
                "contrastStrengthClass": tor.STRICT,
                "contrastGroupId": "g1",
                "roleInPair": "KEEP",
            },
            "A_RETRY": {
                "contrastStrength": tor.STRICT,
                "contrastStrengthClass": tor.STRICT,
                "contrastGroupId": "g1",
                "roleInPair": "RETRY",
            },
        }
        hard_keep = {"A_KEEP": {"split": "train"}, "HK_ONLY": {"split": "train"}}
        buckets, strict_groups, _, tags = tor.build_index(train, strict_sc, hard_keep)
        self.assertTrue(tags["A_KEEP"]["isStrictMember"])
        self.assertTrue(tags["A_KEEP"]["isStrictKeep"])
        self.assertTrue(tags["A_KEEP"]["isAnchorHardKeep"])  # tag retained
        self.assertIn(0, buckets["STRICT"])  # KEEP index 0 stays STRICT
        self.assertNotIn(0, buckets.get("ANCHOR_CONDITIONED_HARD_KEEP", []))
        self.assertEqual(strict_groups["g1"], [0, 1])

    def test_pair_ce_absent(self):
        # Pure margin path must not include CE.
        import inspect
        import torch

        src = inspect.getsource(tor.pure_pair_margin_loss)
        self.assertNotIn("CrossEntropy", src)
        self.assertNotIn("crit", src)
        lk = torch.tensor([0.2, -0.1])
        lr = torch.tensor([-0.3, 0.5])
        loss = tor.pure_pair_margin_loss(lk, lr, margin=0.25)
        # margin - (0.5 - (-0.1)) = 0.25 - 0.6 < 0 → relu = 0
        self.assertEqual(float(loss.item()), 0.0)
        loss2 = tor.pure_pair_margin_loss(torch.tensor([0.0, 1.0]), torch.tensor([0.0, 0.9]), margin=0.25)
        # 0.25 - (0.9-1.0) = 0.35
        self.assertAlmostEqual(float(loss2.item()), 0.35, places=5)


if __name__ == "__main__":
    unittest.main()
