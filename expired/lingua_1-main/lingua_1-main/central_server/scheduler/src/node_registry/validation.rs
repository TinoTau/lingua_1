// 节点验证逻辑
// 注意：原有的验证函数已被节点选择逻辑中的内联实现替代
// - node_has_required_types_ready: 已由 selection/node_selection.rs 中的 Redis 查询替代
// - node_has_installed_types: 已由 selection/node_selection.rs 中的内联检查替代
// - node_supports_features: 已由 selection/selection_features.rs 中的 node_supports_features_from_snapshot 替代
// - is_node_resource_available: 已由 selection/node_selection.rs 中的内联资源检查替代

