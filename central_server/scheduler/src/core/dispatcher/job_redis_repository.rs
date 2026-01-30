//! Redis Job 仓储
//! 
//! 封装所有 Job 相关的 Redis 操作（SSOT）

use crate::core::dispatcher::{Job, JobStatus};
use crate::redis_runtime::RedisHandle;
use anyhow::{anyhow, Result};
use std::sync::Arc;
use tracing::debug;

/// Redis Key 前缀
const KEY_PREFIX: &str = "lingua:v1";

/// Job 数据 TTL（秒）- 1小时
const JOB_TTL_SECS: i64 = 3600;

/// Redis Job 仓储（无状态，SSOT）
#[derive(Clone)]
pub struct JobRedisRepository {
    redis: Arc<RedisHandle>,
}

impl JobRedisRepository {
    /// 创建新的仓储实例
    pub fn new(redis: Arc<RedisHandle>) -> Self {
        Self { redis }
    }
    
    /// 构造 Job key
    fn job_key(job_id: &str) -> String {
        format!("{}:job:{}", KEY_PREFIX, job_id)
    }
    
    /// 保存 Job 到 Redis（使用 Hash 格式）
    /// 
    /// 根据 LUA_SCRIPTS_PATCHSET.md 的决策，Job 使用 Hash 存储
    /// - 关键字段存储在 Hash 中（Lua 脚本可直接操作）
    /// - 完整 JSON 存储在 _json 字段中（用于完整数据读取）
    pub async fn save_job(&self, job: &Job) -> Result<()> {
        let key = Self::job_key(&job.job_id);
        
        // 序列化 Job 为 JSON（用于完整数据存储）
        let job_json = serde_json::to_string(job)
            .map_err(|e| anyhow!("序列化 Job 失败: {}", e))?;
        
        // 使用 Lua 脚本原子性地设置所有 Hash 字段
        // 这样可以确保所有字段在同一事务中设置
        let script = r#"
local key = KEYS[1]
local json = ARGV[1]
local dispatched_to_node = ARGV[2]
local dispatched_at_ms = ARGV[3]
local dispatch_attempt_id = ARGV[4]
local assigned_node_id = ARGV[5]

-- 设置关键字段（Lua 脚本需要操作的字段）
redis.call('HSET', key, 'dispatched_to_node', dispatched_to_node)
if dispatched_at_ms ~= '' then
    redis.call('HSET', key, 'dispatched_at_ms', dispatched_at_ms)
end
redis.call('HSET', key, 'dispatch_attempt_id', dispatch_attempt_id)
if assigned_node_id ~= '' then
    redis.call('HSET', key, 'assigned_node_id', assigned_node_id)
end

-- 存储完整 JSON（用于完整数据读取）
redis.call('HSET', key, '_json', json)

-- 设置 TTL
redis.call('EXPIRE', key, ARGV[6])

return 1
"#;
        
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(&job_json)
            .arg(if job.dispatched_to_node { "true" } else { "false" })
            .arg(job.dispatched_at_ms.map(|v| v.to_string()).unwrap_or_else(|| "".to_string()))
            .arg(job.dispatch_attempt_id.to_string())
            .arg(job.assigned_node_id.as_deref().unwrap_or(""))
            .arg(JOB_TTL_SECS);
        
        self.redis.query::<i64>(cmd).await
            .map_err(|e| anyhow!("Redis EVAL 保存 Job 失败: {}", e))?;
        
        debug!(job_id = %job.job_id, "Job 已保存到 Redis (Hash格式)");
        Ok(())
    }
    
