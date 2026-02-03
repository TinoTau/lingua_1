# Pool 模块

## 文件结构

```
src/pool/
├── mod.rs           # 模块导出
├── types.rs         # 类型定义（LangSet, POOL_SIZE）
├── node_index.rs    # 节点信息查询
└── pool_service.rs  # Pool 管理和节点选择
```

## 核心逻辑

### 两层结构

```
语言集合 (LangSet)
  └─ 二级池 (每100个节点)
```

### 关键操作

1. **注册**：写入节点信息（`asr_langs`、`semantic_langs`、`tts_langs`），不分配池
2. **心跳**：按 **（asr_langs × semantic_langs）** 生成有向语言对（根据语义修复能力建池），自动分配到未满的池；仅刷新 **node** 的 **TTL（3×心跳周期）**；**node:pools 不 EXPIRE**，供多池懒清理
3. **选择**：按 `pair_key` 查池，随机池 → 随机节点；**EXISTS** 校验；死节点则 **HGETALL node:pools**，从**所有**池 **SREM** 并 **DEL** node:pools，再重试
4. **下线**：从池中移除，池空则删除

## 使用示例

```rust
// 初始化（第二参数 = 节点端心跳间隔秒；TTL = 3×该值，用于被动清理）
let pool_service = PoolService::new(redis, 15).await?;

// 节点心跳（自动分配池）
pool_service.heartbeat(node_id).await?;

// 选择节点
let node = pool_service.select_node("en", "zh", None, Some("session-123")).await?;

// Finalize（绑定到原节点）
let node = pool_service.select_node("en", "zh", Some(&job_id), Some("session-123")).await?;

// 节点下线
pool_service.node_offline(node_id).await?;
```

## Redis Key 说明

### 节点信息
- `lingua:v1:node:{id}` - 基础信息（含 `asr_langs`、`semantic_langs`、`tts_langs`）
- `lingua:v1:node:{id}:pools` - 节点所在的池（映射表）；池分配用 asr×semantic（根据语义修复能力建池）

### 池信息
- `lingua:v1:pool:{lang}:{id}:nodes` - 池的节点集合（Set）
- `lingua:v1:pool:{lang}:{id}:count` - 池的节点计数

### Job 绑定
- `lingua:v1:job:{id}:node` - Job 绑定的节点

### 全局集合
- `lingua:v1:nodes:all` - 所有节点

## 代码量

- types.rs: ~60 行
- node_index.rs: ~80 行
- pool_service.rs: ~120 行

**总计：~260 行**

简单、清晰、易维护！
