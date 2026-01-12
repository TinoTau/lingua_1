use crate::messages::NodeMessage;
use tracing::{error, warn};

pub(super) async fn handle_node_error(node_id: &str, code: &str, message: &str, _details: Option<serde_json::Value>) {
    error!("鑺傜偣 {} 鎶ュ憡閿欒: {} - {}", node_id, code, message);
}

pub(super) async fn handle_unhandled(message: NodeMessage) {
    // 杩欓噷淇濆畧澶勭悊锛氶伩鍏嶆柊鍗忚瀛楁瀵艰嚧 panic
    warn!("鏀跺埌鏈鐞嗙殑鑺傜偣娑堟伅绫诲瀷: {:?}", message);
}


