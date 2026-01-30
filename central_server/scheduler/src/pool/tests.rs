//! Pool 模块测试（有向语言对版本）

#[cfg(test)]
mod tests {
    use crate::pool::*;

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
        
        let pair2 = DirectedLangPair::new("en", "zh");
        assert_eq!(pair2.to_key(), "en:zh");
        
        // 有向语言对：zh:en ≠ en:zh
        assert_ne!(pair.to_key(), pair2.to_key());
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

    /// 池分配使用 (asr_langs × tts_langs)，与任务查找 (src, tgt) 一致；helper 通用为 (asr × tgt_set)。
    #[test]
    fn test_extract_directed_pairs_asr_x_tts_pool_allocation() {
        let asr_langs = vec!["zh".to_string(), "en".to_string()];
        let tts_langs = vec!["zh".to_string(), "en".to_string()];
        let pairs = extract_directed_pairs(&asr_langs, &tts_langs);
        assert_eq!(pairs.len(), 4);
        assert!(pairs.contains(&DirectedLangPair::new("zh", "en")));
        assert!(pairs.contains(&DirectedLangPair::new("en", "zh")));
    }

    #[test]
    fn test_pool_size_constants() {
        assert_eq!(POOL_SIZE, 100);
        assert_eq!(MAX_POOL_ID, 999);
    }

    #[test]
    fn test_directed_pair_equality() {
        let pair1 = DirectedLangPair::new("zh", "en");
        let pair2 = DirectedLangPair::new("zh", "en");
        let pair3 = DirectedLangPair::new("en", "zh");
        
        // 相同的有向对应该相等
        assert_eq!(pair1, pair2);
        
        // 不同的有向对应该不相等
        assert_ne!(pair1, pair3);
    }
}
