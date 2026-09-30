//! UserProfile (Scheduler forward-only copy — Web Gateway remains Runtime SSOT).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const USER_PROFILE_MAX_BYTES: usize = 32 * 1024;

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
    #[serde(default)]
    pub personal_terms: Vec<String>,
    #[serde(default)]
    pub personal_term_evidence: HashMap<String, f64>,
    #[serde(default)]
    pub resolved_lexical_terms: HashMap<String, ResolvedLexicalTermStat>,
    #[serde(default)]
    pub unresolved_lexical_observations: Vec<UnresolvedLexicalRecord>,
    #[serde(default)]
    pub legacy_free_text_personal_terms: Vec<String>,
    #[serde(default)]
    pub confusion_bias: HashMap<String, f64>,
    #[serde(default)]
    pub domain_bias: HashMap<String, f64>,
    #[serde(default)]
    pub long_term_domain_evidence: HashMap<String, f64>,
}

impl UserProfileV1 {
    pub fn serialized_len(&self) -> Result<usize, String> {
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        Ok(bytes.len())
    }

    pub fn validate_bound(&self) -> Result<(), String> {
        let n = self.serialized_len()?;
        if n > USER_PROFILE_MAX_BYTES {
            return Err(format!(
                "UserProfile too large: {} > {} (reject, no truncate)",
                n, USER_PROFILE_MAX_BYTES
            ));
        }
        Ok(())
    }
}
