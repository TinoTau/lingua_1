//! 语言能力索引
//! 
//! 负责维护节点的语言能力索引，支持快速查询支持特定语言的节点

use std::collections::{HashMap, HashSet};
use crate::messages::common::{NodeLanguageCapabilities, LanguagePair};

/// NMT 规则
#[derive(Debug, Clone)]
enum NmtRule {
    AnyToAny,
    AnyToEn,
    EnToAny,
    SpecificPairs(HashSet<LanguagePair>),
}

/// NMT 节点能力（存储规则而非展开的语言对）
#[derive(Debug, Clone)]
struct NmtNodeCapability {
    node_id: String,
    #[allow(dead_code)]  // 保留用于未来扩展（如按模型类型过滤）
    model_id: String,
    languages: HashSet<String>,
    rule: NmtRule,
    blocked_pairs: HashSet<LanguagePair>,  // P0-2: 使用 HashSet 而非 Vec
}

/// 语言能力索引
pub struct LanguageCapabilityIndex {
    /// ASR 语言索引: lang -> Set<node_id>
    by_asr_lang: HashMap<String, HashSet<String>>,
    
    /// TTS 语言索引: lang -> Set<node_id>
    by_tts_lang: HashMap<String, HashSet<String>>,
    
    /// 语义修复服务语言索引: lang -> Set<node_id>
    by_semantic_lang: HashMap<String, HashSet<String>>,
    
    /// NMT 节点能力列表（P0-1: 不展开语言对，使用规则匹配）
    nmt_nodes: Vec<NmtNodeCapability>,
}

impl LanguageCapabilityIndex {
    pub fn new() -> Self {
        Self {
            by_asr_lang: HashMap::new(),
            by_tts_lang: HashMap::new(),
            by_semantic_lang: HashMap::new(),
            nmt_nodes: Vec::new(),
        }
    }

