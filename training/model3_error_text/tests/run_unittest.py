# -*- coding: utf-8 -*-
"""Minimal unittest runner (pytest may be unavailable)."""
from __future__ import annotations

import unittest
from pathlib import Path

from training.model3_error_text.generator.corrupt import apply_corruptions
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import LexiconSurfaceResolver, default_sqlite_path
from training.model3_error_text.generator.split import assign_split, leakage_report
from training.model3_error_text.generator.validate import validate_sample

REPO = Path(__file__).resolve().parents[3]


class TestPilotGen(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))

    @classmethod
    def tearDownClass(cls):
        cls.resolver.close()

    def test_families(self):
        self.assertEqual(len(ACTIVE_FAMILIES_V1), 7)

    def test_split_det(self):
        self.assertEqual(assign_split("k", 1), assign_split("k", 1))

    def test_offset(self):
        self.assertEqual(
            apply_corruptions("你好", [{"spanStart": 0, "spanEnd": 1, "referenceSurface": "你", "errorSurface": "尼"}]),
            "尼好",
        )

    def test_dialog_forbidden(self):
        s = {
            "sampleId": "x",
            "generatorVersion": "t",
            "generationSeed": 1,
            "sourceCorpus": "dialog_200",
            "sourceSentenceId": "s",
            "referenceText": "你好",
            "errorText": "你好",
            "corruptionCount": 0,
            "corruptions": [],
            "evidenceLevel": "SYNTHETIC_TEXT",
            "splitGroupKey": "s|solo",
        }
        self.assertIn("dialog_200_forbidden", validate_sample(s, self.resolver))

    def test_leakage(self):
        rows = [
            {"split": "train", "sourceSentenceId": "a", "contrastGroupId": "c1", "corruptions": []},
            {"split": "test", "sourceSentenceId": "b", "contrastGroupId": "c2", "corruptions": []},
        ]
        r = leakage_report(rows)
        self.assertEqual(r["source_sentence_leakage_total"], 0)


if __name__ == "__main__":
    unittest.main()
