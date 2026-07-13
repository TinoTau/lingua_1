"""Training Engineering — SyllableSample to WordInfo adapter (contract conversion only)."""
from __future__ import annotations

from shared_types import WordInfo
from tone_module.dataset.dataset_contract import SyllableSample


def syllable_sample_to_word_info(sample: SyllableSample, *, syllable_index: int) -> WordInfo:
    """
    Convert Dataset Foundation sample to Runtime Timestamp Contract.

    Does not modify start/end. Label stays on SyllableSample for Shard sidecar.
    """
    if sample.end <= sample.start:
        raise ValueError("invalid SyllableSample boundary: end <= start")
    return WordInfo(
        word=f"syllable:{syllable_index}",
        start=float(sample.start),
        end=float(sample.end),
        probability=1.0,
    )
