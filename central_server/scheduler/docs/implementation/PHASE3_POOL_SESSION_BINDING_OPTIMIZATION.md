# Phase3 Pool 与 Session 绑定优化方案

## 问题分析

### 当前实现的问题

当前设计中，每次任务分配时都会执行以下操作：

1. **计算 Eligible Pools**（根据 `src_lang` 和 `tgt_lang`）
   - 需要遍历所有 Pool 配置，匹配语言对
   - 时间复杂度：O(N)，其中 N 是 Pool 数量

2. **选择 Preferred Pool**（根据 `routing_key` 和 `enable_session_affinity`）
   - 如果 `enable_session_affinity = true`：使用 hash 函数基于 `routing_key` 选择
   - 如果 `enable_session_affinity = false`：随机选择
   - 时间复杂度：O(1) 或 O(log N)

3. **从 Redis 读取 Pool 成员**
   - 需要网络 I/O，可能耗时 10-50ms
   - 如果启用批量读取，可能有优化

4. **在 Pool 内选择节点**
   - 随机采样或全量遍历
   - 时间复杂度：O(M)，其中 M 是 Pool 内节点数量

**总开销**：即使 `enable_session_affinity = true`，每次任务分配仍然需要执行上述 1-4 步骤，存在明显的性能开销。

### 用户提出的优化建议

**建议**：在 session 创建时就绑定 pool，避免每次任务分配都重新计算。

**优势**：
- ✅ 减少重复计算：eligible pools 计算、pool 选择等操作只需要执行一次
- ✅ 减少 Redis 查询：pool 成员只需要读取一次
- ✅ 提高性能：后续任务分配直接使用绑定的 pool

**挑战**：
- ⚠️ **语言对可能变化**：一个 session 中，用户可能先说 `zh→en`，然后改成 `en→zh` 或其他语言对
- ⚠️ **Pool 成员可能变化**：节点可能离线、Pool 配置可能更新
- ⚠️ **多语言对支持**：一个 session 可能需要支持多个语言对

---

## 当前设计的分析

### 1. Session Affinity 的当前实现

当前代码中，`enable_session_affinity` 的行为：

```rust
// 在 select_node_phase3 中
if cfg.enable_session_affinity {
    // 使用 hash 函数基于 routing_key 选择 preferred pool
    preferred_idx = crate::phase3::pick_index_for_key(eligible.len(), cfg.hash_seed, routing_key);
    preferred_pool = eligible[preferred_idx];
} else {
    // 随机选择 preferred pool（无 session affinity）
    let mut rng = thread_rng();
    if let Some(&pool) = eligible.choose(&mut rng) {
        preferred_pool = pool;
    }
}
```

**关键点**：
- `routing_key` 优先 `tenant_id`，其次 `session_id`
- 同一个 `routing_key` 会 hash 到同一个 pool（如果该 pool 在 eligible pools 中）
- 但**每次任务分配仍然需要计算 eligible pools**（因为 `src_lang` 和 `tgt_lang` 可能不同）

### 2. 语言对变化的场景

在面对面翻译场景中，语言对通常是固定的（如 `zh↔en`），但可能存在以下情况：

1. **动态语言检测**：用户可能说中文或英文，系统自动检测
2. **语言切换**：用户可能在会话中切换语言
3. **多语言支持**：一个 session 可能需要支持多个语言对（如 `zh↔en` 和 `zh↔ja`）

### 3. Pool 成员变化的场景

1. **节点离线**：节点可能因为故障、网络等问题离线
2. **Pool 配置更新**：管理员可能更新 Pool 配置
3. **节点能力变化**：节点可能更新服务能力，导致 Pool 成员变化

---

## 优化方案设计

### 方案 1：Session 级别的 Pool 绑定（推荐）

**设计思路**：
1. 在 session 创建时，根据首次任务的 `src_lang` 和 `tgt_lang` 计算 eligible pools 并选择 preferred pool
2. 将 preferred pool 存储在 session 状态中
3. 后续任务分配时，优先使用绑定的 pool，但如果语言对变化，重新计算

