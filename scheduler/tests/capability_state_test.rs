//! capability_state 相关功能测试

use lingua_scheduler::messages::{ModelStatus, CapabilityState};
use std::collections::HashMap;

#[test]
fn test_model_status_serialization() {
    // 测试 ModelStatus 序列化
    let status = ModelStatus::Ready;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, "\"ready\"");
    
    let status = ModelStatus::Downloading;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, "\"downloading\"");
    
    let status = ModelStatus::NotInstalled;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, "\"not_installed\"");
    
    let status = ModelStatus::Error;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, "\"error\"");
}

#[test]
fn test_model_status_deserialization() {
    // 测试 ModelStatus 反序列化
    let status: ModelStatus = serde_json::from_str("\"ready\"").unwrap();
    assert_eq!(status, ModelStatus::Ready);
    
    let status: ModelStatus = serde_json::from_str("\"downloading\"").unwrap();
    assert_eq!(status, ModelStatus::Downloading);
    
    let status: ModelStatus = serde_json::from_str("\"not_installed\"").unwrap();
    assert_eq!(status, ModelStatus::NotInstalled);
    
    let status: ModelStatus = serde_json::from_str("\"error\"").unwrap();
    assert_eq!(status, ModelStatus::Error);
}

#[test]
fn test_capability_state_operations() {
    // 测试 CapabilityState 基本操作
    let mut state: CapabilityState = HashMap::new();
    
    state.insert("model-1".to_string(), ModelStatus::Ready);
    state.insert("model-2".to_string(), ModelStatus::Downloading);
    state.insert("model-3".to_string(), ModelStatus::NotInstalled);
    
    assert_eq!(state.get("model-1"), Some(&ModelStatus::Ready));
    assert_eq!(state.get("model-2"), Some(&ModelStatus::Downloading));
    assert_eq!(state.get("model-3"), Some(&ModelStatus::NotInstalled));
    assert_eq!(state.get("model-4"), None);
}

#[test]
fn test_capability_state_serialization() {
    // 测试 CapabilityState 序列化
    let mut state: CapabilityState = HashMap::new();
    state.insert("model-1".to_string(), ModelStatus::Ready);
    state.insert("model-2".to_string(), ModelStatus::Downloading);
    
    let json = serde_json::to_string(&state).unwrap();
    let deserialized: CapabilityState = serde_json::from_str(&json).unwrap();
    
    assert_eq!(deserialized.get("model-1"), Some(&ModelStatus::Ready));
    assert_eq!(deserialized.get("model-2"), Some(&ModelStatus::Downloading));
}

