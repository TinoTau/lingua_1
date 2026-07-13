"""Phase 8 — Boundary Consistency Gate."""
from __future__ import annotations

import unittest

from tone_module.dataset.dataset_contract import SyllableSample
from tone_module.training_io.boundary_consistency import audit_boundary_consistency, require_boundary_consistency_pass


class BoundaryConsistencyGateTest(unittest.TestCase):
    def test_passes_on_valid_samples(self) -> None:
        samples = [
            SyllableSample("a.wav", 0.1, 0.35, 0),
            SyllableSample("a.wav", 0.4, 0.62, 1),
        ]
        result = audit_boundary_consistency(samples)
        self.assertTrue(result["pass"])
        self.assertEqual(result["mismatchCount"], 0)
        require_boundary_consistency_pass(samples)

    def test_fail_on_invalid_boundary(self) -> None:
        samples = [SyllableSample("a.wav", 0.5, 0.4, 0)]
        with self.assertRaises(ValueError):
            require_boundary_consistency_pass(samples)


if __name__ == "__main__":
    unittest.main()
