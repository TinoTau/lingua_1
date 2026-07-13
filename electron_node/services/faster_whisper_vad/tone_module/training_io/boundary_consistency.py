"""Boundary Consistency Gate — must PASS before Canonical Feature Shard V2 build."""
from __future__ import annotations

from typing import List, Sequence

from tone_module.dataset.dataset_contract import SyllableSample
from tone_module.training_io.syllable_to_wordinfo import syllable_sample_to_word_info


def audit_boundary_consistency(samples: Sequence[SyllableSample]) -> dict:
    """
    Verify Adapter preserves start/end exactly (Addendum M-10 / R-04).

    PASS when every sample has adapter start/end equal to SyllableSample.
    """
    checks: List[dict] = []
    ok = True
    for index, sample in enumerate(samples):
        word_info = syllable_sample_to_word_info(sample, syllable_index=index)
        start_match = float(word_info.start) == float(sample.start)
        end_match = float(word_info.end) == float(sample.end)
        row_ok = start_match and end_match
        ok = ok and row_ok
        if not row_ok:
            checks.append(
                {
                    "index": index,
                    "start_match": start_match,
                    "end_match": end_match,
                    "sample_start": sample.start,
                    "sample_end": sample.end,
                    "word_start": word_info.start,
                    "word_end": word_info.end,
                }
            )
            if len(checks) >= 20:
                break

    return {
        "pass": ok,
        "sampleCount": len(samples),
        "mismatchCount": sum(
            1
            for i, s in enumerate(samples)
            if float(syllable_sample_to_word_info(s, syllable_index=i).start) != float(s.start)
            or float(syllable_sample_to_word_info(s, syllable_index=i).end) != float(s.end)
        ),
        "mismatches": checks,
    }


def require_boundary_consistency_pass(samples: Sequence[SyllableSample]) -> None:
    result = audit_boundary_consistency(samples)
    if not result["pass"]:
        raise RuntimeError(
            f"Boundary Consistency Gate FAIL: {result['mismatchCount']} mismatches "
            f"of {result['sampleCount']} samples"
        )
