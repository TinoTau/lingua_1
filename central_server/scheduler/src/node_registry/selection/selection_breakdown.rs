use serde::Serialize;

#[derive(Debug, Default, Clone, Serialize)]
pub struct NoAvailableNodeBreakdown {
    pub total_nodes: usize,
    pub offline: usize,
    pub status_not_ready: usize,
    pub not_in_public_pool: usize,
    pub gpu_unavailable: usize,
    pub model_not_available: usize,
    pub capacity_exceeded: usize,
    pub resource_threshold_exceeded: usize,
}

impl NoAvailableNodeBreakdown {
    pub fn best_reason_label(&self) -> &'static str {
        if self.total_nodes == 0 {
            return "no_nodes";
        }
        let mut best = ("unknown", 0usize);
        let candidates = [
            ("offline", self.offline),
            ("status_not_ready", self.status_not_ready),
            ("not_in_public_pool", self.not_in_public_pool),
            ("gpu_unavailable", self.gpu_unavailable),
            ("model_not_available", self.model_not_available),
            ("capacity_exceeded", self.capacity_exceeded),
            ("resource_threshold_exceeded", self.resource_threshold_exceeded),
        ];
        for (label, v) in candidates {
            if v > best.1 {
                best = (label, v);
            }
        }
        best.0
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Phase3TwoLevelDebug {
    pub pool_count: u16,
    pub preferred_pool: u16,
    pub selected_pool: Option<u16>,
    pub fallback_used: bool,
    /// (pool_id, best_reason_label, total_candidates)
    pub attempts: Vec<(u16, &'static str, usize)>,
}

