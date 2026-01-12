# capability_by_type 和 capability_by_type_map 设计说明

## 两个字段的用途

### 1. `capability_by_type: Vec<CapabilityByType>`
- **用途**：原始数据，包含完整的能力信息
- **序列化**：✅ 会序列化（用于与节点端通信、Redis 快照等）
- **内容**：包含 `ServiceType`, `ready`, `ready_impl_ids`, `reason` 等完整信息
- **查找复杂度**：O(n) - 需要遍历 Vec 来查找某个服务类型

### 2. `capability_by_type_map: HashMap<ServiceType, bool>`
- **用途**：运行时缓存，用于快速查找
- **序列化**：❌ 标记为 `#[serde(skip)]`，不序列化
- **内容**：只包含 `ServiceType -> ready` 的映射
- **查找复杂度**：O(1) - HashMap 快速查找

## 设计意图

这是一个**"空间换时间"**的优化设计：

1. **性能优化**：在频繁查询节点是否有某个服务能力时（如 Pool 分配、任务调度），使用 HashMap 可以快速判断（O(1)），而不是遍历 Vec（O(n)）

2. **数据完整性**：`capability_by_type` 保留完整信息（如 `ready_impl_ids`, `reason`），用于日志、调试、节点通信等

3. **序列化优化**：`capability_by_type_map` 不序列化，减少网络传输和存储开销

## 当前问题

### 同步问题
- `capability_by_type_map` 需要与 `capability_by_type` 保持同步
- 如果同步失败，会导致查询结果不一致
- 当前代码中，只有在 `capability_by_type` 更新时才更新 `capability_by_type_map`，如果更新失败或遗漏，就会出现问题

### 代码维护成本
- 需要确保两个字段始终同步
- 增加了代码复杂度和出错概率

## 改进建议

### 方案 1：使用 getter 方法（推荐）
将 `capability_by_type_map` 改为计算属性，通过 getter 方法动态生成：

```rust
impl Node {
    /// 检查节点是否有某个服务能力（O(1) 查找）
    pub fn has_service_capability(&self, service_type: &ServiceType) -> bool {
        self.capability_by_type
            .iter()
            .find(|c| &c.r#type == service_type)
            .map(|c| c.ready)
            .unwrap_or(false)
    }
    
    /// 获取所有服务能力的快速查找 map（按需构建）
    pub fn capability_map(&self) -> HashMap<ServiceType, bool> {
        self.capability_by_type
            .iter()
            .map(|c| (c.r#type.clone(), c.ready))
            .collect()
    }
}
```

**优点**：
- 不需要维护两个字段的同步
- 代码更简洁，不容易出错
- 性能影响可接受（查找频率不是特别高）

**缺点**：
- 每次查找需要遍历 Vec（但 Vec 通常很小，性能影响不大）

### 方案 2：使用 `#[serde(skip)]` + 自定义序列化
保持现有设计，但添加 `#[serde(skip)]` 和自定义的 `Serialize`/`Deserialize` 实现，确保反序列化时自动重建 map。

### 方案 3：使用 `lazy_static` 或 `once_cell`
使用惰性初始化，只在第一次访问时构建 map，后续直接使用。

## 当前代码的修复

在 `update_node_heartbeat` 中，我们已经添加了同步逻辑：
- 如果提供了新的 `capability_by_type`，更新 `capability_by_type_map`
- 如果没有提供但 `capability_by_type` 不为空而 `capability_by_type_map` 为空，重新构建 map

这可以解决当前的同步问题，但不是根本解决方案。

## 建议

**短期**：保持当前修复，确保同步逻辑正确
**长期**：考虑重构为方案 1（getter 方法），简化代码并避免同步问题
