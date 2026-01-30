# S2 Rescoring 状态说明

## ⚠️ 文档状态：已归档

**归档日期**: 2026-01-24  
**归档原因**: 状态矛盾（文档标题说"已启用"，但实际代码中已禁用）  
**当前有效文档**: `../SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

**注意**: S2 Rescoring 功能已禁用（GPU占用过高），但代码实现保留。

---

## 启用日期
2025-01-XX

## 状态
❌ **S2 Rescoring 已禁用**（GPU占用过高）

**代码位置**: `aggregator-middleware.ts` (行110)
```typescript
// S2-6: 二次解码已禁用（GPU占用过高）
this.secondaryDecodeWorker = null;
```

**配置**: `node-config.ts` (行176)
```typescript
enableS2Rescoring: false,  // 默认禁用 S2 Rescoring
```

---

## 实现内容

### S2-5: AudioRingBuffer ✅
- ✅ 音频 ring buffer 实现
- ✅ 缓存最近 5-15 秒音频
- ✅ TTL 10 秒
- ✅ 自动清理过期音频

### S2-6: SecondaryDecodeWorker ✅
- ✅ 二次解码 worker 实现
- ✅ 更保守的配置（beam_size=15, patience=2.0, temperature=0.0）
- ✅ 并发控制（maxConcurrency=1）
- ✅ 队列长度限制（maxQueueLength=3）
- ✅ 超时保护（5秒）

### 集成 ✅
- ✅ CandidateProvider 集成二次解码
- ✅ AggregatorMiddleware 启用 rescoring 逻辑
- ✅ ASRTask 接口扩展（支持 beam_size、patience、temperature）
- ✅ TaskRouter 传递二次解码参数

---

## 工作流程

```
1. Job 到达
   ↓
2. cacheAudio() - 缓存音频
   ↓
3. Aggregator 处理
   ↓
4. NeedRescoreDetector.detect() - 判断是否需要 rescoring
   ↓
5. 如果需要 rescoring:
   - getAudioRef() - 获取音频引用
   - 判断 shouldUseSecondaryDecode
   - CandidateProvider.provide() - 生成候选
     - primary 候选
     - secondary_decode 候选（如果满足条件）
   ↓
6. Rescorer.rescore() - 对候选打分
   ↓
7. 选择最佳候选（如果分数提升 > delta_margin）
   ↓
8. 返回最终文本
```

---

## 触发条件

### 二次解码触发（同时满足）
1. ✅ `short_utterance`（短句）
2. ✅ `low_quality` 或 `risk_features`（低置信或高风险）
3. ✅ 有音频引用（audioRef）
4. ✅ SecondaryDecodeWorker 可用且未超载

---

## 配置参数

### SecondaryDecodeWorker
- `beamSize`: 15（比 primary 的 10 更大）
- `patience`: 2.0（比 primary 的 1.0 更高）
- `temperature`: 0.0（更确定）
- `bestOf`: 5
- `maxConcurrency`: 1（串行执行）
- `maxQueueLength`: 3（超过则降级）

---

## 性能保护

### 并发控制
- 最大并发数: 1（串行执行）
- 队列长度限制: 3（超过则降级）

### 超时保护
- 超时时间: 5 秒
- 超时处理: 降级使用 primary

### 降级策略
- 并发数达到上限 → 跳过二次解码
- 队列长度超过限制 → 跳过二次解码
- 超时 → 跳过二次解码
- 解码失败 → 降级使用 primary

---

## 预期效果

### 识别准确率
- **短句识别改善**: 通过二次解码和 rescoring，提升短句识别准确率
- **同音字错误减少**: 更保守的配置有助于减少同音字错误
- **专名识别改善**: 通过 rescoring 的专名保护规则

### 性能影响
- **延迟增加**: < 200ms（二次解码 + rescoring）
- **触发率**: ≤ 5%（仅在短句 + 低置信 + 高风险时触发）
- **GPU 负载**: 可控（串行执行，队列限制）

---

## 验证方法

### 日志检查
查找以下日志：
- `S2-6: Secondary decode candidate generated` - 二次解码成功
- `S2: Rescoring applied, text replaced` - rescoring 成功替换文本
- `S2: Rescoring applied but text not replaced (delta_margin)` - rescoring 未替换（分数提升不够）

### 功能测试
1. **短句测试**: 发送短句，检查是否触发二次解码
2. **低质量测试**: 发送低质量文本，检查是否触发二次解码
3. **高风险测试**: 发送包含数字/专名的文本，检查是否触发二次解码

---

## 下一步

1. **测试验证**: 运行集成测试，验证效果
2. **性能监控**: 监控延迟和 GPU 负载
3. **参数调优**: 根据实际效果调整配置参数
