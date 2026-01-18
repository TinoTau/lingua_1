//! 极简无锁调度服务（Minimal Lockless Scheduler）
//! 
//! 根据 LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md 实现
//! - 不依赖任何业务层面的 Mutex/RwLock
//! - 不维护本地全局状态
//! - 所有共享状态统一存入 Redis
//! - 所有并发控制统一通过 Redis 原子操作（Lua 脚本）完成

use crate::phase2::RedisHandle;
use crate::managers::NodeConnectionManager;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// 节点注册请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterNodeRequest {
    pub node_id: String,
    pub cap_json: String,        // 节点能力 JSON
    pub pool_names_json: Option<String>, // 可选，Pool ID 到 Pool Name 的映射 JSON（如 "[{\"id\":1,\"name\":\"zh-en\"},{\"id\":2,\"name\":\"en-zh\"}]"）
}

/// 节点心跳请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatRequest {
    pub node_id: String,
    pub online: bool,
    pub load_json: Option<String>, // 可选，负载信息 JSON
}

/// 任务调度请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchRequest {
    pub session_id: String,
    pub src_lang: String,
    pub tgt_lang: String,
    pub payload_json: String,
    /// 双向模式的语言 A（用于 Pool 查找）
    pub lang_a: Option<String>,
    /// 双向模式的语言 B（用于 Pool 查找）
    pub lang_b: Option<String>,
}

/// 任务调度响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchResponse {
    pub node_id: String,
    pub job_id: String,
}

/// 任务完成请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteTaskRequest {
    pub job_id: String,
    pub node_id: String,
    pub status: String, // "finished" / "failed"
}

/// 极简调度服务
pub struct MinimalSchedulerService {
    redis: Arc<RedisHandle>,
    /// Lua 脚本缓存（加载后缓存）
    scripts: Arc<ScriptsCache>,
    /// 实例 ID（用于分布式锁）
    instance_id: String,
}

struct ScriptsCache {
    register_node: String,
    heartbeat: String,
    dispatch_task: String,
    complete_task: String,
}

impl MinimalSchedulerService {
    /// 创建新的极简调度服务
    pub async fn new(redis: Arc<RedisHandle>) -> Result<Self> {
        // 加载 Lua 脚本
        let scripts = Self::load_scripts().await?;
        
        // 生成实例 ID（用于分布式锁）
        let instance_id = Uuid::new_v4().to_string();
        
        Ok(Self {
            redis,
            scripts: Arc::new(scripts),
            instance_id,
        })
    }

    /// 加载 Lua 脚本
    async fn load_scripts() -> Result<ScriptsCache> {
        // 从文件加载脚本（开发环境）或使用内嵌脚本（生产环境）
        // 注意：include_str! 路径是相对于当前源文件的
        let register_node = include_str!("../../scripts/lua/register_node.lua").to_string();
        let heartbeat = include_str!("../../scripts/lua/heartbeat.lua").to_string();
        let dispatch_task = include_str!("../../scripts/lua/dispatch_task.lua").to_string();
        let complete_task = include_str!("../../scripts/lua/complete_task.lua").to_string();

        Ok(ScriptsCache {
            register_node,
            heartbeat,
            dispatch_task,
            complete_task,
        })
    }

    /// 执行 Lua 脚本
    async fn eval_script<T: redis::FromRedisValue>(
        &self,
        script: &str,
        keys: &[&str],
        args: &[&str],
    ) -> Result<T> {
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(keys.len() as i32);
        for key in keys {
            cmd.arg(key);
        }
        for arg in args {
            cmd.arg(arg);
        }
        
        let result: redis::Value = self.redis.query(cmd).await
            .with_context(|| format!("执行 Lua 脚本失败 (keys: {:?}, args: {:?})", keys, args))?;
        
        T::from_redis_value(&result)
            .with_context(|| format!("解析 Lua 脚本返回值失败 (keys: {:?}, args: {:?})", keys, args))
            .map_err(Into::into)
    }

    /// 节点注册
    pub async fn register_node(&self, req: RegisterNodeRequest) -> Result<()> {
        debug!(
            node_id = %req.node_id,
            "节点注册"
        );

        let pool_names_json = req.pool_names_json.as_deref().unwrap_or("[]");
        
        self.eval_script::<String>(
            &self.scripts.register_node,
            &[],
            &[
                &req.node_id,
                &req.cap_json,
                pool_names_json,
            ],
        )
        .await?;

        info!(
            node_id = %req.node_id,
            "节点注册成功"
        );

        Ok(())
    }

