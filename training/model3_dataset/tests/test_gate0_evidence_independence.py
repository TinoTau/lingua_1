# -*- coding: utf-8 -*-
"""Focused Gate0 evidence-independence regression tests."""
from __future__ import annotations

import json
import os
import subprocess
import unittest
from pathlib import Path

from training.model3_dataset.acoustic_training.family_identity import semantic_family_id
from training.model3_dataset.acoustic_training.gate0 import (
    BLOCKED,
    FAIL,
    FORMAL_EVIDENCE,
    INSUFFICIENT_EVIDENCE,
    NOT_EXERCISED,
    PASS,
    evaluate_gate0,
)
from training.model3_dataset.acoustic_training.orchestrator import (
    ELECTRON,
    HARNESS,
    materialize_utterance_from_parts,
    run_formal_lattice_batch,
)
from training.model3_dataset.acoustic_training.serializer import (
    CandidateStateError,
    extract_first_pass_candidate_count,
    serialize_path_samples,
)

REPO = Path(__file__).resolve().parents[3]


def _span(cand: int | None, *, label: str = "KEEP", anchor: str = "NONE", packed: bool = True):
    sp = {
        "spanId": "s0",
        "surface": "今",
        "rawStart": 0,
        "rawEnd": 1,
        "isAnchor": anchor != "NONE",
        "anchorSource": anchor,
        "label": label,
        "targetMask": 1 if label in ("KEEP", "RETRY") else 0,
    }
    if cand is not None:
        sp["recallEvidence"] = {"status": "AVAILABLE", "firstPassCandidateCount": cand}
        if packed:
            sp["packedInfer"] = {
                "surface": "今",
                "firstPassCandidateCount": cand,
                "pinyinChannelAvail": True,
                "recallFirstPassAvail": True,
            }
            sp["packedInferFields"] = sp["packedInfer"]
    elif packed:
        sp["packedInfer"] = {
            "surface": "今",
            "pinyinChannelAvail": True,
            "recallFirstPassAvail": True,
        }
        sp["packedInferFields"] = sp["packedInfer"]
    return sp


def _formal_utt(
    *,
    paths=None,
    path_count=1,
    diag=None,
    fam="sf_test",
    run="mr_test",
    split="train",
):
    paths = paths or [
        {
            "pathId": "p0",
            "pathIndex": 0,
            "spans": [_span(0), _span(2, label="RETRY")],
            "retainedDomains": [],
        }
    ]
    return {
        "semanticFamilyId": fam,
        "materializationRunId": run,
        "split": split,
        "evidenceSource": FORMAL_EVIDENCE,
        "lattice": {"pathCount": path_count, "paths": paths, "evidenceSource": FORMAL_EVIDENCE},
        "labeledPaths": paths,
        "ownerDiagnostics": diag
        or {
            "MODEL2_OWNER_WIRED": True,
            "MODEL2_OWNER_ATTEMPTED": True,
            "MODEL2_OWNER_COMPLETED": True,
            "MODEL2_HOST_AVAILABLE": True,
            "MODEL2_HIT_OBSERVED": False,
            "DOMAIN_OWNER_WIRED": True,
            "DOMAIN_OWNER_ATTEMPTED": True,
            "DOMAIN_OWNER_COMPLETED": True,
            "DOMAIN_HIT_OBSERVED": False,
        },
        "ownerExecution": {},
    }


