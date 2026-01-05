# Job3和Job4分开翻译问题分析

## 问题描述

从测试结果看：
- **job3**: "我还是不错，因为上手很快了" → "I am still good because it is quick to go hand."
- **job4**: "很多,這個是能明顯感覺出來的,但是我們要接下來看它是不是穩定,然後還會不會引起其他的問題?" → "a lot, this is clearly feeling out, but we'll see if it're stable and then it'll not cause any other problems?"

**问题**: job3和job4应该是连接的一句话，但被分开翻译了。

## 根本原因分析

### 1. GPU仲裁器的作用

GPU仲裁器**只负责GPU资源管理**，不负责顺序保证：

✅ **GPU仲裁器做的**:
- 管理GPU资源，避免OOM
- 按优先级分配GPU（ASR>NMT>TTS>Semantic Repair）
- 忙时降级（Semantic Repair可跳过）
- 记录GPU使用情况

❌ **GPU仲裁器不做的**:
- 不保证job的处理顺序
- 不保证NMT的context_text正确性
- 不负责文本聚合

### 2. 顺序保证机制

顺序保证应该由以下机制负责：

1. **AggregatorManager**: 
   - 管理文本聚合
   - 通过`getLastCommittedText`提供上下文
   - 但**不保证NMT按顺序执行**

2. **PostProcessCoordinator**:
   - 协调后处理流程
   - 但**不阻止并发处理**

3. **context_text机制**:
   - NMT使用上一个utterance的原文作为上下文
   - 但如果job3和job4的NMT并发执行，job4可能获取到错误的context_text

### 3. 问题根源

**核心问题**: NMT任务可能并发执行，导致context_text错误。

**场景**:
1. job3的NMT开始执行，获取context_text（可能是job2的）
2. job4的NMT也同时开始执行，也获取context_text（可能是job2的，因为job3还未完成）
3. 两个NMT任务并发执行，都使用了错误的context_text
4. 导致翻译结果不连贯

## GPU仲裁器的实际作用

### 1. 资源管理

GPU仲裁器确保了：
- 同一GPU同时只有一个任务在使用（互斥锁）
- 避免了GPU OOM和性能抖动

### 2. 优先级控制

- ASR (priority=90): 最高优先级，优先获取GPU
- NMT (priority=80): 高优先级，在ASR之后
- TTS (priority=70): 中等优先级
- Semantic Repair (priority=20): 低优先级，可跳过

### 3. 忙时降级

- Semantic Repair在GPU忙碌时被跳过（SKIP策略）
- 不影响主链路（ASR/NMT/TTS）的处理

### 4. 可观测性

- 记录GPU租约的获取和释放
- 记录等待时间和占用时间
- 便于监控和调试

## 解决方案

### 方案1: 确保NMT按顺序执行（推荐）

在TranslationStage中，确保NMT任务按utterance_index顺序执行：

```typescript
// 在调用NMT之前，检查上一个utterance是否已完成翻译
// 如果未完成，等待其完成后再执行
```

### 方案2: 改进context_text获取

确保context_text总是获取到正确的上一个utterance：

```typescript
// 在获取context_text时，等待上一个utterance的翻译完成
// 可以使用锁或队列机制
```

### 方案3: 集成PipelineScheduler

使用PipelineScheduler来确保严格的顺序执行：
- 每个阶段按utterance_index顺序处理
- 确保NMT阶段不会并发处理相邻的utterance

## 验证方法

1. **检查日志**:
   - 搜索 `GpuArbiter: Lease acquired` - 查看GPU租约获取情况
   - 搜索 `TranslationStage: Sending text to NMT` - 查看NMT调用顺序和context_text

2. **检查顺序**:
   - 确认job3和job4的NMT是否并发执行
   - 确认context_text是否正确

3. **检查聚合**:
   - 确认job3和job4是否应该被聚合在一起
   - 检查Aggregator的聚合逻辑

## 结论

GPU仲裁器**正常工作**，它的作用是资源管理和优先级控制。

但job3和job4分开翻译的问题**不是GPU仲裁器导致的**，而是：
1. NMT可能并发执行，导致context_text错误
2. 需要添加NMT的顺序保证机制

建议实现方案1或方案3，确保NMT按utterance_index顺序执行。
