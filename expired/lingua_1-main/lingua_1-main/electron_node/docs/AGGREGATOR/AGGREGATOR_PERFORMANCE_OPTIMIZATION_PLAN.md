# Aggregator 性能优化实现方案

**最后更新**：2025-01-XX  
**状态**：📋 待实现

---

## 概述

本文档详细说明两个性能优化任务的实现方案：
1. **重新翻译延迟优化（缓存机制）** - 2-3 天
2. **上下文传递优化** - 1-2 天

---

## 任务 1：重新翻译延迟优化（缓存机制）

### 目标

- **当前状态**：平均延迟 1077.67ms
- **目标**：< 500ms（通过缓存机制）
- **预计工作量**：2-3 天

### 问题分析

**当前流程**：
```
每次文本被聚合 → 调用 NMT 服务重新翻译 → 等待响应（平均 1077.67ms）
```

**问题**：
- 如果相同的文本被多次聚合，会重复翻译
- 没有缓存机制，每次都调用 NMT 服务

### 实现方案

#### 方案 A：简单缓存（推荐）

**实现思路**：
1. 在 `AggregatorMiddleware` 中添加一个 LRU 缓存
2. 缓存键：`${src_lang}-${tgt_lang}-${text}`（语言对 + 文本内容）
3. 缓存值：翻译结果
4. 缓存大小：最多 100 条（可配置）
5. 缓存过期时间：5 分钟（可配置）

**代码修改位置**：

1. **`aggregator-middleware.ts`** - 添加缓存逻辑

```typescript
import { LRUCache } from 'lru-cache';  // 需要安装：npm install lru-cache

export class AggregatorMiddleware {
  private manager: AggregatorManager | null = null;
  private config: AggregatorMiddlewareConfig;
  private taskRouter: TaskRouter | null = null;
  
  // 新增：翻译缓存
  private translationCache: LRUCache<string, string>;

  constructor(config: AggregatorMiddlewareConfig, taskRouter?: TaskRouter) {
    this.config = config;
    this.taskRouter = taskRouter || null;
    
    // 初始化缓存：最多 100 条，5 分钟过期
    this.translationCache = new LRUCache<string, string>({
      max: config.translationCacheSize || 100,
      ttl: config.translationCacheTtlMs || 5 * 60 * 1000,  // 5 分钟
    });
    
    // ... 现有代码 ...
  }

  async process(
    job: JobAssignMessage,
    result: JobResult
  ): Promise<AggregatorMiddlewareResult> {
    // ... 现有聚合逻辑 ...

    // 如果文本被聚合，重新触发 NMT 翻译
    if (aggregatedText.trim() !== asrTextTrimmed.trim() && this.taskRouter) {
      const nmtStartTime = Date.now();
      
      // 生成缓存键
      const cacheKey = `${job.src_lang}-${job.tgt_lang}-${aggregatedText}`;
      
      // 检查缓存
      const cachedTranslation = this.translationCache.get(cacheKey);
      if (cachedTranslation) {
        translatedText = cachedTranslation;
        nmtRetranslationTimeMs = Date.now() - nmtStartTime;
        
        logger.debug(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            cacheHit: true,
            translationTimeMs: nmtRetranslationTimeMs,
          },
          'Re-triggered NMT for aggregated text (from cache)'
        );
      } else {
        // 缓存未命中，调用 NMT 服务
        try {
          const nmtTask: NMTTask = {
            text: aggregatedText,
            src_lang: job.src_lang,
            tgt_lang: job.tgt_lang,
            context_text: undefined,  // 暂时不传递上下文
            job_id: job.job_id,
          };
          
          const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
          translatedText = nmtResult.text;
          nmtRetranslationTimeMs = Date.now() - nmtStartTime;
          
          // 存入缓存
          this.translationCache.set(cacheKey, translatedText);
          
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              originalText: asrTextTrimmed.substring(0, 50),
              aggregatedText: aggregatedText.substring(0, 50),
              originalTranslation: result.text_translated?.substring(0, 50),
              newTranslation: translatedText?.substring(0, 50),
              translationTimeMs: nmtRetranslationTimeMs,
              cacheHit: false,
            },
            'Re-triggered NMT for aggregated text'
          );
        } catch (error) {
          // ... 现有错误处理 ...
        }
      }
    }

    // ... 返回结果 ...
  }
}
```

