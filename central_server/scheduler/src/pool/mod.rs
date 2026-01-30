//! Pool 架构（有向语言对版本）
//! 
//! 基于有向语言对的二级池结构：
//! 1. 有向语言对分组（src:tgt，例如 zh:en）
//! 2. 每100个节点一个二级池

pub mod types;
// node_index 已删除（未使用）
pub mod pool_service;

#[cfg(test)]
mod tests;

pub use pool_service::PoolService;
// 以下导出仅用于测试
#[allow(unused_imports)]
pub use types::{DirectedLangPair, extract_directed_pairs, POOL_SIZE, MAX_POOL_ID};
