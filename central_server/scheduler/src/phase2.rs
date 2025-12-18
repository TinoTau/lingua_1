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

impl Phase2Runtime {
    pub async fn new(
        cfg: crate::config::Phase2Config,
        scheduler_heartbeat_interval_seconds: u64,
    ) -> anyhow::Result<Option<Self>> {
        if !cfg.enabled {
            return Ok(None);
        }

        let instance_id = normalize_instance_id(&cfg.instance_id);
        let heartbeat_ttl_seconds = (scheduler_heartbeat_interval_seconds.max(1) * 2).max(2);

        let redis = RedisHandle::connect(&cfg.redis).await?;

        let rt = Self {
            instance_id,
            heartbeat_ttl_seconds,
            cfg,
            redis,
        };

        // 关键：在真正对外提供路由/投递之前，先确保 inbox stream 的 consumer group 已创建。
        // 否则在 worker 创建 group（XGROUP CREATE $）之前，如果其他实例先 XADD 了消息，
        // 会导致这些“早到消息”被 group 起点跳过，从而出现跨实例链路偶发丢投递（非常难排查）。
        let inbox = rt.instance_inbox_stream_key(&rt.instance_id);
        rt.ensure_group(&inbox).await;

        Ok(Some(rt))
    }

    pub fn key_prefix(&self) -> &str {
        &self.cfg.redis.key_prefix
    }

    pub fn node_snapshot_enabled(&self) -> bool {
        self.cfg.node_snapshot.enabled
    }

    fn v1_prefix(&self) -> String {
        // 对齐容量规划文档中的 key 示例：lingua:v1:...
        format!("{}:v1", self.key_prefix())
    }

    fn scheduler_presence_key(&self) -> String {
        format!("{}:schedulers:presence:{}", self.key_prefix(), self.instance_id)
    }

    fn node_owner_key(&self, node_id: &str) -> String {
        // hash tag: {node:<id>}
        format!("{}:nodes:owner:{{node:{}}}", self.key_prefix(), node_id)
    }

    fn session_owner_key(&self, session_id: &str) -> String {
        // hash tag: {session:<id>}
        format!("{}:sessions:owner:{{session:{}}}", self.key_prefix(), session_id)
    }

    fn instance_inbox_stream_key(&self, instance_id: &str) -> String {
        // hash tag: {instance:<id>}
        format!("{}:streams:{{instance:{}}}:inbox", self.key_prefix(), instance_id)
    }

    fn instance_dlq_stream_key(&self, instance_id: &str) -> String {
        // hash tag: {instance:<id>}
        format!("{}:streams:{{instance:{}}}:dlq", self.key_prefix(), instance_id)
    }

    fn model_na_debounce_key(&self, service_id: &str, service_version: Option<&str>) -> String {
        // 文档示例：lingua:v1:debounce:model_unavailable:<model_id>@<version>
        let ver = service_version.unwrap_or("any");
        format!("{}:debounce:model_unavailable:{}@{}", self.v1_prefix(), service_id, ver)
    }

    fn model_na_node_ratelimit_key(&self, node_id: &str) -> String {
        // 文档示例：lingua:v1:ratelimit:node:<node_id>:model_na
        format!("{}:ratelimit:node:{}:model_na", self.v1_prefix(), node_id)
    }

    fn request_lock_key(&self, request_id: &str) -> String {
        // hash tag: {req:<id>}
        format!("{}:locks:{{req:{}}}", self.v1_prefix(), request_id)
    }

    fn request_binding_key(&self, request_id: &str) -> String {
        // hash tag: {req:<id>}
        format!("{}:bind:{{req:{}}}", self.v1_prefix(), request_id)
    }

    fn job_fsm_key(&self, job_id: &str) -> String {
        // 单实体：{job:<id>}，确保 Cluster 下 Lua 访问同 slot
        format!("{}:jobs:fsm:{{job:{}}}", self.v1_prefix(), job_id)
    }

    fn nodes_all_set_key(&self) -> String {
        format!("{}:nodes:all", self.v1_prefix())
    }

    fn nodes_last_seen_zset_key(&self) -> String {
        // member=node_id, score=last_seen_ms
        format!("{}:nodes:last_seen", self.v1_prefix())
    }

    fn node_presence_key(&self, node_id: &str) -> String {
        // hash tag: {node:<id>}
        format!("{}:nodes:presence:{{node:{}}}", self.v1_prefix(), node_id)
    }

    fn node_snapshot_key(&self, node_id: &str) -> String {
        // hash tag: {node:<id>}
        format!("{}:nodes:snapshot:{{node:{}}}", self.v1_prefix(), node_id)
    }

    fn node_reserved_zset_key(&self, node_id: &str) -> String {
        // ZSET：member=job_id, score=expire_at_ms
        // hash tag: {node:<id>}
        format!("{}:nodes:reserved:{{node:{}}}", self.v1_prefix(), node_id)
    }

    async fn set_scheduler_presence(&self) {
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".to_string());
        let presence = SchedulerPresence {
            started_at: chrono::Utc::now().timestamp_millis(),
            hostname,
            pid: std::process::id(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        };
        let key = self.scheduler_presence_key();
        let val = match serde_json::to_string(&presence) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "Phase2 presence 序列化失败");
                return;
            }
        };

        let _ = self
            .redis
            .set_ex_string(&key, &val, self.heartbeat_ttl_seconds)
            .await;
    }

    pub async fn is_instance_alive(&self, instance_id: &str) -> bool {
        let key = format!("{}:schedulers:presence:{}", self.key_prefix(), instance_id);
        self.redis.exists(&key).await.unwrap_or(false)
    }

    pub async fn resolve_node_owner(&self, node_id: &str) -> Option<String> {
        let key = self.node_owner_key(node_id);
        let owner = self.redis.get_string(&key).await.ok().flatten()?;
        if self.is_instance_alive(&owner).await {
            Some(owner)
        } else {
            None
        }
    }

    pub async fn resolve_session_owner(&self, session_id: &str) -> Option<String> {
        let key = self.session_owner_key(session_id);
        let owner = self.redis.get_string(&key).await.ok().flatten()?;
        if self.is_instance_alive(&owner).await {
            Some(owner)
        } else {
            None
        }
    }

    pub async fn set_node_owner(&self, node_id: &str) {
        let key = self.node_owner_key(node_id);
        let _ = self
            .redis
            .set_ex_string(&key, &self.instance_id, self.cfg.owner_ttl_seconds.max(2))
            .await;
    }

    pub async fn set_session_owner(&self, session_id: &str) {
        let key = self.session_owner_key(session_id);
        let _ = self
            .redis
            .set_ex_string(&key, &self.instance_id, self.cfg.owner_ttl_seconds.max(2))
            .await;
    }

    pub async fn clear_node_owner(&self, node_id: &str) {
        let _ = self.redis.del(&self.node_owner_key(node_id)).await;
    }

    pub async fn clear_session_owner(&self, session_id: &str) {
        let _ = self.redis.del(&self.session_owner_key(session_id)).await;
    }

    pub async fn enqueue_to_instance(&self, target_instance_id: &str, event: &InterInstanceEvent) -> bool {
        let stream = self.instance_inbox_stream_key(target_instance_id);
        let payload = match serde_json::to_string(event) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "Phase2 event 序列化失败");
                return false;
            }
        };
        let ok = self
            .redis
            .xadd_payload_maxlen(&stream, &payload, self.cfg.stream_maxlen.max(100))
            .await
            .is_ok();
        crate::prometheus_metrics::phase2_redis_op("xadd", ok);
        ok
    }

    /// Phase 2：MODEL_NOT_AVAILABLE 去抖（跨实例一致）
    /// 返回 true 表示“窗口内首次命中”（可打印昂贵日志/指标）
    pub async fn model_na_debounce_first_hit(
        &self,
        service_id: &str,
        service_version: Option<&str>,
        window_ms: u64,
    ) -> bool {
        let key = self.model_na_debounce_key(service_id, service_version);
        self.redis
            .set_nx_px(&key, &self.instance_id, window_ms.max(1))
            .await
            .unwrap_or(false)
    }

    /// Phase 2：MODEL_NOT_AVAILABLE 节点级限流（跨实例一致）
    /// 返回 true 表示允许继续处理
    pub async fn model_na_node_ratelimit_allow(
        &self,
        node_id: &str,
        window_ms: u64,
        max: u32,
    ) -> bool {
        let key = self.model_na_node_ratelimit_key(node_id);

        // 先尝试 SET NX EX（窗口首次）
        if self
            .redis
            .set_nx_ex_u64(&key, 1, (window_ms / 1000).max(1))
            .await
            .unwrap_or(false)
        {
            return true;
        }

        // 窗口内计数
        let v = self.redis.incr_u64(&key, 1).await.unwrap_or(u64::MAX);
        v <= (max.max(1) as u64)
    }

    /// Phase 2：获取 request_id 绑定（跨实例幂等）
    pub async fn get_request_binding(&self, request_id: &str) -> Option<RequestBinding> {
        let key = self.request_binding_key(request_id);
        let json = self.redis.get_string(&key).await.ok().flatten()?;
        serde_json::from_str(&json).ok()
    }

    /// Phase 2：写入 request_id 绑定（带 lease）
    pub async fn set_request_binding(
        &self,
        request_id: &str,
        job_id: &str,
        node_id: Option<&str>,
        lease_seconds: u64,
        dispatched_to_node: bool,
    ) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let exp_ms = now_ms + (lease_seconds.max(1) as i64) * 1000;
        let bind = RequestBinding {
            request_id: request_id.to_string(),
            job_id: job_id.to_string(),
            node_id: node_id.map(|s| s.to_string()).filter(|s| !s.is_empty()),
            dispatched_to_node,
            expire_at_ms: exp_ms,
        };
        let json = match serde_json::to_string(&bind) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, request_id = %request_id, "Phase2 request binding 序列化失败");
                return;
            }
        };
        let _ = self
            .redis
            .set_ex_string(&self.request_binding_key(request_id), &json, lease_seconds.max(1))
            .await;
    }

    pub async fn mark_request_dispatched(&self, request_id: &str) {
        if let Some(mut b) = self.get_request_binding(request_id).await {
            b.dispatched_to_node = true;
            let ttl_ms = b.expire_at_ms - chrono::Utc::now().timestamp_millis();
            let ttl_s = (ttl_ms.max(0) as u64) / 1000;
            // TTL 接近 0 时不再写回
            if ttl_s == 0 {
                return;
            }
            let json = match serde_json::to_string(&b) {
                Ok(v) => v,
                Err(_) => return,
            };
            let _ = self
                .redis
                .set_ex_string(&self.request_binding_key(request_id), &json, ttl_s.max(1))
                .await;
        }
    }

    pub async fn update_request_binding_node(&self, request_id: &str, node_id: &str) {
        if let Some(mut b) = self.get_request_binding(request_id).await {
            b.node_id = Some(node_id.to_string());
            b.dispatched_to_node = false;
            let ttl_ms = b.expire_at_ms - chrono::Utc::now().timestamp_millis();
            let ttl_s = (ttl_ms.max(0) as u64) / 1000;
            if ttl_s == 0 {
                return;
            }
            let json = match serde_json::to_string(&b) {
                Ok(v) => v,
                Err(_) => return,
            };
            let _ = self
                .redis
                .set_ex_string(&self.request_binding_key(request_id), &json, ttl_s.max(1))
                .await;
        }
    }

    /// Phase 2：request 级分布式锁（避免同一 request_id 并发创建/占用）
    pub async fn acquire_request_lock(&self, request_id: &str, owner: &str, ttl_ms: u64) -> bool {
        let key = self.request_lock_key(request_id);
        self.redis.set_nx_px(&key, owner, ttl_ms.max(1)).await.unwrap_or(false)
    }

    pub async fn release_request_lock(&self, request_id: &str, owner: &str) {
        let key = self.request_lock_key(request_id);
        let _ = self.redis.del_if_value_matches(&key, owner).await;
    }

    /// Phase 2：节点并发占用（Redis ZSET + Lua 清理过期）
    pub async fn node_reserved_count(&self, node_id: &str) -> u64 {
        let key = self.node_reserved_zset_key(node_id);
        self.redis.zcard_clean_expired(&key).await.unwrap_or(0)
    }

    pub async fn reserve_node_slot(
        &self,
        node_id: &str,
        job_id: &str,
        ttl_seconds: u64,
        running_jobs: usize,
        max_jobs: usize,
    ) -> bool {
        let key = self.node_reserved_zset_key(node_id);
        self.redis
            .zreserve_with_capacity(
                &key,
                job_id,
                ttl_seconds.max(1),
                running_jobs as u64,
                max_jobs.max(1) as u64,
            )
            .await
            .unwrap_or(false)
    }

    pub async fn release_node_slot(&self, node_id: &str, job_id: &str) {
        let key = self.node_reserved_zset_key(node_id);
        let _ = self.redis.zrem(&key, job_id).await;
    }

    // ===== Phase 2：Job FSM（Redis）=====
    pub async fn job_fsm_init(
        &self,
        job_id: &str,
        node_id: Option<&str>,
        attempt_id: u32,
        ttl_seconds: u64,
    ) {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let node = node_id.unwrap_or("");
        let ttl = ttl_seconds.max(1);
        let script = r#"
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('HSET', KEYS[1],
  'job_id', ARGV[1],
  'state', 'CREATED',
  'node_id', ARGV[2],
  'attempt_id', ARGV[3],
  'created_at_ms', ARGV[4],
  'updated_at_ms', ARGV[4]
)
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(job_id)
            .arg(node)
            .arg(attempt_id)
            .arg(now_ms)
            .arg(ttl);
        let _r: redis::RedisResult<i64> = self.redis.query(cmd).await;
    }

    pub async fn job_fsm_reset_created(
        &self,
        job_id: &str,
        node_id: Option<&str>,
        attempt_id: u32,
        ttl_seconds: u64,
    ) {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let node = node_id.unwrap_or("");
        let ttl = ttl_seconds.max(1);
        let script = r#"
redis.call('HSET', KEYS[1],
  'job_id', ARGV[1],
  'state', 'CREATED',
  'node_id', ARGV[2],
  'attempt_id', ARGV[3],
  'updated_at_ms', ARGV[4]
)
if redis.call('HEXISTS', KEYS[1], 'created_at_ms') == 0 then
  redis.call('HSET', KEYS[1], 'created_at_ms', ARGV[4])
end
redis.call('HDEL', KEYS[1], 'finished_ok')
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(job_id)
            .arg(node)
            .arg(attempt_id)
            .arg(now_ms)
            .arg(ttl);
        let _r: redis::RedisResult<i64> = self.redis.query(cmd).await;
    }

    pub async fn job_fsm_to_dispatched(&self, job_id: &str, attempt_id: u32) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'DISPATCHED' or st == 'ACCEPTED' or st == 'RUNNING' or st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'CREATED' then return 0 end
