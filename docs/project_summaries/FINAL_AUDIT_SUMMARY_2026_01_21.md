# Pool 系统审计最终总结

**审计完成日期**: 2026-01-21  
**提交给**: 决策部门  
**紧急程度**: P0

---

## 执行摘要

经过全面审计，发现调度服务器存在**新旧两套 Pool 系统**，且**新系统缺失旧系统的关键功能**。

### 核心结论

**不能简单地删除旧系统！**

原因：
1. ✅ 旧系统有服务能力检查（ASR/NMT/TTS/Semantic）
2. ✅ 旧系统有 Semantic 语言验证
3. ✅ 旧系统有服务热插拔支持
4. ✅ 旧系统有 Session Affinity（AudioAggregator 需要）

---

## 一、当前状态

### 新旧系统对比

| 项目 | 旧系统 (phase3_pool) | 新系统 (PoolService) |
|------|---------------------|---------------------|
| **代码量** | 3500 行 | 260 行 |
| **服务能力检查** | ✅ | ❌ |
| **Semantic 检查** | ✅ | ❌ |
| **服务热插拔** | ✅ | ❌ |
| **Session Affinity** | ✅ | ❌ |
| **Job Affinity** | ❌ | ✅ |
| **代码清晰度** | 低 | 高 |
| **使用状态** | 部分使用 | 部分使用 |

### 当前使用情况

```
节点注册：✅ 新系统
节点心跳：✅ 新系统
任务调度：🔴 旧系统（dispatch_task.lua）
```

### 编译状态

🔴 **当前无法编译**

原因：
- `NodeRegistry` 仍依赖旧的 phase3_pool 模块
- `language_capability_index` 模块被引用但未定义
- `phase3_core_cache` 模块被引用但未定义

---

## 二、关键发现（从测试文件）

### 发现 1：服务能力检查是必需的

**测试证据**: `phase3_pool_allocation_test.rs`

```rust
// 测试场景
节点1：有 Semantic 服务，支持 ["zh", "en"] → ✅ 加入 Pool
节点2：无 Semantic 服务 → ❌ 不能加入 Pool
节点3：有 Semantic，但只支持 ["zh"] → ❌ 不能加入 Pool
```

**结论**: 旧系统会验证：
1. 节点是否安装了必需的服务
2. 每个服务是否就绪（ready: true）
3. Semantic 支持的语言是否匹配

### 发现 2：服务热插拔是有用的

**测试证据**: `phase3_pool_heartbeat_test.rs`

```rust
// 测试场景
节点初始：["zh", "en"] → Pool "en-zh"
心跳更新：["zh", "en", "de"] → 重新分配到 Pool "de-en-zh"
```

**结论**: 旧系统支持心跳时检查能力变化并重新分配 Pool。

### 发现 3：Session Affinity 有明确用途

**代码证据**: `dispatch_task.lua:84-114, 175`

```lua
-- 查询会话绑定的节点
local timeout_node_id = redis.call("HGET", session_key, "timeout_node_id")

-- 优先选择这个节点（AudioAggregator 连续性）
if timeout_node_id then
    chosen_node_id = timeout_node_id
end
```

**用途**: 支持 AudioAggregator 的流式切分逻辑。

---

## 三、需要确认的问题

### 给服务端团队

**Q1**: 当前 `NodeRegistry` 仍依赖旧模块，这些模块的作用是什么？
- `language_capability_index` - 语言能力索引
- `phase3_core_cache` - Pool 核心缓存
- `phase3_pool_constants` - Pool 常量

**Q2**: 这些模块是否可以删除？还是某些功能仍在使用？

### 给节点端团队

**Q3**: 节点端能否保证：
- [ ] 只在 ASR+NMT+TTS 都就绪时上报 `supported_language_pairs`？
- [ ] Semantic 语言完整性？
- [ ] 服务故障时自动断开连接？
- [ ] 能力变化时重新连接？

### 给 AudioAggregator 团队

**Q4**: AudioAggregator 是否必须在同一节点连续处理？
- [ ] 必须（需要 Session Affinity）
- [ ] 不必须（Job Affinity 够用）

---

## 四、三个路径

### 路径 A：完整重构（2-3 天）

**适用场景**：
- 节点端无法保证服务完整性
- 需要服务热插拔
- 需要 Session Affinity

**工作内容**：
1. 补充新系统功能（服务检查、热插拔、Session Affinity）
2. 清理旧模块
3. 测试验证

**代码量**：~800 行  
**风险**：低  
**收益**：代码减少 78%（3500→800）

