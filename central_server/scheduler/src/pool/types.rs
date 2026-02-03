//! Pool 核心类型定义

use serde::{Deserialize, Serialize};

/// 有向语言对
/// 
/// 表示一个从源语言（ASR）到目标语言（TTS + Semantic）的翻译方向
/// 
/// # 示例
/// 
/// ```
/// use lingua_scheduler::pool::types::DirectedLangPair;
/// 
/// let pair = DirectedLangPair::new("zh", "en");
/// assert_eq!(pair.to_key(), "zh:en");
/// ```
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DirectedLangPair {
    /// 源语言（ASR 识别的语言）
    pub src: String,
    /// 目标语言（TTS + Semantic 输出的语言）
    pub tgt: String,
}

#[cfg_attr(not(test), allow(dead_code))]
impl DirectedLangPair {
    /// 创建新的有向语言对
    pub fn new(src: &str, tgt: &str) -> Self {
        Self {
            src: src.to_string(),
            tgt: tgt.to_string(),
        }
    }
    
    /// 生成 Redis key 中的语言对部分
    /// 
    /// 格式: "src:tgt" (例如 "zh:en")
    pub fn to_key(&self) -> String {
        format!("{}:{}", self.src, self.tgt)
    }
}

/// 从节点能力提取所有有向语言对
///
/// # 核心规则
///
/// - ASR 语言作为源语言（src），目标语言（tgt）由**语义修复能力**决定（semantic_langs）。
/// - **池分配**使用 (asr_langs × semantic_langs)，与任务查找 (src, tgt) 一致；调度根据语义修复能力建池。
/// - 本函数通用为 (src_langs × tgt_langs)，池分配时 tgt_langs = semantic_langs。
///
/// # 示例
///
/// ```
/// use lingua_scheduler::pool::types::extract_directed_pairs;
///
/// let asr_langs = vec!["zh".to_string(), "en".to_string(), "de".to_string()];
/// let tgt_langs = vec!["zh".to_string(), "en".to_string()];  // 池分配时即 semantic_langs
///
/// let pairs = extract_directed_pairs(&asr_langs, &tgt_langs);
///
/// // 生成 6 个有向语言对：zh→zh, zh→en, en→zh, en→en, de→zh, de→en
/// assert_eq!(pairs.len(), 6);
/// ```
#[cfg_attr(not(test), allow(dead_code))]
pub fn extract_directed_pairs(
    asr_langs: &[String],
    tgt_langs: &[String],
) -> Vec<DirectedLangPair> {
    let mut pairs = Vec::new();
    for src in asr_langs {
        for tgt in tgt_langs {
            pairs.push(DirectedLangPair::new(src, tgt));
        }
    }
    pairs
}

/// Pool 大小常量（每个池最多 100 个节点）
#[cfg_attr(not(test), allow(dead_code))]
pub const POOL_SIZE: usize = 100;

/// 最大 Pool ID（防止无限循环）
#[cfg_attr(not(test), allow(dead_code))]
pub const MAX_POOL_ID: usize = 999;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_directed_lang_pair_creation() {
        let pair = DirectedLangPair::new("zh", "en");
        assert_eq!(pair.src, "zh");
        assert_eq!(pair.tgt, "en");
    }

    #[test]
    fn test_directed_lang_pair_to_key() {
        let pair = DirectedLangPair::new("zh", "en");
        assert_eq!(pair.to_key(), "zh:en");
    }

    #[test]
    fn test_extract_directed_pairs_basic() {
        let asr_langs = vec!["zh".to_string(), "en".to_string()];
        let semantic_langs = vec!["zh".to_string(), "en".to_string()];
        
        let pairs = extract_directed_pairs(&asr_langs, &semantic_langs);
        
        // 应该生成 2×2 = 4 个有向对
        assert_eq!(pairs.len(), 4);
        
        // 验证所有组合
        assert!(pairs.contains(&DirectedLangPair::new("zh", "zh")));
        assert!(pairs.contains(&DirectedLangPair::new("zh", "en")));
        assert!(pairs.contains(&DirectedLangPair::new("en", "zh")));
        assert!(pairs.contains(&DirectedLangPair::new("en", "en")));
    }

    #[test]
    fn test_extract_directed_pairs_asymmetric() {
        // 场景：节点识别中英德，但只能输出中英
        let asr_langs = vec!["zh".to_string(), "en".to_string(), "de".to_string()];
        let semantic_langs = vec!["zh".to_string(), "en".to_string()];
        
        let pairs = extract_directed_pairs(&asr_langs, &semantic_langs);
        
        // 应该生成 3×2 = 6 个有向对
        assert_eq!(pairs.len(), 6);
        
        // 验证包含 de→zh 和 de→en
        assert!(pairs.contains(&DirectedLangPair::new("de", "zh")));
        assert!(pairs.contains(&DirectedLangPair::new("de", "en")));
        
        // 验证不包含 de→de（因为 semantic 不支持 de）
        assert!(!pairs.contains(&DirectedLangPair::new("de", "de")));
    }

    #[test]
    fn test_extract_directed_pairs_empty() {
        let asr_langs: Vec<String> = vec![];
        let semantic_langs: Vec<String> = vec![];
        
        let pairs = extract_directed_pairs(&asr_langs, &semantic_langs);
        
        // 空输入应该生成 0 个对
        assert_eq!(pairs.len(), 0);
    }

    #[test]
    fn test_extract_directed_pairs_single_lang() {
        // 场景：只支持一种语言（中文→中文）
        let asr_langs = vec!["zh".to_string()];
        let semantic_langs = vec!["zh".to_string()];
        
        let pairs = extract_directed_pairs(&asr_langs, &semantic_langs);
        
        // 应该只生成 1 个对
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0], DirectedLangPair::new("zh", "zh"));
    }
}
