//! Whisper 同步推理与片段文本提取（供 transcribe / partial / final 复用）

use anyhow::{Result, anyhow};
use std::sync::Arc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext};

/// 在调用线程中执行 Whisper 推理并返回过滤后的文本。
/// 由 transcribe_f32 / get_partial_result / get_final_result 在 spawn_blocking 内调用。
pub(crate) fn run_whisper_sync(
    ctx: Arc<WhisperContext>,
    audio_data: Vec<f32>,
    language: Option<String>,
) -> Result<String> {
    let mut state = ctx
        .create_state()
        .map_err(|e| anyhow!("Failed to create Whisper state: {:?}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    if let Some(ref lang) = language {
        params.set_language(Some(lang.as_str()));
    }
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(1).max(1))
        .unwrap_or(4);
    params.set_n_threads(num_threads as i32);
    tracing::info!("Using {} CPU threads for Whisper inference", num_threads);
    params.set_translate(false);
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state
        .full(params, &audio_data)
        .map_err(|e| anyhow!("Failed to run Whisper inference: {:?}", e))?;

    let num_segments = state.full_n_segments();
    let mut full_text = String::new();

    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            let segment_debug = format!("{:?}", segment);
            if let Some(start_idx) = segment_debug.find("text: Ok(\"") {
                let text_start = start_idx + 10;
                if let Some(end_idx) = segment_debug[text_start..].find("\")") {
                    let text = &segment_debug[text_start..text_start + end_idx];
                    let text_trimmed = text.trim();
                    if !text_trimmed.is_empty() {
                        if crate::text_filter::is_meaningless_transcript(text_trimmed) {
                            tracing::debug!(
                                "[ASR] Filtering segment at transcription level: \"{}\"",
                                text_trimmed
                            );
                        } else {
                            full_text.push_str(text_trimmed);
                            full_text.push(' ');
                        }
                    }
                }
            }
        }
    }

    let raw_text = full_text.trim().to_string();
    let filtered_text = crate::text_filter::filter_asr_text(&raw_text);
    if raw_text != filtered_text {
        tracing::info!("[ASR] Text filtered: \"{}\" -> \"{}\"", raw_text, filtered_text);
    }
    if !filtered_text.is_empty()
        && (filtered_text.contains('(')
            || filtered_text.contains('（')
            || filtered_text.contains('[')
            || filtered_text.contains('【'))
    {
        tracing::warn!(
            "[ASR] ⚠️ Filtered text still contains brackets: \"{}\"",
            filtered_text
        );
    }
    Ok(filtered_text)
}
