"""MODEL2_FEATURE_HASH_V1 — cross-language stable feature hashing.

Contract id: MODEL2_FEATURE_HASH_V1
Algorithm: FNV-1a 64-bit (same constants as training.model2.encoding.char_hash)
Encoding: UTF-8
Normalization (span tokens): NFC + lowercase ASCII alnum kept as-is for pinyin;
  full token lowercased for bucketing (pinyin syllables are ASCII).

IMPORTANT — Stage P checkpoint compatibility:
  Stage P weights were trained with Python built-in hash() in hash_span /
  unknown-key fallbacks. Switching Stage P inference to V1 WITHOUT retrain is a
  CHECKPOINT_COMPATIBILITY_BLOCKER. Stage P runtime skeleton therefore keeps the
  training feature pack (legacy_python_hash) inside the Python inference host.
  Stage J MUST train with MODEL2_FEATURE_HASH_V1.
"""

from __future__ import annotations

import unicodedata
from typing import Any

from training.model2.encoding.char_hash import FNV_OFFSET, FNV_PRIME, fnv1a64
from training.model2.contract import CHAR_HASH_SEED

MODEL2_FEATURE_HASH_VERSION = "MODEL2_FEATURE_HASH_V1"
MODEL2_FEATURE_HASH_SEED = CHAR_HASH_SEED  # 0x4D324841534831
SPAN_DIM_V1 = 64
PHONETIC_DIM_V1 = 16
DOMAIN_DIM_V1 = 12


def normalize_token(token: str) -> str:
    s = unicodedata.normalize("NFC", token or "")
    return s.lower()


def stable_bucket(token: str, dim: int) -> int:
    """Deterministic bucket in [0, dim)."""
    if dim <= 0:
        raise ValueError("dim must be > 0")
    t = normalize_token(token)
    raw = fnv1a64(t.encode("utf-8"), seed=MODEL2_FEATURE_HASH_SEED)
    return int(raw % dim)


def hash_span_v1(syllables: list[str], dim: int = SPAN_DIM_V1) -> list[float]:
    """Stable span bag-of-hash vector (list[float] length=dim)."""
    v = [0.0] * dim
    n = 0
    for s in syllables:
        t = normalize_token(s)
        if not t:
            continue
        n += 1
        v[stable_bucket(t, dim)] += 1.0
        if len(t) >= 2:
            v[stable_bucket(t[:2], dim)] += 0.5
    denom = float(n or 1)
    return [x / denom for x in v]


def contract_meta() -> dict[str, Any]:
    return {
        "contract_id": MODEL2_FEATURE_HASH_VERSION,
        "algorithm": "fnv1a64",
        "seed": MODEL2_FEATURE_HASH_SEED,
        "encoding": "utf-8",
        "normalization": "NFC+lower",
        "span_dim": SPAN_DIM_V1,
        "phonetic_dim": PHONETIC_DIM_V1,
        "domain_dim": DOMAIN_DIM_V1,
        "stage_p_uses_v1": False,
        "stage_p_feature_pack": "legacy_python_hash_via_training_pack_batch_inputs",
        "checkpoint_compatibility_blocker": (
            "Stage P checkpoint incompatible with MODEL2_FEATURE_HASH_V1 without retrain"
        ),
    }
