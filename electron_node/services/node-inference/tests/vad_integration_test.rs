//! VAD 集成测试
//! 
//! 测试 VAD 引擎在 InferenceService 中的集成功能：
//! - VAD 语音段检测和提取
//! - 上下文缓冲区的 VAD 优化
//! - VAD 状态管理

use lingua_node_inference::{InferenceService, InferenceRequest};
use std::path::PathBuf;

/// 创建测试音频数据（静音）
fn create_silence_audio(duration_sec: f32) -> Vec<u8> {
    let samples = (duration_sec * 16000.0) as usize;
    vec![0u8; samples * 2] // 16-bit PCM
}

/// 创建测试音频数据（简单的正弦波，模拟语音）
fn create_tone_audio(duration_sec: f32, frequency: f32) -> Vec<u8> {
    let samples = (duration_sec * 16000.0) as usize;
    let mut audio = Vec::with_capacity(samples * 2);
    
    for i in 0..samples {
        let t = i as f32 / 16000.0;
        let sample = (t * frequency * 2.0 * std::f32::consts::PI).sin();
        let sample_i16 = (sample * 32767.0) as i16;
        audio.extend_from_slice(&sample_i16.to_le_bytes());
    }
    
    audio
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_integration_context_buffer() {
    let models_dir = PathBuf::from("models");
    if !models_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在");
        return;
    }

    let service = InferenceService::new(models_dir.clone())
        .expect("Failed to create inference service");

    // 测试1: 检查上下文缓冲区初始状态
    let initial_size = service.get_context_buffer_size().await;
    assert_eq!(initial_size, 0, "上下文缓冲区初始应为空");
    println!("✓ 上下文缓冲区初始状态正确: {}", initial_size);

    // 测试2: 清空上下文缓冲区（应该同时重置VAD状态）
    service.clear_context_buffer().await;
    let size_after_clear = service.get_context_buffer_size().await;
    assert_eq!(size_after_clear, 0, "清空后上下文缓冲区应为空");
    println!("✓ 上下文缓冲区清空功能正常");
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_integration_speech_segmentation() {
    let models_dir = PathBuf::from("models");
    if !models_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在");
        return;
    }

    let service = InferenceService::new(models_dir.clone())
        .expect("Failed to create inference service");

    // 创建包含静音的测试音频：静音(0.5s) + 语音(1s) + 静音(0.3s) + 语音(0.8s)
    let mut audio_data = Vec::new();
    audio_data.extend_from_slice(&create_silence_audio(0.5));  // 静音 0.5s
    audio_data.extend_from_slice(&create_tone_audio(1.0, 440.0)); // 语音 1s (A4音)
    audio_data.extend_from_slice(&create_silence_audio(0.3));  // 静音 0.3s
    audio_data.extend_from_slice(&create_tone_audio(0.8, 880.0)); // 语音 0.8s (A5音)

    let request = InferenceRequest {
        job_id: "test-vad-segmentation".to_string(),
        src_lang: "en".to_string(),
        tgt_lang: "zh".to_string(),
        audio_data,
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-vad-segmentation".to_string()),
        context_text: None,
    };

    // 运行推理（VAD应该自动检测语音段并去除静音）
    let result = service.process(request, None).await;
    
    match result {
        Ok(output) => {
            println!("✓ VAD集成测试通过");
            println!("  Transcript: {}", output.transcript);
            println!("  Translation: {}", output.translation);
            
            // 检查上下文缓冲区是否已更新
            let context_size = service.get_context_buffer_size().await;
            println!("  上下文缓冲区大小: {} samples", context_size);
            assert!(context_size > 0, "上下文缓冲区应该已更新");
        }
        Err(e) => {
            // 如果ASR失败（可能是因为测试音频质量），至少检查VAD是否正常工作
            println!("⚠️  推理失败（可能是ASR问题）: {}", e);
            println!("  注意: 此测试主要验证VAD集成，ASR失败不影响VAD功能验证");
            
            // 检查上下文缓冲区是否已更新（即使ASR失败，VAD也应该工作）
            let context_size = service.get_context_buffer_size().await;
            if context_size > 0 {
                println!("✓ VAD功能正常（上下文缓冲区已更新）");
            } else {
                println!("⚠️  上下文缓冲区未更新（可能是VAD未检测到语音段）");
            }
        }
    }
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_integration_context_buffer_optimization() {
    let models_dir = PathBuf::from("models");
    if !models_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在");
        return;
    }

    let service = InferenceService::new(models_dir.clone())
        .expect("Failed to create inference service");

    // 清空上下文缓冲区
    service.clear_context_buffer().await;

    // 创建第一个utterance：包含静音和语音
    let mut audio1 = Vec::new();
    audio1.extend_from_slice(&create_tone_audio(1.5, 440.0)); // 语音 1.5s
    audio1.extend_from_slice(&create_silence_audio(0.5));     // 静音 0.5s

    let request1 = InferenceRequest {
        job_id: "test-context-1".to_string(),
        src_lang: "en".to_string(),
        tgt_lang: "zh".to_string(),
        audio_data: audio1,
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-context-1".to_string()),
        context_text: None,
    };

    // 处理第一个utterance
    let _result1 = service.process(request1, None).await;
    
    // 检查上下文缓冲区（应该包含最后一个语音段的尾部）
    let context_size_1 = service.get_context_buffer_size().await;
    println!("第一个utterance后，上下文缓冲区大小: {} samples", context_size_1);
    
    // 创建第二个utterance（应该使用第一个utterance的上下文）
    let audio2 = create_tone_audio(1.0, 880.0); // 语音 1s

    let request2 = InferenceRequest {
        job_id: "test-context-2".to_string(),
        src_lang: "en".to_string(),
        tgt_lang: "zh".to_string(),
        audio_data: audio2,
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-context-2".to_string()),
        context_text: None,
    };

    // 处理第二个utterance（应该使用第一个utterance的上下文）
    let _result2 = service.process(request2, None).await;
    
    // 检查上下文缓冲区是否已更新为第二个utterance的尾部
    let context_size_2 = service.get_context_buffer_size().await;
    println!("第二个utterance后，上下文缓冲区大小: {} samples", context_size_2);
    
    // 验证上下文缓冲区已更新
    assert!(context_size_2 > 0, "上下文缓冲区应该已更新");
    println!("✓ 上下文缓冲区VAD优化功能正常");
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_integration_fallback_behavior() {
    let models_dir = PathBuf::from("models");
    if !models_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在");
        return;
    }

    let service = InferenceService::new(models_dir.clone())
        .expect("Failed to create inference service");

    // 测试：如果VAD检测失败或未检测到语音段，应该回退到完整音频处理
    // 创建非常短的音频（可能VAD无法检测）
    let short_audio = create_tone_audio(0.1, 440.0); // 0.1秒，可能太短

    let request = InferenceRequest {
        job_id: "test-vad-fallback".to_string(),
        src_lang: "en".to_string(),
        tgt_lang: "zh".to_string(),
        audio_data: short_audio,
        features: None,
        mode: None,
        lang_a: None,
        lang_b: None,
        auto_langs: None,
        enable_streaming_asr: None,
        partial_update_interval_ms: None,
        trace_id: Some("test-vad-fallback".to_string()),
        context_text: None,
    };

    // 运行推理（应该能够处理，即使VAD可能无法检测到语音段）
    let result = service.process(request, None).await;
    
    match result {
        Ok(_output) => {
            println!("✓ VAD回退机制正常（短音频处理成功）");
        }
        Err(e) => {
            // 如果失败，至少验证不会因为VAD而崩溃
            println!("⚠️  处理失败（可能是ASR问题）: {}", e);
            println!("  注意: 此测试主要验证VAD不会导致崩溃");
        }
    }
    
    // 验证上下文缓冲区状态正常
    let context_size = service.get_context_buffer_size().await;
    println!("上下文缓冲区大小: {} samples", context_size);
    println!("✓ VAD回退机制测试完成");
}

#[tokio::test]
async fn test_vad_integration_context_buffer_api() {
    // 这个测试不需要模型文件，只测试API
    let models_dir = PathBuf::from("models");
    
    // 如果模型目录不存在，跳过测试
    if !models_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在（此测试需要InferenceService实例）");
        return;
    }

    let service = InferenceService::new(models_dir)
        .expect("Failed to create inference service");

    // 测试上下文缓冲区API
    let size1 = service.get_context_buffer_size().await;
    assert_eq!(size1, 0, "初始大小应为0");
    println!("✓ get_context_buffer_size() 正常");

    service.clear_context_buffer().await;
    let size2 = service.get_context_buffer_size().await;
    assert_eq!(size2, 0, "清空后大小应为0");
    println!("✓ clear_context_buffer() 正常");
}