**实现细节**：

```rust
// 在 Session 结构中添加字段
pub struct Session {
    // ... 现有字段
    /// Phase3: 绑定的 preferred pool（可选）
    /// 如果为 None，表示尚未绑定或需要重新计算
    pub preferred_pool: Option<u16>,
    /// Phase3: 绑定的语言对（用于验证是否需要重新计算）
    pub bound_lang_pair: Option<(String, String)>, // (src_lang, tgt_lang)
}

// 在任务分配时
impl JobDispatcher {
    async fn select_node_for_job_creation(
        &self,
        routing_key: &str,
        session_id: &str,
        src_lang: &str,
        tgt_lang: &str,
        // ... 其他参数
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        // 检查 session 是否已有绑定的 pool
        let session = self.state.session_manager.get_session(session_id).await;
        let bound_pool = session.and_then(|s| {
            // 检查语言对是否变化
            if let Some((bound_src, bound_tgt)) = s.bound_lang_pair.as_ref() {
                if bound_src == src_lang && bound_tgt == tgt_lang {
                    return s.preferred_pool;
                }
            }
            None
        });

        if let Some(pool_id) = bound_pool {
            // 使用绑定的 pool，直接选择节点
            // 跳过 eligible pools 计算和 preferred pool 选择
            // 但仍需要从 Redis 读取 pool 成员（因为成员可能变化）
            // 可以使用缓存优化
        } else {
            // 首次任务或语言对变化：重新计算 eligible pools 并选择 preferred pool
            // 将结果存储在 session 中
        }
    }
}
```

**优势**：
- ✅ 减少重复计算：eligible pools 和 preferred pool 选择只需要在首次任务或语言对变化时执行
- ✅ 保持灵活性：如果语言对变化，自动重新计算
- ✅ 兼容现有设计：不破坏现有的 session affinity 逻辑

**劣势**：
- ⚠️ 仍需要从 Redis 读取 pool 成员（但可以使用缓存优化）
- ⚠️ 需要处理 Pool 成员变化的场景（可以使用 TTL 缓存）

### 方案 2：Session 级别的 Pool 成员缓存

**设计思路**：
在方案 1 的基础上，进一步缓存 pool 成员列表，减少 Redis 查询。

**实现细节**：

```rust
// 在 Session 结构中添加缓存字段
pub struct Session {
    // ... 现有字段
    pub preferred_pool: Option<u16>,
    pub bound_lang_pair: Option<(String, String)>,
    /// Phase3: 缓存的 pool 成员列表（带 TTL）
    pub cached_pool_members: Option<(Vec<String>, i64)>, // (node_ids, expire_at_ms)
}

// 在任务分配时
impl JobDispatcher {
    async fn select_node_for_job_creation(
        &self,
        // ... 参数
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        // 检查缓存是否有效
        let cached_members = session.cached_pool_members.as_ref()
            .filter(|(_, expire_at)| *expire_at > now_ms);

        if let Some((members, _)) = cached_members {
            // 使用缓存的成员列表，跳过 Redis 查询
        } else {
            // 从 Redis 读取并更新缓存
            let members = rt.get_pool_members_from_redis(pool_name).await;
            session.cached_pool_members = Some((members, now_ms + CACHE_TTL_MS));
        }
    }
}
```

**优势**：
- ✅ 进一步减少 Redis 查询：pool 成员列表可以缓存一段时间
- ✅ 提高性能：任务分配延迟显著降低

**劣势**：
- ⚠️ 需要处理缓存失效：节点离线、Pool 配置更新时需要清除缓存
- ⚠️ 内存开销：每个 session 需要存储 pool 成员列表（但通常节点数量不会太多）

### 方案 3：全局 Pool 成员缓存（更激进）

**设计思路**：
在调度服务器级别维护一个全局的 pool 成员缓存，所有 session 共享。

**实现细节**：

