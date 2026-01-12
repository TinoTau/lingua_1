//! 节点推理服务集成测试
//! 
//! 测试 ASR、NMT、TTS 的核心功能

use lingua_node_inference::{InferenceService, InferenceRequest};
use std::path::PathBuf;

// 注意：这些测试需要模型文件存在，在实际运行前需要确保模型已下载

#[tokio::test]
#[ignore] // 默认忽略，需要模型文件
async fn test_asr_engine_load() {
    let model_dir = PathBuf::from("models/asr/whisper-base");
    if !model_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在: {}", model_dir.display());
        return;
    }

    use lingua_node_inference::ASREngine;
    let engine = ASREngine::new(model_dir).expect("Failed to load ASR engine");
    println!("✓ ASR 引擎加载成功");
    println!("  模型路径: {}", engine.model_path().display());
}

#[tokio::test]
#[ignore] // 默认忽略，需要模型文件和服务
async fn test_nmt_engine_http() {
    // 测试 NMT HTTP 客户端（需要 Python M2M100 服务运行）
    use lingua_node_inference::NMTEngine;
    let engine = NMTEngine::new_with_http_client(None)
        .expect("Failed to create NMT engine");

    // 测试翻译（如果服务可用）
    let result = engine.translate("Hello", "en", "zh").await;
    match result {
        Ok(text) => {
            println!("✓ NMT 翻译成功: {}", text);
        }
        Err(e) => {
            println!("⚠️  NMT 服务不可用: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // 默认忽略，需要 TTS 服务
async fn test_tts_engine() {
    use lingua_node_inference::TTSEngine;
    let engine = TTSEngine::new(None).expect("Failed to create TTS engine");

    // 测试语音合成（如果服务可用）
    let result = engine.synthesize("你好", "zh").await;
    match result {
        Ok(audio) => {
            println!("✓ TTS 合成成功: {} 字节", audio.len());
            assert!(audio.len() > 0, "音频数据不应为空");
        }
        Err(e) => {
            println!("⚠️  TTS 服务不可用: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // 默认忽略，需要所有模型和服务
async fn test_inference_service_full_pipeline() {
    let models_dir = PathBuf::from("models");
    if !models_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在");
        return;
    }

    let service = InferenceService::new(models_dir)
        .expect("Failed to create inference service");

    // 创建测试请求
    let request = InferenceRequest {
        job_id: "test-job-1".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        audio_data: vec![0u8; 16000 * 2], // 1秒的静音（16kHz, 16-bit）
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-trace-1".to_string()),
    };

    // 运行推理（可能会失败，因为需要实际模型）
    let result = service.process(request, None).await;
    match result {
        Ok(output) => {
            println!("✓ 完整推理流程成功");
            println!("  转录: {}", output.transcript);
            println!("  翻译: {}", output.translation);
            println!("  音频大小: {} 字节", output.audio.len());
        }
        Err(e) => {
            println!("⚠️  推理失败（可能是模型或服务不可用）: {}", e);
        }
    }
}