class TestGate0HardcodedAccountingRemoved(unittest.TestCase):
    def test_empty_batch_insufficient_not_pass(self):
        report = evaluate_gate0([])
        self.assertEqual(report["acceptanceVerdict"], INSUFFICIENT_EVIDENCE)
        self.assertFalse(report["acceptancePassed"])
        self.assertEqual(report["checkStatuses"]["semantic_exclude_distinguished"], NOT_EXERCISED)
        self.assertEqual(report["checkStatuses"]["hard_reject_distinguished"], NOT_EXERCISED)
        self.assertFalse(report["checks"]["semantic_exclude_distinguished"])
        self.assertFalse(report["checks"]["hard_reject_distinguished"])
        # Structural readiness may still be true — must not mean acceptance PASS
        self.assertTrue(report["readyForGate0AcceptanceRun"])
        self.assertNotEqual(report["acceptanceVerdict"], PASS)

    def test_semantic_exclude_not_exercised(self):
        utt = _formal_utt()
        report = evaluate_gate0(
            [
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": utt,
                }
            ]
        )
        self.assertEqual(report["checkStatuses"]["semantic_exclude_distinguished"], NOT_EXERCISED)
        self.assertNotEqual(report["checkStatuses"]["semantic_exclude_distinguished"], PASS)

    def test_hard_reject_not_exercised(self):
        utt = _formal_utt()
        report = evaluate_gate0(
            [
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": utt,
                }
            ]
        )
        self.assertEqual(report["checkStatuses"]["hard_reject_distinguished"], NOT_EXERCISED)

    def test_hard_reject_exercised_pass(self):
        report = evaluate_gate0(
            [
                {
                    "disposition": "HARD_REJECT",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "reject": {"code": "TONE_STATE_MISSING"},
                    "utt": {"evidenceSource": FORMAL_EVIDENCE, "lattice": {"evidenceSource": FORMAL_EVIDENCE}},
                },
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": _formal_utt(),
                },
            ]
        )
        self.assertEqual(report["checkStatuses"]["hard_reject_distinguished"], PASS)

    def test_semantic_exclude_exercised_pass(self):
        report = evaluate_gate0(
            [
                {
                    "disposition": "SEMANTIC_EXCLUDE",
                    "code": "NO_REPAIRABLE_TARGET",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": _formal_utt(paths=[{"pathId": "p0", "pathIndex": 0, "spans": [_span(0, label="EXCLUDE_FROM_SUPERVISED")], "retainedDomains": []}]),
                }
            ]
        )
        self.assertEqual(report["checkStatuses"]["semantic_exclude_distinguished"], PASS)


class TestFixtureEvidenceRejected(unittest.TestCase):
    def test_fixture_lattice_rejected_by_gate0(self):
        cur = "今天天气不错"
        fake = {
            "ok": True,
            "currentText": cur,
            "model3CurrentText": cur,
            "referenceText": cur,
            "evidenceSource": "FORMAL_FRESH_MATERIALIZATION",  # forged — must be overridden
            "ownerExecution": {
                "DOMAIN_ANCHOR_OWNER_WIRED": True,
                "DOMAIN_ANCHOR_OWNER_EXECUTED": True,
                "MODEL2_ANCHOR_OWNER_WIRED": True,
                "MODEL2_ANCHOR_OWNER_EXECUTED": True,
                "MODEL2_ANCHOR_HOST_AVAILABLE": True,
            },
            "pathCount": 2,
            "paths": [
                {
                    "pathId": "p0",
                    "pathIndex": 0,
                    "spans": [
                        {
                            "spanId": "s0",
                            "surface": "今",
                            "rawStart": 0,
                            "rawEnd": 1,
                            "isAnchor": False,
                            "anchorSource": "NONE",
                            "recallEvidence": {"status": "AVAILABLE", "firstPassCandidateCount": 1},
                            "toneReadiness": "ready",
                            "packedInfer": {
                                "surface": "今",
                                "firstPassCandidateCount": 1,
                                "pinyinChannelAvail": True,
                                "recallFirstPassAvail": True,
                            },
                            "referenceSurface": "今",
                        }
                    ],
                    "retainedDomains": [],
                }
            ],
            "reused": {},
        }
        out = materialize_utterance_from_parts(
            reference={
                "referenceId": "fx_gate0",
                "referenceText": cur,
                "semanticFamilyId": semantic_family_id("fx_gate0", cur),
            },
            raw_actual_asr_text=cur,
            asr_segments=[],
            acoustic_tone_slices=[{"start": 0, "end": 0.1, "tonePosterior": {}, "confidence": 0}],
            asr_run_identity={"endpoint": "fixture"},
            lattice=fake,
        )
        self.assertEqual(out["evidenceSource"], "TEST_FIXTURE")
        report = evaluate_gate0([out])
        self.assertIn("NON_FORMAL_GATE0_EVIDENCE", report["semanticFailures"])
        self.assertFalse(report["acceptancePassed"])

    def test_injected_owner_execution_cannot_prove_model2(self):
        # Fixture with EXECUTED flags but no COMPLETED diagnostics → rejected as non-formal
        utt = {
            "evidenceSource": "TEST_FIXTURE",
            "lattice": {"evidenceSource": "TEST_FIXTURE", "pathCount": 1, "paths": []},
            "labeledPaths": [
                {"pathId": "p0", "pathIndex": 0, "spans": [_span(1)], "retainedDomains": []}
            ],
            "ownerExecution": {
                "MODEL2_ANCHOR_OWNER_EXECUTED": True,
                "MODEL2_ANCHOR_HOST_AVAILABLE": True,
                "DOMAIN_ANCHOR_OWNER_EXECUTED": True,
            },
            "ownerDiagnostics": {},
            "semanticFamilyId": "sf_x",
            "split": "train",
            "materializationRunId": "mr_x",
        }
        report = evaluate_gate0(
            [{"disposition": "SUPERVISED_ACCEPTED", "evidenceSource": "TEST_FIXTURE", "utt": utt}]
        )
        self.assertIn("NON_FORMAL_GATE0_EVIDENCE", report["semanticFailures"])