local a = redis.call('HGET', KEYS[1], 'attempt_id')
if a ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'DISPATCHED', 'updated_at_ms', ARGV[2])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(attempt_id.to_string())
            .arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_running(&self, job_id: &str) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'RUNNING' or st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'DISPATCHED' and st ~= 'ACCEPTED' then
  return 0
end
redis.call('HSET', KEYS[1], 'state', 'RUNNING', 'updated_at_ms', ARGV[1])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(&key).arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_accepted(&self, job_id: &str, attempt_id: u32) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'ACCEPTED' or st == 'RUNNING' or st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'DISPATCHED' then
  return 0
end
local a = redis.call('HGET', KEYS[1], 'attempt_id')
if a ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'ACCEPTED', 'updated_at_ms', ARGV[2])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(attempt_id.to_string())
            .arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_finished(&self, job_id: &str, attempt_id: u32, ok: bool) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let ok_str = if ok { "1" } else { "0" };
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'FINISHED' or st == 'RELEASED' then
  return 1
end
if st ~= 'CREATED' and st ~= 'DISPATCHED' and st ~= 'ACCEPTED' and st ~= 'RUNNING' then
  return 0
end
local a = redis.call('HGET', KEYS[1], 'attempt_id')
if a ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'FINISHED', 'finished_ok', ARGV[2], 'updated_at_ms', ARGV[3])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(attempt_id.to_string())
            .arg(ok_str)
            .arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    pub async fn job_fsm_to_released(&self, job_id: &str) -> bool {
        let key = self.job_fsm_key(job_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let script = r#"
local st = redis.call('HGET', KEYS[1], 'state')
if st == false then return 0 end
if st == 'RELEASED' then return 1 end
if st ~= 'FINISHED' then return 0 end
redis.call('HSET', KEYS[1], 'state', 'RELEASED', 'updated_at_ms', ARGV[1])
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(&key).arg(now_ms);
        self.redis.query::<i64>(cmd).await.map(|v| v == 1).unwrap_or(false)
    }

    #[allow(dead_code)]
    pub async fn job_fsm_get(&self, job_id: &str) -> Option<JobFsmSnapshot> {
        let key = self.job_fsm_key(job_id);
        let mut cmd = redis::cmd("HGETALL");
        cmd.arg(&key);
        let v: redis::Value = self.redis.query(cmd).await.ok()?;
        let map = redis_value_to_hashmap(v)?;
        let state = map.get("state")?.to_string();
        let attempt_id = map
            .get("attempt_id")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        let created_at_ms = map
            .get("created_at_ms")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let updated_at_ms = map
            .get("updated_at_ms")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let node_id = map.get("node_id").cloned().filter(|s| !s.is_empty());
        let finished_ok = map
            .get("finished_ok")
            .and_then(|s| if s == "1" { Some(true) } else if s == "0" { Some(false) } else { None });
        Some(JobFsmSnapshot {
            job_id: job_id.to_string(),
            state,
            node_id,
            attempt_id,
            created_at_ms,
            updated_at_ms,
            finished_ok,
        })
    }

    pub fn spawn_background_tasks(self: Arc<Self>, state: AppState) {
        // 1) presence + owner 续约
        let rt = self.clone();
        let state_for_owners = state.clone();
        tokio::spawn(async move {
            // 续约频率：
            // - owner 需要在 owner_ttl/2 左右续约
            // - presence 需要在 presence_ttl/2 左右续约（否则会出现“实例存活但 presence 过期”的幽灵状态）
            // 因此取两者的 min，避免 presence TTL < tick interval 导致跨实例路由偶发失败。
            let owner_tick_s = (rt.cfg.owner_ttl_seconds.max(10) / 2).max(5);
            let presence_tick_s = (rt.heartbeat_ttl_seconds.max(2) / 2).max(1);
            let interval_s = std::cmp::min(owner_tick_s, presence_tick_s);
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_s));
            loop {
                interval.tick().await;
                rt.set_scheduler_presence().await;

                let session_ids = state_for_owners.session_connections.list_session_ids().await;
                let node_ids = state_for_owners.node_connections.list_node_ids().await;
                for sid in session_ids {
                    rt.set_session_owner(&sid).await;
                }
                for nid in node_ids {
                    rt.set_node_owner(&nid).await;
                }
            }
        });

        // 2) Streams inbox worker
        let rt = self.clone();
        let state_for_inbox = state.clone();
        tokio::spawn(async move {
            rt.run_inbox_worker(state_for_inbox).await;
        });

        // 3) Node snapshot refresh (Redis -> local NodeRegistry)
        if self.cfg.node_snapshot.enabled {
            let rt = self.clone();
            let state_for_nodes = state.clone();
            tokio::spawn(async move {
                rt.run_node_snapshot_refresher(state_for_nodes).await;
            });
        }
    }

    /// Phase 2：写入 node presence + snapshot（跨实例可见）
    pub async fn upsert_node_snapshot(&self, node: &RegistryNode) {
        let presence_key = self.node_presence_key(&node.node_id);
        let snapshot_key = self.node_snapshot_key(&node.node_id);
        let all_key = self.nodes_all_set_key();
        let last_seen_key = self.nodes_last_seen_zset_key();

        let snapshot_json = match serde_json::to_string(node) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, node_id = %node.node_id, "Phase2 node snapshot 序列化失败");
                return;
            }
        };

        let ttl = self.cfg.node_snapshot.presence_ttl_seconds.max(2);
        let _ = self.redis.set_ex_string(&presence_key, "1", ttl).await;
        let _ = self.redis.set_ex_string(&snapshot_key, &snapshot_json, ttl).await;
        let _ = self.redis.sadd_string(&all_key, &node.node_id).await;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let _ = self.redis.zadd_score(&last_seen_key, &node.node_id, now_ms).await;
    }

    pub async fn touch_node_presence(&self, node_id: &str) {
        let ttl = self.cfg.node_snapshot.presence_ttl_seconds.max(2);
        let _ = self
            .redis
            .set_ex_string(&self.node_presence_key(node_id), "1", ttl)
            .await;
    }

    pub async fn clear_node_presence(&self, node_id: &str) {
        let _ = self.redis.del(&self.node_presence_key(node_id)).await;
    }

    async fn run_node_snapshot_refresher(&self, state: AppState) {
        let interval = std::time::Duration::from_millis(self.cfg.node_snapshot.refresh_interval_ms.max(200));
        let mut tick = tokio::time::interval(interval);
        loop {
            tick.tick().await;
            let all_key = self.nodes_all_set_key();
            let ids = match self.redis.smembers_strings(&all_key).await {
                Ok(v) => v,
                Err(e) => {
                    debug!(error = %e, "Phase2 SMEMBERS nodes:all 失败");
                    continue;
                }
            };
            if ids.is_empty() {
                continue;
            }

            for node_id in ids {
                let presence_key = self.node_presence_key(&node_id);
                let online = self.redis.exists(&presence_key).await.unwrap_or(false);
                if !online {
                    state.node_registry.mark_node_offline(&node_id).await;
                    continue;
                }

                let snapshot_key = self.node_snapshot_key(&node_id);
                let json_opt = match self.redis.get_string(&snapshot_key).await {
                    Ok(v) => v,
                    Err(_) => None,
                };
                let Some(json) = json_opt else { continue };
                let node: RegistryNode = match serde_json::from_str(&json) {
                    Ok(v) => v,
                    Err(e) => {
                        debug!(error = %e, node_id = %node_id, "Phase2 node snapshot 反序列化失败");
                        continue;
                    }
                };
                // 将全局 reserved_count 融合进 current_jobs，确保任意实例选节点时能感知全局占用
                let reserved = self.node_reserved_count(&node_id).await as usize;
                let mut node = node;
                node.current_jobs = std::cmp::max(node.current_jobs, reserved);
                // upsert 到本地 NodeRegistry（允许跨实例选节点）
                state.node_registry.upsert_node_from_snapshot(node).await;
            }

            // 清理 nodes:all（避免长期增长）
            self.cleanup_stale_nodes().await;
        }
    }

    async fn cleanup_stale_nodes(&self) {
        let ttl_s = self.cfg.node_snapshot.remove_stale_after_seconds;
        if ttl_s == 0 {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let cutoff_ms = now_ms - (ttl_s as i64) * 1000;

        let last_seen_key = self.nodes_last_seen_zset_key();
        let all_key = self.nodes_all_set_key();

        // 每轮最多清理 200 个，避免长时间占用 redis
        let stale_ids = self
            .redis
            .zrangebyscore_limit(&last_seen_key, 0, cutoff_ms, 200)
            .await
            .unwrap_or_default();
        if stale_ids.is_empty() {
            return;
        }
        for node_id in stale_ids {
            // 如果 presence 还存在，说明刚续约过，不删
            if self.redis.exists(&self.node_presence_key(&node_id)).await.unwrap_or(false) {
                let _ = self.redis.zadd_score(&last_seen_key, &node_id, now_ms).await;
                continue;
            }
            let _ = self.redis.srem_string(&all_key, &node_id).await;
            let _ = self.redis.zrem(&last_seen_key, &node_id).await;
            let _ = self.redis.del(&self.node_snapshot_key(&node_id)).await;
            let _ = self.redis.del(&self.node_presence_key(&node_id)).await;
        }
    }

    async fn ensure_group(&self, stream: &str) {
        let mut cmd = redis::cmd("XGROUP");
        cmd.arg("CREATE")
            .arg(stream)
            .arg(&self.cfg.stream_group)
            .arg("$")
            .arg("MKSTREAM");
        // BUSYGROUP 直接忽略
        let r: redis::RedisResult<()> = self.redis.query(cmd).await;
        if let Err(e) = r {
            let s = e.to_string();
            if !s.contains("BUSYGROUP") {
                warn!(error = %s, stream = %stream, "Phase2 XGROUP CREATE 失败");
            }
        }
    }

    async fn run_inbox_worker(&self, state: AppState) {
        let stream = self.instance_inbox_stream_key(&self.instance_id);
        self.ensure_group(&stream).await;
        info!(instance_id = %self.instance_id, stream = %stream, group = %self.cfg.stream_group, "Phase2 Streams inbox worker 已启动");

        // 先做一次 best-effort reclaim（为了覆盖：同组其他 consumer 死亡后遗留 pending）
        // 注意：XAUTOCLAIM 可能因 Redis 版本不支持而失败，失败则忽略。
        let mut last_reclaim_at = std::time::Instant::now() - std::time::Duration::from_secs(3600);
        let mut last_dlq_scan_at = std::time::Instant::now() - std::time::Duration::from_secs(3600);

        loop {
            // 周期性 reclaim（默认每 5 秒）
            if last_reclaim_at.elapsed() > std::time::Duration::from_secs(5) {
                last_reclaim_at = std::time::Instant::now();
                let _ = self.reclaim_and_process_pending(&stream, &state).await;
            }

            // 周期性 DLQ 扫描：把“投递次数过多”的 pending 移入 dlq 并 ack/del
            if self.cfg.dlq_enabled
                && last_dlq_scan_at.elapsed()
                    > std::time::Duration::from_millis(self.cfg.dlq_scan_interval_ms.max(1000))
            {
                last_dlq_scan_at = std::time::Instant::now();
                let _ = self.scan_pending_to_dlq(&stream).await;
            }

            // 读新消息
            let reply = self
                .xreadgroup(&stream, ">", self.cfg.stream_block_ms, self.cfg.stream_count)
                .await;

            match reply {
                Ok(items) => {
                    for (id, payload) in items {
                        if self.process_event_payload(&state, &stream, &id, &payload).await {
                            let _ = self.xack(&stream, &id).await;
                            let _ = self.xdel(&stream, &id).await;
                        }
                    }
                }
                Err(e) => {
                    warn!(error = %e, "Phase2 XREADGROUP 失败，稍后重试");
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                }
            }
        }
    }

    async fn reclaim_and_process_pending(&self, stream: &str, state: &AppState) -> anyhow::Result<()> {
        // XAUTOCLAIM <stream> <group> <consumer> <min-idle-time> 0-0 COUNT N
        let mut cmd = redis::cmd("XAUTOCLAIM");
        cmd.arg(stream)
            .arg(&self.cfg.stream_group)
            .arg(&self.instance_id)
            .arg(5_000u64) // min idle ms
            .arg("0-0")
            .arg("COUNT")
            .arg(self.cfg.stream_count.max(1));
        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => v,
            Err(e) => {
                // Redis 版本不支持/命令被禁用时，直接忽略
                crate::prometheus_metrics::phase2_redis_op("xautoclaim", false);
                debug!(error = %e, "Phase2 XAUTOCLAIM 不可用或失败，忽略");
                return Ok(());
            }
        };
        crate::prometheus_metrics::phase2_redis_op("xautoclaim", true);

        let items = parse_xautoclaim_payloads(value);
        for (id, payload) in items {
            if self.process_event_payload(state, stream, &id, &payload).await {
                let _ = self.xack(stream, &id).await;
                let _ = self.xdel(stream, &id).await;
            }
        }
        Ok(())
    }

    async fn scan_pending_to_dlq(&self, stream: &str) -> anyhow::Result<()> {
        // 先读 summary（total pending）用于 gauge
        if let Ok(total) = self.xpending_total(stream).await {
            crate::prometheus_metrics::set_phase2_inbox_pending(total as i64);
        }

        // XPENDING <stream> <group> - + <count>
        let mut cmd = redis::cmd("XPENDING");
        cmd.arg(stream)
            .arg(&self.cfg.stream_group)
            .arg("-")
            .arg("+")
            .arg(self.cfg.dlq_scan_count.max(1));

        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::prometheus_metrics::phase2_redis_op("xpending", true);
                v
            }
            Err(e) => {
                crate::prometheus_metrics::phase2_redis_op("xpending", false);
                debug!(error = %e, "Phase2 XPENDING 失败，跳过 DLQ 扫描");
                return Ok(());
            }
        };

        let entries = parse_xpending_entries(value);

        for e in entries {
            if e.deliveries < self.cfg.dlq_max_deliveries.max(1) {
                continue;
            }
            if e.idle_ms < self.cfg.dlq_min_idle_ms.max(1) {
                continue;
            }
            // 先用 XCLAIM(min-idle) 抢占，避免搬走正在处理的消息
            let claimed = self
                .xclaim_payload(stream, &e.id, self.cfg.dlq_min_idle_ms.max(1))
                .await;
            let Some(payload) = claimed else { continue };

            let dlq_stream = self.instance_dlq_stream_key(&self.instance_id);
            let ok = self
                .redis
                .xadd_dlq_maxlen(
                    &dlq_stream,
                    self.cfg.dlq_maxlen.max(100),
                    &payload,
                    stream,
                    &e.id,
                    e.deliveries,
                )
                .await
                .is_ok();
            crate::prometheus_metrics::phase2_redis_op("dlq_move", ok);
            if ok {
                let _ = self.xack(stream, &e.id).await;
                let _ = self.xdel(stream, &e.id).await;
                crate::prometheus_metrics::on_phase2_dlq_moved();
            }
        }
        Ok(())
    }

    async fn xpending_total(&self, stream: &str) -> redis::RedisResult<u64> {
        // XPENDING <stream> <group>
        let mut cmd = redis::cmd("XPENDING");
        cmd.arg(stream).arg(&self.cfg.stream_group);
        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::prometheus_metrics::phase2_redis_op("xpending_summary", true);
                v
            }
            Err(e) => {
                crate::prometheus_metrics::phase2_redis_op("xpending_summary", false);
                return Err(e);
            }
        };
        parse_xpending_summary_total(value).ok_or_else(|| {
            redis::RedisError::from((redis::ErrorKind::TypeError, "invalid XPENDING summary reply"))
        })
    }

    async fn xclaim_payload(&self, stream: &str, id: &str, min_idle_ms: u64) -> Option<String> {
        // XCLAIM <stream> <group> <consumer> <min-idle-time> <id>
        let mut cmd = redis::cmd("XCLAIM");
        cmd.arg(stream)
            .arg(&self.cfg.stream_group)
            .arg(&self.instance_id)
            .arg(min_idle_ms.max(1))
            .arg(id);

        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::prometheus_metrics::phase2_redis_op("xclaim", true);
                v
            }
            Err(_) => {
                crate::prometheus_metrics::phase2_redis_op("xclaim", false);
                return None;
            }
        };
        // XCLAIM 返回格式与 XRANGE 相同：[[id, [field, value...]]]
        extract_payload_from_xrange(value)
    }

    async fn process_event_payload(&self, state: &AppState, stream: &str, id: &str, payload: &str) -> bool {
        let evt: InterInstanceEvent = match serde_json::from_str(payload) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, stream = %stream, id = %id, "Phase2 event 反序列化失败，直接 ack");
                return true;
            }
        };

        match evt {
            InterInstanceEvent::DispatchToNode { node_id, message } => {
                let json = match serde_json::to_string(&message) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!(error = %e, "NodeMessage 序列化失败，直接 ack");
                        return true;
                    }
                };
                let ok = state.node_connections.send(&node_id, WsMessage::Text(json)).await;
                if !ok {
                    // 不 ack，让 pending 机制重试（节点重连后可送达）
                    debug!(node_id = %node_id, stream = %stream, id = %id, "本地 node 不在线，保留 pending");
                }
                ok
            }
            InterInstanceEvent::SendToSession { session_id, message } => {
                let json = match serde_json::to_string(&message) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!(error = %e, "SessionMessage 序列化失败，直接 ack");
                        return true;
                    }
                };
                let ok = state
                    .session_connections
                    .send(&session_id, WsMessage::Text(json))
                    .await;
                if !ok {
                    debug!(session_id = %session_id, stream = %stream, id = %id, "本地 session 不在线，保留 pending");
                }
                ok
            }
            InterInstanceEvent::ForwardNodeMessage { message } => {
                // 转发的 NodeMessage 不依赖“本地 node 连接”，其语义是让目标实例补齐业务处理（结果队列/Job 上下文等）。
                crate::websocket::node_handler::handle_forwarded_node_message(state, message).await;
                true
            }
        }
    }

    async fn xreadgroup(
        &self,
        stream: &str,
        start_id: &str,
        block_ms: u64,
        count: usize,
    ) -> redis::RedisResult<Vec<(String, String)>> {
        // XREADGROUP GROUP <group> <consumer> COUNT <count> BLOCK <ms> STREAMS <stream> <id>
        let mut cmd = redis::cmd("XREADGROUP");
        cmd.arg("GROUP")
            .arg(&self.cfg.stream_group)
            .arg(&self.instance_id)
            .arg("COUNT")
            .arg(count.max(1))
            .arg("BLOCK")
            .arg(block_ms.max(1))
            .arg("STREAMS")
            .arg(stream)
            .arg(start_id);

        let reply: redis::streams::StreamReadReply = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::prometheus_metrics::phase2_redis_op("xreadgroup", true);
                v
            }
            Err(e) => {
                crate::prometheus_metrics::phase2_redis_op("xreadgroup", false);
                return Err(e);
            }
        };
        Ok(extract_payloads_from_stream_reply(reply))
    }

    async fn xack(&self, stream: &str, id: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("XACK");
        cmd.arg(stream).arg(&self.cfg.stream_group).arg(id);
        let r = self.redis.query(cmd).await;
        crate::prometheus_metrics::phase2_redis_op("xack", r.is_ok());
        r
    }

    async fn xdel(&self, stream: &str, id: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("XDEL");
        cmd.arg(stream).arg(id);
        let r = self.redis.query(cmd).await;
        crate::prometheus_metrics::phase2_redis_op("xdel", r.is_ok());
        r
    }

    #[allow(dead_code)]
    async fn xrange_payload(&self, stream: &str, id: &str) -> Option<String> {
        let mut cmd = redis::cmd("XRANGE");
        cmd.arg(stream).arg(id).arg(id);
        let value: redis::Value = match self.redis.query(cmd).await {
            Ok(v) => {
                crate::prometheus_metrics::phase2_redis_op("xrange", true);
                v
            }
            Err(_) => {
                crate::prometheus_metrics::phase2_redis_op("xrange", false);
                return None;
            }
        };
        extract_payload_from_xrange(value)
    }
}

