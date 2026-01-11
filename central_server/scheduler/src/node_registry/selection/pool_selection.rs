use std::str::FromStr;
use std::sync::Arc;

use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};
use tracing::warn;

use super::selection_breakdown::Phase3TwoLevelDebug;
use crate::core::config::Phase3Config;
use crate::node_registry::PoolLanguageIndex;

/// 选择候选 pools（按类型或语言对）
/// 
/// 返回：(all_pools, preferred_pool, pools)
/// - all_pools: 所有可用的 pool IDs
/// - preferred_pool: 首选 pool ID
/// - pools: 按优先级排序的 pool IDs（用于 fallback）
/// 
/// 使用 PoolLanguageIndex 进行 O(1) 查找
pub(super) fn select_eligible_pools(
    cfg: &Phase3Config,
    routing_key: &str,
    src_lang: &str,
    tgt_lang: &str,
    required_types: &[crate::messages::ServiceType],
    core_services: Option<&crate::core::config::CoreServicesConfig>,
    lang_index: &Arc<PoolLanguageIndex>,
) -> Result<(Vec<u16>, u16, Vec<u16>), Phase3TwoLevelDebug> {
    let using_capability_pools = !cfg.pools.is_empty();

    fn canonicalize_set<T: Ord + std::fmt::Debug + Clone>(mut v: Vec<T>) -> Vec<T> {
        v.sort();
        v.dedup();
        v
    }

    // 选择"候选 pools"（按类型或语言对）
    // - 兼容模式：cfg.pools 为空 -> 继续用 hash 分桶（0..pool_count）
    // - 强隔离：cfg.pools 非空 -> pool_id 来自配置（按能力分配节点）
    // - 自动生成模式：根据语言对直接选择 Pool
    tracing::info!(
        src_lang = %src_lang,
        tgt_lang = %tgt_lang,
        routing_key = %routing_key,
        phase3_enabled = cfg.enabled,
        phase3_mode = %cfg.mode,
        auto_generate_language_pools = cfg.auto_generate_language_pools,
        using_capability_pools = using_capability_pools,
        pool_count = cfg.pools.len(),
        "Pool 选择: 开始选择候选 pools（pool_selection.rs）"
    );
    if cfg.enabled && cfg.mode == "two_level" {
        if cfg.auto_generate_language_pools && using_capability_pools {
            // 自动生成模式：根据语言对直接选择 Pool
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                "Pool 选择: 自动生成模式，根据语言对选择 Pool（pool_selection.rs）"
            );
            if src_lang == "auto" {
                // 未知源语言：使用混合池（多对一 Pool）
                tracing::info!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "Pool 选择: 源语言为 auto，使用混合池（多对一）支持目标语言（pool_selection.rs）"
                );
                // 使用 PoolLanguageIndex（O(1) 查找）
                let lang_index_lookup_start = std::time::Instant::now();
                let eligible_pools: Vec<u16> = lang_index.find_pools_for_lang_set(&[tgt_lang.to_string()]);
                let lang_index_lookup_elapsed = lang_index_lookup_start.elapsed();
                tracing::info!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    eligible_pool_count = eligible_pools.len(),
                    eligible_pool_ids = ?eligible_pools,
                    elapsed_ms = lang_index_lookup_elapsed.as_millis(),
                    "Pool 选择: lang_index 查找完成（pool_selection.rs）"
                );
                
                if eligible_pools.is_empty() {
                    warn!(
                        tgt_lang = %tgt_lang,
                        total_pools = cfg.pools.len(),
                        "未找到支持目标语言 {} 的混合池",
                        tgt_lang
                    );
                    let dbg = Phase3TwoLevelDebug {
                        pool_count: cfg.pools.len() as u16,
                        preferred_pool: 0,
                        selected_pool: None,
                        fallback_used: false,
                        attempts: vec![],
                    };
                    return Err(dbg);
                }
                
                tracing::info!(
                    tgt_lang = %tgt_lang,
                    eligible_pool_count = eligible_pools.len(),
                    eligible_pool_ids = ?eligible_pools,
                    "Pool 选择: 找到支持目标语言的混合池（pool_selection.rs）"
                );
                let all_pool_ids: Vec<u16> = cfg.pools.iter().map(|p| p.pool_id).collect();
                let preferred = eligible_pools[0]; // 使用第一个匹配的混合池作为 preferred
                Ok((all_pool_ids, preferred, eligible_pools))
            } else {
                // 已知源语言：直接按排序后的语言集合查找（与 Pool 命名规则一致）
                // 使用 PoolLanguageIndex（O(1) 查找）
                tracing::info!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "Pool 选择: 已知源语言，使用 lang_index 查找 Pool（pool_selection.rs）"
                );
                let lang_index_lookup_start = std::time::Instant::now();
                let eligible_pools = lang_index.find_pools_for_lang_pair(src_lang, tgt_lang);
                let lang_index_lookup_elapsed = lang_index_lookup_start.elapsed();
                tracing::info!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    eligible_pool_count = eligible_pools.len(),
                    eligible_pool_ids = ?eligible_pools,
                    elapsed_ms = lang_index_lookup_elapsed.as_millis(),
                    "Pool 选择: lang_index 查找完成（pool_selection.rs）"
                );
                
                if eligible_pools.is_empty() {
                    warn!(
                        src_lang = %src_lang,
                        tgt_lang = %tgt_lang,
                        total_pools = cfg.pools.len(),
                        "未找到包含源语言 {} 和目标语言 {} 的 Pool",
                        src_lang,
                        tgt_lang
                    );
                    let dbg = Phase3TwoLevelDebug {
                        pool_count: cfg.pools.len() as u16,
                        preferred_pool: 0,
                        selected_pool: None,
                        fallback_used: false,
                        attempts: vec![],
                    };
                    return Err(dbg);
                }
                
                tracing::info!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    eligible_pool_count = eligible_pools.len(),
                    eligible_pool_ids = ?eligible_pools,
                    "Pool 选择: 找到包含源语言和目标语言的 Pool（pool_selection.rs）"
                );
                let all_pool_ids: Vec<u16> = cfg.pools.iter().map(|p| p.pool_id).collect();
                let preferred = eligible_pools[0]; // 使用第一个匹配的 Pool 作为 preferred
                Ok((all_pool_ids, preferred, eligible_pools))
            }
        } else if using_capability_pools {
            // pool 资格过滤（core_only / all_required）
            let required_for_pool: Vec<crate::messages::ServiceType> = match cfg.pool_match_scope.as_str() {
                "all_required" => required_types.to_vec(),
                _ => {
                    // core_only（默认）：仅对核心链路服务做 pool 级过滤
                    let mut out: Vec<crate::messages::ServiceType> = Vec::new();
                    if let Some(_core) = core_services {
                        if required_types.iter().any(|x| *x == crate::messages::ServiceType::Asr) {
                            out.push(crate::messages::ServiceType::Asr);
                        }
                        if required_types.iter().any(|x| *x == crate::messages::ServiceType::Nmt) {
                            out.push(crate::messages::ServiceType::Nmt);
                        }
                        if required_types.iter().any(|x| *x == crate::messages::ServiceType::Tts) {
                            out.push(crate::messages::ServiceType::Tts);
                        }
                    }
                    out
                }
            };

            let match_mode = cfg.pool_match_mode.as_str();
            let required_for_pool_set = canonicalize_set(required_for_pool.clone());

            let all_pool_ids: Vec<u16> = cfg.pools.iter().map(|p| p.pool_id).collect();
            let mut eligible: Vec<u16> = Vec::new();
            for p in cfg.pools.iter() {
                if required_for_pool.is_empty() {
                    eligible.push(p.pool_id);
                    continue;
                }
                if p.required_services.is_empty() {
                    // 空 required_services 表示"通配 pool"
                    eligible.push(p.pool_id);
                    continue;
                }
                let ok = if match_mode == "exact" {
                    // 精确匹配：按集合相等（忽略顺序、去重）
                    let pool_types: Vec<crate::messages::ServiceType> = p
                        .required_services
                        .iter()
                        .filter_map(|x| crate::messages::ServiceType::from_str(x).ok())
                        .collect();
                    canonicalize_set(pool_types) == required_for_pool_set
                } else {
                    // contains（默认）：包含匹配
                    required_for_pool.iter().all(|rid| {
                        p.required_services
                        .iter()
                            .filter_map(|x| crate::messages::ServiceType::from_str(x).ok())
                            .any(|x| x == *rid)
                    })
                };
                if ok {
                    eligible.push(p.pool_id);
                }
            }

            let eligible = if eligible.is_empty() {
                if cfg.strict_pool_eligibility {
                    // 强隔离：没有 eligible pools 直接失败
                    let dbg = Phase3TwoLevelDebug {
                        pool_count: all_pool_ids.len().max(1) as u16,
                        preferred_pool: 0,
                        selected_pool: None,
                        fallback_used: false,
                        attempts: vec![],
                    };
                    return Err(dbg);
                }
                // 兼容：回退为"遍历所有配置 pools"
                all_pool_ids
            } else {
                eligible
            };

            // tenant override（当 routing_key=tenant_id 时生效）
            let mut preferred_idx: usize = 0;
            let mut preferred_pool: u16 = eligible[0];
            if let Some(ov) = cfg
                .tenant_overrides
                .iter()
                .find(|x| x.tenant_id == routing_key)
            {
                if let Some(pos) = eligible.iter().position(|pid| *pid == ov.pool_id) {
                    preferred_idx = pos;
                    preferred_pool = ov.pool_id;
                }
            } else {
                // 根据配置选择策略：hash-based（session affinity）或随机
                if cfg.enable_session_affinity {
                    preferred_idx = crate::phase3::pick_index_for_key(eligible.len(), cfg.hash_seed, routing_key);
                    preferred_pool = eligible[preferred_idx];
                } else {
                    // 随机选择 preferred pool（无 session affinity）
                    let mut rng = thread_rng();
                    if let Some(&pool) = eligible.choose(&mut rng) {
                        preferred_pool = pool;
                        preferred_idx = eligible.iter().position(|&p| p == pool).unwrap_or(0);
                    } else {
                        preferred_pool = eligible[0];
                        preferred_idx = 0;
                    }
                }
            }

            let order = if cfg.fallback_scan_all_pools {
                crate::phase3::ring_order_ids(&eligible, preferred_idx)
            } else {
                vec![preferred_pool]
            };
            Ok((eligible, preferred_pool, order))
        } else {
            // hash 分桶：pool_id ∈ [0, pool_count)
            let pool_count = cfg.pool_count.max(1);
            let preferred = if cfg.enable_session_affinity {
                crate::phase3::pool_id_for_key(pool_count, cfg.hash_seed, routing_key)
            } else {
                // 随机选择 preferred pool（无 session affinity）
                let mut rng = thread_rng();
                rng.gen_range(0..pool_count)
            };
            let order = if cfg.fallback_scan_all_pools {
                crate::phase3::pool_probe_order(pool_count, preferred)
            } else {
                vec![preferred]
            };
            let all: Vec<u16> = (0..pool_count).collect();
            Ok((all, preferred, order))
        }
    } else {
        // Phase3 未启用：返回空结果（由调用者处理）
        Ok((vec![], 0, vec![]))
    }
}
