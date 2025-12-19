use super::NodeRegistry;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

impl NodeRegistry {
    pub async fn phase3_config(&self) -> crate::config::Phase3Config {
        self.phase3.read().await.clone()
    }

    pub async fn set_phase3_config(&self, cfg: crate::config::Phase3Config) {
        let mut w = self.phase3.write().await;
        *w = cfg;
        drop(w);
        self.rebuild_phase3_pool_index().await;
        // Phase 3：pool 映射变化（pool_count/hash_seed 等）会影响 core cache 的 pool_id 归属
        self.rebuild_phase3_core_cache().await;
    }

    pub(super) async fn phase3_upsert_node_to_pool_index(&self, node_id: &str) {
        let cfg = self.phase3.read().await.clone();
        if !cfg.enabled || cfg.mode != "two_level" {
            return;
        }
        let pid = if !cfg.pools.is_empty() {
            let nodes = self.nodes.read().await;
            let Some(n) = nodes.get(node_id) else { return };
            determine_pool_for_node(&cfg, n)
        } else {
            Some(crate::phase3::pool_id_for_key(cfg.pool_count, cfg.hash_seed, node_id))
        };
        self.phase3_set_node_pool(node_id, pid).await;
    }

    pub async fn phase3_remove_node_from_pool_index(&self, node_id: &str) {
        self.phase3_set_node_pool(node_id, None).await;
    }

    pub async fn rebuild_phase3_pool_index(&self) {
        let cfg = self.phase3.read().await.clone();
        let mut new_idx: HashMap<u16, HashSet<String>> = HashMap::new();
        let mut new_node_pool: HashMap<String, u16> = HashMap::new();
        if cfg.enabled && cfg.mode == "two_level" {
            let t0 = Instant::now();
            let nodes = self.nodes.read().await;
            crate::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);
            for nid in nodes.keys() {
                let pid = if !cfg.pools.is_empty() {
                    nodes.get(nid).and_then(|n| determine_pool_for_node(&cfg, n))
                } else {
                    Some(crate::phase3::pool_id_for_key(cfg.pool_count, cfg.hash_seed, nid))
                };
                if let Some(pid) = pid {
                    new_idx.entry(pid).or_default().insert(nid.clone());
                    new_node_pool.insert(nid.clone(), pid);
                }
            }
        }
        let t0 = Instant::now();
        let mut idx = self.phase3_pool_index.write().await;
        crate::observability::record_lock_wait("node_registry.phase3_pool_index.write", t0.elapsed().as_millis() as u64);
        *idx = new_idx;
        drop(idx);
        let t0 = Instant::now();
        let mut m = self.phase3_node_pool.write().await;
        crate::observability::record_lock_wait("node_registry.phase3_node_pool.write", t0.elapsed().as_millis() as u64);
        *m = new_node_pool;
    }

    /// 运维/调试：返回各 pool 的节点数（总数，包含 offline/registering；筛选在上层做）
    pub async fn phase3_pool_sizes(&self) -> Vec<(u16, usize)> {
        let t0 = Instant::now();
        let idx = self.phase3_pool_index.read().await;
        crate::observability::record_lock_wait("node_registry.phase3_pool_index.read", t0.elapsed().as_millis() as u64);
        let mut v: Vec<(u16, usize)> = idx.iter().map(|(k, set)| (*k, set.len())).collect();
        v.sort_by_key(|(k, _)| *k);
        v
    }

    /// Phase 3：更新 node -> pool 的归属（同时维护 pool_index）
    /// - desired=None：从 pool_index 中移除该节点
    pub(super) async fn phase3_set_node_pool(&self, node_id: &str, desired: Option<u16>) {
        // 先更新 node->pool 映射，拿到 old
        let t0 = Instant::now();
        let mut m = self.phase3_node_pool.write().await;
        crate::observability::record_lock_wait("node_registry.phase3_node_pool.write", t0.elapsed().as_millis() as u64);
        let old = m.remove(node_id);
        if let Some(pid) = desired {
            m.insert(node_id.to_string(), pid);
        }
        drop(m);

        // 再更新 pool_index
        let t0 = Instant::now();
        let mut idx = self.phase3_pool_index.write().await;
        crate::observability::record_lock_wait("node_registry.phase3_pool_index.write", t0.elapsed().as_millis() as u64);
        if let Some(old_pid) = old {
            if let Some(set) = idx.get_mut(&old_pid) {
                set.remove(node_id);
                if set.is_empty() {
                    idx.remove(&old_pid);
                }
            }
        }
        if let Some(new_pid) = desired {
            idx.entry(new_pid)
                .or_insert_with(HashSet::new)
                .insert(node_id.to_string());
        }
    }

    pub async fn phase3_node_pool_id(&self, node_id: &str) -> Option<u16> {
        let t0 = Instant::now();
        let m = self.phase3_node_pool.read().await;
        crate::observability::record_lock_wait("node_registry.phase3_node_pool.read", t0.elapsed().as_millis() as u64);
        m.get(node_id).copied()
    }

    /// 运维/调试：返回 pool 内示例节点 ID（最多 limit 个）
    pub async fn phase3_pool_sample_node_ids(&self, pool_id: u16, limit: usize) -> Vec<String> {
        let lim = limit.max(1);
        let t0 = Instant::now();
        let idx = self.phase3_pool_index.read().await;
        crate::observability::record_lock_wait("node_registry.phase3_pool_index.read", t0.elapsed().as_millis() as u64);
        let mut v: Vec<String> = idx
            .get(&pool_id)
            .map(|s| s.iter().cloned().take(lim).collect())
            .unwrap_or_default();
        v.sort();
        v.truncate(lim);
        v
    }
}

fn determine_pool_for_node(cfg: &crate::config::Phase3Config, n: &super::Node) -> Option<u16> {
    if cfg.pools.is_empty() {
        return None;
    }

    // 收集所有匹配 pools（node.installed_services 覆盖 pool.required_services）
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
            .all(|rid| n.installed_services.iter().any(|s| s.service_id == *rid));
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
    // - 先选“更具体”的 pool（required_services 更长），避免“能力更全的节点”被分配到更通用的 pool（有利于强隔离）
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


