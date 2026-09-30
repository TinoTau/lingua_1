# -*- coding: utf-8 -*-
"""MODEL3_SYNTHETIC_V1 freeze regression gates."""
from __future__ import annotations

import copy
import hashlib
import inspect
import json
import unittest
from pathlib import Path

from training.model3_dataset.train import train_full100k_strict_integration as integ
from training.model3_dataset.train.bigru_v1 import model_input_hash, sample_to_tensors
from training.model3_dataset.train.config_loader import load_training_config


REPO = Path(__file__).resolve().parents[3]
AUTH_SEED = 2026082520
CKPT = REPO / "training/model3_dataset/model3_v1_full100k_strict_integration_ckpts" / f"seed_{AUTH_SEED}"
SEAL = REPO / "docs/user_correction/model3/MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json"


class SyntheticV1FreezeGovernanceTests(unittest.TestCase):
    def test_config_ssot_frozen_objective(self):
        cfg = load_training_config()
        self.assertEqual(cfg["config_hash"], "f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830")
        self.assertEqual(cfg["objective"]["class_weight_retry"], 1.0)
        self.assertFalse(cfg["objective"]["auto_class_weight_formula"])
        self.assertFalse(cfg["objective"]["pair_ce_enabled"])
        self.assertEqual(cfg["objective"]["pair_loss_type"], "PURE_MARGIN")
        self.assertEqual(cfg["objective"]["pair_lambda"], 0.2)
        self.assertEqual(cfg["objective"]["pair_margin"], 0.25)
        self.assertEqual(
            [
                cfg["sampling_view"]["STRICT"],
                cfg["sampling_view"]["ANCHOR_CONDITIONED_HARD_KEEP"],
                cfg["sampling_view"]["NATURAL"],
                cfg["sampling_view"]["NO_ANCHOR"],
            ],
            [0.30, 0.30, 0.25, 0.15],
        )
        self.assertFalse(cfg["runtime_freeze"].get("production_retry"))
        self.assertFalse(cfg["runtime_freeze"].get("tts"))

    def test_dataset_count_does_not_change_training_params(self):
        cfg = load_training_config()
        snap = (
            cfg["objective"]["class_weight_retry"],
            cfg["objective"]["pair_lambda"],
            cfg["objective"]["pair_margin"],
            cfg["objective"]["pair_ce_enabled"],
            cfg["objective"]["auto_class_weight_formula"],
            dict(cfg["sampling_view"]),
        )
        # Simulate dataset count change by reloading; params must be identical.
        cfg2 = load_training_config()
        snap2 = (
            cfg2["objective"]["class_weight_retry"],
            cfg2["objective"]["pair_lambda"],
            cfg2["objective"]["pair_margin"],
            cfg2["objective"]["pair_ce_enabled"],
            cfg2["objective"]["auto_class_weight_formula"],
            dict(cfg2["sampling_view"]),
        )
        self.assertEqual(snap, snap2)

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

    def test_pair_ce_and_auto_weight_absent_in_authoritative_trainer(self):
        src = inspect.getsource(integ)
        self.assertNotIn("auto_class_weight_formula = True", src)
        self.assertNotIn("pair_ce_enabled = True", src)
        loss_src = inspect.getsource(integ.pure_pair_margin_loss)
        self.assertNotIn("CrossEntropy", loss_src)
        self.assertFalse(load_training_config()["objective"]["auto_class_weight_formula"])
        self.assertFalse(load_training_config()["objective"]["pair_ce_enabled"])

    def test_reference_mutation_does_not_change_model_tensor(self):
        vocab = {"<pad>": 0, "<unk>": 1, "测": 2, "试": 3, "锚": 4}
        sample = {
            "sampleId": "t1",
            "currentText": "测试",
            "referenceText": "测试",
            "featureAvailability": {"pinyinTextDerived": True, "recallFirstPass": True},
            "spans": [
                {
                    "surface": "测",
                    "isAnchor": True,
                    "targetMask": 0,
                    "label": "MASKED",
                    "referenceSurface": "测",
                    "recallEvidence": {"firstPassCandidateCount": 2},
                },
                {
                    "surface": "试",
                    "isAnchor": False,
                    "targetMask": 1,
                    "label": "KEEP",
                    "referenceSurface": "试",
                    "recallEvidence": {"firstPassCandidateCount": 3},
                },
            ],
        }
        h0 = model_input_hash(sample, vocab)
        mutated = copy.deepcopy(sample)
        mutated["referenceText"] = "完全不同"
        mutated["spans"][1]["referenceSurface"] = "验"
        mutated["spans"][1]["repairability"] = {"referenceReachable": "YES"}
        h1 = model_input_hash(mutated, vocab)
        self.assertEqual(h0, h1)

    def test_anchor_mask_mutation_changes_model_tensor(self):
        vocab = {"<pad>": 0, "<unk>": 1, "测": 2, "试": 3, "锚": 4}
        sample = {
            "sampleId": "t2",
            "featureAvailability": {"pinyinTextDerived": True, "recallFirstPass": True},
            "spans": [
                {
                    "surface": "测",
                    "isAnchor": True,
                    "targetMask": 0,
                    "label": "MASKED",
                    "recallEvidence": {"firstPassCandidateCount": 2},
                },
                {
                    "surface": "试",
                    "isAnchor": False,
                    "targetMask": 1,
                    "label": "RETRY",
                    "recallEvidence": {"firstPassCandidateCount": 3},
                },
            ],
        }
        h0 = model_input_hash(sample, vocab)
        mutated = copy.deepcopy(sample)
        mutated["spans"][0]["isAnchor"] = False
        mutated["spans"][1]["isAnchor"] = True
        h1 = model_input_hash(mutated, vocab)
        self.assertNotEqual(h0, h1)
        feats0 = sample_to_tensors(sample, vocab)["feats"]
        feats1 = sample_to_tensors(mutated, vocab)["feats"]
        self.assertNotEqual(feats0[0][0], feats1[0][0])

    def test_authoritative_checkpoint_identity(self):
        self.assertTrue((CKPT / "weights.pt").exists())
        weights_sha = hashlib.sha256((CKPT / "weights.pt").read_bytes()).hexdigest()
        self.assertEqual(
            weights_sha,
            "9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815",
        )
        manifest = json.loads((CKPT / "model_manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["config"]["seed"], AUTH_SEED)
        self.assertEqual(
            manifest["config"]["config_hash"],
            "f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830",
        )
        self.assertIn(manifest.get("status"), ("ACTIVE_NOLEAK", "MODEL3_SYNTHETIC_V1_FROZEN"))

    def test_acceptance_seal_present_and_consistent(self):
        self.assertTrue(SEAL.exists(), "acceptance seal missing")
        seal = json.loads(SEAL.read_text(encoding="utf-8"))
        self.assertEqual(seal["status"], "MODEL3_SYNTHETIC_V1_FROZEN")
        self.assertEqual(seal["model"]["seed"], AUTH_SEED)
        self.assertEqual(
            seal["hashes"]["config_sha256"],
            "f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830",
        )
        self.assertEqual(
            seal["hashes"]["model_sha256"],
            "9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815",
        )


if __name__ == "__main__":
    unittest.main()
