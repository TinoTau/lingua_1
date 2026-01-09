//! Pool 语言索引
//! 
//! 用于快速查找支持特定语言对的 Pool，避免 O(N) 遍历

use crate::core::config::Phase3PoolConfig;
use std::collections::HashMap;
use tracing::{debug, info};

/// Pool 语言索引
/// 用于 O(1) 查找支持特定语言对的 Pool
/// 简化设计：直接按排序后的语言集合索引（与 Pool 命名规则一致）
#[derive(Debug, Clone)]
pub struct PoolLanguageIndex {
    /// 语言集合索引：sorted_langs -> Vec<pool_id>
    /// 用于查找包含特定语言集合的 Pool（如 "en-zh"，排序后的语言集合）
    /// 与 Pool 命名规则一致：语言集合按字母顺序排序后用 `-` 连接
    by_language_set: HashMap<String, Vec<u16>>,
}

impl PoolLanguageIndex {
    /// 创建新的 Pool 语言索引
    pub fn new() -> Self {
        Self {
            by_language_set: HashMap::new(),
        }
    }

    /// 从 Pool 配置重建索引
    pub fn rebuild_from_pools(pools: &[Phase3PoolConfig]) -> Self {
        let start = std::time::Instant::now();
        let mut index = Self::new();
        
        for pool in pools {
            index.add_pool(pool);
        }
        
        let elapsed = start.elapsed();
        info!(
            pool_count = pools.len(),
            set_index_size = index.by_language_set.len(),
            elapsed_ms = elapsed.as_millis(),
            "Pool 语言索引重建完成"
        );
        
        // 调试：输出索引内容
        if !index.by_language_set.is_empty() {
            debug!(
                language_sets = ?index.by_language_set.keys().collect::<Vec<_>>(),
                "语言集合索引内容"
            );
        }
        
        index
    }

    /// 添加 Pool 到索引
    /// 简化：直接按排序后的语言集合索引（与 Pool 命名规则一致）
    fn add_pool(&mut self, pool: &Phase3PoolConfig) {
        // 获取语言集合（优先使用 semantic_languages，否则使用 nmt_requirements.languages）
        let mut langs: Vec<String> = if let Some(ref lang_req) = pool.language_requirements {
            if let Some(ref semantic_langs) = lang_req.semantic_languages {
                semantic_langs.clone()
            } else if let Some(ref nmt_req) = lang_req.nmt_requirements {
                nmt_req.languages.clone()
            } else {
                return;
            }
        } else {
            return;
        };
        
        // 排序语言集合（与 Pool 命名规则一致）
        langs.sort();
        let key = langs.join("-");
        
        // 只索引到语言集合索引
        self.by_language_set
            .entry(key)
            .or_insert_with(Vec::new)
            .push(pool.pool_id);
    }

    /// 查找支持特定语言对的 Pool IDs
    /// 简化：直接按排序后的语言集合查找（与 Pool 命名规则一致）
    pub fn find_pools_for_lang_pair(&self, src_lang: &str, tgt_lang: &str) -> Vec<u16> {
        let start = std::time::Instant::now();
        let normalized_src = normalize_lang(src_lang);
        let normalized_tgt = normalize_lang(tgt_lang);

        // 如果是 "auto"，查找包含目标语言的 Pool（查找所有包含该语言的集合）
        if normalized_src == "auto" {
            let mut result = Vec::new();
            for (set_key, pools) in &self.by_language_set {
                if set_key.contains(&normalized_tgt) {
                    result.extend_from_slice(pools);
                }
            }
            let elapsed = start.elapsed();
            debug!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                found_pools = result.len(),
                elapsed_us = elapsed.as_micros(),
                "查找语言对 Pool（auto模式）"
            );
            return result;
        }

        // 直接按排序后的语言集合查找
        let mut langs = vec![normalized_src.clone(), normalized_tgt.clone()];
        langs.sort();
        let set_key = langs.join("-");
        
        let result = self.by_language_set
            .get(&set_key)
            .cloned()
            .unwrap_or_default();
        
        let elapsed = start.elapsed();
        if result.is_empty() {
            debug!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                set_key = %set_key,
                available_sets = ?self.by_language_set.keys().collect::<Vec<_>>(),
                elapsed_us = elapsed.as_micros(),
                "未找到匹配的语言集合 Pool"
            );
        } else {
            debug!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                set_key = %set_key,
                found_pools = result.len(),
                pool_ids = ?result,
                elapsed_us = elapsed.as_micros(),
                "查找语言对 Pool（语言集合匹配）"
            );
        }
        
        result
    }

    /// 查找支持语言集合的 Pool IDs
    pub fn find_pools_for_lang_set(&self, langs: &[String]) -> Vec<u16> {
        if langs.is_empty() {
            return Vec::new();
        }

        let mut sorted = langs.to_vec();
        sorted.sort();
        let key = sorted.join("-");

        self.by_language_set
            .get(&key)
            .cloned()
            .unwrap_or_default()
    }

    /// 获取所有索引的统计信息（用于调试）
    #[allow(dead_code)] // 目前未使用，保留用于调试和监控
    pub fn stats(&self) -> PoolLanguageIndexStats {
        PoolLanguageIndexStats {
            set_count: self.by_language_set.len(),
        }
    }
}

/// 索引统计信息
#[derive(Debug, Clone)]
#[allow(dead_code)] // 目前未使用，保留用于调试和监控
pub struct PoolLanguageIndexStats {
    pub set_count: usize,
}

/// 规范化语言代码
fn normalize_lang(lang: &str) -> String {
    lang.to_lowercase().trim().to_string()
}

impl Default for PoolLanguageIndex {
    fn default() -> Self {
        Self::new()
    }
}
