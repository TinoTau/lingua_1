# 旧集成测试（已禁用）

**日期**: 2026-01-22  
**原因**: 这些测试依赖已废弃的 API，无法通过编译

## 📋 测试状态

此目录包含依赖旧架构的集成测试，已暂时禁用：

### 依赖的已废弃 API

这些测试使用了以下已删除或修改的 API：

1. **NodeRegistry**
   - ❌ `register_node_for_test()` - 已删除
   - ❌ `mark_node_offline()` - 已删除（改用 Redis TTL 自动过期）
   - ❌ `update_node_heartbeat()` - 签名已更改
   - ❌ `set_node_status_for_test()` - 已删除
   - ❌ `get_node_snapshot()` - 改为 `get_node_data()`
   - ❌ `with_resource_threshold()` - 改为 `set_resource_threshold()`
   - ❌ `phase3_config()` - 已删除
   - ❌ `random_sample_nodes()` - 已删除

2. **RegisterNodeRequest**
   - ❌ `cap_json` - 已删除
   - ❌ `pool_names_json` - 已删除
   - ✅ 改用 `asr_langs_json`、`semantic_langs_json`、`tts_langs_json`（池分配用 asr×semantic）

3. **Job**
   - ❌ `calculate_dynamic_timeout_seconds()` - 已删除

4. **GroupManager**
   - ❌ `on_asr_final()` - 已删除
   - ❌ `on_nmt_done()` - 已删除

5. **AudioBufferManager**
   - ❌ `clear_all_for_session_for_test()` - 已删除

6. **ModuleResolver**
   - ❌ `expand_dependencies()` - 已删除

7. **AppState**
   - ❌ 缺少 `pool_service` 字段

## 🔄 架构变更

这些测试编写时使用的是旧架构：

- **旧架构**: 本地缓存 + 手动状态管理
- **新架构**: Redis 直查 + TTL 自动过期

主要变化：
1. 节点管理简化为 Redis SSOT
2. 移除本地状态缓存
3. 使用 TTL 自动清理
4. 简化 API 接口

## 📊 测试覆盖

当前**库内单元测试**覆盖核心功能：

```
running 42 tests
✅ Job 清理测试（6 个）
✅ 节点数据测试（5 个）
✅ Pool 管理测试（13 个）
✅ Session Actor 测试（8 个）
✅ 其他核心测试（10 个）

test result: ok. 42 passed; 0 failed
```

## 🚀 下一步

如需重新启用这些集成测试，需要：

1. **更新测试代码** - 使用新 API（含 `RegisterNodeRequest.tts_langs_json`）
2. **Mock Redis** - 避免依赖真实 Redis 实例
3. **重构测试结构** - 匹配新架构

**建议**: 暂时使用库内单元测试 + 手动端到端测试，待架构稳定后再重写集成测试。

---

## 📝 测试文件清单

### 顶层测试文件（13 个）
- `job_no_text_assigned_test.rs`
- `job_dynamic_timeout_test.rs`
- `group_manager_test.rs`
- `minimal_scheduler_integration_test.rs`
- `minimal_scheduler_test.rs`
- `minimal_scheduler_pool_registration_test.rs`
- `module_resolver_test.rs`
- `phase3_3.rs`
- `stage1_1.rs`
- `stage1_2.rs`
- `stage2_1_2.rs`
- `stage3_2.rs`

### Stage 1.1 测试（9 个）
- `connection_manager_test.rs`
- `dispatcher_test.rs`
- `node_registry_test.rs`
- `node_status_test.rs`
- `result_queue_test.rs`
- `session_actor_test.rs`
- `session_affinity_test.rs`
- `session_test.rs`

### Stage 1.2 测试（1 个）
- `message_format_test.rs`

### Stage 2.1.2 测试（5 个）
- `asr_partial_message_test.rs`
- `audio_buffer_test.rs`
- `audio_chunk_loss_fix_test.rs`
- `edge_finalize_test.rs`
- `pause_detect_with_tts_playback_test.rs`

### Stage 3.2 测试（2 个）
- `debug_test.rs`
- `node_selection_test.rs`

### Phase 3 测试（1 个）
- `session_init_trace_tenant_test.rs`

---

**备注**: 这些测试文件已完整保留在此目录，可随时恢复。
