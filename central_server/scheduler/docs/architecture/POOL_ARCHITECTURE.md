# Pool 架构设计文档

**版本**: v3.0（有向语言对 + Lua脚本系统）  
**状态**: ✅ 当前实现

---

## 一、核心概念

### 1.1 有向语言对（Directed Language Pair）

Pool系统基于**有向语言对**实现节点分组和任务路由：

- **有向性**: `zh:en` 和 `en:zh` 是**两个不同的Pool**
- **源语言（src）**: ASR 识别的语言
- **目标语言（tgt）**: TTS 输出的语言（任务查找与池分配一致）
- **笛卡尔积**: 节点加入所有 **（ASR 语言 × TTS 语言）** 的 Pool；Semantic 仅用于能力校验

### 1.2 为什么使用有向语言对？

```
示例：节点支持
- ASR 语言: [zh, en]
- TTS 语言: [zh, en]（池分配用 asr×tts，与任务查找一致）

生成的 Pool（4 个）:
- zh:zh（中文识别 → 中文输出）
- zh:en（中文识别 → 英文输出）
- en:zh（英文识别 → 中文输出）
- en:en（英文识别 → 英文输出）
```

**优势**:
- ✅ 精确匹配任务需求
- ✅ 支持单向翻译场景
- ✅ 自动化Pool管理
- ✅ Redis Lua脚本驱动

---

## 二、Pool数据结构

### 2.1 Redis Key设计

**节点信息**:
```
Key: lingua:v1:node:{node_id}
Type: Hash
Fields:
  - asr_langs: JSON 数组 ["zh", "en"]
  - semantic_langs: JSON 数组 ["zh", "en"]（能力校验用）
  - tts_langs: JSON 数组 ["zh", "en", "ja"]（池分配用 asr×tts）
  - last_heartbeat_ts: Unix 时间戳
TTL: 3600 秒
```

**Pool成员（分片）**:
```
Key: lingua:v1:pool:{src}:{tgt}:{pool_id}:nodes
Type: Set
Value: node_id列表
TTL: 3600秒

示例:
  lingua:v1:pool:zh:en:0:nodes = {node1, node2, node3}
  lingua:v1:pool:zh:en:1:nodes = {node4, node5}
  lingua:v1:pool:en:zh:0:nodes = {node1, node2}
```

**节点Pool映射**:
```
Key: lingua:v1:node:{node_id}:pools
Type: Hash
Fields: "{src}:{tgt}" → pool_id
TTL: 3600秒

示例:
  lingua:v1:node:node1:pools:
    zh:zh → "0"
    zh:en → "0"
    en:zh → "0"
    en:en → "0"
```

**Job节点绑定（timeout finalize）**:
```
Key: lingua:v1:job:{job_id}:node
Type: String
Value: node_id
TTL: 3600秒
```

### 2.2 Pool分片机制

**分片规则**:
- 每个语言对可以有 0-999 个Pool
- 每个Pool最多 100 个节点
- 节点数超过100时自动创建新Pool

**分片示例**:
```
假设 zh:en 语言对有 250 个节点:
  lingua:v1:pool:zh:en:0:nodes (100个节点)
  lingua:v1:pool:zh:en:1:nodes (100个节点)
  lingua:v1:pool:zh:en:2:nodes (50个节点)
```

---

## 三、节点注册和Pool分配

### 3.1 注册流程

```
Node → WebSocket 连接
    ↓
Scheduler → 接收注册消息
    ↓
提取 language_capabilities:
    - asr_languages: [zh, en, de]
    - semantic_languages: [zh, en]（能力校验，必填）
    - tts_languages: [zh, en, ja]（池分配用 asr×tts）
    ↓
调用 register_node_v2.lua
    ↓ 写入
Redis: lingua:v1:node:{node_id}
       asr_langs, semantic_langs, tts_langs, last_heartbeat_ts
    ↓
返回注册成功
```

**register_node_v2.lua 关键逻辑**:
```lua
local node_key = "lingua:v1:node:" .. node_id
redis.call("HMSET", node_key,
    "asr_langs", asr_langs_json,
    "semantic_langs", semantic_langs_json,
    "tts_langs", tts_langs_json,
    "last_heartbeat_ts", tostring(now_ts)
)
redis.call("EXPIRE", node_key, 3600)
redis.call("SADD", "lingua:v1:nodes:all", node_id)
```

### 3.2 自动 Pool 分配（心跳时）

