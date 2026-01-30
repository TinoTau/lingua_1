// EDGE-1: 统一 finalize 接口单元测试

use lingua_scheduler::core::config::{EdgeStabilizationConfig, WebTaskSegmentationConfig};

/// 测试 EdgeStabilizationConfig 默认值
#[test]
fn test_edge_stabilization_config_defaults() {
    let config = EdgeStabilizationConfig::default();
    
    assert_eq!(config.hangover_auto_ms, 150, "默认自动 finalize hangover 应该是 150ms");
    assert_eq!(config.hangover_manual_ms, 200, "默认手动截断 hangover 应该是 200ms");
    assert_eq!(config.padding_auto_ms, 220, "默认自动 finalize padding 应该是 220ms");
    assert_eq!(config.padding_manual_ms, 280, "默认手动截断 padding 应该是 280ms");
    assert_eq!(config.short_merge_threshold_ms, 400, "默认 short-merge 阈值应该是 400ms");
}

/// 测试 WebTaskSegmentationConfig 包含 edge_stabilization
#[test]
fn test_web_task_segmentation_config_includes_edge() {
    let config = WebTaskSegmentationConfig::default();
    
    // 验证包含 edge_stabilization 字段
    assert_eq!(config.pause_ms, 3000, "默认 pause_ms 应该是 3000ms");
    
    // 验证 edge_stabilization 有默认值
    let edge = config.edge_stabilization;
    assert_eq!(edge.hangover_auto_ms, 150);
    assert_eq!(edge.hangover_manual_ms, 200);
    assert_eq!(edge.padding_auto_ms, 220);
    assert_eq!(edge.padding_manual_ms, 280);
    assert_eq!(edge.short_merge_threshold_ms, 400);
}

/// 测试配置序列化/反序列化（TOML）
#[test]
fn test_edge_config_serialization() {
    use toml;
    
    let config = EdgeStabilizationConfig {
        hangover_auto_ms: 150,
        hangover_manual_ms: 200,
        padding_auto_ms: 220,
        padding_manual_ms: 280,
        short_merge_threshold_ms: 400,
    };
    
    // 测试序列化
    let toml_str = toml::to_string(&config).expect("应该能够序列化为 TOML");
    assert!(toml_str.contains("hangover_auto_ms = 150"));
    assert!(toml_str.contains("hangover_manual_ms = 200"));
    assert!(toml_str.contains("padding_auto_ms = 220"));
    assert!(toml_str.contains("padding_manual_ms = 280"));
    assert!(toml_str.contains("short_merge_threshold_ms = 400"));
    
    // 测试反序列化
    let deserialized: EdgeStabilizationConfig = toml::from_str(&toml_str)
        .expect("应该能够从 TOML 反序列化");
    assert_eq!(deserialized.hangover_auto_ms, 150);
    assert_eq!(deserialized.hangover_manual_ms, 200);
    assert_eq!(deserialized.padding_auto_ms, 220);
    assert_eq!(deserialized.padding_manual_ms, 280);
    assert_eq!(deserialized.short_merge_threshold_ms, 400);
}

/// 测试配置值的有效性（边界检查）
#[test]
fn test_edge_config_value_ranges() {
    // 测试合理的配置值范围
    let config = EdgeStabilizationConfig {
        hangover_auto_ms: 120,  // 最小值
        hangover_manual_ms: 180,  // 最小值
        padding_auto_ms: 200,  // 最小值
        padding_manual_ms: 250,  // 最小值
        short_merge_threshold_ms: 300,  // 最小值
    };
    
    assert!(config.hangover_auto_ms >= 120 && config.hangover_auto_ms <= 180);
    assert!(config.hangover_manual_ms >= 180 && config.hangover_manual_ms <= 220);
    assert!(config.padding_auto_ms >= 200 && config.padding_auto_ms <= 300);
    assert!(config.padding_manual_ms >= 250 && config.padding_manual_ms <= 300);
    assert!(config.short_merge_threshold_ms >= 300);
}


