use super::*;
use crate::services::correction::{
    new_event_from_request, CorrectionService, SqliteCorrectionRepository, SubmitCorrectionRequest,
};
use std::sync::Arc;

#[test]
fn service_insert_and_duplicate() {
    let repo = Arc::new(SqliteCorrectionRepository::open_in_memory().unwrap());
    let svc = CorrectionService::new(repo);
    let req = SubmitCorrectionRequest {
        user_id: "user-a".into(),
        session_id: "s-ABCDEF12".into(),
        utterance_index: 1,
        system_text: "系统".into(),
        corrected_text: "纠正".into(),
        corrections: vec![],
        source_profile_version: Some(1),
        pipeline_version: None,
        idempotency_key: "client-1".into(),
    };
    let r1 = svc.submit(req.clone()).unwrap();
    assert!(r1.accepted);
    assert!(!r1.duplicate);
    assert!(r1.profile_delta.is_some());
    assert!(r1.diagnostics.is_some());

    let r2 = svc.submit(req).unwrap();
    assert!(r2.accepted);
    assert!(r2.duplicate);
    assert_eq!(r1.correction_id, r2.correction_id);
}

#[test]
fn service_system_text_immutable_across_reedits() {
    let repo = Arc::new(SqliteCorrectionRepository::open_in_memory().unwrap());
    let svc = CorrectionService::new(repo.clone());
    let r1 = svc
        .submit(SubmitCorrectionRequest {
            user_id: "u".into(),
            session_id: "s-1".into(),
            utterance_index: 0,
            system_text: "A".into(),
            corrected_text: "B".into(),
            corrections: vec![],
            source_profile_version: None,
            pipeline_version: None,
            idempotency_key: "k1".into(),
        })
        .unwrap();
    let r2 = svc
        .submit(SubmitCorrectionRequest {
            user_id: "u".into(),
            session_id: "s-1".into(),
            utterance_index: 0,
            system_text: "A".into(),
            corrected_text: "C".into(),
            corrections: vec![],
            source_profile_version: None,
            pipeline_version: None,
            idempotency_key: "k2".into(),
        })
        .unwrap();
    assert_ne!(r1.correction_id, r2.correction_id);
    let events = repo.find_by_user("u", 10).unwrap();
    assert_eq!(events.len(), 2);
    assert!(events.iter().all(|e| e.system_text == "A"));

    // Latest is active for profile; older would be superseded if rebuilt
    let peers = repo.find_by_utterance("u", "s-1", 0).unwrap();
    assert_eq!(peers[0].event_id, r2.correction_id);
    let n_old = crate::services::correction::normalizer::normalize_event(
        &peers.iter().find(|e| e.event_id == r1.correction_id).unwrap().clone(),
        true,
    );
    assert!(n_old.superseded_for_profile);
}

#[test]
fn factory_rejects_empty_and_noop() {
    assert!(new_event_from_request(SubmitCorrectionRequest {
        user_id: "u".into(),
        session_id: "s".into(),
        utterance_index: 0,
        system_text: "".into(),
        corrected_text: "x".into(),
        corrections: vec![],
        source_profile_version: None,
        pipeline_version: None,
        idempotency_key: "k".into(),
    })
    .is_err());
}

#[test]
fn profile_delta_not_double_count_on_reedit_semantics() {
    let repo = Arc::new(SqliteCorrectionRepository::open_in_memory().unwrap());
    let svc = CorrectionService::new(repo.clone());
    let r1 = svc
        .submit(SubmitCorrectionRequest {
            user_id: "u".into(),
            session_id: "s-1".into(),
            utterance_index: 2,
            system_text: "na".into(),
            corrected_text: "la".into(),
            corrections: vec![],
            source_profile_version: Some(1),
            pipeline_version: None,
            idempotency_key: "a".into(),
        })
        .unwrap();
    let r2 = svc
        .submit(SubmitCorrectionRequest {
            user_id: "u".into(),
            session_id: "s-1".into(),
            utterance_index: 2,
            system_text: "na".into(),
            corrected_text: "ra".into(),
            corrections: vec![],
            source_profile_version: Some(1),
            pipeline_version: None,
            idempotency_key: "b".into(),
        })
        .unwrap();
    assert!(!r1.profile_delta.as_ref().unwrap().superseded_for_profile);
    // r2 is newest — active
    assert!(!r2.profile_delta.as_ref().unwrap().superseded_for_profile);
    // Rebuild older as superseded
    let old = repo.find_by_id(&r1.correction_id).unwrap().unwrap();
    let n = crate::services::correction::normalizer::normalize_event(&old, true);
    let f = crate::services::correction::features::extract_features_with_texts(
        &n.correction_spans,
        &old.system_text,
        &old.corrected_text,
    );
    let d = crate::services::correction::profile_delta::build_profile_delta(&n, &f, Some(1));
    assert!(d.superseded_for_profile);
    assert!(d.phonetic_updates.is_empty());
}
