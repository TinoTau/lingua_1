# 阶段 3.2 测试失败分析

## 测试失败情况

4 个测试失败：
1. `test_select_node_with_models_ready` - 返回 None，期望 Some("node-1")
2. `test_select_node_with_module_expansion` - 返回 None，期望 Some("node-emotion")
3. `test_select_node_with_multiple_required_models` - 返回 None，期望 Some("node-2")
4. `test_update_node_heartbeat_capability_state` - assertion failed: success

## 已修复的问题

1. ✅ 添加了 GPU 到测试硬件（`create_test_hardware`）
2. ✅ 修复了所有 `register_node` 调用的警告（添加 `let _ =`）
3. ✅ 添加了 `NodeStatus` 导入
4. ✅ 修复了 `update_node_heartbeat` 调用（添加 `gpu_usage` 参数）

## 可能的问题原因

### 1. `node_has_required_models` 检查失败

`select_node_with_models` 会先检查节点是否有 ASR、NMT、TTS 三个核心模型：

```rust
if !node_has_required_models(node, src_lang, tgt_lang) {
    continue; // 节点被排除
}
```

`node_has_required_models` 需要：
- `capability_state` 中有 ASR 模型且状态为 Ready，并且 `installed_models` 中有对应的 ASR 模型
- `capability_state` 中有 NMT 模型且状态为 Ready，并且 `installed_models` 中有对应的 NMT 模型（src_lang 和 tgt_lang 匹配）
- `capability_state` 中有 TTS 模型且状态为 Ready，并且 `installed_models` 中有对应的 TTS 模型（tgt_lang 匹配）

**测试数据检查**：
- `capability_state`: `whisper-large-v3-zh`, `m2m100-zh-en`, `piper-tts-en` ✅
- `installed_models`: `whisper-large-v3-zh`, `m2m100-zh-en`, `piper-tts-en` ✅
- 模型ID匹配 ✅

### 2. `node_has_models_ready` 检查失败

检查 `required_model_ids` 是否都在 `capability_state` 中且状态为 Ready：

```rust
if !node_has_models_ready(node, required_model_ids) {
    continue; // 节点被排除
}
```

**测试场景**：需要 `emotion-xlm-r` 模型
- `capability_state` 中有 `emotion-xlm-r` 且状态为 Ready ✅
- 应该能通过检查

### 3. 资源使用率检查

`is_node_resource_available` 检查 CPU、GPU、内存使用率是否低于阈值（默认 25%）：

```rust
if !is_node_resource_available(node, self.resource_threshold) {
    continue; // 节点被排除
}
```

**节点初始值**：
- `cpu_usage: 0.0` ✅
- `gpu_usage: Some(0.0)` ✅
- `memory_usage: 0.0` ✅
- 应该能通过检查

### 4. 节点状态检查

节点注册后状态为 `Registering`，需要调用 `set_node_status` 设置为 `Ready`：

```rust
if node.status != NodeStatus::Ready {
    continue; // 节点被排除
}
```

**测试中**：已经调用了 `set_node_status("node-1", NodeStatus::Ready)` ✅

## 建议的调试方法

1. 添加调试日志到 `select_node_with_models`，查看哪个检查失败了
2. 检查 `node_has_required_models` 的逻辑，确认 TTS 模型检查是否正确
3. 验证 `register_node` 是否正确设置了 `capability_state`

## 下一步

请运行测试并查看详细输出，或者我可以添加调试日志来定位问题。
