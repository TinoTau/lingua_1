//! Phase 2（决策版 v1.0 + 补充 v1.1）最小落地：
//! - Scheduler instance_id + presence（TTL）
//! - node/session owner（TTL）
//! - 跨实例投递：Redis Streams inbox（consumer group + ack；pending 重试 best-effort）
//!
//! 注意：
//! - 本模块刻意避免在 Lua 中做跨实体协调（遵循 Redis Cluster slot 约束边界）
//! - key 命名使用 hash tag `{...}`，以便未来引入 Lua 原子更新时天然满足同 slot

use crate::app_state::AppState;
use crate::messages::{NodeMessage, SessionMessage};
use crate::node_registry::Node as RegistryNode;
use axum::extract::ws::Message as WsMessage;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestBinding {
    pub request_id: String,
    pub job_id: String,
    pub node_id: Option<String>,
    pub dispatched_to_node: bool,
    pub expire_at_ms: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobFsmState {
    Created,
    Dispatched,
    Accepted,
    Running,
    Finished,
    Released,
}

#[allow(dead_code)]
impl JobFsmState {
    fn as_str(&self) -> &'static str {
        match self {
            JobFsmState::Created => "CREATED",
            JobFsmState::Dispatched => "DISPATCHED",
            JobFsmState::Accepted => "ACCEPTED",
            JobFsmState::Running => "RUNNING",
            JobFsmState::Finished => "FINISHED",
            JobFsmState::Released => "RELEASED",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "CREATED" => Some(JobFsmState::Created),
            "DISPATCHED" => Some(JobFsmState::Dispatched),
            "ACCEPTED" => Some(JobFsmState::Accepted),
            "RUNNING" => Some(JobFsmState::Running),
            "FINISHED" => Some(JobFsmState::Finished),
            "RELEASED" => Some(JobFsmState::Released),
            _ => None,
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobFsmSnapshot {
    pub job_id: String,
    pub state: String,
    pub node_id: Option<String>,
    pub attempt_id: u32,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_ok: Option<bool>,
}

#[derive(Clone)]
pub struct Phase2Runtime {
    pub instance_id: String,
    heartbeat_ttl_seconds: u64,
    cfg: crate::config::Phase2Config,
    redis: RedisHandle,
}

#[derive(Clone)]
struct RedisHandle {
    inner: Arc<Mutex<RedisConn>>,
}

enum RedisConn {
    Single(redis::aio::MultiplexedConnection),
    Cluster(redis::cluster_async::ClusterConnection),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SchedulerPresence {
    started_at: i64,
    hostname: String,
    pid: u32,
    version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InterInstanceEvent {
    /// 将 NodeMessage 定向投递到“持有该 node WebSocket 连接”的实例
    #[serde(rename = "dispatch_to_node")]
    DispatchToNode {
        node_id: String,
        message: NodeMessage,
    },
    /// 将 SessionMessage 定向投递到“持有该 session WebSocket 连接”的实例
    #[serde(rename = "send_to_session")]
    SendToSession {
        session_id: String,
        message: SessionMessage,
    },
    /// 将 NodeMessage（如 JobResult/JobAck）转发给“持有对应 session 的实例”
    /// 用于：node 连接在 A、session 连接在 B 时，B 才拥有该 session 的 result_queue/job 上下文。
    #[serde(rename = "forward_node_message")]
    ForwardNodeMessage {
        message: NodeMessage,
    },
}


include!("phase2/runtime_init.rs");
include!("phase2/runtime_routing.rs");
include!("phase2/runtime_job_fsm.rs");
include!("phase2/runtime_background.rs");
include!("phase2/runtime_snapshot.rs");
include!("phase2/runtime_streams.rs");

include!("phase2/redis_handle.rs");
include!("phase2/helpers.rs");
include!("phase2/routed_send.rs");

#[cfg(test)]
mod tests {
    include!("phase2/tests/common.rs");
    include!("phase2/tests/streams.rs");
    include!("phase2/tests/node_snapshot.rs");
    include!("phase2/tests/job_fsm.rs");
    include!("phase2/tests/cross_instance.rs");
    include!("phase2/tests/ws_helpers.rs");
    include!("phase2/tests/ws_e2e.rs");
    include!("phase2/tests/cluster_acceptance.rs");
}

