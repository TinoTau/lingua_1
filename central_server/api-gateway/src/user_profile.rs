//! UserProfile V1/V2 contract — Runtime UserProfile SSOT payload (API Gateway).
//! Hard bound: serialized JSON ≤ 32768 bytes. Never silent-truncate.
//!
//! schema_version:
//!   1 — legacy free-text personal_terms as identity (deprecated for writeback)
//!   2 — lexicon-backed resolved_term_id evidence + long_term_domain_evidence

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

pub const USER_PROFILE_SCHEMA_VERSION: u32 = 2;
pub const USER_PROFILE_MAX_BYTES: usize = 32 * 1024; // 32 KiB
pub const MAX_UNRESOLVED_KEEP: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResolvedLexicalTermStat {
    pub term_id: String,
    pub surface: String,
    pub evidence: f64,
    pub confirm_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnresolvedLexicalRecord {
    pub surface: String,
    pub reason: String,
    #[serde(default)]
    pub last_event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UserProfileV1 {
    pub schema_version: u32,
    pub profile_version: u64,
    #[serde(default)]
    pub phonetic_bias: HashMap<String, f64>,
    #[serde(default)]
    pub tone_bias: HashMap<String, f64>,
    /// Top-K canonical surfaces of resolved lexicon terms (Stage D lexical hash input).
    #[serde(default)]
    pub personal_terms: Vec<String>,
    /// Evidence keyed by **term_id** (authoritative). Legacy free-text keys migrated on apply.
    #[serde(default)]
    pub personal_term_evidence: HashMap<String, f64>,
    /// Authoritative resolved lexical stats (term_id → stat).
    #[serde(default)]
    pub resolved_lexical_terms: HashMap<String, ResolvedLexicalTermStat>,
    /// Diagnostic-only unresolved observations (do not contribute domain evidence).
    #[serde(default)]
    pub unresolved_lexical_observations: Vec<UnresolvedLexicalRecord>,
    /// Historical free-text personal terms that could not be resolved (no silent delete).
    #[serde(default)]
    pub legacy_free_text_personal_terms: Vec<String>,
    #[serde(default)]
    pub confusion_bias: HashMap<String, f64>,
    /// Soft preference slot — NOT Lexicon SSOT; Correction must not write knowledge here.
    #[serde(default)]
    pub domain_bias: HashMap<String, f64>,
    /// Compact derived user state from resolved terms × term_domain_tags (Stage D compatible).
    #[serde(default)]
    pub long_term_domain_evidence: HashMap<String, f64>,
}

impl UserProfileV1 {
    pub fn empty_default() -> Self {
        Self {
            schema_version: USER_PROFILE_SCHEMA_VERSION,
            profile_version: 0,
            phonetic_bias: HashMap::new(),
            tone_bias: HashMap::new(),
            personal_terms: Vec::new(),
            personal_term_evidence: HashMap::new(),
            resolved_lexical_terms: HashMap::new(),
            unresolved_lexical_observations: Vec::new(),
            legacy_free_text_personal_terms: Vec::new(),
            confusion_bias: HashMap::new(),
            domain_bias: HashMap::new(),
            long_term_domain_evidence: HashMap::new(),
        }
    }

    pub fn serialize_checked(&self) -> Result<Vec<u8>, UserProfileError> {
        let bytes = serde_json::to_vec(self).map_err(|e| UserProfileError::Serialize(e.to_string()))?;
        if bytes.len() > USER_PROFILE_MAX_BYTES {
            return Err(UserProfileError::PayloadTooLarge {
                size: bytes.len(),
                max: USER_PROFILE_MAX_BYTES,
            });
        }
        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, UserProfileError> {
        if bytes.len() > USER_PROFILE_MAX_BYTES {
            return Err(UserProfileError::PayloadTooLarge {
                size: bytes.len(),
                max: USER_PROFILE_MAX_BYTES,
            });
        }
        serde_json::from_slice(bytes).map_err(|e| UserProfileError::Deserialize(e.to_string()))
    }
}

#[derive(Debug, Error, PartialEq)]
pub enum UserProfileError {
    #[error("UserProfile payload too large: {size} > {max} bytes (no silent truncate)")]
    PayloadTooLarge { size: usize, max: usize },
    #[error("serialize error: {0}")]
    Serialize(String),
    #[error("deserialize error: {0}")]
    Deserialize(String),
    #[error("stale profile_version: expected {expected}, got {actual}")]
    StaleVersion { expected: u64, actual: u64 },
    #[error("user not found: {0}")]
    UserNotFound(String),
    #[error("storage error: {0}")]
    Storage(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_roundtrip_v2_fields() {
        let mut p = UserProfileV1::empty_default();
        p.long_term_domain_evidence.insert("tech_ai".into(), 1.0);
        p.resolved_lexical_terms.insert(
            "tid".into(),
            ResolvedLexicalTermStat {
                term_id: "tid".into(),
                surface: "接口".into(),
                evidence: 0.25,
                confirm_count: 1,
            },
        );
        let b = p.serialize_checked().unwrap();
        let p2 = UserProfileV1::from_bytes(&b).unwrap();
        assert_eq!(p2.long_term_domain_evidence["tech_ai"], 1.0);
        assert_eq!(p2.resolved_lexical_terms["tid"].surface, "接口");
    }
}