---

### 路径 B：极简重构 + 节点端保证（1 天）✅ 推荐

**适用场景**：
- 节点端能保证服务完整性
- 可接受服务热插拔需要重连
- AudioAggregator 不需要 Session Affinity

**工作内容**：
1. 补充文档（节点端规范）
2. 修复编译错误（移除对旧模块的依赖）
3. 完成调度集成
4. 清理旧代码

**代码量**：260 行  
**风险**：中（依赖节点端）  
**收益**：代码减少 93%（3500→260）

---

### 路径 C：暂停重构（0 天）

**适用场景**：
- 不确定
- 不想冒险

**工作内容**：
1. 回滚新系统代码
2. 恢复旧系统
3. 维持现状

**代码量**：3500 行  
**风险**：无  
**收益**：无（技术债务持续）

---

## 五、编译错误分析

### 当前错误

```
error: unresolved import `crate::node_registry::phase3_pool_constants`
error: could not find `phase3_core_cache` in `node_registry`
error: could not find `language_capability_index` in `node_registry`
error: no method `phase3_upsert_node_to_pool_index_with_runtime`
```

### 原因

`NodeRegistry` 仍然依赖旧的 phase3_pool 模块：
- `language_capability_index` - 语言能力索引
- `phase3_core_cache` - Pool 核心缓存
- 多个 `phase3_*` 方法

### 解决方案

#### 如果选择路径 B（极简）

1. **移除依赖**：
   - 从 `NodeRegistry` 移除 `language_capability_index`
   - 从 `NodeRegistry` 移除 `phase3_core_cache`
   - 移除所有 `phase3_*` 方法

2. **清理引用**：
   - 更新 `core.rs`
   - 更新 `selection/*.rs`
   - 更新其他引用这些方法的地方

**工作量**：2-3 小时（清理依赖）

#### 如果选择路径 C（暂停）

回滚所有更改，恢复旧系统。

---

## 六、决策请求

### 需要决策部门明确

1. **选择哪个路径？**
   - [ ] 路径 A（完整重构）
   - [ ] 路径 B（极简重构）
   - [ ] 路径 C（暂停重构）

2. **如果选择路径 B，节点端团队能否承诺**：
   - [ ] 实现服务完整性保证
   - [ ] 实现服务故障处理
   - [ ] 实现能力变化重连

3. **AudioAggregator 团队能否确认**：
   - [ ] AudioAggregator 是否需要 Session Affinity
   - [ ] 还是 Job Affinity 已够用

### 时间紧迫

当前代码**无法编译**，需要尽快决策：
- ✅ 继续完成重构（修复编译错误）
- ❌ 回滚更改（恢复旧系统）

---

## 七、相关文档

### 必读

1. [决策请求](./POOL_MIGRATION_DECISION_REQUIRED.md) - 5个问题，需要回答
2. [旧系统分析](./POOL_OLD_SYSTEM_ANALYSIS.md) - 理解旧系统逻辑
3. [节点端规范](./NODE_CLIENT_CAPABILITY_REQUIREMENTS.md) - 如果选路径B

### 参考

4. [修订审计报告](./SCHEDULER_AUDIT_REVISED_2026_01_21.md) - 完整技术分析
5. [可视化对比](./POOL_SYSTEM_COMPARISON_VISUAL.md) - 图表对比

---

## 八、下一步行动

### 立即（今天）

1. **召开技术讨论会**（1 小时）
   - 参与人：服务端、节点端、AudioAggregator 负责人
   - 目标：回答 Q1-Q4

2. **决策部门审批**（30 分钟）
   - 选择路径 A/B/C

3. **开始执行**
   - 路径 A：2-3 天
   - 路径 B：1 天
   - 路径 C：回滚（2 小时）

---

## 总结

### 核心问题

**新系统代码虽简洁，但功能不完整。**

### 核心决策

**谁来保证服务能力的完整性？**
- 服务端检查 → 路径 A（~800 行代码）
- 节点端保证 → 路径 B（~260 行代码）
- 都不确定 → 路径 C（保持现状）

### 推荐

**路径 B（极简重构）+ 节点端保证**

前提：
- ✅ 节点端能承担责任
- ✅ AudioAggregator 不需要 Session Affinity

收益：
- ✅ 代码减少 93%
- ✅ 维护成本降低 80%
- ✅ 逻辑清晰易懂

---

**报告完成**: 2026-01-21  
**审计人**: AI Assistant  
**状态**: ⚠️  等待决策和技术确认