impl RedisHandle {
    async fn connect(cfg: &crate::config::Phase2RedisConfig) -> anyhow::Result<Self> {
        let inner = match cfg.mode.as_str() {
            "cluster" => {
                let urls = if cfg.cluster_urls.is_empty() {
                    vec![cfg.url.clone()]
                } else {
                    cfg.cluster_urls.clone()
                };
                let client = redis::cluster::ClusterClient::new(urls)?;
                let conn = client.get_async_connection().await?;
                RedisConn::Cluster(conn)
            }
            _ => {
                let client = redis::Client::open(cfg.url.as_str())?;
                let conn = client.get_multiplexed_tokio_connection().await?;
                RedisConn::Single(conn)
            }
        };
        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
        })
    }

    async fn query<T: redis::FromRedisValue>(&self, cmd: redis::Cmd) -> redis::RedisResult<T> {
        let mut guard = self.inner.lock().await;
        match &mut *guard {
            RedisConn::Single(c) => cmd.query_async(c).await,
            RedisConn::Cluster(c) => cmd.query_async(c).await,
        }
    }

    async fn set_ex_string(&self, key: &str, val: &str, ttl_seconds: u64) -> redis::RedisResult<()> {
        let mut cmd = redis::cmd("SET");
        cmd.arg(key).arg(val).arg("EX").arg(ttl_seconds.max(1));
        self.query(cmd).await
    }

    async fn get_string(&self, key: &str) -> redis::RedisResult<Option<String>> {
        let mut cmd = redis::cmd("GET");
        cmd.arg(key);
        self.query(cmd).await
    }

    async fn del(&self, key: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("DEL");
        cmd.arg(key);
        self.query(cmd).await
    }

    async fn del_if_value_matches(&self, key: &str, expected: &str) -> redis::RedisResult<u64> {
        // Lua: if GET == expected then DEL
        let script = r#"
local v = redis.call('GET', KEYS[1])
if v == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(key).arg(expected);
        self.query(cmd).await
    }

    async fn exists(&self, key: &str) -> redis::RedisResult<bool> {
        let mut cmd = redis::cmd("EXISTS");
        cmd.arg(key);
        let v: u64 = self.query(cmd).await?;
        Ok(v > 0)
    }

    #[allow(dead_code)]
    async fn xadd_payload(&self, stream: &str, payload: &str) -> redis::RedisResult<String> {
        // 兼容旧调用点：不裁剪
        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream).arg("*").arg("payload").arg(payload);
        self.query(cmd).await
    }

    async fn xadd_payload_maxlen(&self, stream: &str, payload: &str, maxlen: usize) -> redis::RedisResult<String> {
        // XADD <stream> MAXLEN ~ <maxlen> * payload <payload>
        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream)
            .arg("MAXLEN")
            .arg("~")
            .arg(maxlen.max(100))
            .arg("*")
            .arg("payload")
            .arg(payload);
        self.query(cmd).await
    }

    async fn xadd_dlq_maxlen(
        &self,
        stream: &str,
        maxlen: usize,
        payload: &str,
        src_stream: &str,
        src_id: &str,
        deliveries: u64,
    ) -> redis::RedisResult<String> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut cmd = redis::cmd("XADD");
        cmd.arg(stream)
            .arg("MAXLEN")
            .arg("~")
            .arg(maxlen.max(100))
            .arg("*")
            .arg("payload")
            .arg(payload)
            .arg("src_stream")
            .arg(src_stream)
            .arg("src_id")
            .arg(src_id)
            .arg("deliveries")
            .arg(deliveries)
            .arg("moved_at_ms")
            .arg(now_ms);
        self.query(cmd).await
    }

    async fn sadd_string(&self, key: &str, member: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("SADD");
        cmd.arg(key).arg(member);
        self.query(cmd).await
    }

    async fn smembers_strings(&self, key: &str) -> redis::RedisResult<Vec<String>> {
        let mut cmd = redis::cmd("SMEMBERS");
        cmd.arg(key);
        self.query(cmd).await
    }

    async fn srem_string(&self, key: &str, member: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("SREM");
        cmd.arg(key).arg(member);
        self.query(cmd).await
    }

    async fn set_nx_px(&self, key: &str, val: &str, ttl_ms: u64) -> redis::RedisResult<bool> {
        // SET key val NX PX ttl
        let mut cmd = redis::cmd("SET");
        cmd.arg(key).arg(val).arg("NX").arg("PX").arg(ttl_ms.max(1));
        // OK => Some("OK")；失败 => Nil
        let r: Option<String> = self.query(cmd).await?;
        Ok(r.is_some())
    }

    async fn set_nx_ex_u64(&self, key: &str, val: u64, ttl_seconds: u64) -> redis::RedisResult<bool> {
        // SET key val NX EX ttl
        let mut cmd = redis::cmd("SET");
        cmd.arg(key)
            .arg(val)
            .arg("NX")
            .arg("EX")
            .arg(ttl_seconds.max(1));
        let r: Option<String> = self.query(cmd).await?;
        Ok(r.is_some())
    }

    async fn incr_u64(&self, key: &str, delta: u64) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("INCRBY");
        cmd.arg(key).arg(delta);
        self.query(cmd).await
    }

    async fn zrem(&self, key: &str, member: &str) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("ZREM");
        cmd.arg(key).arg(member);
        self.query(cmd).await
    }

    async fn zadd_score(&self, key: &str, member: &str, score: i64) -> redis::RedisResult<u64> {
        let mut cmd = redis::cmd("ZADD");
        cmd.arg(key).arg(score).arg(member);
        self.query(cmd).await
    }

    async fn zrangebyscore_limit(&self, key: &str, min: i64, max: i64, count: usize) -> redis::RedisResult<Vec<String>> {
        let mut cmd = redis::cmd("ZRANGEBYSCORE");
        cmd.arg(key)
            .arg(min)
            .arg(max)
            .arg("LIMIT")
            .arg(0)
            .arg(count.max(1));
        self.query(cmd).await
    }

    async fn zcard_clean_expired(&self, key: &str) -> redis::RedisResult<u64> {
        let script = r#"
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)
return redis.call('ZCARD', KEYS[1])
"#;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(key).arg(now_ms);
        self.query(cmd).await
    }

    async fn zreserve_with_capacity(
        &self,
        key: &str,
        job_id: &str,
        ttl_seconds: u64,
        running_jobs: u64,
        max_jobs: u64,
    ) -> redis::RedisResult<bool> {
        let script = r#"
local now = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local running = tonumber(ARGV[3])
local maxj = tonumber(ARGV[4])
local job = ARGV[5]

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)
local reserved = redis.call('ZCARD', KEYS[1])
local effective = reserved
if running > reserved then effective = running end
if effective >= maxj then
  return 0
