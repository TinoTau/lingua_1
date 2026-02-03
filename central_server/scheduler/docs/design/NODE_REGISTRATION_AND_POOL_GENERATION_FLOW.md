# 节点注册与 Pool 生成流程

本文档详细说明节点端启动后注册到调度服务器的完整流程，以及自动语言对 Pool 生成的时机。

## 一、节点端启动与注册流程

### 1.1 节点端启动阶段

**文件**: `electron_node/electron-node/main/src/agent/node-agent-registration.ts`

```typescript
async registerNode(): Promise<void>
```

**步骤**：

1. **检查 WebSocket 连接状态**
   - 验证 WebSocket 是否为 `OPEN` 状态
   - 如果未连接，记录警告并返回

2. **收集硬件信息**
   ```typescript
   const hardware = await this.hardwareHandler.getHardwareInfo();
   ```
   - 获取 CPU、GPU、内存信息
   - 验证是否有 GPU（注册必需）

3. **收集已安装的模型**
   ```typescript
   const installedModels = await this.inferenceService.getInstalledModels();
   ```
   - 获取所有已安装的模型列表
   - 包含模型 ID、类型、语言信息等

4. **收集已安装的服务**
   ```typescript
   const installedServicesAll = await this.getInstalledServices();
   ```
   - 获取所有已安装的服务实现
   - 包含服务 ID、模型 ID、类型、状态等

5. **计算服务能力（按类型聚合）**
   ```typescript
   const capabilityByType = await this.getCapabilityByType(installedServicesAll);
   ```
   - 按 `ServiceType`（ASR、NMT、TTS、SEMANTIC、TONE）聚合
   - 判断每个类型是否 `ready`（GPU 可用 + 服务运行中）

6. **检测语言能力**（新增功能）
   ```typescript
   const languageCapabilities = await this.languageDetector.detectLanguageCapabilities(
     installedServicesAll,
     installedModels,
     capabilityByType
   );
   ```
   - 检测 ASR 支持的语言列表
   - 检测 TTS 支持的语言列表
   - 检测 NMT 支持的语言对（使用规则匹配）
   - 检测语义修复服务支持的语言
   - **只统计 READY 状态的服务**

7. **获取支持的功能**
   ```typescript
   const featuresSupported = this.inferenceService.getFeaturesSupported();
   ```

8. **构建注册消息**
   ```typescript
   const message: NodeRegisterMessage = {
     type: 'node_register',
     node_id: this.nodeId || null,
     version: '2.0.0',
     capability_schema_version: '2.0',  // 必需：ServiceType 模型版本
     platform: this.hardwareHandler.getPlatform(),
     hardware: hardware,
     installed_models: installedModels,
     installed_services: installedServicesAll,
     capability_by_type: capabilityByType,
     features_supported: featuresSupported,
     accept_public_jobs: true,
     language_capabilities: languageCapabilities,  // 新增
   };
   ```

9. **发送注册消息**
   ```typescript
   this.ws.send(JSON.stringify(message));
   ```

### 1.2 调度服务器端接收注册

**文件**: `central_server/scheduler/src/websocket/node_handler/message/register.rs`

```rust
pub(super) async fn handle_node_register(...)
```

**步骤**：

1. **验证能力模式版本**
   - 检查 `capability_schema_version` 是否为 `"2.0"`
   - 如果版本不匹配或缺失，发送错误消息并拒绝注册

2. **调用节点注册**
   ```rust
   state.node_registry.register_node_with_policy(
       provided_node_id,
       name,
       version,
       platform,
       hardware,
       installed_models,
       installed_services,
       features_supported,
       accept_public_jobs,
       capability_by_type,
       allow_existing_id,  // Phase 2: 允许覆盖已有 node_id
       language_capabilities,  // 新增
   )
   ```

3. **注册连接**
   ```rust
   state.node_connections.register(node.node_id.clone(), tx.clone()).await;
   ```

4. **Phase 2 处理**（如果启用）
   - 写入节点所有者信息（Redis）
   - 写入节点快照（Redis）