    /// 节点心跳
    pub async fn heartbeat(&self, req: HeartbeatRequest) -> Result<()> {
        debug!(
            node_id = %req.node_id,
            online = req.online,
            "节点心跳"
        );

        let online_str = if req.online { "true" } else { "false" };
        let load_json = req.load_json.as_deref().unwrap_or("");
        
        self.eval_script::<String>(
            &self.scripts.heartbeat,
            &[],
            &[
                &req.node_id,
                online_str,
                load_json,
            ],
        )
        .await?;

        Ok(())
    }

    /// 任务调度
    pub async fn dispatch_task(&self, req: DispatchRequest) -> Result<DispatchResponse> {
        debug!(
            session_id = %req.session_id,
            src_lang = %req.src_lang,
            tgt_lang = %req.tgt_lang,
            lang_a = ?req.lang_a,
            lang_b = ?req.lang_b,
            "任务调度"
        );

        // 优化：在执行调度前检查timeout_node_id（用于后续fallback检测）
        let session_key = format!("scheduler:session:{}", req.session_id);
        let check_timeout_script = r#"
return redis.call('HGET', KEYS[1], 'timeout_node_id') or ''
"#;
        let mut check_cmd = redis::cmd("EVAL");
        check_cmd.arg(check_timeout_script).arg(1).arg(&session_key);
        let expected_timeout_node_id: Option<String> = self.redis.query(check_cmd).await.ok().flatten();
        
        // 在双向模式下，使用 lang_a 和 lang_b 来查找 Pool，而不是 src_lang="auto" 和 tgt_lang
        // 但 src_lang 仍然保持为 "auto"（节点端需要检测语言）
        let pool_src_lang = if req.src_lang == "auto" && req.lang_a.is_some() && req.lang_b.is_some() {
            // 双向模式：使用 lang_a 和 lang_b 来查找 Pool
            // 查找支持 lang_a 和 lang_b 的 Pool（使用 lang_a->lang_b 作为查找键）
            req.lang_a.as_ref().unwrap()
        } else {
            &req.src_lang
        };
        let pool_tgt_lang = if req.src_lang == "auto" && req.lang_a.is_some() && req.lang_b.is_some() {
            // 双向模式：使用 lang_b 作为目标语言
            req.lang_b.as_ref().unwrap()
        } else {
            &req.tgt_lang
        };

        // 直接执行 Lua 脚本，不进行类型转换，以便正确处理错误格式
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(&self.scripts.dispatch_task).arg(0);
        cmd.arg(&req.session_id);
        cmd.arg(pool_src_lang);  // 用于 Pool 查找的源语言
        cmd.arg(pool_tgt_lang);  // 用于 Pool 查找的目标语言
        cmd.arg(&req.payload_json);
        
        // 执行 Lua 脚本，不添加额外的上下文，以便错误消息直接包含 Lua 脚本返回的错误代码
        let result: redis::Value = self.redis.query(cmd).await
            .map_err(|e| anyhow::anyhow!("Redis 查询失败: {}", e))?;

        // 解析结果：可能是 [node_id, job_id] 或 {err, "ERROR_MESSAGE"}
        match result {
            redis::Value::Bulk(items) => {
                if items.len() >= 2 {
                    // 先检查是否是错误格式：{err, "ERROR_MESSAGE"}
                    // 注意：Lua 脚本返回 {err = "NO_POOL_FOR_LANG_PAIR"} 会被 Redis 转换为 ["err", "NO_POOL_FOR_LANG_PAIR"]
                    if let Ok(err_type) = redis::from_redis_value::<String>(&items[0]) {
                        if err_type == "err" {
                            if let Ok(err_msg) = redis::from_redis_value::<String>(&items[1]) {
                                // 优化：根据错误类型记录相应的日志
                                if err_msg == "NO_POOL_FOR_LANG_PAIR" {
                                    warn!(
                                        session_id = %req.session_id,
                                        src_lang = %pool_src_lang,
                                        tgt_lang = %pool_tgt_lang,
                                        "[PoolCorrupt] invalid pools_json / Redis record missing"
                                    );
                                } else if err_msg == "NO_AVAILABLE_NODE" {
                                    warn!(
                                        session_id = %req.session_id,
                                        src_lang = %pool_src_lang,
                                        tgt_lang = %pool_tgt_lang,
                                        "[PoolEmpty] no online nodes in pool"
                                    );
                                }
                                
                                // 直接返回错误消息，确保包含原始错误代码（如 NO_POOL_FOR_LANG_PAIR）
                                return Err(anyhow::anyhow!("{}", err_msg));
                            }
                        }
                    }
                    
                    // 成功格式：{node_id, job_id}
                    let node_id = redis::from_redis_value::<String>(&items[0])?;
                    let job_id = redis::from_redis_value::<String>(&items[1])?;
                    
                    // 优化：检查是否发生了AffinityFallback
                    // 如果session中有timeout_node_id但选中的节点不是它，说明发生了fallback
                    if let Some(ref expected_node_id) = expected_timeout_node_id {
                        if !expected_node_id.is_empty() {
                            if expected_node_id == &node_id {
                                info!(
                                    session_id = %req.session_id,
                                    node_id = %node_id,
                                    job_id = %job_id,
                                    "[SessionAffinity] timeout_node_id matched, routing to same node for AudioAggregator continuity"
                                );
                            } else {
                                warn!(
                                    session_id = %req.session_id,
                                    expected_node_id = %expected_node_id,
                                    actual_node_id = %node_id,
                                    job_id = %job_id,
                                    "[AffinityFallback] timeout_node_id not usable (node offline or not in candidate pools) → fallback to other node"
                                );
                            }
                        }
                    } else {
                        debug!(
                            session_id = %req.session_id,
                            node_id = %node_id,
                            job_id = %job_id,
                            "[SessionAffinity] No timeout_node_id mapping found, using random assignment"
                        );
                    }
                    
                    info!(
                        session_id = %req.session_id,
                        node_id = %node_id,
                        job_id = %job_id,
                        "任务调度成功"
                    );
                    
                    Ok(DispatchResponse { node_id, job_id })
                } else {
                    Err(anyhow::anyhow!("执行 Lua 脚本失败: 返回值格式错误（长度不足）"))
                }
            }
            _ => {
                // 尝试解析为字符串错误
                if let Ok(err_msg) = redis::from_redis_value::<String>(&result) {
                    Err(anyhow::anyhow!("{}", err_msg))
                } else {
                    Err(anyhow::anyhow!("执行 Lua 脚本失败: 未知错误"))
                }
            }
        }
    }

