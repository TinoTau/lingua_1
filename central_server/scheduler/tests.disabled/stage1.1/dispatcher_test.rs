// 任务分发单元测试

use lingua_scheduler::core::dispatcher::JobDispatcher;
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::messages::{
    CapabilityByType, FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, InstalledService,
    ServiceStatus, ServiceType, DeviceType, NodeStatus, PipelineConfig,
};
use std::sync::Arc;

fn create_test_node_registry() -> Arc<NodeRegistry> {
    Arc::new(NodeRegistry::new())
}

fn create_test_hardware() -> HardwareInfo {
    HardwareInfo {
        cpu_cores: 8,
        memory_gb: 16,
        gpus: Some(vec![
            GpuInfo {
                name: "Test GPU".to_string(),
                memory_gb: 8,
            }
        ]),
    }
}

fn create_test_models(src_lang: &str, tgt_lang: &str) -> Vec<InstalledModel> {
    vec![
        InstalledModel {
            model_id: "asr-1".to_string(),
            kind: "asr".to_string(),
            src_lang: None,
            tgt_lang: None,
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
        InstalledModel {
            model_id: "nmt-1".to_string(),
            kind: "nmt".to_string(),
            src_lang: Some(src_lang.to_string()),
            tgt_lang: Some(tgt_lang.to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
        InstalledModel {
            model_id: "tts-1".to_string(),
            kind: "tts".to_string(),
            src_lang: None,
            tgt_lang: Some(tgt_lang.to_string()),
            dialect: None,
            version: "1.0".to_string(),
            enabled: Some(true),
        },
    ]
}

fn create_core_installed_services() -> Vec<InstalledService> {
    vec![
        InstalledService {
            service_id: "node-inference".to_string(),
            r#type: lingua_scheduler::messages::ServiceType::Asr,
            device: lingua_scheduler::messages::DeviceType::Gpu,
            status: lingua_scheduler::messages::ServiceStatus::Running,
            version: Some("1.0.0".to_string()),
            model_id: None,
            engine: None,
            mem_mb: None,
            warmup_ms: None,
            last_error: None,
        },
        InstalledService {
            service_id: "nmt-m2m100".to_string(),
            r#type: lingua_scheduler::messages::ServiceType::Nmt,
            device: lingua_scheduler::messages::DeviceType::Gpu,
            status: lingua_scheduler::messages::ServiceStatus::Running,
            version: Some("1.0.0".to_string()),
            model_id: None,
            engine: None,
            mem_mb: None,
            warmup_ms: None,
            last_error: None,
        },
        InstalledService {
            service_id: "piper-tts".to_string(),
            r#type: lingua_scheduler::messages::ServiceType::Tts,
            device: lingua_scheduler::messages::DeviceType::Gpu,
            status: lingua_scheduler::messages::ServiceStatus::Running,
            version: Some("1.0.0".to_string()),
            model_id: None,
            engine: None,
            mem_mb: None,
            warmup_ms: None,
            last_error: None,
        },
    ]
}

// 注意：以下测试已删除，因为依赖的 create_job() 方法已移除（旧路径代码）
// - test_create_job
// - test_create_job_with_preferred_node
// - test_create_job_no_available_node
// - test_get_job（依赖 create_job）

#[tokio::test]
async fn test_get_nonexistent_job() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry);
    
    let retrieved = dispatcher.get_job("nonexistent").await;
    assert!(retrieved.is_none());
}

// 注意：test_update_job_status 已删除，因为依赖的 create_job() 方法已移除（旧路径代码）

#[tokio::test]
async fn test_update_nonexistent_job_status() {
    let node_registry = create_test_node_registry();
    let dispatcher = JobDispatcher::new(node_registry);
    
    let success = dispatcher.update_job_status("nonexistent", lingua_scheduler::core::dispatcher::JobStatus::Completed).await;
    assert!(!success);
}

