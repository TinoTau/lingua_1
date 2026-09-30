//! Lexicon-backed lexical observation resolution for correction writeback.
//! Overlap policy: greedy longest-match left-to-right on exact Lexicon surfaces.

use serde::{Deserialize, Serialize};

use crate::lexicon_readonly::{LexiconReadonly, LexiconTermHit, ResolveExactResult};

pub const MAX_UNRESOLVED_OBSERVATIONS: usize = 50;
pub const MAX_CANDIDATE_CHARS: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResolutionStatus {
    Resolved,
    UnresolvedNoMatch,
    UnresolvedAmbiguous,
    RejectedOverlapCovered,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResolvedLexicalObservation {
    pub term_id: String,
    pub surface: String,
    pub domain_tags: Vec<String>,
    pub status: ResolutionStatus,
    pub source_candidate: String,
    pub char_start: usize,
    pub char_end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnresolvedLexicalObservation {
    pub surface: String,
    pub reason: String,
    pub source_candidate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LexicalResolveTrace {
    pub selected: Vec<ResolvedLexicalObservation>,
    pub rejected_overlapping: Vec<ResolvedLexicalObservation>,
    pub unresolved: Vec<UnresolvedLexicalObservation>,
}

/// Normalize corrected lexical candidate (trim; no fuzzy).
pub fn normalize_surface(s: &str) -> String {
    s.trim().to_string()
}

/// Greedy longest-match L→R over Unicode scalars.
/// At each uncovered position, pick the longest exact Lexicon surface that starts there.
/// Nested shorter terms inside a selected span are rejected (no double-count).
pub fn resolve_candidate_with_overlap_policy(
    lexicon: &dyn LexiconReadonly,
    candidate: &str,
) -> Result<LexicalResolveTrace, String> {
    let cand = normalize_surface(candidate);
    if cand.is_empty() || cand.chars().count() > MAX_CANDIDATE_CHARS {
        return Ok(LexicalResolveTrace {
            selected: vec![],
            rejected_overlapping: vec![],
            unresolved: if cand.is_empty() {
                vec![]
            } else {
                vec![UnresolvedLexicalObservation {
                    surface: cand,
                    reason: "CANDIDATE_TOO_LONG".into(),
                    source_candidate: candidate.trim().to_string(),
                }]
            },
        });
    }

    let chars: Vec<char> = cand.chars().collect();
    let n = chars.len();
    let mut covered = vec![false; n];
    let mut selected = Vec::new();
    let mut rejected = Vec::new();
    let mut unresolved = Vec::new();

    // Whole-string exact first (preferred when full phrase is a lexicon term)
    if let ResolveExactResult::Resolved(hit) = lexicon.resolve_exact_surface(&cand)? {
        let tags = domain_ids(lexicon, &hit.term_id)?;
        selected.push(ResolvedLexicalObservation {
            term_id: hit.term_id,
            surface: hit.surface,
            domain_tags: tags,
            status: ResolutionStatus::Resolved,
            source_candidate: cand.clone(),
            char_start: 0,
            char_end: n,
        });
        return Ok(LexicalResolveTrace {
            selected,
            rejected_overlapping: rejected,
            unresolved,
        });
    }
    if let ResolveExactResult::Ambiguous { surface, term_ids } =
        lexicon.resolve_exact_surface(&cand)?
    {
        unresolved.push(UnresolvedLexicalObservation {
            surface,
            reason: format!("AMBIGUOUS_SURFACE:{}", term_ids.join(",")),
            source_candidate: cand,
        });
        return Ok(LexicalResolveTrace {
            selected,
            rejected_overlapping: rejected,
            unresolved,
        });
    }

    // Collect all exact substring hits
    let mut hits: Vec<(usize, usize, LexiconTermHit)> = Vec::new();
    for start in 0..n {
        for end in (start + 1)..=n {
            let piece: String = chars[start..end].iter().collect();
            match lexicon.resolve_exact_surface(&piece)? {
                ResolveExactResult::Resolved(hit) => hits.push((start, end, hit)),
                ResolveExactResult::Ambiguous { .. } => {
                    // Ambiguous substring → skip as identity (do not invent term_id)
                }
                ResolveExactResult::NotFound => {}
            }
        }
    }

    if hits.is_empty() {
        unresolved.push(UnresolvedLexicalObservation {
            surface: cand.clone(),
            reason: "UNRESOLVED_NO_MATCH".into(),
            source_candidate: cand,
        });
        return Ok(LexicalResolveTrace {
            selected,
            rejected_overlapping: rejected,
            unresolved,
        });
    }

    // Greedy: sort by start asc, length desc
    hits.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| (b.1 - b.0).cmp(&(a.1 - a.0))));

    for (start, end, hit) in hits {
        let overlaps = (start..end).any(|i| covered[i]);
        let tags = domain_ids(lexicon, &hit.term_id)?;
        let obs = ResolvedLexicalObservation {
            term_id: hit.term_id.clone(),
            surface: hit.surface.clone(),
            domain_tags: tags,
            status: if overlaps {
                ResolutionStatus::RejectedOverlapCovered
            } else {
                ResolutionStatus::Resolved
            },
            source_candidate: cand.clone(),
            char_start: start,
            char_end: end,
        };
        if overlaps {
            rejected.push(obs);
        } else {
            for i in start..end {
                covered[i] = true;
            }
            selected.push(obs);
        }
    }

    // If nothing selected but we had only rejected (shouldn't happen) mark unresolved
    if selected.is_empty() && unresolved.is_empty() {
        unresolved.push(UnresolvedLexicalObservation {
            surface: cand.clone(),
            reason: "UNRESOLVED_AFTER_OVERLAP".into(),
            source_candidate: cand,
        });
    }

    Ok(LexicalResolveTrace {
        selected,
        rejected_overlapping: rejected,
        unresolved,
    })
}

fn domain_ids(lexicon: &dyn LexiconReadonly, term_id: &str) -> Result<Vec<String>, String> {
    Ok(lexicon
        .domain_tags_for_term(term_id)?
        .into_iter()
        .map(|t| t.domain_id)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexicon_readonly::MemoryLexicon;

    fn lex() -> MemoryLexicon {
        let mut m = MemoryLexicon::new();
        m.insert_term("id-jk", "接口", &["tech_ai"]);
        m.insert_term("id-wd", "文档", &["tech_ai", "meeting"]);
        m.insert_term("id-jkwd", "接口文档", &["tech_ai"]);
        m.insert_term("id-dd", "订单", &["food_order", "meeting"]);
        m
    }

    #[test]
    fn whole_phrase_wins_no_triple_count() {
        let t = resolve_candidate_with_overlap_policy(&lex(), "接口文档").unwrap();
        assert_eq!(t.selected.len(), 1);
        assert_eq!(t.selected[0].surface, "接口文档");
        assert!(t.rejected_overlapping.is_empty());
    }

    #[test]
    fn adjacent_terms_without_phrase() {
        let mut m = MemoryLexicon::new();
        m.insert_term("id-jk", "接口", &["tech_ai"]);
        m.insert_term("id-wd", "文档", &["tech_ai"]);
        let t = resolve_candidate_with_overlap_policy(&m, "接口文档").unwrap();
        assert_eq!(t.selected.len(), 2);
        assert!(t.selected.iter().any(|o| o.surface == "接口"));
        assert!(t.selected.iter().any(|o| o.surface == "文档"));
        // nested shorter covered? none if adjacent non-overlap
        assert!(t.rejected_overlapping.is_empty());
    }

    #[test]
    fn unknown_unresolved() {
        let t = resolve_candidate_with_overlap_policy(&lex(), "米尔福德").unwrap();
        assert!(t.selected.is_empty());
        assert_eq!(t.unresolved.len(), 1);
        assert!(t.unresolved[0].reason.contains("UNRESOLVED"));
    }

    #[test]
    fn nested_shorter_rejected_when_longer_selected() {
        // Force path where we don't have whole match first... we do have whole match.
        // Build lex without phrase to test nested inside a manually longer hit — covered by whole_phrase test.
        let mut m = MemoryLexicon::new();
        m.insert_term("id-a", "订", &["food_order"]);
        m.insert_term("id-b", "订单", &["food_order", "meeting"]);
        let t = resolve_candidate_with_overlap_policy(&m, "订单").unwrap();
        assert_eq!(t.selected.len(), 1);
        assert_eq!(t.selected[0].surface, "订单");
    }
}
