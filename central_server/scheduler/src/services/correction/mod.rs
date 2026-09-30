//! CorrectionEvent V1 + repository (CorrectionHistory SSOT). Not Redis Job TTL.

pub mod align;
pub mod feature_schema;
pub mod features;
pub mod normalizer;
pub mod profile_delta;
pub mod service;
pub mod sqlite_repository;
pub mod training_sample;

#[cfg(test)]
mod service_test;

pub use align::{AlignedCorrectionSpan, SpanOperation, NORMALIZER_VERSION};
pub use features::{CorrectionFeatures, EXTRACTOR_VERSION};
pub use normalizer::NormalizedCorrection;
pub use profile_delta::ProfileDeltaV1;
pub use service::CorrectionService;
pub use sqlite_repository::SqliteCorrectionRepository;
pub use training_sample::{TrainingSampleKind, TrainingSampleV1, TrainingSourceType};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CorrectionSpanV1 {
    #[serde(default)]
    pub start: Option<u32>,
    #[serde(default)]
    pub end: Option<u32>,
    #[serde(default)]
    pub system_fragment: Option<String>,
    #[serde(default)]
    pub corrected_fragment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CorrectionEventV1 {
    pub event_id: String,
    pub user_id: String,
    pub session_id: String,
    pub utterance_index: u64,
    pub system_text: String,
    pub corrected_text: String,
    #[serde(default)]
    pub corrections: Vec<CorrectionSpanV1>,
    #[serde(default)]
    pub source_profile_version: Option<u64>,
    #[serde(default)]
    pub pipeline_version: Option<String>,
    pub idempotency_key: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitCorrectionRequest {
    pub user_id: String,
    pub session_id: String,
    pub utterance_index: u64,
    pub system_text: String,
    pub corrected_text: String,
    #[serde(default)]
    pub corrections: Vec<CorrectionSpanV1>,
    #[serde(default)]
    pub source_profile_version: Option<u64>,
    #[serde(default)]
    pub pipeline_version: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrectionDiagnosticsSummary {
    pub correction_event_id: String,
    pub normalizer_version: String,
    pub span_count: usize,
    pub feature_extractor_version: String,
    pub profile_delta_generated: bool,
    pub superseded_for_profile: bool,
    pub training_sample_count: usize,
    pub base_profile_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitCorrectionResponse {
    pub correction_id: String,
    pub accepted: bool,
    pub duplicate: bool,
    pub profile_delta: Option<ProfileDeltaV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<CorrectionDiagnosticsSummary>,
}

#[derive(Debug, Error)]
pub enum CorrectionError {
    #[error("storage: {0}")]
    Storage(String),
    #[error("validation: {0}")]
    Validation(String),
    #[error("unauthorized")]
    Unauthorized,
}

pub trait CorrectionRepository: Send + Sync {
    fn insert(&self, event: &CorrectionEventV1) -> Result<(), CorrectionError>;
    fn find_by_id(&self, event_id: &str) -> Result<Option<CorrectionEventV1>, CorrectionError>;
    fn find_by_user(
        &self,
        user_id: &str,
        limit: usize,
    ) -> Result<Vec<CorrectionEventV1>, CorrectionError>;
    fn find_by_idempotency(
        &self,
        user_id: &str,
        idempotency_key: &str,
    ) -> Result<Option<CorrectionEventV1>, CorrectionError>;
    /// Events for same utterance, newest first.
    fn find_by_utterance(
        &self,
        user_id: &str,
        session_id: &str,
        utterance_index: u64,
    ) -> Result<Vec<CorrectionEventV1>, CorrectionError>;
}

pub fn new_event_from_request(
    req: SubmitCorrectionRequest,
) -> Result<CorrectionEventV1, CorrectionError> {
    if req.user_id.trim().is_empty() {
        return Err(CorrectionError::Validation("user_id required".into()));
    }
    if req.session_id.trim().is_empty() {
        return Err(CorrectionError::Validation("session_id required".into()));
    }
    if req.idempotency_key.trim().is_empty() {
        return Err(CorrectionError::Validation("idempotency_key required".into()));
    }
    if req.system_text.trim().is_empty() {
        return Err(CorrectionError::Validation("system_text required".into()));
    }
    if req.corrected_text.trim().is_empty() {
        return Err(CorrectionError::Validation("corrected_text required".into()));
    }
    if req.system_text.trim() == req.corrected_text.trim() {
        return Err(CorrectionError::Validation(
            "NO_OP_CORRECTION: corrected_text must differ from system_text".into(),
        ));
    }
    Ok(CorrectionEventV1 {
        event_id: format!("corr-{}", Uuid::new_v4()),
        user_id: req.user_id,
        session_id: req.session_id,
        utterance_index: req.utterance_index,
        system_text: req.system_text,
        corrected_text: req.corrected_text,
        corrections: req.corrections,
        source_profile_version: req.source_profile_version,
        pipeline_version: req.pipeline_version,
        idempotency_key: req.idempotency_key,
        created_at: chrono::Utc::now(),
    })
}
