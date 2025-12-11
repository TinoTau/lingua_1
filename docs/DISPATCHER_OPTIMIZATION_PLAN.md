# 任务分发算法优化与功能感知节点选择方案

> **最后更新**: 2025-12-12  
> **当前状态**: 基础功能已完成 ✅（功能检查完善 + 最少连接数负载均衡）

## 实现状态

### ✅ 已完成（2025-12-12）

#### 1. 功能能力检查完善
- ✅ 完善了 `node_supports_features` 函数，补齐所有 6 个功能位判断：
  - ✅ emotion_detection（情感检测）
  - ✅ voice_style_detection（音色风格检测）
  - ✅ speech_rate_detection（语速检测）
  - ✅ speech_rate_control（语速控制）
  - ✅ speaker_identification（说话人识别）
  - ✅ persona_adaptation（角色适应）

#### 2. 最少连接数负载均衡策略
- ✅ 实现了最少连接数（Least Connections）策略
- ✅ 节点选择逻辑从"选第一个"升级为按 `current_jobs` 最小选择
- ✅ 添加了负载均衡策略配置入口（`[scheduler.load_balancer]`）
- ✅ 添加了单元测试验证负载均衡功能

**实现位置**: 
- `scheduler/src/node_registry.rs::select_node_with_features` - 最少连接数策略
- `scheduler/src/node_registry.rs::node_supports_features` - 完整功能检查
- `scheduler/src/config.rs` - 负载均衡配置结构
- `scheduler/config.toml` - 配置文件

**测试验证**: 
- ✅ 新增 `test_select_node_least_connections` 测试
- ✅ 所有 47 个单元测试通过

### 🔨 待完成

#### 1. 任务分发算法（高级优化）

**当前状态**: 已实现基础的最少连接数策略

**待优化项**:
- ⏳ 资源使用率策略（考虑 CPU/GPU/内存使用率）
- ⏳ 加权轮询策略（根据节点性能加权轮询）
- ⏳ 综合评分策略（综合考虑多个因素）
- ⏳ 历史性能追踪和动态权重调整

#### 2. 功能感知节点选择（高级优化）

**当前状态**: 已实现完整的功能检查

**待优化项**:
- ⏳ 功能匹配优先级排序（优先选择支持更多功能的节点）
- ⏳ 方言匹配（优先选择支持指定方言的节点）
- ⏳ 模型版本匹配（优先选择使用最新版本模型的节点）
- ⏳ 降级策略（部分功能匹配时的处理）

## 优化方案

### 方案一：负载均衡算法优化

#### 1.1 负载均衡策略

实现多种负载均衡策略，可通过配置选择：

**策略类型**:
1. **最少连接数（Least Connections）** - 选择当前任务数最少的节点
2. **资源使用率（Resource Usage）** - 选择 CPU/GPU/内存使用率最低的节点
3. **加权轮询（Weighted Round Robin）** - 根据节点性能加权轮询
4. **综合评分（Composite Score）** - 综合考虑多个因素

#### 1.2 节点评分系统

为每个节点计算综合评分，选择评分最高的节点：

**评分因素**:
- **负载因子** (0-1): `current_jobs / max_concurrent_jobs`
- **CPU 使用率** (0-1): `cpu_usage / 100.0`
- **GPU 使用率** (0-1): `gpu_usage.unwrap_or(0.0) / 100.0`
- **内存使用率** (0-1): `memory_usage / 100.0`
- **可用容量** (0-1): `(max_concurrent_jobs - current_jobs) / max_concurrent_jobs`

**综合评分公式**:
```
score = w1 * (1 - load_factor) + 
        w2 * (1 - cpu_usage) + 
        w3 * (1 - gpu_usage) + 
        w4 * (1 - memory_usage) + 
        w5 * available_capacity
```

其中 `w1 + w2 + w3 + w4 + w5 = 1.0`，权重可配置。

#### 1.3 实现步骤

1. 在 `config.toml` 中添加负载均衡配置
2. 在 `node_registry.rs` 中实现评分函数
3. 修改 `select_node_with_features` 使用评分系统
4. 添加配置选项选择负载均衡策略

