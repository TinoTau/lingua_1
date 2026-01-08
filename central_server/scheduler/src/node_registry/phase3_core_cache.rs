use super::NodeRegistry;
use crate::core::config::CoreServicesConfig;
use crate::messages::NodeStatus;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone, Default)]
pub struct Phase3PoolCoreCache {
    pub online_nodes: usize,
    pub ready_nodes: usize,
    pub asr_installed: usize,
    pub asr_ready: usize,
    pub nmt_installed: usize,
    pub nmt_ready: usize,
    pub tts_installed: usize,
    pub tts_ready: usize,
}

#[derive(Debug, Clone)]
struct NodeCoreState {
    pool_id: u16,
    online: bool,
    ready: bool,
    asr_installed: bool,
    asr_ready: bool,
    nmt_installed: bool,
    nmt_ready: bool,
    tts_installed: bool,
    tts_ready: bool,
}

#[derive(Debug, Default)]
pub(super) struct Phase3CoreCacheState {
    nodes: HashMap<String, NodeCoreState>,
    pools: HashMap<u16, Phase3PoolCoreCache>,
}

impl Phase3CoreCacheState {
    fn dec_pool(&mut self, s: &NodeCoreState) {
        let p = self.pools.entry(s.pool_id).or_default();
        if s.online {
            p.online_nodes = p.online_nodes.saturating_sub(1);
        }
        if s.ready {
            p.ready_nodes = p.ready_nodes.saturating_sub(1);
            if s.asr_installed {
                p.asr_installed = p.asr_installed.saturating_sub(1);
            }
            if s.asr_ready {
                p.asr_ready = p.asr_ready.saturating_sub(1);
            }
            if s.nmt_installed {
                p.nmt_installed = p.nmt_installed.saturating_sub(1);
            }
            if s.nmt_ready {
                p.nmt_ready = p.nmt_ready.saturating_sub(1);
            }
            if s.tts_installed {
                p.tts_installed = p.tts_installed.saturating_sub(1);
            }
            if s.tts_ready {
                p.tts_ready = p.tts_ready.saturating_sub(1);
            }
        }
    }

    fn inc_pool(&mut self, s: &NodeCoreState) {
        let p = self.pools.entry(s.pool_id).or_default();
        if s.online {
            p.online_nodes += 1;
        }
        if s.ready {
            p.ready_nodes += 1;
            if s.asr_installed {
                p.asr_installed += 1;
            }
            if s.asr_ready {
                p.asr_ready += 1;
            }
            if s.nmt_installed {
                p.nmt_installed += 1;
            }
            if s.nmt_ready {
                p.nmt_ready += 1;
            }
            if s.tts_installed {
                p.tts_installed += 1;
            }
            if s.tts_ready {
                p.tts_ready += 1;
            }
        }
    }
}

impl NodeRegistry {
    pub async fn set_core_services_config(&self, cfg: CoreServicesConfig) {
        let mut w = self.core_services.write().await;
        *w = cfg;
        drop(w);
        self.rebuild_phase3_core_cache().await;
    }

    pub async fn rebuild_phase3_core_cache(&self) {
        let p3 = self.phase3.read().await.clone();
        if !p3.enabled || p3.mode != "two_level" {
            let t0 = Instant::now();
            let mut w = self.phase3_core_cache.write().await;
            crate::metrics::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
            *w = Phase3CoreCacheState::default();
            return;
        }

        let core = self.core_services.read().await.clone();
        // 以 phase3_node_pool 为准：只统计“已分配到 pool 的节点”
        let t0 = Instant::now();
        let node_pool = self.phase3_node_pool.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_node_pool.read", t0.elapsed().as_millis() as u64);
        let node_pool = node_pool.clone();

        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

        let mut st = Phase3CoreCacheState::default();
        for (nid, n) in nodes.iter() {
            let pool_ids = node_pool.get(nid).cloned().unwrap_or_default();
            if pool_ids.is_empty() {
                continue;
            }
            // 为节点的每个 Pool 创建缓存条目
            for pool_id in &pool_ids {
                let cache_key = format!("{}:{}", nid, pool_id);
                let s = compute_node_state(n, *pool_id, &core);
                st.inc_pool(&s);
                st.nodes.insert(cache_key, s);
            }
        }
        drop(nodes);

        let t0 = Instant::now();
        let mut w = self.phase3_core_cache.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
        *w = st;
    }