class TestModel2StatusSemantics(unittest.TestCase):
    def test_attempted_host_unavailable_blocked(self):
        diag = {
            "MODEL2_OWNER_WIRED": True,
            "MODEL2_OWNER_ATTEMPTED": True,
            "MODEL2_OWNER_COMPLETED": True,
            "MODEL2_HOST_AVAILABLE": False,
            "DOMAIN_OWNER_WIRED": True,
            "DOMAIN_OWNER_ATTEMPTED": True,
            "DOMAIN_OWNER_COMPLETED": True,
        }
        report = evaluate_gate0(
            [
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": _formal_utt(diag=diag),
                }
            ]
        )
        self.assertEqual(report["model2PathStatus"], "MODEL2_ANCHOR_PATH_NOT_VALIDATED")
        self.assertEqual(report["checkStatuses"]["model2_path"], BLOCKED)
        self.assertFalse(report["acceptancePassed"])
        self.assertTrue(report["checks"]["MODEL2_OWNER_ATTEMPTED"])
        self.assertTrue(report["checks"]["MODEL2_OWNER_COMPLETED"])
        self.assertFalse(report["checks"]["MODEL2_HOST_AVAILABLE_ANY"])

    def test_successful_owner_invocation_derived(self):
        report = evaluate_gate0(
            [
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": _formal_utt(),
                }
            ]
        )
        self.assertTrue(report["checks"]["MODEL2_OWNER_ATTEMPTED"])
        self.assertTrue(report["checks"]["MODEL2_OWNER_COMPLETED"])
        self.assertTrue(report["checks"]["MODEL2_HOST_AVAILABLE_ANY"])
        self.assertTrue(report["checks"]["DOMAIN_OWNER_COMPLETED"])
        self.assertIn(report["model2PathStatus"], ("PASS_OWNER_PARITY", "PASS_OWNER_PARITY_COVERAGE_WARNING_NO_HIT"))