5. **发送注册确认**
   ```rust
   NodeMessage::NodeRegisterAck {
       node_id: node.node_id.clone(),
       message: "registered".to_string(),
       status: "registering".to_string(),  // 初始状态
   }
   ```

### 1.3 节点注册内部处理

**文件**: `central_server/scheduler/src/node_registry/core.rs`

```rust
pub async fn register_node_with_policy(...)
```

**步骤**：

1. **检查 GPU 可用性**
   - 如果节点没有 GPU，返回错误（`NoGpuAvailable`）

2. **处理节点 ID**
   - 如果提供了 `node_id`，使用提供的 ID
   - 否则生成新的 UUID
   - 检查 ID 冲突（如果 `allow_existing_id = false`）

3. **创建 Node 对象**
   ```rust
   let node = Node {
       node_id: final_node_id.clone(),
       name: name.clone(),
       version: version.clone(),
       platform: platform.clone(),
       hardware,
       status: NodeStatus::Registering,  // 初始状态
       online: true,
       // ... 其他字段
       language_capabilities,  // 新增
   };
   ```

4. **存储节点**
   ```rust
   nodes.insert(final_node_id.clone(), node.clone());
   ```

5. **更新语言能力索引**（新增）
   ```rust
   let mut index = self.language_capability_index.write().await;
   index.update_node_capabilities(&final_node_id, &node.language_capabilities);
   ```
   - 更新 ASR 语言索引
   - 更新 TTS 语言索引
   - 更新 NMT 能力列表（使用规则匹配）

6. **自动生成 Pool**（关键步骤！）
   ```rust
   let cfg = self.phase3.read().await.clone();
   if cfg.auto_generate_language_pools && cfg.pools.is_empty() {
       self.rebuild_auto_language_pools().await;
   }
   ```
   - **条件**：
     - `auto_generate_language_pools = true`
     - `pools.is_empty() = true`（首次注册或 Pool 未配置）
   - **时机**：每个节点注册时都会检查，但只在第一次（pools 为空）时执行

7. **分配节点到 Pool**
   ```rust
   self.phase3_upsert_node_to_pool_index(&final_node_id).await;
   ```
   - 根据节点的语言能力匹配到对应的 Pool
   - 如果启用自动生成模式，使用语言能力匹配
   - 否则使用服务类型匹配或 hash 分桶

8. **更新 Pool 核心能力缓存**
   ```rust
   self.phase3_core_cache_upsert_node(node.clone()).await;
   ```

## 二、Pool 生成流程

### 2.1 Pool 生成的触发时机

Pool 生成在以下情况下触发：

1. **节点注册时**（主要时机）
   - 文件：`central_server/scheduler/src/node_registry/core.rs:231-236`
   - 条件：`auto_generate_language_pools = true` 且 `pools.is_empty()`
   - 说明：第一个节点注册时，如果 Pool 配置为空，会自动生成

2. **配置更新时**
   - 文件：`central_server/scheduler/src/node_registry/phase3_pool.rs:11-24`
   - 条件：调用 `set_phase3_config` 且满足自动生成条件
   - 说明：管理员更新配置时触发

3. **Pool 索引重建时**
   - 文件：`central_server/scheduler/src/node_registry/phase3_pool.rs:74-117`
   - 条件：`rebuild_phase3_pool_index` 时，如果启用自动生成且 pools 为空
   - 说明：手动触发索引重建时

### 2.2 Pool 生成详细流程

**文件**: `central_server/scheduler/src/node_registry/auto_language_pool.rs`

```rust
pub async fn auto_generate_language_pair_pools() -> Vec<Phase3PoolConfig>
```

**步骤**：

1. **读取配置**
   ```rust
   let auto_cfg = match &cfg.auto_pool_config {
       Some(c) => c.clone(),
       None => AutoLanguagePoolConfig::default(),
   };
   ```
   - 配置参数：
     - `min_nodes_per_pool`: 最小节点数（默认 2）
     - `max_pools`: 最大 Pool 数量（默认 50）
     - `require_semantic`: 是否要求语义修复服务（默认 true）

