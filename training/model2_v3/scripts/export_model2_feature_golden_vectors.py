"""Generate MODEL2_FEATURE_HASH_V1 golden vectors (Python side)."""

from __future__ import annotations

import json
from pathlib import Path

from training.model2_v3.policy.feature_hash_v1 import (
    contract_meta,
    hash_span_v1,
    normalize_token,
    stable_bucket,
)

OUT = Path("training/model2_v3/experiments/v3_runtime_integration_mvp_dev")
OUT.mkdir(parents=True, exist_ok=True)

EXAMPLES = [
    {"id": "ascii_simple", "syllables": ["ni", "hao"]},
    {"id": "tone", "syllables": ["ni3", "hao3"]},
    {"id": "no_tone", "syllables": ["lai", "zi"]},
    {"id": "multi", "syllables": ["zhong", "guo", "ren", "min"]},
    {"id": "empty", "syllables": []},
    {"id": "blank_token", "syllables": ["", "hao"]},
    {"id": "upper", "syllables": ["NI", "HAO"]},
    {"id": "mixed_case", "syllables": ["Lai", "Zi"]},
    {"id": "zh_z", "syllables": ["zhong", "zi"]},
    {"id": "eng_en", "syllables": ["cheng", "shi"]},
    {"id": "n_l", "syllables": ["lai", "zi"]},
    {"id": "h_f", "syllables": ["hui", "fei"]},
    {"id": "single", "syllables": ["ma"]},
    {"id": "long_syl", "syllables": ["zhuang"]},
    {"id": "digit_tone", "syllables": ["ma1", "ma2", "ma3", "ma4"]},
]

# Expand to >=50 with systematic variants
BASE = ["a", "o", "e", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong"]
for i, b in enumerate(BASE):
    EXAMPLES.append({"id": f"base_{i}", "syllables": [b, "zi"]})
for i, b in enumerate(BASE[:10]):
    EXAMPLES.append({"id": f"pair_{i}", "syllables": [b, BASE[(i + 3) % len(BASE)]]})
EXAMPLES.append({"id": "cjk_ignored_norm", "syllables": ["ni", "hao"]})  # pinyin only
while len(EXAMPLES) < 50:
    EXAMPLES.append({"id": f"pad_{len(EXAMPLES)}", "syllables": ["ce", "shi", str(len(EXAMPLES) % 9)]})

vectors = []
for ex in EXAMPLES[:50]:
    syls = ex["syllables"]
    vectors.append(
        {
            "id": ex["id"],
            "syllables": syls,
            "normalized": [normalize_token(s) for s in syls],
            "buckets": [stable_bucket(normalize_token(s), 64) for s in syls if normalize_token(s)],
            "hash_span_v1": hash_span_v1(syls),
        }
    )

payload = {
    "contract": contract_meta(),
    "count": len(vectors),
    "vectors": vectors,
    "note": "Node feature-hash-v1.ts must match hash_span_v1 bit-for-bit (float tolerance 1e-12)",
}
path = OUT / "model2_feature_golden_vectors.json"
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
print("wrote", path)
