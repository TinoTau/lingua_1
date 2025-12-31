use crate::messages::common::ExtraResult;
use crate::metrics::metrics;

/// 记录 ASR 相关指标
pub(crate) fn record_asr_metrics(
    elapsed_ms: Option<u64>,
    extra: &Option<ExtraResult>,
    asr_quality_level: &Option<String>,
    rerun_count: Option<u32>,
) {
    // OBS-1: 记录 ASR 指标
    if let Some(elapsed) = elapsed_ms {
        metrics::record_asr_e2e_latency(elapsed);
    }
    if let Some(ref extra) = extra {
        if let Some(lang_prob) = extra.language_probability {
            metrics::record_lang_probability(lang_prob);
        }
    }
    if asr_quality_level.as_deref() == Some("bad") {
        metrics::record_bad_segment();
    }
    if rerun_count.is_some() && rerun_count.unwrap_or(0) > 0 {
        metrics::record_rerun_trigger();
    }
}

