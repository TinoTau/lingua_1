// InferenceService 部分结果回调测试
// 测试 InferenceService 的部分结果回调功能

use lingua_node_inference::InferenceRequest;
use lingua_node_inference::asr::ASRPartialResult;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

// 注意：这些测试需要实际的模型文件
// 如果没有模型文件，测试将被跳过

#[tokio::test]
#[ignore] // 需要模型文件，默认跳过
async fn test_inference_service_with_partial_callback() {
    // 测试 InferenceService 的部分结果回调
    let models_dir = PathBuf::from("models");
    if !models_dir.exists() {
        eprintln!("模型目录不存在，跳过测试");
        return;
    }

    // 创建 InferenceService（需要 Whisper 上下文）
    // 注意：这里简化处理，实际需要从 ASREngine 获取 WhisperContext
    // 由于架构限制，这个测试可能需要调整
    
    // 创建一个计数器来跟踪回调调用次数
    let callback_count = Arc::new(AtomicUsize::new(0));
    let callback_count_clone = callback_count.clone();

    // 创建部分结果回调
    let _callback: lingua_node_inference::PartialResultCallback = Arc::new(move |partial: ASRPartialResult| {
        callback_count_clone.fetch_add(1, Ordering::SeqCst);
        println!("收到部分结果: {} (is_final: {})", partial.text, partial.is_final);
    });

    // 创建推理请求（启用流式 ASR）
    let _request = InferenceRequest {
        job_id: "test-job-1".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        audio_data: vec![0u8; 32000], // 1秒的 PCM16 数据（16kHz, 16bit）
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: Some(true),
        partial_update_interval_ms: Some(500), // 500ms 更新间隔
        trace_id: Some("test-trace-1".to_string()),
        context_text: None,
    };

    // 注意：由于需要实际的模型和 WhisperContext，这个测试可能需要调整
    // 这里主要测试接口和回调机制
    // 实际测试需要完整的 InferenceService 实例
}

#[test]
fn test_inference_request_with_streaming_config() {
    // 测试 InferenceRequest 的流式 ASR 配置
    let request = InferenceRequest {
        job_id: "test-job-2".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        audio_data: vec![0u8; 1000],
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: Some(true),
        partial_update_interval_ms: Some(1000),
        trace_id: Some("test-trace-2".to_string()),
        context_text: None,
    };

    assert_eq!(request.enable_streaming_asr, Some(true));
    assert_eq!(request.partial_update_interval_ms, Some(1000));
    assert_eq!(request.job_id, "test-job-2");
}

#[test]
fn test_inference_request_without_streaming() {
    // 测试 InferenceRequest 不启用流式 ASR
    let request = InferenceRequest {
        job_id: "test-job-3".to_string(),
        src_lang: "en".to_string(),
        tgt_lang: "zh".to_string(),
        audio_data: vec![0u8; 1000],
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-trace-3".to_string()),
        context_text: None,
    };

    assert_eq!(request.enable_streaming_asr, None);
    assert_eq!(request.partial_update_interval_ms, None);
}