end
redis.call('ZADD', KEYS[1], now + ttl_ms, job)
-- best-effort 保持 key 不永久增长（空集合也无所谓）
redis.call('EXPIRE', KEYS[1], math.max(60, math.floor(ttl_ms/1000) + 60))
return 1
"#;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let ttl_ms = (ttl_seconds.max(1) * 1000) as i64;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(key)
            .arg(now_ms)
            .arg(ttl_ms)
            .arg(running_jobs)
            .arg(max_jobs)
            .arg(job_id);
        let v: i64 = self.query(cmd).await?;
        Ok(v == 1)
    }
}

fn normalize_instance_id(s: &str) -> String {
    if s.trim().is_empty() || s.trim().eq_ignore_ascii_case("auto") {
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".to_string());
        let pid = std::process::id();
        let short = uuid::Uuid::new_v4().to_string();
        let short = short.split('-').next().unwrap_or("x");
        format!("{}-{}-{}", hostname, pid, short)
    } else {
        s.trim().to_string()
    }
}

fn extract_payloads_from_stream_reply(reply: redis::streams::StreamReadReply) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for k in reply.keys {
        for id in k.ids {
            if let Some(v) = id.map.get("payload") {
                if let Ok(payload) = redis::from_redis_value::<String>(v) {
                    out.push((id.id, payload));
                }
            }
        }
    }
    out
}