**触发**: 节点发送心跳时自动分配

```
Node → 心跳消息
    ↓
Scheduler → 调用 PoolService.heartbeat()
    ↓
执行 heartbeat_with_pool_assign.lua
    ↓
生成笛卡尔积（池分配用 asr×tts，与任务查找一致）:
    ASR={zh,en,de} × TTS={zh,en,ja}
    = [zh:zh, zh:en, zh:ja, en:zh, en:en, en:ja, de:zh, de:en, de:ja] 等
    ↓
为每个语言对分配 Pool（逻辑同前）
    ↓
返回 "OK:N_pairs"
```

**heartbeat_with_pool_assign.lua 关键逻辑**:
```lua
-- 从节点读取 asr_langs、tts_langs；生成有向语言对 (asr × tts)
local directed_pairs = {}
for _, src in ipairs(asr_langs) do
    for _, tgt in ipairs(tts_langs) do
        table.insert(directed_pairs, src .. ":" .. tgt)
    end
end

-- 为每个语言对分配池
for _, pair_key in ipairs(directed_pairs) do
    local existing_pool_id = redis.call("HGET", node_pools_key, pair_key)
    
    if existing_pool_id then
        -- 已分配，刷新
        local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. existing_pool_id .. ":nodes"
        redis.call("SADD", pool_key, node_id)
        redis.call("EXPIRE", pool_key, 3600)
    else
        -- 未分配，查找非满的池
        for pool_id = 0, MAX_POOL_ID do
            local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
            local current_size = redis.call("SCARD", pool_key)
            
            if current_size < MAX_POOL_SIZE then
                redis.call("SADD", pool_key, node_id)
                redis.call("EXPIRE", pool_key, 3600)
                redis.call("HSET", node_pools_key, pair_key, tostring(pool_id))
                assigned = true
                break
            end
        end
    end
end
```

---

## 四、节点选择流程

### 4.1 任务分发

```
Session → 音频数据 + 语言需求(src_lang, tgt_lang)
    ↓
create_job_with_minimal_scheduler()
    ↓
PoolService.select_node(src_lang, tgt_lang, job_id)
    ↓
执行 select_node.lua
    ↓
查找Pool: lingua:v1:pool:{src}:{tgt}:*:nodes
    ↓
随机选择非空Pool
    ↓
从Pool中随机选择节点（SRANDMEMBER）
    ↓
返回 node_id
```

### 4.2 select_node.lua 详解

**输入参数**:
- `ARGV[1]`: `pair_key`（如 `"zh:en"`）
- `ARGV[2]`: `job_id`（可选，用于timeout finalize绑定）

**核心逻辑**:
```lua
local pair_key = ARGV[1]
local job_id = ARGV[2]

-- 1. 检查是否已绑定（timeout finalize）
if job_id and job_id ~= "" then
    local binding_key = "lingua:v1:job:" .. job_id .. ":node"
    local bound_node = redis.call("GET", binding_key)
    if bound_node then
        return bound_node  -- 返回已绑定的节点
    end
end

-- 2. 查找所有非空的池（pool_id: 0-999）
local pool_ids = {}
for pool_id = 0, MAX_POOL_ID do
    local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
    local current_size = redis.call("SCARD", pool_key)
    
    if current_size > 0 then
        table.insert(pool_ids, pool_id)
    elseif current_size == 0 and pool_id > 0 and #pool_ids > 0 then
        break  -- 连续空池，停止查找
    end
end

if #pool_ids == 0 then
    return nil  -- 没有可用的池
end

-- 3. 随机选择一个池
math.randomseed(tonumber(redis.call("TIME")[1]) + tonumber(redis.call("TIME")[2]))
local selected_pool_id = pool_ids[math.random(#pool_ids)]

-- 4. 从池中随机选择一个节点
local selected_pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. selected_pool_id .. ":nodes"
local node_id = redis.call("SRANDMEMBER", selected_pool_key)

-- 5. 如果有 job_id，记录绑定（timeout finalize）
if job_id and job_id ~= "" then
    local binding_key = "lingua:v1:job:" .. job_id .. ":node"
    redis.call("SET", binding_key, node_id, "EX", 3600)
end

return node_id
```

### 4.3 Timeout Finalize绑定

**场景**: 长音频被超时切分时，后续任务需要发送到同一节点