    pub(super) async fn phase3_core_cache_upsert_node(&self, node: super::Node) {
        let p3 = self.phase3.read().await.clone();
        if !p3.enabled || p3.mode != "two_level" {
            return;
        }
        let core = self.core_services.read().await.clone();
        let pool_ids = self.phase3_node_pool_ids(&node.node_id).await;
        if pool_ids.is_empty() {
            // 节点不属于任何 pool：确保从缓存中移除
            self.phase3_core_cache_remove_node(&node.node_id).await;
            return;
        }
        
        // 为节点的每个 Pool 创建缓存状态
        // 注意：由于 NodeCoreState 只存储一个 pool_id，我们需要为每个 Pool 创建单独的条目
        // 使用 node_id + pool_id 作为 key
        let t0 = Instant::now();
        let mut w = self.phase3_core_cache.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
        
        // 先移除旧的缓存条目（所有以 node_id 开头的 key，包括 node_id 本身和 node_id:pool_id 格式）
        let node_id_str = &node.node_id;
        let old_keys: Vec<String> = w.nodes.keys()
            .filter(|k| {
                k.as_str() == node_id_str || k.starts_with(&format!("{}:", node_id_str))
            })
            .cloned()
            .collect();
        for old_key in &old_keys {
            if let Some(old) = w.nodes.remove(old_key) {
                w.dec_pool(&old);
            }
        }
        
        // 为每个 Pool 创建新的缓存条目
        for pool_id in &pool_ids {
            let cache_key = format!("{}:{}", node.node_id, pool_id);
            let new_state = compute_node_state(&node, *pool_id, &core);
            w.inc_pool(&new_state);
            w.nodes.insert(cache_key, new_state);
        }
    }

    pub(super) async fn phase3_core_cache_remove_node(&self, node_id: &str) {
        // 移除节点的所有缓存条目（支持一个节点属于多个 Pool）
        let t0 = Instant::now();
        let mut w = self.phase3_core_cache.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
        
        // 移除所有以 node_id 开头的 key（包括 node_id 本身和 node_id:pool_id 格式）
        let old_keys: Vec<String> = w.nodes.keys()
            .filter(|k| {
                k.as_str() == node_id || k.starts_with(&format!("{}:", node_id))
            })
            .cloned()
            .collect();
        for old_key in &old_keys {
            if let Some(old) = w.nodes.remove(old_key) {
                w.dec_pool(&old);
            }
        }
    }

    pub async fn phase3_pool_core_cache_snapshot(&self) -> HashMap<u16, Phase3PoolCoreCache> {
        let t0 = Instant::now();
        let r = self.phase3_core_cache.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_core_cache.read", t0.elapsed().as_millis() as u64);
        r.pools.clone()
    }
}

fn compute_node_state(
    n: &super::Node,
    pool_id: u16,
    _core: &CoreServicesConfig,
) -> NodeCoreState {
    // online：用于 pool online_nodes
    let online = n.online;
    // ready：用于 ready_nodes 与核心服务覆盖（保持与调度路径一致：只统计 online+Ready）
    let ready = n.online && n.status == NodeStatus::Ready;

    // 注意：节点能力信息已迁移到 Redis，这里需要从 Redis 读取
    // 但由于 phase3_core_cache 没有 phase2_runtime，暂时使用 installed_services 作为替代
    // TODO: 重构 phase3_core_cache 以支持从 Redis 读取能力信息
    let asr_ready = ready
        && n.installed_services.iter().any(|s| s.r#type == crate::messages::ServiceType::Asr && s.status == crate::messages::ServiceStatus::Running);
    let nmt_ready = ready
        && n.installed_services.iter().any(|s| s.r#type == crate::messages::ServiceType::Nmt && s.status == crate::messages::ServiceStatus::Running);
    let tts_ready = ready
        && n.installed_services.iter().any(|s| s.r#type == crate::messages::ServiceType::Tts && s.status == crate::messages::ServiceStatus::Running);

    let asr_installed = ready
        && n.installed_services.iter().any(|s| s.r#type == crate::messages::ServiceType::Asr);
    let nmt_installed = ready
        && n.installed_services.iter().any(|s| s.r#type == crate::messages::ServiceType::Nmt);
    let tts_installed = ready
        && n.installed_services.iter().any(|s| s.r#type == crate::messages::ServiceType::Tts);

    NodeCoreState {
        pool_id,
        online,
        ready,
        asr_installed,
        asr_ready,
        nmt_installed,
        nmt_ready,
        tts_installed,
        tts_ready,
    }
}


