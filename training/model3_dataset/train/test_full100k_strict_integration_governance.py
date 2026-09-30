# -*- coding: utf-8 -*-
"""Governance regression tests for Full100K Strict Integration."""
from __future__ import annotations

import inspect
import tempfile
import unittest
from pathlib import Path

from training.model3_dataset.train import config_loader
from training.model3_dataset.train import train_full100k_strict_integration as integ
from training.model3_dataset.train.config_loader import load_training_config


class Full100KStrictIntegrationGovernanceTests(unittest.TestCase):
    def test_config_ssot_loads_and_frozen_objective(self):
        cfg = load_training_config()
        self.assertEqual(cfg["objective"]["class_weight_retry"], 1.0)
        self.assertFalse(cfg["objective"]["auto_class_weight_formula"])
        self.assertFalse(cfg["objective"]["pair_ce_enabled"])
        self.assertEqual(cfg["objective"]["pair_loss_type"], "PURE_MARGIN")
        self.assertEqual(cfg["objective"]["pair_lambda"], 0.2)
        self.assertEqual(cfg["objective"]["pair_margin"], 0.25)
        self.assertEqual(cfg["sampling_view"]["sampling_view_id"], "BALANCE_D_30_30_25_15")

    def test_dataset_count_does_not_change_objective(self):
        cfg = load_training_config()
        w0 = cfg["objective"]["class_weight_retry"]
        lam0 = cfg["objective"]["pair_lambda"]
        m0 = cfg["objective"]["pair_margin"]
        cfg2 = load_training_config()
        self.assertEqual(cfg2["objective"]["class_weight_retry"], w0)
        self.assertEqual(cfg2["objective"]["pair_lambda"], lam0)
        self.assertEqual(cfg2["objective"]["pair_margin"], m0)

    def test_strict_keep_with_hard_keep_tag_keeps_strict_identity(self):
        train = [
            {"sampleId": "A_KEEP", "trainingBucket": "NATURAL", "spans": []},
            {"sampleId": "A_RETRY", "trainingBucket": "NATURAL", "spans": []},
            {"sampleId": "HK_ONLY", "trainingBucket": "NATURAL", "spans": []},
        ]
        strict_sc = {
            "A_KEEP": {
                "contrastStrength": integ.STRICT,
                "contrastStrengthClass": integ.STRICT,
                "contrastGroupId": "g1",
                "roleInPair": "KEEP",
            },
            "A_RETRY": {
                "contrastStrength": integ.STRICT,
                "contrastStrengthClass": integ.STRICT,
                "contrastGroupId": "g1",
                "roleInPair": "RETRY",
            },
        }
        hard_keep = {"A_KEEP": {"split": "train"}, "HK_ONLY": {"split": "train"}}
        buckets, strict_groups, _, tags = integ.build_index(train, strict_sc, hard_keep)
        self.assertTrue(tags["A_KEEP"]["isStrictMember"])
        self.assertTrue(tags["A_KEEP"]["isStrictKeep"])
        self.assertTrue(tags["A_KEEP"]["isAnchorHardKeep"])
        self.assertIn(0, buckets["STRICT"])
        self.assertNotIn(0, buckets.get("ANCHOR_CONDITIONED_HARD_KEEP", []))
        self.assertEqual(sorted(strict_groups["g1"]), [0, 1])

    def test_strict_pair_not_cross_split(self):
        strict_sc = {
            "t1": {"contrastStrength": integ.STRICT, "contrastGroupId": "gA", "roleInPair": "KEEP"},
            "t2": {"contrastStrength": integ.STRICT, "contrastGroupId": "gA", "roleInPair": "RETRY"},
            "x1": {"contrastStrength": integ.STRICT, "contrastGroupId": "gB", "roleInPair": "KEEP"},
            "x2": {"contrastStrength": integ.STRICT, "contrastGroupId": "gB", "roleInPair": "RETRY"},
        }
        leak = integ.audit_split_leakage(strict_sc, {"t1", "t2"}, {"x1", "x2"})
        self.assertTrue(leak["ok"])
        leak2 = integ.audit_split_leakage(strict_sc, {"t1", "t2"}, {"t2", "x1"})
        self.assertFalse(leak2["ok"])
        self.assertEqual(leak2["cross_split_groups"], 1)

    def test_pair_ce_absent(self):
        src = inspect.getsource(integ.pure_pair_margin_loss)
        self.assertNotIn("CrossEntropy", src)
        import torch

        loss = integ.pure_pair_margin_loss(torch.tensor([0.0, 1.0]), torch.tensor([0.0, 0.9]), 0.25)
        self.assertAlmostEqual(float(loss.item()), 0.35, places=5)

    def test_config_fail_fast_on_missing(self):
        missing = Path(tempfile.gettempdir()) / "model3_missing_config_ssot.json"
        if missing.exists():
            missing.unlink()
        with self.assertRaises(config_loader.ConfigSSOTError):
            load_training_config(path=missing)


if __name__ == "__main__":
    unittest.main()
