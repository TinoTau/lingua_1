# Aggregator 模块

文本聚合与边界重建模块，用于解决 utterance 过碎、边界重复、语言抖动误切等问题。

## 核心功能

1. **Text Incompleteness Score**: 语言无关的文本未完成度评分
2. **Language Stability Gate**: 语言稳定性门，防止夹杂词误切
3. **Dedup**: 边界重叠裁剪，解决重复问题
4. **Tail Carry**: 尾巴延迟归属，减少短尾单独输出
5. **Commit 策略**: 时间/长度触发，降低等待时间

## 模块结构

- `aggregator-decision.ts`: 核心决策逻辑（merge/new_stream 决策）
- `aggregator-state.ts`: 会话态管理（per session）
- `aggregator-manager.ts`: 多会话管理器（TTL/LRU 回收）
- `dedup.ts`: 边界去重算法
- `tail-carry.ts`: 尾巴延迟归属机制

## 使用方式

Aggregator 已集成到 `PipelineOrchestrator`，在 ASR 之后、NMT 之前自动处理。

### 手动使用

```typescript
import { AggregatorManager, Mode } from './aggregator';

const manager = new AggregatorManager({
  ttlMs: 5 * 60 * 1000,  // 5 分钟 TTL
  maxSessions: 1000,
});

// 处理 utterance
const result = manager.processUtterance(
  sessionId,
  text,
  segments,
  langProbs,
  qualityScore,
  isFinal,
  isManualCut,
  mode
);

// 强制 flush（stop/leave 时）
const flushed = manager.flush(sessionId);

// 清理 session
manager.removeSession(sessionId);
```

## 配置参数

### 线下模式（Offline）
- `hard_gap_ms`: 2000
- `soft_gap_ms`: 1500
- `strong_merge_ms`: 700
- `commit_interval_ms`: 1200-1500
- `tail_carry_tokens`: 1-3 token / CJK 2-6 字

### 会议室模式（Room）
- `hard_gap_ms`: 1500
- `soft_gap_ms`: 1000
- `strong_merge_ms`: 600
- `commit_interval_ms`: 800-1200
- `tail_carry_tokens`: 2-4 token / CJK 4-8 字

## 指标监控

Aggregator 提供以下指标：
- `commitCount`: 提交次数
- `mergeCount`: 合并次数
- `newStreamCount`: 新流次数
- `dedupCount`: 去重次数
- `dedupCharsRemoved`: 去重裁剪字符数
- `tailCarryUsage`: Tail carry 使用次数
- `commitLatencyMs`: 首次输出延迟

## 注意事项

1. **P0 只处理 final 结果**：partial results 不参与聚合
2. **时间戳推导**：从 ASR segments 推导 utterance 时间戳
3. **会话管理**：自动清理过期会话（TTL 5 分钟）
4. **Flush 机制**：stop/leave 时需调用 `flush()` 确保最后一句不丢失

## 参考文档

- `AGGREGATOR_TEXT_INCOMPLETENESS_LANGUAGE_GATE_DESIGN.md`: 完整设计文档
- `AGGREGATOR_P0_KICKOFF_CLEARANCE_NOTE.md`: P0 开工说明
- `BLOCKER_RESOLUTION_ANALYSIS.md`: Blocker 解决路径分析

