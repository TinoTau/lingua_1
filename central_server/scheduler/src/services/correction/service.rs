use super::features::extract_features_with_texts;
use super::normalizer::normalize_event;
use super::profile_delta::build_profile_delta;
use super::training_sample::build_training_samples;
use super::{
    new_event_from_request, CorrectionDiagnosticsSummary, CorrectionError, CorrectionRepository,
    SubmitCorrectionRequest, SubmitCorrectionResponse,
};
use std::sync::Arc;
use tracing::info;

pub struct CorrectionService {
    repo: Arc<dyn CorrectionRepository>,
}

impl CorrectionService {
    pub fn new(repo: Arc<dyn CorrectionRepository>) -> Self {
        Self { repo }
    }

    pub fn submit(
        &self,
        req: SubmitCorrectionRequest,
    ) -> Result<SubmitCorrectionResponse, CorrectionError> {
        if let Some(existing) = self
            .repo
            .find_by_idempotency(&req.user_id, &req.idempotency_key)?
        {
            // Rebuild derived artifacts for response; do not mutate fact; no new profile apply signal
            // for duplicates (Gateway must also guard same event_id).
            let peers = self.repo.find_by_utterance(
                &existing.user_id,
                &existing.session_id,
                existing.utterance_index,
            )?;
            let superseded = peers
                .first()
                .map(|latest| latest.event_id != existing.event_id)
                .unwrap_or(false);
            let normalized = normalize_event(&existing, superseded);
                let features = extract_features_with_texts(
                    &normalized.correction_spans,
                    &existing.system_text,
                    &existing.corrected_text,
                );
            let samples = build_training_samples(&existing, &normalized, &features);
            let delta = build_profile_delta(
                &normalized,
                &features,
                existing.source_profile_version,
            );
            return Ok(SubmitCorrectionResponse {
                correction_id: existing.event_id.clone(),
                accepted: true,
                duplicate: true,
                // Duplicate must not re-apply profile; return delta only as diagnostic rebuild
                // with superseded forcing empty updates when not active, else Gateway skips by event_id.
                profile_delta: Some(delta),
                diagnostics: Some(CorrectionDiagnosticsSummary {
                    correction_event_id: existing.event_id,
                    normalizer_version: normalized.normalizer_version,
                    span_count: normalized.correction_spans.len(),
                    feature_extractor_version: features.extractor_version,
                    profile_delta_generated: true,
                    superseded_for_profile: superseded,
                    training_sample_count: samples.len(),
                    base_profile_version: existing.source_profile_version,
                }),
            });
        }

        let event = new_event_from_request(req)?;
        self.repo.insert(&event)?;

        // After insert, this event is the newest for the utterance (created_at now).
        // Older peers remain facts but are superseded_for_profile.
        let peers = self.repo.find_by_utterance(
            &event.user_id,
            &event.session_id,
            event.utterance_index,
        )?;
        let superseded = false; // newly inserted is active for profile
        let _older_count = peers.iter().filter(|e| e.event_id != event.event_id).count();

        let normalized = normalize_event(&event, superseded);
        let features = extract_features_with_texts(
            &normalized.correction_spans,
            &event.system_text,
            &event.corrected_text,
        );
        let samples = build_training_samples(&event, &normalized, &features);
        let delta = build_profile_delta(&normalized, &features, event.source_profile_version);

        info!(
            event_id = %event.event_id,
            spans = normalized.correction_spans.len(),
            superseded_for_profile = superseded,
            phonetic_updates = delta.phonetic_updates.len(),
            term_updates = delta.personal_term_updates.len(),
            training_samples = samples.len(),
            "correction normalized; profile_delta derived"
        );

        Ok(SubmitCorrectionResponse {
            correction_id: event.event_id.clone(),
            accepted: true,
            duplicate: false,
            profile_delta: Some(delta),
            diagnostics: Some(CorrectionDiagnosticsSummary {
                correction_event_id: event.event_id,
                normalizer_version: normalized.normalizer_version,
                span_count: normalized.correction_spans.len(),
                feature_extractor_version: features.extractor_version,
                profile_delta_generated: true,
                superseded_for_profile: superseded,
                training_sample_count: samples.len(),
                base_profile_version: event.source_profile_version,
            }),
        })
    }
}
