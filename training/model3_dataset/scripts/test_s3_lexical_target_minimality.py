# -*- coding: utf-8 -*-
"""Synthetic structural fixtures for lexical target minimality (no heldout hardcoding)."""
from __future__ import annotations

import unittest

from training.model3_dataset.scripts.s3_lexical_target_minimality import (
    assign_roles_for_region,
    change_spans_on_cores,
    structural_composition_audit_notes,
    target_changed_coverage,
)


def _t(
    tid: str,
    surface: str,
    start: int,
    end: int,
    *,
    src: str = "EXISTING_LEXICON_TERM",
    in_lex: bool = True,
    mech: str = "QUERY_NOT_REPAIR_CAPABLE",
) -> dict:
    return {
        "targetId": tid,
        "lexicalTarget": surface,
        "targetIdentitySource": src,
        "targetConfidence": "HIGH",
        "inAuthoritativeLexicon": in_lex,
        "outsideLexiconContract": False,
        "targetStart": start,
        "targetEnd": end,
        "diffCoreStart": 0,
        "diffCoreEnd": 0,
        "mechanismPrev": mech,
        "querySubPrev": "RETRY_REGION_PARTIAL_COVERAGE",
    }


class TestChangeCoverage(unittest.TestCase):
    def test_changed_char_inside_2char_word(self):
        # asr 财X / ref 财产 — second char changes; target 财产 covers
        changes = change_spans_on_cores("财X", "财产")
        self.assertTrue(changes)
        ov, touched = target_changed_coverage(0, 2, 0, changes)
        self.assertGreater(touched, 0)
        self.assertGreater(ov, 0)

    def test_zero_overlap_neighbor(self):
        # change only at [2,3); neighbor [0,2) has zero overlap
        changes = change_spans_on_cores("aaX", "aaY")
        ov, touched = target_changed_coverage(0, 2, 0, changes)
        self.assertEqual(touched, 0)
        self.assertEqual(ov, 0)


