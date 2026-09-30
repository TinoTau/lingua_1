"""Model2 Phase 5A frozen contract constants."""

from __future__ import annotations

# Versions
INPUT_CONTRACT_VERSION = "model2-input-v1"
TRAINING_SAMPLE_SCHEMA_VERSION = 1  # V1.1 additive; schema_version stays 1
TRAINROW_SCHEMA_VERSION = 1
FUZZY_POOL_VERSION = "fuzzy-pool-v1"
CANDIDATE_INDEX_VERSION = "cand-index-v1"
CHAR_HASH_VERSION = "char-hash-v1"
SYL_VOCAB_VERSION = "syl-vocab-v1"
FEATURE_SCHEMA_VERSION = "user-feature-schema-v1"

# Tensor dims (frozen)
PHONETIC_DIM = 16
TONE_DIM = 12
DOMAIN_DIM = 12
SPAN_CHAR_MAX = 16
SYLLABLE_MAX = 8
CONTEXT_CHAR_MAX = 24
QUERY_EMBED_DIM = 64

# Char hash contract
CHAR_NGRAM_SIZE = 3
CHAR_HASH_BUCKETS = 4096
CHAR_PAD_ID = 0
CHAR_HASH_SEED = 0x4D324841534831  # "M2HASH1" truncated

# Syllable vocab specials
SYL_PAD_ID = 0
SYL_UNK_ID = 1

# Feature schema keys (must match feature_schema.rs order)
PHONETIC_FEATURE_KEYS: tuple[str, ...] = (
    "n_l",
    "l_n",
    "zh_z",
    "z_zh",
    "ch_c",
    "c_ch",
    "sh_s",
    "s_sh",
    "an_ang",
    "ang_an",
    "en_eng",
    "eng_en",
    "in_ing",
    "ing_in",
    "f_h",
    "h_f",
)

# Stable index map — never rely on dict iteration order.
PHONETIC_FEATURE_INDEX_V1: dict[str, int] = {k: i for i, k in enumerate(PHONETIC_FEATURE_KEYS)}
assert PHONETIC_FEATURE_INDEX_V1["n_l"] == 0
assert PHONETIC_FEATURE_INDEX_V1["h_f"] == 15

TONE_FEATURE_KEYS: tuple[str, ...] = (
    "tone_1_2",
    "tone_2_1",
    "tone_1_3",
    "tone_3_1",
    "tone_1_4",
    "tone_4_1",
    "tone_2_3",
    "tone_3_2",
    "tone_2_4",
    "tone_4_2",
    "tone_3_4",
    "tone_4_3",
)

# 12 fine domains from lexicon domain_hierarchy / domain_lexicon (not coarse parents)
DOMAIN_SLOT_IDS: tuple[str, ...] = (
    "tourism_pickup",
    "tourism_hotel",
    "tourism_route",
    "tourism_transport",
    "coffee",
    "milk_tea",
    "bakery",
    "food_order",
    "tech_ai",
    "meeting",
    "medical",
    "transport",
)

assert len(PHONETIC_FEATURE_KEYS) == PHONETIC_DIM
assert len(TONE_FEATURE_KEYS) == TONE_DIM
assert len(DOMAIN_SLOT_IDS) == DOMAIN_DIM

# Fuzzy pool defaults — frozen after Phase 5A probe sweep
FUZZY_POOL_MAX_CANDIDATES = 16  # smallest cap with Recall@16 >= 95%
FUZZY_DISTANCE_THRESHOLD = 2
FUZZY_LEN_DELTA_MAX = 1  # |len(query)-len(cand)| <= this

# Personal terms: benchmark showed Top-100 acceptable; use all active <=100
PERSONAL_TERMS_MAX = 100
PERSONAL_SIM_TOP_N = 100  # frozen: all active personal_terms <=100

# domain_prior is continuous bias strength — float32, NOT uint8 classification IDs
DOMAIN_PRIOR_DTYPE = "float32"
DOMAIN_MASK_DTYPE = "uint8"
