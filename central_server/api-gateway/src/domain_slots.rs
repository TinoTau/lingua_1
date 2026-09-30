//! Stage D domain slot contract — must match training.model2.contract.DOMAIN_SLOT_IDS.

/// Frozen 12 fine-domain slots used by Stage D long_term_domain_evidence.
pub const DOMAIN_SLOT_IDS: &[&str] = &[
    "tourism_pickup",
    "tourism_hotel",
    "tourism_route",
    "tourism_transport",
    "coffee",
    "milk_tea",
    "bakery",
    "food_order",
    "tech_ai",
    "meeting",
    "medical",
    "transport",
];

pub fn is_domain_slot(id: &str) -> bool {
    DOMAIN_SLOT_IDS.contains(&id)
}
