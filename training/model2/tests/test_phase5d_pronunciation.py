"""Phase 5D pronunciation corruption unit tests (offline)."""

from __future__ import annotations

import unittest

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.export.training_sample import TrainingSourceType
from training.model2.pronunciation.behaviour import (
    STRENGTH_TO_PROB,
    build_pronunciation_users,
    should_apply_corruption,
)
from training.model2.pronunciation.corruptor import PronunciationCorruptorV1
from training.model2.pronunciation.syllable_substitution import (
    apply_family_to_syllable,
    corrupt_syllable_sequence,
    parse_syllable,
)
from training.model2.pronunciation.tts_surface_resolver import (
    candidates_for_syllable,
    pick_deterministic,
    resolve_sequence,
)


class TestSyllableCorruption(unittest.TestCase):
    def test_tone_preserved_n_l(self):
        self.assertEqual(apply_family_to_syllable("nai3", "n_l"), "lai3")
        self.assertEqual(apply_family_to_syllable("nan2", "n_l"), "lan2")

    def test_l_n(self):
        self.assertEqual(apply_family_to_syllable("lan2", "l_n"), "nan2")

    def test_zh_z(self):
        self.assertEqual(apply_family_to_syllable("zhi1", "zh_z"), "zi1")
        self.assertEqual(apply_family_to_syllable("zi1", "z_zh"), "zhi1")

    def test_an_ang(self):
        self.assertEqual(apply_family_to_syllable("ban1", "an_ang"), "bang1")
        self.assertEqual(apply_family_to_syllable("bang1", "ang_an"), "ban1")

    def test_en_eng(self):
        self.assertEqual(apply_family_to_syllable("gen1", "en_eng"), "geng1")

    def test_in_ing(self):
        self.assertEqual(apply_family_to_syllable("jin1", "in_ing"), "jing1")

    def test_not_applicable(self):
        self.assertIsNone(apply_family_to_syllable("ban1", "n_l"))

    def test_sequence_max_positions(self):
        out, idxs = corrupt_syllable_sequence(["nan2", "ning2"], "n_l", max_positions=1)
        self.assertEqual(len(idxs), 1)
        self.assertEqual(out[0], "lan2")
        self.assertEqual(out[1], "ning2")


class TestResolver(unittest.TestCase):
    def test_deterministic_pick(self):
        cands = ["甲", "乙", "丙", "丁"]
        a = pick_deterministic("xx1", cands, seed=1)
        b = pick_deterministic("xx1", cands, seed=1)
        self.assertEqual(a, b)

    def test_no_candidate(self):
        surface, method, missing = resolve_sequence(["zzqz9"], {}, {})
        self.assertIsNone(surface)
        self.assertEqual(method, "UNREALIZABLE")
        self.assertTrue(missing)


class TestCorruptor(unittest.TestCase):
    def test_gt_differs_from_tts_when_realized(self):
        c = PronunciationCorruptorV1()
        # 南宁 nan2 ning2 → n_l → lan2 ling2; 兰/灵 should exist
        plan = c.corrupt(
            ground_truth_text="我想去南宁旅游",
            ground_truth_term="南宁",
            family="n_l",
        )
        if plan.realizable:
            self.assertNotEqual(plan.ground_truth_text, plan.tts_input_text)
            self.assertIn(plan.tts_surface, plan.tts_input_text)
            self.assertNotIn("南宁", plan.tts_input_text)  # replaced
        else:
            # Document unrealizable cleanly
            self.assertTrue(plan.unrealizable_reason)

    def test_unsupported_family(self):
        c = PronunciationCorruptorV1()
        plan = c.corrupt(
            ground_truth_text="测试",
            ground_truth_term="测试",
            family="tone_1_2",
        )
        self.assertFalse(plan.realizable)
        self.assertEqual(plan.tts_surface_resolution_method, "UNSUPPORTED_FOR_PROFILE_V1")


class TestUserConsistency(unittest.TestCase):
    def test_same_seed_same_users(self):
        a = build_pronunciation_users(n_users=10, n_neutral=2, seed=42)
        b = build_pronunciation_users(n_users=10, n_neutral=2, seed=42)
        self.assertEqual([u.to_dict() for u in a], [u.to_dict() for u in b])

    def test_bernoulli_deterministic(self):
        users = build_pronunciation_users(n_users=5, n_neutral=0, seed=7)
        u = next(x for x in users if x.family_prob)
        fam = next(iter(u.family_prob))
        a = should_apply_corruption(user=u, family=fam, sample_plan_id="p1", seed=7)
        b = should_apply_corruption(user=u, family=fam, sample_plan_id="p1", seed=7)
        self.assertEqual(a, b)

    def test_strength_probs(self):
        self.assertEqual(STRENGTH_TO_PROB["HIGH"], 0.8)
        self.assertEqual(STRENGTH_TO_PROB["LOW"], 0.2)


class TestProvenance(unittest.TestCase):
    def test_new_source_type(self):
        self.assertEqual(
            TrainingSourceType.TTS_PRONUNCIATION_CORRUPTED.value,
            "TTS_PRONUNCIATION_CORRUPTED",
        )
        self.assertNotEqual(
            TrainingSourceType.TTS_PRONUNCIATION_CORRUPTED,
            TrainingSourceType.TTS_ASR_SYNTHETIC,
        )
        self.assertNotEqual(
            TrainingSourceType.TTS_PRONUNCIATION_CORRUPTED,
            TrainingSourceType.RULE_SYNTHETIC,
        )

    def test_schema_families_cover_sixteen(self):
        self.assertEqual(len(PHONETIC_FEATURE_KEYS), 16)


if __name__ == "__main__":
    unittest.main()
