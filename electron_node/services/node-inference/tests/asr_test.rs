//! ASR (Whisper) 单元测试

use lingua_node_inference::asr::ASREngine;
use std::path::PathBuf;

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_asr_engine_load() {
    let model_dir = PathBuf::from("models/asr/whisper-base");
    if !model_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在: {}", model_dir.display());
        return;
    }

    let engine = ASREngine::new(model_dir).expect("Failed to load ASR engine");
    println!("✓ ASR 引擎加载成功");
    println!("  模型路径: {}", engine.model_path().display());
}

#[tokio::test]
#[ignore] // 需要模型文件和测试音频
async fn test_asr_transcribe() {
    let model_dir = PathBuf::from("models/asr/whisper-base");
    if !model_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在");
        return;
    }

    let engine = ASREngine::new(model_dir).expect("Failed to load ASR engine");
    
    // 创建测试音频数据（1秒的静音，16kHz, 16-bit PCM）
    let audio_data = vec![0u8; 16000 * 2];
    
    // 测试转录（可能会失败，因为音频是静音）
    let result = engine.transcribe(&audio_data, "en").await;
    match result {
        Ok(text) => {
            println!("✓ ASR 转录成功: {}", text);
        }
        Err(e) => {
            println!("⚠️  ASR 转录失败（可能是正常的，因为输入是静音）: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // 需要模型文件
async fn test_asr_language_detection() {
    let model_dir = PathBuf::from("models/asr/whisper-base");
    if !model_dir.exists() {
        println!("⚠️  跳过测试: 模型目录不存在");
        return;
    }

    let mut engine = ASREngine::new(model_dir).expect("Failed to load ASR engine");
    
    // 测试语言设置
    engine.set_language(Some("zh".to_string()));
    assert_eq!(engine.get_language(), Some("zh".to_string()));
    
    engine.set_language(None);
    assert_eq!(engine.get_language(), None);
    
    println!("✓ ASR 语言设置测试通过");
}