```rust
// 在 NodeRegistry 或独立的 PoolCache 中
pub struct PoolMembersCache {
    cache: Arc<RwLock<HashMap<String, (HashSet<String>, i64)>>>, // pool_name -> (node_ids, expire_at_ms)
}

impl PoolMembersCache {
    async fn get_pool_members(
        &self,
        pool_name: &str,
        phase2_runtime: Option<&Phase2Runtime>,
    ) -> HashSet<String> {
        // 检查缓存
        {
            let cache = self.cache.read().await;
            if let Some((members, expire_at)) = cache.get(pool_name) {
                if *expire_at > now_ms {
                    return members.clone();
                }
            }
        }

        // 从 Redis 读取并更新缓存
        if let Some(rt) = phase2_runtime {
            let members = rt.get_pool_members_from_redis(pool_name).await.unwrap_or_default();
            {
                let mut cache = self.cache.write().await;
                cache.insert(pool_name.to_string(), (members.clone(), now_ms + CACHE_TTL_MS));
            }
            members
        } else {
            HashSet::new()
        }
    }
}
```

**优势**：
- ✅ 最大化缓存复用：所有 session 共享同一个缓存
- ✅ 减少 Redis 查询：全局缓存，查询频率显著降低
- ✅ 内存开销可控：缓存大小与 Pool 数量成正比，而非与 session 数量成正比

**劣势**：
- ⚠️ 需要处理缓存失效：节点离线、Pool 配置更新时需要清除或刷新缓存
- ⚠️ 需要处理并发访问：多个任务同时访问缓存时可能有锁竞争

---

## 推荐方案

### 推荐：方案 1 + 方案 3 组合

**设计**：
1. **Session 级别绑定 preferred pool**（方案 1）
   - 在 session 创建时或首次任务时绑定 preferred pool
   - 如果语言对变化，重新计算并更新绑定

2. **全局 Pool 成员缓存**（方案 3）
   - 在调度服务器级别维护全局 pool 成员缓存
   - 所有 session 共享同一个缓存
   - 设置合理的 TTL（如 5 秒），平衡性能和数据一致性

**实现步骤**：

1. **在 Session 结构中添加字段**：
```rust
pub struct Session {
    // ... 现有字段
    pub preferred_pool: Option<u16>,
    pub bound_lang_pair: Option<(String, String)>,
}
```

2. **在 NodeRegistry 中添加全局缓存**：
```rust
pub struct NodeRegistry {
    // ... 现有字段
    pub pool_members_cache: Arc<RwLock<HashMap<String, (HashSet<String>, i64)>>>,
}
```

3. **修改任务分配逻辑**：
```rust
// 在 select_node_for_job_creation 中
// 1. 检查 session 是否有绑定的 preferred pool
// 2. 如果没有，计算 eligible pools 并选择 preferred pool，存储到 session
// 3. 使用全局缓存获取 pool 成员（如果缓存失效，从 Redis 读取并更新缓存）
// 4. 在 pool 内选择节点
```

4. **处理缓存失效**：
   - 节点心跳更新 Pool 成员时，清除对应的缓存
   - Pool 配置更新时，清除所有相关缓存
   - 设置 TTL，自动过期

### 预期效果

**性能提升**：
- ✅ **首次任务**：与当前实现相同（需要计算 eligible pools、选择 preferred pool、从 Redis 读取成员）
- ✅ **后续任务（相同语言对）**：
  - 跳过 eligible pools 计算：节省 ~1-5ms
  - 跳过 preferred pool 选择：节省 ~0.1ms
  - 使用全局缓存（如果有效）：节省 ~10-50ms（Redis 查询）
  - **总节省**：约 10-55ms 每任务

**内存开销**：
- Session 绑定：每个 session 增加 ~16 字节（`Option<u16>` + `Option<(String, String)>`）
- 全局缓存：每个 pool 缓存 ~1KB（假设每个 pool 有 10 个节点，每个 node_id 平均 20 字节）
- **总计**：假设有 1000 个活跃 session 和 20 个 pool，总开销约 40KB

---

## 实施建议