    /// 获取 Job（从 Hash 格式读取）
    pub async fn get_job(&self, job_id: &str) -> Result<Option<Job>> {
        let key = Self::job_key(job_id);
        
        // 检查 key 是否存在
        let exists: bool = self.redis.exists(&key).await
            .map_err(|e| anyhow!("Redis EXISTS 失败: {}", e))?;
        if !exists {
            debug!(job_id = %job_id, "Job 不存在");
            return Ok(None);
        }
        
        // 优先尝试从 _json 字段读取（完整数据）
        let mut cmd = redis::cmd("HGET");
        cmd.arg(&key).arg("_json");
        let job_json: Option<String> = self.redis.query(cmd).await
            .map_err(|e| anyhow!("Redis HGET 失败: {}", e))?;
        
        if let Some(json) = job_json {
            // 从 JSON 反序列化（完整数据）
            match serde_json::from_str::<Job>(&json) {
                Ok(job) => return Ok(Some(job)),
                Err(e) => {
                    // JSON 解析失败，尝试从 Hash 字段重建
                    debug!(job_id = %job_id, error = %e, "从 _json 字段解析失败，尝试从 Hash 字段重建");
                }
            }
        }
        
        // 从 Hash 字段重建 Job（兼容旧数据或 _json 缺失的情况）
        let hash: std::collections::HashMap<String, String> = self.redis.hgetall(&key).await
            .map_err(|e| anyhow!("Redis HGETALL 失败: {}", e))?;
        
        if hash.is_empty() {
            return Ok(None);
        }
        
        // 从 Hash 字段重建 Job
        // 注意：这是一个简化版本，只读取关键字段
        // 完整字段应该从 _json 读取
        let job = self.reconstruct_job_from_hash(&hash, job_id)?;
        Ok(Some(job))
    }
    
    /// 从 Hash 字段重建 Job（用于兼容）
    fn reconstruct_job_from_hash(&self, hash: &std::collections::HashMap<String, String>, job_id: &str) -> Result<Job> {
        // 如果 _json 存在，优先使用 JSON（完整数据）
        if let Some(json) = hash.get("_json") {
            if let Ok(job) = serde_json::from_str::<Job>(json) {
                return Ok(job);
            }
        }
        
        // 否则从 Hash 字段重建（需要所有字段都在Hash中）
        // 注意：当前实现依赖 _json 字段，未来应该完全迁移到 Hash 字段
        Err(anyhow!("无法从 Hash 重建完整 Job，缺少 _json 字段。job_id: {}", job_id))
    }
    
    /// 执行 Lua 脚本（用于原子性操作）
    async fn eval_lua_script<T: redis::FromRedisValue>(
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
            .map_err(|e| anyhow!("执行 Lua 脚本失败: {}", e))?;
        
        T::from_redis_value(&result)
            .map_err(|e| anyhow!("解析 Lua 脚本返回值失败: {}", e))
    }
    
    /// 原子性标记任务已派发（使用 Lua 脚本）
    /// 返回: 0=NotFound, 1=AlreadyDispatched, 2=Updated
    pub async fn mark_job_dispatched_atomic(&self, job_id: &str, now_ms: i64, ttl_seconds: u64) -> Result<i64> {
        let script = include_str!("../../../scripts/lua/mark_job_dispatched.lua");
        let key = Self::job_key(job_id);
        
        self.eval_lua_script::<i64>(
            script,
            &[&key],
            &[&now_ms.to_string(), &ttl_seconds.to_string()],
        ).await
    }
    
    /// 原子性重派任务（failover，使用 Lua 脚本）
    /// 返回: 0=NotFound, -1=StaleCaller, >=1=NewAttemptId
    pub async fn failover_reassign_job_atomic(
        &self,
        job_id: &str,
        new_node_id: &str,
        expected_attempt_id: u32,
        ttl_seconds: u64,
    ) -> Result<i64> {
        let script = include_str!("../../../scripts/lua/failover_reassign_job.lua");
        let key = Self::job_key(job_id);
        
        self.eval_lua_script::<i64>(
            script,
            &[&key],
            &[
                new_node_id,
                &expected_attempt_id.to_string(),
                &ttl_seconds.to_string(),
            ],
        ).await
    }
    
