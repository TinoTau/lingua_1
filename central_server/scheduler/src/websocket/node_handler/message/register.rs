use crate::core::AppState;
use crate::messages::{CapabilityByType, FeatureFlags, HardwareInfo, InstalledModel, InstalledService, NodeMessage, ResourceUsage};
use crate::metrics::metrics::METRICS;
use crate::websocket::send_node_message;
use axum::extract::ws::Message;
use std::sync::atomic::Ordering;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

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
    language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
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
            capability_by_type.clone(),
            // Phase 2: Allow overwriting existing node_id (avoid "remote snapshot exists" causing registration failure)
            state.phase2.is_some(),
            language_capabilities,
            // Phase 2: 传递 phase2_runtime，用于同步动态创建的 Pool 到 Redis
            state.phase2.as_ref().map(|rt| rt.as_ref()),
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
                // Phase 2: 同步节点能力到 Redis（不占用内存）
                // 注意：capability_by_type 已从 Node 结构体中移除，直接从参数传递
                rt.sync_node_capabilities_to_redis(&node.node_id, &capability_by_type).await;
                // Phase 2: Write node snapshot + presence (cross-instance visible)
                rt.upsert_node_snapshot(&node).await;
                
                // Phase 3: 同步 Pool 成员索引到 Redis
                let cfg = state.node_registry.phase3_config().await;
                if cfg.enabled && cfg.mode == "two_level" {
                    let pool_ids = state.node_registry.phase3_node_pool_ids(&node.node_id).await;
                    if !pool_ids.is_empty() {
                        // 获取 pool_index 的克隆
                        let pool_index = state.node_registry.phase3_pool_index_clone(Some(rt.as_ref())).await;
                        let _ = rt.sync_node_pools_to_redis(
                            &node.node_id,
                            &pool_ids,
                            &cfg.pools,
                            &pool_index,
                        ).await;
                    }
                }
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
    asr_metrics: Option<crate::messages::common::ASRMetrics>,
    processing_metrics: Option<crate::messages::common::ProcessingMetrics>,
    language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
) {
    let installed_services_count = installed_services.as_ref().map(|v| v.len()).unwrap_or(0);
    info!(
        "Processing node heartbeat: node_id={}, installed_services_count={}, capability_by_type_count={}",
        node_id,
        installed_services_count,
        capability_by_type.len()
    );
    // 优化：在更新心跳之前检查语言能力是否变化（用于决定是否需要重新分配 Pool）
    let language_capabilities_changed = language_capabilities.is_some();

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
            Some(capability_by_type.clone()),
            processing_metrics.clone(),
            language_capabilities,
        )
        .await;

    // Phase 3: 如果启用了 Phase3，在心跳后更新 Pool 分配（传递 phase2_runtime 以从 Redis 读取配置）
    // 优化：只在语言能力变化或节点状态变化时重新分配 Pool
    {
        let cfg = state.node_registry.phase3_config().await;
        if cfg.enabled && cfg.mode == "two_level" {
            if let Some(rt) = state.phase2.as_ref() {
                // 优化：检查是否需要重新分配 Pool
                // 如果语言能力没有变化（language_capabilities 为 None），且节点已经在 Pool 中，则跳过
                let should_reallocate = if language_capabilities_changed {
                    // 语言能力有变化，需要重新分配
                    true
                } else {
                    // 语言能力没有变化，检查节点是否在 Pool 中
                    let current_pools = state.node_registry.phase3_node_pool_ids(node_id).await;
                    let node_in_pool = !current_pools.is_empty();
                    // 如果节点不在 Pool 中，需要分配
                    !node_in_pool
                };
                
                if should_reallocate {
                    // 使用带 runtime 的版本，以便从 Redis 读取 Pool 配置
                    state.node_registry.phase3_upsert_node_to_pool_index_with_runtime(node_id, Some(rt.as_ref())).await;
                } else {
                    debug!(
                        node_id = %node_id,
                        "节点语言能力未变化且已在 Pool 中，跳过 Pool 重新分配（优化：减少不必要的 Redis 查询）"
                    );
                }
            } else {
                // 产品可用性要求：必须提供 phase2_runtime，不允许降级
                warn!(
                    node_id = %node_id,
                    "Phase3 已启用但未提供 phase2_runtime，跳过 Pool 分配（产品可用性要求）"
                );
            }
        }
    }

    // Trigger status check (immediate trigger)
    state.node_status_manager.on_heartbeat(node_id).await;

    // Gate-B: 处理 Rerun 指标
    if let Some(ref metrics) = rerun_metrics {
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

    // OBS-1: 处理处理效率观测指标（按心跳周期，按服务ID分组）
    if let Some(ref metrics) = processing_metrics {
        if !metrics.service_efficiencies.is_empty() {
            for (service_id, efficiency) in &metrics.service_efficiencies {
                info!(
                    node_id = %node_id,
                    service_id = %service_id,
                    efficiency = efficiency,
                    "OBS-1: Received service processing efficiency from node (heartbeat cycle)"
                );
            }
        } else {
            info!(
                node_id = %node_id,
                "OBS-1: No processing efficiency (no tasks processed in this heartbeat cycle)"
            );
        }
        // TODO: 可以将指标存储到 metrics 系统或数据库中，用于后续分析和展示
        // 注意：调度服务器端可以对每个节点的处理效率进行平均计算
    }
    
    // OBS-1: 向后兼容：处理旧的 ASR 指标（已废弃）
    if let Some(ref metrics) = asr_metrics {
        if let Some(efficiency) = metrics.processing_efficiency {
            info!(
                node_id = %node_id,
                processing_efficiency = efficiency,
                "OBS-1: Received ASR processing efficiency (deprecated, use processing_metrics instead)"
            );
        }
    }

    // Phase 2: Write post-heartbeat node snapshot to Redis (cross-instance visible)
    if let Some(rt) = state.phase2.as_ref() {
        if rt.node_snapshot_enabled() {
            if let Some(node) = state.node_registry.get_node_snapshot(node_id).await {
                // Phase 2: 同步节点能力到 Redis（不占用内存）
                // 注意：capability_by_type 已从 Node 结构体中移除，直接从参数传递
                if !capability_by_type.is_empty() {
                    rt.sync_node_capabilities_to_redis(node_id, &capability_by_type).await;
                }
                rt.upsert_node_snapshot(&node).await;
                // 同步节点容量到Redis（按照设计文档）
                let health = if node.status == crate::messages::NodeStatus::Ready && node.online {
                    "ready"
                } else {
                    "degraded"
                };
                let _ = rt.sync_node_capacity_to_redis(
                    node_id,
                    node.max_concurrent_jobs,
                    node.current_jobs,
                    health,
                ).await;
                
                // Phase 3: 同步 Pool 成员索引到 Redis
                let cfg = state.node_registry.phase3_config().await;
                if cfg.enabled && cfg.mode == "two_level" {
                    let pool_ids = state.node_registry.phase3_node_pool_ids(node_id).await;
                    if !pool_ids.is_empty() {
                        // 获取 pool_index 的克隆
                        let pool_index = state.node_registry.phase3_pool_index_clone(Some(rt.as_ref())).await;
                        let _ = rt.sync_node_pools_to_redis(
                            node_id,
                            &pool_ids,
                            &cfg.pools,
                            &pool_index,
                        ).await;
                    }
                }
            } else {
                rt.touch_node_presence(node_id).await;
            }
        }
    }
}
