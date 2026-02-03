//! 推理请求处理流程（process 方法主体）

use anyhow::Result;
use tracing::{debug, info, warn};

use crate::modules::InferenceModule;
use crate::pipeline::PipelineContext;

use super::types::{InferenceRequest, InferenceResult, PartialResultCallback};
use super::InferenceService;

pub(super) async fn run_process(
    service: &InferenceService,
    request: InferenceRequest,
    partial_callback: Option<PartialResultCallback>,
) -> Result<InferenceResult> {
    let trace_id = request.trace_id.as_deref().unwrap_or("unknown");

    debug!(trace_id = %trace_id, job_id = %request.job_id, "开始处理推理请求");

    if let Some(ref features) = request.features {
        if features.speaker_identification {
            let _ = service.enable_module("speaker_identification").await;
        }
        if features.voice_cloning {
            let _ = service.enable_module("voice_cloning").await;
        }
        if features.speech_rate_detection {
            let _ = service.enable_module("speech_rate_detection").await;
        }
        if features.speech_rate_control {
            let _ = service.enable_module("speech_rate_control").await;
        }
    }

    let mut ctx = PipelineContext::from_audio(request.audio_data.clone());
    let features = request.features.as_ref();

    let audio_f32: Vec<f32> = request.audio_data
        .chunks_exact(2)
        .map(|chunk| {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32;
            sample / 32768.0
        })
        .collect();

    let mut src_lang = request.src_lang.clone();
    let mut tgt_lang = request.tgt_lang.clone();

    if src_lang == "auto" {
        debug!(trace_id = %trace_id, "开始语言检测");
        if let Some(ref detector) = service.language_detector {
            match detector.detect(&audio_f32, 16000).await {
                Ok(detection) => {
                    info!(trace_id = %trace_id, lang = %detection.lang, confidence = %detection.confidence, "语言检测完成");
                    src_lang = detection.lang.clone();

                    if let Some(ref mode) = request.mode {
                        if mode == "two_way_auto" {
                            if let (Some(ref lang_a), Some(ref lang_b)) = (&request.lang_a, &request.lang_b) {
                                if src_lang == *lang_a {
                                    tgt_lang = lang_b.clone();
                                    info!("Two-way mode: {} -> {}", src_lang, tgt_lang);
                                } else if src_lang == *lang_b {
                                    tgt_lang = lang_a.clone();
                                    info!("Two-way mode: {} -> {}", src_lang, tgt_lang);
                                } else {
                                    tgt_lang = lang_a.clone();
                                    warn!("Detected language {} not in two-way pair, using default target: {}", src_lang, tgt_lang);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!(trace_id = %trace_id, error = %e, default_lang = %src_lang, "语言检测失败，使用默认语言");
                    if let Some(ref auto_langs) = request.auto_langs {
                        if !auto_langs.is_empty() {
                            src_lang = auto_langs[0].clone();
                        }
                    }
                }
            }
        } else {
            warn!(trace_id = %trace_id, "语言检测请求但检测器不可用，使用默认语言");
            if let Some(ref auto_langs) = request.auto_langs {
                if !auto_langs.is_empty() {
                    src_lang = auto_langs[0].clone();
                }
            }
        }
    }

    debug!(trace_id = %trace_id, src_lang = %src_lang, "开始 ASR 语音识别");

    let audio_f32_with_context = {
        let context = service.context_buffer.lock().await;
        if !context.is_empty() {
            let mut audio_with_context = context.clone();
            audio_with_context.extend_from_slice(&audio_f32);
            info!(
                trace_id = %trace_id,
                context_samples = context.len(),
                context_duration_sec = (context.len() as f32 / 16000.0),
                original_samples = audio_f32.len(),
                original_duration_sec = (audio_f32.len() as f32 / 16000.0),
                total_samples = audio_with_context.len(),
                total_duration_sec = (audio_with_context.len() as f32 / 16000.0),
                "✅ 前置上下文音频到当前utterance（上下文缓冲区不为空）"
            );
            audio_with_context
        } else {
            info!(
                trace_id = %trace_id,
                original_samples = audio_f32.len(),
                original_duration_sec = (audio_f32.len() as f32 / 16000.0),
                "ℹ️ 上下文缓冲区为空，使用原始音频（第一个utterance或上下文已清空）"
            );
            audio_f32.clone()
        }
    };

    let audio_f32_processed = {
        match service.vad_engine.detect_speech(&audio_f32_with_context) {
            Ok(segments) => {
                if segments.is_empty() {
                    warn!(
                        trace_id = %trace_id,
                        "VAD未检测到语音段，使用完整音频进行ASR"
                    );
                    audio_f32_with_context.clone()
                } else {
                    let mut processed_audio = Vec::new();
                    for (start, end) in &segments {
                        let segment = &audio_f32_with_context[*start..*end];
                        processed_audio.extend_from_slice(segment);
                    }
                    info!(
                        trace_id = %trace_id,
                        segments_count = segments.len(),
                        original_samples = audio_f32_with_context.len(),
                        processed_samples = processed_audio.len(),
                        removed_samples = audio_f32_with_context.len() - processed_audio.len(),
                        "VAD检测到{}个语音段，已提取有效语音", segments.len()
                    );
                    const MIN_AUDIO_SAMPLES: usize = 8000;
                    if processed_audio.len() < MIN_AUDIO_SAMPLES {
                        warn!(
                            trace_id = %trace_id,
                            processed_samples = processed_audio.len(),
                            "VAD处理后的音频过短，使用原始音频"
                        );
                        audio_f32_with_context.clone()
                    } else {
                        processed_audio
                    }
                }
            }
            Err(e) => {
                warn!(
                    trace_id = %trace_id,
                    error = %e,
                    "VAD检测失败，使用完整音频进行ASR"
                );
                audio_f32_with_context.clone()
            }
        }
    };

    let transcript = if request.enable_streaming_asr.unwrap_or(false) {
        let interval_ms = request.partial_update_interval_ms.unwrap_or(1000);
        service.asr_engine.enable_streaming(interval_ms).await;

        let chunk_size = 8000;
        let mut current_timestamp_ms = 0u64;
        let sample_rate = 16000u32;
        let chunk_duration_ms = (chunk_size * 1000) / sample_rate;

        service.asr_engine.clear_buffer().await;

        for chunk in audio_f32_processed.chunks(chunk_size as usize) {
            service.asr_engine.accumulate_audio(chunk).await;

            if let Some(partial) = service.asr_engine.get_partial_result(current_timestamp_ms, &src_lang).await? {
                if let Some(ref callback) = partial_callback {
                    callback(partial.clone());
                }
            }

            current_timestamp_ms += chunk_duration_ms as u64;
        }

        let final_text = service.asr_engine.get_final_result(&src_lang).await?;
        service.asr_engine.disable_streaming().await;
        final_text
    } else {
        service.asr_engine.transcribe_f32(&audio_f32_processed, &src_lang).await?
    };

    if transcript.contains('(') || transcript.contains('（') || transcript.contains('[') || transcript.contains('【') {
        warn!(
            trace_id = %trace_id,
            transcript = %transcript,
            transcript_len = transcript.len(),
            "⚠️ [ASR Filter Check] Transcript contains brackets before setting to context!"
        );
    }
    ctx.set_transcript(transcript.clone());
    info!(
        trace_id = %trace_id,
        transcript_len = transcript.len(),
        transcript_preview = %transcript.chars().take(50).collect::<String>(),
        transcript_trimmed_len = transcript.trim().len(),
        "✅ ASR 识别完成"
    );

    if features.map(|f| f.speaker_identification).unwrap_or(false) {
        if let Some(ref m) = service.speaker_identifier {
            let module = m.read().await;
            if InferenceModule::is_enabled(&*module) {
                match module.identify(&audio_f32_processed).await {
                    Ok(result) => {
                        ctx.set_speaker_id(result.speaker_id.clone());
                        if let Some(ref embedding) = result.voice_embedding {
                            info!(trace_id = %trace_id, speaker_id = %result.speaker_id, embedding_dim = embedding.len(), "说话者识别完成");
                        } else {
                            info!(trace_id = %trace_id, speaker_id = %result.speaker_id, "说话者识别完成（无 embedding）");
                        }
                    }
                    Err(e) => {
                        warn!(trace_id = %trace_id, error = %e, "说话者识别失败");
                    }
                }
            }
        }
    }

    if features.map(|f| f.speech_rate_detection).unwrap_or(false) {
        let duration = request.audio_data.len() as f32 / 16000.0 / 2.0;
        if let Some(ref m) = service.speech_rate_detector {
            let module = m.read().await;
            if InferenceModule::is_enabled(&*module) {
                if let Ok(rate) = module.detect(&request.audio_data, duration).await {
                    ctx.set_speech_rate(rate);
                }
            }
        }
    }

    let transcript_trimmed = transcript.trim();
    if transcript_trimmed.is_empty() {
        warn!(
            trace_id = %trace_id,
            transcript = %transcript,
            "ASR transcript is empty, skipping NMT and TTS, and NOT updating context buffer"
        );
        return Ok(InferenceResult {
            transcript: String::new(),
            translation: String::new(),
            audio: Vec::new(),
            speaker_id: None,
            speech_rate: None,
            emotion: None,
        });
    }

    if crate::text_filter::is_meaningless_transcript(transcript_trimmed) {
        warn!(
            trace_id = %trace_id,
            transcript = %transcript_trimmed,
            transcript_len = transcript_trimmed.len(),
            "ASR transcript is meaningless (likely silence misrecognition), skipping NMT and TTS, and NOT updating context buffer"
        );
        return Ok(InferenceResult {
            transcript: String::new(),
            translation: String::new(),
            audio: Vec::new(),
            speaker_id: None,
            speech_rate: None,
            emotion: None,
        });
    }

    {
        const CONTEXT_DURATION_SEC: f32 = 2.0;
        const SAMPLE_RATE: u32 = 16000;
        let context_samples = (CONTEXT_DURATION_SEC * SAMPLE_RATE as f32) as usize;

        let mut context = service.context_buffer.lock().await;

        match service.vad_engine.detect_speech(&audio_f32) {
            Ok(segments) => {
                if !segments.is_empty() {
                    let (last_start, last_end) = segments.last().unwrap();
                    let last_segment = &audio_f32[*last_start..*last_end];

                    if last_segment.len() > context_samples {
                        let start_idx = last_segment.len() - context_samples;
                        *context = last_segment[start_idx..].to_vec();
                        info!(
                            trace_id = %trace_id,
                            context_samples = context.len(),
                            context_duration_sec = (context.len() as f32 / 16000.0),
                            segment_start = last_start,
                            segment_end = last_end,
                            segment_samples = last_segment.len(),
                            "✅ 更新上下文缓冲区（使用VAD选择的最后一个语音段尾部）"
                        );
                    } else {
                        *context = last_segment.to_vec();
                        info!(
                            trace_id = %trace_id,
                            context_samples = context.len(),
                            context_duration_sec = (context.len() as f32 / 16000.0),
                            segment_samples = last_segment.len(),
                            "✅ 更新上下文缓冲区（最后一个语音段较短，保存全部）"
                        );
                    }
                } else {
                    if audio_f32.len() > context_samples {
                        let start_idx = audio_f32.len() - context_samples;
                        *context = audio_f32[start_idx..].to_vec();
                        info!(
                            trace_id = %trace_id,
                            context_samples = context.len(),
                            context_duration_sec = (context.len() as f32 / 16000.0),
                            original_samples = audio_f32.len(),
                            "⚠️ 更新上下文缓冲区（VAD未检测到语音段，保存最后{}秒）", CONTEXT_DURATION_SEC
                        );
                    } else {
                        *context = audio_f32.clone();
                        info!(
                            trace_id = %trace_id,
                            context_samples = context.len(),
                            context_duration_sec = (context.len() as f32 / 16000.0),
                            original_samples = audio_f32.len(),
                            "⚠️ 更新上下文缓冲区（utterance较短，保存全部）"
                        );
                    }
                }
            }
            Err(e) => {
                warn!(
                    trace_id = %trace_id,
                    error = %e,
                    "VAD检测失败，使用简单尾部保存上下文"
                );
                if audio_f32.len() > context_samples {
                    let start_idx = audio_f32.len() - context_samples;
                    *context = audio_f32[start_idx..].to_vec();
                    info!(
                        trace_id = %trace_id,
                        context_samples = context.len(),
                        context_duration_sec = (context.len() as f32 / 16000.0),
                        "⚠️ 更新上下文缓冲区（VAD失败回退，保存最后{}秒）", CONTEXT_DURATION_SEC
                    );
                } else {
                    *context = audio_f32.clone();
                    info!(
                        trace_id = %trace_id,
                        context_samples = context.len(),
                        context_duration_sec = (context.len() as f32 / 16000.0),
                        "⚠️ 更新上下文缓冲区（VAD失败回退，utterance较短，保存全部）"
                    );
                }
            }
        }
    }

    debug!(trace_id = %trace_id, src_lang = %src_lang, tgt_lang = %tgt_lang, "开始机器翻译");
    let context_text = request.context_text.as_deref();
    let translation = service.nmt_engine.translate(&transcript, &src_lang, &tgt_lang, context_text).await?;

    ctx.set_translation(translation.clone());
    info!(trace_id = %trace_id, translation_len = translation.len(), "机器翻译完成");

    debug!(trace_id = %trace_id, tgt_lang = %tgt_lang, "开始语音合成");
    let use_voice_cloning = features.map(|f| f.voice_cloning).unwrap_or(false);
    let mut audio = if use_voice_cloning {
        if let Some(ref speaker_id) = ctx.speaker_id {
            if let Some(ref cloner) = service.voice_cloner {
                let module = cloner.read().await;
                if InferenceModule::is_enabled(&*module) {
                    match module.clone_voice(&translation, speaker_id, Some(&tgt_lang)).await {
                        Ok(cloned_audio) => {
                            info!(trace_id = %trace_id, speaker_id = %speaker_id, "使用 YourTTS 进行音色克隆");
                            cloned_audio
                        }
                        Err(e) => {
                            warn!(trace_id = %trace_id, error = %e, "YourTTS 音色克隆失败，降级到 Piper TTS");
                            service.tts_engine.synthesize(&translation, &tgt_lang).await?
                        }
                    }
                } else {
                    warn!(trace_id = %trace_id, "Voice cloning module not enabled, using Piper TTS");
                    service.tts_engine.synthesize(&translation, &tgt_lang).await?
                }
            } else {
                warn!(trace_id = %trace_id, "VoiceCloner not initialized, using Piper TTS");
                service.tts_engine.synthesize(&translation, &tgt_lang).await?
            }
        } else {
            warn!(trace_id = %trace_id, "No speaker_id available, using Piper TTS");
            service.tts_engine.synthesize(&translation, &tgt_lang).await?
        }
    } else {
        service.tts_engine.synthesize(&translation, &tgt_lang).await?
    };
    info!(trace_id = %trace_id, audio_len = audio.len(), "语音合成完成");

    if features.map(|f| f.speech_rate_control).unwrap_or(false) {
        if let Some(rate) = ctx.speech_rate {
            if let Some(ref controller) = service.speech_rate_controller {
                let module = controller.read().await;
                if InferenceModule::is_enabled(&*module) {
                    let target_rate = 1.0;
                    if let Ok(adjusted) = module.adjust_audio(&audio, target_rate, rate) {
                        audio = adjusted;
                    }
                }
            }
        }
    }

    ctx.set_tts_audio(audio.clone());

    info!(trace_id = %trace_id, job_id = %request.job_id, "推理请求处理完成");
    Ok(InferenceResult {
        transcript: ctx.transcript.unwrap_or_default(),
        translation: ctx.translation.unwrap_or_default(),
        audio,
        speaker_id: ctx.speaker_id,
        speech_rate: ctx.speech_rate,
        emotion: ctx.emotion,
    })
}