    /// 更新 Job 状态
    pub async fn update_job_status(&self, job_id: &str, status: JobStatus) -> Result<()> {
        // 获取当前 Job
        let mut job = match self.get_job(job_id).await? {
            Some(j) => j,
            None => return Err(anyhow!("Job 不存在: {}", job_id)),
        };
        
        // 更新状态
        job.status = status;
        
        // 保存回 Redis
        self.save_job(&job).await
    }
    
    /// 更新 Job 状态（使用已有Job对象，避免重复查询）
    pub async fn update_job_status_with_job(&self, job: &mut Job, status: JobStatus) -> Result<()> {
        // 更新状态
        job.status = status;
        
        // 保存回 Redis
        self.save_job(job).await
    }
    
    // update_job_field 已删除（不需要，直接使用save_job）
    
    /// 列出所有 Job（用于超时检查）
    /// 返回 (job_id, status, dispatched_at_ms) 元组列表
    /// 
    /// 优化：使用SCAN替代KEYS（非阻塞，生产环境必需）
    pub async fn list_jobs_for_timeout_check(&self) -> Result<Vec<(String, JobStatus, Option<i64>)>> {
        // 使用 SCAN 查找所有 Job key（非阻塞）
        let pattern = format!("{}:job:*", KEY_PREFIX);
        let mut keys = Vec::new();
        let mut cursor = 0u64;
        
        loop {
            let mut cmd = redis::cmd("SCAN");
            cmd.arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(100); // 每批100个key
            
            let result: (u64, Vec<String>) = self.redis.query(cmd).await
                .map_err(|e| anyhow!("Redis SCAN 失败: {}", e))?;
            
            cursor = result.0;
            keys.extend(result.1);
            
            // cursor为0表示扫描完成
            if cursor == 0 {
                break;
            }
        }
        
        let mut jobs = Vec::new();
        for key in keys {
            // 从 Hash 的 _json 字段读取（完整数据）
            let mut cmd = redis::cmd("HGET");
            cmd.arg(&key).arg("_json");
            let job_json: Option<String> = self.redis.query(cmd).await
                .map_err(|e| anyhow!("Redis HGET 失败: {}", e))?;
            
            if let Some(json) = job_json {
                // 使用serde_json快速解析status和dispatched_at_ms
                if let Ok(job) = serde_json::from_str::<Job>(&json) {
                    jobs.push((
                        job.job_id,
                        job.status,
                        job.dispatched_at_ms,
                    ));
                }
            }
        }
        
        Ok(jobs)
    }
    
    /// 列出所有 Job（完整对象，用于超时检查）
    /// 
    /// 优化：使用SCAN替代KEYS（非阻塞，生产环境必需）
    pub async fn list_all_jobs(&self) -> Result<Vec<Job>> {
        // 使用 SCAN 查找所有 Job key（非阻塞）
        let pattern = format!("{}:job:*", KEY_PREFIX);
        let mut keys = Vec::new();
        let mut cursor = 0u64;
        
        loop {
            let mut cmd = redis::cmd("SCAN");
            cmd.arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(100); // 每批100个key
            
            let result: (u64, Vec<String>) = self.redis.query(cmd).await
                .map_err(|e| anyhow!("Redis SCAN 失败: {}", e))?;
            
            cursor = result.0;
            keys.extend(result.1);
            
            // cursor为0表示扫描完成
            if cursor == 0 {
                break;
            }
        }
        
        let mut jobs = Vec::new();
        for key in keys {
            // 提取 job_id
            let job_id = key.strip_prefix(&format!("{}:job:", KEY_PREFIX))
                .ok_or_else(|| anyhow!("无效的 Job key: {}", key))?;
            
            // 获取完整 Job
            if let Some(job) = self.get_job(job_id).await? {
                jobs.push(job);
            }
        }
        
        Ok(jobs)
    }
    
    /// 删除 Job
    pub async fn delete_job(&self, job_id: &str) -> Result<()> {
        let key = Self::job_key(job_id);
        self.redis.del(&key).await
            .map_err(|e| anyhow!("Redis DEL 失败: {}", e))?;
        debug!(job_id = %job_id, "Job 已从 Redis 删除");
        Ok(())
    }
}
