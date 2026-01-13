// Phase 2 语言索引 Redis 存储（按照 NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md 规范）
// 注意：此文件通过 include! 包含到 phase2.rs 中，不需要单独的 use 语句

/// 语言索引（存储在 Redis）
/// 按照文档规范：scheduler:lang:{src}:{tgt}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LangIndexEntry {
    pub pools: Vec<u16>,
    pub version: i64,
    pub updated_at_ms: i64,
}

impl Phase2Runtime {
    /// 语言索引 Key（按照文档规范：scheduler:lang:{src}:{tgt}）
    /// 使用 key_prefix 保持一致性，但格式符合文档规范
    fn lang_index_key(&self, src_lang: &str, tgt_lang: &str) -> String {
        // 使用 hash tag: {lang:<pair>} 确保同 slot
        let lang_pair = format!("{}:{}", src_lang, tgt_lang);
        format!("{}:lang:{{lang:{}}}", self.v1_prefix(), lang_pair)
    }

    /// 读取语言索引从 Redis
    /// 按照文档规范：HSET scheduler:lang:{src}:{tgt} pools version
    pub async fn get_lang_index(&self, src_lang: &str, tgt_lang: &str) -> Option<LangIndexEntry> {
        let key = self.lang_index_key(src_lang, tgt_lang);
        
        // 从 Redis Hash 读取（使用 HGETALL）
        let mut cmd = redis::cmd("HGETALL");
        cmd.arg(&key);
        let result: Result<std::collections::HashMap<String, String>, _> = self.redis.query(cmd).await;

        match result {
            Ok(map) => {
                if map.is_empty() {
                    return None;
                }
                
                let pools_json = map.get("pools").cloned().unwrap_or_else(|| "[]".to_string());
                let pools: Vec<u16> = serde_json::from_str(&pools_json)
                    .unwrap_or_default();
                
                let version = map.get("version")
                    .and_then(|v| v.parse::<i64>().ok())
                    .unwrap_or(0);
                
                let updated_at_ms = map.get("updated_at_ms")
                    .and_then(|v| v.parse::<i64>().ok())
                    .unwrap_or(chrono::Utc::now().timestamp_millis());
                
                Some(LangIndexEntry {
                    pools,
                    version,
                    updated_at_ms,
                })
            }
            Err(e) => {
                warn!(
                    error = %e,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "从 Redis 读取语言索引失败"
                );
                None
            }
        }
    }

    /// 写入语言索引到 Redis
    /// 按照文档规范：HSET scheduler:lang:{src}:{tgt} pools version
    pub async fn set_lang_index(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        pools: &[u16],
        ttl_seconds: u64,
    ) {
        let key = self.lang_index_key(src_lang, tgt_lang);
        let now_ms = chrono::Utc::now().timestamp_millis();
        
        // 获取当前版本号（如果存在），否则从 0 开始
        let current_version = self.get_lang_index(src_lang, tgt_lang).await
            .map(|e| e.version)
            .unwrap_or(0);
        let new_version = current_version + 1;
        
        // 序列化 pools
        let pools_json = match serde_json::to_string(pools) {
            Ok(json) => json,
            Err(e) => {
                warn!(
                    error = %e,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "语言索引 pools 序列化失败"
                );
                return;
            }
        };
        
        // 使用 Lua 脚本原子更新
        let script = r#"
local key = KEYS[1]
local pools_json = ARGV[1]
local version = ARGV[2]
local updated_at_ms = ARGV[3]
local ttl = tonumber(ARGV[4])

-- 更新 Hash 字段
redis.call('HSET', key, 'pools', pools_json)
redis.call('HSET', key, 'version', version)
redis.call('HSET', key, 'updated_at_ms', updated_at_ms)

-- 设置 TTL
redis.call('EXPIRE', key, ttl)

return 1
"#;
        
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script)
            .arg(1)
            .arg(&key)
            .arg(pools_json)
            .arg(new_version.to_string())
            .arg(now_ms.to_string())
            .arg(ttl_seconds.max(1));
        
        match self.redis.query::<i64>(cmd).await {
            Ok(v) if v == 1 => {
                debug!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    pool_count = pools.len(),
                    pools = ?pools,
                    version = new_version,
                    "语言索引已写入 Redis"
                );
            }
            Ok(_) => {
                warn!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "语言索引写入 Redis 失败（返回值异常）"
                );
            }
            Err(e) => {
                warn!(
                    error = %e,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "语言索引写入 Redis 错误"
                );
            }
        }
    }

    /// 批量读取语言索引（用于冷启动预加载）
    /// 注意：由于使用 hash tag，需要从 Phase3PoolConfig 获取所有语言对
    pub async fn get_all_lang_indices_from_pools(
        &self,
        pools: &[(String, Vec<String>)], // (pool_name, language_pairs)
    ) -> std::collections::HashMap<(String, String), LangIndexEntry> {
        let mut result = std::collections::HashMap::new();
        let mut lang_pair_to_pools: std::collections::HashMap<(String, String), Vec<u16>> = std::collections::HashMap::new();
        
        // 从 Pool 配置中收集所有语言对
        for (_pool_name, lang_pairs) in pools {
            // 从 pool_name 中提取 pool_id（例如 "zh-en" -> 需要查找 pool_id）
            // 这里简化处理，实际应该从 Phase3PoolConfig 获取 pool_id
            // 暂时跳过 pool_id 映射，直接使用语言对
            for lang_pair_str in lang_pairs {
                let parts: Vec<&str> = lang_pair_str.split(':').collect();
                if parts.len() == 2 {
                    let src_lang = parts[0].to_string();
                    let tgt_lang = parts[1].to_string();
                    lang_pair_to_pools.entry((src_lang, tgt_lang))
                        .or_insert_with(Vec::new);
                    // 注意：这里无法获取 pool_id，需要从外部传入
                }
            }
        }
        
        // 从 Redis 读取每个语言对的索引
        for ((src_lang, tgt_lang), _) in &lang_pair_to_pools {
            if let Some(entry) = self.get_lang_index(src_lang, tgt_lang).await {
                result.insert((src_lang.clone(), tgt_lang.clone()), entry);
            }
        }
        
        debug!(
            lang_index_count = result.len(),
            "已加载所有语言索引（从 Pool 配置）"
        );
        result
    }

    /// 删除语言索引（清理）
    pub async fn delete_lang_index(&self, src_lang: &str, tgt_lang: &str) {
        let key = self.lang_index_key(src_lang, tgt_lang);
        let mut cmd = redis::cmd("DEL");
        cmd.arg(&key);
        let _ = self.redis.query::<u64>(cmd).await;
        debug!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            "语言索引已从 Redis 删除"
        );
    }

    /// 发布语言索引更新事件（Pub/Sub）
    /// 按照文档规范：PUBLISH lang:update
    pub async fn publish_lang_index_update(&self, src_lang: &str, tgt_lang: &str, pools: &[u16]) {
        let channel = format!("{}:lang:update", self.v1_prefix());
        let payload = serde_json::json!({
            "src_lang": src_lang,
            "tgt_lang": tgt_lang,
            "pools": pools,
            "timestamp_ms": chrono::Utc::now().timestamp_millis(),
        });
        
        if let Ok(json) = serde_json::to_string(&payload) {
            let mut cmd = redis::cmd("PUBLISH");
            cmd.arg(&channel).arg(&json);
            let _ = self.redis.query::<u64>(cmd).await;
            debug!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                channel = %channel,
                pool_count = pools.len(),
                "已发布语言索引更新事件"
            );
        }
    }
}