**实现**:
1. 第一次选择：随机选择节点，记录绑定
2. 后续任务：使用相同job_id，返回已绑定的节点
3. 节点下线：自动清理绑定，重新选择

**代码**:
```rust
// pool/pool_service.rs
pub async fn select_node(
    &self,
    src_lang: &str,
    tgt_lang: &str,
    job_id: Option<&str>,  // 传入job_id以启用绑定
) -> Result<String>
```

---

## 五、负载均衡策略

### 5.1 两级随机

**Pool级随机**:
- 从所有非空Pool中随机选择一个
- 使用Redis TIME作为随机种子

**Node级随机**:
- 使用`SRANDMEMBER`随机选择节点
- Redis原生命令，O(1)复杂度

### 5.2 优势

- ✅ **简单**: 无需维护负载状态
- ✅ **快速**: 所有操作O(1)或O(log N)
- ✅ **公平**: 随机分布，无热点
- ✅ **无锁**: 完全基于Redis原子操作

---

## 六、Pool统计和监控

### 6.1 查看Pool信息

**查看所有Pool**:
```bash
redis-cli KEYS "lingua:v1:pool:*:nodes"
```

**查看特定语言对的Pool**:
```bash
# 查看 zh:en 的所有Pool
redis-cli KEYS "lingua:v1:pool:zh:en:*:nodes"

# 统计Pool成员数
redis-cli SCARD lingua:v1:pool:zh:en:0:nodes
```

**查看节点的Pool映射**:
```bash
redis-cli HGETALL lingua:v1:node:node1:pools
```

### 6.2 Pool统计脚本

```bash
#!/bin/bash
# 统计所有语言对的Pool分布

for pair in zh:en en:zh zh:zh en:en; do
    echo "=== Language Pair: $pair ==="
    for id in {0..10}; do
        count=$(redis-cli SCARD "lingua:v1:pool:$pair:$id:nodes")
        if [ "$count" -gt 0 ]; then
            echo "  Pool $id: $count nodes"
        fi
    done
done
```

---

## 七、配置

### 7.1 Pool参数

**在Lua脚本中硬编码**:
```lua
local MAX_POOL_SIZE = 100    -- 每个Pool最多100个节点
local MAX_POOL_ID = 999      -- Pool ID范围: 0-999
```

**节点TTL**:
```lua
redis.call("EXPIRE", node_key, 3600)      -- 节点信息TTL: 1小时
redis.call("EXPIRE", pool_key, 3600)      -- Pool成员TTL: 1小时
redis.call("EXPIRE", node_pools_key, 3600) -- Pool映射TTL: 1小时
```

### 7.2 修改Pool参数

如需修改Pool参数，需要编辑Lua脚本：
- `scripts/lua/heartbeat_with_pool_assign.lua`（修改MAX_POOL_SIZE）
- `scripts/lua/select_node.lua`（修改MAX_POOL_ID）

---

## 八、完整数据流

### 8.1 节点生命周期

```
1. 注册
   └→ register_node_v2.lua
       └→ 写入 lingua:v1:node:{id}
       └→ 添加到 lingua:v1:nodes:all

2. 心跳（30-60秒一次）
   └→ heartbeat_with_pool_assign.lua
       └→ 刷新TTL
       └→ 生成笛卡尔积: ASR × Semantic
       └→ 为每个语言对分配Pool
           └→ 查找非满Pool（<100节点）
           └→ 添加到 lingua:v1:pool:{src}:{tgt}:{id}:nodes
           └→ 记录映射 lingua:v1:node:{id}:pools

3. 下线
   └→ TTL过期（3600秒无心跳）
       └→ Redis自动删除所有相关Key
```

### 8.2 任务分发流程

```
1. 任务创建
   └→ create_job_with_minimal_scheduler()
       └→ 生成 pair_key = "zh:en"
       
2. 节点选择
   └→ PoolService.select_node("zh", "en", job_id)
       └→ select_node.lua
           └→ 检查绑定（如有job_id）
           └→ 查找非空Pool
           └→ 随机选择Pool
           └→ 随机选择节点
           └→ 记录绑定（如有job_id）
           └→ 返回 node_id
           
3. 任务投递
   └→ 通过WebSocket发送到选中的节点
```

---

## 九、语言能力定义

### 9.1 节点注册消息

```rust
// websocket/node_handler/message/register.rs
fn extract_asr_and_semantic_langs(
    lang_caps: &Option<NodeLanguageCapabilities>,
) -> Result<(Vec<String>, Vec<String>)>
```