2. **`aggregator-middleware.ts`** - 扩展配置接口

```typescript
export interface AggregatorMiddlewareConfig {
  enabled: boolean;
  mode: Mode;
  ttlMs?: number;
  maxSessions?: number;
  
  // 新增：翻译缓存配置
  translationCacheSize?: number;  // 缓存大小（默认 100）
  translationCacheTtlMs?: number;  // 缓存过期时间（默认 5 分钟）
}
```

3. **`node-agent.ts`** - 更新配置

```typescript
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: true,
  mode: 'offline',
  ttlMs: 5 * 60 * 1000,
  maxSessions: 1000,
  
  // 新增：翻译缓存配置
  translationCacheSize: 100,  // 最多缓存 100 条
  translationCacheTtlMs: 5 * 60 * 1000,  // 5 分钟过期
};
```

#### 方案 B：智能缓存（可选）

**实现思路**：
1. 不仅缓存完全相同的文本，还缓存相似文本的翻译
2. 使用文本相似度算法（如编辑距离）匹配相似文本
3. 如果相似度 > 0.9，使用缓存的翻译

**复杂度**：高  
**预计工作量**：5-7 天  
**优先级**：低（先实现简单缓存）

### 依赖安装

```bash
npm install lru-cache
npm install --save-dev @types/lru-cache  # 如果使用 TypeScript
```

### 测试方案

1. **功能测试**：
   - 发送相同的聚合文本两次，验证第二次使用缓存
   - 验证缓存命中时的延迟（应该 < 10ms）

2. **性能测试**：
   - 测试缓存命中率
   - 测试缓存命中时的平均延迟
   - 测试缓存未命中时的平均延迟

3. **边界测试**：
   - 缓存满时的 LRU 淘汰
   - 缓存过期时的清理
   - 并发访问缓存的安全性

### 预期效果

- **缓存命中时**：延迟 < 10ms（从内存读取）
- **缓存未命中时**：延迟保持当前水平（1077.67ms）
- **总体效果**：如果文本重复率 > 50%，平均延迟可降低到 < 500ms

---

## 任务 2：上下文传递优化

### 目标

- **当前状态**：`context_text` 设置为 `undefined`
- **目标**：传递上一个 utterance 的翻译文本作为上下文
- **预计工作量**：1-2 天

### 问题分析

**当前流程**：
```typescript
const nmtTask: NMTTask = {
  text: aggregatedText,
  src_lang: job.src_lang,
  tgt_lang: job.tgt_lang,
  context_text: undefined,  // ❌ 不传递上下文
  job_id: job.job_id,
};
```

**问题**：
- 不传递上下文可能导致翻译质量下降
- 特别是在连续对话场景中，上下文很重要

### 实现方案

#### 步骤 1：在 AggregatorState 中存储上一个 utterance 的翻译文本

**代码修改位置**：

1. **`aggregator-state.ts`** - 添加翻译文本存储

```typescript
export class AggregatorState {
  // ... 现有字段 ...
  
  // 新增：存储上一个 utterance 的翻译文本
  private lastTranslatedText: string | null = null;
  
  // 新增：获取上一个 utterance 的翻译文本
  getLastTranslatedText(): string | null {
    return this.lastTranslatedText;
  }
  
  // 新增：设置上一个 utterance 的翻译文本
  setLastTranslatedText(translatedText: string): void {
    this.lastTranslatedText = translatedText;
  }
  
  // 新增：清理翻译文本（NEW_STREAM 时）
  clearLastTranslatedText(): void {
    this.lastTranslatedText = null;
  }
}
```

#### 步骤 2：在 AggregatorManager 中添加获取/设置方法

**代码修改位置**：

2. **`aggregator-manager.ts`** - 添加翻译文本管理方法