fn parse_xautoclaim_payloads(value: redis::Value) -> Vec<(String, String)> {
    // 期望格式：
    // [ next_start_id, [ [id, [field, value, ...]], ... ], [deleted_id...] ]
    let mut out = Vec::new();
    let redis::Value::Bulk(parts) = value else { return out };
    if parts.len() < 2 {
        return out;
    }
    let messages = &parts[1];
    let redis::Value::Bulk(entries) = messages else { return out };
    for e in entries {
        let redis::Value::Bulk(kv) = e else { continue };
        if kv.len() < 2 {
            continue;
        }
        let id = redis::from_redis_value::<String>(&kv[0]).ok();
        let fields = &kv[1];
        let payload = extract_payload_from_field_list(fields);
        if let (Some(id), Some(payload)) = (id, payload) {
            out.push((id, payload));
        }
    }
    out
}

fn extract_payload_from_field_list(value: &redis::Value) -> Option<String> {
    // fields = [field, value, field, value, ...]
    let redis::Value::Bulk(items) = value else { return None };
    let mut i = 0;
    while i + 1 < items.len() {
        let k = redis::from_redis_value::<String>(&items[i]).ok()?;
        if k == "payload" {
            return redis::from_redis_value::<String>(&items[i + 1]).ok();
        }
        i += 2;
    }
    None
}

#[derive(Debug, Clone)]
struct PendingEntry {
    id: String,
    #[allow(dead_code)]
    consumer: String,
    idle_ms: u64,
    deliveries: u64,
}

fn parse_xpending_entries(value: redis::Value) -> Vec<PendingEntry> {
    // XPENDING key group - + count
    // returns array of entries: [ [id, consumer, idle_ms, deliveries], ... ]
    let mut out = Vec::new();
    let redis::Value::Bulk(entries) = value else { return out };
    for e in entries {
        let redis::Value::Bulk(parts) = e else { continue };
        if parts.len() < 4 {
            continue;
        }
        let id = redis::from_redis_value::<String>(&parts[0]).ok();
        let consumer = redis::from_redis_value::<String>(&parts[1]).ok();
        let idle_ms = redis::from_redis_value::<u64>(&parts[2]).ok();
        let deliveries = redis::from_redis_value::<u64>(&parts[3]).ok();
        if let (Some(id), Some(consumer), Some(idle_ms), Some(deliveries)) = (id, consumer, idle_ms, deliveries) {
            out.push(PendingEntry {
                id,
                consumer,
                idle_ms,
                deliveries,
            });
        }
    }
    out
}

fn extract_payload_from_xrange(value: redis::Value) -> Option<String> {
    // XRANGE returns [ [id, [field, value, ...]] ]
    let redis::Value::Bulk(items) = value else { return None };
    if items.is_empty() {
        return None;
    }
    let redis::Value::Bulk(first) = &items[0] else { return None };
    if first.len() < 2 {
        return None;
    }
    let fields = &first[1];
    extract_payload_from_field_list(fields)
}

fn parse_xpending_summary_total(value: redis::Value) -> Option<u64> {
    // XPENDING <stream> <group>
    // returns [count, smallest_id, greatest_id, [ [consumer, count], ... ] ]
    let redis::Value::Bulk(parts) = value else { return None };
    if parts.is_empty() {
        return None;
    }
    redis::from_redis_value::<u64>(&parts[0]).ok()
}

#[allow(dead_code)]
fn redis_value_to_hashmap(value: redis::Value) -> Option<std::collections::HashMap<String, String>> {
    use std::collections::HashMap;
    let redis::Value::Bulk(items) = value else { return None };
    let mut out = HashMap::new();
    let mut i = 0;
    while i + 1 < items.len() {
        let k = redis::from_redis_value::<String>(&items[i]).ok()?;
        let v = redis::from_redis_value::<String>(&items[i + 1]).ok()?;
        out.insert(k, v);
        i += 2;
    }
    Some(out)
}

/// Phase 2：发送 NodeMessage（本地直发；否则按 owner 投递到目标实例 Streams）
pub async fn send_node_message_routed(state: &AppState, node_id: &str, msg: NodeMessage) -> bool {
    // 先尝试本地直发
    if state
        .node_connections
        .send(node_id, WsMessage::Text(serde_json::to_string(&msg).unwrap_or_default()))
        .await
    {
        return true;
    }
    let Some(rt) = state.phase2.as_ref() else { return false };

    // resolve owner + 校验存活
    let Some(owner) = rt.resolve_node_owner(node_id).await else { return false };
    if owner == rt.instance_id {
        return false;
    }
    rt.enqueue_to_instance(
        &owner,
        &InterInstanceEvent::DispatchToNode {
            node_id: node_id.to_string(),
            message: msg,
        },
    )
    .await
}

