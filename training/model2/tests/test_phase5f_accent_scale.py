"""Phase 5F unit tests — users, monotonicity helpers, eligibility classes."""

from __future__ import annotations

import unittest

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.pronunciation.behaviour import STRENGTH_TO_PROB
from training.model2.pronunciation.scale_users import build_scale_accent_users


def _monotonic(vals):
    return all(vals[i] >= vals[i + 1] - 1e-9 for i in range(len(vals) - 1))


def _classify_fidelity(m):
    base = m.get("base_realization_rate", 0)
    asr = m.get("asr_effect_rate", 0)
    assoc = m.get("associated_positive_rate", 0)
    score = 0.4 * base + 0.3 * asr + 0.3 * assoc
    if score >= 0.55 and base >= 0.4 and asr >= 0.35:
        return "GOOD"
    if score >= 0.35 and (base >= 0.25 or asr >= 0.3):
        return "USABLE"
    if score >= 0.2:
        return "WEAK"
    return "UNUSABLE"


def _supervision_label(fid, mono_ok, binary_ok):
    if fid in ("GOOD", "USABLE") and mono_ok:
        return "TRAINABLE_CONTINUOUS"
    if fid in ("GOOD", "USABLE", "WEAK") and binary_ok:
        return "TRAINABLE_BINARY"
    if fid == "WEAK":
        return "WEAK"
    return "DEFER"


class TestScaleUsers(unittest.TestCase):
    def test_mix_and_coverage(self):
        users = build_scale_accent_users(seed=42, n_total=200)
        kinds = {}
        for u in users:
            kinds[u.user_kind] = kinds.get(u.user_kind, 0) + 1
        self.assertGreaterEqual(kinds.get("neutral", 0), 15)
        self.assertGreaterEqual(kinds.get("single", 0), 48)
        self.assertGreaterEqual(kinds.get("multi", 0), 50)
        # each family has LOW/MED/HIGH single
        covered = {(u.primary_family, u.primary_strength) for u in users if u.user_kind == "single"}
        for fam in PHONETIC_FEATURE_KEYS:
            for st in ("LOW", "MEDIUM", "HIGH"):
                self.assertIn((fam, st), covered)

    def test_user_disjoint_splits(self):
        users = build_scale_accent_users(seed=7, n_total=100)
        by_user = {}
        for u in users:
            by_user.setdefault(u.profile.pseudo_user_id, set()).add(u.split)
        for uid, splits in by_user.items():
            self.assertEqual(len(splits), 1, uid)

    def test_deterministic(self):
        a = [u.to_dict() for u in build_scale_accent_users(seed=1, n_total=80)]
        b = [u.to_dict() for u in build_scale_accent_users(seed=1, n_total=80)]
        self.assertEqual(a, b)


class TestCalibrationHelpers(unittest.TestCase):
    def test_monotonic(self):
        self.assertTrue(_monotonic([0.8, 0.5, 0.2]))
        self.assertFalse(_monotonic([0.2, 0.5, 0.8]))

    def test_fidelity_and_supervision(self):
        good = _classify_fidelity(
            {"base_realization_rate": 0.6, "asr_effect_rate": 0.5, "associated_positive_rate": 0.55}
        )
        self.assertEqual(good, "GOOD")
        self.assertEqual(_supervision_label("GOOD", True, True), "TRAINABLE_CONTINUOUS")
        self.assertEqual(_supervision_label("USABLE", False, True), "TRAINABLE_BINARY")
        self.assertEqual(_supervision_label("UNUSABLE", False, False), "DEFER")

    def test_strength_probs(self):
        self.assertEqual(STRENGTH_TO_PROB["NONE"], 0.0)
        self.assertEqual(STRENGTH_TO_PROB["HIGH"], 0.8)


if __name__ == "__main__":
    unittest.main()
