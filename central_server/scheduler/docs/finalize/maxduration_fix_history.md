# MaxDuration Finalize 修复历史

**日期**: 2026-01-24  
**目的**: 归档 MaxDuration finalize 的修复历史和修复总结

---

## 修复阶段

### 阶段 1：处理路径修复

**日期**: 2026-01-24  
**文档**: `MaxDuration处理路径修复_2026_01_24.md`

**修复内容**:
- 将 MaxDuration 按照备份代码的 timeout 方式处理，但单独新增一个路径
- 调度服务器端：MaxDuration 同时设置 `is_timeout_triggered = true`（与备份代码一致）
- 节点端：新增 MaxDuration 处理器，无条件缓存音频到 `pendingTimeoutAudio`

**关键修改**:
```rust
// 调度服务器端
let is_timeout_triggered = reason == "Timeout" || reason == "MaxDuration";
let is_max_duration_triggered = reason == "MaxDuration";
```

```typescript
// 节点端：新增独立处理路径
if (isMaxDurationTriggered) {
  const maxDurationResult = this.maxDurationHandler.handleMaxDurationFinalize(...);
  // 无条件缓存到 pendingTimeoutAudio
}
```

---

### 阶段 2：独立标签修复

**日期**: 2026-01-24  
**文档**: `MaxDuration独立标签修复总结_2026_01_24.md`

**修复内容**:
- 为 MaxDuration 创建独立的标签和字段，不与 timeout 混用
- 调度服务器端：MaxDuration 不再设置 `is_timeout_triggered`，使用独立的 Redis key (`max_duration_node_id`)
- 节点端：创建独立的字段 (`pendingMaxDurationAudio`)，独立的 session affinity 映射

**关键修改**:
```rust
// 调度服务器端
let is_timeout_triggered = reason == "Timeout";  // MaxDuration 不再设置
let is_max_duration_triggered = reason == "MaxDuration";
// 使用独立的 Redis key
redis.call('HSET', KEYS[1], 'max_duration_node_id', ARGV[1])
```

```typescript
// 节点端：独立字段
pendingMaxDurationAudio?: Buffer;
pendingMaxDurationAudioCreatedAt?: number;
pendingMaxDurationJobInfo?: OriginalJobInfo[];
```

---

## 修复效果对比

### 修复前

- ❌ MaxDuration 和 Timeout 混用标签和字段
- ❌ MaxDuration finalize 立即处理，不缓存音频
- ❌ 导致前半句丢失

### 修复后

- ✅ MaxDuration 和 Timeout 完全分离
- ✅ MaxDuration finalize 使用独立的字段和标识
- ✅ MaxDuration finalize 按能量切片，处理前 5+ 秒，缓存剩余部分
- ✅ 代码清晰，易于维护和调试

---

## 当前实现

参考 [MaxDuration Finalize 详细说明](./maxduration_finalize.md) 了解当前实现。

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（修复历史记录）
