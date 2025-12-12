// ASR 引擎流式输出测试
// 测试 ASR 引擎的流式推理和部分结果输出功能

use lingua_node_inference::asr::{ASREngine, ASRPartialResult};
use std::path::PathBuf;

// 注意：这些测试需要实际的 Whisper 模型文件
// 如果没有模型文件，测试将被跳过

#[tokio::test]
#[ignore] // 需要模型文件，默认跳过
async fn test_asr_streaming_enable_disable() {
    // 测试启用和禁用流式模式
    let model_dir = PathBuf::from("models/asr");
    if !model_dir.exists() {
        eprintln!("模型目录不存在，跳过测试");
        return;
    }

    let engine = ASREngine::new(model_dir).expect("无法加载 ASR 引擎");
    
    // 测试默认状态（未启用流式）
    assert!(!engine.is_streaming_enabled().await);

    // 启用流式模式
    engine.enable_streaming(1000).await; // 1秒更新间隔
    assert!(engine.is_streaming_enabled().await);

    // 禁用流式模式
    engine.disable_streaming().await;
    assert!(!engine.is_streaming_enabled().await);
}

#[tokio::test]
#[ignore] // 需要模型文件，默认跳过
async fn test_asr_accumulate_audio() {
    // 测试音频累积功能
    let model_dir = PathBuf::from("models/asr");
    if !model_dir.exists() {
        eprintln!("模型目录不存在，跳过测试");
        return;
    }

    let engine = ASREngine::new(model_dir).expect("无法加载 ASR 引擎");
    
    // 启用流式模式
    engine.enable_streaming(500).await; // 500ms 更新间隔
    
    // 清空缓冲区
    engine.clear_buffer().await;

    // 累积一些音频数据（模拟 16kHz 单声道 PCM f32）
    let audio_chunk1: Vec<f32> = vec![0.0; 8000]; // 0.5秒
    let audio_chunk2: Vec<f32> = vec![0.0; 8000]; // 0.5秒

    engine.accumulate_audio(&audio_chunk1).await;
    engine.accumulate_audio(&audio_chunk2).await;

    // 获取部分结果（应该返回 None，因为时间戳不够）
    let _partial = engine.get_partial_result(0, "zh").await;
    // 注意：由于是静音数据，可能返回 None 或空文本
    // 这里主要测试接口是否正常工作
}

#[tokio::test]
#[ignore] // 需要模型文件，默认跳过
async fn test_asr_clear_buffer() {
    // 测试清空缓冲区功能
    let model_dir = PathBuf::from("models/asr");
    if !model_dir.exists() {
        eprintln!("模型目录不存在，跳过测试");
        return;
    }

    let engine = ASREngine::new(model_dir).expect("无法加载 ASR 引擎");
    
    engine.enable_streaming(1000).await;
    
    // 累积音频数据
    let audio_chunk: Vec<f32> = vec![0.0; 8000];
    engine.accumulate_audio(&audio_chunk).await;

    // 清空缓冲区
    engine.clear_buffer().await;

    // 获取最终结果应该返回空字符串
    let final_result = engine.get_final_result("zh").await.expect("获取最终结果失败");
    assert_eq!(final_result, "");
}

#[test]
fn test_asr_partial_result_structure() {
    // 测试 ASRPartialResult 结构
    let partial = ASRPartialResult {
        text: "Hello".to_string(),
        confidence: 0.95,
        is_final: false,
    };

    assert_eq!(partial.text, "Hello");
    assert_eq!(partial.confidence, 0.95);
    assert_eq!(partial.is_final, false);

    let final_result = ASRPartialResult {
        text: "Hello world".to_string(),
        confidence: 0.98,
        is_final: true,
    };

    assert_eq!(final_result.text, "Hello world");
    assert_eq!(final_result.confidence, 0.98);
    assert!(final_result.is_final);
}