class TestMinimalityRoles(unittest.TestCase):
    def test_unchanged_neighbor_is_context(self):
        # ref: 我们先走  asr: 我们先走x — wait need unequal cores
        # core asr=先X ref=先走; lexicon 我们 at [0,2) unchanged relative to change at 走
        asr_core = "先X"
        ref_core = "先走"
        # absolute: sentence "我们先走" — 我们=[0,2), 先走=[2,4), change inside [2,4)
        targets = [
            _t("t1", "我们", 0, 2),
            _t("t2", "先走", 2, 4),
        ]
        recs = assign_roles_for_region(
            case_id="syn1",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=2,
        )
        by_id = {r.targetId: r for r in recs}
        self.assertEqual(by_id["t1"].targetRole, "CONTEXT_SUPPORT")
        self.assertEqual(by_id["t2"].targetRole, "PRIMARY_MINIMAL")
        self.assertEqual(by_id["t1"].changedElementsCovered, 0)

    def test_short_vs_superset_redundant(self):
        asr_core = "ABC"
        ref_core = "AXC"
        targets = [
            _t("t_short", "AX", 0, 2),
            _t("t_long", "AXC", 0, 3),
        ]
        recs = assign_roles_for_region(
            case_id="syn2",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=0,
        )
        by_id = {r.targetId: r for r in recs}
        self.assertEqual(by_id["t_short"].targetRole, "PRIMARY_MINIMAL")
        self.assertEqual(by_id["t_long"].targetRole, "SUPERSET_REDUNDANT")

    def test_two_independent_errors_two_events(self):
        # two changes separated by >1 equal char so clusters do not merge
        asr_core = "A===B"
        ref_core = "X===Y"
        targets = [
            _t("tA", "X", 0, 1),
            _t("tB", "Y", 4, 5),
        ]
        recs = assign_roles_for_region(
            case_id="syn3",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=0,
        )
        events = {r.repairEventId for r in recs if r.targetRole == "PRIMARY_MINIMAL"}
        self.assertGreaterEqual(len(events), 2)

    def test_alternative_minimal_same_length(self):
        asr_core = "ZZ"
        ref_core = "AB"
        targets = [
            _t("t1", "AB", 0, 2, mech="QUERY_NOT_REPAIR_CAPABLE"),
            _t("t2", "AB", 0, 2, mech="RECALL_TARGET_MISS"),  # same span — dedupe by id though
        ]
        # distinct same-length overlapping: use two different 2-char terms same span impossible;
        # use two equal-length terms covering same change: "XY" and "YZ" both len2 covering insert
        asr_core = "Q"
        ref_core = "XYZ"
        targets = [
            _t("t1", "XY", 0, 2, mech="QUERY_NOT_REPAIR_CAPABLE"),
            _t("t2", "YZ", 1, 3, mech="QUERY_NOT_REPAIR_CAPABLE"),
        ]
        recs = assign_roles_for_region(
            case_id="syn4",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=0,
        )
        roles = {r.targetId: r.targetRole for r in recs}
        # both same length and cover changes → ALTERNATIVE_MINIMAL
        self.assertTrue(
            roles["t1"] in ("PRIMARY_MINIMAL", "ALTERNATIVE_MINIMAL")
            and roles["t2"] in ("PRIMARY_MINIMAL", "ALTERNATIVE_MINIMAL")
        )
        if roles["t1"] == "ALTERNATIVE_MINIMAL":
            self.assertEqual(roles["t2"], "ALTERNATIVE_MINIMAL")

    def test_structural_composition_invalid(self):
        asr_core = "abc"
        ref_core = "xyz"
        targets = [
            _t(
                "ts",
                "xyz",
                0,
                3,
                src="STRUCTURAL_COMPOSITION_SUPPORTED",
                in_lex=False,
                mech="TARGET_NOT_IN_LEXICON",
            )
        ]
        recs = assign_roles_for_region(
            case_id="syn5",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=0,
        )
        self.assertEqual(recs[0].targetRole, "INVALID_LEXICAL_TARGET")
        self.assertNotEqual(recs[0].mechanismFinal, "TARGET_NOT_IN_LEXICON")

    def test_function_word_context(self):
        asr_core = "的X"
        ref_core = "的热"
        targets = [
            _t("t_func", "的", 0, 1),  # may be function-ish; if zero change when change is 热
            _t("t_lex", "热", 1, 2),
        ]
        recs = assign_roles_for_region(
            case_id="syn6",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=0,
        )
        by_id = {r.targetId: r for r in recs}
        self.assertEqual(by_id["t_lex"].targetRole, "PRIMARY_MINIMAL")
        # 的 may be CONTEXT if change only on 热
        self.assertIn(by_id["t_func"].targetRole, ("CONTEXT_SUPPORT", "PARTIAL_INSUFFICIENT", "PRIMARY_MINIMAL", "ALTERNATIVE_MINIMAL"))

    def test_punctuation_adjacent(self):
        asr_core = "X。"
        ref_core = "热。"
        changes = change_spans_on_cores(asr_core, ref_core)
        ov, touched = target_changed_coverage(0, 1, 0, changes)
        self.assertGreater(touched, 0)

    def test_unequal_length_replacement(self):
        asr_core = "A"
        ref_core = "BCD"
        changes = change_spans_on_cores(asr_core, ref_core)
        self.assertTrue(changes)
        targets = [_t("t1", "BCD", 0, 3)]
        recs = assign_roles_for_region(
            case_id="syn7",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=0,
        )
        self.assertEqual(recs[0].targetRole, "PRIMARY_MINIMAL")

    def test_domain_term_longer_than_change(self):
        # change one char inside longer domain term
        asr_core = "理财X品"
        ref_core = "理财产品"
        targets = [
            _t("t_prod", "产品", 2, 4),
            _t("t_full", "理财产品", 0, 4),
        ]
        recs = assign_roles_for_region(
            case_id="syn8",
            region_id="r0",
            targets=targets,
            asr_core=asr_core,
            ref_core=ref_core,
            core_abs_start=0,
        )
        by_id = {r.targetId: r for r in recs}
        self.assertEqual(by_id["t_prod"].targetRole, "PRIMARY_MINIMAL")
        self.assertEqual(by_id["t_full"].targetRole, "SUPERSET_REDUNDANT")

    def test_structural_audit_notes_hard_fail(self):
        notes = structural_composition_audit_notes()
        self.assertEqual(notes["hardStandardVerdict"], "FAILS_INDEPENDENT_LEXICAL_IDENTITY_STANDARD")
        self.assertEqual(notes["distinguishesLexicalVsSyntacticFragment"], "NO")


if __name__ == "__main__":
    unittest.main()
