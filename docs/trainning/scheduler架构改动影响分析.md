# Scheduler 架构改动影响分析
## 方言 ASR/TTS 训练模块实现评估

> 基于文档：
> - `方言_ASR_TTS_用户参与式训练模块_产品说明与风险评估_决策版.md`
> - `方言_ASR_TTS_共享训练池_单卡节点_整合方案.md`

---

## 1. 执行摘要

**结论：需要中等规模的架构改动，但可以复用现有基础设施**

- ✅ **不需要大规模重构**：现有 JobDispatcher、NodeRegistry、Phase2 Redis 等核心组件可以复用
- ⚠️ **需要扩展任务类型**：当前 Job 仅支持推理任务，需要新增训练任务类型
- ⚠️ **需要新增训练专用模块**：训练链管理、结果聚合、门禁评估等
- ✅ **Phase2 Redis 基础设施已就绪**：可用于训练任务状态管理

---

## 2. 当前 Scheduler 架构分析

### 2.1 核心组件

```
Scheduler
├── JobDispatcher          # 任务调度器（当前仅支持推理任务）
├── NodeRegistry          # 节点注册表（支持节点选择、负载均衡）
├── Phase2Runtime         # Redis 多实例支持（已实现）
├── SessionManager        # 会话管理
├── timeout::JobTimeout   # 任务超时管理（当前30秒超时）
└── websocket handlers    # WebSocket 消息处理
```

### 2.2 当前 Job 类型

```rust
pub struct Job {
    // 推理任务专用字段
    pub session_id: String,
    pub utterance_index: u64,
    pub src_lang: String,
    pub tgt_lang: String,
    pub pipeline: PipelineConfig,  // ASR/NMT/TTS pipeline
    pub audio_data: Vec<u8>,       // 音频输入
    // ...
    pub status: JobStatus,         // Pending/Assigned/Processing/Completed/Failed
}
```

**特点**：
- 短时任务（几秒到几十秒）
- 实时推理（ASR/NMT/TTS pipeline）
- 单次执行，无链式依赖
- 超时时间：30秒（`job_timeout_seconds = 30`）

---

## 3. 训练任务需求分析

### 3.1 训练任务特征（来自文档）

| 维度 | 推理任务（当前） | 训练任务（需求） |
|------|----------------|----------------|
| **执行时长** | 几秒~几十秒 | **1小时 timebox** |
| **任务类型** | 实时推理 | **模型训练（LoRA/Adapter）** |
| **输入数据** | 音频流 | **数据集版本（manifest + shard）** |
| **输出结果** | 文本/音频 | **Adapter 权重 + 训练指标** |
| **任务依赖** | 无 | **训练链（多个1h job串成run）** |
| **资源占用** | 短期GPU | **长期独占GPU（1小时）** |
| **结果处理** | 直接返回 | **需要聚合（多节点adapter合并）** |
| **状态管理** | 简单状态机 | **复杂状态机（可取消、可恢复、可审计）** |

### 3.2 训练任务核心需求

#### 3.2.1 训练 Job 输入
```rust
TrainingJob {
    dialect_id: String,
    dataset_version: String,      // manifest + shard
    base_model_version: String,
    adapter_version: Option<String>,
    timebox: u64,                  // 3600秒
    resource_profile: String,
    training_run_id: String,        // 训练链ID
    job_index_in_run: u32,         // 在训练链中的序号
}
```

#### 3.2.2 训练 Job 输出
```rust
TrainingJobResult {
    adapter_weights: Vec<u8>,       // LoRA/Adapter 权重
    training_metrics: TrainingMetrics,
    data_used_summary: DataSummary,
    checkpoint_path: Option<String>,
}
```

#### 3.2.3 训练链管理
- 多个 1h job 串成一条 `TrainingRun`
- 每 6-12 个 job 产生候选版本
- 需要支持链式状态管理（暂停、恢复、取消）

#### 3.2.4 结果聚合与门禁
- 多节点训练结果聚合（Adapter 合并）
- 快速评估门禁（CER/WER 或可用性检查）
- TTS 专属止损机制（合成测试 + ASR 反识别）