### 阶段 1：Session 级别绑定（方案 1）

1. 在 `Session` 结构中添加 `preferred_pool` 和 `bound_lang_pair` 字段
2. 修改 `select_node_for_job_creation` 逻辑，优先使用绑定的 pool
3. 处理语言对变化的场景（重新计算并更新绑定）
4. 添加单元测试和集成测试

**预期时间**：1-2 天

### 阶段 2：全局缓存优化（方案 3）

1. 在 `NodeRegistry` 中添加全局 pool 成员缓存
2. 修改 `get_pool_members_from_redis` 调用，优先使用缓存
3. 实现缓存失效机制（节点心跳、Pool 配置更新）
4. 添加缓存命中率监控

**预期时间**：2-3 天

### 阶段 3：性能测试和优化

1. 对比优化前后的性能指标
2. 调整缓存 TTL 和失效策略
3. 监控内存使用情况

**预期时间**：1-2 天

---

## 九、Auto-Detect（语言自动检测）场景的处理

### 9.1 问题

**用户问题**：对于 web 端用户已经选定了两种互译语言时应该比较容易选择 pool，但是在用户未选定时应该怎么确定 pool？难道先随机发给某个空闲节点，确定了输入语言以后返回给调度服务器，给 session 添加标签，然后再找到对应 pool 进行翻译吗？

### 9.2 当前实现

**当前设计**：当 `src_lang == "auto"` 时，系统使用**混合池（Mixed Pool）**机制：

```rust
if src_lang == "auto" {
    // 未知源语言：使用混合池（多对一 Pool）
    // 选择所有以 *-tgt_lang 格式命名的混合池（如 *-en）
    let eligible_pools: Vec<u16> = cfg.pools
        .iter()
        .filter(|p| p.name == format!("*-{}", tgt_lang))
        .map(|p| p.pool_id)
        .collect();
}
```

**工作流程**：
1. 当 `src_lang == "auto"` 时，选择混合池（如 `*-en`）
2. 混合池包含支持多种源语言到目标语言的节点
3. 任务被分配到混合池中的节点进行 ASR
4. ASR 会返回检测到的语言（`detected_lang`），但**当前未用于更新 session**

**问题**：
- ⚠️ ASR 检测到的语言未用于更新 session 的 `src_lang`
- ⚠️ 后续任务仍然使用 `src_lang == "auto"`，无法利用精确的语言集合 Pool
- ⚠️ 混合池的节点数量可能少于精确的语言集合 Pool，影响性能

### 9.3 优化方案：基于 ASR 语言检测结果更新 Session

**设计思路**：

1. **首次任务（`src_lang == "auto"`）**：
   - 使用混合池（如 `*-en`）进行 ASR
   - 等待 ASR 结果返回检测到的语言（`detected_lang`）
   - 如果 `detected_lang` 置信度高（如 > 0.7），更新 session 的 `src_lang`
   - 重新计算 eligible pools，选择精确的语言集合 Pool（如 `zh-en`）
   - 后续任务使用精确 Pool

2. **ASR 结果处理**：
   - 在 ASR 结果回调中，检查 `detected_lang` 和 `language_probability`
   - 如果 `detected_lang` 置信度高且 session 的 `src_lang == "auto"`，更新 session
   - 清除 session 的 preferred pool 绑定，触发重新计算

3. **语言切换处理**：
   - 如果检测到的语言与 session 绑定的语言不同，更新 session
   - 重新计算 preferred pool

**实现细节**：

