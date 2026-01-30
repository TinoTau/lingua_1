use crate::core::AppState;
use axum::response::IntoResponse;
// ServiceType, Query, Deserialize, Serialize, FromStr 已删除（phase3_simulate API已删除）

// 健康检查
pub async fn health_check() -> &'static str {
    "OK"
}

// 统计API端点
pub async fn get_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl axum::response::IntoResponse {
    let t0 = std::time::Instant::now();
    // v1.1 规范：请求路径不做现场生成；冷启动直接返回空快照，并触发一次后台刷新（SingleFlight + 频率限制）。
    if state.dashboard_snapshot.last_updated_at_ms().await == 0 {
        state.dashboard_snapshot.try_trigger_refresh_nonblocking(state.clone());
    }

    let json = state.dashboard_snapshot.get_json().await;
    let updated_at = state.dashboard_snapshot.last_updated_at_ms().await;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let is_stale = updated_at == 0 || (now_ms - updated_at) > 10_000; // 简单阈值：>10s 视为 stale（经验值）
    crate::metrics::metrics::on_stats_response(is_stale);
    crate::metrics::prometheus_metrics::observe_stats_request_duration_seconds(t0.elapsed().as_secs_f64());
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json,
    )
}

pub async fn get_metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<crate::metrics::metrics::MetricsSnapshot> {
    axum::Json(crate::metrics::collect(&state).await)
}

// 集群监控 API 端点
#[derive(serde::Serialize)]
pub struct ClusterStatsResponse {
    instances: Vec<InstanceInfo>,
    total_instances: usize,
    online_instances: usize,
    total_nodes: usize,
    online_nodes: usize,
    ready_nodes: usize, // 服务就绪的节点数
    total_sessions: usize,
    total_pending: u64,
    total_dlq: u64,
    redis_key_prefix: String,
    nodes: Vec<NodeInfo>, // 节点列表（包含服务状态）
}

#[derive(serde::Serialize)]
pub struct NodeInfo {
    node_id: String,
    platform: String,
    online: bool,
    status: String, // NodeStatus 的字符串表示
    cpu_usage: f32,
    gpu_usage: Option<f32>,
    memory_usage: f32,
    current_jobs: usize,
    max_concurrent_jobs: usize,
    last_heartbeat: i64, // 时间戳（毫秒）
    // 服务状态信息
    services: Vec<ServiceStatusInfo>,
    // 能力状态（按 ServiceType）
    capabilities: Vec<CapabilityStatusInfo>,
}

#[derive(serde::Serialize)]
pub struct ServiceStatusInfo {
    service_id: String,
    service_type: String, // ServiceType 的字符串表示
    status: String, // ServiceStatus 的字符串表示
}