    /// 任务完成
    pub async fn complete_task(&self, req: CompleteTaskRequest) -> Result<()> {
        debug!(
            job_id = %req.job_id,
            node_id = %req.node_id,
            status = %req.status,
            "任务完成"
        );

        let result: redis::Value = self.eval_script(
            &self.scripts.complete_task,
            &[],
            &[
                &req.job_id,
                &req.node_id,
                &req.status,
            ],
        )
        .await?;

        // 解析结果：可能是 "OK" 或 {err, "NODE_MISMATCH"} 格式
        match result {
            redis::Value::Status(s) if s == "OK" => {
                info!(
                    job_id = %req.job_id,
                    node_id = %req.node_id,
                    "任务完成成功"
                );
                Ok(())
            }
            redis::Value::Bulk(items) => {
                // 错误格式：{err, "NODE_MISMATCH"}
                if items.len() >= 2 {
                    if let Ok(err_type) = redis::from_redis_value::<String>(&items[0]) {
                        if err_type == "err" {
                            if let Ok(err_msg) = redis::from_redis_value::<String>(&items[1]) {
                                return Err(anyhow::anyhow!("任务完成失败: {}", err_msg));
                            }
                        }
                    }
                }
                Err(anyhow::anyhow!("任务完成失败: 未知错误格式"))
            }
            _ => {
                // 尝试解析为字符串
                if let Ok(err_msg) = redis::from_redis_value::<String>(&result) {
                    if err_msg == "OK" {
                        info!(
                            job_id = %req.job_id,
                            node_id = %req.node_id,
                            "任务完成成功"
                        );
                        Ok(())
                    } else {
                        Err(anyhow::anyhow!("任务完成失败: {}", err_msg))
                    }
                } else {
                    Err(anyhow::anyhow!("任务完成失败: 未知错误"))
                }
            }
        }
    }

