use crate::app_state::AppState;
use crate::messages::{CapabilityState, FeatureFlags, HardwareInfo, InstalledModel, InstalledService, NodeMessage, ResourceUsage};
use crate::websocket::send_node_message;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{info, warn};

pub(super) async fn handle_node_register(
    state: &AppState,
    node_id: &mut Option<String>,
    tx: &mpsc::UnboundedSender<Message>,
    provided_node_id: Option<String>,
    version: String,
    capability_schema_version: Option<String>,
    platform: String,
    hardware: HardwareInfo,
    installed_models: Vec<InstalledModel>,
    installed_services: Option<Vec<InstalledService>>,
    features_supported: FeatureFlags,
    accept_public_jobs: bool,
    capability_state: Option<CapabilityState>,
) -> Result<(), anyhow::Error> {
    // 验证 capability_schema_version（如果提供）
    if let Some(ref schema_version) = capability_schema_version {
        if schema_version != "1.0" {
            let error_msg = NodeMessage::Error {
                code: crate::messages::ErrorCode::InvalidCapabilitySchema.to_string(),
                message: format!("不支持的能力描述版本: {}", schema_version),
                details: None,
            };
            send_node_message(tx, &error_msg).await?;
            warn!(
                "Node registration failed (unsupported capability schema version): {}",
                schema_version
            );
            return Ok(());
        }
    }

    // 注册节点（要求必须有 GPU）
    match state
        .node_registry
        .register_node_with_policy(
            provided_node_id,
            format!("Node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase()),
            version,
            platform,
            hardware,
            installed_models,
            installed_services,
            features_supported,
            accept_public_jobs,
            capability_state,
            // Phase 2：允许覆盖已有 node_id（避免“远端快照已存在”导致注册失败）
            state.phase2.is_some(),
        )
        .await
    {
        Ok(node) => {
            *node_id = Some(node.node_id.clone());

            // 注册连接
            state
                .node_connections
                .register(node.node_id.clone(), tx.clone())
                .await;

            // Phase 2：写入 node owner（带 TTL；用于跨实例投递）
            if let Some(rt) = state.phase2.as_ref() {
                rt.set_node_owner(&node.node_id).await;
                // Phase 2：写入 node snapshot + presence（跨实例可见）
                rt.upsert_node_snapshot(&node).await;
            }

            // 发送确认消息（status 初始为 registering）
            let ack = NodeMessage::NodeRegisterAck {
                node_id: node.node_id.clone(),
                message: "registered".to_string(),
                status: "registering".to_string(),
            };

            send_node_message(tx, &ack).await?;
            info!("Node {} registered, status: registering", node.node_id);
        }
        Err(err) => {
            // 注册失败，判断错误类型
            let (error_code, is_node_id_conflict) = if err.contains("ID 冲突") {
                (crate::messages::ErrorCode::NodeIdConflict, true)
            } else {
                (crate::messages::ErrorCode::NoGpuAvailable, false)
            };

            let error_msg = NodeMessage::Error {
                code: error_code.to_string(),
                message: err.clone(),
                details: None,
            };
            send_node_message(tx, &error_msg).await?;

            if is_node_id_conflict {
                warn!("Node registration failed (node_id conflict): {}", err);
            } else {
                warn!("Node registration failed (no GPU): {}", err);
            }
            return Ok(());
        }
    }

    Ok(())
}

pub(super) async fn handle_node_heartbeat(
    state: &AppState,
    node_id: &str,
    resource_usage: ResourceUsage,
    installed_models: Option<Vec<InstalledModel>>,
    installed_services: Option<Vec<InstalledService>>,
    capability_state: Option<CapabilityState>,
) {
    // 更新节点心跳
    state
        .node_registry
        .update_node_heartbeat(
            node_id,
            resource_usage.cpu_percent,
            resource_usage.gpu_percent,
            resource_usage.mem_percent,
            installed_models,
            installed_services,
            resource_usage.running_jobs,
            capability_state,
        )
        .await;

    // 触发状态检查（立即触发）
    state.node_status_manager.on_heartbeat(node_id).await;

    // Phase 2：将心跳后的节点快照写入 Redis（跨实例可见）
    if let Some(rt) = state.phase2.as_ref() {
        if rt.node_snapshot_enabled() {
            if let Some(node) = state.node_registry.get_node_snapshot(node_id).await {
                rt.upsert_node_snapshot(&node).await;
            } else {
                rt.touch_node_presence(node_id).await;
            }
        }
    }
}


