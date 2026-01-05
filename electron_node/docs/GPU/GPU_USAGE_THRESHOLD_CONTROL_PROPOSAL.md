# GPU仲裁器增加GPU使用率控制功能 - 技术方案建议

## 1. 问题背景

### 1.1 当前问题
- **现象**：在集成测试中，当GPU使用率达到96%时，调度服务器检测到资源超过阈值（85%），拒绝分配新任务
- **影响**：导致后续任务（job 9、10、11）无法被分配到节点，系统无法继续处理
- **根本原因**：
  - GPU仲裁器只控制**互斥访问**（同一时间只有一个任务使用GPU）
  - 但**不控制GPU使用率**（单个任务可能让GPU使用率达到100%）
  - 调度服务器检查的是**实际GPU使用率**，而不是GPU是否被锁定

### 1.2 现状分析
- ✅ **已有功能**：
  - GPU互斥锁机制（避免多任务同时使用GPU）
  - 队列管理（管理等待的请求）
  - 优先级控制（按优先级分配GPU）
  - GPU使用率监控和日志记录（已实现）
- ❌ **缺失功能**：
  - 在分配GPU租约前检查GPU使用率
  - 当GPU使用率超过阈值时，拒绝或延迟分配新租约
  - 动态调整策略，避免GPU使用率持续超过阈值

---

## 2. 方案选项

### 方案A：被动监控 + 队列延迟（推荐）

#### 2.1 设计思路
- 在`acquire`方法中，**分配租约前**检查当前GPU使用率
- 如果GPU使用率超过阈值，根据任务类型和策略决定：
  - **高优先级任务**（ASR/NMT/TTS）：加入队列等待，直到GPU使用率降低
  - **低优先级任务**（Semantic Repair）：根据`busyPolicy`处理（SKIP/FALLBACK_CPU）
- 定期检查队列，当GPU使用率降低时，自动分配租约

#### 2.2 实现要点
```typescript
async acquire(request: GpuLeaseRequest): Promise<GpuLeaseAcquireResult> {
  // 1. 检查GPU使用率
  const gpuUsage = await getGpuUsage();
  if (gpuUsage && gpuUsage.usage > this.gpuUsageThreshold) {
    // 2. 根据任务优先级和策略决定
    if (request.priority >= 70) { // 高优先级
      // 加入队列等待
      return this.enqueueRequest(gpuKey, request, maxWaitMs);
    } else { // 低优先级
      // 根据busyPolicy处理
      if (request.busyPolicy === "SKIP") {
        return { status: "SKIPPED", reason: "GPU_USAGE_HIGH" };
      } else if (request.busyPolicy === "FALLBACK_CPU") {
        return { status: "FALLBACK_CPU", reason: "GPU_USAGE_HIGH" };
      }
    }
  }
  
  // 3. GPU使用率正常，继续原有逻辑
  // ...
}
```

#### 2.3 优点
- ✅ **实施简单**：只需在现有`acquire`方法中添加GPU使用率检查
- ✅ **向后兼容**：不影响现有功能，只是增加了一层检查
- ✅ **灵活可控**：通过配置阈值和策略，可以灵活调整行为
- ✅ **实时响应**：每次分配租约时都检查，响应及时

#### 2.4 缺点
- ⚠️ **性能开销**：每次分配租约都需要调用`getGpuUsage()`（约2秒超时）
- ⚠️ **可能延迟**：高优先级任务也可能需要等待GPU使用率降低
- ⚠️ **阈值抖动**：GPU使用率可能快速波动，导致频繁的拒绝/接受

#### 2.5 实施难度
- **开发工作量**：2-3天
- **测试工作量**：1-2天
- **风险等级**：低（向后兼容，可配置开关）

---

### 方案B：主动监控 + 动态限流

#### 2.1 设计思路
- 定期监控GPU使用率（每5秒，已实现）
- 当GPU使用率超过阈值时，设置"限流标志"
- 在限流期间：
  - 拒绝所有新租约请求（高优先级任务也拒绝）
  - 或只允许最高优先级任务（ASR）获取租约
