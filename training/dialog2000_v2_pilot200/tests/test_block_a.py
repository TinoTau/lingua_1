# -*- coding: utf-8 -*-
"""Block A unit tests — dataset validity only (no Model2 scores)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from training.dialog2000_v2_pilot200.allocation_loader import load_allocation
from training.dialog2000_v2_pilot200.constants import (
    ACTIVE_RELATIONS,
    DATASET_ID,
    FORBIDDEN_CASE_FIELDS,
    MASTER_SEED,
    USER_ASSIGNMENTS,
)
from training.dialog2000_v2_pilot200.lexicon_readonly import ReadonlyLexicon
from training.dialog2000_v2_pilot200.profile_builder import build_user_profiles, pick_wrong_user
from training.dialog2000_v2_pilot200.profile_delta_offline import apply_profile_delta, empty_user_profile
from training.dialog2000_v2_pilot200.term_banks import TERM_BANKS, assert_disjoint
from training.dialog2000_v2_pilot200.validators import validate_all

REPO = Path(__file__).resolve().parents[3]
ALLOC = (
    REPO
    / "docs"
    / "user_correction"
    / "model3"
    / "LINGUA_DIALOG2000_V2_PILOT200_Case_Allocation.csv"
)
LEX = REPO / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"


class BlockATests(unittest.TestCase):
    def test_allocation_sums(self):
        slots = load_allocation(ALLOC)
        self.assertEqual(len(slots), 200)
        from collections import Counter

        u = Counter(s.user_id for s in slots)
        sp = Counter(s.split for s in slots)
        cl = Counter(s.case_class for s in slots)
        for uid in USER_ASSIGNMENTS:
            self.assertEqual(u[uid], 40)
        self.assertEqual(sp["DEV"], 120)
        self.assertEqual(sp["VALIDATION"], 60)
        self.assertEqual(sp["HOLDOUT"], 20)
        self.assertGreaterEqual(cl["CLEAN_PRESERVE"], 40)

    def test_term_banks_disjoint(self):
        assert_disjoint()
        for fam in ACTIVE_RELATIONS:
            self.assertIn(fam, TERM_BANKS)
            self.assertTrue(TERM_BANKS[fam]["build"])
            self.assertTrue(TERM_BANKS[fam]["eval"])

    def test_forbidden_fields_rejected_conceptually(self):
        case = {"caseId": "p2_u001_001", "expectedBehaviorClass": "CLEAN_PRESERVE"}
        for f in FORBIDDEN_CASE_FIELDS:
            self.assertNotIn(f, case)

    def test_invalid_relation_rejected_by_active_set(self):
        self.assertNotIn("tone_bias", ACTIVE_RELATIONS)
        self.assertNotIn("an_ang", ACTIVE_RELATIONS)

    def test_wrong_profile_shared_relation_rejected(self):
        # U001 target n_l must not pick U004 (also has n_l)
        w = pick_wrong_user("U001", "n_l")
        self.assertIsNotNone(w)
        self.assertNotIn("n_l", USER_ASSIGNMENTS[w])

    def test_profile_delta_ema_not_magic_float(self):
        p = empty_user_profile()
        p = apply_profile_delta(
            p,
            source_event_id="e1",
            phonetic_updates=[{"feature_key": "n_l", "evidence": 1.0, "weight": 0.7}],
        )
        self.assertGreater(p["phonetic_bias"]["n_l"], 0)
        self.assertEqual(p["profile_version"], 1)

    def test_relation_generalization_structure(self):
        packs = build_user_profiles()
        u = packs["U001"]
        build_surf = set(u["profiles"]["P2"]["profileBuildSurfaces"])
        eval_pool = set(TERM_BANKS["n_l"]["eval"])
        self.assertTrue(build_surf)
        self.assertTrue(eval_pool)
        self.assertEqual(build_surf & eval_pool, set())
        # same relation present
        self.assertIn("n_l", u["profiles"]["P2"]["userProfileV1"]["phonetic_bias"])

    def test_lexical_overlap_fails_validator(self):
        cases = [
            {
                "caseId": "p2_u001_001",
                "userId": "U001",
                "split": "DEV",
                "domain": "general_daily",
                "expectedBehaviorClass": "PROFILE_TARGET",
                "relationFamily": "n_l",
                "profileBuildTermIds": ["t1"],
                "evaluationTargetTermIds": ["t1"],
                "referenceText": "x",
                "audioId": "a",
                "audioIdentity": {
                    "audioId": "a",
                    "byte_size": 1,
                    "sha256": "abc",
                    "sample_rate": 16000,
                    "channels": 1,
                    "duration": 0.1,
                },
                "profileStage": "P1",
            }
        ]
        # pad to avoid count gates dominating — we only check isolation gate
        manifest = {
            "dataset_id": DATASET_ID,
            "version": "V1",
            "build_id": "x",
            "generator_version": "v",
            "seed": MASTER_SEED,
            "case_count": 200,
            "relation_distribution": {},
            "domain_distribution": {},
            "profile_distribution": {},
            "split_distribution": {},
            "voice_distribution": {},
            "user_assignment": USER_ASSIGNMENTS,
        }
        # Not full 200 — isolation should still FAIL
        v = validate_all(cases=cases, manifest=manifest, profiles_by_user={})
        iso = [g for g in v["gates"] if g["gate"] == "PROFILE_LEXICAL_ISOLATION_PASS"][0]
        self.assertEqual(iso["status"], "FAIL")

    def test_lexicon_readonly(self):
        if not LEX.is_file():
            self.skipTest("lexicon missing")
        lex = ReadonlyLexicon(LEX)
        self.assertTrue(lex.mutation_attempt_blocked())
        lex.close()

    def test_seed_deterministic_assignment(self):
        from training.dialog2000_v2_pilot200.build import materialize_cases
        from training.dialog2000_v2_pilot200.term_bank_runtime import load_term_banks

        slots = load_allocation(ALLOC)
        banks = load_term_banks()
        packs = build_user_profiles(build_banks=banks["build"])
        a = materialize_cases(
            slots=slots,
            profiles_by_user=packs,
            lex=None,
            master_seed=MASTER_SEED,
            eval_banks=banks["eval"],
        )
        b = materialize_cases(
            slots=slots,
            profiles_by_user=packs,
            lex=None,
            master_seed=MASTER_SEED,
            eval_banks=banks["eval"],
        )
        self.assertEqual([c["referenceText"] for c in a], [c["referenceText"] for c in b])
        self.assertEqual([c["caseId"] for c in a], [c["caseId"] for c in b])
        self.assertEqual(len(a), 200)
        m2 = [c for c in a if c.get("isModel2TargetCase")]
        # Without lex object, targetInLexicon is None — eligibility requires lex at build time
        self.assertGreater(len(m2), 100)


if __name__ == "__main__":
    unittest.main()
