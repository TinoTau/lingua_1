# 超时切割去重问题 - 简单修复方案

## 问题分析

**根本问题**：超时切割后，job 5和job 6的ASR结果有hangover重叠，但去重逻辑没有正确去除重叠部分，导致翻译时出现重复。

**为什么去重没有工作**：
1. 去重逻辑`dedupMergePrecise`使用`maxOverlap: 20`作为最大重叠阈值
2. Hangover重叠可能超过20个字符，导致去重失败
3. 或者去重使用的`previousText`不正确

## 简单修复方案

**方案1：提高去重配置的maxOverlap阈值**

在`dedup.ts`中，将`DEFAULT_DEDUP_CONFIG`的`maxOverlap`从20提高到50，以支持更长的hangover重叠：

```typescript
export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  minOverlap: 2,
  maxOverlap: 50,  // 从20提高到50，支持更长的hangover重叠
};
```

**方案2：检查去重使用的previousText是否正确**

确保`TextForwardMergeManager`使用的`previousText`是job 5的文本（包含hangover部分），而不是更早的文本。

## 验证方法

1. 查看日志，确认去重是否被触发
2. 检查`previousText`和`currentText`的内容，确认是否有重叠
3. 如果去重被触发但重叠没有被去除，检查`maxOverlap`阈值是否足够

## 建议

优先尝试方案1（提高maxOverlap阈值），这是最简单的修复。如果问题仍然存在，再检查方案2。
