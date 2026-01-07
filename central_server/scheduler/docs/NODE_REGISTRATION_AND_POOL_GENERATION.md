# 节点注册与 Pool 生成流程

## 文档信息

- **版本**: v2.0
- **日期**: 2026-01-06
- **目的**: 详细说明节点端注册到调度服务器的完整流程，以及自动语言对 Pool 生成的时机
- **状态**: 已实现

---

## 一、节点端启动与注册流程

### 1.1 节点端启动阶段

**文件**: `electron_node/electron-node/main/src/agent/node-agent-registration.ts`

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

4. **收集已安装的服务**
   ```typescript
   const installedServicesAll = await this.getInstalledServices();
   ```

5. **计算服务能力（按类型聚合）**
   ```typescript
   const capabilityByType = await this.getCapabilityByType(installedServicesAll);
   ```

6. **检测语言能力**（关键步骤）
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
   - **计算语言对交集**：节点端计算所有服务的交集，生成 `supported_language_pairs`
   - **只统计 READY 状态的服务**
   - **语言可用性以语义修复服务为准**：源语言和目标语言都必须在语义修复服务支持的语言列表中

7. **构建注册消息**
   ```typescript
   const message: NodeRegisterMessage = {
     type: 'node_register',
     node_id: this.nodeId || null,
     version: '2.0.0',
     capability_schema_version: '2.0',
     language_capabilities: languageCapabilities,  // 包含 supported_language_pairs
     // ... 其他字段
   };
   ```

8. **发送注册消息**
   ```typescript
   this.ws.send(JSON.stringify(message));
   ```

### 1.2 语言对上报格式

**TypeScript 接口定义**：

```typescript
export interface NodeLanguageCapabilities {
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  asr_languages?: string[];
  tts_languages?: string[];
  nmt_capabilities?: NmtCapability[];
  semantic_languages?: string[];
  
  /** 节点支持的语言对列表（所有服务的交集，节点端计算） */
  supported_language_pairs?: Array<{ src: string; tgt: string }>;
}
```

**JSON 格式示例**：

```json
{
  "language_capabilities": {
    "supported_language_pairs": [
      { "src": "zh", "tgt": "en" },
      { "src": "zh", "tgt": "ja" },
      { "src": "en", "tgt": "zh" }
    ]
  }
}
```

**语言对生成规则**：

**重要变更**：节点端的语言可用性以语义修复服务的能力为准。

语言对列表是节点端计算所有服务能力的**交集**，但必须以语义修复服务的语言能力为准：
1. **ASR 语言**：节点能识别的源语言
2. **TTS 语言**：节点能合成的目标语言
3. **NMT 能力**：节点能翻译的语言对（根据 NMT 规则）
4. **Semantic 语言**：节点能进行语义修复的语言（**必需**）
   - 源语言和目标语言都必须在语义修复服务支持的语言列表中
   - 如果节点没有语义修复服务或语义修复服务不支持某个语言对，该语言对不会被纳入 `supported_language_pairs`

---

## 二、调度服务器端接收注册

### 2.1 接收处理

**文件**: `central_server/scheduler/src/websocket/node_handler/message/register.rs`

**步骤**：

1. **验证能力模式版本**
   - 检查 `capability_schema_version` 是否为 `"2.0"`

