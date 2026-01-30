# 节点注册协议

**版本**: v3.0（Lua脚本系统）  
**状态**: ✅ 当前实现

---

## 一、注册流程

### 1.1 完整流程图

```
Node                    Scheduler                   Redis
 │                         │                          │
 ├─ WebSocket连接 ────────→ │                          │
 │                         ├─ 生成node_id             │
 │                         ├─ 提取语言能力            │
 │                         │   (ASR + Semantic + TTS) │
 │                         │                          │
 │                         ├─ register_node_v2.lua ──→ │
 │                         │                          ├─ HMSET lingua:v1:node:{id}
 │                         │                          ├─ SADD lingua:v1:nodes:all
 │                         │                          └─ EXPIRE 3600
 │                         │                          │
 │                         ├─ 注册WebSocket连接(本地) │
 │ ←────── 注册成功 ─────── │                          │
 │                         │                          │
 ├─ 开始心跳(30-60秒) ────→ │                          │
 │                         ├─ heartbeat_pool_assign ─→ │
 │                         │                          ├─ 生成笛卡尔积
 │                         │                          ├─ 分配到Pool
 │                         │                          └─ 记录映射
 │ ←────── 心跳响应 ─────── │                          │
```

### 1.2 关键步骤

**Step 1: 提取语言能力**
```rust
// websocket/node_handler/message/register.rs
fn extract_langs(lang_caps: &Option<NodeLanguageCapabilities>)
    -> Result<(Vec<String>, Vec<String>, Vec<String>)> {
    let asr_langs = caps.asr_languages.ok_or("asr_languages is required")?;
    let semantic_langs = caps.semantic_languages.ok_or("semantic_languages is required")?;
    let tts_langs = caps.tts_languages.ok_or("tts_languages is required")?;
    // 验证非空；Semantic 能力校验，池分配用 asr×tts
    Ok((asr_langs, semantic_langs, tts_langs))
}
```

**Step 2: 调用 Lua 注册**
```rust
// services/minimal_scheduler.rs
pub async fn register_node(&self, req: RegisterNodeRequest) -> Result<()> {
    self.eval_script::<String>(
        &self.scripts.register_node,
        &[],
        &[&req.node_id, &req.asr_langs_json, &req.semantic_langs_json, &req.tts_langs_json],
    ).await?;
    Ok(())
}
```

**Step 3: Lua 写入 Redis**
```lua
-- scripts/lua/register_node_v2.lua
local node_key = "lingua:v1:node:" .. node_id
redis.call("HMSET", node_key,
    "asr_langs", asr_langs_json,
    "semantic_langs", semantic_langs_json,
    "tts_langs", tts_langs_json,
    "last_heartbeat_ts", tostring(now_ts)
)
redis.call("EXPIRE", node_key, 3600)
redis.call("SADD", "lingua:v1:nodes:all", node_id)
return "OK"
```

---

## 二、注册消息格式

### 2.1 消息结构

```json
{
  "type": "register",
  "version": "3.0",
  "language_capabilities": {
    "asr_languages": ["zh", "en", "de"],
    "semantic_languages": ["zh", "en"],
    "tts_languages": ["zh", "en", "ja"]
  }
}
```

`tts_languages` 必填；池分配使用 (asr×tts)，与任务查找 (src, tgt) 一致。

### 2.2 必需字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `language_capabilities` | Object | ✅ | 语言能力对象 |
| `asr_languages` | String[] | ✅ | ASR识别的语言列表 |
| `semantic_languages` | String[] | ✅ | Semantic支持的语言列表 |

### 2.3 字段验证

```rust
// 验证逻辑
if asr_langs.is_empty() {
    return Err("asr_languages cannot be empty");
}

if semantic_langs.is_empty() {
    return Err(
        "semantic_languages cannot be empty. \
         Semantic service is mandatory for all nodes."
    );
}
```

---

## 三、心跳机制

### 3.1 心跳消息

```json
{
  "type": "heartbeat",
  "node_id": "node-abc123"
}
```

### 3.2 心跳处理

**Rust层**:
```rust
// websocket/node_handler/heartbeat.rs
pub async fn handle_heartbeat(node_id: &str) {
    pool_service.heartbeat(node_id).await?;
}
```

