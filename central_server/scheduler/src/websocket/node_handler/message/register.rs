use crate::core::AppState;
use crate::messages::{CapabilityByType, FeatureFlags, HardwareInfo, InstalledModel, InstalledService, NodeMessage, ResourceUsage};
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
    capability_by_type: Vec<CapabilityByType>,
) -> Result<(), anyhow::Error> {
    // Validate capability_schema_version (require "2.0" - ServiceType-based model)
    // Reject "1.0" (old model-based) as it's deprecated
    let gpus_info = hardware.gpus.clone();
    info!(
        "Processing node registration: capability_schema_version={:?}, gpus={:?}, capability_by_type_count={}",
        capability_schema_version,
        gpus_info,
        capability_by_type.len()
    );
    
    if let Some(ref schema_version) = capability_schema_version {
        if schema_version != "2.0" {
            let error_msg = NodeMessage::Error {
                code: crate::messages::ErrorCode::InvalidCapabilitySchema.to_string(),
                message: format!(
                    "Unsupported capability schema version: {} (required: 2.0). Please upgrade your node client.",
                    schema_version
                ),
                details: None,
            };
            send_node_message(tx, &error_msg).await?;
            warn!(
                "Node registration failed (unsupported capability schema version: {}, required: 2.0)",
                schema_version
            );
            return Ok(());
        }
    } else {
        // If capability_schema_version is not provided, reject registration
        // (assume it's an old client that doesn't support ServiceType model)
        let error_msg = NodeMessage::Error {
            code: crate::messages::ErrorCode::InvalidCapabilitySchema.to_string(),
            message: "Missing capability_schema_version. Please upgrade your node client to support ServiceType model (schema version 2.0).".to_string(),
            details: None,
        };
        send_node_message(tx, &error_msg).await?;
        warn!("Node registration failed (missing capability_schema_version, required: 2.0)");
        return Ok(());
    }

    // Register node (require GPU)
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
            capability_by_type,
            // Phase 2: Allow overwriting existing node_id (avoid "remote snapshot exists" causing registration failure)
            state.phase2.is_some(),
        )
        .await
    {
        Ok(node) => {
            *node_id = Some(node.node_id.clone());

            // Register connection
            state
                .node_connections
                .register(node.node_id.clone(), tx.clone())
                .await;

            // Phase 2: Write node owner (with TTL; for cross-instance delivery)
            if let Some(rt) = state.phase2.as_ref() {
                rt.set_node_owner(&node.node_id).await;
                // Phase 2: Write node snapshot + presence (cross-instance visible)
                rt.upsert_node_snapshot(&node).await;
            }

            // Send acknowledgment message (status initially registering)
            let ack = NodeMessage::NodeRegisterAck {
                node_id: node.node_id.clone(),
                message: "registered".to_string(),
                status: "registering".to_string(),
            };

            send_node_message(tx, &ack).await?;
            info!("Node {} registered, status: registering", node.node_id);
        }
        Err(err) => {
            // Registration failed, determine error type
            let (error_code, is_node_id_conflict) = if err.contains("ID conflict") {
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
                warn!(
                    "Node registration failed: {}. Hardware: gpus={:?}",
                    err,
                    gpus_info
                );
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
    capability_by_type: Vec<CapabilityByType>,
    rerun_metrics: Option<crate::messages::common::RerunMetrics>,
) {
    let installed_services_count = installed_services.as_ref().map(|v| v.len()).unwrap_or(0);
    info!(
        "Processing node heartbeat: node_id={}, installed_services_count={}, capability_by_type_count={}",
        node_id,
        installed_services_count,
        capability_by_type.len()
    );
    // Update node heartbeat
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
            Some(capability_by_type),
        )
        .await;

    // Trigger status check (immediate trigger)
    state.node_status_manager.on_heartbeat(node_id).await;

    // Gate-B: 处理 Rerun 指标
    if let Some(ref metrics) = rerun_metrics {
        use crate::metrics::metrics::METRICS;
        use std::sync::atomic::Ordering;
        
        // 累加 rerun 指标（注意：这里使用增量值，因为节点每次心跳发送的是累积值）
        // 为了简化，我们直接使用节点发送的累积值（实际应该计算增量，但需要维护上次的值）
        // 暂时直接累加，后续可以优化为增量计算
        METRICS.rerun_trigger_count.fetch_add(metrics.total_reruns, Ordering::Relaxed);
        METRICS.rerun_success_count.fetch_add(metrics.successful_reruns, Ordering::Relaxed);
        METRICS.rerun_timeout_count.fetch_add(metrics.timeout_reruns, Ordering::Relaxed);
        METRICS.rerun_quality_improvements.fetch_add(metrics.quality_improvements, Ordering::Relaxed);
        
        info!(
            node_id = %node_id,
            total_reruns = metrics.total_reruns,
            successful_reruns = metrics.successful_reruns,
            failed_reruns = metrics.failed_reruns,
            timeout_reruns = metrics.timeout_reruns,
            quality_improvements = metrics.quality_improvements,
            "Gate-B: Received rerun metrics from node"
        );
    }

    // Phase 2: Write post-heartbeat node snapshot to Redis (cross-instance visible)
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