2. **收集所有节点的语言对**
   ```rust
   let language_pairs = self.collect_language_pairs(&auto_cfg).await;
   ```
   - 遍历所有节点
   - 检查节点是否具备所有必需服务（ASR、NMT、TTS、可选 SEMANTIC）
   - 获取节点的语言对列表（基于 ASR、TTS、NMT 能力）
   - 处理 NMT 规则：
     - `any_to_any`: 遍历所有 ASR 和 TTS 语言组合
     - `any_to_en`: 任意语言到英文
     - `en_to_any`: 英文到任意语言
     - `specific_pairs`: 明确支持的语言对

3. **统计每个语言对的节点数**
   ```rust
   let mut pair_counts: HashMap<(String, String), usize> = HashMap::new();
   ```

4. **过滤语言对**
   - 只保留节点数 >= `min_nodes_per_pool` 的语言对
   - 记录被过滤掉的语言对数量

5. **排序**
   - 按节点数降序排序（优先创建节点数多的 Pool）
   - 如果节点数相同，按语言对字母顺序排序

6. **限制 Pool 数量**
   - 如果语言对数量 > `max_pools`，只保留前 `max_pools` 个

7. **生成 Pool 配置**
   ```rust
   for ((src, tgt), _node_count) in valid_pairs {
       let pool_name = format!("{}-{}", src, tgt);
       pools.push(Phase3PoolConfig {
           pool_id: pool_id,
           name: pool_name,
           required_services: vec!["asr", "nmt", "tts", "semantic"],
           language_requirements: Some(PoolLanguageRequirements {
               asr_languages: Some(vec![src.clone()]),
               tts_languages: Some(vec![tgt.clone()]),
               nmt_requirements: Some(PoolNmtRequirements {
                   rule: "specific_pairs",
                   supported_pairs: Some(vec![LanguagePair { src, tgt }]),
               }),
           }),
       });
   }
   ```

8. **更新配置并重建索引**
   ```rust
   // 在 rebuild_auto_language_pools() 中
   phase3.pools = new_pools;
   self.rebuild_phase3_pool_index().await;
   self.rebuild_phase3_core_cache().await;
   ```

### 2.3 节点分配到 Pool

**文件**: `central_server/scheduler/src/node_registry/phase3_pool.rs`

```rust
pub(super) async fn phase3_upsert_node_to_pool_index(&self, node_id: &str)
```

**步骤**：

1. **检查 Phase 3 是否启用**
   - 如果未启用或模式不是 `"two_level"`，直接返回

2. **自动生成模式**
   ```rust
   if cfg.auto_generate_language_pools {
       let language_index = self.language_capability_index.read().await;
       let pool_id = determine_pool_for_node_auto_mode_with_index(&cfg, n, &language_index);
   }
   ```
   - 遍历所有 Pool
   - 检查节点是否匹配 Pool 的语言要求：
     - ASR 语言匹配
     - TTS 语言匹配
     - NMT 语言对匹配（使用规则匹配）
     - 语义修复语言匹配（如果要求）

3. **手动配置模式**
   - 使用服务类型匹配或 hash 分桶

4. **更新索引**
   ```rust
   self.phase3_set_node_pool(node_id, pid).await;
   ```

## 三、完整流程图