- 当GPU使用率降低到阈值以下时，清除限流标志

#### 2.2 实现要点
```typescript
private isThrottling: boolean = false;
private throttleStartTime: number = 0;

private async checkGpuUsage(): Promise<void> {
  const gpuInfo = await getGpuUsage();
  if (gpuInfo && gpuInfo.usage > this.gpuUsageThreshold) {
    if (!this.isThrottling) {
      this.isThrottling = true;
      this.throttleStartTime = Date.now();
      logger.warn({ gpuUsage: gpuInfo.usage }, 'GPU throttling enabled');
    }
  } else {
    if (this.isThrottling) {
      this.isThrottling = false;
      logger.info({ duration: Date.now() - this.throttleStartTime }, 'GPU throttling disabled');
      // 处理等待队列
      this.processQueue(gpuKey);
    }
  }
}

async acquire(request: GpuLeaseRequest): Promise<GpuLeaseAcquireResult> {
  // 检查限流标志
  if (this.isThrottling) {
    // 只允许最高优先级任务（ASR）
    if (request.taskType !== 'ASR' || request.priority < 90) {
      return { status: "SKIPPED", reason: "GPU_THROTTLING" };
    }
  }
  // ...
}
```

#### 2.3 优点
- ✅ **性能开销小**：只在监控线程中检查GPU使用率，不影响租约分配性能
- ✅ **响应及时**：限流标志立即生效，无需等待
- ✅ **可配置**：可以配置限流期间允许的任务类型

#### 2.4 缺点
- ⚠️ **可能过于激进**：限流期间可能拒绝所有任务，包括高优先级任务
- ⚠️ **延迟恢复**：限流标志清除后，需要等待队列处理，可能有延迟
- ⚠️ **阈值抖动**：GPU使用率快速波动时，可能导致频繁的限流/解除

#### 2.5 实施难度
- **开发工作量**：2-3天
- **测试工作量**：1-2天
- **风险等级**：中（可能影响高优先级任务）

---

### 方案C：预测性限流 + 任务时长估算

#### 2.1 设计思路
- 记录每个任务类型的**平均GPU占用时长**
- 在分配租约前，估算当前活跃任务**预计完成时间**
- 如果预计GPU使用率在任务执行期间会超过阈值，则拒绝或延迟分配
- 结合历史数据，预测GPU使用率趋势

#### 2.2 实现要点
```typescript
private taskDurationHistory: Map<GpuTaskType, number[]> = new Map();

async acquire(request: GpuLeaseRequest): Promise<GpuLeaseAcquireResult> {
  // 1. 获取当前GPU使用率和活跃任务
  const gpuUsage = await getGpuUsage();
  const activeLeases = this.getActiveLeases();
  
  // 2. 估算当前任务预计完成时间
  const estimatedCompletionTime = this.estimateTaskCompletion(activeLeases);
  
  // 3. 估算新任务的GPU占用时长
  const estimatedTaskDuration = this.getAverageTaskDuration(request.taskType);
  
  // 4. 如果预计会超过阈值，拒绝或延迟
  if (gpuUsage && gpuUsage.usage > this.gpuUsageThreshold * 0.9) {
    // 90%阈值时开始预警
    if (estimatedTaskDuration > estimatedCompletionTime) {
      // 新任务预计在现有任务完成前不会降低GPU使用率
      return this.enqueueRequest(gpuKey, request, maxWaitMs);
    }
  }
  // ...
}
```

#### 2.3 优点
- ✅ **预测性强**：可以提前预测GPU使用率，避免超过阈值
- ✅ **智能调度**：根据任务时长和历史数据，做出更优的调度决策
- ✅ **减少拒绝**：通过预测，可以减少不必要的任务拒绝

#### 2.4 缺点
- ⚠️ **实施复杂**：需要实现任务时长估算、历史数据统计等
- ⚠️ **准确性依赖**：预测准确性依赖于历史数据，初期可能不准确
- ⚠️ **性能开销**：需要维护历史数据和进行复杂计算

