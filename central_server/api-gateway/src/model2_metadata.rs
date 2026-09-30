//! Lightweight Model2VersionMetadata — reuses Model-Hub style fields (no new registry).

use serde::{Deserialize, Serialize};

/// Future Global Model2 identity. Does not imply per-user models.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Model2VersionMetadata {
    pub model_id: String,
    pub version: String,
    pub checksum: String,
    pub task: String, // expected "model2"
}

impl Model2VersionMetadata {
    pub fn example_placeholder() -> Self {
        Self {
            model_id: "model2-fuzzy-recall".into(),
            version: "0.0.0-unreleased".into(),
            checksum: "pending".into(),
            task: "model2".into(),
        }
    }
}
