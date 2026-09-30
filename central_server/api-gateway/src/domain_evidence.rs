//! Long-term domain evidence — production equivalent of
//! training.model2_v3.policy.multitag.aggregate_domain_evidence
//! mode = normalized_weighted_multitag.

use std::collections::HashMap;

use crate::domain_slots::DOMAIN_SLOT_IDS;
use crate::lexicon_readonly::LexiconReadonly;

/// Clamp used by Stage D training before multi-tag share.
pub const TERM_WEIGHT_CLAMP_MIN: f64 = 0.05;
pub const TERM_WEIGHT_CLAMP_MAX: f64 = 1.0;

pub fn clamp_term_weight(w: f64) -> f64 {
    w.max(TERM_WEIGHT_CLAMP_MIN).min(TERM_WEIGHT_CLAMP_MAX)
}

/// Aggregate compact long_term_domain_evidence.
///
/// For each term: share `clamp(weight)` uniformly across all domain tags ∩ DOMAIN_SLOT_IDS,
/// then L1-normalize over all slots. Never first-tag-only. Never invents tags.
pub fn aggregate_normalized_weighted_multitag(
    terms: &[(String /*term_id*/, f64 /*evidence*/)],
    lexicon: &dyn LexiconReadonly,
) -> Result<HashMap<String, f64>, String> {
    let mut scores: HashMap<String, f64> = DOMAIN_SLOT_IDS
        .iter()
        .map(|d| ((*d).to_string(), 0.0))
        .collect();

    for (term_id, evidence) in terms {
        let tags = lexicon.domain_tags_for_term(term_id)?;
        let mut tag_ids: Vec<String> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for t in tags {
            if scores.contains_key(&t.domain_id) && seen.insert(t.domain_id.clone()) {
                tag_ids.push(t.domain_id);
            }
        }
        if tag_ids.is_empty() {
            continue;
        }
        let w = clamp_term_weight(*evidence);
        let share = w / tag_ids.len() as f64;
        for d in tag_ids {
            *scores.get_mut(&d).unwrap() += share;
        }
    }

    let s: f64 = scores.values().sum();
    if s > 0.0 {
        for v in scores.values_mut() {
            *v /= s;
        }
    }
    Ok(scores)
}

/// Rebuild from resolved term_id → evidence map (bounded TopK already applied).
pub fn rebuild_long_term_domain_evidence(
    term_id_evidence: &HashMap<String, f64>,
    lexicon: &dyn LexiconReadonly,
) -> Result<HashMap<String, f64>, String> {
    let mut items: Vec<(String, f64)> = term_id_evidence
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    items.sort_by(|a, b| a.0.cmp(&b.0));
    aggregate_normalized_weighted_multitag(&items, lexicon)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexicon_readonly::MemoryLexicon;

    #[test]
    fn multitag_uniform_then_l1() {
        let mut m = MemoryLexicon::new();
        m.insert_term("t1", "中杯", &["coffee", "milk_tea", "food_order"]);
        let ev = rebuild_long_term_domain_evidence(
            &HashMap::from([("t1".into(), 1.0)]),
            &m,
        )
        .unwrap();
        let c = ev["coffee"];
        let mt = ev["milk_tea"];
        let fo = ev["food_order"];
        assert!((c - mt).abs() < 1e-9 && (c - fo).abs() < 1e-9);
        assert!((c + mt + fo - 1.0).abs() < 1e-9);
    }

    #[test]
    fn no_first_tag_only() {
        let mut m = MemoryLexicon::new();
        m.insert_term("t1", "订单", &["food_order", "meeting"]);
        let ev = rebuild_long_term_domain_evidence(
            &HashMap::from([("t1".into(), 0.5)]),
            &m,
        )
        .unwrap();
        assert!((ev["food_order"] - 0.5).abs() < 1e-9);
        assert!((ev["meeting"] - 0.5).abs() < 1e-9);
    }
}
