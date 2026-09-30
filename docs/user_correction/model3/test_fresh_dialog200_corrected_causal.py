#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for corrected fresh dialog200 causal evaluator (audit fixtures only)."""
from __future__ import annotations

import copy
import csv
import json
import tempfile
import unittest
from pathlib import Path

from analyze_fresh_dialog200_corrected_causal import (
    DEFAULT_RUN_ID,
    OUT,
    QUALITY_BASELINE,
    classify_case,
    collect_fresh_trace,
    kenlm_reached_correct,
    load_jsonl,
    load_minimality,
    open_lexicon,
    query_capability,
    run_evaluation,
)

RUN_ID = DEFAULT_RUN_ID
RAW = OUT / f"fresh_dialog200_raw_cases_{RUN_ID}.jsonl"


def _one_case():
    rows = load_jsonl(RAW)
    return next(r for r in rows if r.get("caseId") == "d001")


class HistoricalMechanismIndependence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = run_evaluation(run_id=RUN_ID, write_artifacts=False)
        cls.base_bp = {
            r["caseId"]: r["firstBreakpoint"] for r in cls.base["cases"] if not r["rawCorrect"]
        }

    def test_a_mechanism_mutation_independence(self):
        # Rewrite minimality CSV with flipped mechanismFinal
        src = OUT / "model3_v2_s3_mechanism_revalidation.csv"
        rows = list(csv.DictReader(src.open(encoding="utf-8-sig")))
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "mut.csv"
            fields = list(rows[0].keys())
            with p.open("w", encoding="utf-8-sig", newline="") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                for r in rows:
                    if r.get("mechanismFinal") == "QUERY_NOT_REPAIR_CAPABLE":
                        r = {**r, "mechanismFinal": "TARGET_NOT_IN_LEXICON"}
                    elif r.get("mechanismFinal") == "RECALL_TARGET_MISS":
                        r = {**r, "mechanismFinal": "QUERY_NOT_REPAIR_CAPABLE"}
                    w.writerow(r)
            mut = run_evaluation(run_id=RUN_ID, minimality_path=p, write_artifacts=False)
        mut_bp = {
            r["caseId"]: r["firstBreakpoint"] for r in mut["cases"] if not r["rawCorrect"]
        }
        self.assertEqual(self.base_bp, mut_bp)
        self.assertEqual(mut["summary"]["HISTORICAL_CAUSAL_DEPENDENCY"], "NO")

    def test_b_mechanism_removal_independence(self):
        src = OUT / "model3_v2_s3_mechanism_revalidation.csv"
        rows = list(csv.DictReader(src.open(encoding="utf-8-sig")))
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "nocol.csv"
            fields = [c for c in rows[0].keys() if c != "mechanismFinal"]
            with p.open("w", encoding="utf-8-sig", newline="") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                for r in rows:
                    w.writerow({k: r.get(k, "") for k in fields})
            mut = run_evaluation(run_id=RUN_ID, minimality_path=p, write_artifacts=False)
        mut_bp = {
            r["caseId"]: r["firstBreakpoint"] for r in mut["cases"] if not r["rawCorrect"]
        }
        self.assertEqual(self.base_bp, mut_bp)

    def test_c_evaluator_runs_without_mechanism_column(self):
        # covered by test_b; ensure summary produced
        self.assertIn("verdict", self.base["summary"])


class FreshEvidenceSensitivity(unittest.TestCase):
    def test_query_fresh_evidence_sensitivity(self):
        rec = _one_case()
        run_id = RUN_ID
        # Without windows → NOT_ISOLATED (unless exact hit)
        t1 = collect_fresh_trace(rec)
        q0 = query_capability("蓝莓", t1, run_id)
        # Inject windows that cannot represent target
        t2 = copy.deepcopy(t1)
        t2["windows_captured"] = ["甲", "乙"]
        t2["all_hits"] = []
        q_bad = query_capability("蓝莓", t2, run_id)
        self.assertIs(q_bad.value, False)
        # Inject capable window
        t3 = copy.deepcopy(t2)
        t3["windows_captured"] = ["蓝莓马芬"]
        q_ok = query_capability("蓝莓", t3, run_id)
        self.assertIs(q_ok.value, True)

    def test_recall_fresh_evidence_sensitivity(self):
        from analyze_fresh_dialog200_corrected_causal import recall_hit_exact

        rec = _one_case()
        t = collect_fresh_trace(rec)
        t_miss = copy.deepcopy(t)
        t_miss["all_hits"] = ["中", "没"]
        self.assertFalse(recall_hit_exact("蓝莓", t_miss, RUN_ID).value)
        t_hit = copy.deepcopy(t)
        t_hit["all_hits"] = ["蓝莓", "中"]
        self.assertTrue(recall_hit_exact("蓝莓", t_hit, RUN_ID).value)

    def test_kenlm_reachability_strictness(self):
        rec = _one_case()
        t = collect_fresh_trace(rec)
        ref = rec["reference"]
        # bool(inputs) must not count
        t_empty_match = copy.deepcopy(t)
        t_empty_match["kenlm_inputs"] = ["完全不相关的句子"]
        self.assertFalse(kenlm_reached_correct(ref, rec["finalPostprocessText"], t_empty_match, RUN_ID).value)
        t_ok = copy.deepcopy(t)
        t_ok["kenlm_inputs"] = [ref]
        self.assertTrue(kenlm_reached_correct(ref, rec["finalPostprocessText"], t_ok, RUN_ID).value)


class QualityAndFunnel(unittest.TestCase):
    def test_quality_baseline_immutability(self):
        s = run_evaluation(run_id=RUN_ID, write_artifacts=False)["summary"]
        self.assertEqual(s["RAW_CORRECT"], QUALITY_BASELINE["RAW_CORRECT"])
        self.assertEqual(s["FINAL_CORRECT"], QUALITY_BASELINE["FINAL_CORRECT"])
        self.assertEqual(s["quality_gate"], "PASS")

    def test_funnel_conservation_and_monotonicity(self):
        result = run_evaluation(run_id=RUN_ID, write_artifacts=False)
        self.assertEqual(result["summary"]["FUNNEL_CONSERVATION"], "PASS")
        self.assertEqual(result["summary"]["FUNNEL_MONOTONICITY"], "PASS")
        funnel = result["funnel"]
        for st in funnel:
            self.assertEqual(
                st["eligible"],
                st["proven_survived"] + st["proven_lost_here"] + st["not_isolated"] + st["N/A"],
                st,
            )
        for i in range(len(funnel) - 1):
            self.assertEqual(
                funnel[i + 1]["eligible"],
                funnel[i]["proven_survived"],
                (funnel[i]["stage"], funnel[i + 1]["stage"]),
            )


if __name__ == "__main__":
    unittest.main()