#[derive(serde::Serialize)]
pub struct CapabilityStatusInfo {
    service_type: String, // ServiceType 的字符串表示
    ready: bool,
    reason: Option<String>,
    ready_impl_ids: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
pub struct InstanceInfo {
    instance_id: String,
    hostname: String,
    pid: u32,
    version: String,
    started_at_ms: i64,
    uptime_seconds: i64,
    is_online: bool,
    inbox_length: u64,
    inbox_pending: u64,
    dlq_length: u64,
    nodes_owned: usize,
    sessions_owned: usize,
}

pub async fn get_cluster_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Response {
    let phase2 = match &state.phase2 {
        Some(rt) => rt,
        None => {
            tracing::warn!("Cluster stats API called but Phase2 is not enabled");
            return (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                r#"{"error":"Phase2 not enabled","message":"Please enable Phase2 in config.toml: [scheduler.phase2] enabled = true"}"#,
            )
                .into_response();
        }
    };

    let key_prefix = phase2.key_prefix();
    let now_ms = chrono::Utc::now().timestamp_millis();

    // 获取所有实例的 presence keys
    let presence_pattern = format!("{}:schedulers:presence:*", key_prefix);
    let mut cmd = redis::cmd("KEYS");
    cmd.arg(&presence_pattern);
    
    let instance_keys: Vec<String> = match phase2.redis_query::<Vec<String>>(cmd).await {
        Ok(keys) => {
            tracing::debug!("Found {} instance keys from Redis", keys.len());
            keys
        },
        Err(e) => {
            tracing::error!("Failed to get instance keys from Redis: {} (pattern: {})", e, presence_pattern);
            // 返回错误响应而不是空数组
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                format!(r#"{{"error":"Redis query failed","message":"Failed to query instance keys: {}"}}"#, e),
            )
                .into_response();
        }
    };

    let total_instances_count = instance_keys.len();
    let mut instances = Vec::new();
    let mut total_pending = 0u64;
    let mut total_dlq = 0u64;
    let mut online_count = 0;

    for key in instance_keys {
        // 提取 instance_id
        let instance_id = key
            .strip_prefix(&format!("{}:schedulers:presence:", key_prefix))
            .unwrap_or("")
            .to_string();

        // 读取 presence 信息
        let presence_json: Option<String> = phase2.redis_get_string(&key).await.ok().flatten();

        #[derive(serde::Deserialize)]
        struct SchedulerPresence {
            started_at: i64,
            hostname: String,
            pid: u32,
            version: String,
        }
        
        let presence: SchedulerPresence = match presence_json {
            Some(json) => match serde_json::from_str(&json) {
                Ok(p) => p,
                Err(_) => continue,
            },
            None => continue,
        };

        let is_online = true; // key 存在说明在线
        if is_online {
            online_count += 1;
        }

        let uptime_seconds = (now_ms - presence.started_at) / 1000;

        // 获取 inbox 信息
        let inbox_key = format!("{}:streams:{{instance:{}}}:inbox", key_prefix, instance_id);
        let mut xlen_cmd = redis::cmd("XLEN");
        xlen_cmd.arg(&inbox_key);
        let inbox_length: u64 = match phase2.redis_query::<u64>(xlen_cmd).await {
            Ok(v) => v,
            Err(_) => 0,
        };

        // 获取 pending 信息
        let stream_group = phase2.stream_group();
        let mut xpending_cmd = redis::cmd("XPENDING");
        xpending_cmd.arg(&inbox_key).arg(stream_group);
        let pending_summary: Option<Vec<redis::Value>> = match phase2.redis_query::<Vec<redis::Value>>(xpending_cmd).await {
            Ok(v) => Some(v),
            Err(_) => None,
        };
        let inbox_pending = pending_summary
            .and_then(|v| v.first().and_then(|v| redis::from_redis_value::<u64>(v).ok()))
            .unwrap_or(0);
        total_pending += inbox_pending;

        // 获取 DLQ 信息
        let dlq_key = format!("{}:streams:{{instance:{}}}:dlq", key_prefix, instance_id);
        let mut dlq_xlen_cmd = redis::cmd("XLEN");
        dlq_xlen_cmd.arg(&dlq_key);
        let dlq_length: u64 = match phase2.redis_query::<u64>(dlq_xlen_cmd).await {
            Ok(v) => v,
            Err(_) => 0,
        };
        total_dlq += dlq_length;

        // 统计该实例拥有的 nodes 和 sessions（简化：只统计 owner keys）
        // 注意：这里只做粗略统计，完整统计需要扫描所有 owner keys
        let nodes_owned = 0; // TODO: 可以通过 SCAN 统计，但性能开销较大
        let sessions_owned = 0;

        instances.push(InstanceInfo {
            instance_id: instance_id.clone(),
            hostname: presence.hostname,
            pid: presence.pid,
            version: presence.version,
            started_at_ms: presence.started_at,
            uptime_seconds,
            is_online,
            inbox_length,
            inbox_pending,
            dlq_length,
            nodes_owned,
            sessions_owned,
        });
    }

    // 获取节点列表和服务状态（从 Redis 直查）
    let (total_nodes, online_nodes, ready_nodes, nodes_list) = {
        // 使用 Redis 直查获取所有节点
        let nodes = match state.node_registry.list_sched_nodes().await {
            Ok(n) => n,
            Err(e) => {
                tracing::warn!(error = %e, "查询节点列表失败");
                vec![]
            }
        };
        
        let total = nodes.len();
        let online = nodes.iter().filter(|n| n.online).count();
        
        // 统计 ready 节点（拥有所有核心服务）
        let ready = nodes.iter().filter(|n| {
            if !n.online { return false; }
            let has_asr = n.installed_services.iter().any(|s| matches!(s.r#type, crate::messages::ServiceType::Asr));
            let has_nmt = n.installed_services.iter().any(|s| matches!(s.r#type, crate::messages::ServiceType::Nmt));
            let has_tts = n.installed_services.iter().any(|s| matches!(s.r#type, crate::messages::ServiceType::Tts));
            has_asr && has_nmt && has_tts
        }).count();
        
        // 构建节点列表
        let nodes_list: Vec<NodeInfo> = {
            let mut result = Vec::new();
            for node in nodes.iter() {
                // 构建服务状态列表
                let services: Vec<ServiceStatusInfo> = node.installed_services.iter().map(|s| {
                    ServiceStatusInfo {
                        service_id: s.service_id.clone(),
                        service_type: format!("{:?}", s.r#type),
                        status: format!("{:?}", s.status),
                    }
                }).collect();
                
                // 构建能力状态列表（基于 installed_services）
                let capabilities: Vec<CapabilityStatusInfo> = [
                    crate::messages::ServiceType::Asr,
                    crate::messages::ServiceType::Nmt,
                    crate::messages::ServiceType::Tts,
                    crate::messages::ServiceType::Tone,
                    crate::messages::ServiceType::Semantic,
                ].iter().map(|service_type| {
                    let ready = node.installed_services.iter().any(|s| &s.service_id == &format!("{:?}", service_type));
                    CapabilityStatusInfo {
                        service_type: format!("{:?}", service_type),
                        ready,
                        reason: None,
                        ready_impl_ids: None,
                    }
                }).collect();
            
                result.push(NodeInfo {
                    node_id: node.node_id.clone(),
                    platform: "".to_string(), // SchedNodeInfo 中没有 platform
                    online: node.online,
                    status: node.status.clone(),
                    cpu_usage: node.cpu_usage,
                    gpu_usage: node.gpu_usage,
                    memory_usage: node.memory_usage,
                    current_jobs: node.current_jobs,
                    max_concurrent_jobs: node.max_concurrency as usize,
                    last_heartbeat: node.last_heartbeat_ts,
                    services,
                    capabilities,
                });
            }
            result
        };
        
        (total, online, ready, nodes_list)
    };
    tracing::debug!("Total nodes: {}, online: {}, ready: {}", total_nodes, online_nodes, ready_nodes);

    // 获取会话数（简化：从本地状态获取，多实例需要从 Redis 聚合）
    let total_sessions = state.session_manager.list_all_sessions().await.len();
    tracing::debug!("Total sessions from local state: {}", total_sessions);

    let response = ClusterStatsResponse {
        instances,
        total_instances: total_instances_count,
        online_instances: online_count,
        total_nodes,
        online_nodes,
        ready_nodes,
        total_sessions,
        total_pending,
        total_dlq,
        redis_key_prefix: key_prefix.to_string(),
        nodes: nodes_list,
    };

    tracing::info!(
        "Cluster stats: {} instances ({} online), {} nodes ({} online, {} ready), {} sessions, {} pending, {} dlq",
        total_instances_count,
        online_count,
        total_nodes,
        online_nodes,
        ready_nodes,
        total_sessions,
        total_pending,
        total_dlq
    );

    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        serde_json::to_string(&response).unwrap_or_else(|e| {
            tracing::error!("Failed to serialize cluster stats response: {}", e);
            r#"{"error":"Serialization failed"}"#.to_string()
        }),
    )
        .into_response()
}

// Phase3 相关 API 已删除
// 使用 PoolService 提供新的 Pool API

// get_phase3_simulate API 已删除（Phase3已删除）

pub async fn get_prometheus_metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl axum::response::IntoResponse {
    let (body, content_type) = crate::metrics::prometheus_metrics::render_text(&state).await;
    let hv = axum::http::HeaderValue::from_str(&content_type).unwrap_or_else(|_| {
        axum::http::HeaderValue::from_static("text/plain; charset=utf-8")
    });
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, hv)],
        body,
    )
}