#### 3.2.5 节点信誉与配额
- 节点信誉评分（用于反刷奖励/投毒）
- 训练任务配额管理
- 低信誉节点结果仅进入实验分支

---

## 4. 架构改动评估

### 4.1 需要新增的模块（中等规模）

#### ✅ **可以复用现有基础设施**

1. **NodeRegistry** - 可以复用
   - 节点选择逻辑可以复用
   - 需要扩展：支持训练任务节点过滤（GPU可用性、训练能力标识）

2. **Phase2 Redis** - 可以复用
   - Job FSM 可以扩展支持训练任务状态
   - Redis Streams 可以用于训练任务消息传递
   - 需要扩展：训练任务专用 Redis key 空间

3. **WebSocket 通信** - 可以复用
   - 节点通信协议可以扩展
   - 需要新增：训练任务专用消息类型

#### ⚠️ **需要新增的模块**

1. **TrainingJobDispatcher**（新模块）
   - 训练任务创建、调度、状态管理
   - 训练链（TrainingRun）管理
   - 训练任务超时管理（1小时 vs 30秒）

2. **TrainingResultAggregator**（新模块）
   - 多节点 Adapter 权重聚合
   - 训练指标汇总
   - 结果版本管理

3. **TrainingGatekeeper**（新模块）
   - 快速评估门禁（CER/WER）
   - TTS 止损机制（合成测试 + ASR 反识别）
   - 节点信誉评估

4. **TrainingRunManager**（新模块）
   - 训练链状态管理
   - 链式任务调度（job 1 → job 2 → ...）
   - 支持暂停、恢复、取消

5. **NodeReputationManager**（新模块）
   - 节点信誉评分
   - 训练任务配额管理
   - 反刷奖励/投毒检测

### 4.2 需要修改的现有模块

#### 4.2.1 `JobDispatcher` - **需要扩展，不破坏现有功能**

**改动方式**：采用策略模式或任务类型枚举

```rust
pub enum TaskType {
    Inference(Job),           // 现有推理任务
    Training(TrainingJob),    // 新增训练任务
}

// 或者使用 trait
pub trait Task {
    fn task_id(&self) -> &str;
    fn assigned_node_id(&self) -> Option<&str>;
    fn status(&self) -> TaskStatus;
}
```

**影响评估**：
- ✅ 可以保持向后兼容
- ⚠️ 需要修改 `create_job` 等接口，增加任务类型参数
- ⚠️ 需要扩展 `JobStatus` 或新增 `TrainingJobStatus`

#### 4.2.2 `NodeRegistry` - **小改动**

**改动内容**：
- 扩展节点能力标识：支持训练任务能力
- 节点选择过滤：增加训练任务节点过滤逻辑

**影响评估**：
- ✅ 改动较小，主要是扩展字段和过滤条件

#### 4.2.3 `timeout::JobTimeout` - **需要扩展**

**改动内容**：
- 当前超时时间：30秒（推理任务）
- 训练任务超时：3600秒（1小时）
- 需要支持不同任务类型的超时配置

**影响评估**：
- ⚠️ 需要扩展超时管理器，支持任务类型感知的超时配置

#### 4.2.4 `Phase2Runtime` - **小改动**

**改动内容**：
- 扩展 Job FSM 支持训练任务状态
- 新增训练任务专用 Redis key 空间（如 `training:run:<run_id>`）

**影响评估**：
- ✅ 改动较小，主要是扩展 Redis key 命名空间

#### 4.2.5 WebSocket 消息协议 - **需要扩展**

**改动内容**：
- 新增训练任务相关消息类型
- 节点需要支持训练任务接收和执行

**影响评估**：
- ⚠️ 需要扩展消息协议，但可以保持向后兼容

### 4.3 配置改动

#### `config.toml` 需要新增配置

```toml
[scheduler.training]
# 训练任务配置
enabled = true
job_timeout_seconds = 3600  # 1小时
max_concurrent_training_jobs_per_node = 1
training_node_filter = "gpu_available"  # 仅选择有GPU的节点

[scheduler.training.gatekeeper]
# 门禁配置
cer_threshold = 0.15
wer_threshold = 0.20
tts_quality_check_enabled = true

[scheduler.training.reputation]
# 信誉管理
min_reputation_score = 0.7
quota_per_node_per_day = 10
```

