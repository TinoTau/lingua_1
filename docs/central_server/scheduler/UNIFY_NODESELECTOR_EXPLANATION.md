# 统一 NodeSelector 说明文档

## 问题背景

当前调度服务器有两条任务创建路径：
- **Phase1 路径**：本地模式（单实例）
- **Phase2 路径**：跨实例模式（多实例，使用 Redis）

两条路径都有各自的节点选择逻辑，导致**相同条件下可能选择不同的节点**。

---

## 当前问题

### Phase1 路径的节点选择逻辑
**文件**: `job_creation_node_selection.rs` → `select_node_for_job_creation()`

**特点**:
1. **preferred_node_id 验证更严格**：
   - 步骤1：检查节点是否可用
   - 步骤2：检查节点是否支持语言对（`check_node_supports_language_pair()`）
   - 步骤3：检查节点是否具备所需模型能力
   
2. **Fallback 逻辑**：
   - 如果 preferred_node_id 验证失败，回退到模块展开选择
   - 如果第一次选择失败，进行第二次尝试（不排除节点）

3. **返回值**：
   - 返回 `(Option<String>, Option<(&'static str, &'static str)>)`
   - 包含节点ID和指标信息（用于 Prometheus）

### Phase2 路径的节点选择逻辑
**文件**: `phase2_node_selection.rs` → `select_node_for_phase2()`

**特点**:
1. **preferred_node_id 验证较简单**：
   - 只检查节点是否可用（`is_node_available()`）
   - **缺少语言对支持检查**
   - **缺少模型能力检查**

2. **Fallback 逻辑**：
   - 如果 preferred_node_id 不可用，回退到模块展开选择
   - 如果第一次选择失败，进行第二次尝试（不排除节点）

3. **返回值**：
   - 只返回 `Option<String>`
   - 不包含指标信息

---

## 问题影响

### 1. 调度结果不一致
**场景示例**：
- 相同条件：`preferred_node_id = "node-A"`, `src_lang = "zh"`, `tgt_lang = "en"`
- Phase1 路径：检查发现 node-A 不支持 zh→en 语言对，回退选择 node-B
- Phase2 路径：只检查 node-A 是否在线，如果在线就选择 node-A

**结果**：两条路径选择了不同的节点，导致调度不一致。

### 2. 代码重复和维护困难
- 两条路径都有类似的 fallback 逻辑
- 修改节点选择规则需要在两个地方同步修改
- 容易产生逻辑分叉

### 3. 功能缺失
- Phase2 路径缺少语言对验证，可能导致选择不支持的节点
- Phase2 路径缺少模型能力验证，可能导致选择缺少模型的节点

---

## 统一 NodeSelector 的目标

### 核心目标
**确保 Phase1 和 Phase2 路径使用完全相同的节点选择逻辑**

### 具体实现
1. **创建统一的节点选择器模块**
   - 提取公共的节点选择逻辑
   - 包含完整的 preferred_node_id 验证（可用性、语言对、模型能力）

2. **统一 Fallback 策略**
   - 两条路径使用相同的 fallback 逻辑
   - 两次尝试的策略一致

3. **统一返回值**
   - 两条路径返回相同格式的结果
   - 包含必要的指标信息

---

## 实现方案

### 方案1：提取公共函数（推荐）
```rust
// 统一的节点选择逻辑
pub(crate) async fn select_node_unified(
    &self,
    preferred_node_id: Option<String>,
    exclude_node_id: Option<String>,
    preferred_pool: Option<u16>,
    routing_key: &str,
    src_lang: &str,
    tgt_lang: &str,
    features: &Option<FeatureFlags>,
    pipeline: &PipelineConfig,
    snapshot: &Arc<RuntimeSnapshot>,
    // ... 其他参数
) -> (Option<String>, Option<(&'static str, &'static str)>) {
    // 统一的验证逻辑
    // 1. preferred_node_id 完整验证（可用性、语言对、模型能力）
    // 2. 统一的 fallback 逻辑
    // 3. 统一的两次尝试策略
}
```

### 方案2：重构为统一模块
- 创建 `unified_node_selector.rs` 模块
- Phase1 和 Phase2 都调用这个模块
- 保持向后兼容

---

## 预期收益

### 1. 调度一致性 ✅
- 相同条件下，Phase1 和 Phase2 路径选择相同的节点
- 避免因路径不同导致的调度差异

### 2. 功能完整性 ✅
- Phase2 路径也具备完整的节点验证能力
- 避免选择不支持的节点

### 3. 代码质量 ✅
- 消除代码重复
- 单一职责，便于维护
- 修改节点选择逻辑只需改一处

### 4. 可测试性 ✅
- 统一的逻辑更容易编写单元测试
- 测试覆盖更全面

---

## 实施优先级

**优先级**: Medium（中等）

**原因**:
- 不是阻塞性问题（两条路径都能工作）
- 但会影响调度一致性和代码质量
- 建议在完成 High Priority 修复后进行

---

## 实施步骤

1. **分析差异**（已完成）
   - 对比 Phase1 和 Phase2 的节点选择逻辑
   - 识别所有差异点

2. **设计统一接口**
   - 定义统一的函数签名
   - 确定参数和返回值

3. **提取公共逻辑**
   - 将相同的逻辑提取到统一函数
   - 处理差异点（通过参数控制）

4. **重构调用方**
   - Phase1 路径调用统一函数
   - Phase2 路径调用统一函数

5. **测试验证**
   - 确保两条路径行为一致
   - 添加单元测试

---

## 总结

**统一 NodeSelector 的作用**：
1. **确保调度一致性** - 相同条件下选择相同节点
2. **功能完整性** - Phase2 路径也具备完整验证
3. **代码质量** - 消除重复，便于维护
4. **可测试性** - 统一逻辑更容易测试

**当前状态**：待完成（Medium 优先级）

**建议**：在完成 High Priority 修复后，可以统一 NodeSelector 以提升代码质量和调度一致性。
