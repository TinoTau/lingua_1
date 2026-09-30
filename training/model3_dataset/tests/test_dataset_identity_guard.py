# -*- coding: utf-8 -*-
"""Tests for Model3 G0 checkpoint↔dataset identity guard."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from training.model3_dataset.acoustic_training.dataset_identity import (
    AUTHORITATIVE_S3,
    Model3DatasetIdentityError,
    assert_authoritative_s3_identity,
    assert_model3_dataset_identity,
)
from training.model3_dataset.train.bigru_v1 import (
    CandidateFieldMissingError,
    span_features,
)

REPO = Path(__file__).resolve().parents[3]


class TestG0AuthoritativeS3(unittest.TestCase):
    def test_correct_s3_passes(self):
        ident = assert_authoritative_s3_identity()
        self.assertEqual(ident.modelId, AUTHORITATIVE_S3["modelId"])
        self.assertEqual(ident.datasetId, AUTHORITATIVE_S3["datasetId"])
        self.assertEqual(ident.datasetBuildId, AUTHORITATIVE_S3["datasetBuildId"])
        self.assertEqual(ident.weightsSha256, AUTHORITATIVE_S3["weightsSha256"])
        self.assertTrue(Path(ident.trainDir).is_dir())
        self.assertTrue(any(Path(ident.trainDir).glob("shard-*.jsonl")))

    def test_g0_before_sample_load_order(self):
        """Identity must resolve without opening training shards."""
        opened = []

        real_open = Path.open

        def tracking_open(self, *args, **kwargs):
            opened.append(str(self))
            return real_open(self, *args, **kwargs)

        with mock.patch.object(Path, "open", tracking_open):
            ident = assert_authoritative_s3_identity()
        # Must not have opened any shard-*.jsonl during G0.
        shard_opens = [p for p in opened if "shard-" in p and p.endswith(".jsonl")]
        self.assertEqual(shard_opens, [], msg=f"G0 loaded shards: {shard_opens}")
        self.assertTrue(any("config.json" in p for p in opened))
        self.assertTrue(any("dataset_manifest.json" in p for p in opened))
        self.assertTrue(Path(ident.trainDir).exists())


class TestG0NegativeMatrix(unittest.TestCase):
    def _tmp_ckpt(self, cfg_overrides: dict, weights_bytes: bytes = b"fake-weights") -> Path:
        td = Path(tempfile.mkdtemp(prefix="m3_g0_ckpt_"))
        self.addCleanup(shutil.rmtree, td, True)
        (td / "config.json").write_text(json.dumps(cfg_overrides), encoding="utf-8")
        (td / "weights.pt").write_bytes(weights_bytes)
        return td

    def _tmp_dataset(self, dataset_id: str, build_id: str, feat: str, label: str) -> Path:
        td = Path(tempfile.mkdtemp(prefix="m3_g0_ds_"))
        self.addCleanup(shutil.rmtree, td, True)
        man = {
            "datasetId": dataset_id,
            "datasetBuildId": build_id,
            "featureContractIdentity": feat,
            "labelContractIdentity": label,
        }
        (td / "dataset_manifest.json").write_text(json.dumps(man), encoding="utf-8")
        for split in ("train", "dev", "test"):
            d = td / split
            d.mkdir()
            (d / "shard-000.jsonl").write_text("{}\n", encoding="utf-8")
        return td

    def test_wrong_dataset_labeled_path_fails(self):
        labeled = REPO / "training/model3_dataset/model3_v2_labeled/train"
        with self.assertRaises(Model3DatasetIdentityError) as ctx:
            assert_authoritative_s3_identity(dataset_path=labeled)
        self.assertIn("MODEL3_DATASET_IDENTITY_MISMATCH", ctx.exception.code)

    def test_explicit_wrong_path_cannot_bypass(self):
        labeled_root = REPO / "training/model3_dataset/model3_v2_labeled"
        with self.assertRaises(Model3DatasetIdentityError) as ctx:
            assert_model3_dataset_identity(
                checkpoint_dir=AUTHORITATIVE_S3["checkpointDir"],
                dataset_path=labeled_root,
                require_authoritative_s3=True,
            )
        self.assertEqual(ctx.exception.code, "MODEL3_DATASET_IDENTITY_MISMATCH")

    def test_wrong_build_id_fails(self):
        # Use real checkpoint but expect wrong build → fail on checkpoint itself.
        with self.assertRaises(Model3DatasetIdentityError) as ctx:
            assert_model3_dataset_identity(
                checkpoint_dir=AUTHORITATIVE_S3["checkpointDir"],
                expected_dataset_id=AUTHORITATIVE_S3["datasetId"],
                expected_dataset_build_id="prod_core_s3_build_WRONG",
                expected_feature_contract=AUTHORITATIVE_S3["featureContract"],
                expected_label_contract=AUTHORITATIVE_S3["labelContractVersion"],
                expected_weights_sha256=AUTHORITATIVE_S3["weightsSha256"],
                expected_model_id=AUTHORITATIVE_S3["modelId"],
            )
        self.assertIn(ctx.exception.code, {"MODEL3_DATASET_BUILD_MISMATCH", "MODEL3_DATASET_IDENTITY_MISMATCH"})

    def test_wrong_feature_contract_fails(self):
        with self.assertRaises(Model3DatasetIdentityError) as ctx:
            assert_model3_dataset_identity(
                checkpoint_dir=AUTHORITATIVE_S3["checkpointDir"],
                expected_feature_contract="SOME_OTHER_FEATURE_CONTRACT",
                require_authoritative_s3=True,
            )
        self.assertEqual(ctx.exception.code, "MODEL3_FEATURE_CONTRACT_MISMATCH")

    def test_wrong_label_contract_fails(self):
        with self.assertRaises(Model3DatasetIdentityError) as ctx:
            assert_model3_dataset_identity(
                checkpoint_dir=AUTHORITATIVE_S3["checkpointDir"],
                expected_label_contract="MODEL3_LABEL_CONTRACT_V1_FAKE",
                require_authoritative_s3=True,
            )
        self.assertEqual(ctx.exception.code, "MODEL3_LABEL_CONTRACT_MISMATCH")

    def test_missing_manifest_fails(self):
        # Point mapping at a temp empty dir by patching resolve_dataset_root.
        empty = Path(tempfile.mkdtemp(prefix="m3_g0_empty_"))
        self.addCleanup(shutil.rmtree, empty, True)
        with mock.patch(
            "training.model3_dataset.acoustic_training.dataset_identity.resolve_dataset_root",
            return_value=empty,
        ):
            with self.assertRaises(Model3DatasetIdentityError) as ctx:
                assert_authoritative_s3_identity()
        self.assertEqual(ctx.exception.code, "MODEL3_DATASET_MANIFEST_MISSING")

    def test_no_fallback_when_root_missing(self):
        with mock.patch(
            "training.model3_dataset.acoustic_training.dataset_identity.resolve_dataset_root",
            side_effect=Model3DatasetIdentityError(
                "MODEL3_DATASET_MANIFEST_MISSING",
                "dataset_root_missing",
                datasetId="MODEL3_V2_PRODUCTION_CORE_S3",
                dataset_path="/no/such/s3",
            ),
        ):
            with self.assertRaises(Model3DatasetIdentityError) as ctx:
                assert_authoritative_s3_identity()
        self.assertEqual(ctx.exception.code, "MODEL3_DATASET_MANIFEST_MISSING")
        self.assertNotIn("labeled", str(ctx.exception).lower())


class TestStalePathRegression(unittest.TestCase):
    def test_causality_script_has_no_labeled_train_dir(self):
        src = (
            REPO
            / "training/model3_dataset/scripts/audit_model3_v2_localization_training_causality.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("model3_v2_labeled/train", src)
        self.assertIn("assert_authoritative_s3_identity", src)

    def test_generalization_runner_has_no_train_labeled(self):
        src = (
            REPO
            / "electron_node/electron-node/tests/run-model3-v2-target-localization-generalization-audit.mjs"
        ).read_text(encoding="utf-8")
        self.assertNotIn("TRAIN_LABELED", src)
        self.assertNotIn("model3_v2_labeled", src)
        self.assertIn("assertAuthoritativeS3Identity", src)


class TestCandidateFailClosed(unittest.TestCase):
    def test_zero_one_two_accepted(self):
        fa = {"pinyinTextDerived": True, "recallFirstPass": True}
        for c in (0, 1, 2):
            f, _ = span_features(
                {"surface": "测", "isAnchor": False, "recallEvidence": {"firstPassCandidateCount": c}},
                fa,
                0,
                1,
            )
            self.assertAlmostEqual(f[3], __import__("math").log1p(c))

    def test_missing_rejected(self):
        fa = {"pinyinTextDerived": True, "recallFirstPass": True}
        with self.assertRaises(CandidateFieldMissingError):
            span_features({"surface": "测", "isAnchor": False}, fa, 0, 1)

    def test_none_rejected(self):
        fa = {"pinyinTextDerived": True, "recallFirstPass": True}
        with self.assertRaises(CandidateFieldMissingError):
            span_features(
                {"surface": "测", "isAnchor": False, "recallEvidence": {"firstPassCandidateCount": None}},
                fa,
                0,
                1,
            )

    def test_channel_unavailable_allows_zero(self):
        fa = {"pinyinTextDerived": True, "recallFirstPass": False}
        f, a = span_features({"surface": "测", "isAnchor": False}, fa, 0, 1)
        self.assertEqual(f[3], 0.0)
        self.assertEqual(a[3], 0.0)


if __name__ == "__main__":
    unittest.main()
