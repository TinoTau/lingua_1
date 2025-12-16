//! 阶段 1.4：语言检测模块单元测试

use lingua_node_inference::language_detector::{
    LanguageDetector, LanguageDetectorConfig,
};
use std::path::PathBuf;
use std::sync::Arc;
use whisper_rs::{WhisperContext, WhisperContextParameters};

/// 辅助函数：创建测试用的 Whisper 上下文
fn create_test_whisper_ctx() -> Option<Arc<WhisperContext>> {
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let model_path = crate_root.join("../../models/asr/whisper-base/ggml-base.bin");
    
    if !model_path.exists() {
        println!("⚠️  跳过测试: Whisper 模型文件不存在: {}", model_path.display());
        return None;
    }
    
    match WhisperContext::new_with_params(
        model_path.to_str().unwrap(),
        WhisperContextParameters::default(),
    ) {
        Ok(ctx) => Some(Arc::new(ctx)),
        Err(e) => {
            println!("⚠️  跳过测试: 无法加载 Whisper 模型: {:?}", e);
            None
        }
    }
}

#[tokio::test]
async fn test_language_detector_new() {
    println!("\n========== 测试 LanguageDetector 创建 ==========");
    
    let ctx = match create_test_whisper_ctx() {
        Some(ctx) => ctx,
        None => return,
    };
    
    // 测试使用默认配置创建
    let detector = LanguageDetector::new(ctx.clone(), None);
    let config = detector.get_config();
    assert_eq!(config.default_lang, "zh");
    assert_eq!(config.confidence_threshold, 0.75);
    assert_eq!(config.supported_langs.len(), 4);
    assert!(config.supported_langs.contains(&"zh".to_string()));
    assert!(config.supported_langs.contains(&"en".to_string()));
    assert!(config.supported_langs.contains(&"ja".to_string()));
    assert!(config.supported_langs.contains(&"ko".to_string()));
    
    println!("✓ LanguageDetector 创建成功（默认配置）");
    
    // 测试使用自定义配置创建
    let custom_config = LanguageDetectorConfig {
        confidence_threshold: 0.8,
        default_lang: "en".to_string(),
        supported_langs: vec!["en".to_string(), "zh".to_string()],
    };
    
    let detector2 = LanguageDetector::new(ctx, Some(custom_config.clone()));
    let config2 = detector2.get_config();
    assert_eq!(config2.confidence_threshold, 0.8);
    assert_eq!(config2.default_lang, "en");
    assert_eq!(config2.supported_langs.len(), 2);
    
    println!("✓ LanguageDetector 创建成功（自定义配置）");
}

#[tokio::test]
async fn test_language_detector_detect_short_audio() {
    println!("\n========== 测试语言检测（短音频） ==========");
    
    let ctx = match create_test_whisper_ctx() {
        Some(ctx) => ctx,
        None => return,
    };
    
    let detector = LanguageDetector::new(ctx, None);
    
    // 测试音频太短的情况（<0.5秒）
    let short_audio = vec![0.0f32; 4000];  // 0.25秒 @ 16kHz
    
    let result = detector.detect(&short_audio, 16000).await;
    assert!(result.is_ok());
    
    let detection = result.unwrap();
    assert_eq!(detection.lang, "zh");  // 应该使用默认语言
    assert!(detection.confidence < 0.6);  // 低置信度
    
    println!("✓ 短音频检测测试通过（使用默认语言）");
}

#[tokio::test]
async fn test_language_detector_detect_silence() {
    println!("\n========== 测试语言检测（静音） ==========");
    
    let ctx = match create_test_whisper_ctx() {
        Some(ctx) => ctx,
        None => return,
    };
    
    let detector = LanguageDetector::new(ctx, None);
    
    // 测试静音音频（1秒）
    let silence_audio = vec![0.0f32; 16000];  // 1秒 @ 16kHz
    
    let result = detector.detect(&silence_audio, 16000).await;
    assert!(result.is_ok());
    
    let detection = result.unwrap();
    // 静音应该返回默认语言
    assert_eq!(detection.lang, "zh");
    assert!(detection.confidence <= 0.85);  // 置信度不会太高
    
    println!("✓ 静音检测测试通过");
}