---

## 5. 改动规模评估

### 5.1 代码量估算

| 模块 | 新增代码行数（估算） | 修改代码行数（估算） |
|------|-------------------|-------------------|
| TrainingJobDispatcher | ~800 行 | - |
| TrainingRunManager | ~600 行 | - |
| TrainingResultAggregator | ~500 行 | - |
| TrainingGatekeeper | ~400 行 | - |
| NodeReputationManager | ~300 行 | - |
| JobDispatcher（扩展） | - | ~200 行 |
| NodeRegistry（扩展） | - | ~100 行 |
| timeout（扩展） | - | ~150 行 |
| Phase2Runtime（扩展） | - | ~100 行 |
| WebSocket 消息协议 | - | ~200 行 |
| **总计** | **~2600 行** | **~750 行** |

### 5.2 架构复杂度评估

| 维度 | 评估 | 说明 |
|------|------|------|
| **架构改动规模** | 🟡 **中等** | 需要新增5个模块，修改5个现有模块 |
| **向后兼容性** | 🟢 **良好** | 可以保持推理任务功能不变 |
| **测试复杂度** | 🟡 **中等** | 需要测试训练任务全链路 |
| **部署风险** | 🟡 **中等** | 新功能可以逐步启用 |

---

## 6. 实施建议

### 6.1 分阶段实施策略

#### 阶段1：基础设施扩展（2-3周）
1. 扩展 `JobDispatcher` 支持任务类型枚举
2. 扩展 `NodeRegistry` 支持训练节点过滤
3. 扩展 `Phase2Runtime` 支持训练任务状态管理
4. 扩展 WebSocket 消息协议

#### 阶段2：训练任务核心功能（3-4周）
1. 实现 `TrainingJobDispatcher`
2. 实现 `TrainingRunManager`
3. 实现训练任务超时管理（1小时）
4. 实现训练任务状态机

#### 阶段3：结果处理与门禁（2-3周）
1. 实现 `TrainingResultAggregator`
2. 实现 `TrainingGatekeeper`
3. 实现 TTS 止损机制

#### 阶段4：信誉与配额（1-2周）
1. 实现 `NodeReputationManager`
2. 实现训练任务配额管理

### 6.2 技术风险缓解

1. **任务类型隔离**
   - 使用 trait 或枚举隔离推理任务和训练任务
   - 确保推理任务功能不受影响

2. **渐进式部署**
   - 训练功能可以配置开关（`training.enabled = false`）
   - 先在小规模节点上测试

3. **资源隔离**
   - 训练任务和推理任务使用不同的节点池（可选）
   - 或通过配额限制训练任务对推理任务的影响

---

## 7. 结论

### 7.1 架构改动规模

**🟡 中等规模改动**（不需要大规模重构）

- ✅ **可以复用**：NodeRegistry、Phase2 Redis、WebSocket 通信等核心基础设施
- ⚠️ **需要扩展**：JobDispatcher、超时管理、消息协议等
- ⚠️ **需要新增**：5个训练专用模块（~2600行代码）

### 7.2 实施可行性

**✅ 可行**，但需要注意：

1. **保持向后兼容**：推理任务功能不应受影响
2. **分阶段实施**：建议分4个阶段，总计8-12周
3. **充分测试**：训练任务全链路测试（包括失败场景）
4. **配置化部署**：训练功能可以通过配置开关控制

### 7.3 关键决策点

1. **任务类型设计**：使用 trait 还是枚举？建议使用 trait 以保持灵活性
2. **资源隔离策略**：训练任务和推理任务是否共享节点池？
3. **训练链存储**：训练链状态存储在 Redis 还是数据库？
4. **结果聚合时机**：实时聚合还是批量聚合？

---

## 8. 后续行动建议

1. **技术设计评审**：详细设计训练任务架构
2. **原型验证**：先实现最小可行版本（MVP）
3. **性能测试**：验证训练任务对推理任务的影响
4. **文档更新**：更新架构文档和 API 文档

---

**文档版本**：v1.0  
**分析日期**：2024  
**分析人**：AI Assistant