    /// 更新节点的语言能力
    pub fn update_node_capabilities(
        &mut self,
        node_id: &str,
        capabilities: &Option<NodeLanguageCapabilities>,
    ) {
        // 先清除旧的能力信息
        self.remove_node(node_id);

        if let Some(caps) = capabilities {
            // 更新 ASR 索引
            if let Some(asr_langs) = &caps.asr_languages {
                for lang in asr_langs {
                    let normalized_lang = Self::normalize_language_code(lang);
                    if normalized_lang != "auto" {  // P1-1: auto 不进入索引
                        self.by_asr_lang
                            .entry(normalized_lang)
                            .or_insert_with(HashSet::new)
                            .insert(node_id.to_string());
                    }
                }
            }

            // 更新 TTS 索引
            if let Some(tts_langs) = &caps.tts_languages {
                for lang in tts_langs {
                    let normalized_lang = Self::normalize_language_code(lang);
                    if normalized_lang != "auto" {
                        self.by_tts_lang
                            .entry(normalized_lang)
                            .or_insert_with(HashSet::new)
                            .insert(node_id.to_string());
                    }
                }
            }

            // 更新语义修复服务语言索引
            if let Some(semantic_langs) = &caps.semantic_languages {
                for lang in semantic_langs {
                    let normalized_lang = Self::normalize_language_code(lang);
                    if normalized_lang != "auto" {
                        self.by_semantic_lang
                            .entry(normalized_lang)
                            .or_insert_with(HashSet::new)
                            .insert(node_id.to_string());
                    }
                }
            }

            // 更新 NMT 索引（P0-1: 不展开 any_to_any，存储规则）
            if let Some(nmt_caps) = &caps.nmt_capabilities {
                for nmt_cap in nmt_caps {
                    let languages: HashSet<String> = nmt_cap.languages
                        .iter()
                        .map(|l| Self::normalize_language_code(l))
                        .filter(|l| l != "auto")
                        .collect();
                    
                    // P0-2: blocked_pairs 预处理为 HashSet
                    let blocked_pairs: HashSet<LanguagePair> = nmt_cap.blocked_pairs
                        .as_ref()
                        .map(|bp| {
                            bp.iter()
                                .map(|p| LanguagePair {
                                    src: Self::normalize_language_code(&p.src),
                                    tgt: Self::normalize_language_code(&p.tgt),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    
                    let rule = match nmt_cap.rule.as_str() {
                        "any_to_any" => NmtRule::AnyToAny,
                        "any_to_en" => NmtRule::AnyToEn,
                        "en_to_any" => NmtRule::EnToAny,
                        "specific_pairs" => {
                            let pairs: HashSet<LanguagePair> = nmt_cap.supported_pairs
                                .as_ref()
                                .map(|sp| {
                                    sp.iter()
                                        .map(|p| LanguagePair {
                                            src: Self::normalize_language_code(&p.src),
                                            tgt: Self::normalize_language_code(&p.tgt),
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();
                            NmtRule::SpecificPairs(pairs)
                        }
                        _ => continue,
                    };
                    
                    self.nmt_nodes.push(NmtNodeCapability {
                        node_id: node_id.to_string(),
                        model_id: nmt_cap.model_id.clone(),
                        languages,
                        rule,
                        blocked_pairs,
                    });
                }
            }
        }
    }

    /// 移除节点的所有能力信息
    pub fn remove_node(&mut self, node_id: &str) {
        // 从 ASR 索引中移除
        self.by_asr_lang.values_mut().for_each(|nodes| {
            nodes.remove(node_id);
        });
        self.by_asr_lang.retain(|_, nodes| !nodes.is_empty());

        // 从 TTS 索引中移除
        self.by_tts_lang.values_mut().for_each(|nodes| {
            nodes.remove(node_id);
        });
        self.by_tts_lang.retain(|_, nodes| !nodes.is_empty());

        // 从语义修复服务语言索引中移除
        self.by_semantic_lang.values_mut().for_each(|nodes| {
            nodes.remove(node_id);
        });
        self.by_semantic_lang.retain(|_, nodes| !nodes.is_empty());

        // 从 NMT 节点列表中移除
        self.nmt_nodes.retain(|n| n.node_id != node_id);
    }

    /// 查找支持特定 NMT 语言对的节点（P0-1: 规则匹配而非索引查找）
    pub fn find_nodes_for_nmt_pair(
        &self,
        src_lang: &str,
        tgt_lang: &str,
    ) -> HashSet<String> {
        let normalized_src = Self::normalize_language_code(src_lang);
        let normalized_tgt = Self::normalize_language_code(tgt_lang);
        
        if normalized_src == "auto" || normalized_tgt == "auto" {
            return HashSet::new();
        }
        
        let mut result = HashSet::new();
        
        for nmt_node in &self.nmt_nodes {
            // P0-2: O(1) 判断 blocked_pairs
            let pair = LanguagePair {
                src: normalized_src.clone(),
                tgt: normalized_tgt.clone(),
            };
            if nmt_node.blocked_pairs.contains(&pair) {
                continue;
            }
            
            let matches = match &nmt_node.rule {
                NmtRule::AnyToAny => {
                    // 任意语言到任意语言：检查两个语言都在支持列表中
                    nmt_node.languages.contains(&normalized_src) 
                        && nmt_node.languages.contains(&normalized_tgt)
                }
                NmtRule::AnyToEn => {
                    // 任意语言到英文：源语言在列表中，目标语言是 en
                    nmt_node.languages.contains(&normalized_src) 
                        && normalized_tgt == "en"
                }
                NmtRule::EnToAny => {
                    // 英文到任意语言：源语言是 en，目标语言在列表中
                    normalized_src == "en" 
                        && nmt_node.languages.contains(&normalized_tgt)
                }
                NmtRule::SpecificPairs(pairs) => {
                    // 明确支持的语言对：直接查找
                    pairs.contains(&pair)
                }
            };
            
            if matches {
                result.insert(nmt_node.node_id.clone());
            }
        }
        
        result
    }

    /// 查找支持特定 ASR 语言的节点
    pub fn find_nodes_for_asr_lang(&self, lang: &str) -> HashSet<String> {
        let normalized_lang = Self::normalize_language_code(lang);
        if normalized_lang == "auto" {
            return HashSet::new();
        }
        self.by_asr_lang
            .get(&normalized_lang)
            .cloned()
            .unwrap_or_default()
    }

    /// 查找支持特定 TTS 语言的节点
    pub fn find_nodes_for_tts_lang(&self, lang: &str) -> HashSet<String> {
        let normalized_lang = Self::normalize_language_code(lang);
        if normalized_lang == "auto" {
            return HashSet::new();
        }
        self.by_tts_lang
            .get(&normalized_lang)
            .cloned()
            .unwrap_or_default()
    }

    /// 查找有 READY ASR 的节点（用于 src_lang = auto 场景）
    pub fn find_nodes_with_ready_asr(&self) -> HashSet<String> {
        let mut result = HashSet::new();
        for nodes in self.by_asr_lang.values() {
            result.extend(nodes.iter().cloned());
        }
        result
    }

    /// 获取节点的 ASR 语言覆盖度（用于排序）
    pub fn get_asr_language_coverage(&self, node_id: &str) -> usize {
        self.by_asr_lang
            .values()
            .filter(|nodes| nodes.contains(node_id))
            .count()
    }

    /// 获取节点支持的所有语义修复服务语言
    pub fn get_node_semantic_languages(&self, node_id: &str) -> HashSet<String> {
        self.by_semantic_lang
            .iter()
            .filter(|(_, nodes)| nodes.contains(node_id))
            .map(|(lang, _)| lang.clone())
            .collect()
    }

    // 已删除未使用的函数：
    // - get_node_asr_languages: 未被使用
    // - get_node_tts_languages: 未被使用
    // - get_node_nmt_capabilities: 未被使用

    /// 语言代码规范化（P1-1: 统一大小写、处理别名）
    fn normalize_language_code(lang: &str) -> String {
        let normalized = lang.to_lowercase();
        
        // 处理语言代码变体
        match normalized.as_str() {
            "zh-cn" | "zh-tw" | "zh-hans" | "zh-hant" => "zh".to_string(),
            "pt-br" | "pt-pt" => "pt".to_string(),
            "en-us" | "en-gb" => "en".to_string(),
            "in" => "id".to_string(),  // 印尼语旧代码
            "iw" => "he".to_string(),  // 希伯来语旧代码
            _ => normalized,
        }
    }
}

// 已删除未使用的结构体：NmtNodeCapabilityInfo
// 此结构体只在已删除的 get_node_nmt_capabilities 函数中使用

impl Default for LanguageCapabilityIndex {
    fn default() -> Self {
        Self::new()
    }
}