```rust
// 在 Session 结构中添加字段
pub struct Session {
    // ... 现有字段
    /// Phase3: 绑定的 preferred pool（可选）
    pub preferred_pool: Option<u16>,
    /// Phase3: 绑定的语言对（用于验证是否需要重新计算）
    pub bound_lang_pair: Option<(String, String)>, // (src_lang, tgt_lang)
    /// 检测到的源语言（从 ASR 结果更新）
    pub detected_src_lang: Option<String>,
    /// 检测到的源语言的置信度
    pub detected_src_lang_probability: Option<f32>,
}

// 在 ASR 结果处理中
impl JobDispatcher {
    async fn handle_asr_result(
        &self,
        session_id: &str,
        detected_lang: Option<String>,
        language_probability: Option<f32>,
    ) {
        let session = self.state.session_manager.get_session(session_id).await;
        
        if let Some(session) = session {
            // 检查是否需要更新 session 的 src_lang
            if session.src_lang == "auto" {
                if let (Some(lang), Some(prob)) = (detected_lang, language_probability) {
                    // 如果置信度高（> 0.7），更新 session
                    if prob > 0.7 {
                        self.state.session_manager
                            .update_session_language(session_id, &lang)
                            .await;
                        
                        // 清除 preferred pool 绑定，触发重新计算
                        // 下次任务分配时会使用精确的语言集合 Pool
                        self.clear_session_pool_binding(session_id).await;
                    }
                }
            }
        }
    }
}
```

### 9.4 推荐的完整流程

**场景 1：用户已选定语言对（如 `zh↔en`）**

```
Session 创建：src_lang="zh", tgt_lang="en"
  ↓
首次任务分配：
  - 计算 eligible pools（包含 zh 和 en 的 Pool）
  - 选择 preferred pool（如 `zh-en` Pool）
  - 绑定到 session
  ↓
后续任务分配：
  - 使用绑定的 preferred pool（跳过 eligible pools 计算）
  - 使用全局缓存获取 pool 成员（跳过 Redis 查询）
  - 直接选择节点
```

**场景 2：用户未选定语言（`src_lang="auto"`, `tgt_lang="en"`）**

```
Session 创建：src_lang="auto", tgt_lang="en"
  ↓
首次任务分配：
  - 使用混合池（`*-en` Pool）
  - 绑定到 session（临时绑定，可能后续会改变）
  ↓
ASR 结果返回：
  - 检测到语言：`detected_lang="zh"`, `language_probability=0.95`
  - 更新 session：`src_lang="zh"`
  - 清除 preferred pool 绑定
  ↓
第二次任务分配：
  - 检测到 `src_lang` 已更新且与绑定不同
  - 重新计算 eligible pools（包含 zh 和 en 的 Pool，如 `zh-en`）
  - 选择 preferred pool（如 `zh-en` Pool，更精确）
  - 绑定到 session
  ↓
后续任务分配：
  - 使用绑定的 preferred pool（`zh-en` Pool，更精确）
  - 使用全局缓存获取 pool 成员
  - 直接选择节点
```

**场景 3：语言切换（用户从中文切换到英文）**

```
Session 已有绑定：preferred_pool=`zh-en`, bound_lang_pair=("zh", "en")
  ↓
任务分配：src_lang="zh", tgt_lang="en"
  - 使用绑定的 preferred pool（`zh-en`）
  ↓
ASR 结果返回：
  - 检测到语言：`detected_lang="en"`, `language_probability=0.92`
  - 更新 session：`src_lang="en"`
  - 检测到语言对变化：("zh", "en") -> ("en", "en") 或 ("en", "zh")
  - 清除 preferred pool 绑定
  ↓
下次任务分配：
  - 重新计算 eligible pools（包含 en 的 Pool，如 `en-zh`）
  - 选择 preferred pool（如 `en-zh` Pool）
  - 绑定到 session
```

### 9.5 关键设计点

**1. 混合池的作用**

- **当前**：混合池用于 `src_lang == "auto"` 场景
- **优化后**：混合池仅用于**首次任务**，ASR 检测到语言后切换到精确 Pool
- **优势**：后续任务使用更精确的 Pool，节点数量更多，性能更好

**2. 语言检测的置信度阈值**

- **建议阈值**：0.7（可配置）
- **低于阈值**：保持 `src_lang == "auto"`，继续使用混合池
- **高于阈值**：更新 `src_lang`，切换到精确 Pool

**3. Pool 绑定的失效条件**