**Lua层（heartbeat_with_pool_assign.lua）**:
```lua
-- 1. 验证节点存在
local node_key = "lingua:v1:node:" .. node_id
local exists = redis.call("EXISTS", node_key)
if exists == 0 then
    return "ERROR:NODE_NOT_REGISTERED"
end

-- 2. 刷新心跳时间和TTL
redis.call("HSET", node_key, "last_heartbeat_ts", tostring(now_ts))
redis.call("EXPIRE", node_key, 3600)

-- 3. 读取语言能力（池分配用 asr×tts）
local asr_langs = cjson.decode(redis.call("HGET", node_key, "asr_langs"))
local tts_langs = cjson.decode(redis.call("HGET", node_key, "tts_langs"))

-- 4. 生成笛卡尔积 (asr × tts)
local directed_pairs = {}
for _, src in ipairs(asr_langs) do
    for _, tgt in ipairs(tts_langs) do
        table.insert(directed_pairs, src .. ":" .. tgt)
    end
end

-- 5. 分配到Pool（查找非满的Pool）
for _, pair_key in ipairs(directed_pairs) do
    -- 查找或分配Pool
    for pool_id = 0, MAX_POOL_ID do
        local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
        local current_size = redis.call("SCARD", pool_key)
        
        if current_size < MAX_POOL_SIZE then
            redis.call("SADD", pool_key, node_id)
            redis.call("EXPIRE", pool_key, 3600)
            redis.call("HSET", node_pools_key, pair_key, tostring(pool_id))
            break
        end
    end
end

return "OK:" .. #directed_pairs .. "_pairs"
```

### 3.3 心跳频率

**推荐**: 30-60秒

**TTL设计**:
- 节点TTL: 3600秒（1小时）
- 心跳间隔: 30秒
- 缓冲: 60倍（3600/30 = 120次容错）

---

## 四、语言能力详解

### 4.1 ASR 语言 vs TTS 语言（池分配）

**ASR 语言**:
- 用途: 语音识别
- 作为: Pool 的**源语言（src）**

**TTS 语言**:
- 用途: 合成输出；池分配使用 **(asr × tts)**，与任务查找 (src, tgt) 一致
- 作为: Pool 的**目标语言（tgt）**

**Semantic 语言**: 仍必填，仅用于能力校验，不参与池 key 生成。

### 4.2 笛卡尔积示例

```
节点注册:
  ASR = [zh, en, de]
  TTS = [zh, en]  （池分配用 asr×tts）

生成的语言对（6 个）:
  zh:zh, zh:en, en:zh, en:en, de:zh, de:en

节点加入 6 个不同的 Pool
```

### 4.3 代码实现

```rust
// pool/types.rs
pub fn extract_directed_pairs(
    asr_langs: &[String],
    tgt_langs: &[String],  // 池分配时传入 tts_langs
) -> Vec<DirectedLangPair> {
    let mut pairs = Vec::new();
    for src in asr_langs {
        for tgt in tgt_langs {
            pairs.push(DirectedLangPair::new(src, tgt));
        }
    }
    pairs
}
```

---

## 五、注册验证

### 5.1 Lua脚本验证

```lua
-- register_node_v2.lua
if not asr_langs_json or asr_langs_json == "" then
    return redis.error_reply("ERROR:asr_langs_json_required")
end

if not semantic_langs_json or semantic_langs_json == "" then
    return redis.error_reply("ERROR:semantic_langs_json_required_Semantic_service_is_mandatory")
end
```

### 5.2 Rust层验证

```rust
// websocket/node_handler/message/register.rs:66-101
pub async fn handle_node_register(...) -> Result<()> {
    // 1. 验证MinimalScheduler已初始化
    let scheduler = state.minimal_scheduler.as_ref()
        .ok_or("MinimalSchedulerService not initialized")?;
    
    // 2. 提取并验证语言能力
    let (asr_langs, semantic_langs) = 
        extract_asr_and_semantic_langs(&language_capabilities)?;
    
    // 3. 调用Lua注册
    scheduler.register_node(req).await?;
    
    // 4. 注册WebSocket连接
    state.node_connections.register(node_id, tx).await;
    
    Ok(())
}
```

---

## 六、错误处理

### 6.1 注册错误码

| 错误码 | 场景 | 处理 |
|--------|------|------|
| `asr_langs_json_required` | 缺少ASR语言 | 拒绝注册 |
| `semantic_langs_json_required` | 缺少Semantic语言 | 拒绝注册 |
| `MinimalSchedulerService not initialized` | Phase2未启用 | 检查配置 |

### 6.2 心跳错误码

| 错误码 | 场景 | 处理 |
|--------|------|------|
| `NODE_NOT_REGISTERED` | 节点未注册 | 重新注册 |
| `MISSING_LANG_CAPABILITIES` | 语言能力缺失 | 检查节点数据 |
| `NO_AVAILABLE_POOL_FOR_{pair}` | Pool分配失败 | 检查Pool容量 |

---

## 七、日志记录

### 7.1 注册流程日志

```rust
// websocket/node_handler/message/register.rs
info!(step = "register_start", "【节点管理流程】注册流程开始");
info!(step = "register_id_generated", node_id = %node_id, "【节点管理流程】节点 ID 已生成");
info!(step = "register_langs_validated", asr = ?asr_langs, semantic = ?semantic_langs, "【节点管理流程】语言能力验证通过");
info!(step = "register_redis_write", "【节点管理流程】准备写入 Redis");
info!(step = "register_redis_success", elapsed_ms = elapsed, "【节点管理流程】Redis 注册成功");
info!(step = "register_connection_registered", "【节点管理流程】WebSocket 连接已注册");
info!(step = "register_complete", "【节点管理流程】注册流程完成");
```