class TestCandidateFailClosed(unittest.TestCase):
    def test_missing_candidate_hard_reject_extract(self):
        with self.assertRaises(CandidateStateError) as ctx:
            extract_first_pass_candidate_count({"packedInfer": {"surface": "x"}})
        self.assertEqual(ctx.exception.code, "RECALL_STATE_INVALID")

    def test_true_zero_candidate_valid(self):
        self.assertEqual(
            extract_first_pass_candidate_count(
                {
                    "recallEvidence": {"firstPassCandidateCount": 0},
                    "packedInfer": {"firstPassCandidateCount": 0},
                }
            ),
            0,
        )

    def test_serialize_missing_cand_fails(self):
        utt = {
            "semanticFamilyId": "sf",
            "materializationRunId": "mr",
            "split": "train",
            "model3CurrentText": "今",
            "referenceText": "今",
            "referenceId": "r",
            "labeledPaths": [
                {
                    "pathId": "p0",
                    "spans": [
                        {
                            "spanId": "s0",
                            "label": "KEEP",
                            "packedInfer": {"surface": "今"},  # missing count
                        }
                    ],
                }
            ],
        }
        with self.assertRaises(CandidateStateError):
            serialize_path_samples(utt)

    def test_materialize_missing_cand_hard_reject(self):
        cur = "你好"
        fake = {
            "ok": True,
            "currentText": cur,
            "model3CurrentText": cur,
            "referenceText": cur,
            "ownerExecution": {
                "DOMAIN_ANCHOR_OWNER_WIRED": True,
                "DOMAIN_ANCHOR_OWNER_EXECUTED": True,
                "MODEL2_ANCHOR_OWNER_WIRED": True,
                "MODEL2_ANCHOR_OWNER_EXECUTED": True,
            },
            "ownerDiagnostics": {
                "MODEL2_OWNER_WIRED": True,
                "MODEL2_OWNER_ATTEMPTED": True,
                "DOMAIN_OWNER_WIRED": True,
                "DOMAIN_OWNER_ATTEMPTED": True,
            },
            "paths": [
                {
                    "pathId": "p0",
                    "pathIndex": 0,
                    "spans": [
                        {
                            "spanId": "s0",
                            "surface": "你",
                            "rawStart": 0,
                            "rawEnd": 1,
                            "isAnchor": False,
                            "anchorSource": "NONE",
                            "toneReadiness": "ready",
                            "packedInfer": {"surface": "你"},
                            "referenceSurface": "你",
                        }
                    ],
                    "retainedDomains": [],
                }
            ],
        }
        out = materialize_utterance_from_parts(
            reference={
                "referenceId": "r_miss_cand",
                "referenceText": cur,
                "semanticFamilyId": semantic_family_id("r_miss_cand", cur),
            },
            raw_actual_asr_text=cur,
            asr_segments=[],
            acoustic_tone_slices=[{"start": 0, "end": 0.1, "tonePosterior": {}, "confidence": 0}],
            asr_run_identity={"endpoint": "x"},
            lattice=fake,
        )
        # Either HARD_REJECT on missing cand (if labeled KEEP/RETRY) or SEMANTIC_EXCLUDE
        if out["disposition"] == "SUPERVISED_ACCEPTED":
            self.fail("missing candidate must not serialize as accepted")
        if out["disposition"] == "HARD_REJECT":
            self.assertEqual(out["reject"]["code"], "RECALL_STATE_INVALID")


class TestToneReadinessFailClosed(unittest.TestCase):
    def test_harness_no_ready_fallback(self):
        text = HARNESS.read_text(encoding="utf-8")
        self.assertNotIn('readiness.state || "ready"', text)
        self.assertIn("RECALL_STATE_INVALID", text)
        self.assertIn("missing_tone_recall_readiness_state", text)


class TestMultipathEvidence(unittest.TestCase):
    def test_multipath_absent_not_exercised(self):
        report = evaluate_gate0(
            [
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": _formal_utt(path_count=1),
                }
            ]
        )
        self.assertEqual(report["checkStatuses"]["multipath_retention"], NOT_EXERCISED)

    def test_multipath_real_records_pass(self):
        paths = [
            {"pathId": "p0", "pathIndex": 0, "spans": [_span(1)], "retainedDomains": []},
            {"pathId": "p1", "pathIndex": 1, "spans": [_span(2)], "retainedDomains": []},
        ]
        report = evaluate_gate0(
            [
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": _formal_utt(paths=paths, path_count=2),
                }
            ]
        )
        self.assertEqual(report["checkStatuses"]["multipath_retention"], PASS)
        self.assertTrue(report["checks"]["MULTIPATH_EXERCISED_IN_BATCH"])


