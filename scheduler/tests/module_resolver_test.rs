//! 模块依赖解析器单元测试

use lingua_scheduler::module_resolver::{ModuleResolver, MODULE_TABLE};

#[test]
fn test_module_table_exists() {
    // 测试 MODULE_TABLE 是否包含所有预期的模块
    assert!(MODULE_TABLE.contains_key("emotion_detection"));
    assert!(MODULE_TABLE.contains_key("speaker_identification"));
    assert!(MODULE_TABLE.contains_key("voice_cloning"));
    assert!(MODULE_TABLE.contains_key("speech_rate_detection"));
    assert!(MODULE_TABLE.contains_key("speech_rate_control"));
    assert!(MODULE_TABLE.contains_key("persona_adaptation"));
}

#[test]
fn test_expand_dependencies_single_module() {
    // 测试展开单个模块的依赖
    let modules = vec!["emotion_detection".to_string()];
    let result = ModuleResolver::expand_dependencies(&modules);
    
    assert!(result.is_ok());
    let expanded = result.unwrap();
    
    // emotion_detection 依赖 asr，所以应该包含两者
    assert!(expanded.contains(&"emotion_detection".to_string()));
    assert!(expanded.contains(&"asr".to_string()));
}

#[test]
fn test_expand_dependencies_nested() {
    // 测试展开嵌套依赖
    let modules = vec!["voice_cloning".to_string()];
    let result = ModuleResolver::expand_dependencies(&modules);
    
    assert!(result.is_ok());
    let expanded = result.unwrap();
    
    // voice_cloning 依赖 speaker_identification
    assert!(expanded.contains(&"voice_cloning".to_string()));
    assert!(expanded.contains(&"speaker_identification".to_string()));
}

#[test]
fn test_expand_dependencies_multiple() {
    // 测试展开多个模块的依赖
    let modules = vec![
        "emotion_detection".to_string(),
        "speech_rate_detection".to_string(),
    ];
    let result = ModuleResolver::expand_dependencies(&modules);
    
    assert!(result.is_ok());
    let expanded = result.unwrap();
    
    // 应该包含所有模块和它们的依赖
    assert!(expanded.contains(&"emotion_detection".to_string()));
    assert!(expanded.contains(&"speech_rate_detection".to_string()));
    assert!(expanded.contains(&"asr".to_string())); // 两者都依赖 asr
}

#[test]
fn test_expand_dependencies_core_modules() {
    // 测试核心模块（不需要在 MODULE_TABLE 中）
    let modules = vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()];
    let result = ModuleResolver::expand_dependencies(&modules);
    
    assert!(result.is_ok());
    let expanded = result.unwrap();
    
    // 核心模块应该被包含
    assert!(expanded.contains(&"asr".to_string()));
    assert!(expanded.contains(&"nmt".to_string()));
    assert!(expanded.contains(&"tts".to_string()));
}

#[test]
fn test_expand_dependencies_nonexistent() {
    // 测试不存在的模块
    let modules = vec!["nonexistent_module".to_string()];
    let result = ModuleResolver::expand_dependencies(&modules);
    
    // 应该返回错误
    assert!(result.is_err());
}

#[test]
fn test_collect_required_models() {
    // 测试收集所需模型
    let modules = vec!["emotion_detection".to_string()];
    let result = ModuleResolver::collect_required_models(&modules);
    
    assert!(result.is_ok());
    let models = result.unwrap();
    
    // emotion_detection 需要 emotion-xlm-r 模型
    assert!(models.contains(&"emotion-xlm-r".to_string()));
}

#[test]
fn test_collect_required_models_multiple() {
    // 测试收集多个模块的所需模型
    let modules = vec![
        "emotion_detection".to_string(),
        "speaker_identification".to_string(),
    ];
    let result = ModuleResolver::collect_required_models(&modules);
    
    assert!(result.is_ok());
    let models = result.unwrap();
    
    assert!(models.contains(&"emotion-xlm-r".to_string()));
    assert!(models.contains(&"speaker-id-ecapa".to_string()));
}

#[test]
fn test_parse_features_to_modules() {
    // 测试从 FeatureFlags 解析模块
    use lingua_scheduler::messages::FeatureFlags;
    
    let features = FeatureFlags {
        emotion_detection: Some(true),
        speaker_identification: Some(true),
        speech_rate_detection: None,
        speech_rate_control: None,
        voice_style_detection: None,
        persona_adaptation: None,
    };
    
    let modules = ModuleResolver::parse_features_to_modules(&features);
    
    // 应该包含核心模块和启用的可选模块
    assert!(modules.contains(&"asr".to_string()));
    assert!(modules.contains(&"nmt".to_string()));
    assert!(modules.contains(&"tts".to_string()));
    assert!(modules.contains(&"emotion_detection".to_string()));
    assert!(modules.contains(&"speaker_identification".to_string()));
    assert!(!modules.contains(&"speech_rate_detection".to_string()));
}

#[test]
fn test_parse_features_to_modules_all() {
    // 测试所有功能都启用的情况
    use lingua_scheduler::messages::FeatureFlags;
    
    let features = FeatureFlags {
        emotion_detection: Some(true),
        speaker_identification: Some(true),
        speech_rate_detection: Some(true),
        speech_rate_control: Some(true),
        voice_style_detection: Some(true),
        persona_adaptation: Some(true),
    };
    
    let modules = ModuleResolver::parse_features_to_modules(&features);
    
    // 应该包含所有模块
    assert!(modules.contains(&"asr".to_string()));
    assert!(modules.contains(&"nmt".to_string()));
    assert!(modules.contains(&"tts".to_string()));
    assert!(modules.contains(&"emotion_detection".to_string()));
    assert!(modules.contains(&"speaker_identification".to_string()));
    assert!(modules.contains(&"voice_cloning".to_string())); // voice_style_detection 映射到 voice_cloning
    assert!(modules.contains(&"speech_rate_detection".to_string()));
    assert!(modules.contains(&"speech_rate_control".to_string()));
    assert!(modules.contains(&"persona_adaptation".to_string()));
}

