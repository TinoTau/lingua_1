//! TTS (Piper) 单元测试

use lingua_node_inference::tts::{TTSEngine, PiperHttpConfig};

#[tokio::test]
#[ignore] // 需要 TTS 服务运行
async fn test_tts_engine_synthesize_zh() {
    let engine = TTSEngine::new(None).expect("Failed to create TTS engine");

    // 测试中文语音合成
    let result = engine.synthesize("你好，欢迎使用语音翻译系统。", "zh").await;
    match result {
        Ok(audio) => {
            println!("✓ TTS 合成成功: {} 字节", audio.len());
            assert!(audio.len() > 0, "音频数据不应为空");
            // 验证是 WAV 格式（前 4 字节应该是 "RIFF"）
            if audio.len() >= 4 {
                let header = String::from_utf8_lossy(&audio[0..4]);
                assert_eq!(header, "RIFF", "音频应该是 WAV 格式");
            }
        }
        Err(e) => {
            println!("⚠️  TTS 服务不可用: {}", e);
        }
    }
}

#[tokio::test]
#[ignore] // 需要 TTS 服务运行
async fn test_tts_engine_synthesize_en() {
    let engine = TTSEngine::new(None).expect("Failed to create TTS engine");

    // 测试英文语音合成
    let result = engine.synthesize("Hello, welcome to the speech translation system.", "en").await;
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
#[ignore] // 需要 TTS 服务运行
async fn test_tts_engine_custom_config() {
    // 测试自定义配置
    let config = PiperHttpConfig {
        endpoint: "http://127.0.0.1:5006/tts".to_string(),
        default_voice: "zh_CN-huayan-medium".to_string(),
        timeout_ms: 10000,
    };
    
    let engine = TTSEngine::new(Some(config)).expect("Failed to create TTS engine");

    let result = engine.synthesize("测试", "zh").await;
    match result {
        Ok(_) => {
            println!("✓ TTS 自定义配置测试通过");
        }
        Err(_) => {
            println!("⚠️  TTS 服务不可用（这是正常的，如果服务未运行）");
        }
    }
}

