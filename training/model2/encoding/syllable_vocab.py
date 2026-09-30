"""Syllable vocabulary V1 — deterministic IDs from lexicon pinyin universe."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Optional

from training.model2.contract import SYL_PAD_ID, SYL_UNK_ID, SYL_VOCAB_VERSION, SYLLABLE_MAX
from training.model2.phonetic.syllables import normalize_syllable, parse_raw_pinyin


class SyllableVocabV1:
    def __init__(self, syllable_to_id: dict[str, int], version: str = SYL_VOCAB_VERSION):
        self.version = version
        self.syllable_to_id = dict(syllable_to_id)
        self.id_to_syllable = {i: s for s, i in self.syllable_to_id.items()}

    @classmethod
    def build_from_syllables(cls, syllables: Iterable[str]) -> "SyllableVocabV1":
        uniq = sorted({normalize_syllable(s) for s in syllables if normalize_syllable(s)})
        mapping: dict[str, int] = {"<PAD>": SYL_PAD_ID, "<UNK>": SYL_UNK_ID}
        next_id = 2
        for s in uniq:
            if s not in mapping:
                mapping[s] = next_id
                next_id += 1
        return cls(mapping)

    def encode(self, syllables: list[str], max_len: int = SYLLABLE_MAX) -> list[int]:
        ids = [self.syllable_to_id.get(normalize_syllable(s), SYL_UNK_ID) for s in syllables[:max_len]]
        while len(ids) < max_len:
            ids.append(SYL_PAD_ID)
        return ids

    def encode_pinyin_key(self, pinyin_key: Optional[str], max_len: int = SYLLABLE_MAX) -> list[int]:
        syls = parse_raw_pinyin(pinyin_key) or []
        return self.encode(syls, max_len=max_len)

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "pad_id": SYL_PAD_ID,
            "unk_id": SYL_UNK_ID,
            "size": len(self.syllable_to_id),
            "syllable_to_id": self.syllable_to_id,
        }

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "SyllableVocabV1":
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(data["syllable_to_id"], version=data.get("version", SYL_VOCAB_VERSION))