**消息格式**:
```json
{
  "type": "register",
  "language_capabilities": {
    "asr_languages": ["zh", "en", "de"],
    "semantic_languages": ["zh", "en"]
  }
}
```

### 9.2 语言能力规则

**必需字段**:
- `asr_languages`: 不能为空（ASR识别的语言）
- `semantic_languages`: 不能为空（Semantic必需）

**Pool生成**:
```
ASR = [zh, en, de]
Semantic = [zh, en]

生成Pool（笛卡尔积）:
zh:zh, zh:en, en:zh, en:en, de:zh, de:en
共 6 个有向语言对
```

---

## 十、最佳实践

### 10.1 节点配置

**推荐配置**:
```json
{
  "language_capabilities": {
    "asr_languages": ["zh", "en"],
    "semantic_languages": ["zh", "en"]
  }
}
```

**生成的Pool**: 4个（zh:zh, zh:en, en:zh, en:en）

### 10.2 Pool容量规划

**估算Pool数量**:
```
Pool数量 = ASR语言数 × Semantic语言数 × 分片数

示例:
- 3种ASR语言 × 3种Semantic语言 = 9个语言对
- 每个语言对平均150个节点 → 2个分片
- 总Pool数 = 9 × 2 = 18个Pool
```

### 10.3 监控建议

**关键指标**:
- Pool数量和分布
- 每个Pool的节点数
- 空Pool数量（可能的配置问题）
- 节点的Pool归属数量

**监控脚本**:
```bash
# 统计总Pool数
redis-cli KEYS "lingua:v1:pool:*:nodes" | wc -l

# 统计节点总数
redis-cli SCARD lingua:v1:nodes:all

# 查看最大的Pool
redis-cli --scan --pattern "lingua:v1:pool:*:nodes" | \
  xargs -I {} redis-cli SCARD {} | sort -nr | head -10
```

---

## 十一、故障处理

### 11.1 节点离线

**自动清理**:
- TTL过期（3600秒） → Redis自动删除
- 包括：节点信息、Pool成员、Pool映射

**无需手动清理**！

### 11.2 Pool空

**原因**:
- 所有节点离线
- 语言对无匹配节点

**处理**:
- `select_node.lua` 返回 `nil`
- Scheduler降级到全局查询（`select_node_fallback`）

### 11.3 Pool分片过多

**原因**:
- 节点数量激增
- Pool分片过多（如超过10个）

**处理**:
- 考虑增加`MAX_POOL_SIZE`（需修改Lua脚本）
- 或接受分片（对性能影响很小）

---

## 十二、与旧系统的差异

### 12.1 旧系统（已废弃）

**Phase3Config系统**:
- 基于配置文件（`config.toml`）
- 语言集合Pool（如 `"en-zh"` 包含多个方向）
- 手动或自动生成Pool配置

**状态**: ✅ **已完全删除**

### 12.2 新系统（当前）

**MinimalScheduler + PoolService**:
- 基于Lua脚本
- 有向语言对Pool（`zh:en` ≠ `en:zh`）
- 自动分配（笛卡尔积）
- Redis直查（SSOT）

**状态**: ✅ **当前唯一实现**

---

## 十三、代码模块

### 13.1 核心模块

| 模块 | 职责 |
|------|------|
| `services/minimal_scheduler.rs` | Lua脚本加载和执行 |
| `pool/pool_service.rs` | Pool服务接口 |
| `pool/types.rs` | 有向语言对类型定义 |
| `scripts/lua/*.lua` | Pool逻辑实现 |

### 13.2 关键类型

```rust
// pool/types.rs
pub struct DirectedLangPair {
    pub src: String,  // ASR识别的语言
    pub tgt: String,  // Semantic/TTS输出的语言
}

impl DirectedLangPair {
    pub fn to_key(&self) -> String {
        format!("{}:{}", self.src, self.tgt)
    }
}

// 生成笛卡尔积
pub fn extract_directed_pairs(
    asr_langs: &[String],
    semantic_langs: &[String],
) -> Vec<DirectedLangPair>
```

---

**参考文档**:
- [Scheduler架构](./ARCHITECTURE.md)
- [节点注册协议](./NODE_REGISTRATION.md)
- [Redis数据模型](./REDIS_DATA_MODEL.md)
- [pool/types.rs 源码](../../src/pool/types.rs)
- [Lua脚本目录](../../scripts/lua/)