### 7.2 心跳流程日志

```rust
debug!("节点心跳: {}", node_id);
debug!("心跳成功: {} ({} pairs)", node_id, pair_count);
```

---

## 八、节点下线

### 8.1 自动下线

**触发**: TTL过期（3600秒无心跳）

**清理内容**:
- `lingua:v1:node:{node_id}` → 自动删除
- `lingua:v1:pool:{src}:{tgt}:{pool_id}:nodes` → 自动删除成员
- `lingua:v1:node:{node_id}:pools` → 自动删除

**无需手动清理**！

### 8.2 手动下线

如需手动清理节点，可执行：
```bash
# 删除节点信息
redis-cli DEL lingua:v1:node:abc123
redis-cli DEL lingua:v1:node:abc123:pools

# 从Pool中移除（需要知道Pool列表）
redis-cli SREM lingua:v1:pool:zh:en:0:nodes abc123
```

或使用Lua脚本：
```bash
# node_offline.lua（如果实现了）
redis-cli EVAL "$(cat scripts/lua/node_offline.lua)" 0 abc123
```

---

## 九、最佳实践

### 9.1 语言能力规划

**推荐配置**:
```json
{
  "asr_languages": ["zh", "en"],
  "semantic_languages": ["zh", "en"]
}
```
生成4个Pool（zh:zh, zh:en, en:zh, en:en）

**避免过多语言**:
```json
{
  "asr_languages": ["zh", "en", "de", "fr", "es"],  // 5种
  "semantic_languages": ["zh", "en", "de", "fr"]    // 4种
}
```
生成20个Pool（可能导致Pool分散）

### 9.2 心跳频率

**推荐**: 30秒

**计算**:
```
TTL = 3600秒
心跳间隔 = 30秒
容错次数 = 3600 / 30 = 120次

即使连续119次心跳失败，节点仍然在线
```

### 9.3 节点ID生成

**自动生成**:
```rust
format!("node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase())
// 示例: node-A1B2C3D4
```

**手动指定**:
- 节点可以在注册消息中提供`node_id`
- Scheduler优先使用提供的ID

---

## 十、监控和调试

### 10.1 查看注册状态

```bash
# 查看所有已注册节点
redis-cli SMEMBERS lingua:v1:nodes:all

# 查看节点详细信息
redis-cli HGETALL lingua:v1:node:abc123

# 查看节点的Pool归属
redis-cli HGETALL lingua:v1:node:abc123:pools
```

### 10.2 调试注册问题

**问题**: 节点注册失败

**检查清单**:
1. ✅ Phase2是否启用？（`config.toml: phase2.enabled = true`）
2. ✅ Redis是否可连接？
3. ✅ `asr_languages` 和 `semantic_languages` 是否都提供？
4. ✅ 语言列表是否非空？

**查看日志**:
```
【节点管理流程】step=register_start
【节点管理流程】step=register_id_generated node_id=node-ABC123
【节点管理流程】step=register_langs_validated asr=[zh,en] semantic=[zh,en]
【节点管理流程】step=register_redis_write
【节点管理流程】step=register_redis_success elapsed_ms=5
【节点管理流程】step=register_connection_registered
【节点管理流程】step=register_complete
```

---

## 十一、与旧系统的差异

### 11.1 旧系统（已废弃）

**服务能力结构**:
```json
{
  "services": [
    {"service_type": "ASR", "capabilities": {"languages": [...]}},
    {"service_type": "SemanticRepair", "capabilities": {"languages": [...]}}
  ]
}
```

**问题**: 需要遍历服务列表，复杂

### 11.2 新系统（当前）

**语言能力结构**:
```json
{
  "language_capabilities": {
    "asr_languages": [...],
    "semantic_languages": [...]
  }
}
```

**优势**: 
- ✅ 扁平化结构
- ✅ 直接提取
- ✅ 明确语义

---

## 十二、代码参考

### 12.1 关键文件

| 文件 | 职责 |
|------|------|
| `websocket/node_handler/message/register.rs` | 注册消息处理 |
| `services/minimal_scheduler.rs` | Lua脚本调用 |
| `scripts/lua/register_node_v2.lua` | 注册Lua实现 |
| `scripts/lua/heartbeat_with_pool_assign.lua` | 心跳和Pool分配 |
| `pool/types.rs` | 有向语言对类型 |

### 12.2 日志标记

搜索关键字：
- `【节点管理流程】` - 注册流程日志
- `step=register_*` - 注册各步骤
- `step=heartbeat_*` - 心跳流程

---

**参考文档**:
- [Pool架构](../architecture/POOL_ARCHITECTURE.md)
- [Scheduler架构](../architecture/ARCHITECTURE.md)
- [Redis数据模型](../architecture/REDIS_DATA_MODEL.md)
