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
    /// 新增：语言相关失败原因
    pub lang_pair_unsupported: usize,
    pub asr_lang_unsupported: usize,
    pub tts_lang_unsupported: usize,
    pub src_auto_no_candidate: usize,
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
            ("lang_pair_unsupported", self.lang_pair_unsupported),
            ("asr_lang_unsupported", self.asr_lang_unsupported),
            ("tts_lang_unsupported", self.tts_lang_unsupported),
            ("src_auto_no_candidate", self.src_auto_no_candidate),
        ];
        for (label, v) in candidates {
            if v > best.1 {
                best = (label, v);
            }
        }
        best.0
    }
}

// Phase3TwoLevelDebug 已废弃，不再使用