/// Phase 2：发送 SessionMessage（本地直发；否则按 owner 投递到目标实例 Streams）
pub async fn send_session_message_routed(state: &AppState, session_id: &str, msg: SessionMessage) -> bool {
    if state
        .session_connections
        .send(
            session_id,
            WsMessage::Text(serde_json::to_string(&msg).unwrap_or_default()),
        )
        .await
    {
        return true;
    }
    let Some(rt) = state.phase2.as_ref() else { return false };

    let Some(owner) = rt.resolve_session_owner(session_id).await else { return false };
    if owner == rt.instance_id {
        return false;
    }
    rt.enqueue_to_instance(
        &owner,
        &InterInstanceEvent::SendToSession {
            session_id: session_id.to_string(),
            message: msg,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, InstalledService, NodeStatus, ModelStatus, ResourceUsage};
    use std::collections::HashMap;
    use base64::Engine as _;
    use futures_util::{SinkExt, StreamExt};

    fn test_redis_config() -> crate::config::Phase2RedisConfig {
        let mut cfg = crate::config::Phase2RedisConfig::default();
        let mode = std::env::var("LINGUA_TEST_REDIS_MODE").unwrap_or_else(|_| "single".to_string());
        if mode == "cluster" {
            cfg.mode = "cluster".to_string();
            if let Ok(s) = std::env::var("LINGUA_TEST_REDIS_CLUSTER_URLS") {
                cfg.cluster_urls = s
                    .split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect();
            }
            if cfg.cluster_urls.is_empty() {
                cfg.cluster_urls = vec![std::env::var("LINGUA_TEST_REDIS_URL")
                    .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())];
            }
        } else {
            cfg.mode = "single".to_string();
            cfg.url = std::env::var("LINGUA_TEST_REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        }
        cfg
    }

    async fn can_connect_redis(cfg: &crate::config::Phase2RedisConfig) -> bool {
        match cfg.mode.as_str() {
            "cluster" => {
                let urls = if cfg.cluster_urls.is_empty() {
                    vec![cfg.url.clone()]
                } else {
                    cfg.cluster_urls.clone()
                };
                let client = match redis::cluster::ClusterClient::new(urls) {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let mut conn = match client.get_async_connection().await {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
                pong.is_ok()
            }
            _ => {
                let client = match redis::Client::open(cfg.url.as_str()) {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let mut conn = match client.get_multiplexed_tokio_connection().await {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
                pong.is_ok()
            }
        }
    }

    #[tokio::test]
    async fn phase2_streams_enqueue_and_readgroup_smoke() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let mut cfg = crate::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.instance_id = "test-a".to_string();
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        cfg.stream_block_ms = 50;
        cfg.stream_count = 10;

        let rt_a = Phase2Runtime::new(cfg.clone(), 5).await.unwrap().unwrap();
        let rt_b = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "test-b".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();

        // 确保 group 存在
        let stream_b = rt_a.instance_inbox_stream_key(&rt_b.instance_id);
        rt_b.ensure_group(&stream_b).await;

        // A 投递给 B
        let evt = InterInstanceEvent::SendToSession {
            session_id: "sess-1".to_string(),
            message: SessionMessage::ServerHeartbeat {
                session_id: "sess-1".to_string(),
                timestamp: 123,
            },
        };
        assert!(rt_a.enqueue_to_instance(&rt_b.instance_id, &evt).await);

        // B 用 xreadgroup 读到 payload
        let items = rt_b.xreadgroup(&stream_b, ">", 200, 10).await.unwrap();
        assert!(!items.is_empty());
        let (_id, payload) = &items[0];
        let parsed: InterInstanceEvent = serde_json::from_str(payload).unwrap();
        match parsed {
            InterInstanceEvent::SendToSession { session_id, .. } => assert_eq!(session_id, "sess-1"),
            _ => panic!("unexpected event type"),
        }
    }

    fn sample_node(node_id: &str) -> RegistryNode {
        let now = chrono::Utc::now();
        let mut capability_state: HashMap<String, ModelStatus> = HashMap::new();
        capability_state.insert("node-inference".to_string(), ModelStatus::Ready);

        RegistryNode {
            node_id: node_id.to_string(),
            name: "Node-Sample".to_string(),
            version: "0.0.1".to_string(),
            platform: "windows".to_string(),
            hardware: HardwareInfo {
                cpu_cores: 8,
                memory_gb: 32,
                gpus: Some(vec![GpuInfo { name: "RTX".to_string(), memory_gb: 8 }]),
            },
            status: NodeStatus::Ready,
            online: true,
            cpu_usage: 1.0,
            gpu_usage: Some(2.0),
            memory_usage: 3.0,
            installed_models: vec![InstalledModel {
                model_id: "dummy".to_string(),
                kind: "asr".to_string(),
                src_lang: None,
                tgt_lang: None,
                dialect: None,
                version: "1".to_string(),
                enabled: Some(true),
            }],
            installed_services: vec![InstalledService {
                service_id: "node-inference".to_string(),
                version: "1".to_string(),
                platform: "windows-x64".to_string(),
            }],
            features_supported: FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            accept_public_jobs: true,
            capability_state,
            current_jobs: 0,
            max_concurrent_jobs: 4,
            last_heartbeat: now,
            registered_at: now,
        }
    }

    #[tokio::test]
    async fn phase2_node_snapshot_roundtrip_smoke() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let mut cfg = crate::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.instance_id = "test-a".to_string();
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        cfg.node_snapshot.enabled = true;
        cfg.node_snapshot.presence_ttl_seconds = 10;
        cfg.node_snapshot.refresh_interval_ms = 1000;

        let rt_a = Phase2Runtime::new(cfg.clone(), 5).await.unwrap().unwrap();
        let rt_b = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "test-b".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();

        // 写 snapshot
        let node = sample_node("node-xyz");
        rt_a.upsert_node_snapshot(&node).await;

        // B 读出来（通过 nodes:all + GET snapshot）
        let ids = rt_b.redis.smembers_strings(&rt_b.nodes_all_set_key()).await.unwrap();
        assert!(ids.contains(&"node-xyz".to_string()));
        let json = rt_b.redis.get_string(&rt_b.node_snapshot_key("node-xyz")).await.unwrap().unwrap();
        let parsed: RegistryNode = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.node_id, "node-xyz");
        assert!(rt_b.redis.exists(&rt_b.node_presence_key("node-xyz")).await.unwrap());
    }

    #[tokio::test]
    async fn phase2_job_fsm_smoke() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let mut cfg = crate::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.instance_id = "test-fsm".to_string();
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

        let job_id = "job-fsm-1";
        rt.job_fsm_init(job_id, Some("node-1"), 1, 60).await;

        let s = rt.job_fsm_get(job_id).await.unwrap();
        assert_eq!(s.state, JobFsmState::Created.as_str());
        assert_eq!(s.attempt_id, 1);

        assert!(rt.job_fsm_to_dispatched(job_id, 1).await);
        assert!(rt.job_fsm_to_accepted(job_id, 1).await);
        assert!(rt.job_fsm_to_running(job_id).await);
        assert!(rt.job_fsm_to_finished(job_id, 1, true).await);
        assert!(rt.job_fsm_to_released(job_id).await);

        // 幂等：重复调用不应失败
        assert!(rt.job_fsm_to_dispatched(job_id, 1).await);
        assert!(rt.job_fsm_to_accepted(job_id, 1).await);
        assert!(rt.job_fsm_to_running(job_id).await);
        assert!(rt.job_fsm_to_finished(job_id, 1, true).await);
        assert!(rt.job_fsm_to_released(job_id).await);

        let s2 = rt.job_fsm_get(job_id).await.unwrap();
        assert_eq!(s2.state, JobFsmState::Released.as_str());
        assert_eq!(s2.finished_ok, Some(true));
    }

    #[tokio::test]
    async fn phase2_cross_instance_delivery_e2e_minimal() {
        // 目标：无需启动完整 scheduler server，仅验证 A -> Redis inbox -> B 读取并解析 payload 的链路。
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let mut cfg = crate::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        cfg.stream_block_ms = 50;
        cfg.stream_count = 10;
        cfg.stream_maxlen = 1000;
        cfg.dlq_enabled = true;

        let rt_a = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "test-a".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();
        let rt_b = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "test-b".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();

        let stream_b = rt_b.instance_inbox_stream_key(&rt_b.instance_id);
        rt_b.ensure_group(&stream_b).await;

        // A 投递到 B 的 inbox
        let evt = InterInstanceEvent::SendToSession {
            session_id: "sess-1".to_string(),
            message: SessionMessage::ServerHeartbeat {
                session_id: "sess-1".to_string(),
                timestamp: 123,
            },
        };
        assert!(rt_a.enqueue_to_instance(&rt_b.instance_id, &evt).await);

        // B 读新消息并解析
        let items = rt_b.xreadgroup(&stream_b, ">", 200, 10).await.unwrap();
        assert!(!items.is_empty());
        let (_id, payload) = &items[0];
        let parsed: InterInstanceEvent = serde_json::from_str(payload).unwrap();
        match parsed {
            InterInstanceEvent::SendToSession { session_id, .. } => assert_eq!(session_id, "sess-1"),
            _ => panic!("unexpected event type"),
        }
    }

    async fn build_test_state(
        instance_id: &str,
        redis_cfg: crate::config::Phase2RedisConfig,
        key_prefix: String,
    ) -> (crate::app_state::AppState, Arc<Phase2Runtime>) {
        use crate::app_state::AppState;
        use crate::audio_buffer::AudioBufferManager;
        use crate::config::{CoreServicesConfig, ModelHubConfig, NodeHealthConfig, TaskBindingConfig, WebTaskSegmentationConfig};
        use crate::connection_manager::{NodeConnectionManager, SessionConnectionManager};
        use crate::dashboard_snapshot::DashboardSnapshotCache;
        use crate::dispatcher::JobDispatcher;
        use crate::group_manager::{GroupConfig, GroupManager};
        use crate::model_hub::ModelHub;
        use crate::model_not_available::ModelNotAvailableBus;
        use crate::node_registry::NodeRegistry;
        use crate::node_status_manager::NodeStatusManager;
        use crate::pairing::PairingService;
        use crate::result_queue::ResultQueueManager;
        use crate::room_manager::RoomManager;
        use crate::service_catalog::ServiceCatalogCache;
        use crate::session::SessionManager;
        use std::time::Duration;

        let mut p2 = crate::config::Phase2Config::default();
        p2.enabled = true;
        p2.instance_id = instance_id.to_string();
        p2.redis = redis_cfg;
        p2.redis.key_prefix = key_prefix;
        p2.stream_block_ms = 50;
        p2.stream_count = 32;
        p2.stream_maxlen = 1000;
        p2.dlq_enabled = true;
        p2.dlq_scan_interval_ms = 200;
        p2.node_snapshot.enabled = true;
        p2.node_snapshot.refresh_interval_ms = 100;
        p2.node_snapshot.presence_ttl_seconds = 30;
        // 测试中不关心清理逻辑，避免误删干扰
        p2.node_snapshot.remove_stale_after_seconds = 0;

        let rt = Phase2Runtime::new(p2.clone(), 5).await.unwrap().unwrap();
        let rt = Arc::new(rt);

        let session_manager = SessionManager::new();
        let node_registry = std::sync::Arc::new(NodeRegistry::with_resource_threshold(100.0));
        let mut dispatcher = JobDispatcher::new_with_phase1_config(
            node_registry.clone(),
            TaskBindingConfig::default(),
            CoreServicesConfig::default(),
        );
        dispatcher.set_phase2(Some(rt.clone()));

        let pairing_service = PairingService::new();

        let storage_dir = std::env::temp_dir()
            .join("lingua_scheduler_test_modelhub")
            .join(uuid::Uuid::new_v4().to_string());
        let model_hub_cfg = ModelHubConfig {
            base_url: "http://127.0.0.1:0".to_string(),
            storage_path: storage_dir,
        };
        let model_hub = ModelHub::new(&model_hub_cfg).unwrap();

        let service_catalog = ServiceCatalogCache::new("http://127.0.0.1:0".to_string());
        let dashboard_snapshot = DashboardSnapshotCache::new(Duration::from_secs(3600));
        let (model_na_tx, _model_na_rx) = tokio::sync::mpsc::unbounded_channel();
        let model_not_available_bus = ModelNotAvailableBus::new(model_na_tx);

        let session_connections = SessionConnectionManager::new();
        let node_connections = NodeConnectionManager::new();
        let result_queue = ResultQueueManager::new();
        let audio_buffer = AudioBufferManager::new();

        let group_manager = GroupManager::new(GroupConfig::default());

        let node_status_manager = NodeStatusManager::new(
            node_registry.clone(),
            std::sync::Arc::new(node_connections.clone()),
            NodeHealthConfig::default(),
        );

        let room_manager = RoomManager::new();

        let state = AppState {
            session_manager,
            dispatcher,
            node_registry,
            pairing_service,
            model_hub,
            service_catalog,
            dashboard_snapshot,
            model_not_available_bus,
            core_services: CoreServicesConfig::default(),
            web_task_segmentation: WebTaskSegmentationConfig::default(),
            session_connections: session_connections.clone(),
            node_connections,
            result_queue,
            audio_buffer,
            group_manager,
            node_status_manager,
            room_manager,
            phase2: Some(rt.clone()),
        };

        // 启动 Phase2 后台任务（presence + owner 续约 + Streams inbox + snapshot refresh）
        rt.clone().spawn_background_tasks(state.clone());

        (state, rt)
    }

    async fn spawn_ws_server(state: crate::app_state::AppState) -> (std::net::SocketAddr, tokio::sync::oneshot::Sender<()>) {
        use axum::extract::State;
        use axum::extract::ws::WebSocketUpgrade;
        use axum::response::Response;
        use axum::routing::get;
        use axum::Router;

        async fn handle_session_ws(
            ws: WebSocketUpgrade,
            State(state): State<crate::app_state::AppState>,
        ) -> Response {
            ws.on_upgrade(move |socket| crate::websocket::handle_session(socket, state))
        }

        async fn handle_node_ws(
            ws: WebSocketUpgrade,
            State(state): State<crate::app_state::AppState>,
        ) -> Response {
            ws.on_upgrade(move |socket| crate::websocket::handle_node(socket, state))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let app = Router::new()
            .route("/ws/session", get(handle_session_ws))
            .route("/ws/node", get(handle_node_ws))
            .with_state(state);

        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = rx.await;
                })
                .await;
        });

        (addr, tx)
    }

    fn sample_node_register(node_id: &str) -> crate::messages::NodeMessage {
        let mut capability_state: HashMap<String, ModelStatus> = HashMap::new();
        capability_state.insert("node-inference".to_string(), ModelStatus::Ready);
        capability_state.insert("nmt-m2m100".to_string(), ModelStatus::Ready);
        capability_state.insert("piper-tts".to_string(), ModelStatus::Ready);

        crate::messages::NodeMessage::NodeRegister {
            node_id: Some(node_id.to_string()),
            version: "test".to_string(),
            capability_schema_version: Some("1.0".to_string()),
            platform: "test".to_string(),
            hardware: HardwareInfo {
                cpu_cores: 8,
                memory_gb: 32,
                gpus: Some(vec![GpuInfo { name: "RTX".to_string(), memory_gb: 8 }]),
            },
            installed_models: vec![InstalledModel {
                model_id: "dummy".to_string(),
                kind: "asr".to_string(),
                src_lang: None,
                tgt_lang: None,
                dialect: None,
                version: "1".to_string(),
                enabled: Some(true),
            }],
            installed_services: Some(vec![
                InstalledService { service_id: "node-inference".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "nmt-m2m100".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "piper-tts".to_string(), version: "1".to_string(), platform: "test".to_string() },
            ]),
            features_supported: FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            advanced_features: None,
            accept_public_jobs: true,
            capability_state: Some(capability_state),
        }
    }

    fn sample_node_heartbeat(node_id: &str) -> crate::messages::NodeMessage {
        let mut capability_state: HashMap<String, ModelStatus> = HashMap::new();
        capability_state.insert("node-inference".to_string(), ModelStatus::Ready);
        capability_state.insert("nmt-m2m100".to_string(), ModelStatus::Ready);
        capability_state.insert("piper-tts".to_string(), ModelStatus::Ready);

        crate::messages::NodeMessage::NodeHeartbeat {
            node_id: node_id.to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            resource_usage: ResourceUsage {
                cpu_percent: 1.0,
                gpu_percent: Some(1.0),
                gpu_mem_percent: Some(1.0),
                mem_percent: 1.0,
                running_jobs: 0,
            },
            installed_models: None,
            installed_services: Some(vec![
                InstalledService { service_id: "node-inference".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "nmt-m2m100".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "piper-tts".to_string(), version: "1".to_string(), platform: "test".to_string() },
            ]),
            capability_state: Some(capability_state),
        }
    }

    #[tokio::test]
    async fn phase2_ws_e2e_real_websocket_minimal() {
        // 目标：启动两个 scheduler（A/B），node 连 A，session 连 B，
        // 验证：B 创建 job -> routed 到 A 下发 -> node 回传结果 -> routed 回 B -> session 收到 TranslationResult。
        //
        // 默认跳过：避免在普通 `cargo test` 中引入网络/时序不确定性。
        if std::env::var("LINGUA_TEST_PHASE2_WS_E2E").is_err() {
            eprintln!("skip: set LINGUA_TEST_PHASE2_WS_E2E=1 to enable");
            return;
        }

        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let key_prefix = std::env::var("LINGUA_TEST_KEY_PREFIX").unwrap_or_else(|_| {
            format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""))
        });

        let (state_a, rt_a) = build_test_state("ws-a", redis_cfg.clone(), key_prefix.clone()).await;
        let (state_b, rt_b) = build_test_state("ws-b", redis_cfg.clone(), key_prefix.clone()).await;

        // 等待 presence 生效（resolve owner 需要校验实例存活）
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if rt_a.is_instance_alive(&rt_a.instance_id).await && rt_b.is_instance_alive(&rt_b.instance_id).await {
                break;
            }
            if tokio::time::Instant::now() > deadline {
                panic!("phase2 presence not ready");
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        let (addr_a, shutdown_a) = spawn_ws_server(state_a.clone()).await;
        let (addr_b, shutdown_b) = spawn_ws_server(state_b.clone()).await;

        let node_url = format!("ws://{}/ws/node", addr_a);
        let sess_url = format!("ws://{}/ws/session", addr_b);

        // ===== node client（连接 A）=====
        let (node_ws, _) = tokio_tungstenite::connect_async(node_url).await.unwrap();
        let (mut node_write, mut node_read) = node_ws.split();
        let (node_tx, mut node_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

        // writer task
        tokio::spawn(async move {
            while let Some(s) = node_rx.recv().await {
                let _ = node_write.send(tokio_tungstenite::tungstenite::Message::Text(s)).await;
            }
        });

        // send node_register
        let node_id = "node-ws-e2e-1";
        node_tx
            .send(serde_json::to_string(&sample_node_register(node_id)).unwrap())
            .unwrap();

        // 关键：发心跳让节点从 registering -> ready（NodeRegistry 选节点硬要求 status==ready）
        for _ in 0..3 {
            node_tx
                .send(serde_json::to_string(&sample_node_heartbeat(node_id)).unwrap())
                .unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        // reader/reactor task：收到 job_assign 就立即回 ack/started/result
        let node_tx2 = node_tx.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = node_read.next().await {
                let tokio_tungstenite::tungstenite::Message::Text(txt) = msg else { continue };
                let parsed: crate::messages::NodeMessage = match serde_json::from_str(&txt) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let crate::messages::NodeMessage::JobAssign {
                    job_id,
                    attempt_id,
                    session_id,
                    utterance_index,
                    trace_id,
                    ..
                } = parsed
                {
                    // ack
                    let ack = crate::messages::NodeMessage::JobAck {
                        job_id: job_id.clone(),
                        attempt_id,
                        node_id: node_id.to_string(),
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                    };
                    let started = crate::messages::NodeMessage::JobStarted {
                        job_id: job_id.clone(),
                        attempt_id,
                        node_id: node_id.to_string(),
                        session_id: session_id.clone(),
                        trace_id: trace_id.clone(),
                    };
                    let result = crate::messages::NodeMessage::JobResult {
                        job_id: job_id.clone(),
                        attempt_id,
                        node_id: node_id.to_string(),
                        session_id: session_id.clone(),
                        utterance_index,
                        success: true,
                        text_asr: Some("hello".to_string()),
                        text_translated: Some("你好".to_string()),
                        tts_audio: None,
                        tts_format: None,
                        extra: None,
                        processing_time_ms: Some(1),
                        error: None,
                        trace_id,
                        group_id: None,
                        part_index: None,
                    };
                    let _ = node_tx2.send(serde_json::to_string(&ack).unwrap());
                    let _ = node_tx2.send(serde_json::to_string(&started).unwrap());
                    let _ = node_tx2.send(serde_json::to_string(&result).unwrap());
                    return;
                }
            }
        });

        // 等待 B 的 node snapshot refresher 把 node 同步进来且状态为 ready（否则 B 选不到节点）
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if let Some(n) = state_b.node_registry.get_node_snapshot(node_id).await {
                if n.status == NodeStatus::Ready {
                    break;
                }
            }
            if tokio::time::Instant::now() > deadline {
                let st = state_b
                    .node_registry
                    .get_node_snapshot(node_id)
                    .await
                    .map(|n| format!("{:?}", n.status))
                    .unwrap_or_else(|| "none".to_string());
                panic!("node snapshot not propagated to scheduler B as ready (current={})", st);
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        // ===== session client（连接 B）=====
        let (sess_ws, _) = tokio_tungstenite::connect_async(sess_url).await.unwrap();
        let (mut sess_write, mut sess_read) = sess_ws.split();

        let init = crate::messages::SessionMessage::SessionInit {
            client_version: "test".to_string(),
            platform: "web".to_string(),
            src_lang: "en".to_string(),
            tgt_lang: "zh".to_string(),
            dialect: None,
            features: None,
            pairing_code: None,
            tenant_id: None,
            mode: None,
            lang_a: None,
            lang_b: None,
            auto_langs: None,
            enable_streaming_asr: Some(true),
            partial_update_interval_ms: Some(100),
            trace_id: Some("trace-ws-e2e".to_string()),
        };
        sess_write
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::to_string(&init).unwrap(),
            ))
            .await
            .unwrap();

        // 收到 session_init_ack
        let mut session_id = None::<String>;
        let mut trace_id = None::<String>;
        let ack_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        while tokio::time::Instant::now() < ack_deadline {
            let msg = tokio::time::timeout(std::time::Duration::from_secs(3), sess_read.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let tokio_tungstenite::tungstenite::Message::Text(txt) = msg else { continue };
            let parsed: crate::messages::SessionMessage = serde_json::from_str(&txt).unwrap();
            if let crate::messages::SessionMessage::SessionInitAck { session_id: sid, trace_id: tid, .. } = parsed {
                session_id = Some(sid);
                trace_id = Some(tid);
                break;
            }
        }
        let session_id = session_id.expect("no session_init_ack");
        let trace_id = trace_id.unwrap_or_else(|| "trace-ws-e2e".to_string());

        // 发 utterance
        let audio_b64 = base64::engine::general_purpose::STANDARD.encode(b"\0\0\0\0");
        let utt = crate::messages::SessionMessage::Utterance {
            session_id: session_id.clone(),
            utterance_index: 0,
            manual_cut: true,
            src_lang: "en".to_string(),
            tgt_lang: "zh".to_string(),
            dialect: None,
            features: None,
            audio: audio_b64,
            audio_format: "wav".to_string(),
            sample_rate: 16000,
            mode: None,
            lang_a: None,
            lang_b: None,
            auto_langs: None,
            enable_streaming_asr: Some(true),
            partial_update_interval_ms: Some(100),
            trace_id: Some(trace_id.clone()),
        };
        sess_write
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::to_string(&utt).unwrap(),
            ))
            .await
            .unwrap();

        // 等待 translation_result（或至少收到包含翻译结果的消息）
        let res_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut got_result = false;
        while tokio::time::Instant::now() < res_deadline {
            let next = tokio::time::timeout(std::time::Duration::from_secs(5), sess_read.next()).await;
            let Ok(Some(Ok(msg))) = next else { continue };
            let tokio_tungstenite::tungstenite::Message::Text(txt) = msg else { continue };
            let parsed: crate::messages::SessionMessage = match serde_json::from_str(&txt) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let crate::messages::SessionMessage::TranslationResult { session_id: sid, text_asr, text_translated, .. } = parsed {
                assert_eq!(sid, session_id);
                assert!(!text_asr.is_empty());
                assert!(!text_translated.is_empty());
                got_result = true;
                break;
            }
        }
        assert!(got_result, "did not receive translation_result");

        // shutdown servers
        let _ = shutdown_a.send(());
        let _ = shutdown_b.send(());
    }

    #[tokio::test]
    async fn phase2_cluster_acceptance_smoke() {
        // Cluster 自动化验收专用：
        // - 只在 LINGUA_TEST_REDIS_MODE=cluster 时跑（避免本地 single 环境变慢）
        // - 覆盖：presence/owner、Streams（含 DLQ + XCLAIM）、Lua（reservation/FSM）、request 幂等、snapshot 清理
        let redis_cfg = test_redis_config();
        if redis_cfg.mode != "cluster" {
            eprintln!("skip: not in cluster mode (set LINGUA_TEST_REDIS_MODE=cluster)");
            return;
        }
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis cluster not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );

        let mut cfg = crate::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = key_prefix;
        cfg.stream_block_ms = 50;
        cfg.stream_count = 10;
        cfg.stream_maxlen = 200;
        cfg.dlq_enabled = true;
        cfg.dlq_maxlen = 200;
        cfg.dlq_max_deliveries = 1;
        cfg.dlq_min_idle_ms = 1;
        cfg.dlq_scan_interval_ms = 1000;
        cfg.dlq_scan_count = 50;
        cfg.node_snapshot.enabled = true;
        cfg.node_snapshot.presence_ttl_seconds = 30;
        cfg.node_snapshot.refresh_interval_ms = 500;
        cfg.node_snapshot.remove_stale_after_seconds = 1;

        let rt_a = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "acc-a".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();
        let rt_b = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "acc-b".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();

        // ===== 1) presence + owner 解析（需要 presence 才会返回 owner）=====
        let _ = rt_a
            .redis
            .set_ex_string(&rt_a.scheduler_presence_key(), "1", 10)
            .await;
        let _ = rt_b
            .redis
            .set_ex_string(&rt_b.scheduler_presence_key(), "1", 10)
            .await;

        rt_a.set_node_owner("node-1").await;
        // 强行让 node-1 归属于 B（模拟 node 连接在 B）
        let _ = rt_a
            .redis
            .set_ex_string(&rt_a.node_owner_key("node-1"), &rt_b.instance_id, 10)
            .await;
        assert_eq!(rt_a.resolve_node_owner("node-1").await, Some(rt_b.instance_id.clone()));
        // 删除 B presence 后应认为 owner 不可用
        let _ = rt_a.redis.del(&rt_b.scheduler_presence_key()).await;
        assert_eq!(rt_a.resolve_node_owner("node-1").await, None);
        // 恢复 B presence
        let _ = rt_b
            .redis
            .set_ex_string(&rt_b.scheduler_presence_key(), "1", 10)
            .await;

        // ===== 2) Streams：A -> B inbox；制造 pending；DLQ 搬运（XPENDING + XCLAIM）=====
        let stream_b = rt_b.instance_inbox_stream_key(&rt_b.instance_id);
        rt_b.ensure_group(&stream_b).await;

        let evt = InterInstanceEvent::SendToSession {
            session_id: "sess-offline".to_string(),
            message: SessionMessage::ServerHeartbeat {
                session_id: "sess-offline".to_string(),
                timestamp: 1,
            },
        };
        assert!(rt_a.enqueue_to_instance(&rt_b.instance_id, &evt).await);
        // 读一次但不 ack/del，使其进入 pending
        let items = rt_b.xreadgroup(&stream_b, ">", 200, 10).await.unwrap();
        assert!(!items.is_empty());
        let (pending_id, _payload) = &items[0];
        // 等待一点点让 idle > dlq_min_idle_ms
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        // 直接触发 DLQ 扫描
        rt_b.scan_pending_to_dlq(&stream_b).await.unwrap();
        // DLQ 应该至少有 1 条
        let dlq = rt_b.instance_dlq_stream_key(&rt_b.instance_id);
        let dlq_len: u64 = rt_b
            .redis
            .query({
                let mut c = redis::cmd("XLEN");
                c.arg(&dlq);
                c
            })
            .await
            .unwrap_or(0);
        assert!(dlq_len >= 1);
        // 原 stream 上这条消息应已被删除（best-effort：XDEL 后 XLEN 可能仍>0，但该 id 不应存在）
        let v: redis::Value = rt_b
            .redis
            .query({
                let mut c = redis::cmd("XRANGE");
                c.arg(&stream_b).arg(pending_id).arg(pending_id);
                c
            })
            .await
            .unwrap();
        match v {
            redis::Value::Bulk(items) => assert!(items.is_empty()),
            _ => {}
        }

        // ===== 3) Lua：node reservation（capacity）=====
        let ok1 = rt_a.reserve_node_slot("node-cap", "job-1", 30, 0, 1).await;
        let ok2 = rt_a.reserve_node_slot("node-cap", "job-2", 30, 0, 1).await;
        assert!(ok1);
        assert!(!ok2);
        rt_a.release_node_slot("node-cap", "job-1").await;
        let ok3 = rt_a.reserve_node_slot("node-cap", "job-2", 30, 0, 1).await;
        assert!(ok3);

        // ===== 4) Job FSM：Lua 迁移（同 slot hash tag {job:<id>}) =====
        let job_id = "job-cluster-1";
        rt_a.job_fsm_init(job_id, Some("node-1"), 1, 60).await;
        assert!(rt_a.job_fsm_to_dispatched(job_id, 1).await);
        assert!(rt_a.job_fsm_to_accepted(job_id, 1).await);
        assert!(rt_a.job_fsm_to_running(job_id).await);
        assert!(rt_a.job_fsm_to_finished(job_id, 1, true).await);
        assert!(rt_a.job_fsm_to_released(job_id).await);

        // ===== 5) request lock/binding 幂等 =====
        let rid = "req-1";
        assert!(rt_a.acquire_request_lock(rid, "o1", 5000).await);
        assert!(!rt_a.acquire_request_lock(rid, "o2", 5000).await);
        rt_a.release_request_lock(rid, "o1").await;
        assert!(rt_a.acquire_request_lock(rid, "o2", 5000).await);
        rt_a.set_request_binding(rid, "job-bind-1", Some("node-1"), 10, false).await;
        let b = rt_a.get_request_binding(rid).await.unwrap();
        assert_eq!(b.job_id, "job-bind-1");

        // ===== 6) snapshot 清理：nodes:all + last_seen =====
        let node = sample_node("node-stale");
        rt_a.upsert_node_snapshot(&node).await;
        // 模拟离线：删 presence，并把 last_seen 设置为旧值
        let _ = rt_a.redis.del(&rt_a.node_presence_key("node-stale")).await;
        let old_ms = chrono::Utc::now().timestamp_millis() - 10_000;
        let _ = rt_a
            .redis
            .zadd_score(&rt_a.nodes_last_seen_zset_key(), "node-stale", old_ms)
            .await;
        rt_a.cleanup_stale_nodes().await;
        let ids = rt_a.redis.smembers_strings(&rt_a.nodes_all_set_key()).await.unwrap();
        assert!(!ids.contains(&"node-stale".to_string()));
    }
}


