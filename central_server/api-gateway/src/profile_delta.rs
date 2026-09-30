//! ProfileDelta apply — Gateway UserProfile SSOT only.
//! Lexical writeback: resolve against Lexicon SSOT; derive long_term_domain_evidence.
//! domain_updates from Correction are NOT Stage D knowledge writers (placeholder / soft only).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::domain_evidence::rebuild_long_term_domain_evidence;
use crate::lexical_resolve::{
    resolve_candidate_with_overlap_policy, UnresolvedLexicalObservation, MAX_UNRESOLVED_OBSERVATIONS,
};
use crate::lexicon_readonly::{surface_resolves, LexiconReadonly};
use crate::user_profile::{
    ResolvedLexicalTermStat, UnresolvedLexicalRecord, UserProfileError, UserProfileV1,
    USER_PROFILE_MAX_BYTES, USER_PROFILE_SCHEMA_VERSION,
};

pub const MAX_PERSONAL_TERMS: usize = 100;
pub const PHONETIC_EMA_ALPHA: f64 = 0.25;
/// Legacy additive increment — unused for lexicon-backed path (EMA instead).
pub const TERM_EVIDENCE_INCREMENT: f64 = 1.0;
/// Lexical evidence EMA toward 1.0 (matches phonetic style; mitigates single-correction dominance).
pub const LEXICAL_EMA_ALPHA: f64 = 0.25;
pub const BIAS_CLAMP: f64 = 5.0;
pub const MAX_LEGACY_FREE_TEXT: usize = 100;

