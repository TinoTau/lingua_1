"""Phase 5E unit tests."""

from __future__ import annotations

import unittest

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable
from training.model2.pronunciation.seed_cases import build_seed_cases
from training.model2.pronunciation.transform_engine import PronunciationTransformEngineV1
from training.model2.pronunciation.espeak_cmn import swap_initial_in_espeak, apply_family_to_espeak


class TestPronunciationSyllable(unittest.TestCase):
    def test_decompose_nai3(self):
        s = PronunciationSyllable.from_compact("nai3")
        self.assertEqual(s.initial, "n")
        self.assertEqual(s.final, "ai")
        self.assertEqual(s.tone, 3)


class TestTransformEngine(unittest.TestCase):
    def setUp(self):
        self.eng = PronunciationTransformEngineV1()

    def test_n_l_preserves_tone_allows_nonlexical(self):
        s = PronunciationSyllable.from_compact("nai3")
        tr = self.eng.transform(s, "n_l")
        self.assertTrue(tr.applied)
        self.assertEqual(tr.corrupted.initial, "l")
        self.assertEqual(tr.corrupted.final, "ai")
        self.assertEqual(tr.corrupted.tone, 3)
        self.assertEqual(tr.corrupted.compact, "lai3")

    def test_not_string_search(self):
        s = PronunciationSyllable.from_compact("ban1")
        tr = self.eng.transform(s, "n_l")
        self.assertFalse(tr.applied)

    def test_an_ang(self):
        s = PronunciationSyllable.from_compact("ban1")
        tr = self.eng.transform(s, "an_ang")
        self.assertEqual(tr.corrupted.compact, "bang1")

    def test_all_16_families_supported(self):
        for fam in PHONETIC_FEATURE_KEYS:
            src = fam.split("_", 1)[0]
            if fam in ("n_l", "l_n", "zh_z", "z_zh", "ch_c", "c_ch", "sh_s", "s_sh", "f_h", "h_f"):
                s = PronunciationSyllable(initial=src, final="a", tone=1)
            else:
                s = PronunciationSyllable(initial="b", final=src, tone=1)
            self.assertTrue(self.eng.applicable(s, fam), fam)


class TestEspeakSwap(unittest.TestCase):
    def test_nai_to_lai_phonemes(self):
        nai = ["n", "ˈ", "a", "i", "2"]
        lai = swap_initial_in_espeak(nai, "l")
        self.assertEqual(lai, ["l", "ˈ", "a", "i", "2"])
        s = PronunciationSyllable.from_compact("nai3")
        out = apply_family_to_espeak(nai, "n_l", s)
        self.assertEqual(out[0], "l")


class TestSeeds(unittest.TestCase):
    def test_64_and_all_families(self):
        rows = build_seed_cases()
        self.assertGreaterEqual(len(rows), 64)
        fams = {r["confusion_family"] for r in rows}
        self.assertEqual(fams, set(PHONETIC_FEATURE_KEYS))


if __name__ == "__main__":
    unittest.main()