```typescript
export class AggregatorManager {
  // ... 现有方法 ...
  
  /**
   * 获取上一个 utterance 的翻译文本
   */
  getLastTranslatedText(sessionId: string): string | null {
    const state = this.states.get(sessionId);
    if (!state) {
      return null;
    }
    return (state as any).getLastTranslatedText();
  }
  
  /**
   * 设置上一个 utterance 的翻译文本
   */
  setLastTranslatedText(sessionId: string, translatedText: string): void {
    const state = this.states.get(sessionId);
    if (state) {
      (state as any).setLastTranslatedText(translatedText);
    }
  }
  
  /**
   * 清理翻译文本（NEW_STREAM 时）
   */
  clearLastTranslatedText(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (state) {
      (state as any).clearLastTranslatedText();
    }
  }
}
```

#### 步骤 3：在 AggregatorMiddleware 中使用上下文

**代码修改位置**：

3. **`aggregator-middleware.ts`** - 使用上下文传递

```typescript
export class AggregatorMiddleware {
  // ... 现有代码 ...

  async process(
    job: JobAssignMessage,
    result: JobResult
  ): Promise<AggregatorMiddlewareResult> {
    // ... 现有聚合逻辑 ...

    // 如果文本被聚合，重新触发 NMT 翻译
    if (aggregatedText.trim() !== asrTextTrimmed.trim() && this.taskRouter) {
      const nmtStartTime = Date.now();
      
      try {
        // 获取上一个 utterance 的翻译文本作为上下文
        const contextText = this.manager?.getLastTranslatedText(job.session_id) || undefined;
        
        const nmtTask: NMTTask = {
          text: aggregatedText,
          src_lang: job.src_lang,
          tgt_lang: job.tgt_lang,
          context_text: contextText,  // ✅ 传递上下文
          job_id: job.job_id,
        };
        
        const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
        translatedText = nmtResult.text;
        nmtRetranslationTimeMs = Date.now() - nmtStartTime;
        
        // 保存当前翻译文本，供下一个 utterance 使用
        if (translatedText && this.manager) {
          this.manager.setLastTranslatedText(job.session_id, translatedText);
        }
        
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            originalText: asrTextTrimmed.substring(0, 50),
            aggregatedText: aggregatedText.substring(0, 50),
            originalTranslation: result.text_translated?.substring(0, 50),
            newTranslation: translatedText?.substring(0, 50),
            translationTimeMs: nmtRetranslationTimeMs,
            hasContext: !!contextText,
            contextText: contextText?.substring(0, 30),
          },
          'Re-triggered NMT for aggregated text'
        );
      } catch (error) {
        // ... 现有错误处理 ...
      }
    } else {
      // 如果没有重新翻译，使用原始翻译，并保存供下一个 utterance 使用
      if (result.text_translated && this.manager) {
        this.manager.setLastTranslatedText(job.session_id, result.text_translated);
      }
    }
    
    // 如果是 NEW_STREAM，清理上下文（可选）
    if (aggregatorResult.action === 'NEW_STREAM' && this.manager) {
      this.manager.clearLastTranslatedText(job.session_id);
    }

    // ... 返回结果 ...
  }
}
```

#### 步骤 4：处理 NEW_STREAM 时的上下文清理（可选）

**决策**：
- **选项 A**：NEW_STREAM 时清理上下文（推荐）
  - 优点：避免不相关的上下文影响翻译
  - 缺点：可能丢失有用的上下文

- **选项 B**：保留上下文，直到会话结束
  - 优点：保留更多上下文信息
  - 缺点：可能引入不相关的上下文

**建议**：使用选项 A，在 NEW_STREAM 时清理上下文。

### 测试方案

1. **功能测试**：
   - 发送连续的两个 utterance，验证第二个使用第一个的翻译作为上下文
   - 验证 NEW_STREAM 时上下文被清理

2. **质量测试**：
   - 对比有上下文和无上下文的翻译质量
   - 测试连续对话场景的翻译准确性

3. **边界测试**：
   - 第一个 utterance（无上下文）
   - NEW_STREAM 后的第一个 utterance（上下文被清理）
   - 会话结束时的上下文清理

### 预期效果

- **翻译质量提升**：特别是在连续对话场景中
- **上下文传递**：正确传递上一个 utterance 的翻译
- **性能影响**：几乎无影响（只是传递字符串）

---

## 实施顺序

### 推荐顺序

1. **先实现上下文传递优化**（1-2 天）
   - 工作量小
   - 效果明显
   - 风险低

