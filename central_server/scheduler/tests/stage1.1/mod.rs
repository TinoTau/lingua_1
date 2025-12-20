// 阶段一.1（1.1 调度服务器核心功能）单元测试
// 
// 测试模块：
// - session_test: 会话管理测试
// - dispatcher_test: 任务分发测试
// - node_registry_test: 节点注册表测试
// - pairing_test: 配对服务测试
// - connection_manager_test: 连接管理测试
// - result_queue_test: 结果队列测试

#[path = "session_test.rs"]
mod session_test;

#[path = "dispatcher_test.rs"]
mod dispatcher_test;

#[path = "node_registry_test.rs"]
mod node_registry_test;

#[path = "pairing_test.rs"]
mod pairing_test;

#[path = "connection_manager_test.rs"]
mod connection_manager_test;

#[path = "result_queue_test.rs"]
mod result_queue_test;

#[path = "node_status_test.rs"]
mod node_status_test;

#[path = "session_actor_test.rs"]
mod session_actor_test;

