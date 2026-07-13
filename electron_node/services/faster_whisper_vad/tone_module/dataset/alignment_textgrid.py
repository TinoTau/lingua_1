"""Default AlignmentProvider — Praat TextGrid with pinyin+tone intervals (not frozen architecture)."""
from __future__ import annotations

import os
import re
from typing import Dict, Iterable, List, Optional, Tuple

from tone_module import contract
from tone_module.dataset.dataset_contract import SyllableSample

PINYIN_TONE_RE = re.compile(r"^([a-z]+)([1-5])$", re.IGNORECASE)
_TEXTGRID_INTERVAL_RE = re.compile(
    r"intervals\s*\[\d+\]:\s*\n\s*xmin\s*=\s*([0-9.]+)\s*\n\s*xmax\s*=\s*([0-9.]+)\s*\n\s*text\s*=\s*\"([^\"]*)\"",
    re.MULTILINE,
)


def parse_textgrid_intervals(text: str) -> Iterable[Tuple[float, float, str]]:
    for match in _TEXTGRID_INTERVAL_RE.finditer(text):
        start = float(match.group(1))
        end = float(match.group(2))
        token = match.group(3).strip()
        if token:
            yield start, end, token


def tone_label_from_pinyin(token: str) -> Optional[int]:
    match = PINYIN_TONE_RE.match(token.strip().lower())
    if not match:
        return None
    tone_num = int(match.group(2))
    if tone_num < 1 or tone_num > 5:
        return None
    return tone_num - 1


def index_wavs(dataset_root: str) -> Dict[str, str]:
    wav_map: Dict[str, str] = {}
    for dirpath, _, filenames in os.walk(dataset_root):
        for name in filenames:
            if not name.lower().endswith(".wav"):
                continue
            base = os.path.splitext(name)[0]
            wav_map[base] = os.path.join(dirpath, name)
    return wav_map


class TextGridPinyinAlignmentProvider:
    """AlignmentProvider implementation for MFA-style Praat TextGrid + wav basename join."""

    provider_id = "textgrid_pinyin_v1"

    def collect_samples(self, dataset_root: str) -> List[SyllableSample]:
        wav_map = index_wavs(dataset_root)
        samples: List[SyllableSample] = []

        for dirpath, _, filenames in os.walk(dataset_root):
            for name in filenames:
                if not name.endswith(".TextGrid"):
                    continue
                base = os.path.splitext(name)[0]
                wav_path = wav_map.get(base)
                if not wav_path:
                    continue
                tg_path = os.path.join(dirpath, name)
                with open(tg_path, encoding="utf-8", errors="ignore") as handle:
                    text = handle.read()
                for start, end, token in parse_textgrid_intervals(text):
                    if end - start < contract.P0_MIN_SLICE_SEC:
                        continue
                    label = tone_label_from_pinyin(token)
                    if label is None:
                        continue
                    samples.append(SyllableSample(wav_path, start, end, label))
        return samples