2. **再实现缓存机制**（2-3 天）
   - 需要安装依赖
   - 需要测试缓存逻辑
   - 需要监控缓存命中率

### 总工作量

- **上下文传递优化**：1-2 天
- **缓存机制**：2-3 天
- **总计**：3-5 天

---

## 代码修改清单

### 任务 1：缓存机制

- [ ] 安装 `lru-cache` 依赖
- [ ] 修改 `aggregator-middleware.ts`：
  - [ ] 添加 `translationCache` 字段
  - [ ] 在构造函数中初始化缓存
  - [ ] 在 `process` 方法中添加缓存逻辑
- [ ] 修改 `AggregatorMiddlewareConfig` 接口，添加缓存配置
- [ ] 修改 `node-agent.ts`，更新配置
- [ ] 添加测试用例

### 任务 2：上下文传递

- [ ] 修改 `aggregator-state.ts`：
  - [ ] 添加 `lastTranslatedText` 字段
  - [ ] 添加 `getLastTranslatedText` 方法
  - [ ] 添加 `setLastTranslatedText` 方法
  - [ ] 添加 `clearLastTranslatedText` 方法
- [ ] 修改 `aggregator-manager.ts`：
  - [ ] 添加 `getLastTranslatedText` 方法
  - [ ] 添加 `setLastTranslatedText` 方法
  - [ ] 添加 `clearLastTranslatedText` 方法
- [ ] 修改 `aggregator-middleware.ts`：
  - [ ] 在重新翻译时获取上下文
  - [ ] 在重新翻译后保存翻译文本
  - [ ] 在 NEW_STREAM 时清理上下文
- [ ] 添加测试用例

---

## 测试计划

### 单元测试

1. **缓存机制测试**：
   - 缓存命中测试
   - 缓存未命中测试
   - 缓存过期测试
   - 缓存 LRU 淘汰测试

2. **上下文传递测试**：
   - 第一个 utterance（无上下文）
   - 连续 utterance（有上下文）
   - NEW_STREAM 时上下文清理

### 集成测试

1. **端到端测试**：
   - 发送连续 utterance，验证上下文传递
   - 发送相同文本，验证缓存命中
   - 验证翻译质量提升

2. **性能测试**：
   - 缓存命中率统计
   - 缓存命中时的延迟
   - 总体延迟改善

---

## 监控指标

### 新增指标

1. **缓存相关**：
   - `cacheHitRate`: 缓存命中率
   - `cacheHitCount`: 缓存命中次数
   - `cacheMissCount`: 缓存未命中次数
   - `cacheHitLatencyMs`: 缓存命中时的延迟
   - `cacheMissLatencyMs`: 缓存未命中时的延迟

2. **上下文相关**：
   - `contextUsageRate`: 上下文使用率
   - `contextProvidedCount`: 提供上下文的次数

### 日志增强

1. **缓存日志**：
   - 缓存命中时记录 `cacheHit: true`
   - 缓存未命中时记录 `cacheHit: false`

2. **上下文日志**：
   - 记录是否有上下文：`hasContext: true/false`
   - 记录上下文文本（前 30 个字符）

---

## 风险评估

### 缓存机制

**风险**：
- 缓存可能导致内存占用增加
- 缓存过期时间设置不当可能导致使用过时翻译

**缓解措施**：
- 限制缓存大小（最多 100 条）
- 设置合理的过期时间（5 分钟）
- 监控内存使用情况

### 上下文传递

**风险**：
- 上下文文本过长可能导致 NMT 服务性能下降
- 不相关的上下文可能影响翻译质量

**缓解措施**：
- 限制上下文文本长度（如最多 200 个字符）
- 在 NEW_STREAM 时清理上下文
- 监控上下文使用情况

---

## 相关文档

- `AGGREGATOR_NMT_RETRANSLATION_IMPLEMENTATION.md` - 重新触发 NMT 实现文档
- `AGGREGATOR_NMT_RETRANSLATION_TEST_REPORT.md` - 重新触发 NMT 测试报告
- `AGGREGATOR_OPTIMIZATION_AND_REMAINING_WORK.md` - 优化与剩余工作

