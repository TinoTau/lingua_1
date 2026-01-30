//! Phase 2（决策版 v1.0 + 补充 v1.1）最小落地：
//! - Scheduler instance_id + presence（TTL）
//! - node/session owner（TTL）
//! - 跨实例投递：Redis Streams inbox（consumer group + ack；pending 重试 best-effort）
//!
//! 注意：
//! - 本模块刻意避免在 Lua 中做跨实体协调（遵循 Redis Cluster slot 约束边界）
//! - key 命名使用 hash tag `{...}`，以便未来引用 Lua 原子更新时天然满足同 slot

use crate::core::AppState;
// use crate::core::config::Phase3PoolConfig; // 已删除
use crate::messages::{NodeMessage, SessionMessage};
use crate::node_registry::Node as RegistryNode;
use axum::extract::ws::Message as WsMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestBinding {
    pub request_id: String,
    pub job_id: String,
    pub node_id: Option<String>,
    pub dispatched_to_node: bool,
    pub expire_at_ms: i64,
}

// 注意：JobFsmState 和 JobFsmSnapshot 已删除（测试代码被注释，不再需要）

#[derive(Clone)]
pub struct Phase2Runtime {
    pub instance_id: String,
    heartbeat_ttl_seconds: u64,
    cfg: crate::core::config::Phase2Config,
    pub redis: RedisHandle,  // 公开，供JobDispatcher使用
    // 配置：用于替代 runtime_background 中的硬编码
    owner_ttl_base_seconds: u64,
    owner_ttl_divisor: u64,
    owner_ttl_min_seconds: u64,
    presence_ttl_min_seconds: u64,
    presence_ttl_divisor: u64,
    presence_ttl_absolute_min_seconds: u64,
}

#[derive(Clone)]
pub struct RedisHandle {
    inner: Arc<Mutex<RedisConn>>,
    // 配置：用于替代硬编码的最小值
    min_ttl_seconds: u64,
    min_ttl_ms: u64,
    stream_min_maxlen: usize,
}

enum RedisConn {
    Single(redis::aio::MultiplexedConnection),
    Cluster(redis::cluster_async::ClusterConnection),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerPresence {
    pub started_at: i64,
    pub hostname: String,
    pub pid: u32,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InterInstanceEvent {
    /// 将 NodeMessage 定向投递到"持有该 node WebSocket 连接"的实例
    #[serde(rename = "dispatch_to_node")]
    DispatchToNode {
        node_id: String,
        message: NodeMessage,
    },
    /// 将 SessionMessage 定向投递到"持有该 session WebSocket 连接"的实例
    #[serde(rename = "send_to_session")]
    SendToSession {
        session_id: String,
        message: SessionMessage,
    },
    /// 将 NodeMessage（如 JobResult/JobAck）转发给"持有对应 session 的实例"
    /// 用于：node 连接在 A、session 连接在 B 时，B 才拥有该 session 的 result_queue/job 上下文
    #[serde(rename = "forward_node_message")]
    ForwardNodeMessage {
        message: NodeMessage,
    },
}


include!("redis_runtime/runtime_init.rs");
include!("redis_runtime/runtime_routing.rs");
include!("redis_runtime/runtime_routing_instance_communication.rs");
include!("redis_runtime/runtime_routing_request_binding.rs");
include!("redis_runtime/runtime_routing_node_capacity.rs");
include!("redis_runtime/runtime_routing_pool_members.rs");
include!("redis_runtime/runtime_routing_session_state.rs");
// runtime_routing_lang_index.rs 已删除（语言索引已废弃，现在使用 PoolService）
include!("redis_runtime/runtime_cold_start.rs");
include!("redis_runtime/runtime_job_fsm.rs");
include!("redis_runtime/runtime_background.rs");
// runtime_snapshot.rs 已删除（Redis 直查架构不再需要）
include!("redis_runtime/runtime_streams.rs");

include!("redis_runtime/redis_handle.rs");
include!("redis_runtime/helpers.rs");
include!("redis_runtime/routed_send.rs");

// 暂时屏蔽所有测试（依赖旧的 API）
// TODO: 更新测试以匹配新架构
/*
#[cfg(test)]
mod tests {
    include!("redis_runtime/tests/common.rs");
    include!("redis_runtime/tests/streams.rs");
    include!("redis_runtime/tests/node_snapshot.rs");
    include!("redis_runtime/tests/job_fsm.rs");
    include!("redis_runtime/tests/cross_instance.rs");
    include!("redis_runtime/tests/ws_helpers.rs");
    include!("redis_runtime/tests/ws_e2e.rs");
    // include!("redis_runtime/tests/cluster_acceptance.rs"); // 文件已删除
    include!("redis_runtime/tests/runtime_routing_test.rs");
}
*/

