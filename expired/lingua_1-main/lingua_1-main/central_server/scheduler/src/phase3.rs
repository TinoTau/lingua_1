//! Phase 3：两级调度（Two-level scheduling）
//! - Global：选择 pool（按 request_id/session_id hash）
//! - Pool：在 pool 内选择具体 node
//!
//! 运维目标：
//! - 可观测：每次选择输出 pool_preferred/pool_selected/fallback
//! - 可复现：hash_seed 固定后映射稳定
//! - 可验证：允许在测试/脚本中固定 key_prefix 与 pool 相关参数

/// 稳定 hash：FNV-1a 64-bit（跨平台、跨进程稳定）
fn fnv1a64(bytes: &[u8]) -> u64 {
    const OFFSET: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut h = OFFSET;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(PRIME);
    }
    h
}

pub fn pool_id_for_key(pool_count: u16, hash_seed: u64, key: &str) -> u16 {
    let pc = pool_count.max(1);
    let mut buf = Vec::with_capacity(key.len() + 16);
    buf.extend_from_slice(key.as_bytes());
    buf.extend_from_slice(&hash_seed.to_le_bytes());
    (fnv1a64(&buf) % (pc as u64)) as u16
}

/// 在给定候选集合（长度 n）中选择一个稳定 index（0..n）
pub fn pick_index_for_key(n: usize, hash_seed: u64, key: &str) -> usize {
    let n = n.max(1);
    let mut buf = Vec::with_capacity(key.len() + 16);
    buf.extend_from_slice(key.as_bytes());
    buf.extend_from_slice(&hash_seed.to_le_bytes());
    (fnv1a64(&buf) % (n as u64)) as usize
}

/// 返回按环形顺序遍历 ids：从 start_idx 开始
pub fn ring_order_ids(ids: &[u16], start_idx: usize) -> Vec<u16> {
    if ids.is_empty() {
        return vec![];
    }
    let n = ids.len();
    let s = start_idx % n;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        out.push(ids[(s + i) % n]);
    }
    out
}

/// 返回探测顺序：先 preferred，然后按环形顺序遍历其余 pool
pub fn pool_probe_order(pool_count: u16, preferred: u16) -> Vec<u16> {
    let pc = pool_count.max(1);
    let mut out = Vec::with_capacity(pc as usize);
    let start = preferred % pc;
    for i in 0..pc {
        out.push((start + i) % pc);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_id_is_stable() {
        assert_eq!(pool_id_for_key(16, 0, "abc"), pool_id_for_key(16, 0, "abc"));
        assert_ne!(pool_id_for_key(16, 0, "abc"), pool_id_for_key(16, 1, "abc"));
    }

    #[test]
    fn probe_order_covers_all() {
        let v = pool_probe_order(4, 2);
        assert_eq!(v, vec![2, 3, 0, 1]);
    }

    #[test]
    fn pick_index_is_stable() {
        assert_eq!(pick_index_for_key(7, 0, "abc"), pick_index_for_key(7, 0, "abc"));
        assert_ne!(pick_index_for_key(7, 0, "abc"), pick_index_for_key(7, 1, "abc"));
    }
}