class TestPrimaryPathCollapseSensitivity(unittest.TestCase):
    def test_collapse_to_first_path_fails_multipath(self):
        paths = [
            {"pathId": "p0", "pathIndex": 0, "spans": [_span(1)], "retainedDomains": []},
            {"pathId": "p1", "pathIndex": 1, "spans": [_span(2)], "retainedDomains": []},
        ]
        utt = _formal_utt(paths=paths, path_count=2)
        ok = evaluate_gate0(
            [{"disposition": "SUPERVISED_ACCEPTED", "evidenceSource": FORMAL_EVIDENCE, "utt": utt}]
        )
        self.assertEqual(ok["checkStatuses"]["multipath_retention"], PASS)
        # Mutate: collapse paths
        utt2 = _formal_utt(paths=paths[:1], path_count=1)
        bad = evaluate_gate0(
            [{"disposition": "SUPERVISED_ACCEPTED", "evidenceSource": FORMAL_EVIDENCE, "utt": utt2}]
        )
        self.assertEqual(bad["checkStatuses"]["multipath_retention"], NOT_EXERCISED)


class TestCandForcedZeroSensitivity(unittest.TestCase):
    def test_forced_zero_changes_counts(self):
        utt = _formal_utt(
            paths=[{"pathId": "p0", "pathIndex": 0, "spans": [_span(3, label="RETRY")], "retainedDomains": []}]
        )
        good = evaluate_gate0(
            [{"disposition": "SUPERVISED_ACCEPTED", "evidenceSource": FORMAL_EVIDENCE, "utt": utt}]
        )
        self.assertTrue(good["checks"]["retry_cand_gt0_present"])
        forced = _formal_utt(
            paths=[{"pathId": "p0", "pathIndex": 0, "spans": [_span(0, label="RETRY")], "retainedDomains": []}]
        )
        bad = evaluate_gate0(
            [{"disposition": "SUPERVISED_ACCEPTED", "evidenceSource": FORMAL_EVIDENCE, "utt": forced}]
        )
        self.assertFalse(bad["checks"]["retry_cand_gt0_present"])
        self.assertTrue(bad["checks"]["cand_0_natural"])


class TestOwnerCallRemovalSensitivity(unittest.TestCase):
    def test_wired_requires_production_owner_call(self):
        text = HARNESS.read_text(encoding="utf-8")
        self.assertIn("await runLatticeFineSpanGenerationWithPreEdgeModel2", text)
        self.assertIn("voteUtteranceDomainFromPool(", text)
        report = evaluate_gate0([])
        self.assertTrue(report["checks"]["MODEL2_OWNER_WIRED"])
        self.assertTrue(report["checks"]["DOMAIN_OWNER_WIRED"])
        # Tautology guard: WIRED must not require flag-name substring alone
        from training.model3_dataset.acoustic_training import gate0 as g0

        self.assertTrue(g0._harness_wires_model2())
        # Removing call-site pattern would fail — simulate by checking regex independence
        self.assertNotIn(
            'return "runLatticeFineSpanGenerationWithPreEdgeModel2" in text and "MODEL2_ANCHOR_OWNER_WIRED" in text',
            Path(g0.__file__).read_text(encoding="utf-8"),
        )


class TestCandFlagsFromSpans(unittest.TestCase):
    def test_precomputed_booleans_ignored(self):
        utt = _formal_utt(
            paths=[{"pathId": "p0", "pathIndex": 0, "spans": [_span(0)], "retainedDomains": []}]
        )
        # Inject misleading precomputed flags on row — Gate0 must use span counts
        row = {
            "disposition": "SUPERVISED_ACCEPTED",
            "evidenceSource": FORMAL_EVIDENCE,
            "utt": utt,
            "cand_gt0_natural": True,
            "retry_cand_gt0_present": True,
        }
        report = evaluate_gate0([row])
        self.assertTrue(report["checks"]["cand_0_natural"])
        self.assertFalse(report["checks"]["cand_gt0_natural"])
        self.assertFalse(report["checks"]["retry_cand_gt0_present"])


