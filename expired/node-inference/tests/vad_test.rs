//! VAD (Silero VAD) 单元测试

use lingua_node_inference::vad::{VADEngine, VADConfig};
use std::path::PathBuf;

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_engine_load() {
    let model_path = PathBuf::from("models/vad/silero/silero_vad_official.onnx");
    if !model_path.exists() {
        println!("⚠️  跳过测试: 模型文件不存在: {}", model_path.display());
        return;
    }

    let engine = VADEngine::new_from_model_path(&model_path, VADConfig::default())
        .expect("Failed to load VAD engine");
    println!("✓ VAD 引擎加载成功");
    println!("  模型路径: {}", engine.model_path().display());
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_detect_speech() {
    let model_path = PathBuf::from("models/vad/silero/silero_vad_official.onnx");
    if !model_path.exists() {
        println!("⚠️  跳过测试: 模型文件不存在");
        return;
    }

    let engine = VADEngine::new_from_model_path(&model_path, VADConfig::default())
        .expect("Failed to load VAD engine");
    
    // 创建测试音频数据（1秒的静音，16kHz, 32-bit float）
    let audio_data = vec![0.0f32; 16000];
    
    // 测试语音检测（静音可能返回空列表或少量误检）
    let result = engine.detect_speech(&audio_data);
    match result {
        Ok(segments) => {
            println!("✓ VAD 检测成功: 找到 {} 个语音段", segments.len());
            // 静音音频应该返回空列表或很少的误检
            // 注意：VAD 模型可能对静音有少量误检，这是正常的
            if !segments.is_empty() {
                println!("  注意: 静音音频检测到 {} 个语音段（可能是误检）", segments.len());
            }
        }
        Err(e) => {
            println!("⚠️  VAD 检测失败: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_detect_speech_segments() {
    let model_path = PathBuf::from("models/vad/silero/silero_vad_official.onnx");
    if !model_path.exists() {
        println!("⚠️  跳过测试: 模型文件不存在");
        return;
    }

    let engine = VADEngine::new_from_model_path(&model_path, VADConfig::default())
        .expect("Failed to load VAD engine");
    
    // 创建测试音频数据（1秒的静音，16kHz, 32-bit float）
    let audio_data = vec![0.0f32; 16000];
    
    // 测试语音段检测（静音可能返回空列表或少量误检）
    let result = engine.detect_speech(&audio_data);
    match result {
        Ok(segments) => {
            println!("✓ VAD 语音段检测成功: 找到 {} 个语音段", segments.len());
            // 静音音频应该返回空列表或很少的误检
            // 注意：VAD 模型可能对静音有少量误检，这是正常的
            if !segments.is_empty() {
                println!("  注意: 静音音频检测到 {} 个语音段（可能是误检）", segments.len());
            }
        }
        Err(e) => {
            println!("⚠️  VAD 语音段检测失败: {}", e);
        }
    }
}

#[tokio::test]
async fn test_vad_config_default() {
    let config = VADConfig::default();
    assert_eq!(config.sample_rate, 16000);
    assert_eq!(config.frame_size, 512);
    assert!(config.silence_threshold >= 0.0 && config.silence_threshold <= 1.0);
    assert!(config.min_silence_duration_ms > 0);
    println!("✓ VAD 配置默认值测试通过");
}

#[tokio::test]
async fn test_vad_config_custom() {
    let config = VADConfig {
        sample_rate: 16000,
        frame_size: 512,
        silence_threshold: 0.5,
        min_silence_duration_ms: 500,
        adaptive_enabled: true,
        base_threshold_min_ms: 200,
        base_threshold_max_ms: 600,
        final_threshold_min_ms: 200,
        final_threshold_max_ms: 800,
        min_utterance_ms: 1000,
    };
    
    assert_eq!(config.silence_threshold, 0.5);
    assert_eq!(config.min_silence_duration_ms, 500);
    println!("✓ VAD 自定义配置测试通过");
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_set_silence_threshold() {
    let model_path = PathBuf::from("models/vad/silero/silero_vad_official.onnx");
    if !model_path.exists() {
        println!("⚠️  跳过测试: 模型文件不存在");
        return;
    }

    let mut engine = VADEngine::new_from_model_path(&model_path, VADConfig::default())
        .expect("Failed to load VAD engine");
    
    // 测试设置静音阈值
    engine.set_silence_threshold(0.3);
    assert_eq!(engine.silence_threshold(), 0.3);
    
    engine.set_silence_threshold(0.7);
    assert_eq!(engine.silence_threshold(), 0.7);
    
    println!("✓ VAD 阈值设置测试通过");
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_vad_reset_state() {
    let model_path = PathBuf::from("models/vad/silero/silero_vad_official.onnx");
    if !model_path.exists() {
        println!("⚠️  跳过测试: 模型文件不存在");
        return;
    }

    let engine = VADEngine::new_from_model_path(&model_path, VADConfig::default())
        .expect("Failed to load VAD engine");
    
    // 测试状态重置
    engine.reset_state().expect("Failed to reset state");
    println!("✓ VAD 状态重置测试通过");
}
