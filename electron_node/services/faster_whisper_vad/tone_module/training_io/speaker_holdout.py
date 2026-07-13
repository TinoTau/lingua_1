"""Speaker-level holdout for Training Engineering (not Dataset Foundation)."""
from __future__ import annotations

import re
from typing import Dict, List, Sequence, Set, Tuple

import numpy as np

from tone_module.dataset.dataset_contract import SyllableSample

SPEAKER_RE = re.compile(r"(SSB\d+)", re.IGNORECASE)


def speaker_id_from_path(wav_path: str) -> str | None:
    match = SPEAKER_RE.search(wav_path.replace("\\", "/"))
    return match.group(1).upper() if match else None


def split_speaker_holdout_samples(
    samples: Sequence[SyllableSample],
    *,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> Tuple[List[SyllableSample], List[SyllableSample], dict]:
    """Speaker-stratified holdout: entire speakers assigned to train or val."""
    speaker_to_samples: Dict[str, List[SyllableSample]] = {}
    for sample in samples:
        speaker = speaker_id_from_path(sample.wav_path)
        key = speaker or "__unknown__"
        speaker_to_samples.setdefault(key, []).append(sample)

    speakers = sorted(speaker_to_samples.keys())
    rng = np.random.default_rng(seed)
    rng.shuffle(speakers)
    val_count = max(1, int(len(speakers) * val_ratio)) if speakers else 0
    val_speakers: Set[str] = set(speakers[:val_count])
    train_speakers: Set[str] = set(speakers[val_count:])

    train_samples: List[SyllableSample] = []
    val_samples: List[SyllableSample] = []
    for speaker, items in speaker_to_samples.items():
        if speaker in val_speakers:
            val_samples.extend(items)
        else:
            train_samples.extend(items)

    meta = {
        "holdout": "speaker",
        "valRatio": val_ratio,
        "seed": seed,
        "trainSpeakers": sorted(train_speakers),
        "valSpeakers": sorted(val_speakers),
        "trainSampleCount": len(train_samples),
        "valSampleCount": len(val_samples),
    }
    return train_samples, val_samples, meta


def filter_samples_by_max_speakers(
    samples: Sequence[SyllableSample],
    max_speakers: int,
) -> List[SyllableSample]:
    if max_speakers is None or max_speakers <= 0:
        return list(samples)
    allowed: Set[str] = set()
    kept: List[SyllableSample] = []
    for sample in samples:
        speaker = speaker_id_from_path(sample.wav_path) or "__unknown__"
        if speaker not in allowed:
            if len(allowed) >= max_speakers:
                continue
            allowed.add(speaker)
        if speaker in allowed:
            kept.append(sample)
    return kept


def truncate_samples(samples: Sequence[SyllableSample], max_syllables: int | None) -> List[SyllableSample]:
    if max_syllables is None or max_syllables <= 0:
        return list(samples)
    return list(samples[:max_syllables])
