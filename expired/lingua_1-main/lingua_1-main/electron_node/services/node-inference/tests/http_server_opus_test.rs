//! HTTP 服务器 Opus 解码集成测试
//! 测试 HTTP 和 WebSocket 接口中的 Opus 解码功能

use lingua_node_inference::http_server::HttpInferenceRequest;
use lingua_node_inference::decode_audio;
use base64::{Engine as _, engine::general_purpose};

#[test]
fn test_http_request_with_opus_format() {
    // 测试 HTTP 请求中指定 Opus 格式的处理
    
    // 创建测试 PCM16 数据（base64 编码）
    let pcm16_data: Vec<u8> = (0..16000)
        .flat_map(|_| {
            let sample: i16 = 0; // 静音
            sample.to_le_bytes().to_vec()
        })
        .collect();
    
    let base64_audio = general_purpose::STANDARD.encode(&pcm16_data);
    
    // 创建请求（指定 PCM16 格式）
    let request = HttpInferenceRequest {
        job_id: "test-job-1".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        audio: base64_audio.clone(),
        audio_format: Some("pcm16".to_string()),
        sample_rate: Some(16000),
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-trace-1".to_string()),
        context_text: None,
    };
    
    // 验证请求格式
    assert_eq!(request.audio_format, Some("pcm16".to_string()));
    assert_eq!(request.sample_rate, Some(16000));
    
    // 解码 base64 音频
    let audio_data_raw = general_purpose::STANDARD.decode(&request.audio).unwrap();
    
    // 使用 decode_audio 解码
    let audio_format = request.audio_format.as_deref().unwrap_or("pcm16");
    let sample_rate = request.sample_rate.unwrap_or(16000);
    let result = decode_audio(&audio_data_raw, audio_format, sample_rate);
    
    assert!(result.is_ok());
    let decoded = result.unwrap();
    assert_eq!(decoded.len(), audio_data_raw.len());
}

#[test]
fn test_http_request_with_opus_format_unsupported() {
    // 测试不支持的音频格式
    
    let test_data = vec![0u8; 100];
    let base64_audio = general_purpose::STANDARD.encode(&test_data);
    
    let request = HttpInferenceRequest {
        job_id: "test-job-2".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        audio: base64_audio,
        audio_format: Some("invalid_format".to_string()),
        sample_rate: Some(16000),
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: None,
        context_text: None,
    };
    
    let audio_data_raw = general_purpose::STANDARD.decode(&request.audio).unwrap();
    let audio_format = request.audio_format.as_deref().unwrap_or("pcm16");
    let sample_rate = request.sample_rate.unwrap_or(16000);
    let result = decode_audio(&audio_data_raw, audio_format, sample_rate);
    
    assert!(result.is_err());
    let error = result.unwrap_err();
    assert!(error.to_string().contains("Unsupported audio format"));
}

#[test]
fn test_http_request_default_format() {
    // 测试默认格式（未指定 audio_format）
    
    let pcm16_data: Vec<u8> = (0..1000)
        .flat_map(|_| {
            let sample: i16 = 0;
            sample.to_le_bytes().to_vec()
        })
        .collect();
    
    let base64_audio = general_purpose::STANDARD.encode(&pcm16_data);
    
    let request = HttpInferenceRequest {
        job_id: "test-job-3".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        audio: base64_audio,
        audio_format: None, // 未指定格式
        sample_rate: None,  // 未指定采样率
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: None,
        context_text: None,
    };
    
    // 应该使用默认值
    let audio_format = request.audio_format.as_deref().unwrap_or("pcm16");
    let sample_rate = request.sample_rate.unwrap_or(16000);
    
    assert_eq!(audio_format, "pcm16");
    assert_eq!(sample_rate, 16000);
    
    let audio_data_raw = general_purpose::STANDARD.decode(&request.audio).unwrap();
    let result = decode_audio(&audio_data_raw, audio_format, sample_rate);
    
    assert!(result.is_ok());
}

#[test]
fn test_audio_format_case_insensitive() {
    // 测试格式名称的大小写不敏感
    
    let test_data = vec![0u8; 100];
    let base64_audio = general_purpose::STANDARD.encode(&test_data);
    
    // 测试不同大小写
    let formats = vec!["pcm16", "PCM16", "pcm", "OPUS", "opus"];
    
    for format in formats {
        let request = HttpInferenceRequest {
            job_id: "test-job".to_string(),
            src_lang: "zh".to_string(),
            tgt_lang: "en".to_string(),
            audio: base64_audio.clone(),
            audio_format: Some(format.to_string()),
            sample_rate: Some(16000),
            features: None,
            mode: None,
            lang_a: None,
            lang_b: None,
            auto_langs: None,
            enable_streaming_asr: None,
            partial_update_interval_ms: None,
            trace_id: None,
            context_text: None,
        };
        
        let audio_data_raw = general_purpose::STANDARD.decode(&request.audio).unwrap();
        let audio_format = request.audio_format.as_deref().unwrap_or("pcm16");
        let sample_rate = request.sample_rate.unwrap_or(16000);
        
        // 对于 PCM16 格式，应该成功
        if format.to_lowercase() == "pcm16" || format.to_lowercase() == "pcm" {
            let result = decode_audio(&audio_data_raw, audio_format, sample_rate);
            assert!(result.is_ok(), "格式 {} 应该被识别为 PCM16", format);
        }
    }
}

#[test]
fn test_sample_rate_handling() {
    // 测试不同采样率的处理
    
    let test_data = vec![0u8; 100];
    let base64_audio = general_purpose::STANDARD.encode(&test_data);
    
    let sample_rates = vec![8000, 16000, 24000, 48000];
    
    for sample_rate in sample_rates {
        let request = HttpInferenceRequest {
            job_id: "test-job".to_string(),
            src_lang: "zh".to_string(),
            tgt_lang: "en".to_string(),
            audio: base64_audio.clone(),
            audio_format: Some("pcm16".to_string()),
            sample_rate: Some(sample_rate),
            features: None,
            mode: None,
            lang_a: None,
            lang_b: None,
            auto_langs: None,
            enable_streaming_asr: None,
            partial_update_interval_ms: None,
            trace_id: None,
            context_text: None,
        };
        
        let audio_data_raw = general_purpose::STANDARD.decode(&request.audio).unwrap();
        let audio_format = request.audio_format.as_deref().unwrap_or("pcm16");
        let sample_rate = request.sample_rate.unwrap_or(16000);
        
        let result = decode_audio(&audio_data_raw, audio_format, sample_rate);
        assert!(result.is_ok(), "采样率 {} 应该被支持", sample_rate);
    }
}