#[tokio::test]
async fn test_language_detector_config_update() {
    println!("\n========== 测试配置更新 ==========");
    
    let ctx = match create_test_whisper_ctx() {
        Some(ctx) => ctx,
        None => return,
    };
    
    let mut detector = LanguageDetector::new(ctx, None);
    
    // 更新配置
    let new_config = LanguageDetectorConfig {
        confidence_threshold: 0.9,
        default_lang: "en".to_string(),
        supported_langs: vec!["en".to_string(), "zh".to_string()],
    };
    
    detector.update_config(new_config.clone());
    
    let config = detector.get_config();
    assert_eq!(config.confidence_threshold, 0.9);
    assert_eq!(config.default_lang, "en");
    assert_eq!(config.supported_langs.len(), 2);
    
    println!("✓ 配置更新测试通过");
}

#[tokio::test]
async fn test_language_detector_result_structure() {
    println!("\n========== 测试检测结果结构 ==========");
    
    let ctx = match create_test_whisper_ctx() {
        Some(ctx) => ctx,
        None => return,
    };
    
    let detector = LanguageDetector::new(ctx, None);
    
    // 测试音频（1秒）
    let audio = vec![0.0f32; 16000];  // 1秒 @ 16kHz
    
    let result = detector.detect(&audio, 16000).await;
    assert!(result.is_ok());
    
    let detection = result.unwrap();
    
    // 验证结果结构
    assert!(!detection.lang.is_empty());
    assert!(detection.confidence >= 0.0 && detection.confidence <= 1.0);
    assert!(!detection.scores.is_empty());
    
    // 验证得分总和合理
    let total_score: f32 = detection.scores.values().sum();
    assert!(total_score > 0.0);
    
    println!("✓ 检测结果结构验证通过");
    println!("  检测语言: {}", detection.lang);
    println!("  置信度: {:.2}", detection.confidence);
    println!("  得分数量: {}", detection.scores.len());
}

#[tokio::test]
async fn test_language_detector_custom_config() {
    println!("\n========== 测试自定义配置 ==========");
    
    let ctx = match create_test_whisper_ctx() {
        Some(ctx) => ctx,
        None => return,
    };
    
    // 创建自定义配置
    let config = LanguageDetectorConfig {
        confidence_threshold: 0.8,
        default_lang: "en".to_string(),
        supported_langs: vec!["en".to_string(), "zh".to_string(), "ja".to_string()],
    };
    
    let detector = LanguageDetector::new(ctx, Some(config));
    
    // 测试音频（1秒）
    let audio = vec![0.0f32; 16000];  // 1秒 @ 16kHz
    
    let result = detector.detect(&audio, 16000).await;
    assert!(result.is_ok());
    
    let detection = result.unwrap();
    
    // 验证使用自定义默认语言
    // 注意：由于是静音，应该使用默认语言
    assert_eq!(detection.lang, "en");  // 自定义默认语言
    
    // 验证得分只包含支持的语言
    for lang in detection.scores.keys() {
        assert!(vec!["en", "zh", "ja"].contains(&lang.as_str()));
    }
    
    println!("✓ 自定义配置测试通过");
}

#[tokio::test]
async fn test_language_detector_error_handling() {
    println!("\n========== 测试错误处理 ==========");
    
    let ctx = match create_test_whisper_ctx() {
        Some(ctx) => ctx,
        None => return,
    };
    
    let detector = LanguageDetector::new(ctx, None);
    
    // 测试空音频
    let empty_audio = vec![];
    let result = detector.detect(&empty_audio, 16000).await;
    // 空音频应该也能处理（虽然可能返回默认语言）
    assert!(result.is_ok());
    
    println!("✓ 错误处理测试通过");
}