### 方案二：功能感知节点选择完善

#### 2.1 完整功能检查

完善 `node_supports_features` 函数，检查所有功能：

**需要检查的功能**:
- ✅ emotion_detection
- ✅ voice_style_detection
- ✅ speech_rate_detection
- ✅ speech_rate_control
- ✅ speaker_identification
- ✅ persona_adaptation
- ⏳ voice_cloning (如果将来添加)

#### 2.2 功能匹配优先级

实现多级匹配策略：

**优先级顺序**:
1. **完全匹配** - 支持所有必需功能，且资源充足
2. **功能匹配** - 支持所有必需功能，但资源紧张
3. **部分匹配** - 支持部分功能（降级处理）
4. **基础匹配** - 只支持核心功能（ASR/NMT/TTS）

#### 2.3 方言和模型版本匹配

**方言匹配**:
- 优先选择支持指定方言的节点
- 如果没有匹配的方言，回退到通用语言模型

**模型版本匹配**:
- 优先选择使用最新版本模型的节点
- 考虑模型兼容性

#### 2.4 实现步骤

1. 完善 `node_supports_features` 函数，检查所有功能
2. 实现功能匹配评分系统
3. 添加方言匹配逻辑
4. 添加模型版本匹配逻辑
5. 实现多级匹配和降级策略

## 详细实现计划

### 阶段 1：配置扩展

**文件**: `scheduler/src/config.rs`, `scheduler/config.toml`

**新增配置项**:
```toml
[scheduler.load_balancer]
# 负载均衡策略: "least_connections" | "resource_usage" | "weighted_round_robin" | "composite"
strategy = "composite"

# 综合评分权重（仅当 strategy = "composite" 时生效）
[scheduler.load_balancer.weights]
load_factor = 0.3      # 负载因子权重
cpu_usage = 0.2        # CPU 使用率权重
gpu_usage = 0.2        # GPU 使用率权重
memory_usage = 0.1     # 内存使用率权重
available_capacity = 0.2  # 可用容量权重

# 功能匹配配置
[scheduler.feature_matching]
# 是否允许部分功能匹配（降级处理）
allow_partial_match = true
# 是否优先选择支持更多功能的节点
prefer_more_features = true
# 是否考虑方言匹配
match_dialect = true
# 是否考虑模型版本
match_model_version = false  # 暂时关闭，待模型版本管理完善后启用
```

### 阶段 2：节点评分系统

**文件**: `scheduler/src/node_registry.rs`

**新增结构**:
```rust
#[derive(Debug, Clone)]
pub struct NodeScore {
    pub node_id: String,
    pub score: f32,
    pub load_factor: f32,
    pub resource_usage: f32,
    pub available_capacity: f32,
}

#[derive(Debug, Clone, Copy)]
pub enum LoadBalancerStrategy {
    LeastConnections,
    ResourceUsage,
    WeightedRoundRobin,
    Composite {
        weights: ScoreWeights,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct ScoreWeights {
    pub load_factor: f32,
    pub cpu_usage: f32,
    pub gpu_usage: f32,
    pub memory_usage: f32,
    pub available_capacity: f32,
}
```

