"""Stable char / n-gram hashing for Model2 Query Encoder (Python + future Node parity).

Contract: char-hash-v1
- Normalization: NFC, then keep CJK + alnum; lowercase ASCII; strip others
- N-gram size: 3 (with boundary pads)
- Hash: FNV-1a 64-bit with fixed seed, then mod CHAR_HASH_BUCKETS
- NEVER use Python built-in hash() (randomized across runs)
"""

from __future__ import annotations

import unicodedata
from typing import Iterable

from training.model2.contract import (
    CHAR_HASH_BUCKETS,
    CHAR_HASH_SEED,
    CHAR_HASH_VERSION,
    CHAR_NGRAM_SIZE,
    CHAR_PAD_ID,
    CONTEXT_CHAR_MAX,
    SPAN_CHAR_MAX,
)

FNV_OFFSET = 0xCBF29CE484222325
FNV_PRIME = 0x100000001B3


def normalize_chars(text: str) -> str:
    s = unicodedata.normalize("NFC", text or "")
    out: list[str] = []
    for ch in s:
        if "\u4e00" <= ch <= "\u9fff" or "\u3400" <= ch <= "\u4dbf":
            out.append(ch)
        elif ch.isascii() and ch.isalnum():
            out.append(ch.lower())
        # else drop punctuation/whitespace for hash n-grams
    return "".join(out)


def fnv1a64(data: bytes, seed: int = CHAR_HASH_SEED) -> int:
    h = (FNV_OFFSET ^ (seed & 0xFFFFFFFFFFFFFFFF)) & 0xFFFFFFFFFFFFFFFF
    for b in data:
        h ^= b
        h = (h * FNV_PRIME) & 0xFFFFFFFFFFFFFFFF
    return h


def hash_ngram(ngram: str) -> int:
    """Return bucket id in [1, CHAR_HASH_BUCKETS-1]; 0 reserved for PAD."""
    if not ngram:
        return CHAR_PAD_ID
    raw = fnv1a64(ngram.encode("utf-8"))
    return 1 + (raw % (CHAR_HASH_BUCKETS - 1))


def char_ngram_ids(text: str, max_len: int | None = None) -> list[int]:
    """Hash char 3-grams with boundary markers ^ and $."""
    norm = normalize_chars(text)
    if max_len is not None:
        norm = norm[:max_len]
    padded = "^" + norm + "$"
    n = CHAR_NGRAM_SIZE
    if len(padded) < n:
        return [hash_ngram(padded)] if padded else []
    return [hash_ngram(padded[i : i + n]) for i in range(len(padded) - n + 1)]


def pad_ids(ids: Iterable[int], length: int, pad: int = CHAR_PAD_ID) -> list[int]:
    xs = list(ids)[:length]
    if len(xs) < length:
        xs.extend([pad] * (length - len(xs)))
    return xs


def encode_span_chars(text: str) -> list[int]:
    return pad_ids(char_ngram_ids(text, SPAN_CHAR_MAX), SPAN_CHAR_MAX)


def encode_context_chars(text: str) -> list[int]:
    return pad_ids(char_ngram_ids(text, CONTEXT_CHAR_MAX), CONTEXT_CHAR_MAX)


def contract_meta() -> dict:
    return {
        "version": CHAR_HASH_VERSION,
        "ngram_size": CHAR_NGRAM_SIZE,
        "buckets": CHAR_HASH_BUCKETS,
        "pad_id": CHAR_PAD_ID,
        "seed": CHAR_HASH_SEED,
        "algorithm": "fnv1a64",
        "normalization": "NFC+cjk_alnum_lower",
    }
