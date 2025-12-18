use super::NodeRegistry;
use crate::config::CoreServicesConfig;
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
            crate::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
            *w = Phase3CoreCacheState::default();
            return;
        }

        let core = self.core_services.read().await.clone();
        // 以 phase3_node_pool 为准：只统计“已分配到 pool 的节点”
        let t0 = Instant::now();
        let node_pool = self.phase3_node_pool.read().await;
        crate::observability::record_lock_wait("node_registry.phase3_node_pool.read", t0.elapsed().as_millis() as u64);
        let node_pool = node_pool.clone();

        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

        let mut st = Phase3CoreCacheState::default();
        for (nid, n) in nodes.iter() {
            let Some(pool_id) = node_pool.get(nid).copied() else { continue };
            let s = compute_node_state(n, pool_id, &core);
            st.inc_pool(&s);
            st.nodes.insert(nid.clone(), s);
        }
        drop(nodes);

        let t0 = Instant::now();
        let mut w = self.phase3_core_cache.write().await;
        crate::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
        *w = st;
    }

    pub(super) async fn phase3_core_cache_upsert_node(&self, node: super::Node) {
        let p3 = self.phase3.read().await.clone();
        if !p3.enabled || p3.mode != "two_level" {
            return;
        }
        let core = self.core_services.read().await.clone();
        let Some(pool_id) = self.phase3_node_pool_id(&node.node_id).await else {
            // 节点不属于任何 pool：确保从缓存中移除
            self.phase3_core_cache_remove_node(&node.node_id).await;
            return;
        };
        let new_state = compute_node_state(&node, pool_id, &core);

        let t0 = Instant::now();
        let mut w = self.phase3_core_cache.write().await;
        crate::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
        if let Some(old) = w.nodes.remove(&node.node_id) {
            w.dec_pool(&old);
        }
        w.inc_pool(&new_state);
        w.nodes.insert(node.node_id.clone(), new_state);
    }

    pub(super) async fn phase3_core_cache_remove_node(&self, node_id: &str) {
        let t0 = Instant::now();
        let mut w = self.phase3_core_cache.write().await;
        crate::observability::record_lock_wait("node_registry.phase3_core_cache.write", t0.elapsed().as_millis() as u64);
        if let Some(old) = w.nodes.remove(node_id) {
            w.dec_pool(&old);
        }
    }

    pub async fn phase3_pool_core_cache_snapshot(&self) -> HashMap<u16, Phase3PoolCoreCache> {
        let t0 = Instant::now();
        let r = self.phase3_core_cache.read().await;
        crate::observability::record_lock_wait("node_registry.phase3_core_cache.read", t0.elapsed().as_millis() as u64);
        r.pools.clone()
    }
}

fn compute_node_state(
    n: &super::Node,
    pool_id: u16,
    core: &CoreServicesConfig,
) -> NodeCoreState {
    // online：用于 pool online_nodes
    let online = n.online;
    // ready：用于 ready_nodes 与核心服务覆盖（保持与调度路径一致：只统计 online+Ready）
    let ready = n.online && n.status == NodeStatus::Ready;

    let (asr_id, nmt_id, tts_id) = (
        core.asr_service_id.as_str(),
        core.nmt_service_id.as_str(),
        core.tts_service_id.as_str(),
    );

    let asr_installed = ready && !asr_id.is_empty() && n.installed_services.iter().any(|s| s.service_id == asr_id);
    let nmt_installed = ready && !nmt_id.is_empty() && n.installed_services.iter().any(|s| s.service_id == nmt_id);
    let tts_installed = ready && !tts_id.is_empty() && n.installed_services.iter().any(|s| s.service_id == tts_id);

    let asr_ready = ready
        && !asr_id.is_empty()
        && n.capability_state.get(asr_id).map(|s| s == &crate::messages::ModelStatus::Ready).unwrap_or(false);
    let nmt_ready = ready
        && !nmt_id.is_empty()
        && n.capability_state.get(nmt_id).map(|s| s == &crate::messages::ModelStatus::Ready).unwrap_or(false);
    let tts_ready = ready
        && !tts_id.is_empty()
        && n.capability_state.get(tts_id).map(|s| s == &crate::messages::ModelStatus::Ready).unwrap_or(false);

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