**新增方法**:
```rust
impl NodeRegistry {
    // 计算节点评分
    fn calculate_node_score(
        &self,
        node: &Node,
        strategy: LoadBalancerStrategy,
    ) -> f32 {
        match strategy {
            LoadBalancerStrategy::LeastConnections => {
                // 最少连接数：选择 current_jobs 最少的
                -(node.current_jobs as f32)
            }
            LoadBalancerStrategy::ResourceUsage => {
                // 资源使用率：选择资源使用率最低的
                let cpu = node.cpu_usage / 100.0;
                let gpu = node.gpu_usage.unwrap_or(0.0) / 100.0;
                let mem = node.memory_usage / 100.0;
                -(cpu + gpu + mem) / 3.0
            }
            LoadBalancerStrategy::Composite { weights } => {
                // 综合评分
                let load_factor = node.current_jobs as f32 / node.max_concurrent_jobs as f32;
                let cpu_usage = node.cpu_usage / 100.0;
                let gpu_usage = node.gpu_usage.unwrap_or(0.0) / 100.0;
                let memory_usage = node.memory_usage / 100.0;
                let available_capacity = 
                    (node.max_concurrent_jobs - node.current_jobs) as f32 
                    / node.max_concurrent_jobs as f32;
                
                weights.load_factor * (1.0 - load_factor) +
                weights.cpu_usage * (1.0 - cpu_usage) +
                weights.gpu_usage * (1.0 - gpu_usage) +
                weights.memory_usage * (1.0 - memory_usage) +
                weights.available_capacity * available_capacity
            }
            _ => 0.0,
        }
    }
    
    // 功能匹配评分
    fn calculate_feature_match_score(
        &self,
        node: &Node,
        required_features: &Option<FeatureFlags>,
    ) -> (f32, bool) {
        // 返回 (匹配度 0-1, 是否完全匹配)
        // 实现逻辑...
    }
}
```

### 阶段 3：完善功能检查

**文件**: `scheduler/src/node_registry.rs`

**完善 `node_supports_features`**:
```rust
fn node_supports_features(
    &self,
    node: &Node,
    required_features: &Option<FeatureFlags>,
) -> bool {
    if let Some(ref features) = required_features {
        // 检查所有功能
        if features.emotion_detection == Some(true)
            && node.features_supported.emotion_detection != Some(true) {
            return false;
        }
        if features.voice_style_detection == Some(true)
            && node.features_supported.voice_style_detection != Some(true) {
            return false;
        }
        if features.speech_rate_detection == Some(true)
            && node.features_supported.speech_rate_detection != Some(true) {
            return false;
        }
        if features.speech_rate_control == Some(true)
            && node.features_supported.speech_rate_control != Some(true) {
            return false;
        }
        if features.speaker_identification == Some(true)
            && node.features_supported.speaker_identification != Some(true) {
            return false;
        }
        if features.persona_adaptation == Some(true)
            && node.features_supported.persona_adaptation != Some(true) {
            return false;
        }
        // 预留：voice_cloning
    }
    true
}
```

### 阶段 4：优化节点选择逻辑

**文件**: `scheduler/src/node_registry.rs`

**优化 `select_node_with_features`**:
```rust
pub async fn select_node_with_features(
    &self,
    src_lang: &str,
    tgt_lang: &str,
    dialect: &Option<String>,
    required_features: &Option<FeatureFlags>,
    accept_public: bool,
    strategy: LoadBalancerStrategy,
) -> Option<String> {
    let nodes = self.nodes.read().await;
    
    // 1. 筛选符合条件的节点
    let mut candidate_nodes: Vec<_> = nodes
        .values()
        .filter(|node| {
            node.online
                && node.current_jobs < node.max_concurrent_jobs
                && (accept_public || !node.accept_public_jobs)
                && self.node_has_required_models(node, src_lang, tgt_lang, dialect)
                && self.node_supports_features(node, required_features)
        })
        .collect();
    
    if candidate_nodes.is_empty() {
        return None;
    }
    
    // 2. 计算每个节点的评分
    let mut scored_nodes: Vec<_> = candidate_nodes
        .iter()
        .map(|node| {
            let base_score = self.calculate_node_score(node, strategy);
            let (feature_score, _) = self.calculate_feature_match_score(node, required_features);
            // 综合评分：基础评分 + 功能匹配加分
            let final_score = base_score + feature_score * 0.1; // 功能匹配占10%权重
            
            (node.node_id.clone(), final_score)
        })
        .collect();
    
    // 3. 按评分排序，选择评分最高的节点
    scored_nodes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    
    Some(scored_nodes[0].0.clone())
}
```

### 阶段 5：方言和模型匹配

**文件**: `scheduler/src/node_registry.rs`

