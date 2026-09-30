//! ProfileDelta V1 — derived artifact, not SSOT.

use serde::{Deserialize, Serialize};

use super::feature_schema::FEATURE_SCHEMA_VERSION;
use super::features::{CorrectionFeatures, EXTRACTOR_VERSION};
use super::normalizer::NormalizedCorrection;

pub const PROFILE_DELTA_SCHEMA_VERSION: u32 = 1;
pub const PROFILE_EVIDENCE_WEIGHT: f64 = 1.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeatureUpdate {
    pub feature_key: String,
    pub evidence: f64,
    pub weight: f64,
    pub sample_count_delta: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersonalTermUpdate {
    pub term: String,
    pub evidence: f64,
    pub weight: f64,
    pub sample_count_delta: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProfileDeltaV1 {
    pub schema_version: u32,
    pub base_profile_version: Option<u64>,
    pub source_event_id: String,
    pub phonetic_updates: Vec<FeatureUpdate>,
    pub tone_updates: Vec<FeatureUpdate>,
    pub personal_term_updates: Vec<PersonalTermUpdate>,
    pub domain_updates: Vec<FeatureUpdate>,
    pub extractor_version: String,
    pub feature_schema_version: String,
    pub normalizer_version: String,
    /// When true, Gateway must not apply (superseded by newer utterance correction).
    pub superseded_for_profile: bool,
}

pub fn build_profile_delta(
    normalized: &NormalizedCorrection,
    features: &CorrectionFeatures,
    base_profile_version: Option<u64>,
) -> ProfileDeltaV1 {
    let mut phonetic_updates = Vec::new();
    let mut personal_term_updates = Vec::new();

    if !normalized.superseded_for_profile {
        for span in &features.spans {
            if let Some(ref key) = span.phonetic.feature_key {
                phonetic_updates.push(FeatureUpdate {
                    feature_key: key.clone(),
                    evidence: PROFILE_EVIDENCE_WEIGHT,
                    weight: PROFILE_EVIDENCE_WEIGHT,
                    sample_count_delta: 1,
                });
            }
            // unsupported phonetic → no structured update (raw evidence stays in CorrectionHistory)
            if let Some(ref term) = span.term.candidate_term {
                if span.term.is_personal_term_candidate {
                    personal_term_updates.push(PersonalTermUpdate {
                        term: term.clone(),
                        evidence: PROFILE_EVIDENCE_WEIGHT,
                        weight: PROFILE_EVIDENCE_WEIGHT,
                        sample_count_delta: 1,
                    });
                }
            }
        }
    }

    ProfileDeltaV1 {
        schema_version: PROFILE_DELTA_SCHEMA_VERSION,
        base_profile_version,
        source_event_id: normalized.event_id.clone(),
        phonetic_updates,
        tone_updates: vec![], // no acoustic tone evidence
        personal_term_updates,
        domain_updates: vec![], // no domain on CorrectionEvent
        extractor_version: EXTRACTOR_VERSION.to_string(),
        feature_schema_version: FEATURE_SCHEMA_VERSION.to_string(),
        normalizer_version: normalized.normalizer_version.clone(),
        superseded_for_profile: normalized.superseded_for_profile,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::correction::features::extract_features_with_texts;
    use crate::services::correction::normalizer::normalize_event;
    use crate::services::correction::{new_event_from_request, SubmitCorrectionRequest};

    fn event(system: &str, corrected: &str) -> crate::services::correction::CorrectionEventV1 {
        new_event_from_request(SubmitCorrectionRequest {
            user_id: "u".into(),
            session_id: "s-1".into(),
            utterance_index: 1,
            system_text: system.into(),
            corrected_text: corrected.into(),
            corrections: vec![],
            source_profile_version: Some(10),
            pipeline_version: Some("v4".into()),
            idempotency_key: "k".into(),
        })
        .unwrap()
    }

    #[test]
    fn single_evidence_phonetic() {
        let ev = event("na", "la");
        let n = normalize_event(&ev, false);
        let f = extract_features_with_texts(&n.correction_spans, &ev.system_text, &ev.corrected_text);
        let d = build_profile_delta(&n, &f, Some(10));
        assert!(!d.superseded_for_profile);
        assert!(d.phonetic_updates.iter().any(|u| u.feature_key == "n_l"));
    }

    #[test]
    fn superseded_skips_updates() {
        let ev = event("na", "la");
        let n = normalize_event(&ev, true);
        let f = extract_features_with_texts(&n.correction_spans, &ev.system_text, &ev.corrected_text);
        let d = build_profile_delta(&n, &f, Some(10));
        assert!(d.superseded_for_profile);
        assert!(d.phonetic_updates.is_empty());
        assert!(d.personal_term_updates.is_empty());
    }

    #[test]
    fn unsupported_no_dynamic_key() {
        let ev = event("那", "拉");
        let n = normalize_event(&ev, false);
        let f = extract_features_with_texts(&n.correction_spans, &ev.system_text, &ev.corrected_text);
        let d = build_profile_delta(&n, &f, None);
        assert!(d.phonetic_updates.is_empty());
        assert!(f.spans.iter().all(|s| s.phonetic.feature_key.is_none()));
    }
}
