use crate::messages::NodeMessage;
use tracing::{error, warn};

pub(super) async fn handle_node_error(node_id: &str, code: &str, message: &str, _details: Option<serde_json::Value>) {
    error!("节点 {} 报告错误: {} - {}", node_id, code, message);
}

pub(super) async fn handle_unhandled(message: NodeMessage) {
    // 这里保守处理：避免新协议字段导致 panic
    warn!("收到未处理的节点消息类型: {:?}", message);
}


