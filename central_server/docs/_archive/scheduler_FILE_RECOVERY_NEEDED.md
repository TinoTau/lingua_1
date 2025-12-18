# 文件恢复需要

## 问题

`central_server/scheduler/src/node_registry/mod.rs` 文件被意外覆盖，需要从 `expired` 文件夹恢复。

## 恢复步骤

1. 从 `expired` 文件夹复制原始文件：
   ```powershell
   Copy-Item expired\scheduler\src\node_registry\mod.rs central_server\scheduler\src\node_registry\mod.rs -Force
   ```

2. 在文件末尾（第 445 行 `}` 之前）添加测试辅助方法：
   ```rust
   #[cfg(test)]
   /// 测试辅助方法：获取节点信息（仅用于测试）
   pub async fn get_node_for_test(&self, node_id: &str) -> Option<Node> {
       let nodes = self.nodes.read().await;
       nodes.get(node_id).cloned()
   }
   
   #[cfg(test)]
   /// 测试辅助方法：列出所有节点 ID（仅用于测试）
   pub async fn list_node_ids_for_test(&self) -> Vec<String> {
       let nodes = self.nodes.read().await;
       nodes.keys().cloned().collect()
   }
   ```

3. 确认文件有 447 行（原始 445 行 + 测试方法）

## 当前状态

- ✅ 测试代码已更新，使用 `get_node_for_test` 和 `list_node_ids_for_test`
- ⚠️ `mod.rs` 文件需要恢复并添加测试辅助方法
- ⏳ 恢复后可以运行测试查看调试输出
