use crate::core::AppState;
use crate::messages::{CapabilityByType, FeatureFlags, HardwareInfo, InstalledModel, InstalledService, ResourceUsage, NodeMessage};
use crate::services::minimal_scheduler::RegisterNodeRequest;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use anyhow::{anyhow, Result};

/// 从节点语言能力中提取 ASR 和 Semantic 语言
/// 
/// # 核心规则
/// 
/// - ASR 语言作为源语言（用户说的语言）
/// - Semantic 语言作为目标语言（系统输出的语言）
/// - Semantic 服务是必需的，semantic_languages 不能为空
/// 
/// # 返回
/// 提取 ASR、Semantic、TTS 语言。
/// Semantic 用于能力校验（必填）；池分配使用 (asr × tts)，与任务查找 (src, tgt) 一致。
fn extract_langs(
    lang_caps: &Option<crate::messages::common::NodeLanguageCapabilities>,
) -> Result<(Vec<String>, Vec<String>, Vec<String>)> {
    let caps = lang_caps.as_ref()
        .ok_or_else(|| anyhow!("language_capabilities is required"))?;
    
    let asr_langs = caps.asr_languages.clone()
        .ok_or_else(|| anyhow!("asr_languages is required"))?;
    let semantic_langs = caps.semantic_languages.clone()
        .ok_or_else(|| anyhow!("semantic_languages is required"))?;
    let tts_langs = caps.tts_languages.clone()
        .ok_or_else(|| anyhow!("tts_languages is required"))?;
    
    if asr_langs.is_empty() {
        return Err(anyhow!("asr_languages cannot be empty"));
    }
    if semantic_langs.is_empty() {
        return Err(anyhow!(
            "semantic_languages cannot be empty. Semantic service is mandatory for all nodes."
        ));
    }
    if tts_langs.is_empty() {
        return Err(anyhow!("tts_languages cannot be empty"));
    }
    
    Ok((asr_langs, semantic_langs, tts_langs))
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
    capability_by_type: Vec<CapabilityByType>,
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

    // 将能力信息序列化为 JSON
    let _cap_json = serde_json::to_string(&capability_by_type)?;

    // 从语言能力提取 ASR、Semantic、TTS 语言
    let (asr_langs, semantic_langs, tts_langs) = extract_langs(&language_capabilities)?;
    
    info!(
        step = "register_langs_validated",
        node_id = %final_node_id,
        asr_langs = ?asr_langs,
        semantic_langs = ?semantic_langs,
        tts_langs = ?tts_langs,
        "【节点管理流程】语言能力验证通过（Semantic 必需✅，池分配用 asr×tts）"
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

/// 节点心跳处理
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
    _language_capabilities: Option<crate::messages::common::NodeLanguageCapabilities>,
) {
    // 流程日志 1: 心跳流程开始
    debug!(
        step = "heartbeat_start",
        node_id = %node_id,
        "【节点管理流程】心跳流程开始"
    );

    // 使用 PoolService 处理心跳（自动分配池）
    if let Some(pool_service) = state.pool_service.as_ref() {
        // 流程日志 2: 调用 Redis Lua
        let t0 = std::time::Instant::now();
        match pool_service.as_ref().heartbeat(node_id).await {
            Ok(_) => {
                // 流程日志 3: Redis 心跳成功
                debug!(
                    step = "heartbeat_redis_success",
                    node_id = %node_id,
                    elapsed_ms = t0.elapsed().as_millis(),
                    "【节点管理流程】Redis 心跳成功（TTL 已刷新，Pool 已自动分配）"
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
    } else {
        tracing::warn!(
            step = "heartbeat_no_pool_service",
            node_id = %node_id,
            "【节点管理流程】PoolService 未初始化"
        );
    }
    
    // 流程日志 4: 心跳流程完成
    debug!(
        step = "heartbeat_complete",
        node_id = %node_id,
        "【节点管理流程】心跳流程完成✅"
    );
}