- `src_lang` 或 `tgt_lang` 变化
- ASR 检测到不同的语言（置信度高）
- Pool 配置更新（可能需要重新计算）

**4. 性能优化**

- **首次任务（auto）**：使用混合池（开销与当前相同）
- **首次任务（已选定）**：直接使用精确 Pool（节省混合池查询）
- **后续任务（auto→已检测）**：切换到精确 Pool（性能提升）
- **后续任务（已绑定）**：使用绑定的 Pool（最大性能提升）

### 9.6 实施建议

**阶段 1：ASR 结果处理（必须）**

1. 在 ASR 结果回调中，提取 `detected_lang` 和 `language_probability`
2. 如果 session 的 `src_lang == "auto"` 且置信度高，更新 session
3. 添加 `SessionUpdate::UpdateSrcLang(detected_lang, probability)` 枚举变体

**阶段 2：Session 级别绑定（推荐）**

1. 在 Session 结构中添加 `preferred_pool` 和 `bound_lang_pair` 字段
2. 修改任务分配逻辑，优先使用绑定的 pool
3. 在 ASR 结果更新 session 语言后，清除 preferred pool 绑定

**阶段 3：全局缓存优化（可选）**

1. 在 NodeRegistry 中添加全局 pool 成员缓存
2. 修改 `get_pool_members_from_redis` 调用，优先使用缓存

---

## 总结

**问题**：每次任务分配都需要重新计算 eligible pools、选择 preferred pool、从 Redis 读取 pool 成员，造成性能开销。

**解决方案**：
1. **Session 级别绑定 preferred pool**：在 session 创建时或首次任务时绑定，后续任务直接使用
2. **全局 Pool 成员缓存**：在调度服务器级别维护全局缓存，减少 Redis 查询
3. **Auto-Detect 场景优化**：ASR 检测到语言后，更新 session 并切换到精确 Pool

**预期效果**：
- 后续任务（相同语言对）延迟降低约 10-55ms
- Auto-Detect 场景：首次任务使用混合池，后续任务切换到精确 Pool
- 内存开销增加约 40KB（假设 1000 个活跃 session 和 20 个 pool）

**实施优先级**：高（性能优化，不影响功能）

## 十、Pool 索引优化（解决 Pool 数量增长问题）

### 10.1 问题

**用户问题**：如果节点持续增加，节点池也会增加，如何减少搜索次数，减少锁池或者锁节点的操作？给池添加索引吗？

**当前实现的问题**：

1. **Pool 搜索开销**：每次任务分配都需要遍历所有 Pool 配置（`cfg.pools.iter().filter(...)`），时间复杂度 **O(N)**，其中 N 是 Pool 数量
   ```rust
   // 当前实现：遍历所有 Pool 配置
   let eligible_pools: Vec<u16> = cfg.pools.iter()
       .filter(|p| {
           // 检查 Pool 名称是否包含 src_lang 和 tgt_lang
           let pool_langs: std::collections::HashSet<&str> = p.name.split('-').collect();
           pool_langs.contains(src_lang) && pool_langs.contains(tgt_lang)
       })
       .map(|p| p.pool_id)
       .collect();
   ```

2. **锁操作开销**：每次都需要获取 `cfg.pools` 的读锁（`phase3.read().await`），即使只是读取配置
   - 任务分配时：需要获取 `phase3` 读锁来遍历 `cfg.pools`
   - Pool 配置更新时：需要获取 `phase3` 写锁来更新配置

3. **Pool 数量增长**：当节点数量增加时，不同的语言集合组合会增加，导致 Pool 数量增加
   - 假设有 10 种语言，可能的语言集合组合数量：2^10 - 1 = 1023 个 Pool（理论上限）
   - 实际上，由于节点语言集合的分布，Pool 数量通常为 20-100 个
   - 但即使 100 个 Pool，每次任务分配都需要遍历 100 次，开销仍然明显

### 10.2 优化方案：Pool 语言对索引

**设计思路**：类似于 `LanguageCapabilityIndex`，创建一个 `PoolLanguageIndex`，用于快速查找支持特定语言对的 Pool。