/// Allowed phonetic keys (must match Scheduler UserFeatureSchema V1).
pub const ALLOWED_PHONETIC_KEYS: &[&str] = &[
    "n_l", "l_n", "zh_z", "z_zh", "ch_c", "c_ch", "sh_s", "s_sh", "an_ang", "ang_an", "en_eng",
    "eng_en", "in_ing", "ing_in", "f_h", "h_f",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeatureUpdate {
    pub feature_key: String,
    pub evidence: f64,
    pub weight: f64,
    pub sample_count_delta: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersonalTermUpdate {
    /// Candidate corrected surface — NOT authoritative identity until Lexicon-resolved.
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
    #[serde(default)]
    pub phonetic_updates: Vec<FeatureUpdate>,
    #[serde(default)]
    pub tone_updates: Vec<FeatureUpdate>,
    #[serde(default)]
    pub personal_term_updates: Vec<PersonalTermUpdate>,
    /// PLACEHOLDER — soft domain_bias only; NOT Lexicon knowledge / Stage D writer.
    #[serde(default)]
    pub domain_updates: Vec<FeatureUpdate>,
    pub extractor_version: String,
    pub feature_schema_version: String,
    pub normalizer_version: String,
    #[serde(default)]
    pub superseded_for_profile: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApplyDeltaResult {
    pub profile: UserProfileV1,
    pub profile_version_before: u64,
    pub profile_version_after: u64,
    pub skipped: bool,
    pub skip_reason: Option<String>,
    #[serde(default)]
    pub lexical_diagnostics: Option<serde_json::Value>,
}

fn clamp_bias(v: f64) -> f64 {
    v.max(-BIAS_CLAMP).min(BIAS_CLAMP)
}

fn ema(old: f64, evidence: f64, weight: f64) -> f64 {
    let alpha = PHONETIC_EMA_ALPHA * weight.clamp(0.0, 1.0);
    clamp_bias(old * (1.0 - alpha) + evidence * alpha)
}

fn lexical_ema(old: f64, weight: f64) -> f64 {
    let alpha = LEXICAL_EMA_ALPHA * weight.clamp(0.0, 1.0);
    (old * (1.0 - alpha) + 1.0 * alpha).clamp(0.0, 1.0)
}

/// Apply without lexicon: phonetic/tone only; lexical candidates recorded as unresolved.
pub fn apply_profile_delta(current: &UserProfileV1, delta: &ProfileDeltaV1) -> ApplyDeltaResult {
    apply_profile_delta_with_lexicon(current, delta, None)
}

/// Apply with optional Lexicon SSOT for resolve + domain evidence.
pub fn apply_profile_delta_with_lexicon(
    current: &UserProfileV1,
    delta: &ProfileDeltaV1,
    lexicon: Option<&dyn LexiconReadonly>,
) -> ApplyDeltaResult {
    let before = current.profile_version;
    if delta.superseded_for_profile {
        return ApplyDeltaResult {
            profile: current.clone(),
            profile_version_before: before,
            profile_version_after: before,
            skipped: true,
            skip_reason: Some("SUPERSEDED_FOR_PROFILE".into()),
            lexical_diagnostics: None,
        };
    }

    let mut next = current.clone();
    next.schema_version = USER_PROFILE_SCHEMA_VERSION;

    // Migrate legacy free-text evidence keys once when lexicon available
    if let Some(lex) = lexicon {
        migrate_legacy_free_text_keys(&mut next, lex);
    }

    for u in &delta.phonetic_updates {
        if !ALLOWED_PHONETIC_KEYS.contains(&u.feature_key.as_str()) {
            continue;
        }
        let old = *next.phonetic_bias.get(&u.feature_key).unwrap_or(&0.0);
        next.phonetic_bias
            .insert(u.feature_key.clone(), ema(old, u.evidence, u.weight));
    }
    for u in &delta.tone_updates {
        let old = *next.tone_bias.get(&u.feature_key).unwrap_or(&0.0);
        next.tone_bias
            .insert(u.feature_key.clone(), ema(old, u.evidence, u.weight));
    }
    // Soft domain_bias only — NOT Stage D / Lexicon knowledge writer
    for u in &delta.domain_updates {
        let old = *next.domain_bias.get(&u.feature_key).unwrap_or(&0.0);
        next.domain_bias
            .insert(u.feature_key.clone(), ema(old, u.evidence, u.weight));
    }

    let mut diag_selected = Vec::new();
    let mut diag_unresolved = Vec::new();
    let mut diag_rejected = Vec::new();

    for t in &delta.personal_term_updates {
        let candidate = t.term.trim();
        if candidate.is_empty() {
            continue;
        }
        match lexicon {
            Some(lex) => match resolve_candidate_with_overlap_policy(lex, candidate) {
                Ok(trace) => {
                    for obs in &trace.selected {
                        bump_resolved_term(&mut next, obs.term_id.as_str(), obs.surface.as_str(), t.weight);
                        diag_selected.push(serde_json::json!({
                            "term_id": obs.term_id,
                            "surface": obs.surface,
                            "domain_tags": obs.domain_tags,
                        }));
                    }
                    for r in &trace.rejected_overlapping {
                        diag_rejected.push(serde_json::json!({
                            "surface": r.surface,
                            "reason": "REJECTED_OVERLAP_COVERED",
                        }));
                    }
                    for u in &trace.unresolved {
                        record_unresolved(&mut next, u, Some(&delta.source_event_id));
                        diag_unresolved.push(serde_json::json!({
                            "surface": u.surface,
                            "reason": u.reason,
                        }));
                    }
                }
                Err(e) => {
                    // Lexical failure must not block phonetic — record diagnostic
                    let u = UnresolvedLexicalObservation {
                        surface: candidate.to_string(),
                        reason: format!("RESOLVE_ERROR:{e}"),
                        source_candidate: candidate.to_string(),
                    };
                    record_unresolved(&mut next, &u, Some(&delta.source_event_id));
                    diag_unresolved.push(serde_json::json!({"surface": candidate, "reason": e}));
                }
            },
            None => {
                let u = UnresolvedLexicalObservation {
                    surface: candidate.to_string(),
                    reason: "LEXICON_UNAVAILABLE".into(),
                    source_candidate: candidate.to_string(),
                };
                record_unresolved(&mut next, &u, Some(&delta.source_event_id));
                diag_unresolved.push(serde_json::json!({
                    "surface": candidate,
                    "reason": "LEXICON_UNAVAILABLE",
                }));
            }
        }
    }

    rebuild_personal_terms_topk(&mut next);

    if let Some(lex) = lexicon {
        // Bounded rebuild from TopK resolved term_id evidence (not full history scan)
        match rebuild_long_term_domain_evidence(&next.personal_term_evidence, lex) {
            Ok(ev) => next.long_term_domain_evidence = ev,
            Err(e) => {
                tracing::warn!(error = %e, "domain evidence rebuild failed; keeping prior");
            }
        }
    }

    next.profile_version = before + 1;
    enforce_size_bound(&mut next);

    let lexical_diagnostics = Some(serde_json::json!({
        "selected": diag_selected,
        "rejected_overlapping": diag_rejected,
        "unresolved": diag_unresolved,
        "domain_updates_as_knowledge_writer": false,
    }));

    ApplyDeltaResult {
        profile: next.clone(),
        profile_version_before: before,
        profile_version_after: next.profile_version,
        skipped: false,
        skip_reason: None,
        lexical_diagnostics,
    }
}

fn bump_resolved_term(profile: &mut UserProfileV1, term_id: &str, surface: &str, weight: f64) {
    let old = profile
        .resolved_lexical_terms
        .get(term_id)
        .map(|s| s.evidence)
        .unwrap_or(0.0);
    let count = profile
        .resolved_lexical_terms
        .get(term_id)
        .map(|s| s.confirm_count)
        .unwrap_or(0)
        + 1;
    let evidence = lexical_ema(old, weight);
    profile.resolved_lexical_terms.insert(
        term_id.to_string(),
        ResolvedLexicalTermStat {
            term_id: term_id.to_string(),
            surface: surface.to_string(),
            evidence,
            confirm_count: count,
        },
    );
    profile
        .personal_term_evidence
        .insert(term_id.to_string(), evidence);
}

fn record_unresolved(
    profile: &mut UserProfileV1,
    u: &UnresolvedLexicalObservation,
    event_id: Option<&str>,
) {
    // Dedup by surface
    if let Some(existing) = profile
        .unresolved_lexical_observations
        .iter_mut()
        .find(|r| r.surface == u.surface)
    {
        existing.reason = u.reason.clone();
        existing.last_event_id = event_id.map(|s| s.to_string());
    } else {
        profile.unresolved_lexical_observations.push(UnresolvedLexicalRecord {
            surface: u.surface.clone(),
            reason: u.reason.clone(),
            last_event_id: event_id.map(|s| s.to_string()),
        });
    }
    if profile.unresolved_lexical_observations.len() > MAX_UNRESOLVED_OBSERVATIONS {
        let n = profile.unresolved_lexical_observations.len() - MAX_UNRESOLVED_OBSERVATIONS;
        profile.unresolved_lexical_observations.drain(0..n);
    }
}

/// Convert legacy free-text evidence keys to term_id when exact Lexicon match exists.
pub fn migrate_legacy_free_text_keys(profile: &mut UserProfileV1, lexicon: &dyn LexiconReadonly) {
    let keys: Vec<(String, f64)> = profile
        .personal_term_evidence
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    let mut new_evidence = HashMap::new();
    let mut legacy = profile.legacy_free_text_personal_terms.clone();

    for (key, ev) in keys {
        // Already a known resolved term_id
        if profile.resolved_lexical_terms.contains_key(&key) {
            new_evidence.insert(key, ev);
            continue;
        }
        if let Some(hit) = surface_resolves(lexicon, &key) {
            let evidence = ev.clamp(0.0, 1.0);
            new_evidence.insert(hit.term_id.clone(), evidence);
            profile.resolved_lexical_terms.insert(
                hit.term_id.clone(),
                ResolvedLexicalTermStat {
                    term_id: hit.term_id.clone(),
                    surface: hit.surface.clone(),
                    evidence,
                    confirm_count: 1.max((evidence / LEXICAL_EMA_ALPHA).round() as u32),
                },
            );
        } else if key.starts_with("term-") || key.contains('_') && key.len() > 12 {
            // Heuristic: looks like term_id — keep if we can load tags (even empty)
            if lexicon.domain_tags_for_term(&key).is_ok() {
                new_evidence.insert(key, ev.clamp(0.0, 1.0));
            } else if !legacy.contains(&key) {
                legacy.push(key);
            }
        } else {
            // Free-text historical — do not treat as resolved identity
            if !legacy.contains(&key) {
                legacy.push(key);
            }
        }
    }

    if legacy.len() > MAX_LEGACY_FREE_TEXT {
        legacy.truncate(MAX_LEGACY_FREE_TEXT);
    }
    profile.legacy_free_text_personal_terms = legacy;
    profile.personal_term_evidence = new_evidence;
    rebuild_personal_terms_topk(profile);
    if let Ok(ev) = rebuild_long_term_domain_evidence(&profile.personal_term_evidence, lexicon) {
        profile.long_term_domain_evidence = ev;
    }
    profile.schema_version = USER_PROFILE_SCHEMA_VERSION;
}

fn rebuild_personal_terms_topk(profile: &mut UserProfileV1) {
    // Rank by evidence using resolved_lexical_terms when present
    let mut items: Vec<(String, String, f64)> = Vec::new();
    if !profile.resolved_lexical_terms.is_empty() {
        for (tid, st) in &profile.resolved_lexical_terms {
            let ev = *profile
                .personal_term_evidence
                .get(tid)
                .unwrap_or(&st.evidence);
            items.push((tid.clone(), st.surface.clone(), ev));
        }
    } else {
        for (tid, ev) in &profile.personal_term_evidence {
            items.push((tid.clone(), tid.clone(), *ev));
        }
    }
    items.sort_by(|a, b| {
        b.2.partial_cmp(&a.2)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });
    if items.len() > MAX_PERSONAL_TERMS {
        items.truncate(MAX_PERSONAL_TERMS);
    }
    let keep: std::collections::HashSet<String> = items.iter().map(|i| i.0.clone()).collect();
    profile
        .personal_term_evidence
        .retain(|k, _| keep.contains(k));
    profile
        .resolved_lexical_terms
        .retain(|k, _| keep.contains(k));
    // personal_terms = canonical surfaces for Stage D train-compatible lexical list
    profile.personal_terms = items.into_iter().map(|(_, surface, _)| surface).collect();
}

fn enforce_size_bound(profile: &mut UserProfileV1) {
    while profile.serialize_checked().is_err() {
        // Prefer dropping unresolved / legacy first
        if !profile.unresolved_lexical_observations.is_empty() {
            profile.unresolved_lexical_observations.pop();
            continue;
        }
        if !profile.legacy_free_text_personal_terms.is_empty() {
            profile.legacy_free_text_personal_terms.pop();
            continue;
        }
        if let Some((victim, _)) = profile
            .personal_term_evidence
            .iter()
            .min_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, v)| (k.clone(), *v))
        {
            profile.personal_term_evidence.remove(&victim);
            profile.resolved_lexical_terms.remove(&victim);
            rebuild_personal_terms_topk(profile);
        } else {
            break;
        }
    }
    let _ = profile.serialize_checked().map_err(|e| {
        tracing::error!(error = %e, "profile still exceeds 32KiB after eviction");
        e
    });
}

pub fn validate_profile_bound(profile: &UserProfileV1) -> Result<(), UserProfileError> {
    profile.serialize_checked().map(|_| ())?;
    if profile.personal_terms.len() > MAX_PERSONAL_TERMS {
        return Err(UserProfileError::Storage(format!(
            "personal_terms {} > MAX {}",
            profile.personal_terms.len(),
            MAX_PERSONAL_TERMS
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexicon_readonly::MemoryLexicon;
    use std::sync::Arc;

    fn delta_phonetic(event: &str, key: &str) -> ProfileDeltaV1 {
        ProfileDeltaV1 {
            schema_version: 1,
            base_profile_version: Some(0),
            source_event_id: event.into(),
            phonetic_updates: vec![FeatureUpdate {
                feature_key: key.into(),
                evidence: 1.0,
                weight: 1.0,
                sample_count_delta: 1,
            }],
            tone_updates: vec![],
            personal_term_updates: vec![],
            domain_updates: vec![],
            extractor_version: "v1".into(),
            feature_schema_version: "user-feature-schema-v1".into(),
            normalizer_version: "corr-normalizer-v1".into(),
            superseded_for_profile: false,
        }
    }

    fn delta_term(event: &str, term: &str) -> ProfileDeltaV1 {
        ProfileDeltaV1 {
            schema_version: 1,
            base_profile_version: None,
            source_event_id: event.into(),
            phonetic_updates: vec![],
            tone_updates: vec![],
            personal_term_updates: vec![PersonalTermUpdate {
                term: term.into(),
                evidence: 1.0,
                weight: 1.0,
                sample_count_delta: 1,
            }],
            domain_updates: vec![],
            extractor_version: "v1".into(),
            feature_schema_version: "s".into(),
            normalizer_version: "n".into(),
            superseded_for_profile: false,
        }
    }

    fn test_lex() -> MemoryLexicon {
        let mut m = MemoryLexicon::new();
        m.insert_term("id-jk", "接口", &["tech_ai"]);
        m.insert_term("id-wd", "文档", &["tech_ai", "meeting"]);
        m.insert_term("id-jkwd", "接口文档", &["tech_ai"]);
        m.insert_term("id-zb", "中杯", &["coffee", "milk_tea", "food_order"]);
        for i in 0..120 {
            m.insert_term(&format!("id-{i}"), &format!("词条{i}"), &["tech_ai"]);
        }
        m
    }

    #[test]
    fn single_and_repeated_evidence() {
        let p0 = UserProfileV1::empty_default();
        let r1 = apply_profile_delta(&p0, &delta_phonetic("e1", "n_l"));
        assert_eq!(r1.profile_version_after, 1);
        let v1 = *r1.profile.phonetic_bias.get("n_l").unwrap();
        let r2 = apply_profile_delta(&r1.profile, &delta_phonetic("e2", "n_l"));
        let v2 = *r2.profile.phonetic_bias.get("n_l").unwrap();
        assert!(v2 > v1);
    }

    #[test]
    fn lexicon_resolve_and_domain_evidence() {
        let lex = test_lex();
        let p0 = UserProfileV1::empty_default();
        let r = apply_profile_delta_with_lexicon(&p0, &delta_term("e1", "接口"), Some(&lex));
        assert!(r.profile.resolved_lexical_terms.contains_key("id-jk"));
        assert_eq!(r.profile.personal_terms, vec!["接口".to_string()]);
        assert!(r.profile.long_term_domain_evidence.get("tech_ai").copied().unwrap_or(0.0) > 0.9);
        assert!(r.profile.unresolved_lexical_observations.is_empty());
    }

    #[test]
    fn unknown_not_in_domain_evidence() {
        let lex = test_lex();
        let p0 = UserProfileV1::empty_default();
        let r = apply_profile_delta_with_lexicon(&p0, &delta_term("e1", "米尔福德"), Some(&lex));
        assert!(r.profile.personal_terms.is_empty());
        assert!(!r.profile.unresolved_lexical_observations.is_empty());
        assert!(r.profile.long_term_domain_evidence.values().all(|v| *v == 0.0)
            || r.profile.long_term_domain_evidence.is_empty()
            || r.profile.long_term_domain_evidence.values().sum::<f64>() == 0.0);
    }

    #[test]
    fn phrase_no_triple_count() {
        let lex = test_lex();
        let p0 = UserProfileV1::empty_default();
        let r = apply_profile_delta_with_lexicon(&p0, &delta_term("e1", "接口文档"), Some(&lex));
        assert_eq!(r.profile.resolved_lexical_terms.len(), 1);
        assert!(r.profile.resolved_lexical_terms.contains_key("id-jkwd"));
    }

    #[test]
    fn repeat_ema_monotonic_less_than_saturated() {
        let lex = test_lex();
        let mut p = UserProfileV1::empty_default();
        let mut last = 0.0;
        for i in 0..5 {
            let r = apply_profile_delta_with_lexicon(&p, &delta_term(&format!("e{i}"), "接口"), Some(&lex));
            p = r.profile;
            let e = p.resolved_lexical_terms["id-jk"].evidence;
            assert!(e > last);
            last = e;
        }
        let e1 = {
            let mut p0 = UserProfileV1::empty_default();
            let r = apply_profile_delta_with_lexicon(&p0, &delta_term("x", "接口"), Some(&lex));
            r.profile.resolved_lexical_terms["id-jk"].evidence
        };
        assert!(e1 < last);
        assert!(e1 < 0.5); // single correction not dominant
        assert!((last - 1.0).abs() > 0.01 || last <= 1.0);
    }

    #[test]
    fn multitag_zhongbei() {
        let lex = test_lex();
        let r = apply_profile_delta_with_lexicon(
            &UserProfileV1::empty_default(),
            &delta_term("e1", "中杯"),
            Some(&lex),
        );
        let ev = &r.profile.long_term_domain_evidence;
        let a = ev["coffee"];
        let b = ev["milk_tea"];
        let c = ev["food_order"];
        assert!((a - b).abs() < 1e-9 && (a - c).abs() < 1e-9);
    }

    #[test]
    fn personal_term_topk_with_lexicon() {
        let lex = test_lex();
        let mut p = UserProfileV1::empty_default();
        for i in 0..(MAX_PERSONAL_TERMS + 20) {
            let r = apply_profile_delta_with_lexicon(&p, &delta_term(&format!("e{i}"), &format!("词条{i}")), Some(&lex));
            p = r.profile;
        }
        assert!(p.personal_terms.len() <= MAX_PERSONAL_TERMS);
        assert!(p.serialize_checked().unwrap().len() <= USER_PROFILE_MAX_BYTES);
    }

    #[test]
    fn superseded_skipped() {
        let p0 = UserProfileV1::empty_default();
        let mut d = delta_phonetic("e1", "n_l");
        d.superseded_for_profile = true;
        let r = apply_profile_delta(&p0, &d);
        assert!(r.skipped);
        assert_eq!(r.profile_version_after, 0);
    }

    #[test]
    fn no_lexicon_does_not_store_free_text_as_identity() {
        let r = apply_profile_delta(
            &UserProfileV1::empty_default(),
            &delta_term("e1", "接口"),
        );
        assert!(r.profile.personal_terms.is_empty());
        assert!(!r.profile.unresolved_lexical_observations.is_empty());
    }

    #[test]
    fn _unused_arc_compile() {
        let _lex: Arc<MemoryLexicon> = Arc::new(test_lex());
    }

    /// Dump Pilot-relevant ProfileDelta parity vectors (production-authoritative).
    /// Run: `PROFILE_DELTA_PARITY_DUMP=1 cargo test dump_pilot_profile_delta_parity_vectors -- --exact --nocapture`
    #[test]
    fn dump_pilot_profile_delta_parity_vectors() {
        if std::env::var("PROFILE_DELTA_PARITY_DUMP").ok().as_deref() != Some("1") {
            return;
        }
        let out = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../training/dialog2000_v2_pilot200/parity/profile_delta_parity_vectors.json");
        if let Some(parent) = out.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut histories = Vec::new();

        // H_P0 — empty
        histories.push(serde_json::json!({
            "history_id": "H_P0",
            "stage": "P0",
            "events": [],
            "expected_profile": UserProfileV1::empty_default(),
        }));

        // H_P1 — single relation sparse
        {
            let mut p = UserProfileV1::empty_default();
            let r = apply_profile_delta(&p, &delta_phonetic_w("H_P1_e1", "n_l", 1.0, 0.4));
            p = r.profile;
            histories.push(serde_json::json!({
                "history_id": "H_P1",
                "stage": "P1",
                "events": [{"feature_key":"n_l","evidence":1.0,"weight":0.4}],
                "expected_profile": p,
            }));
        }

        // H_P2 — dual relation medium repeats
        {
            let mut p = UserProfileV1::empty_default();
            let steps = [
                ("n_l", 0.7_f64),
                ("n_l", 0.7),
                ("in_ing", 0.4),
                ("in_ing", 0.4),
            ];
            let mut events = Vec::new();
            for (i, (k, w)) in steps.iter().enumerate() {
                let r = apply_profile_delta(&p, &delta_phonetic_w(&format!("H_P2_e{i}"), k, 1.0, *w));
                p = r.profile;
                events.push(serde_json::json!({"feature_key": k, "evidence": 1.0, "weight": w}));
            }
            histories.push(serde_json::json!({
                "history_id": "H_P2",
                "stage": "P2",
                "events": events,
                "expected_profile": p,
            }));
        }

        // H_P3 — mature repeated evidence + dual
        {
            let mut p = UserProfileV1::empty_default();
            let mut events = Vec::new();
            for i in 0..6 {
                let (k, w) = if i % 2 == 0 { ("z_zh", 1.0_f64) } else { ("sh_s", 0.7) };
                let r = apply_profile_delta(&p, &delta_phonetic_w(&format!("H_P3_e{i}"), k, 1.0, w));
                p = r.profile;
                events.push(serde_json::json!({"feature_key": k, "evidence": 1.0, "weight": w}));
            }
            histories.push(serde_json::json!({
                "history_id": "H_P3",
                "stage": "P3",
                "events": events,
                "expected_profile": p,
            }));
        }

        // H_LEX — lexical resolve with MemoryLexicon (personal_terms / evidence / domain)
        {
            let lex = test_lex();
            let mut p = UserProfileV1::empty_default();
            let r1 = apply_profile_delta_with_lexicon(&p, &delta_term("H_LEX_e1", "接口"), Some(&lex));
            p = r1.profile;
            let r2 = apply_profile_delta_with_lexicon(&p, &delta_term("H_LEX_e2", "接口"), Some(&lex));
            p = r2.profile;
            let r3 = apply_profile_delta_with_lexicon(&p, &delta_phonetic_w("H_LEX_e3", "n_l", 1.0, 0.7), Some(&lex));
            p = r3.profile;
            histories.push(serde_json::json!({
                "history_id": "H_LEX",
                "stage": "P2_LEX",
                "events": [
                    {"term":"接口","weight":1.0},
                    {"term":"接口","weight":1.0},
                    {"feature_key":"n_l","evidence":1.0,"weight":0.7}
                ],
                "lexicon_fixture": {"接口":"id-jk","domains":["tech_ai"]},
                "expected_profile": p,
            }));
        }

        let doc = serde_json::json!({
            "authority": "central_server/api-gateway/src/profile_delta.rs::apply_profile_delta(_with_lexicon)",
            "generator": "dump_pilot_profile_delta_parity_vectors",
            "pilot_fields_compared": [
                "phonetic_bias",
                "personal_terms",
                "personal_term_evidence",
                "long_term_domain_evidence",
                "profile_version"
            ],
            "histories": histories,
        });
        std::fs::write(&out, serde_json::to_string_pretty(&doc).expect("json")).expect("write");
        eprintln!("wrote {}", out.display());
    }

    fn delta_phonetic_w(event: &str, key: &str, evidence: f64, weight: f64) -> ProfileDeltaV1 {
        ProfileDeltaV1 {
            schema_version: 1,
            base_profile_version: Some(0),
            source_event_id: event.into(),
            phonetic_updates: vec![FeatureUpdate {
                feature_key: key.into(),
                evidence,
                weight,
                sample_count_delta: 1,
            }],
            tone_updates: vec![],
            personal_term_updates: vec![],
            domain_updates: vec![],
            extractor_version: "v1".into(),
            feature_schema_version: "user-feature-schema-v1".into(),
            normalizer_version: "corr-normalizer-v1".into(),
            superseded_for_profile: false,
        }
    }
}
