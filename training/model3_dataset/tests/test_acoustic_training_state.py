# -*- coding: utf-8 -*-
"""Focused tests for Model3 V2 acoustic training-state formal pipeline."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np

from training.model3_dataset.acoustic_training.family_identity import (
    assert_split_locked,
    assign_split,
    materialization_run_id,
    semantic_family_id,
)
from training.model3_dataset.acoustic_training.gate0 import evaluate_gate0
from training.model3_dataset.acoustic_training.holdout_registry import (
    PROTECTED_CASE_IDS,
    check_holdout,
    ensure_registry_file,
)
from training.model3_dataset.acoustic_training.orchestrator import (
    HARNESS,
    LEGACY_PROBE_HARNESS,
    materialize_utterance_from_parts,
)
from training.model3_dataset.acoustic_training.pcm_encode import (
    _float_audio_to_pcm16,
    wav_bytes_pcm16,
)
from training.model3_dataset.acoustic_training.provenance import (
    classify_supervised_outcome,
    validate_text_identity,
)
from training.model3_dataset.scripts.stage2_v2_label import label_spans_v2

REPO = Path(__file__).resolve().parents[3]


class TestPcmEncode(unittest.TestCase):
    def test_nonzero_float_to_pcm(self):
        audio = np.linspace(-0.5, 0.5, 1600, dtype=np.float32)
        pcm = _float_audio_to_pcm16(audio)
        self.assertGreater(int(np.max(np.abs(pcm))), 0)
        wav = wav_bytes_pcm16(audio, 16000)
        self.assertGreater(len(wav), 44)


class TestFamilySplit(unittest.TestCase):
    def test_semantic_family_stable_across_runs(self):
        fam = semantic_family_id("r1", "今天天气不错")
        run_a = materialization_run_id(
            semantic_family_id_value=fam,
            audio_asset_id="a1",
            asr_run_identity={"latency_ms": 1},
            tone_run_identity={"sliceCount": 3},
        )
        run_b = materialization_run_id(
            semantic_family_id_value=fam,
            audio_asset_id="a2",
            asr_run_identity={"latency_ms": 9},
            tone_run_identity={"sliceCount": 4},
        )
        self.assertNotEqual(run_a, run_b)
        self.assertEqual(assign_split(fam), assign_split(fam))
        rows = [
            {"semanticFamilyId": fam, "split": assign_split(fam), "materializationRunId": run_a},
            {"semanticFamilyId": fam, "split": assign_split(fam), "materializationRunId": run_b},
        ]
        self.assertEqual(assert_split_locked(rows), [])

    def test_family_does_not_include_run_identity(self):
        a = semantic_family_id("r1", "你好世界")
        b = semantic_family_id("r1", "你好世界")
        self.assertEqual(a, b)
        # different references → different families
        c = semantic_family_id("r2", "另一句")
        self.assertNotEqual(a, c)


class TestHoldout(unittest.TestCase):
    def test_protected_id_hard_reject(self):
        ensure_registry_file()
        pid = next(iter(PROTECTED_CASE_IDS))
        hit = check_holdout(reference_id=pid, reference_text="任意")
        self.assertIsNotNone(hit)
        self.assertEqual(hit["code"], "PROTECTED_HOLDOUT_COLLISION")
        self.assertEqual(hit["kind"], "HARD_REJECT")


class TestTextIdentity(unittest.TestCase):
    def test_open_cc_diff_allowed_when_harness_matches_model3(self):
        # raw traditional vs simplified current — OK if model3==harness
        err = validate_text_identity(
            raw_actual_asr_text="醫生您好",
            model3_current_text="医生您好",
            harness_current_text="医生您好",
        )
        self.assertIsNone(err)

    def test_mismatch_harness_hard_reject(self):
        err = validate_text_identity(
            raw_actual_asr_text="abc",
            model3_current_text="医生您好",
            harness_current_text="别的文本",
        )
        self.assertIsNotNone(err)
        self.assertEqual(err["code"], "MODEL3_CURRENT_TEXT_IDENTITY_INVALID")


class TestSemanticExclude(unittest.TestCase):
    def test_no_repairable_target(self):
        # identical ref/current → all KEEP or empty regions; craft EXCLUDE-only via labeler path
        mat = {
            "currentText": "你好",
            "referenceText": "你好",
            "spans": [
                {
                    "spanId": "s0",
                    "surface": "你",
                    "rawStart": 0,
                    "rawEnd": 1,
                    "isAnchor": False,
                    "anchorSource": "NONE",
                    "referenceSurface": "你",
                    "repairability": {"referenceReachable": "UNKNOWN"},
                }
            ],
            "corruptions": [],
        }
        labeled, stats, _ = label_spans_v2(mat)
        # When identical, KEEP expected — force semantic exclude classifier with empty KEEP/RETRY
        forced = [
            {
                "pathId": "p0",
                "spans": [
                    {
                        **labeled[0],
                        "label": "EXCLUDE_FROM_SUPERVISED",
                        "targetMask": 0,
                    }
                ],
            }
        ]
        out = classify_supervised_outcome(forced)
        self.assertEqual(out["kind"], "SEMANTIC_EXCLUDE")
        self.assertEqual(out["code"], "NO_REPAIRABLE_TARGET")


class TestHarnessWiring(unittest.TestCase):
    def test_formal_harness_wires_model2_and_domain(self):
        self.assertTrue(HARNESS.exists())
        text = HARNESS.read_text(encoding="utf-8")
        self.assertIn("runLatticeFineSpanGenerationWithPreEdgeModel2", text)
        self.assertIn("voteUtteranceDomainFromPool", text)
        self.assertIn("materializeModel3Anchors", text)
        self.assertIn("packModel3SpanInferFields", text)
        self.assertIn("normalizeForFwRepairInput", text)
        self.assertIn("await runLatticeFineSpanGenerationWithPreEdgeModel2", text)
        self.assertIn("ownerDiagnostics", text)

    def test_legacy_probe_redirect_comment_or_formal_preferred(self):
        # Formal owner must exist; legacy probe harness must not be the only owner.
        self.assertTrue(HARNESS.exists())
        self.assertTrue(LEGACY_PROBE_HARNESS.exists())


class TestMaterializeOfflineFixture(unittest.TestCase):
    """Provenance path with injected lattice (no live Model2 host hang)."""

    def test_injected_lattice_supervises_or_excludes(self):
        ref_text = "今天天气不错"
        cur = "今天天气不错"
        fam = semantic_family_id("fixture_ref_001", ref_text)
        fake_lattice = {
            "ok": True,
            "harness": "acoustic_b2_formal_materialize.cjs",
            "rawActualAsrText": cur,
            "model3CurrentText": cur,
            "currentText": cur,
            "referenceText": ref_text,
            "model2AnchorStatus": "UNAVAILABLE",
            "ownerExecution": {
                "DOMAIN_ANCHOR_OWNER_WIRED": True,
                "DOMAIN_ANCHOR_OWNER_EXECUTED": True,
                "DOMAIN_ANCHOR_HIT_OBSERVED": False,
                "MODEL2_ANCHOR_OWNER_WIRED": True,
                "MODEL2_ANCHOR_OWNER_EXECUTED": True,
                "MODEL2_ANCHOR_HOST_AVAILABLE": False,
                "MODEL2_ANCHOR_HIT_OBSERVED": False,
            },
            "domainEvidence": {
                "retainedDomains": [],
                "anchorMaterialization": "RUNTIME_CONFIRMED",
            },
            "featureAvailability": {
                "textContext": True,
                "pinyinTextDerived": True,
                "toneAcoustic": True,
                "asrConfidence": False,
                "model2Pronunciation": False,
                "recallFirstPass": True,
            },
            "pathCount": 1,
            "paths": [
                {
                    "pathId": "p0",
                    "pathIndex": 0,
                    "retainedDomains": [],
                    "spans": [
                        {
                            "spanId": "s0",
                            "surface": "今",
                            "rawStart": 0,
                            "rawEnd": 1,
                            "syllableStart": 0,
                            "syllableEnd": 1,
                            "seqIndex": 0,
                            "isAnchor": False,
                            "anchorSource": "NONE",
                            "recallEvidence": {"status": "AVAILABLE", "firstPassCandidateCount": 0},
                            "toneReadiness": "ready",
                            "packedInfer": {
                                "surface": "今",
                                "firstPassCandidateCount": 0,
                                "pinyinChannelAvail": True,
                                "recallFirstPassAvail": True,
                            },
                            "referenceSurface": "今",
                            "repairability": {"referenceReachable": "UNKNOWN"},
                        }
                    ],
                }
            ],
            "reused": {"anchor": "materializeModel3Anchors", "model2": "expandWindowsWithModel2"},
        }
        ref = {
            "referenceId": "fixture_ref_001",
            "referenceText": ref_text,
            "sourcePoolId": "unit_fixture",
            "sourceCorpus": "unit_fixture",
            "semanticFamilyId": fam,
        }
        out = materialize_utterance_from_parts(
            reference=ref,
            raw_actual_asr_text=cur,
            asr_segments=[],
            acoustic_tone_slices=[{"start": 0, "end": 0.1, "tonePosterior": {}, "confidence": 0}],
            audio_meta={"audioAssetId": "fixture://a", "evidenceLevel": "TTS_ASR"},
            asr_run_identity={"endpoint": "fixture"},
            lattice=fake_lattice,
        )
        self.assertIn(out["disposition"], ("SUPERVISED_ACCEPTED", "SEMANTIC_EXCLUDE"))
        utt = out["utt"]
        self.assertEqual(utt["model3CurrentText"], cur)
        self.assertEqual(out["evidenceSource"], "TEST_FIXTURE")
        self.assertEqual(utt["evidenceSource"], "TEST_FIXTURE")
        self.assertTrue(utt["ownerExecution"]["MODEL2_ANCHOR_OWNER_EXECUTED"])
        self.assertTrue(utt["ownerExecution"]["DOMAIN_ANCHOR_OWNER_EXECUTED"])
        # Fixture evidence must not unlock Gate0 acceptance
        g0 = evaluate_gate0([out])
        self.assertIn("NON_FORMAL_GATE0_EVIDENCE", g0["semanticFailures"])
        # Two materialization runs → same family/split
        out2 = materialize_utterance_from_parts(
            reference=ref,
            raw_actual_asr_text=cur,
            asr_segments=[],
            acoustic_tone_slices=[{"start": 0, "end": 0.1, "tonePosterior": {}, "confidence": 0}],
            audio_meta={"audioAssetId": "fixture://b", "evidenceLevel": "TTS_ASR"},
            asr_run_identity={"endpoint": "fixture", "latency_ms": 99},
            lattice=fake_lattice,
        )
        self.assertEqual(out["utt"]["semanticFamilyId"], out2["utt"]["semanticFamilyId"])
        self.assertEqual(out["utt"]["split"], out2["utt"]["split"])
        self.assertNotEqual(out["utt"]["materializationRunId"], out2["utt"]["materializationRunId"])


class TestAnchorOwnerSkipReject(unittest.TestCase):
    def test_model2_not_executed_is_hard_reject(self):
        cur = "你好"
        fake = {
            "ok": True,
            "currentText": cur,
            "model3CurrentText": cur,
            "referenceText": cur,
            "model2AnchorStatus": "UNAVAILABLE",
            "ownerExecution": {
                "DOMAIN_ANCHOR_OWNER_WIRED": True,
                "DOMAIN_ANCHOR_OWNER_EXECUTED": True,
                "MODEL2_ANCHOR_OWNER_WIRED": True,
                "MODEL2_ANCHOR_OWNER_EXECUTED": False,
                "MODEL2_ANCHOR_HOST_AVAILABLE": False,
            },
            "pathCount": 1,
            "paths": [{"pathId": "p0", "pathIndex": 0, "spans": [], "retainedDomains": []}],
            "reused": {},
        }
        out = materialize_utterance_from_parts(
            reference={
                "referenceId": "r_skip",
                "referenceText": cur,
                "semanticFamilyId": semantic_family_id("r_skip", cur),
            },
            raw_actual_asr_text=cur,
            asr_segments=[],
            acoustic_tone_slices=[{"start": 0, "end": 0.1, "tonePosterior": {}, "confidence": 0}],
            asr_run_identity={"endpoint": "x"},
            lattice=fake,
        )
        self.assertEqual(out["disposition"], "HARD_REJECT")
        self.assertEqual(out["reject"]["code"], "ANCHOR_MATERIALIZATION_BLOCKED")


class TestHoldoutInMaterialize(unittest.TestCase):
    def test_protected_rejected_before_lattice(self):
        pid = next(iter(PROTECTED_CASE_IDS))
        out = materialize_utterance_from_parts(
            reference={
                "referenceId": pid,
                "referenceText": "x",
                "semanticFamilyId": semantic_family_id(pid, "x"),
            },
            raw_actual_asr_text="x",
            asr_segments=[],
            acoustic_tone_slices=[{"start": 0, "end": 0.1, "tonePosterior": {}, "confidence": 0}],
        )
        self.assertEqual(out["disposition"], "HARD_REJECT")
        self.assertEqual(out["reject"]["code"], "PROTECTED_HOLDOUT_COLLISION")


class TestGate0Checker(unittest.TestCase):
    def test_evaluate_structure(self):
        report = evaluate_gate0([])
        self.assertEqual(report["gate0Id"], "MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0")
        self.assertTrue(report["checks"]["MODEL2_ANCHOR_OWNER_WIRED"])
        self.assertTrue(report["checks"]["DOMAIN_ANCHOR_OWNER_WIRED"])
        # Empty batch must not soft-PASS acceptance
        self.assertEqual(report["acceptanceVerdict"], "INSUFFICIENT_EVIDENCE")
        self.assertFalse(report["acceptancePassed"])
        self.assertEqual(report["checkStatuses"]["semantic_exclude_distinguished"], "NOT_EXERCISED")


if __name__ == "__main__":
    unittest.main()