#### 2.5 实施难度
- **开发工作量**：5-7天
- **测试工作量**：2-3天
- **风险等级**：中高（复杂度高，需要充分测试）

---

### 方案D：混合方案（方案A + 方案B）

#### 2.1 设计思路
- **基础层**：使用方案B的主动监控和限流标志
- **增强层**：在`acquire`方法中，结合方案A的实时检查
- **优化层**：根据任务优先级和GPU使用率，动态调整策略

#### 2.2 实现要点
```typescript
async acquire(request: GpuLeaseRequest): Promise<GpuLeaseAcquireResult> {
  // 1. 检查限流标志（方案B）
  if (this.isThrottling) {
    if (request.priority < 90) {
      return { status: "SKIPPED", reason: "GPU_THROTTLING" };
    }
  }
  
  // 2. 实时检查GPU使用率（方案A）
  const gpuUsage = await getGpuUsage();
  if (gpuUsage && gpuUsage.usage > this.gpuUsageThreshold) {
    // 根据优先级和策略处理
    if (request.priority >= 70) {
      return this.enqueueRequest(gpuKey, request, maxWaitMs);
    } else {
      // 低优先级任务根据busyPolicy处理
      // ...
    }
  }
  
  // 3. 继续原有逻辑
  // ...
}
```

#### 2.3 优点
- ✅ **双重保护**：限流标志 + 实时检查，更可靠
- ✅ **性能平衡**：限流标志减少实时检查的频率
- ✅ **灵活可控**：可以根据实际情况调整策略

#### 2.4 缺点
- ⚠️ **实施复杂**：需要实现两个方案的逻辑
- ⚠️ **可能冗余**：双重检查可能导致逻辑复杂

#### 2.5 实施难度
- **开发工作量**：4-5天
- **测试工作量**：2-3天
- **风险等级**：中（复杂度中等）

---

## 3. 方案对比

| 方案 | 实施难度 | 性能开销 | 可靠性 | 灵活性 | 推荐度 |
|------|---------|---------|--------|--------|--------|
| 方案A：被动监控+队列延迟 | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 方案B：主动监控+动态限流 | ⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 方案C：预测性限流 | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| 方案D：混合方案 | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 4. 推荐方案

### 4.1 推荐：方案A（被动监控 + 队列延迟）

#### 推荐理由
1. **实施简单**：只需在现有`acquire`方法中添加GPU使用率检查，改动最小
2. **向后兼容**：不影响现有功能，可以配置开关
3. **灵活可控**：通过配置阈值和策略，可以灵活调整行为
4. **风险低**：改动小，容易测试和回滚

#### 实施建议
1. **第一阶段**（MVP）：
   - 在`acquire`方法中添加GPU使用率检查
   - 当GPU使用率超过阈值时，根据任务优先级和策略处理
   - 添加配置项：`gpuUsageThreshold`（默认85%）
   - 添加新的拒绝原因：`GPU_USAGE_HIGH`

2. **第二阶段**（优化）：
   - 优化GPU使用率检查性能（缓存、异步检查等）
   - 添加GPU使用率趋势预测（可选）
   - 添加更细粒度的控制（如不同任务类型使用不同阈值）

#### 配置示例
```typescript
gpuArbiter: {
  enabled: true,
  gpuKeys: ['gpu:0'],
  gpuUsageThreshold: 85.0,  // GPU使用率阈值
  defaultQueueLimit: 8,
  defaultHoldMaxMs: 8000,
  policies: {
    ASR: {
      priority: 90,
      maxWaitMs: 3000,
      busyPolicy: "WAIT",  // GPU使用率高时，等待
    },
    NMT: {
      priority: 80,
      maxWaitMs: 3000,
      busyPolicy: "WAIT",
    },
    TTS: {
      priority: 70,
      maxWaitMs: 2000,
      busyPolicy: "WAIT",
    },
    SEMANTIC_REPAIR: {
      priority: 20,
      maxWaitMs: 400,
      busyPolicy: "SKIP",  // GPU使用率高时，跳过
    },
  },
}
```

---

## 5. 风险评估