class TestAnchorHistogram(unittest.TestCase):
    def test_anchor_hit_agrees_with_serialized_source(self):
        paths = [
            {
                "pathId": "p0",
                "pathIndex": 0,
                "spans": [
                    _span(1, anchor="MODEL2"),
                    _span(1, anchor="DOMAIN"),
                    _span(0),
                ],
                "retainedDomains": ["food"],
            }
        ]
        report = evaluate_gate0(
            [
                {
                    "disposition": "SUPERVISED_ACCEPTED",
                    "evidenceSource": FORMAL_EVIDENCE,
                    "utt": _formal_utt(paths=paths),
                }
            ]
        )
        hist = report["checks"]["anchorSourceHistogram"]
        self.assertGreaterEqual(hist.get("MODEL2", 0), 1)
        self.assertGreaterEqual(hist.get("DOMAIN", 0), 1)
        self.assertTrue(report["checks"]["MODEL2_HIT_OBSERVED"])
        self.assertTrue(report["checks"]["DOMAIN_ANCHOR_HIT_OBSERVED"])


class TestNearDupFamily(unittest.TestCase):
    def test_near_dup_key_respected(self):
        a = semantic_family_id("r1", "文本甲", near_dup_key="family_nd_1")
        b = semantic_family_id("r2", "文本乙", near_dup_key="family_nd_1")
        c = semantic_family_id("r1", "文本甲")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        out = materialize_utterance_from_parts(
            reference={
                "referenceId": "nd1",
                "referenceText": "文本甲",
                "near_dup_key": "family_nd_1",
            },
            raw_actual_asr_text="文本甲",
            asr_segments=[],
            acoustic_tone_slices=[{"start": 0, "end": 0.1, "tonePosterior": {}, "confidence": 0}],
            asr_run_identity={"endpoint": "x"},
            lattice={
                "ok": True,
                "currentText": "文本甲",
                "model3CurrentText": "文本甲",
                "referenceText": "文本甲",
                "ownerExecution": {
                    "DOMAIN_ANCHOR_OWNER_WIRED": True,
                    "DOMAIN_ANCHOR_OWNER_EXECUTED": True,
                    "MODEL2_ANCHOR_OWNER_WIRED": True,
                    "MODEL2_ANCHOR_OWNER_EXECUTED": True,
                },
                "ownerDiagnostics": {
                    "MODEL2_OWNER_WIRED": True,
                    "MODEL2_OWNER_ATTEMPTED": True,
                    "DOMAIN_OWNER_WIRED": True,
                    "DOMAIN_OWNER_ATTEMPTED": True,
                },
                "paths": [
                    {
                        "pathId": "p0",
                        "pathIndex": 0,
                        "spans": [
                            {
                                "spanId": "s0",
                                "surface": "文",
                                "rawStart": 0,
                                "rawEnd": 1,
                                "isAnchor": False,
                                "anchorSource": "NONE",
                                "recallEvidence": {"status": "AVAILABLE", "firstPassCandidateCount": 0},
                                "toneReadiness": "ready",
                                "packedInfer": {
                                    "surface": "文",
                                    "firstPassCandidateCount": 0,
                                    "pinyinChannelAvail": True,
                                    "recallFirstPassAvail": True,
                                },
                                "referenceSurface": "文",
                            }
                        ],
                        "retainedDomains": [],
                    }
                ],
            },
        )
        self.assertEqual(out["utt"]["semanticFamilyId"], a)
        self.assertEqual(out["utt"]["near_dup_key"], "family_nd_1")