    /// 检查是否有其他实例正在清理，如果没有则清理 pool 中的离线节点
    /// 返回 true 表示当前实例已执行清理
    pub async fn check_and_cleanup_pools_if_leader(
        &self,
        node_connections: &NodeConnectionManager,
    ) -> Result<bool> {
        // 1. 尝试设置清理标志位（使用 SET NX EX）
        // 如果成功设置，说明没有其他实例正在清理，可以执行清理
        // 如果失败，说明其他实例正在清理，跳过
        let cleanup_flag_key = "scheduler:cleanup:in_progress";
        let ttl_seconds = 60u64; // 60 秒过期（足够完成清理）
        
        debug!(
            instance_id = %self.instance_id,
            cleanup_flag_key = %cleanup_flag_key,
            ttl_seconds = ttl_seconds,
            "尝试设置清理标志位"
        );
        
        let mut cmd = redis::cmd("SET");
        cmd.arg(cleanup_flag_key)
            .arg("1")
            .arg("NX")
            .arg("EX")
            .arg(ttl_seconds);
        
        let result: Option<String> = self.redis.query(cmd).await
            .with_context(|| format!("设置清理标志位失败 (key: {})", cleanup_flag_key))?;
        let can_cleanup = result.is_some();
        
        if !can_cleanup {
            debug!(
                instance_id = %self.instance_id,
                cleanup_flag_key = %cleanup_flag_key,
                "其他实例正在清理 pool，跳过清理操作"
            );
            return Ok(false);
        }
        
        info!(
            instance_id = %self.instance_id,
            cleanup_flag_key = %cleanup_flag_key,
            ttl_seconds = ttl_seconds,
            "成功设置清理标志位，开始清理 pool 中的离线节点"
        );
        
        // 2. 清理离线节点
        // 注意：清理完成后不删除标志位，依赖 60 秒过期时间
        // 这样可以避免删除操作，简化代码逻辑
        let cleanup_start = std::time::Instant::now();
        match self.cleanup_offline_nodes_from_pools(node_connections).await {
            Ok(()) => {
                let cleanup_elapsed = cleanup_start.elapsed();
                info!(
                    instance_id = %self.instance_id,
                    cleanup_elapsed_ms = cleanup_elapsed.as_millis(),
                    "Pool 清理完成"
                );
                Ok(true)
            }
            Err(e) => {
                let cleanup_elapsed = cleanup_start.elapsed();
                warn!(
                    instance_id = %self.instance_id,
                    cleanup_elapsed_ms = cleanup_elapsed.as_millis(),
                    error = %e,
                    "Pool 清理失败"
                );
                Err(e)
            }
        }
    }

    /// 清理 pool 中的离线节点
    async fn cleanup_offline_nodes_from_pools(
        &self,
        node_connections: &NodeConnectionManager,
    ) -> Result<()> {
        // 1. 获取所有 pool 成员集合的 key
        let pool_pattern = "scheduler:pool:*:members";
        let mut cmd = redis::cmd("KEYS");
        cmd.arg(pool_pattern);
        
        let pool_keys: Vec<String> = self.redis.query(cmd).await?;
        
        if pool_keys.is_empty() {
            debug!("没有找到任何 pool，跳过清理");
            return Ok(());
        }
        
        info!(
            pool_count = pool_keys.len(),
            "开始清理 {} 个 pool 中的离线节点",
            pool_keys.len()
        );
        
        let mut total_cleaned = 0;
        
        // 2. 遍历每个 pool
        for pool_key in pool_keys {
            // 获取 pool 中的所有节点
            let mut cmd = redis::cmd("SMEMBERS");
            cmd.arg(&pool_key);
            let nodes: Vec<String> = match self.redis.query(cmd).await {
                Ok(nodes) => nodes,
                Err(e) => {
                    warn!(
                        pool_key = %pool_key,
                        error = %e,
                        "获取 pool 成员失败"
                    );
                    continue;
                }
            };
            
            if nodes.is_empty() {
                continue;
            }
            
            // 3. 检查每个节点的连接是否存在
            let mut nodes_to_remove = Vec::new();
            for node_id in &nodes {
                // 检查连接是否存在
                let has_connection = node_connections.get_sender(node_id).await.is_some();
                if !has_connection {
                    nodes_to_remove.push(node_id.clone());
                }
            }
            
            // 4. 从 pool 中移除离线节点
            if !nodes_to_remove.is_empty() {
                let mut cmd = redis::cmd("SREM");
                cmd.arg(&pool_key);
                for node_id in &nodes_to_remove {
                    cmd.arg(node_id);
                }
                
                match self.redis.query::<u64>(cmd).await {
                    Ok(removed_count) => {
                        total_cleaned += removed_count;
                        info!(
                            pool_key = %pool_key,
                            removed_count = removed_count,
                            removed_nodes = ?nodes_to_remove,
                            "从 pool 中移除了 {} 个离线节点",
                            removed_count
                        );
                    }
                    Err(e) => {
                        warn!(
                            pool_key = %pool_key,
                            error = %e,
                            "从 pool 中移除节点失败"
                        );
                    }
                }
            }
        }
        
        info!(
            total_cleaned = total_cleaned,
            "Pool 清理完成，共移除了 {} 个离线节点",
            total_cleaned
        );
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 测试需要 Redis 连接，这里只做结构测试
    #[test]
    fn test_request_serialization() {
        let req = RegisterNodeRequest {
            node_id: "node-1".to_string(),
            cap_json: r#"{"services":["ASR","NMT"]}"#.to_string(),
            pool_names_json: Some(r#"[{"id":1,"name":"zh-en"}]"#.to_string()),
        };
        
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("node-1"));
    }
}
