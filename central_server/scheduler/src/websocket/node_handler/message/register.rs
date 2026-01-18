use crate::core::AppState;
use crate::messages::{CapabilityByType, FeatureFlags, HardwareInfo, InstalledModel, InstalledService, ResourceUsage, NodeMessage};
use crate::services::minimal_scheduler::{RegisterNodeRequest, HeartbeatRequest};
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// 节点注册处理（使用极简无锁调度服务）
pub(super) async fn handle_node_register(
    state: &AppState,
    node_id: &mut Option<String>,
    tx: &mpsc::UnboundedSender<Message>,
    provided_node_id: Option<String>,
    _version: String,
    _capability_schema_version: Option<String>,
    _platform: String,
    _hardware: HardwareInfo,
    _installed_models: Vec<InstalledModel>,
    _installed_services: Option<Vec<InstalledService>>,
    _features_supported: FeatureFlags,
    _accept_public_jobs: bool,
    capability_by_type: Vec<CapabilityByType>,
    _language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
) -> Result<(), anyhow::Error> {
    let scheduler = state.minimal_scheduler.as_ref()
        .ok_or_else(|| anyhow::anyhow!("MinimalSchedulerService not initialized (Phase2 not enabled)"))?;

    // 生成节点 ID
    let final_node_id = provided_node_id.unwrap_or_else(|| {
        format!("node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase())
    });
    *node_id = Some(final_node_id.clone());

    // 将能力信息序列化为 JSON
    let cap_json = serde_json::to_string(&capability_by_type)?;

    // 从语言能力提取 pool names
    // 根据原代码逻辑，从 semantic_languages 生成 pool name（排序后的语言集合，用 '-' 连接）
    let pool_names_json = if let Some(ref lang_caps) = _language_capabilities {
        if let Some(ref semantic_langs) = lang_caps.semantic_languages {
            if !semantic_langs.is_empty() {
                // 排序语言集合（与 Pool 命名规则一致）
                let mut sorted_langs = semantic_langs.clone();
                sorted_langs.sort();
                let pool_name = sorted_langs.join("-");
                
                // 使用 UUID v4 生成 pool_id（每次生成新的 UUID，不考虑兼容性）
                let pool_uuid = Uuid::new_v4();
                
                // 从 UUID 中提取 u16（使用前 2 个字节）
                let uuid_bytes = pool_uuid.as_bytes();
                let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);
                
                // 生成 pool_names_json
                // 格式: [{"id":pool_id,"name":"zh-en"}]
                let pool_info = serde_json::json!({
                    "id": pool_id,
                    "name": pool_name
                });
                Some(serde_json::to_string(&vec![pool_info])?)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // 创建注册请求
    let req = RegisterNodeRequest {
        node_id: final_node_id.clone(),
        cap_json,
        pool_names_json,
    };

    // 调用新实现
    scheduler.register_node(req).await
        .map_err(|e| {
            warn!(node_id = %final_node_id, error = %e, "节点注册失败");
            e
        })?;

    // 注册节点的 WebSocket 连接（用于发送任务）
    // 注意：连接注册必须在节点注册成功后执行，否则任务无法发送
    state.node_connections.register(final_node_id.clone(), tx.clone()).await;
    
    debug!(
        node_id = %final_node_id,
        "节点连接已注册"
    );

    // 发送 node_register_ack 消息给节点
    // 节点端依赖此消息来设置 nodeId，然后才能处理任务
    let ack = NodeMessage::NodeRegisterAck {
        node_id: final_node_id.clone(),
        message: "Node registered successfully".to_string(),
        status: "registering".to_string(), // 初始状态为 registering
    };
    
    let ack_json = serde_json::to_string(&ack)
        .map_err(|e| anyhow::anyhow!("Failed to serialize node_register_ack: {}", e))?;
    
    if let Err(e) = tx.send(Message::Text(ack_json)) {
        warn!(
            node_id = %final_node_id,
            error = %e,
            "Failed to send node_register_ack message"
        );
        return Err(anyhow::anyhow!("Failed to send node_register_ack: {}", e));
    }
    
    info!(
        node_id = %final_node_id,
        "已发送 node_register_ack 消息"
    );

    Ok(())
}

/// 节点心跳处理（使用极简无锁调度服务）
pub(super) async fn handle_node_heartbeat(
    state: &AppState,
    node_id: &str,
    _resource_usage: ResourceUsage,
    _installed_models: Option<Vec<InstalledModel>>,
    _installed_services: Option<Vec<InstalledService>>,
    capability_by_type: Vec<CapabilityByType>,
    _rerun_metrics: Option<crate::messages::common::RerunMetrics>,
    _asr_metrics: Option<crate::messages::common::ASRMetrics>,
    _processing_metrics: Option<crate::messages::common::ProcessingMetrics>,
    _language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
) {
    // 1. 更新节点心跳状态（通过极简调度服务）
    if let Some(scheduler) = state.minimal_scheduler.as_ref() {
        // 注意：load_json 已被移除，因为其中的字段（cpu_percent, gpu_percent, mem_percent, running_jobs）
        // 都未被使用。节点任务管理由节点端 GPU 仲裁器负责，调度服务器不再管理。
        let req = HeartbeatRequest {
            node_id: node_id.to_string(),
            online: true,
            load_json: None,
        };

        if let Err(e) = scheduler.heartbeat(req).await {
            tracing::warn!(node_id = %node_id, error = %e, "节点心跳失败");
        }
    }

    // 2. 同步节点能力到 Redis（如果提供了能力信息）
    // 服务热插拔：当节点启动/停止服务时，能力会变化，需要同步到 Redis
    if let Some(phase2_runtime) = state.phase2.as_ref() {
        if !capability_by_type.is_empty() {
            phase2_runtime.sync_node_capabilities_to_redis(node_id, &capability_by_type).await;
            tracing::debug!(
                node_id = %node_id,
                capability_count = capability_by_type.len(),
                "节点能力已同步到 Redis"
            );
        }
    }

    // 3. 触发 Pool 重新分配（如果服务能力变化）
    // 服务热插拔：当节点服务能力变化时，需要重新分配 Pool
    if let Some(phase2_runtime) = state.phase2.as_ref() {
        let phase2_ref = phase2_runtime.as_ref();
        state.node_registry.phase3_upsert_node_to_pool_index_with_runtime(node_id, Some(phase2_ref)).await;
        tracing::debug!(
            node_id = %node_id,
            "已触发 Pool 重新分配检查"
        );
    }
}