class TestPackerReconstructionSensitivity(unittest.TestCase):
    def test_handcrafted_packed_without_cand_rejected(self):
        with self.assertRaises(CandidateStateError):
            serialize_path_samples(
                {
                    "semanticFamilyId": "sf",
                    "materializationRunId": "mr",
                    "split": "train",
                    "model3CurrentText": "a",
                    "referenceText": "a",
                    "referenceId": "r",
                    "labeledPaths": [
                        {
                            "pathId": "p0",
                            "spans": [{"spanId": "s0", "label": "KEEP", "packedInfer": {}}],
                        }
                    ],
                }
            )


class TestFormalPathBoundedIntegration(unittest.TestCase):
    def test_formal_harness_owner_diagnostics(self):
        if not ELECTRON.exists():
            self.skipTest("electron binary unavailable")
        env = os.environ.copy()
        env["MODEL2_RUNTIME_DISABLED"] = "1"
        env["ELECTRON_RUN_AS_NODE"] = "1"
        env["PROJECT_ROOT"] = str(REPO)
        req = {
            "id": "formal_bound_1",
            "referenceText": "今天天气不错",
            "rawActualAsrText": "今天天气不错",
            "acousticToneSlices": [
                {"start": 0.0, "end": 0.2, "tonePosterior": {"1": 0.5}, "confidence": 0.5},
                {"start": 0.2, "end": 0.4, "tonePosterior": {"1": 0.5}, "confidence": 0.5},
                {"start": 0.4, "end": 0.6, "tonePosterior": {"1": 0.5}, "confidence": 0.5},
                {"start": 0.6, "end": 0.8, "tonePosterior": {"1": 0.5}, "confidence": 0.5},
            ],
            "asrSegments": [],
            "userProfile": None,
        }
        # Use orchestrator batch helper but with disabled Model2 via env in subprocess —
        # run_formal_lattice_batch copies os.environ; set before call.
        old = os.environ.get("MODEL2_RUNTIME_DISABLED")
        os.environ["MODEL2_RUNTIME_DISABLED"] = "1"
        try:
            outs, _ = run_formal_lattice_batch([req])
        finally:
            if old is None:
                os.environ.pop("MODEL2_RUNTIME_DISABLED", None)
            else:
                os.environ["MODEL2_RUNTIME_DISABLED"] = old
        self.assertTrue(outs, "formal harness produced no JSON")
        mat = outs[0]
        self.assertEqual(mat.get("evidenceSource"), FORMAL_EVIDENCE)
        diag = mat.get("ownerDiagnostics") or {}
        self.assertTrue(diag.get("MODEL2_OWNER_ATTEMPTED"))
        # With runtime disabled: completed (returned) + host unavailable is truthful
        self.assertTrue(diag.get("MODEL2_OWNER_COMPLETED") or not diag.get("MODEL2_HOST_AVAILABLE"))
        self.assertTrue(diag.get("DOMAIN_OWNER_ATTEMPTED"))
        self.assertTrue(diag.get("DOMAIN_OWNER_COMPLETED"))
        self.assertIn("packModel3SpanInferFields", str((mat.get("reused") or {}).get("packer")))
        # Gate0 on this single formal row: may BLOCK on host unavailable — not soft PASS
        row = {
            "disposition": "SUPERVISED_ACCEPTED",
            "evidenceSource": FORMAL_EVIDENCE,
            "utt": {
                "evidenceSource": FORMAL_EVIDENCE,
                "semanticFamilyId": "sf_bound",
                "materializationRunId": "mr_bound",
                "split": "train",
                "lattice": mat,
                "labeledPaths": mat.get("paths") or [],
                "ownerDiagnostics": diag,
            },
        }
        # Label paths lightly for cand derivation
        for p in row["utt"]["labeledPaths"]:
            for sp in p.get("spans") or []:
                sp.setdefault("label", "KEEP")
        report = evaluate_gate0([row])
        self.assertNotIn("NON_FORMAL_GATE0_EVIDENCE", report["semanticFailures"])
        if not diag.get("MODEL2_HOST_AVAILABLE"):
            self.assertEqual(report["model2PathStatus"], "MODEL2_ANCHOR_PATH_NOT_VALIDATED")


if __name__ == "__main__":
    unittest.main()