**索引结构**：

```rust
/// Pool 语言对索引
pub struct PoolLanguageIndex {
    /// 语言对索引：(src_lang, tgt_lang) -> Vec<pool_id>
    /// 用于快速查找支持特定语言对的 Pool（精确匹配）
    by_language_pair: HashMap<(String, String), Vec<u16>>,
    
    /// 混合池索引：tgt_lang -> Vec<pool_id>
    /// 用于快速查找支持目标语言的混合池（*-tgt_lang 格式）
    by_mixed_pool: HashMap<String, Vec<u16>>,
    
    /// 服务类型索引：ServiceType -> Vec<pool_id>
    /// 用于快速查找支持特定服务类型的 Pool（capability pools）
    by_service_type: HashMap<ServiceType, Vec<u16>>,
    
    /// 语言集合索引：sorted_langs -> Vec<pool_id>
    /// 用于快速查找包含特定语言集合的 Pool（如 "en-zh"）
    by_language_set: HashMap<String, Vec<u16>>,
}
```

**索引更新时机**：

1. **Pool 配置更新时**：重建索引（`rebuild_pool_language_index`）
   - 当 `set_phase3_config` 被调用时
   - 当 `rebuild_auto_language_pools` 完成时
   - 当从 Redis 同步 Pool 配置时

2. **索引重建开销**：O(N)，其中 N 是 Pool 数量
   - 但只在 Pool 配置更新时执行一次
   - 相比每次任务分配都遍历 Pool 配置，开销大幅降低

**索引查找优化**：

```rust
impl PoolLanguageIndex {
    /// 查找支持特定语言对的 Pool（精确匹配）
    pub fn find_pools_for_language_pair(
        &self,
        src_lang: &str,
        tgt_lang: &str,
    ) -> Option<&Vec<u16>> {
        self.by_language_pair.get(&(src_lang.to_string(), tgt_lang.to_string()))
    }
    
    /// 查找支持目标语言的混合池（*-tgt_lang 格式）
    pub fn find_mixed_pools_for_target(
        &self,
        tgt_lang: &str,
    ) -> Option<&Vec<u16>> {
        self.by_mixed_pool.get(tgt_lang)
    }
    
    /// 查找包含特定语言集合的 Pool（如 "en-zh"）
    pub fn find_pools_for_language_set(
        &self,
        sorted_langs: &str,
    ) -> Option<&Vec<u16>> {
        self.by_language_set.get(sorted_langs)
    }
}
```

**在任务分配中的使用**：

```rust
// 优化前：遍历所有 Pool 配置（O(N)）
let eligible_pools: Vec<u16> = cfg.pools.iter()
    .filter(|p| {
        let pool_langs: HashSet<&str> = p.name.split('-').collect();
        pool_langs.contains(src_lang) && pool_langs.contains(tgt_lang)
    })
    .map(|p| p.pool_id)
    .collect();

// 优化后：直接查找索引（O(1)）
let eligible_pools: Vec<u16> = if src_lang == "auto" {
    // 混合池查找
    self.pool_language_index.read().await
        .find_mixed_pools_for_target(tgt_lang)
        .cloned()
        .unwrap_or_default()
} else {
    // 语言对查找
    self.pool_language_index.read().await
        .find_pools_for_language_pair(src_lang, tgt_lang)
        .cloned()
        .unwrap_or_default()
};
```

### 10.3 锁优化

**当前锁结构**：

```rust
pub struct NodeRegistry {
    phase3: Arc<RwLock<Phase3Config>>,  // 包含 pools: Vec<Phase3PoolConfig>
    phase3_pool_index: Arc<RwLock<HashMap<u16, HashSet<String>>>>,  // pool_id -> node_ids
    phase3_node_pool: Arc<RwLock<HashMap<String, HashSet<u16>>>>,   // node_id -> pool_ids
    // ...
}
```

**优化后的锁结构**：