**增强 `node_has_required_models`**:
```rust
fn node_has_required_models(
    &self,
    node: &Node,
    src_lang: &str,
    tgt_lang: &str,
    dialect: &Option<String>,
) -> bool {
    // 检查核心模型
    let has_asr = node.installed_models.iter().any(|m| m.kind == "asr");
    let has_nmt = node.installed_models.iter().any(|m| {
        m.kind == "nmt"
            && m.src_lang.as_deref() == Some(src_lang)
            && m.tgt_lang.as_deref() == Some(tgt_lang)
            && (dialect.is_none() || m.dialect.as_deref() == dialect.as_deref())
    });
    let has_tts = node.installed_models.iter().any(|m| {
        m.kind == "tts" && m.tgt_lang.as_deref() == Some(tgt_lang)
    });
    
    has_asr && has_nmt && has_tts
}
```

## 实施优先级

### 高优先级（立即实施）

1. ✅ **完善功能检查** - 检查所有功能（speaker_identification, persona_adaptation, speech_rate_control）
2. ✅ **实现最少连接数策略** - 最简单的负载均衡策略
3. ✅ **实现综合评分系统** - 基础的负载均衡

### 中优先级（后续优化）

4. ⏳ **实现资源使用率策略** - 考虑 CPU/GPU/内存
5. ⏳ **实现功能匹配评分** - 优先选择支持更多功能的节点
6. ⏳ **实现方言匹配** - 优先选择支持指定方言的节点

### 低优先级（长期优化）

7. ⏳ **实现加权轮询策略** - 需要历史性能数据
8. ⏳ **实现模型版本匹配** - 需要完善的模型版本管理
9. ⏳ **实现降级策略** - 部分功能匹配时的处理
10. ⏳ **实现综合评分系统** - 综合考虑多个因素的负载均衡

## 测试状态

### ✅ 已完成的测试

- ✅ 功能检查测试 - 验证所有 6 个功能位的检查逻辑
- ✅ 最少连接数策略测试 - 验证在多节点场景下选择负载最轻的节点
- ✅ 所有现有单元测试通过（47个测试）

**测试文件**: `scheduler/tests/stage1.1/node_registry_test.rs`
- `test_select_node_least_connections` - 验证最少连接数策略

## 测试计划（未来）

### 单元测试

1. **节点评分测试**
   - 测试不同负载均衡策略的评分计算
   - 测试权重配置的影响

2. **功能匹配测试**
   - 测试所有功能的检查逻辑
   - 测试功能匹配评分

3. **节点选择测试**
   - 测试多节点场景下的选择逻辑
   - 测试边界情况（所有节点满载、无匹配节点等）

### 集成测试

1. **负载均衡效果测试**
   - 模拟多个节点和多个任务
   - 验证任务是否均匀分布

2. **功能匹配测试**
   - 测试不同功能需求下的节点选择
   - 验证优先级排序是否正确

## 配置示例

### ✅ 当前实现（最少连接数）

```toml
[scheduler.load_balancer]
strategy = "least_connections"
```

**说明**: 这是当前已实现的策略，系统会优先选择 `current_jobs` 最少的节点。配置已添加到 `scheduler/config.toml`。

### ⏳ 未来扩展（综合评分）

```toml
[scheduler.load_balancer]
strategy = "composite"

[scheduler.load_balancer.weights]
load_factor = 0.4
cpu_usage = 0.2
gpu_usage = 0.2
memory_usage = 0.1
available_capacity = 0.1

[scheduler.feature_matching]
allow_partial_match = false
prefer_more_features = true
match_dialect = true
```

## 性能考虑

1. **计算复杂度**: O(n) - n 为节点数量，可接受
2. **内存开销**: 最小，只存储评分结果
3. **并发安全**: 使用 `RwLock` 保证线程安全

## 后续扩展

1. **历史性能追踪** - 记录节点的平均处理时间、成功率等
2. **动态权重调整** - 根据历史数据自动调整权重
3. **节点分组** - 支持节点分组，实现更细粒度的负载均衡
4. **地理位置感知** - 考虑节点地理位置，优先选择就近节点

