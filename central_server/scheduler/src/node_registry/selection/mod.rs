pub mod selection_breakdown;
pub mod selection_features;
pub mod selection_types;
pub mod selection_phase3;

// Phase3 子模块（内部使用）
mod pool_selection;
mod node_selection;

#[cfg(test)]
mod tests;

pub use selection_breakdown::{NoAvailableNodeBreakdown, Phase3TwoLevelDebug};

