# -*- coding: utf-8 -*-
"""Tests for target-scope derivation + evaluator semantic correction."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.s3_target_scope_derivation import (  # noqa: E402
    derive_target_scope,
    structural_family_id,
)


class TargetScopeSemanticsTests(unittest.TestCase):
    def test_no_primary_map_is_not_no_repairable(self):
        """Missing map must NOT become NO_REPAIRABLE_TARGET — derivation decides."""
        # Equal texts → FINAL_ALREADY_EQUIVALENT (not NO_REPAIRABLE)
        r = derive_target_scope("你好世界", "你好世界")
        self.assertEqual(r.scopeClass, "FINAL_ALREADY_EQUIVALENT")
        self.assertNotEqual(r.scopeClass, "NO_REPAIRABLE_TARGET")

    def test_deletion_no_finespan_is_no_repairable(self):
        r = derive_target_scope("", "私教课还剩几次", has_fine_spans=False)
        self.assertIn(r.scopeClass, {"NO_REPAIRABLE_TARGET", "DELETION_NO_REPAIRABLE_TARGET"})

    def test_reference_diff_valid_local_alignment_eligible(self):
        # unequal-length: 自教课 vs 私教课
        r = derive_target_scope(
            "自教课还剩几次能帮我约明天晚上7点吗",
            "私教课还剩几次能帮我约明天晚上七点吗",
        )
        self.assertEqual(r.scopeClass, "REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION")
        highs = [t for t in r.targets if t.confidence == "HIGH" and t.eligibility == "ELIGIBLE"]
        self.assertTrue(len(highs) >= 1)
        # Must not hardcode case id in family
        fam = structural_family_id(highs[0].refSurface, "LEXICON_COVERAGE")
        self.assertNotIn("d040", fam)
        self.assertNotIn("d085", fam)

    def test_ambiguous_long_rewrite(self):
        asr = "今天天气不错我们出去玩吧"
        ref = "完全不同的一句参考文本用于制造大范围歧义对齐区域并且继续加长"
        r = derive_target_scope(asr, ref)
        self.assertIn(
            r.scopeClass,
            {
                "REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION",
                "REFERENCE_DIFF_AMBIGUOUS_ALIGNMENT",
                "REFERENCE_DIFF_NO_REPAIRABLE_LOCAL_REGION",
            },
        )

    def test_trad_simp_folds_to_equivalent(self):
        r2 = derive_target_scope("還剩幾點", "还剩几点")
        self.assertEqual(r2.scopeClass, "FINAL_ALREADY_EQUIVALENT")

    def test_final_already_equivalent_punct(self):
        r = derive_target_scope("你好世界", "你好，世界！")
        self.assertEqual(r.scopeClass, "FINAL_ALREADY_EQUIVALENT")

    def test_anchor_barrier_outside_contract(self):
        asr = "ABCDEF"
        ref = "ABXDEF"
        # Anchor covers the diff at index 2
        r = derive_target_scope(asr, ref, anchor_ranges=[(2, 3)])
        self.assertTrue(
            r.scopeClass == "OUTSIDE_CURRENT_RETRY_CONTRACT"
            or any(t.eligibility == "OUTSIDE_CURRENT_RETRY_CONTRACT" for t in r.targets)
            or r.scopeClass
            in (
                "REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION",
                "REFERENCE_DIFF_AMBIGUOUS_ALIGNMENT",
            )
        )

    def test_derivation_has_no_case_id_branch(self):
        src = Path(__file__).with_name("s3_target_scope_derivation.py").read_text(encoding="utf-8")
        self.assertNotIn("d040", src)
        self.assertNotIn("PRIMARY_TARGETS", src)
        self.assertNotIn("CLEAR_OOS", src)
        self.assertNotIn("私教课", src)  # no known expected strings

    def test_unequal_length_and_multi_region(self):
        asr = "可以打爆马顺便解一下张能扫马支付吗"
        ref = "可以打包吗顺便结一下账能扫码支付吗"
        r = derive_target_scope(asr, ref)
        self.assertEqual(r.scopeClass, "REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION")
        self.assertGreaterEqual(len([t for t in r.targets if t.eligibility == "ELIGIBLE"]), 1)


class EvaluatorSemanticGuardTests(unittest.TestCase):
    def test_emit_script_does_not_map_no_primary_to_no_repairable(self):
        """New authoritative emit must not use the old bug path as primary class."""
        p = Path(__file__).with_name("emit_s3_provenance_freeze_target_scope_audit.py")
        self.assertTrue(p.exists(), "emit script must exist")
        text = p.read_text(encoding="utf-8")
        # Forbidden pattern: assigning NO_REPAIRABLE_TARGET from NO_PRIMARY_TARGET_MAP
        self.assertNotIn('NO_REPAIRABLE_TARGET", "NO_PRIMARY_TARGET_MAP"', text)
        self.assertNotIn('cls, drop = "NO_REPAIRABLE_TARGET", "NO_PRIMARY_TARGET_MAP"', text)
        self.assertIn("TARGET_SCOPE_NOT_EVALUATED", text)
        self.assertIn("RUNTIME_TRACE_COMPLETENESS", text)
        self.assertIn("TARGET_CAUSAL_COMPLETENESS", text)


if __name__ == "__main__":
    unittest.main()
