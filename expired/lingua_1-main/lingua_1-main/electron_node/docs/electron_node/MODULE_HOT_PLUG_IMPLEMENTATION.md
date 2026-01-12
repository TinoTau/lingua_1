# 节点端功能热插拔实现状态分析

## 概述

本文档分析节点端功能热插拔（模块热插拔）的实现状态，对比产品说明文档（`docs/modular/LINGUA_完整技术说明书_v2.md`）的要求。

## ✅ 已实现的功能

### 1. ModuleMetadata 作为唯一可信源（SSOT）✅

**实现位置**: `node-inference/src/modules.rs`

- ✅ `MODULE_TABLE` 静态表定义了所有模块的元数据
- ✅ 包含模块依赖、冲突、模型需求、输出字段
- ✅ 模块元数据结构完整：
  ```rust
  pub struct ModuleMetadata {
      pub module_name: String,
      pub required_models: Vec<ModelRequirement>,
      pub dependencies: Vec<String>,
      pub conflicts: Vec<String>,
      pub outputs: Vec<String>,
  }
  ```

**已定义的模块**：
- `emotion_detection` - 情感检测
- `speaker_identification` - 音色识别
- `voice_cloning` - 音色克隆
- `speech_rate_detection` - 语速识别
- `speech_rate_control` - 语速控制
- `persona_adaptation` - 个性化适配

### 2. 模块 enable() 的正式流程 ✅

**实现位置**: `node-inference/src/modules.rs` - `ModuleManager::enable_module()`

**实现步骤**：
1. ✅ 检查模块元数据是否存在（从 `MODULE_TABLE` 获取）
2. ✅ 检查依赖循环（`check_dependency_cycle()`）
3. ✅ 检查冲突模块（`check_conflicts()`）
4. ✅ 检查模块依赖（`check_dependencies()`）
5. ✅ 检查所需模型是否可用（通过 `ModelPathProvider`）
6. ✅ 更新模块状态（`enabled = true`, `last_used = now()`）

**代码位置**: `node-inference/src/modules.rs:95-157`

### 3. 根据任务请求动态启用模块 ✅

**实现位置**: `node-inference/src/inference.rs` - `InferenceService::process()`

**实现逻辑**：
```rust
// 根据请求中的 features 自动启用所需模块（运行时动态启用）
if let Some(ref features) = request.features {
    if features.speaker_identification {
        let _ = self.enable_module("speaker_identification").await;
    }
    if features.voice_cloning {
        let _ = self.enable_module("voice_cloning").await;
    }
    // ... 其他模块
}
```

**特点**：
- ✅ 每个请求都会检查并启用所需模块
- ✅ 如果模块已启用，不会重复加载
- ✅ 如果启用失败，不会阻塞核心流程（使用 `let _ =` 忽略错误）

**代码位置**: `node-inference/src/inference.rs:228-250`

### 4. 模块状态跟踪 ✅

**实现位置**: `node-inference/src/modules.rs`

- ✅ `ModuleState` 结构包含：
  - `enabled: bool` - 是否启用
  - `model_loaded: bool` - 模型是否已加载
  - `last_used: Option<DateTime<Utc>>` - 最后使用时间

- ✅ 每次启用模块时更新 `last_used` 时间戳

### 5. 模块依赖检查 ✅

**实现位置**: `node-inference/src/modules.rs`

- ✅ `check_dependencies()` - 检查模块依赖
- ✅ `check_dependency_cycle()` - 检查依赖循环
- ✅ `check_conflicts()` - 检查模块冲突

### 6. PipelineContext 统一输入输出结构 ✅

**实现位置**: `node-inference/src/pipeline.rs`

- ✅ 所有模块使用统一的 `PipelineContext`
- ✅ 模块通过 `ctx.set_*()` 和 `ctx.get_*()` 读写数据
- ✅ 确保数据流一致性

---

## ⚠️ 部分实现的功能

### 1. 模块生命周期管理（cold-load + warm-keep）⚠️

**文档要求**：
- 默认 cold，不加载模型
- enable_module 时加载
- 每次执行刷新 last_used
- 后台定时器扫描超过 X 分钟未使用的模块模型 → unload
- ASR/NMT 模型永不卸载（核心模块）

**当前实现状态**：

#### ✅ 已实现：
- ✅ 每次执行刷新 `last_used`（在 `enable_module()` 中更新）
- ✅ ASR/NMT/TTS 核心模块始终启用（不参与热插拔）

#### ⚠️ 部分实现：
- ⚠️ **Cold-load**: 代码中有注释提到，但模块需要预先初始化
  - 当前：模块在 `InferenceService::new()` 时初始化（不是真正的 cold-load）
  - 代码位置：`node-inference/src/inference.rs:136-138`
  ```rust
  // 模块未初始化，尝试创建（cold-load）
  // TODO: 实现模块的延迟初始化逻辑
  return Err(anyhow::anyhow!("Module {} not initialized..."));
  ```

#### ❌ 未实现：
- ❌ **自动卸载机制**: 没有后台定时器扫描未使用的模块并卸载
- ❌ **模块延迟初始化**: 模块需要在服务启动时初始化，不能按需创建

**影响**：
- 模块在服务启动时就会占用内存（即使未启用）
- 无法自动释放长时间未使用的模块内存
- 不符合文档要求的"cold-load"策略

---

## ❌ 未实现的功能

### 1. 模块自动卸载机制 ❌

**文档要求**：
> 后台定时器扫描超过 X 分钟未使用的模块模型 → unload

