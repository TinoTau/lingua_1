//! Phase 3 Pool 节点分配逻辑

use std::collections::HashSet;
use std::str::FromStr;

use tracing::{info, warn};

use crate::core::config::Phase3Config;
use crate::messages::ServiceType;
use crate::node_registry::{Node, language_capability_index::LanguageCapabilityIndex};
use crate::phase2::Phase2Runtime;

/// 确定节点应该分配到哪些 Pool（自动生成模式，基于语言集合）
/// 返回匹配的 Pool ID（一个节点只属于一个 Pool，基于其语言集合）
/// 
/// 注意：节点能力信息从 Redis 读取，不占用内存
pub(super) async fn determine_pools_for_node_auto_mode_with_index(
    cfg: &Phase3Config,
    n: &Node,
    _language_index: &LanguageCapabilityIndex,
    phase2_runtime: Option<&Phase2Runtime>,
) -> Vec<u16> {
    let mut matched_pools = Vec::new();
    
    // 1. 检查节点是否在线（允许 Registering 状态的节点，分配后才会变为 Ready）
    if !n.online {
        warn!(
            node_id = %n.node_id,
            "节点不在线，跳过 Pool 分配"
        );
        return matched_pools;
    }
    
    // 2. 检查节点是否有必要的服务能力（从 Redis 读取）
    let (has_asr, has_nmt, has_tts) = if let Some(rt) = phase2_runtime {
        let has_asr = rt.has_node_capability(&n.node_id, &ServiceType::Asr).await;
        let has_nmt = rt.has_node_capability(&n.node_id, &ServiceType::Nmt).await;
        let has_tts = rt.has_node_capability(&n.node_id, &ServiceType::Tts).await;
        (has_asr, has_nmt, has_tts)
    } else {
        // 如果没有 Phase2Runtime，无法从 Redis 读取，返回 false
        warn!(
            node_id = %n.node_id,
            "未提供 Phase2Runtime，无法从 Redis 读取节点能力，跳过 Pool 分配"
        );
        return matched_pools;
    };
    
    if !has_asr || !has_nmt || !has_tts {
        warn!(
            node_id = %n.node_id,
            has_asr = has_asr,
            has_nmt = has_nmt,
            has_tts = has_tts,
            "节点缺少必要的服务能力，跳过 Pool 分配"
        );
        return matched_pools;
    }
    
    // 3. 获取节点的语义修复服务支持的语言集合
    let semantic_langs: HashSet<String> = if let Some(ref caps) = n.language_capabilities {
        caps.semantic_languages.as_ref()
            .map(|v| v.iter().cloned().collect())
            .unwrap_or_default()
    } else {
        warn!(
            node_id = %n.node_id,
            "节点没有语言能力信息，无法分配 Pool"
        );
        return matched_pools;
    };
    
    // 如果没有语义修复服务支持的语言，不分配节点（语言可用性以语义修复服务为准）
    if semantic_langs.is_empty() {
        warn!(
            node_id = %n.node_id,
            "节点没有语义修复服务支持的语言，跳过 Pool 分配（语言可用性以语义修复服务为准）"
        );
        return matched_pools;
    }
    
    // 4. 排序语言集合（用于匹配 Pool 名称）
    let mut sorted_langs: Vec<String> = semantic_langs.into_iter().collect();
    sorted_langs.sort();
    let pool_name = sorted_langs.join("-");
    
    info!(
        node_id = %n.node_id,
        semantic_languages = ?sorted_langs,
        pool_name = %pool_name,
        pools_count = cfg.pools.len(),
        existing_pool_names = ?cfg.pools.iter().map(|p| &p.name).collect::<Vec<_>>(),
        "节点语言能力检查：语义修复服务支持 {} 种语言，查找 Pool: {}",
        sorted_langs.len(),
        pool_name
    );
    
    // 5. 查找匹配的 Pool（完全匹配语言集合）
    for pool in cfg.pools.iter() {
        if pool.name == pool_name {
            info!(
                node_id = %n.node_id,
                pool_id = pool.pool_id,
                pool_name = %pool.name,
                "节点匹配到 Pool"
            );
            matched_pools.push(pool.pool_id);
            break; // 一个节点只属于一个 Pool
        }
    }
    
    if matched_pools.is_empty() {
        warn!(
            node_id = %n.node_id,
            pool_name = %pool_name,
            existing_pool_names = ?cfg.pools.iter().map(|p| &p.name).collect::<Vec<_>>(),
            "节点未匹配到任何 Pool，期望的 Pool 名称: {}",
            pool_name
        );
    }
    
    info!(
        node_id = %n.node_id,
        matched_pools_count = matched_pools.len(),
        matched_pool_ids = ?matched_pools,
        "节点匹配到 {} 个 Pool",
        matched_pools.len()
    );
    
    matched_pools
}

/// 确定节点应该分配到哪个 Pool（手动配置模式，基于服务类型）
pub(super) fn determine_pool_for_node(cfg: &Phase3Config, n: &Node) -> Option<u16> {
    if cfg.pools.is_empty() {
        return None;
    }

    // 注意：自动生成模式下的节点分配在 phase3_upsert_node_to_pool_index 中处理
    // 这里只处理手动配置模式
    // 手动配置模式：按服务类型匹配
    // 收集所有匹配 pools（按类型匹配：node.installed_services.type 覆盖 pool.required_services）
    let mut matching: Vec<(u16, usize)> = Vec::new(); // (pool_id, specificity_len)
    for p in cfg.pools.iter() {
        if p.required_services.is_empty() {
            // 通配 pool：specificity=0；仅在没有更具体匹配时才会被选中
            matching.push((p.pool_id, 0));
            continue;
        }
        let ok = p
            .required_services
            .iter()
            .filter_map(|x| ServiceType::from_str(x).ok())
            .all(|t| n.installed_services.iter().any(|s| s.r#type == t));
        if ok {
            matching.push((p.pool_id, p.required_services.len()));
        }
    }
    if matching.is_empty() {
        return None;
    }
    if matching.len() == 1 {
        return Some(matching[0].0);
    }

    // 多个 pool 都匹配：
    // - 先选"更具体"的 pool（required_services 更长），避免"能力更全的节点"被分配到更通用的 pool（有利于强隔离）
    // - 若 specificity 相同（例如两个能力相同的 pools），再用 node_id 稳定 hash 分配（避免热点倾斜）
    let max_spec = matching.iter().map(|(_, s)| *s).max().unwrap_or(0);
    let mut best: Vec<u16> = matching
        .into_iter()
        .filter(|(_, s)| *s == max_spec)
        .map(|(pid, _)| pid)
        .collect();
    if best.len() == 1 {
        return Some(best[0]);
    }
    best.sort();
    let idx = crate::phase3::pick_index_for_key(best.len(), cfg.hash_seed, &n.node_id);
    Some(best[idx])
}
