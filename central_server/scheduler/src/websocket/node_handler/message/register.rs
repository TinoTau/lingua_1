use crate::core::AppState;
use crate::messages::{CapabilityByType, FeatureFlags, HardwareInfo, InstalledModel, InstalledService, ResourceUsage, NodeMessage};
use crate::services::minimal_scheduler::RegisterNodeRequest;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use anyhow::Result;

/// 从节点语言能力中提取 ASR、Semantic、TTS 语言；允许空（注册时可为空，心跳再更新池）。
fn extract_langs_optional(
    lang_caps: &Option<crate::messages::common::NodeLanguageCapabilities>,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let caps = match lang_caps.as_ref() {
        Some(c) => c,
        None => return (vec![], vec![], vec![]),
    };
    let asr = caps.asr_languages.clone().unwrap_or_default();
    let semantic = caps.semantic_languages.clone().unwrap_or_default();
    let tts = caps.tts_languages.clone().unwrap_or_default();
    (asr, semantic, tts)
}

/// 节点注册处理（极简版）
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
    _capability_by_type: Vec<CapabilityByType>,
    language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
) -> Result<(), anyhow::Error> {
    // 流程日志 1: 注册流程开始
    info!(
        step = "register_start",
        "【节点管理流程】注册流程开始"
    );

    let scheduler = state.minimal_scheduler.as_ref()
        .ok_or_else(|| anyhow::anyhow!("MinimalSchedulerService not initialized (Phase2 not enabled)"))?;

    // 生成节点 ID
    let final_node_id = provided_node_id.unwrap_or_else(|| {
        format!("node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase())
    });
    *node_id = Some(final_node_id.clone());
    
    // 流程日志 2: 节点 ID 确定
    info!(
        step = "register_id_generated",
        node_id = %final_node_id,
        "【节点管理流程】节点 ID 已生成"
    );

    // 从语言能力提取 ASR、Semantic、TTS（允许空，心跳再更新池）
    let (asr_langs, semantic_langs, tts_langs) = extract_langs_optional(&language_capabilities);
    info!(
        step = "register_langs",
        node_id = %final_node_id,
        asr_len = asr_langs.len(),
        semantic_len = semantic_langs.len(),
        tts_len = tts_langs.len(),
        "【节点管理流程】注册语言能力（可为空，池在心跳时分配）"
    );
    let asr_langs_json = serde_json::to_string(&asr_langs)?;
    let semantic_langs_json = serde_json::to_string(&semantic_langs)?;
    let tts_langs_json = serde_json::to_string(&tts_langs)?;

    let req = RegisterNodeRequest {
        node_id: final_node_id.clone(),
        asr_langs_json,
        semantic_langs_json,
        tts_langs_json,
    };

    // 流程日志 4: 准备写入 Redis
    info!(
        step = "register_redis_write",
        node_id = %final_node_id,
        "【节点管理流程】准备调用 register_node_v2.lua 写入 Redis（SSOT）"
    );

    // 调用新实现
    let t0 = std::time::Instant::now();
    scheduler.register_node(req).await
        .map_err(|e| {
            warn!(
                step = "register_redis_failed",
                node_id = %final_node_id,
                error = %e,
                "【节点管理流程】Redis 注册失败"
            );
            e
        })?;
    
    // 流程日志 5: Redis 写入成功
    info!(
        step = "register_redis_success",
        node_id = %final_node_id,
        elapsed_ms = t0.elapsed().as_millis(),
        "【节点管理流程】Redis 注册成功（节点状态已写入 SSOT）"
    );

    // 注册节点的 WebSocket 连接（用于发送任务）
    // 注意：连接注册必须在节点注册成功后执行，否则任务无法发送
    state.node_connections.register(final_node_id.clone(), tx.clone()).await;
    
    // 流程日志 6: WebSocket 连接已注册
    info!(
        step = "register_connection_registered",
        node_id = %final_node_id,
        "【节点管理流程】WebSocket 连接已注册（可接收任务）"
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
    
    // 流程日志 7: 注册流程完成
    info!(
        step = "register_complete",
        node_id = %final_node_id,
        "【节点管理流程】注册流程完成✅ (已发送 node_register_ack，Pool 将在首次心跳时分配)"
    );

    Ok(())
}

/// 节点心跳处理：更新节点语言能力，若变更则清池再分配，再刷新 TTL 并分配池
pub(super) async fn handle_node_heartbeat(
    state: &AppState,
    node_id: &str,
    _resource_usage: ResourceUsage,
    _installed_models: Option<Vec<InstalledModel>>,
    _installed_services: Option<Vec<InstalledService>>,
    _capability_by_type: Vec<CapabilityByType>,
    _rerun_metrics: Option<crate::messages::common::RerunMetrics>,
    _asr_metrics: Option<crate::messages::common::ASRMetrics>,
    _processing_metrics: Option<crate::messages::common::ProcessingMetrics>,
    language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
) {
    info!(step = "heartbeat_start", node_id = %node_id, "【节点管理流程】收到节点心跳");

    let (asr_langs, semantic_langs, tts_langs) = extract_langs_optional(&language_capabilities);
    let asr_json = serde_json::to_string(&asr_langs).unwrap_or_else(|_| "[]".to_string());
    let semantic_json = serde_json::to_string(&semantic_langs).unwrap_or_else(|_| "[]".to_string());
    let tts_json = serde_json::to_string(&tts_langs).unwrap_or_else(|_| "[]".to_string());

    if let (Some(scheduler), Some(pool_service)) = (state.minimal_scheduler.as_ref(), state.pool_service.as_ref()) {
        let need_pool = !asr_langs.is_empty() && !semantic_langs.is_empty();
        if need_pool {
            let cur = scheduler.get_node_languages(node_id).await.ok().flatten();
            if let Some((cur_asr, cur_semantic)) = cur {
                if cur_asr != asr_json || cur_semantic != semantic_json {
                    if let Err(e) = pool_service.node_clear_pools(node_id).await {
                        tracing::warn!(node_id = %node_id, error = %e, "心跳语言变更时清池失败");
                    }
                }
            }
        }
        if let Err(e) = scheduler.update_node_languages(node_id, &asr_json, &semantic_json, &tts_json).await {
            tracing::warn!(node_id = %node_id, error = %e, "心跳更新节点语言失败");
        }
        if need_pool {
            let t0 = std::time::Instant::now();
            match pool_service.heartbeat(node_id).await {
                Ok(_) => {
                    info!(
                        step = "heartbeat_redis_success",
                        node_id = %node_id,
                        elapsed_ms = t0.elapsed().as_millis(),
                        "【节点管理流程】Redis 心跳成功（TTL 已刷新，节点池已分配）"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        step = "heartbeat_redis_failed",
                        node_id = %node_id,
                        error = %e,
                        elapsed_ms = t0.elapsed().as_millis(),
                        "【节点管理流程】Redis 心跳失败"
                    );
                }
            }
        }
    } else {
        tracing::warn!(
            step = "heartbeat_no_services",
            node_id = %node_id,
            "【节点管理流程】MinimalScheduler 或 PoolService 未初始化"
        );
    }

    debug!(step = "heartbeat_complete", node_id = %node_id, "【节点管理流程】心跳流程完成✅");
}