```rust
pub struct NodeRegistry {
    phase3: Arc<RwLock<Phase3Config>>,  // 包含 pools: Vec<Phase3PoolConfig>
    phase3_pool_index: Arc<RwLock<HashMap<u16, HashSet<String>>>>,  // pool_id -> node_ids
    phase3_node_pool: Arc<RwLock<HashMap<String, HashSet<u16>>>>,   // node_id -> pool_ids
    pool_language_index: Arc<RwLock<PoolLanguageIndex>>,  // 新增：Pool 语言对索引
    // ...
}
```

**锁操作优化**：

1. **任务分配时**：
   - 优化前：获取 `phase3` 读锁，遍历 `cfg.pools`（O(N)）
   - 优化后：获取 `pool_language_index` 读锁，直接查找（O(1)）
   - **锁持有时间**：从 O(N) 降低到 O(1)

2. **Pool 配置更新时**：
   - 获取 `phase3` 写锁，更新配置
   - 释放写锁后，重建 `pool_language_index`（在锁外执行）
   - **锁持有时间**：仅更新配置的时间，不包含索引重建时间

3. **索引重建时机**：
   - 在 `set_phase3_config` 中，先更新 `phase3` 配置，然后重建索引
   - 在 `rebuild_auto_language_pools` 中，先更新 `phase3` 配置，然后重建索引
   - **索引重建在锁外执行**，不阻塞其他操作

### 10.4 性能分析

**时间复杂度**：

| 操作 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 任务分配（eligible pools 查找） | O(N) | O(1) | **N 倍** |
| Pool 配置更新（索引重建） | - | O(N) | 仅更新时执行一次 |
| 索引查找（语言对） | - | O(1) | 直接 HashMap 查找 |
| 索引查找（混合池） | - | O(1) | 直接 HashMap 查找 |

**空间复杂度**：

- **索引内存开销**：假设有 100 个 Pool，20 种语言对，10 种混合池
  - `by_language_pair`：20 * (2 * 8 bytes + Vec overhead) ≈ 2KB
  - `by_mixed_pool`：10 * (8 bytes + Vec overhead) ≈ 1KB
  - `by_language_set`：100 * (8 bytes + Vec overhead) ≈ 2KB
  - **总开销**：约 5KB（可忽略）

**锁竞争减少**：

- **任务分配时**：
  - 优化前：需要获取 `phase3` 读锁，遍历 `cfg.pools`（可能与其他写操作竞争）
  - 优化后：获取 `pool_language_index` 读锁，直接查找（锁粒度更细，竞争更少）

- **Pool 配置更新时**：
  - 优化前：需要获取 `phase3` 写锁，更新配置（阻塞所有读操作）
  - 优化后：获取 `phase3` 写锁，更新配置，释放锁后重建索引（锁持有时间更短）

### 10.5 实施建议

**阶段 1：添加 Pool 语言对索引（必须）**

1. 在 `node_registry` 模块中添加 `pool_language_index.rs`
2. 定义 `PoolLanguageIndex` 结构体
3. 实现 `rebuild_pool_language_index` 函数
4. 在 `NodeRegistry` 中添加 `pool_language_index` 字段

**阶段 2：修改任务分配逻辑（必须）**

1. 在 `select_node_with_types_two_level_excluding_with_breakdown` 中，使用索引查找替代遍历
2. 优化 `eligible_pools` 的查找逻辑

**阶段 3：索引更新集成（必须）**

1. 在 `set_phase3_config` 中，调用 `rebuild_pool_language_index`
2. 在 `rebuild_auto_language_pools` 中，调用 `rebuild_pool_language_index`
3. 在 Pool 配置从 Redis 同步时，调用 `rebuild_pool_language_index`

**预期效果**：

- **任务分配延迟**：从 O(N) 降低到 O(1)，**减少约 50-500μs**（假设 100 个 Pool）
- **锁竞争**：减少 `phase3` 读锁的竞争，提高并发性能
- **内存开销**：增加约 5KB（可忽略）

---

**最后更新**: 2026-01-XX