### 5.1 技术风险
- **GPU使用率检查延迟**：`getGpuUsage()`可能有2秒超时，可能影响租约分配速度
  - **缓解措施**：使用缓存机制，减少检查频率；或使用异步检查，不阻塞主流程
- **阈值抖动**：GPU使用率可能快速波动，导致频繁的拒绝/接受
  - **缓解措施**：使用滞后阈值（hysteresis），避免频繁切换

### 5.2 业务风险
- **高优先级任务延迟**：如果GPU使用率持续高，高优先级任务也可能需要等待
  - **缓解措施**：设置最大等待时间，超时后降级处理
- **任务拒绝率增加**：低优先级任务可能被更多拒绝
  - **缓解措施**：这是预期行为，可以通过调整阈值和策略平衡

### 5.3 运维风险
- **配置复杂度**：需要配置阈值和策略，可能增加运维复杂度
  - **缓解措施**：提供合理的默认值，简化配置

---

## 6. 实施计划

### 6.1 开发阶段（预计5-7天）
1. **Day 1-2**：实现方案A的核心逻辑
   - 在`acquire`方法中添加GPU使用率检查
   - 实现根据优先级和策略的处理逻辑
   - 添加配置项和拒绝原因

2. **Day 3-4**：优化和测试
   - 优化GPU使用率检查性能（缓存、异步）
   - 添加单元测试和集成测试
   - 修复bug

3. **Day 5-7**：文档和部署
   - 更新文档
   - 准备部署方案
   - 进行灰度测试

### 6.2 测试阶段（预计2-3天）
1. **功能测试**：验证GPU使用率控制功能
2. **性能测试**：验证对系统性能的影响
3. **集成测试**：验证与调度服务器的配合

### 6.3 部署阶段（预计1-2天）
1. **灰度发布**：先在少量节点上测试
2. **全量发布**：确认无问题后全量发布
3. **监控和调优**：持续监控，根据实际情况调整阈值

---

## 7. 后续优化方向

### 7.1 短期优化（1-2个月）
- 添加GPU使用率趋势预测
- 优化GPU使用率检查性能
- 添加更细粒度的控制（不同任务类型使用不同阈值）

### 7.2 中期优化（3-6个月）
- 实现方案C的预测性限流
- 添加GPU使用率历史数据分析和报告
- 实现动态阈值调整（根据历史数据自动调整）

### 7.3 长期优化（6-12个月）
- 跨节点GPU调度（如果有多个节点）
- GPU资源池管理
- 更智能的调度算法（机器学习预测）

---

## 8. 决策建议

### 8.1 推荐决策
**建议采用方案A（被动监控 + 队列延迟）**，理由：
1. 实施简单，风险低
2. 向后兼容，可以逐步优化
3. 满足当前需求，解决GPU使用率超过阈值的问题

### 8.2 备选方案
如果方案A实施后效果不理想，可以考虑：
- **方案D（混合方案）**：结合方案A和方案B，提供双重保护
- **方案C（预测性限流）**：如果需要更智能的调度，可以考虑长期实施

### 8.3 需要决策的问题
1. **阈值设置**：GPU使用率阈值应该设置为多少？（建议：85%，与调度服务器一致）
2. **策略选择**：高优先级任务在GPU使用率高时，应该等待还是拒绝？（建议：等待，但设置最大等待时间）
3. **性能权衡**：是否可以接受GPU使用率检查的性能开销？（建议：使用缓存机制，减少开销）

---

## 9. 总结

GPU仲裁器增加GPU使用率控制功能是**必要的**，可以解决当前GPU使用率超过阈值导致任务无法分配的问题。

**推荐方案A**，因为：
- ✅ 实施简单，风险低
- ✅ 向后兼容，可以逐步优化
- ✅ 满足当前需求

**预计实施时间**：5-7天开发 + 2-3天测试 = **7-10天**

**预计效果**：
- 减少GPU使用率超过阈值的情况
- 提高任务分配成功率
- 改善系统稳定性

---

**文档版本**：v1.0  
**创建日期**：2026-01-05  
**作者**：开发团队  
**审核状态**：待决策部门审核
