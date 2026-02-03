//! 极简无锁调度服务（Minimal Lockless Scheduler）
//! 
//! 根据 LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md 实现
//! - 不依赖任何业务层面的 Mutex/RwLock
//! - 不维护本地全局状态
//! - 所有共享状态统一存入 Redis
//! - 所有并发控制统一通过 Redis 原子操作（Lua 脚本）完成

use crate::redis_runtime::RedisHandle;
// use crate::managers::NodeConnectionManager; // 不再需要
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info};

/// 节点注册请求（有向语言对版本）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterNodeRequest {
    pub node_id: String,
    pub asr_langs_json: String,       // ASR 语言 JSON
    pub semantic_langs_json: String,  // Semantic 语言 JSON（能力校验 + 池分配用 asr×semantic）
    pub tts_langs_json: String,       // TTS 语言 JSON（注册校验用）
}

// HeartbeatRequest 已删除（心跳已由 PoolService 处理）
// CompleteTaskRequest 已删除（complete_task() 调用已废弃）
// DispatchRequest 和 DispatchResponse 已废弃
// 现在使用 PoolService.select_node() 进行节点选择

/// 极简调度服务
pub struct MinimalSchedulerService {
    redis: Arc<RedisHandle>,
    /// Lua 脚本缓存（加载后缓存）
    scripts: Arc<ScriptsCache>,
    // instance_id 已删除（未使用）
}

struct ScriptsCache {
    register_node: String,
    // complete_task 已删除（complete_task() 调用已废弃）
}

impl MinimalSchedulerService {
    /// 创建新的极简调度服务
    pub async fn new(redis: Arc<RedisHandle>) -> Result<Self> {
        // 加载 Lua 脚本
        let scripts = Self::load_scripts().await?;
        
        // instance_id 已删除（未使用）
        
        Ok(Self {
            redis,
            scripts: Arc::new(scripts),
        })
    }

    /// 加载 Lua 脚本
    async fn load_scripts() -> Result<ScriptsCache> {
        let register_node = include_str!("../../scripts/lua/register_node_v2.lua").to_string();
        // complete_task.lua 已删除（complete_task() 调用已废弃）

        Ok(ScriptsCache {
            register_node,
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

    /// 节点注册（有向语言对版本）
    pub async fn register_node(&self, req: RegisterNodeRequest) -> Result<()> {
        debug!(node_id = %req.node_id, "节点注册");

        self.eval_script::<String>(
            &self.scripts.register_node,
            &[],
            &[
                &req.node_id,
                &req.asr_langs_json,
                &req.semantic_langs_json,
                &req.tts_langs_json,
            ],
        )
        .await?;

        info!(node_id = %req.node_id, "节点注册成功");
        Ok(())
    }

    /// 更新节点语言能力（心跳时写入，供池分配使用）
    pub async fn update_node_languages(
        &self,
        node_id: &str,
        asr_langs_json: &str,
        semantic_langs_json: &str,
        tts_langs_json: &str,
    ) -> Result<()> {
        let key = format!("lingua:v1:node:{}", node_id);
        self.redis
            .hset_multi(
                &key,
                &[
                    ("asr_langs", asr_langs_json),
                    ("semantic_langs", semantic_langs_json),
                    ("tts_langs", tts_langs_json),
                ],
            )
            .await
            .map_err(Into::into)
    }

    /// 读取节点当前语言能力（用于心跳时判断是否需重分配池）
    pub async fn get_node_languages(&self, node_id: &str) -> Result<Option<(String, String)>> {
        let key = format!("lingua:v1:node:{}", node_id);
        let hash = self.redis.hgetall(&key).await.map_err(anyhow::Error::from)?;
        let asr = hash.get("asr_langs").cloned();
        let semantic = hash.get("semantic_langs").cloned();
        Ok(match (asr, semantic) {
            (Some(a), Some(s)) => Some((a, s)),
            _ => None,
        })
    }

    // heartbeat() 方法已删除（已由 PoolService.heartbeat() 接管）
    
    // dispatch_task 方法已删除
    // 实际使用 PoolService.select_node() 进行节点选择
    
    /*
    已删除的方法：
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
        ...
    }
    */

    // complete_task() 方法已删除（complete_task.lua 是空实现，无需调用）

}

#[cfg(test)]
mod tests {
    use super::*;

    // 测试需要 Redis 连接，这里只做结构测试
    #[test]
    fn test_request_serialization() {
        let req = RegisterNodeRequest {
            node_id: "node-1".to_string(),
            asr_langs_json: r#"["zh","en","de"]"#.to_string(),
            semantic_langs_json: r#"["zh","en"]"#.to_string(),
            tts_langs_json: r#"["zh","en","ja"]"#.to_string(),
        };
        
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("node-1"));
        assert!(json.contains("asr_langs_json"));
        assert!(json.contains("semantic_langs_json"));
        assert!(json.contains("tts_langs_json"));
    }
}
