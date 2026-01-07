//! Phase 3 Pool 节点分配逻辑

use crate::core::config::Phase3Config;
use crate::messages::ServiceType;
use crate::messages::common::NmtCapability;
use crate::node_registry::{Node, language_capability_index::LanguageCapabilityIndex};
use std::collections::HashSet;
use tracing::debug;

/// 确定节点应该分配到哪些 Pool（自动生成模式，使用索引）
/// 返回所有匹配的 Pool ID（一个节点可以属于多个 Pool）
pub(super) fn determine_pools_for_node_auto_mode_with_index(
    cfg: &Phase3Config,
    n: &Node,
    _language_index: &LanguageCapabilityIndex,
) -> Vec<u16> {
    let mut matched_pools = Vec::new();
    
    // 1. 检查节点是否在线（允许 Registering 状态的节点，分配后才会变为 Ready）
    if !n.online {
        return matched_pools;
    }
    
    // 2. 检查节点是否有必要的服务能力
    let has_asr = n.capability_by_type_map.get(&ServiceType::Asr).copied().unwrap_or(false);
    let has_nmt = n.capability_by_type_map.get(&ServiceType::Nmt).copied().unwrap_or(false);
    let has_tts = n.capability_by_type_map.get(&ServiceType::Tts).copied().unwrap_or(false);
    
    if !has_asr || !has_nmt || !has_tts {
        return matched_pools;
    }
    
    // 3. 获取节点的语言能力
    let lang_caps = match n.language_capabilities.as_ref() {
        Some(caps) => caps,
        None => {
            debug!(
                node_id = %n.node_id,
                "节点没有语言能力信息，无法分配 Pool"
            );
            return matched_pools;
        }
    };
    
    // 获取 ASR、TTS、NMT、语义修复服务语言能力
    let asr_langs: HashSet<String> = lang_caps.asr_languages.as_ref()
        .map(|v| v.iter().cloned().collect())
        .unwrap_or_default();
    let tts_langs: HashSet<String> = lang_caps.tts_languages.as_ref()
        .map(|v| v.iter().cloned().collect())
        .unwrap_or_default();
    let semantic_langs: HashSet<String> = lang_caps.semantic_languages.as_ref()
        .map(|v| v.iter().cloned().collect())
        .unwrap_or_default();
    let nmt_capabilities: Vec<&NmtCapability> = lang_caps.nmt_capabilities.as_ref()
        .map(|v| v.iter().collect())
        .unwrap_or_default();
    
    // 如果没有语义修复服务支持的语言，不分配节点（语言可用性以语义修复服务为准）
    if semantic_langs.is_empty() {
        debug!(
            node_id = %n.node_id,
            asr_langs = ?asr_langs,
            tts_langs = ?tts_langs,
            nmt_capabilities_count = nmt_capabilities.len(),
            "节点没有语义修复服务支持的语言，跳过 Pool 分配（语言可用性以语义修复服务为准）"
        );
        return matched_pools;
    }
    
    debug!(
        node_id = %n.node_id,
        semantic_languages = ?semantic_langs,
        asr_languages = ?asr_langs,
        tts_languages = ?tts_langs,
        pools_count = cfg.pools.len(),
        pool_names = ?cfg.pools.iter().map(|p| &p.name).collect::<Vec<_>>(),
        "节点语言能力检查：语义修复服务支持 {} 种语言，检查 {} 个 Pool",
        semantic_langs.len(),
        cfg.pools.len()
    );
    
    // 4. 遍历所有 Pool，找到第一个匹配的
    for pool in cfg.pools.iter() {
        debug!(
            node_id = %n.node_id,
            pool_id = pool.pool_id,
            pool_name = %pool.name,
            "检查节点是否匹配 Pool {} ({})",
            pool.pool_id,
            pool.name
        );
        if let Some(_lang_req) = &pool.language_requirements {
            if pool.name.starts_with("*-") {
                // Mixed Pool: *-tgt_lang
                if let Some(tgt_lang) = pool.name.strip_prefix("*-") {
                    let tgt_lang_str = tgt_lang;
                    // 检查目标语言是否在语义修复服务支持的语言列表中
                    if !semantic_langs.contains(tgt_lang_str) {
                        debug!(
                            node_id = %n.node_id,
                            pool_id = pool.pool_id,
                            pool_name = %pool.name,
                            tgt_lang = tgt_lang_str,
                            semantic_languages = ?semantic_langs,
                            "节点不匹配混合 Pool：目标语言不在语义修复服务支持的语言列表中"
                        );
                        continue;
                    }
                    if tts_langs.contains(tgt_lang_str) {
                        // Check NMT for any_to_tgt
                        // 同时需要检查源语言是否在语义修复服务支持的语言列表中
                        let nmt_supports = nmt_capabilities.iter().any(|nmt_cap| {
                            match nmt_cap.rule.as_str() {
                                "any_to_any" => {
                                    nmt_cap.languages.iter().any(|l| l == tgt_lang_str)
                                        && !nmt_cap.blocked_pairs.as_ref().map_or(false, |bp| bp.iter().any(|p| p.tgt == tgt_lang_str))
                                        // 检查是否有源语言在语义修复服务支持的语言列表中
                                        && nmt_cap.languages.iter().any(|l| semantic_langs.contains(l) && l != tgt_lang_str)
                                }
                                "any_to_en" => {
                                    tgt_lang_str == "en" && nmt_cap.languages.iter().any(|l| l == tgt_lang_str)
                                        && !nmt_cap.blocked_pairs.as_ref().map_or(false, |bp| bp.iter().any(|p| p.tgt == "en"))
                                        // 检查是否有源语言在语义修复服务支持的语言列表中
                                        && nmt_cap.languages.iter().any(|l| semantic_langs.contains(l) && l != "en")
                                }
                                "en_to_any" => {
                                    tgt_lang_str != "en" && nmt_cap.languages.iter().any(|l| l == tgt_lang_str)
                                        && !nmt_cap.blocked_pairs.as_ref().map_or(false, |bp| bp.iter().any(|p| p.tgt == tgt_lang_str))
                                        // 检查英文是否在语义修复服务支持的语言列表中
                                        && semantic_langs.contains("en")
                                }
                                "specific_pairs" => {
                                    nmt_cap.supported_pairs.as_ref()
                                        .map(|sp| sp.iter().any(|p| {
                                            p.tgt == tgt_lang_str 
                                                && asr_langs.contains(&p.src)
                                                && semantic_langs.contains(&p.src)  // 源语言必须在语义修复服务支持的语言列表中
                                        }))
                                        .unwrap_or(false)
                                }
                                _ => false,
                            }
                        });
                        
                        if nmt_supports {
                            debug!(
                                node_id = %n.node_id,
                                pool_id = pool.pool_id,
                                pool_name = %pool.name,
                                "节点匹配到混合 Pool"
                            );
                            matched_pools.push(pool.pool_id);
                        }
                    }
                }
            } else if let Some((src, tgt)) = pool.name.split_once('-') {
                // Precise Pool: src-tgt
                let src_lang = src.to_string();
                let tgt_lang = tgt.to_string();
                // 检查源语言和目标语言是否都在语义修复服务支持的语言列表中
                if !semantic_langs.contains(&src_lang) || !semantic_langs.contains(&tgt_lang) {
                    debug!(
                        node_id = %n.node_id,
                        pool_id = pool.pool_id,
                        pool_name = %pool.name,
                        src_lang = %src_lang,
                        tgt_lang = %tgt_lang,
                        semantic_languages = ?semantic_langs,
                        "节点不匹配 Pool：源语言或目标语言不在语义修复服务支持的语言列表中"
                    );
                    continue;
                }
                if asr_langs.contains(&src_lang) && tts_langs.contains(&tgt_lang) {
                    // Check NMT for src-tgt
                    let nmt_supports = nmt_capabilities.iter().any(|nmt_cap| {
                        match nmt_cap.rule.as_str() {
                            "any_to_any" => {
                                nmt_cap.languages.contains(&src_lang) && nmt_cap.languages.contains(&tgt_lang)
                                    && !nmt_cap.blocked_pairs.as_ref().map_or(false, |bp| bp.iter().any(|p| p.src == src_lang && p.tgt == tgt_lang))
                            }
                            "any_to_en" => {
                                tgt_lang == "en" && nmt_cap.languages.contains(&src_lang)
                                    && !nmt_cap.blocked_pairs.as_ref().map_or(false, |bp| bp.iter().any(|p| p.src == src_lang && p.tgt == "en"))
                            }
                            "en_to_any" => {
                                src_lang == "en" && nmt_cap.languages.contains(&tgt_lang)
                                    && !nmt_cap.blocked_pairs.as_ref().map_or(false, |bp| bp.iter().any(|p| p.src == "en" && p.tgt == tgt_lang))
                            }
                            "specific_pairs" => {
                                nmt_cap.supported_pairs.as_ref()
                                    .map(|sp| sp.iter().any(|p| p.src == src_lang && p.tgt == tgt_lang))
                                    .unwrap_or(false)
                            }
                            _ => false,
                        }
                    });
                    
                    if nmt_supports {
                        debug!(
                            node_id = %n.node_id,
                            pool_id = pool.pool_id,
                            pool_name = %pool.name,
                            "节点匹配到精确 Pool"
                        );
                        matched_pools.push(pool.pool_id);
                    }
                }
            }
        }
    }
    
    debug!(
        node_id = %n.node_id,
        matched_pools_count = matched_pools.len(),
        matched_pool_ids = ?matched_pools,
        "节点匹配到 {} 个 Pool",
        matched_pools.len()
    );
    
    matched_pools
}
