//! Fixed, versioned UserFeatureSchema V1 — no dynamic key growth.

pub const FEATURE_SCHEMA_VERSION: &str = "user-feature-schema-v1";

/// Allowed phonetic confusion feature keys (symmetric pairs stored once as canonical A_B).
pub const PHONETIC_FEATURE_KEYS: &[&str] = &[
    "n_l", "l_n", "zh_z", "z_zh", "ch_c", "c_ch", "sh_s", "s_sh", "an_ang", "ang_an", "en_eng",
    "eng_en", "in_ing", "ing_in", "f_h", "h_f",
];

/// Allowed tone feature keys (lexical/schema only; acoustic tone requires observed evidence).
pub const TONE_FEATURE_KEYS: &[&str] = &[
    "tone_1_2", "tone_2_1", "tone_1_3", "tone_3_1", "tone_1_4", "tone_4_1", "tone_2_3", "tone_3_2",
    "tone_2_4", "tone_4_2", "tone_3_4", "tone_4_3",
];

pub fn is_allowed_phonetic_key(key: &str) -> bool {
    PHONETIC_FEATURE_KEYS.contains(&key)
}

pub fn is_allowed_tone_key(key: &str) -> bool {
    TONE_FEATURE_KEYS.contains(&key)
}

/// Canonicalize unordered pair into directional key if listed.
pub fn match_phonetic_pair(a: &str, b: &str) -> Option<&'static str> {
    let key = format!("{}_{}", a, b);
    PHONETIC_FEATURE_KEYS
        .iter()
        .copied()
        .find(|k| *k == key.as_str())
}
