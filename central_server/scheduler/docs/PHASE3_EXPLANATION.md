# Phase3 说明文档

## 一、Phase3 是什么？

**Phase3** 是调度系统的一个**功能模块**，用于实现**两级调度（Two-level Scheduling）**机制。

### 1.1 核心概念

**两级调度**：
1. **第一级：Pool 选择** - 从多个 Pool（节点池）中选择一个
2. **第二级：节点选择** - 在选定的 Pool 内选择具体的节点

### 1.2 设计目标

根据 `config_types.rs` 的注释：
> 目标：在节点规模增大时，把"全量遍历选节点"收敛为"先选 pool，再在 pool 内选 node"，并提供可观测性与可运维性。

**优势**：
- ✅ **性能优化**：避免全量遍历所有节点
- ✅ **可扩展性**：节点数量增长时，选择效率不会线性下降
- ✅ **可观测性**：提供 Pool 级别的指标和日志
- ✅ **可运维性**：可以按 Pool 进行容量规划和隔离

---

## 二、Phase3 需要单独启动吗？

**答案：不需要！**

Phase3 是调度服务器的一个**配置选项**，通过配置文件启用或禁用。

### 2.1 启用方式

**方式 1：配置文件**
```toml
[phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true
```

**方式 2：代码配置**
```rust
let mut phase3_config = Phase3Config::default();
phase3_config.enabled = true;
phase3_config.mode = "two_level".to_string();
phase3_config.auto_generate_language_pools = true;
node_registry.set_phase3_config(phase3_config).await;
```

### 2.2 默认状态

- **默认禁用**：`enabled = false`
- **如果禁用**：系统会回退到**单级选择**（直接遍历所有节点）

---

## 三、Phase3 的工作流程

### 3.1 节点选择流程

```
任务请求（src_lang, tgt_lang）
  ↓
【Phase3 启用？】
  ├─ 是 → 两级调度
  │    ├─ 第一级：选择 Pool（搜索包含 src_lang 和 tgt_lang 的 Pool）
  │    └─ 第二级：在 Pool 内选择节点（随机采样 + 负载排序）
  │
  └─ 否 → 单级选择（直接遍历所有节点）
```

### 3.2 代码位置

**节点选择入口**：`src/core/dispatcher/job_selection.rs`
```rust
let p3 = self.node_registry.phase3_config().await;
if p3.enabled && p3.mode == "two_level" {
    // 两级调度
    self.node_registry
        .select_node_with_types_two_level_excluding_with_breakdown(...)
        .await;
} else {
    // 单级选择（回退）
    self.node_registry
        .select_node_with_types_excluding_with_breakdown(...)
        .await;
}
```

---

## 四、Phase3 与 Phase2 的关系

### 4.1 Phase2 和 Phase3 的区别

| 特性 | Phase2 | Phase3 |
|------|--------|--------|
| **作用** | 多实例支持（Redis 同步） | 两级调度（Pool 选择） |
| **依赖** | 需要 Redis | 可选（如果启用 Phase2，Pool 成员从 Redis 读取） |
| **启用** | 配置 `phase2.enabled = true` | 配置 `phase3.enabled = true` |
| **关系** | 可以独立启用 | 可以独立启用，但通常与 Phase2 配合使用 |

### 4.2 组合使用

**推荐配置**（多实例环境）：
```toml
[phase2]
enabled = true  # 启用多实例支持

[phase3]
enabled = true  # 启用两级调度
mode = "two_level"
auto_generate_language_pools = true
```

**效果**：
- Phase2：Pool 成员索引同步到 Redis（多实例一致性）
- Phase3：使用 Pool 机制进行两级调度（性能优化）

---

## 五、Phase3 的关键配置

### 5.1 基本配置

```rust
pub struct Phase3Config {
    /// 是否启用 Phase 3（默认 false）
    pub enabled: bool,
    
    /// 模式：目前仅支持 "two_level"
    pub mode: String,  // "two_level"
    
    /// 是否自动生成语言对 Pool
    pub auto_generate_language_pools: bool,
    
    /// 自动生成 Pool 的配置选项
    pub auto_pool_config: Option<AutoLanguagePoolConfig>,
    
    /// 是否启用 session affinity（默认 false，随机选择）
    pub enable_session_affinity: bool,
    
    /// 随机采样节点数量（默认 20）
    pub random_sample_size: usize,
}
```

### 5.2 自动生成 Pool 配置

```rust
pub struct AutoLanguagePoolConfig {
    /// 最小节点数：如果某个语言集合的节点数少于这个值，不创建 Pool
    pub min_nodes_per_pool: usize,
    
    /// 最大 Pool 数量
    pub max_pools: usize,
    
    /// Pool 命名规则："set"（语言集合模式）
    pub pool_naming: String,  // "set"
    
    /// 是否包含语义修复服务（SEMANTIC）
    pub require_semantic: bool,
    
    /// 是否启用混合池（多对一 Pool）
    pub enable_mixed_pools: bool,
}
```

---

## 六、Phase3 的工作示例

### 6.1 场景：节点注册

1. **节点注册**：节点支持 `{zh, en}` 语言集合
2. **Pool 创建**：自动创建 `en-zh` Pool（如果不存在）
3. **节点分配**：节点被分配到 `en-zh` Pool
4. **Redis 同步**：Pool 成员索引同步到 Redis（如果启用 Phase2）

### 6.2 场景：任务分配

1. **任务请求**：需要 `zh→en` 翻译
2. **Pool 搜索**：搜索所有包含 `zh` 和 `en` 的 Pool
   - 匹配：`en-zh` Pool
   - 匹配：`de-en-zh` Pool（如果存在）
3. **Pool 选择**：随机选择或按配置选择 preferred pool
4. **节点选择**：在选定的 Pool 内随机采样节点，按负载排序
5. **Reservation**：尝试预留节点槽位（Redis Lua 脚本）

---

## 七、常见问题

### Q1: Phase3 必须启用吗？

**A**: 不是必须的。如果禁用，系统会回退到单级选择（直接遍历所有节点）。对于节点数量较少的情况，单级选择可能更简单。

### Q2: Phase3 需要 Redis 吗？

**A**: 不是必须的。但如果启用 Phase2（多实例模式），建议同时启用 Phase3，并且 Pool 成员索引会从 Redis 读取（保持多实例一致性）。

### Q3: Phase3 和 Pool 的关系？

**A**: Phase3 使用 Pool 机制进行两级调度。Pool 可以是：
- **手动配置**：在配置文件中定义 Pool
- **自动生成**：根据节点语言能力自动生成 Pool（`auto_generate_language_pools = true`）

### Q4: 如何验证 Phase3 是否工作？

**A**: 
1. 检查日志：查看是否有 "Phase3 two-level scheduling" 相关日志
2. 检查指标：查看 `phase3_pool_selected` 指标
3. 检查配置：确认 `phase3.enabled = true`

---

## 八、总结

- ✅ **Phase3 是功能模块**，不是独立服务
- ✅ **不需要单独启动**，通过配置启用
- ✅ **默认禁用**，需要显式启用
- ✅ **可以独立使用**，也可以与 Phase2 配合使用
- ✅ **主要作用**：两级调度，优化节点选择性能

---

**最后更新**: 2026-01-XX
