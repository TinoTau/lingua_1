#[derive(Debug, Clone)]
pub(crate) struct SelectionOutcome {
    pub node_id: Option<String>,
    pub selector: &'static str,
    pub breakdown: crate::node_registry::NoAvailableNodeBreakdown,
    pub phase3_debug: Option<crate::node_registry::Phase3TwoLevelDebug>,
}

