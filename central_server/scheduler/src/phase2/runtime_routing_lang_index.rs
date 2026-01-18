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

}