**当前状态**：
- ❌ 没有后台定时器
- ❌ 没有自动卸载逻辑
- ❌ `last_used` 字段已记录，但未使用

**需要实现**：
1. 后台定时任务（例如每 5 分钟扫描一次）
2. 检查所有模块的 `last_used` 时间
3. 如果超过阈值（例如 30 分钟），调用 `disable_module()` 并卸载模型
4. 排除核心模块（ASR/NMT/TTS）

### 2. 模块延迟初始化（真正的 cold-load）❌

**文档要求**：
> 默认 cold，不加载模型

**当前状态**：
- ❌ 模块在 `InferenceService::new()` 时初始化
- ❌ 即使未启用，模块对象也已创建

**需要实现**：
1. 模块对象延迟创建（`Option<Arc<RwLock<Module>>>`）
2. 首次 `enable_module()` 时创建模块对象
3. 卸载时释放模块对象（设置为 `None`）

---

## 📊 实现完成度统计

| 功能 | 文档要求 | 实现状态 | 完成度 |
|------|---------|---------|--------|
| ModuleMetadata (SSOT) | ✅ 必须 | ✅ 已实现 | 100% |
| enable() 正式流程 | ✅ 必须 | ✅ 已实现 | 100% |
| 依赖检查 | ✅ 必须 | ✅ 已实现 | 100% |
| 冲突检查 | ✅ 必须 | ✅ 已实现 | 100% |
| 模型可用性检查 | ✅ 必须 | ✅ 已实现 | 100% |
| 动态启用（根据 features） | ✅ 必须 | ✅ 已实现 | 100% |
| PipelineContext | ✅ 必须 | ✅ 已实现 | 100% |
| last_used 跟踪 | ✅ 必须 | ✅ 已实现 | 100% |
| Cold-load | ✅ 推荐 | ⚠️ 部分实现 | 30% |
| 自动卸载 | ✅ 推荐 | ❌ 未实现 | 0% |
| 延迟初始化 | ✅ 推荐 | ❌ 未实现 | 0% |

**核心功能完成度**: **100%** ✅  
**生命周期管理完成度**: **约 30%** ⚠️  
**总体完成度**: **约 85%**

---

## 🔧 实现细节

### 1. 模块启用流程

```
用户请求（features）
  ↓
InferenceService::process()
  ↓
检查 features
  ↓
调用 enable_module("module_name")
  ↓
ModuleManager::enable_module()
  ├─ 检查模块元数据（MODULE_TABLE）
  ├─ 检查依赖循环
  ├─ 检查冲突模块
  ├─ 检查模块依赖
  ├─ 检查模型可用性
  └─ 更新模块状态（enabled=true, last_used=now）
  ↓
InferenceService::enable_module()
  ├─ 调用具体模块的 enable()
  └─ 加载模型
  ↓
模块可用，处理请求
```

### 2. 模块状态管理

**ModuleState 结构**：
```rust
pub struct ModuleState {
    pub enabled: bool,           // 是否启用
    pub model_loaded: bool,      // 模型是否已加载
    pub last_used: Option<DateTime<Utc>>,  // 最后使用时间
}
```

**状态转换**：
- `未启用` → `启用中` → `已启用`（模型已加载）
- `已启用` → `禁用中` → `未启用`（模型卸载）

### 3. 模块依赖展开

**示例**：
- 用户请求 `voice_cloning`
- 系统检查依赖：`voice_cloning` → `speaker_identification`
- 自动启用 `speaker_identification`
- 然后启用 `voice_cloning`

**实现位置**: `node-inference/src/modules.rs:107` - `check_dependencies()`

---

## 📝 需要补充的实现

### 优先级 P0（必须实现）

1. **模块自动卸载机制**
   - 实现后台定时器（每 5 分钟扫描一次）
   - 检查 `last_used` 时间
   - 超过阈值（30 分钟）自动卸载
   - 排除核心模块

### 优先级 P1（重要）

2. **模块延迟初始化（真正的 cold-load）**
   - 模块对象改为 `Option<Arc<RwLock<Module>>>`
   - 首次 `enable_module()` 时创建
   - 卸载时释放对象

### 优先级 P2（优化）

3. **模块卸载时的资源清理**
   - 确保模型内存完全释放
   - 清理临时文件
   - 重置模块状态

---

## ✅ 总结

### 已实现的核心功能
- ✅ ModuleMetadata 作为 SSOT
- ✅ enable() 正式流程（完整检查链）
- ✅ 根据请求动态启用模块
- ✅ 模块依赖和冲突检查
- ✅ PipelineContext 统一数据流
- ✅ 模块状态跟踪（last_used）

### 部分实现的功能
- ⚠️ 模块生命周期管理（缺少自动卸载）

### 未实现的功能
- ❌ 模块自动卸载机制
- ❌ 模块延迟初始化（真正的 cold-load）

### 结论

**核心功能热插拔机制已实现**，包括：
- 模块元数据管理（SSOT）
- 模块启用流程（完整检查）
- 动态启用（根据请求）
- 依赖和冲突检查

**生命周期管理部分实现**，缺少：
- 自动卸载机制
- 真正的 cold-load（延迟初始化）

**建议**：
1. 优先实现自动卸载机制（P0）
2. 然后实现延迟初始化（P1）
3. 这样可以完全符合文档要求，并优化内存使用

---

## 相关文档

- [产品技术说明书](../modular/LINGUA_完整技术说明书_v2.md) - 完整的技术规范
- [功能对比分析](./FEATURE_COMPARISON.md) - Electron 端功能对比
