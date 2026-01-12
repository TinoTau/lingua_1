//! Pool 语言索引单元测试

#[cfg(test)]
mod tests {
    use super::super::pool_language_index::PoolLanguageIndex;
    use crate::core::config::{Phase3PoolConfig, PoolLanguageRequirements, PoolNmtRequirements};
    use crate::messages::common::LanguagePair;

    fn create_test_pool_config(
        pool_id: u16,
        name: &str,
        nmt_rule: &str,
        languages: Vec<String>,
        supported_pairs: Option<Vec<LanguagePair>>,
        semantic_langs: Option<Vec<String>>,
    ) -> Phase3PoolConfig {
        Phase3PoolConfig {
            pool_id,
            name: name.to_string(),
            required_services: vec!["ASR".to_string(), "NMT".to_string(), "TTS".to_string()],
            language_requirements: Some(PoolLanguageRequirements {
                asr_languages: None,
                tts_languages: None,
                nmt_requirements: Some(PoolNmtRequirements {
                    languages,
                    rule: nmt_rule.to_string(),
                    supported_pairs,
                    blocked_pairs: None,
                }),
                semantic_languages: semantic_langs,
            }),
        }
    }

    #[test]
    fn test_pool_language_index_new() {
        let index = PoolLanguageIndex::new();
        assert_eq!(index.stats().set_count, 0);
    }

    #[test]
    fn test_pool_language_index_specific_pairs() {
        // 简化：使用语义修复语言集合（与 Pool 命名规则一致）
        let pools = vec![
            create_test_pool_config(
                1,
                "en-zh",
                "any_to_any",
                vec!["zh".to_string(), "en".to_string()],
                None,
                Some(vec!["zh".to_string(), "en".to_string()]),
            ),
            create_test_pool_config(
                2,
                "en-ja",
                "any_to_any",
                vec!["en".to_string(), "ja".to_string()],
                None,
                Some(vec!["en".to_string(), "ja".to_string()]),
            ),
        ];

        let index = PoolLanguageIndex::rebuild_from_pools(&pools);
        
        // 测试语言集合匹配（排序后）
        let pools_zh_en = index.find_pools_for_lang_pair("zh", "en");
        assert_eq!(pools_zh_en.len(), 1);
        assert!(pools_zh_en.contains(&1));

        let pools_en_ja = index.find_pools_for_lang_pair("en", "ja");
        assert_eq!(pools_en_ja.len(), 1);
        assert!(pools_en_ja.contains(&2));

        // 测试不存在的语言对
        let pools_zh_ja = index.find_pools_for_lang_pair("zh", "ja");
        assert_eq!(pools_zh_ja.len(), 0);
    }

    #[test]
    fn test_pool_language_index_any_to_any() {
        // 简化：使用语义修复语言集合（与 Pool 命名规则一致）
        // 注意：当前实现按语言集合完全匹配，多语言 Pool 需要查找完整的语言集合
        let pools = vec![create_test_pool_config(
            1,
            "en-ja-zh",
            "any_to_any",
            vec!["zh".to_string(), "en".to_string(), "ja".to_string()],
            None,
            Some(vec!["zh".to_string(), "en".to_string(), "ja".to_string()]),
        )];

        let index = PoolLanguageIndex::rebuild_from_pools(&pools);
        
        // 测试语言集合匹配：查找包含完整语言集合的 Pool
        let lang_set = vec!["zh".to_string(), "en".to_string(), "ja".to_string()];
        let pools_for_set = index.find_pools_for_lang_set(&lang_set);
        assert_eq!(pools_for_set.len(), 1);
        assert!(pools_for_set.contains(&1));
        
        // 注意：find_pools_for_lang_pair 只匹配完全相同的语言对集合
        // 对于多语言 Pool，应该使用 find_pools_for_lang_set
    }

    #[test]
    fn test_pool_language_index_auto_mode() {
        // 简化：使用语义修复语言集合（与 Pool 命名规则一致）
        let pools = vec![
            create_test_pool_config(
                1,
                "en-zh",
                "any_to_any",
                vec!["zh".to_string(), "en".to_string()],
                None,
                Some(vec!["zh".to_string(), "en".to_string()]),
            ),
        ];

        let index = PoolLanguageIndex::rebuild_from_pools(&pools);
        
        // 测试 "auto" 模式：查找包含目标语言的 Pool
        let pools_auto_en = index.find_pools_for_lang_pair("auto", "en");
        assert_eq!(pools_auto_en.len(), 1);
        assert!(pools_auto_en.contains(&1));
    }

    #[test]
    fn test_pool_language_index_language_set() {
        let pools = vec![create_test_pool_config(
            1,
            "multi-lang-set",
            "any_to_any",
            vec!["zh".to_string(), "en".to_string()],
            None,
            Some(vec!["zh".to_string(), "en".to_string()]),
        )];

        let index = PoolLanguageIndex::rebuild_from_pools(&pools);
        
        // 测试语言集合查找
        let langs = vec!["zh".to_string(), "en".to_string()];
        let pools = index.find_pools_for_lang_set(&langs);
        assert_eq!(pools.len(), 1);
        assert!(pools.contains(&1));

        // 测试不匹配的语言集合
        let langs2 = vec!["zh".to_string(), "ja".to_string()];
        let pools2 = index.find_pools_for_lang_set(&langs2);
        assert_eq!(pools2.len(), 0);
    }

    #[test]
    fn test_pool_language_index_empty() {
        let index = PoolLanguageIndex::rebuild_from_pools(&[]);
        assert_eq!(index.stats().set_count, 0);
    }

    #[test]
    fn test_pool_language_index_case_insensitive() {
        // 简化：使用语义修复语言集合（与 Pool 命名规则一致）
        let pools = vec![create_test_pool_config(
            1,
            "en-zh",
            "any_to_any",
            vec!["zh".to_string(), "en".to_string()],
            None,
            Some(vec!["zh".to_string(), "en".to_string()]),
        )];

        let index = PoolLanguageIndex::rebuild_from_pools(&pools);
        
        // 测试大小写不敏感
        let pools1 = index.find_pools_for_lang_pair("ZH", "EN");
        let pools2 = index.find_pools_for_lang_pair("zh", "en");
        assert_eq!(pools1, pools2);
    }
}
