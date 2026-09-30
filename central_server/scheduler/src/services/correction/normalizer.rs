//! NormalizedCorrection V1 — derived from immutable CorrectionEvent.

use serde::{Deserialize, Serialize};

use super::align::{align_codepoints, AlignedCorrectionSpan, NORMALIZER_VERSION};
use super::CorrectionEventV1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NormalizedCorrection {
    pub event_id: String,
    pub user_id: String,
    pub session_id: String,
    pub utterance_index: u64,
    pub system_text: String,
    pub corrected_text: String,
    pub correction_spans: Vec<AlignedCorrectionSpan>,
    pub normalizer_version: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// True if a newer correction exists for same user/session/utterance (profile learning).
    pub superseded_for_profile: bool,
}

pub fn normalize_event(event: &CorrectionEventV1, superseded_for_profile: bool) -> NormalizedCorrection {
    let spans = align_codepoints(&event.system_text, &event.corrected_text);
    NormalizedCorrection {
        event_id: event.event_id.clone(),
        user_id: event.user_id.clone(),
        session_id: event.session_id.clone(),
        utterance_index: event.utterance_index,
        system_text: event.system_text.clone(),
        corrected_text: event.corrected_text.clone(),
        correction_spans: spans,
        normalizer_version: NORMALIZER_VERSION.to_string(),
        created_at: event.created_at,
        superseded_for_profile,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::correction::new_event_from_request;
    use crate::services::correction::SubmitCorrectionRequest;

    #[test]
    fn does_not_mutate_event_texts() {
        let ev = new_event_from_request(SubmitCorrectionRequest {
            user_id: "u".into(),
            session_id: "s-1".into(),
            utterance_index: 0,
            system_text: "系统A".into(),
            corrected_text: "纠正B".into(),
            corrections: vec![],
            source_profile_version: Some(1),
            pipeline_version: None,
            idempotency_key: "k".into(),
        })
        .unwrap();
        let n = normalize_event(&ev, false);
        assert_eq!(n.system_text, ev.system_text);
        assert_eq!(n.corrected_text, ev.corrected_text);
        assert_eq!(n.normalizer_version, NORMALIZER_VERSION);
    }
}
