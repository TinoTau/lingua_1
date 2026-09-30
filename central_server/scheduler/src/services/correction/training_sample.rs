//! TrainingSample V1 — rebuildable derived artifact (not SSOT).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::align::NORMALIZER_VERSION;
use super::features::{CorrectionFeatures, EXTRACTOR_VERSION};
use super::normalizer::NormalizedCorrection;
use super::CorrectionEventV1;

pub const TRAINING_SAMPLE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrainingSourceType {
    RealUserCorrection,
    /// Ground truth → real TTS → production ASR → actual hypothesis.
    TtsAsrSynthetic,
    /// GroundTruth → pronunciation corrupt → TTSInput ≠ GT → Piper → real ASR hypothesis.
    /// Distinct from TtsAsrSynthetic (canonical TTS) and RuleSynthetic (text-only).
    TtsPronunciationCorrupted,
    /// Explicit text-level corruption only (never claim as acoustic pronunciation error).
    RuleSynthetic,
    PublicCorpus,
    HumanAnnotated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrainingSampleKind {
    Positive,
    Negative,
    HardNegative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpanOperation {
    Replace,
    Insert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrainingSampleInput {
    pub source_span: String,
    pub local_context: String,
    pub source_pinyin: Option<String>,
    /// Observed acoustic tone only; never filled from dictionary guess.
    pub available_tone_info: Option<serde_json::Value>,
    /// V1.1 additive — only when known from alignment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_operation: Option<SpanOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_left: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_right: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_start: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_end: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ConditionMasksV1 {
    /// Length 16; 0 = unknown/masked (Stage A TTS).
    #[serde(default)]
    pub phonetic_mask: Vec<u8>,
    /// Length 12.
    #[serde(default)]
    pub tone_mask: Vec<u8>,
    /// Length 12.
    #[serde(default)]
    pub domain_mask: Vec<u8>,
    #[serde(default)]
    pub profile_available: u8,
    #[serde(default)]
    pub phonetic_profile_acoustically_realized: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrainingSampleCondition {
    pub source_profile_version: Option<u64>,
    /// Reference only — do not embed full UserProfile JSON by default.
    pub profile_version_ref: Option<u64>,
    /// V1.1 — declare profile phonetic bias not acoustically realized (synth Stage A).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_profile_not_acoustically_realized: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_condition_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition_masks: Option<ConditionMasksV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrainingSampleTarget {
    pub target_span: String,
}

/// Derived training artifact (fuzzy pool etc.) — NOT CorrectionEvent SSOT.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TrainingArtifactV1 {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fuzzy_pool_term_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_term_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuzzy_pool_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_index_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrainingSampleMetadata {
    pub source_type: TrainingSourceType,
    pub sample_kind: TrainingSampleKind,
    pub correction_event_id: String,
    /// Grouping key for user-disjoint splits — NOT a model input feature.
    pub user_group_key: String,
    pub target_term: Option<String>,
    pub domain: Option<String>,
    pub normalizer_version: String,
    pub extractor_version: String,
    pub pipeline_version: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub superseded_for_profile: bool,
    /// When true, exclude from default positive export (older re-edit).
    pub exclude_from_default_positive_export: bool,
    /// Synthetic provenance (Python parity); absent for real corrections.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synthetic: Option<serde_json::Value>,
    /// V1.1 training-only derived fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub training: Option<TrainingArtifactV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrainingSampleV1 {
    pub schema_version: u32,
    pub sample_id: String,
    pub input: TrainingSampleInput,
    pub condition: TrainingSampleCondition,
    pub target: TrainingSampleTarget,
    pub metadata: TrainingSampleMetadata,
}

/// Build positive samples from active (non-superseded) spans.
/// Superseded events produce provenance samples marked excluded from default positive export.
pub fn build_training_samples(
    event: &CorrectionEventV1,
    normalized: &NormalizedCorrection,
    features: &CorrectionFeatures,
) -> Vec<TrainingSampleV1> {
    let exclude = normalized.superseded_for_profile;
    let mut out = Vec::new();
    for (i, span) in normalized.correction_spans.iter().enumerate() {
        let feat = features.spans.get(i);
        let source_pinyin = feat
            .and_then(|f| f.phonetic.source_syllable.clone());
        let target_term = feat
            .and_then(|f| f.term.candidate_term.clone())
            .or_else(|| {
                if !span.target_text.is_empty() {
                    Some(span.target_text.clone())
                } else {
                    None
                }
            });
        out.push(TrainingSampleV1 {
            schema_version: TRAINING_SAMPLE_SCHEMA_VERSION,
            sample_id: format!("ts-{}", Uuid::new_v4()),
            input: TrainingSampleInput {
                source_span: span.source_text.clone(),
                local_context: event.system_text.clone(),
                source_pinyin,
                available_tone_info: None,
                span_operation: Some(match span.operation {
                    crate::services::correction::align::SpanOperation::Replace => {
                        SpanOperation::Replace
                    }
                    crate::services::correction::align::SpanOperation::Insert => {
                        SpanOperation::Insert
                    }
                    crate::services::correction::align::SpanOperation::Delete => {
                        SpanOperation::Delete
                    }
                }),
                context_left: None,
                context_right: None,
                span_start: Some(span.source_start),
                span_end: Some(span.source_end),
            },
            condition: TrainingSampleCondition {
                source_profile_version: event.source_profile_version,
                profile_version_ref: event.source_profile_version,
                phonetic_profile_not_acoustically_realized: None,
                user_condition_ref: None,
                condition_masks: None,
            },
            target: TrainingSampleTarget {
                target_span: span.target_text.clone(),
            },
            metadata: TrainingSampleMetadata {
                source_type: TrainingSourceType::RealUserCorrection,
                sample_kind: TrainingSampleKind::Positive,
                correction_event_id: event.event_id.clone(),
                user_group_key: hash_user_group(&event.user_id),
                target_term,
                domain: None,
                normalizer_version: NORMALIZER_VERSION.to_string(),
                extractor_version: EXTRACTOR_VERSION.to_string(),
                pipeline_version: event.pipeline_version.clone(),
                created_at: event.created_at,
                superseded_for_profile: exclude,
                exclude_from_default_positive_export: exclude,
                synthetic: None,
                training: None,
            },
        });
    }
    // Contract placeholder: empty list can still represent negative/hard-negative kinds.
    let _ = TrainingSampleKind::Negative;
    let _ = TrainingSampleKind::HardNegative;
    out
}

/// Opaque grouping key — not the raw user_id as model feature.
pub fn hash_user_group(user_id: &str) -> String {
    let h = fxhash::hash64(user_id.as_bytes());
    format!("ug-{:016x}", h)
}

/// Default positive export filter.
pub fn default_positive_export(samples: &[TrainingSampleV1]) -> Vec<&TrainingSampleV1> {
    samples
        .iter()
        .filter(|s| {
            s.metadata.sample_kind == TrainingSampleKind::Positive
                && !s.metadata.exclude_from_default_positive_export
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::correction::features::extract_features_with_texts;
    use crate::services::correction::normalizer::normalize_event;
    use crate::services::correction::{new_event_from_request, SubmitCorrectionRequest};

    fn mk(system: &str, corrected: &str) -> CorrectionEventV1 {
        new_event_from_request(SubmitCorrectionRequest {
            user_id: "user-secret".into(),
            session_id: "s-1".into(),
            utterance_index: 0,
            system_text: system.into(),
            corrected_text: corrected.into(),
            corrections: vec![],
            source_profile_version: Some(3),
            pipeline_version: Some("pipe".into()),
            idempotency_key: "k".into(),
        })
        .unwrap()
    }

    #[test]
    fn builds_positive_with_provenance() {
        let ev = mk("米福", "米尔福德");
        let n = normalize_event(&ev, false);
        let f = extract_features_with_texts(&n.correction_spans, &ev.system_text, &ev.corrected_text);
        let samples = build_training_samples(&ev, &n, &f);
        assert!(!samples.is_empty());
        let s = &samples[0];
        assert_eq!(s.metadata.source_type, TrainingSourceType::RealUserCorrection);
        assert_eq!(s.metadata.correction_event_id, ev.event_id);
        assert!(!s.metadata.user_group_key.contains("user-secret"));
        assert_eq!(s.condition.profile_version_ref, Some(3));
        assert!(s.input.available_tone_info.is_none());
    }

    #[test]
    fn superseded_excluded_from_default_export() {
        let ev = mk("a", "b");
        let n = normalize_event(&ev, true);
        let f = extract_features_with_texts(&n.correction_spans, &ev.system_text, &ev.corrected_text);
        let samples = build_training_samples(&ev, &n, &f);
        assert!(default_positive_export(&samples).is_empty());
        assert!(samples.iter().all(|s| s.metadata.exclude_from_default_positive_export));
    }

    #[test]
    fn negative_kinds_representable() {
        let ev = mk("x", "y");
        let n = normalize_event(&ev, false);
        let f = extract_features_with_texts(&n.correction_spans, &ev.system_text, &ev.corrected_text);
        let mut s = build_training_samples(&ev, &n, &f).remove(0);
        s.metadata.sample_kind = TrainingSampleKind::HardNegative;
        assert_eq!(s.metadata.sample_kind, TrainingSampleKind::HardNegative);
    }

    #[test]
    fn synthetic_source_types_serialize() {
        let v = serde_json::to_value(TrainingSourceType::TtsAsrSynthetic).unwrap();
        assert_eq!(v, serde_json::json!("TTS_ASR_SYNTHETIC"));
        let v2 = serde_json::to_value(TrainingSourceType::RuleSynthetic).unwrap();
        assert_eq!(v2, serde_json::json!("RULE_SYNTHETIC"));
        let v3 = serde_json::to_value(TrainingSourceType::TtsPronunciationCorrupted).unwrap();
        assert_eq!(v3, serde_json::json!("TTS_PRONUNCIATION_CORRUPTED"));
        let back: TrainingSourceType =
            serde_json::from_value(serde_json::json!("REAL_USER_CORRECTION")).unwrap();
        assert_eq!(back, TrainingSourceType::RealUserCorrection);
    }

    #[test]
    fn v11_optional_fields_roundtrip() {
        let json = serde_json::json!({
            "schema_version": 1,
            "sample_id": "ts-test",
            "input": {
                "source_span": "兰宁",
                "local_context": "我想去兰宁",
                "source_pinyin": "lan|ning",
                "available_tone_info": null,
                "span_operation": "REPLACE",
                "context_left": "我想去",
                "context_right": ""
            },
            "condition": {
                "source_profile_version": null,
                "profile_version_ref": null,
                "phonetic_profile_not_acoustically_realized": true,
                "user_condition_ref": "pseudo-g00",
                "condition_masks": {
                    "phonetic_mask": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
                    "tone_mask": [0,0,0,0,0,0,0,0,0,0,0,0],
                    "domain_mask": [0,0,0,0,0,0,0,0,0,0,0,0],
                    "profile_available": 0,
                    "phonetic_profile_acoustically_realized": 0
                }
            },
            "target": { "target_span": "南宁" },
            "metadata": {
                "source_type": "TTS_ASR_SYNTHETIC",
                "sample_kind": "POSITIVE",
                "correction_event_id": "e1",
                "user_group_key": "ug-1",
                "target_term": "南宁",
                "domain": null,
                "normalizer_version": "corr-normalizer-v1",
                "extractor_version": "model2-synth-extractor-v1",
                "pipeline_version": "model2-synth-generator-v1",
                "created_at": "2026-08-12T00:00:00Z",
                "superseded_for_profile": false,
                "exclude_from_default_positive_export": false,
                "synthetic": { "generator_version": "model2-synth-generator-v1" },
                "training": {
                    "fuzzy_pool_term_ids": ["domain:tourism_route:南宁:nan|ning"],
                    "target_term_id": "domain:tourism_route:南宁:nan|ning",
                    "fuzzy_pool_version": "fuzzy-pool-v1",
                    "candidate_index_version": "cand-index-v1"
                }
            }
        });
        let s: TrainingSampleV1 = serde_json::from_value(json).unwrap();
        assert_eq!(s.input.span_operation, Some(SpanOperation::Replace));
        assert_eq!(s.condition.user_condition_ref.as_deref(), Some("pseudo-g00"));
        assert_eq!(
            s.metadata
                .training
                .as_ref()
                .unwrap()
                .fuzzy_pool_version
                .as_deref(),
            Some("fuzzy-pool-v1")
        );
        let masks = s.condition.condition_masks.as_ref().unwrap();
        assert_eq!(masks.phonetic_mask.len(), 16);
        assert_eq!(masks.tone_mask.len(), 12);
        let back = serde_json::to_value(&s).unwrap();
        let s2: TrainingSampleV1 = serde_json::from_value(back).unwrap();
        assert_eq!(s, s2);
    }
}