```
节点端启动
    ↓
收集硬件信息
    ↓
收集已安装模型
    ↓
收集已安装服务
    ↓
计算 capability_by_type
    ↓
检测语言能力（新增）
    ├─→ ASR 语言
    ├─→ TTS 语言
    ├─→ NMT 能力（规则匹配）
    └─→ 语义修复语言
    ↓
发送 node_register 消息
    ↓
调度服务器接收
    ↓
验证 capability_schema_version
    ↓
调用 register_node_with_policy
    ├─→ 检查 GPU
    ├─→ 创建 Node 对象
    ├─→ 存储节点
    ├─→ 更新语言能力索引（新增）
    ├─→ 【Pool 生成检查】
    │   ├─→ 如果 auto_generate_language_pools = true
    │   │   且 pools.is_empty() = true
    │   │   ↓
    │   │   收集所有节点的语言对
    │   │   ↓
    │   │   统计每个语言对的节点数
    │   │   ↓
    │   │   过滤（min_nodes_per_pool）
    │   │   ↓
    │   │   排序（按节点数降序）
    │   │   ↓
    │   │   限制（max_pools）
    │   │   ↓
    │   │   生成 Pool 配置
    │   │   ↓
    │   │   更新 phase3.pools
    │   │   ↓
    │   └─→ 重建 Pool 索引
    ├─→ 分配节点到 Pool
    └─→ 更新 Pool 核心能力缓存
    ↓
发送 NodeRegisterAck
    ↓
节点收到确认，状态为 "registering"
    ↓
开始发送心跳（定期更新语言能力）
```

## 四、关键点说明

### 4.1 Pool 生成时机

- **首次注册时**：第一个节点注册时，如果启用自动生成且 Pool 配置为空，会立即生成 Pool
- **后续注册**：后续节点注册时，如果 Pool 已存在，不会重新生成，只会将新节点分配到现有 Pool
- **配置更新**：管理员更新配置时，如果满足条件，会重新生成 Pool

### 4.2 语言能力更新

- **注册时**：节点注册时上报语言能力，更新语言能力索引
- **心跳时**：节点定期发送心跳，可以更新语言能力（如果服务状态变化）
- **索引更新**：语言能力索引实时更新，Pool 分配基于最新索引

### 4.3 Pool 分配逻辑

- **自动生成模式**：根据节点的语言能力匹配到对应的语言对 Pool
- **一个节点可以分配到多个 Pool**：如果节点支持多个语言对，可以分配到多个 Pool
- **Pool 匹配**：必须同时满足 ASR、TTS、NMT、语义修复（如果要求）的语言要求

### 4.4 性能考虑

- **Pool 生成**：只在首次注册或配置更新时执行，不会频繁重建
- **节点分配**：使用语言能力索引快速匹配，O(1) 查找
- **索引维护**：语言能力索引在节点注册和心跳时实时更新

## 五、配置示例

```toml
[phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true

[phase3.auto_pool_config]
min_nodes_per_pool = 2
max_pools = 50
require_semantic = true
```

## 六、日志示例

### 节点端日志

```
[INFO] Starting node registration
[DEBUG] Getting hardware info...
[DEBUG] Hardware info retrieved: gpus=1
[DEBUG] Getting installed models...
[DEBUG] Installed models retrieved: modelCount=5
[DEBUG] Getting installed services...
[DEBUG] Installed services retrieved: serviceCount=8
[DEBUG] Getting capability by type...
[DEBUG] Capability by type retrieved: capabilityCount=5
[DEBUG] Detecting language capabilities...
[DEBUG] Language capabilities detected: asr_languages=2, tts_languages=2, nmt_capabilities=1, semantic_languages=2
[INFO] Sending node registration message
[INFO] Node registration message sent successfully
```

### 调度服务器端日志

```
[INFO] Processing node registration: capability_schema_version=Some("2.0"), gpus=Some([...]), capability_by_type_count=5
[INFO] 开始自动生成语言对 Pool
[INFO] 使用配置的自动 Pool 生成参数: min_nodes_per_pool=2, max_pools=50, require_semantic=true
[DEBUG] 开始收集节点的语言对
[DEBUG] 语言对收集完成：检查了 1 个节点，1 个具备必需服务，1 个有语言对
[INFO] 收集到 1 个语言对
[INFO] 生成语言对 Pool: zh-en (zh -> en)
[INFO] 自动生成完成，共生成 1 个语言对 Pool
[INFO] Pool 配置已更新：0 -> 1
[INFO] 开始重建 Pool 索引
[INFO] Pool 索引重建完成
[DEBUG] 使用自动生成模式分配 Pool
[DEBUG] 节点分配到 Pool 1
[INFO] Node node-12345678 registered, status: registering
```
