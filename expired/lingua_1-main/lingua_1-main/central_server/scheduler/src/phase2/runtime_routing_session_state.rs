// Phase 2 Session 状态 Redis 存储（按照 NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md 规范）
// 注意：此文件通过 include! 包含到 phase2.rs 中，不需要单独的 use 语句

/// Session 状态（存储在 Redis）
/// 按照文档规范：scheduler:session:{session_id}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub preferred_pool: Option<u16>,
    pub lang_pair: Option<(String, String)>,
    pub version: i64,
    pub updated_at_ms: i64,
}

impl Phase2Runtime {
    /// Session 状态 Key（按照文档规范：scheduler:session:{session_id}）
    /// 使用 key_prefix 保持一致性，但格式符合文档规范
    fn session_state_key(&self, session_id: &str) -> String {
        // 使用 hash tag: {session:<id>} 确保同 slot
        format!("{}:session:{{session:{}}}", self.v1_prefix(), session_id)
    }

    /// 读取 Session 状态从 Redis
    /// 按照文档规范：HSET scheduler:session:{session_id}
    pub async fn get_session_state(&self, session_id: &str) -> Option<SessionState> {
        let key = self.session_state_key(session_id);
        
        // 从 Redis Hash 读取（使用 HGETALL）
        let mut cmd = redis::cmd("HGETALL");
        cmd.arg(&key);
        let result: Result<std::collections::HashMap<String, String>, _> = self.redis.query(cmd).await;

        match result {
            Ok(map) => {
                if map.is_empty() {
                    return None;
                }
                
                let preferred_pool = map.get("preferred_pool")
                    .and_then(|v| v.parse::<u16>().ok());
                
                let lang_pair = if let (Some(src), Some(tgt)) = (map.get("src_lang"), map.get("tgt_lang")) {
                    Some((src.clone(), tgt.clone()))
                } else {
                    None
                };
                
                let version = map.get("version")
                    .and_then(|v| v.parse::<i64>().ok())
                    .unwrap_or(0);
                
                let updated_at_ms = map.get("updated_at_ms")
                    .and_then(|v| v.parse::<i64>().ok())
                    .unwrap_or(chrono::Utc::now().timestamp_millis());
                
                Some(SessionState {
                    preferred_pool,
                    lang_pair,
                    version,
                    updated_at_ms,
                })
            }
            Err(e) => {
                warn!(
                    error = %e,
                    session_id = %session_id,
                    "从 Redis 读取 Session 状态失败"
                );
                None
            }
        }
    }

    /// 写入 Session 状态到 Redis
    /// 按照文档规范：HSET scheduler:session:{session_id} preferred_pool lang_pair version
    pub async fn set_session_state(
        &self,
        session_id: &str,
        preferred_pool: Option<u16>,
        lang_pair: Option<&(String, String)>,
        ttl_seconds: u64,
    ) {
        let key = self.session_state_key(session_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        
        // 获取当前版本号（如果存在），否则从 0 开始
        let current_version = self.get_session_state(session_id).await
            .map(|s| s.version)
            .unwrap_or(0);
        let new_version = current_version + 1;
        
        // 使用 Lua 脚本原子更新
        let script = r#"
local key = KEYS[1]
local preferred_pool = ARGV[1]
local src_lang = ARGV[2]
local tgt_lang = ARGV[3]
local version = ARGV[4]
local updated_at_ms = ARGV[5]
local ttl = tonumber(ARGV[6])

-- 更新 Hash 字段
if preferred_pool ~= '' then
    redis.call('HSET', key, 'preferred_pool', preferred_pool)
else
    redis.call('HDEL', key, 'preferred_pool')
end

if src_lang ~= '' and tgt_lang ~= '' then
    redis.call('HSET', key, 'src_lang', src_lang)
    redis.call('HSET', key, 'tgt_lang', tgt_lang)
else
    redis.call('HDEL', key, 'src_lang', 'tgt_lang')
end

redis.call('HSET', key, 'version', version)
redis.call('HSET', key, 'updated_at_ms', updated_at_ms)

-- 设置 TTL
redis.call('EXPIRE', key, ttl)

return 1
"#;
        
        let preferred_pool_str = preferred_pool.map(|v| v.to_string()).unwrap_or_default();
        let (src_lang, tgt_lang) = lang_pair
            .map(|(s, t)| (s.clone(), t.clone()))
            .unwrap_or_else(|| (String::new(), String::new()));
        
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(preferred_pool_str)
            .arg(src_lang)
            .arg(tgt_lang)
            .arg(new_version.to_string())
            .arg(now_ms.to_string())
            .arg(ttl_seconds.max(1));
        
        match self.redis.query::<i64>(cmd).await {
            Ok(v) if v == 1 => {
                debug!(
                    session_id = %session_id,
                    preferred_pool = ?preferred_pool,
                    lang_pair = ?lang_pair,
                    version = new_version,
                    "Session 状态已写入 Redis"
                );
            }
            Ok(_) => {
                warn!(
                    session_id = %session_id,
                    "Session 状态写入 Redis 失败（返回值异常）"
                );
            }
            Err(e) => {
                warn!(
                    error = %e,
                    session_id = %session_id,
                    "Session 状态写入 Redis 错误"
                );
            }
        }
    }

    /// 删除 Session 状态（清理）
    pub async fn delete_session_state(&self, session_id: &str) {
        let key = self.session_state_key(session_id);
        let mut cmd = redis::cmd("DEL");
        cmd.arg(&key);
        let _ = self.redis.query::<u64>(cmd).await;
        debug!(session_id = %session_id, "Session 状态已从 Redis 删除");
    }

    /// 发布 Session 状态更新事件（Pub/Sub）
    /// 按照文档规范：PUBLISH session:update
    pub async fn publish_session_update(&self, session_id: &str, preferred_pool: Option<u16>) {
        let channel = format!("{}:session:update", self.v1_prefix());
        let payload = serde_json::json!({
            "session_id": session_id,
            "preferred_pool": preferred_pool,
            "timestamp_ms": chrono::Utc::now().timestamp_millis(),
        });
        
        if let Ok(json) = serde_json::to_string(&payload) {
            let mut cmd = redis::cmd("PUBLISH");
            cmd.arg(&channel).arg(&json);
            let _ = self.redis.query::<u64>(cmd).await;
            debug!(
                session_id = %session_id,
                channel = %channel,
                "已发布 Session 状态更新事件"
            );
        }
    }
}