2. **调用节点注册**
   ```rust
   state.node_registry.register_node_with_policy(
       // ... 其他参数
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

### 2.2 节点注册内部处理

**文件**: `central_server/scheduler/src/node_registry/core.rs`

**步骤**：

1. **检查 GPU 可用性**

2. **处理节点 ID**

3. **创建 Node 对象**
   ```rust
   let node = Node {
       // ... 其他字段
       language_capabilities,  // 新增
   };
   ```

4. **存储节点**

5. **更新语言能力索引**（新增）
   ```rust
   let mut index = self.language_capability_index.write().await;
   index.update_node_capabilities(&final_node_id, &node.language_capabilities);
   ```

6. **自动生成 Pool**（关键步骤！）
   ```rust
   let cfg = self.phase3.read().await.clone();
   if cfg.auto_generate_language_pools && cfg.pools.is_empty() {
       self.rebuild_auto_language_pools(phase2_runtime).await;
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

8. **更新 Pool 核心能力缓存**

---

## 三、Pool 生成流程

### 3.1 Pool 生成的触发时机

Pool 生成在以下情况下触发：

1. **节点注册时**（主要时机）
   - 条件：`auto_generate_language_pools = true` 且 `pools.is_empty()`
   - 说明：第一个节点注册时，如果 Pool 配置为空，会自动生成

2. **配置更新时**
   - 条件：调用 `set_phase3_config` 且满足自动生成条件

3. **Pool 索引重建时**
   - 条件：`rebuild_phase3_pool_index` 时，如果启用自动生成且 pools 为空

4. **定期清理任务**
   - 条件：检测到空 Pool 时触发重建

### 3.2 Pool 生成详细流程

**文件**: `central_server/scheduler/src/node_registry/auto_language_pool.rs`

**步骤**：

1. **读取配置**
   ```rust
   let auto_cfg = match &cfg.auto_pool_config {
       Some(c) => c.clone(),
       None => AutoLanguagePoolConfig::default(),
   };
   ```

2. **收集所有节点的语言对**
   ```rust
   let language_pairs = self.collect_language_pairs(&auto_cfg).await;
   ```
   - 遍历所有节点
   - 检查节点是否具备所有必需服务（ASR、NMT、TTS、可选 SEMANTIC）
   - 获取节点的语言对列表（基于 `supported_language_pairs`）

3. **统计每个语言对的节点数**

4. **过滤语言对**
   - 只保留节点数 >= `min_nodes_per_pool` 的语言对

5. **排序**
   - 按节点数降序排序（优先创建节点数多的 Pool）

6. **限制 Pool 数量**（仅精确池）
   - 如果语言对数量 > `max_pools`，只保留前 `max_pools` 个

7. **生成 Pool 配置**
   - 精确池：`{src_lang}-{tgt_lang}`
   - 混合池：`*-{tgt_lang}`（如果 `enable_mixed_pools = true`）

8. **更新配置并重建索引**
   ```rust
   phase3.pools = new_pools;
   self.rebuild_phase3_pool_index().await;
   self.rebuild_phase3_core_cache().await;
   ```

### 3.3 Redis 同步（多实例环境）

如果启用了 Phase 2（多实例模式），Pool 生成会同步到 Redis：

1. **优先从 Redis 读取配置**
   - 如果 Redis 中有配置，直接使用并更新本地配置

2. **尝试成为 Leader**
   - 如果 Redis 中没有配置，尝试获取 Leader 锁

3. **Leader 生成配置**
   - Leader 实例生成 Pool 配置
   - 写入 Redis（包含版本号）
   - 更新本地配置

4. **Follower 同步配置**
   - 非 Leader 实例等待后从 Redis 读取配置
   - 更新本地配置

---

## 四、节点分配到 Pool

### 4.1 分配逻辑

**文件**: `central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`

**步骤**：

1. **检查 Phase 3 是否启用**

2. **自动生成模式**
   ```rust
   if cfg.auto_generate_language_pools {
       let language_index = self.language_capability_index.read().await;
       let pool_id = determine_pool_for_node_auto_mode_with_index(&cfg, n, &language_index);
   }
   ```
   - 遍历所有 Pool（精确池 + 混合池）
   - 检查节点是否匹配 Pool 的语言要求：
     - **精确池**：ASR 语言匹配、TTS 语言匹配、NMT 语言对匹配
     - **混合池**：TTS 语言匹配、NMT 支持任意到目标语言

3. **更新索引**
   ```rust
   self.phase3_set_node_pool(node_id, pid).await;
   ```

### 4.2 节点匹配规则

**重要变更**：节点端的语言可用性以语义修复服务的能力为准。在匹配 Pool 时，必须检查语义修复服务的语言能力。

**原因**：根据实际测试，没有语义修复服务时，语音识别结果非常糟糕。因此，系统要求节点必须同时具备语义修复服务，且语义修复服务必须支持源语言和目标语言，才能提供该语言对的服务。

#### 精确池匹配

```rust
// 检查节点是否支持特定的语言对
// 首先检查语义修复服务的语言能力
if semantic_langs.contains(&src_lang) && semantic_langs.contains(&tgt_lang) {
    if asr_langs.contains(&src_lang) && tts_langs.contains(&tgt_lang) {
        // 检查 NMT 是否支持该语言对
        if nmt_supports(src_lang, tgt_lang) {
            return Some(pool_id);
        }
    }
}
```

#### 混合池匹配

```rust
// 检查节点是否支持目标语言（不限制源语言）
// 首先检查目标语言是否在语义修复服务支持的语言列表中
if semantic_langs.contains(&tgt_lang) {
    if tts_langs.contains(&tgt_lang) {
        // 检查 NMT 是否支持任意源语言到该目标语言
        // 同时需要检查源语言是否在语义修复服务支持的语言列表中
        if nmt_supports_any_to_tgt(tgt_lang) && has_semantic_supported_src() {
            return Some(pool_id);
        }
    }
}
```

---

## 五、完整流程图

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
    ├─→ 语义修复语言
    └─→ 计算语言对交集 → supported_language_pairs
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
    │   │   【Redis 同步检查】
    │   │   ├─→ 如果启用 Phase 2
    │   │   │   ├─→ 从 Redis 读取配置
    │   │   │   │   ├─→ 有 → 更新本地配置并返回
    │   │   │   │   └─→ 无 → 尝试成为 Leader
    │   │   │   │       ├─→ 成功 → 生成 Pool 配置 → 写入 Redis
    │   │   │   │       └─→ 失败 → 等待后重试读取
    │   │   │   └─→ 如果未启用 Phase 2
    │   │   │       └─→ 本地生成 Pool 配置
    │   │   └─→ 收集所有节点的语言对
    │   │   └─→ 统计每个语言对的节点数
    │   │   └─→ 过滤（min_nodes_per_pool）
    │   │   └─→ 排序（按节点数降序）
    │   │   └─→ 限制（max_pools，仅精确池）
    │   │   └─→ 生成 Pool 配置（精确池 + 混合池）
    │   │   └─→ 更新 phase3.pools
    │   │   └─→ 重建 Pool 索引
    ├─→ 分配节点到 Pool
    └─→ 更新 Pool 核心能力缓存
    ↓
发送 NodeRegisterAck
    ↓
节点收到确认，状态为 "registering"
    ↓
开始发送心跳（定期更新语言能力）
```

---

## 六、关键点说明

### 6.1 Pool 生成时机

- **首次注册时**：第一个节点注册时，如果启用自动生成且 Pool 配置为空，会立即生成 Pool
- **后续注册**：后续节点注册时，如果 Pool 已存在，不会重新生成，只会将新节点分配到现有 Pool
- **配置更新**：管理员更新配置时，如果满足条件，会重新生成 Pool
- **Redis 同步**：多实例环境下，只有 Leader 实例生成 Pool，其他实例从 Redis 读取

### 6.2 语言能力更新

- **注册时**：节点注册时上报语言能力，更新语言能力索引
- **心跳时**：节点定期发送心跳，可以更新语言能力（如果服务状态变化）
- **服务热插拔时**：语义修复服务启动/停止/语言能力变化时，立即触发心跳更新语言能力
- **索引更新**：语言能力索引实时更新，Pool 分配基于最新索引

**语义修复服务变化检测机制**：

节点端在以下时机检测语义修复服务变化并重新检测语言能力：

1. **启动后**：
   - 节点注册时会检测所有服务的语言能力（包括语义修复服务）
   - 确认语言处理的完整性（是否有语义修复服务）
   - 确认支持哪些语言（基于语义修复服务的语言能力）

2. **每次热插拔之后**：
   - 语义修复服务管理器监听服务状态变化（启动/停止）
   - 当服务状态变化时，触发状态变化回调
   - 节点代理收到回调后，立即触发心跳
   - 心跳中重新检测语言能力（包括语义修复服务的语言能力）
   - 通过心跳上报新的语言能力到调度服务器

**实现细节**：

- 语义修复服务管理器实现了 `setOnStatusChangeCallback` 方法，用于注册状态变化回调
- 节点代理在启动时注册语义修复服务状态变化监听
- 当语义修复服务状态变化时，会调用回调函数，触发立即心跳
- 心跳中会重新调用 `detectLanguageCapabilities`，检测所有服务的语言能力
- 语言对计算会基于最新的语义修复服务语言能力进行过滤

### 6.3 Pool 分配逻辑

- **自动生成模式**：根据节点的语言能力匹配到对应的语言对 Pool
- **一个节点可以分配到多个 Pool**：如果节点支持多个语言对，可以分配到多个 Pool
- **Pool 匹配**：必须同时满足以下要求：
  - **语义修复服务语言要求**（必需）：源语言和目标语言都必须在语义修复服务支持的语言列表中
  - ASR、TTS、NMT 的语言要求
- **语言可用性以语义修复服务为准**：如果节点没有语义修复服务或语义修复服务不支持某个语言对，该节点不会被分配到对应的 Pool

### 6.4 动态 Pool 创建机制

当节点通过心跳更新语言能力时，如果节点支持的语言对不在现有 Pool 中，系统会动态创建新的 Pool。

**流程**：

1. **节点心跳更新语言能力**
   - 节点端检测到语义修复服务变化（启动/停止/语言能力变化）
   - 重新计算 `supported_language_pairs`（基于语义修复服务的语言能力）
   - 通过心跳上报新的语言能力

2. **调度服务器处理**
   - 更新节点的 `language_capabilities`
   - 更新语言能力索引（包括语义修复服务语言索引）
   - 调用 `phase3_upsert_node_to_pool_index` 重新分配节点

3. **Pool 匹配与创建**
   - 尝试将节点匹配到现有 Pool
   - 如果匹配成功：将节点从旧 Pool 移除，添加到新 Pool
   - 如果未匹配到任何 Pool：
     - 检查节点支持的语言对
     - 如果语言对不在现有 Pool 中，动态创建新的精确池
     - 将新 Pool 添加到配置中
     - 将节点添加到新创建的 Pool

4. **旧 Pool 清理**
   - 节点从旧 Pool 中移除（如果不再匹配）
   - 如果旧 Pool 变空，由定期清理任务（每60秒）检测并销毁

**示例场景**：

```
场景1：语义修复服务启动，新增语言支持
- 节点原本支持：zh-en（已有 Pool）
- 语义修复服务启动后支持：zh-ja（新语言对）
- 系统行为：
  1. 节点从 zh-en Pool 中移除（如果不再匹配）
  2. 创建新的 zh-ja Pool
  3. 将节点添加到 zh-ja Pool

场景2：语义修复服务停用
- 节点原本支持：zh-en, zh-ja
- 语义修复服务停用后：无支持的语言对
- 系统行为：
  1. 节点从所有 Pool 中移除
  2. 旧 Pool 如果变空，由定期清理任务销毁
```

### 6.5 Redis 同步机制

- **Leader 选举**：使用 Redis 分布式锁确保只有一个实例生成 Pool
- **配置同步**：Leader 写入 Redis，其他实例定期拉取
- **版本控制**：使用版本号检测配置更新
- **故障转移**：Leader 失效时自动切换
- **动态创建同步**：动态创建的 Pool 会尝试写入 Redis（如果当前实例是 Leader）

---

## 七、配置示例

```toml
[phase2]
enabled = true
instance_id = "scheduler-1"
redis.mode = "cluster"
redis.key_prefix = "lingua"
redis.cluster_urls = [
    "redis://node1:6379",
    "redis://node2:6379",
    "redis://node3:6379"
]

[phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true

[phase3.auto_pool_config]
min_nodes_per_pool = 1
max_pools = 50
require_semantic = true
enable_mixed_pools = true
pool_naming = "pair"
```

---

## 八、日志示例

### 节点端日志

```
[INFO] Starting node registration
[DEBUG] Detecting language capabilities...
[INFO] Language capabilities detected: supported_language_pairs=42
[INFO] 计算完成，生成语言对列表: total_pairs=42
[INFO] 上报语言对列表到调度服务器: pair_count=42
```

### 调度服务器端日志

```
[INFO] Processing node registration: capability_schema_version=Some("2.0")
[INFO] 开始自动生成语言对 Pool（混合架构）
[INFO] 收集到 42 个语言对
[INFO] 生成精确池: zh-en (zh -> en)
[INFO] 生成混合池: *-en (任意 -> en)
[INFO] 成功获取 Pool Leader 锁，开始生成 Pool 配置
[INFO] Pool 配置已写入 Redis: pool_count=10, version=1
[INFO] 自动生成完成，共生成 10 个 Pool（精确池: 8, 混合池: 2）
[DEBUG] 使用自动生成模式分配 Pool
[DEBUG] 节点分配到 Pool 1
```

---

## 九、代码位置

- **节点端语言能力检测**：`electron_node/electron-node/main/src/agent/node-agent-language-capability.ts`
- **节点端心跳上报**：`electron_node/electron-node/main/src/agent/node-agent-heartbeat.ts`
- **调度服务器注册处理**：`central_server/scheduler/src/websocket/node_handler/message/register.rs`
- **Pool 生成逻辑**：`central_server/scheduler/src/node_registry/auto_language_pool.rs`
- **节点分配逻辑**：`central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`
- **Redis 同步逻辑**：`central_server/scheduler/src/phase2/runtime_routing.rs`

---

**最后更新**: 2026-01-06
