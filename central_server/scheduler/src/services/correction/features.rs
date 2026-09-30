//! CorrectionFeatures V1 — explainable, deterministic; never fabricates acoustic tone.

use serde::{Deserialize, Serialize};

use super::align::{AlignedCorrectionSpan, SpanOperation};
use super::feature_schema::{self, FEATURE_SCHEMA_VERSION};

pub const EXTRACTOR_VERSION: &str = "corr-feature-extractor-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpanTextFeatures {
    pub source_text: String,
    pub target_text: String,
    pub source_length: usize,
    pub target_length: usize,
    pub operation: SpanOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PhoneticSpanFeatures {
    pub source_syllable: Option<String>,
    pub target_syllable: Option<String>,
    pub feature_key: Option<String>,
    pub unsupported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToneSpanFeatures {
    /// Always null in V1 unless CorrectionEvent carries observed acoustic tone (it does not).
    pub observed_acoustic_tone: Option<serde_json::Value>,
    pub lexical_tone: Option<serde_json::Value>,
    pub unavailable_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TermSpanFeatures {
    pub candidate_term: Option<String>,
    pub is_personal_term_candidate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DomainSpanFeatures {
    pub domain: Option<String>,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpanFeatureBundle {
    pub text: SpanTextFeatures,
    pub phonetic: PhoneticSpanFeatures,
    pub tone: ToneSpanFeatures,
    pub term: TermSpanFeatures,
    pub domain: DomainSpanFeatures,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CorrectionFeatures {
    pub extractor_version: String,
    pub feature_schema_version: String,
    pub spans: Vec<SpanFeatureBundle>,
}

pub fn extract_features(spans: &[AlignedCorrectionSpan]) -> CorrectionFeatures {
    extract_features_with_texts(spans, "", "")
}

pub fn extract_features_with_texts(
    spans: &[AlignedCorrectionSpan],
    system_text: &str,
    corrected_text: &str,
) -> CorrectionFeatures {
    let mut bundles: Vec<SpanFeatureBundle> = spans.iter().map(extract_span).collect();
    if !bundles.iter().any(|b| b.term.is_personal_term_candidate) {
        if let Some(term) = extract_macro_term_candidate(system_text, corrected_text) {
            // Attach to first REPLACE/INSERT span or synthesize via last span term field
            if let Some(b) = bundles.iter_mut().find(|b| {
                matches!(
                    b.text.operation,
                    SpanOperation::Replace | SpanOperation::Insert
                )
            }) {
                b.term = TermSpanFeatures {
                    candidate_term: Some(term),
                    is_personal_term_candidate: true,
                };
            }
        }
    }
    CorrectionFeatures {
        extractor_version: EXTRACTOR_VERSION.to_string(),
        feature_schema_version: FEATURE_SCHEMA_VERSION.to_string(),
        spans: bundles,
    }
}

fn extract_span(span: &AlignedCorrectionSpan) -> SpanFeatureBundle {
    let text = SpanTextFeatures {
        source_text: span.source_text.clone(),
        target_text: span.target_text.clone(),
        source_length: span.source_text.chars().count(),
        target_length: span.target_text.chars().count(),
        operation: span.operation,
    };
    let phonetic = extract_phonetic(&span.source_text, &span.target_text, span.operation);
    let tone = ToneSpanFeatures {
        observed_acoustic_tone: None,
        lexical_tone: None,
        unavailable_reason: "NO_OBSERVED_ACOUSTIC_TONE_ON_CORRECTION_EVENT".into(),
    };
    let term = extract_term(span);
    let domain = DomainSpanFeatures {
        domain: None,
        unavailable_reason: Some("NO_DOMAIN_ON_CORRECTION_EVENT".into()),
    };
    SpanFeatureBundle {
        text,
        phonetic,
        tone,
        term,
        domain,
    }
}

/// Phonetic extraction without Node pinyin runtime:
/// only when both sides are ASCII syllable-like tokens; else unsupported (do not grow schema).
fn extract_phonetic(source: &str, target: &str, op: SpanOperation) -> PhoneticSpanFeatures {
    if op != SpanOperation::Replace {
        return PhoneticSpanFeatures {
            source_syllable: None,
            target_syllable: None,
            feature_key: None,
            unsupported: false,
        };
    }
    let s = normalize_syllable_token(source);
    let t = normalize_syllable_token(target);
    if s.is_none() || t.is_none() {
        return PhoneticSpanFeatures {
            source_syllable: None,
            target_syllable: None,
            feature_key: None,
            unsupported: true, // CJK / mixed without romanization utility in Scheduler
        };
    }
    let s = s.unwrap();
    let t = t.unwrap();
    let key = feature_schema::match_phonetic_pair(&s, &t);
    PhoneticSpanFeatures {
        source_syllable: Some(s),
        target_syllable: Some(t),
        feature_key: key.map(|k| k.to_string()),
        unsupported: key.is_none(),
    }
}

fn normalize_syllable_token(s: &str) -> Option<String> {
    let t = s.trim().to_lowercase();
    if t.is_empty() {
        return None;
    }
    if !t.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    // single syllable-ish token, length bound
    if t.len() > 8 {
        return None;
    }
    Some(t)
}

fn extract_term(span: &AlignedCorrectionSpan) -> TermSpanFeatures {
    // Candidate surface only — Gateway Lexicon resolve decides identity.
    // Free-text is NOT authoritative personal_term identity.
    let candidate = match span.operation {
        SpanOperation::Replace | SpanOperation::Insert => {
            let t = span.target_text.trim();
            let n = t.chars().count();
            // Prefer multi-char candidates for lexical writeback resolution.
            if n >= 2 {
                Some(t.to_string())
            } else {
                None
            }
        }
        SpanOperation::Delete => None,
    };
    TermSpanFeatures {
        is_personal_term_candidate: candidate.is_some(),
        candidate_term: candidate,
    }
}

/// Extra term candidate from whole corrected novel region when span-level targets are too short
/// (common for Chinese char-by-char inserts).
pub fn extract_macro_term_candidate(system: &str, corrected: &str) -> Option<String> {
    let s = system.trim();
    let c = corrected.trim();
    if c.chars().count() < 2 || s == c {
        return None;
    }
    // If corrected contains system as contiguous subsequence loosely — use full corrected if short
    if c.chars().count() <= 16 && c.chars().count() > s.chars().count() {
        return Some(c.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::correction::align::align_codepoints;

    #[test]
    fn known_phonetic_confusion() {
        let spans = align_codepoints("na", "la");
        let f = extract_features(&spans);
        assert_eq!(f.spans[0].phonetic.feature_key.as_deref(), Some("n_l"));
        assert!(!f.spans[0].phonetic.unsupported);
    }

    #[test]
    fn unsupported_cjk_without_pinyin() {
        let spans = align_codepoints("那", "拉");
        let f = extract_features(&spans);
        assert!(f.spans[0].phonetic.unsupported);
        assert!(f.spans[0].phonetic.feature_key.is_none());
    }

    #[test]
    fn tone_never_fabricated() {
        let spans = align_codepoints("你好", "您好");
        let f = extract_features(&spans);
        for s in &f.spans {
            assert!(s.tone.observed_acoustic_tone.is_none());
            assert!(s.tone.unavailable_reason.contains("NO_OBSERVED"));
        }
    }

    #[test]
    fn personal_term_candidate() {
        let spans = align_codepoints("米福", "米尔福德");
        let f = extract_features_with_texts(&spans, "米福", "米尔福德");
        assert!(f.spans.iter().any(|s| s.term.is_personal_term_candidate));
    }

    #[test]
    fn domain_missing() {
        let spans = align_codepoints("a", "b");
        let f = extract_features(&spans);
        assert!(f.spans[0].domain.domain.is_none());
    }

    #[test]
    fn deterministic() {
        let spans = align_codepoints("en", "eng");
        assert_eq!(extract_features(&spans), extract_features(&spans));
    }
}
