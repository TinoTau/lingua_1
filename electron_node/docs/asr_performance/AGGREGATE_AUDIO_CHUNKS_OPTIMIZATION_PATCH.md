# aggregateAudioChunks() 优化 Patch - 执行文档

**日期**: 2026-01-28  
**类型**: 性能优化（最小patch）  
**状态**: ✅ 已执行

---

## 一、Patch概述

**目标**: 移除不必要的 `aggregateAudioChunks()` 调用，仅为计算 offset 时使用长度求和。

**原则**: 
- 只计算长度，不聚合完整Buffer
- 不改任何handler签名
- 不改变任何finalize判定、pending逻辑、TTL逻辑
- 纯性能修剪：避免在"只需要length"时做Buffer合并

---

## 二、修改内容

### 2.1 修改文件

**文件**: `main/src/pipeline-orchestrator/audio-aggregator.ts`

**修改位置**: 第283行（`processAudioChunk()` 方法内，计算 `aggregatedAudioLength`）

### 2.2 修改前

```typescript
// 记录当前job在聚合音频中的字节偏移范围（用于originalJobIds分配）
const aggregatedAudioLength = this.aggregateAudioChunks(currentBuffer.audioChunks).length;
const currentJobStartOffset = aggregatedAudioLength - currentAudio.length;
const currentJobEndOffset = aggregatedAudioLength;
```

### 2.3 修改后

```typescript
// 记录当前job在聚合音频中的字节偏移范围（用于originalJobIds分配）
// ✅ 性能优化：只计算长度，不聚合完整Buffer（避免不必要的Buffer合并）
const aggregatedAudioLength = currentBuffer.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
const currentJobStartOffset = aggregatedAudioLength - currentAudio.length;
const currentJobEndOffset = aggregatedAudioLength;
```

### 2.4 修改说明

- **功能不变**: 计算结果与修改前完全一致（都是计算总长度）
- **性能提升**: 避免了不必要的Buffer合并操作
- **影响范围**: 仅影响offset计算，不影响任何业务逻辑

---

## 三、回归Checklist

### A. 编译/静态检查

- [x] `npm run build` / `tsc --project tsconfig.main.json` 通过
- [ ] 单测全绿（如有CI：全套pipeline通过）

### B. 正常路径（最常见：持续输入，不触发finalize）

- [ ] 连续发送多个音频chunk（例如10~30个）
- [ ] 不触发manual cut / timeout / maxDuration的情况下：
  - [ ] 仍能持续产出ASR segment（如果系统设计为streaming）
  - [ ] `originalJobInfo`的start/end offset单调递增且无倒退
  - [ ] 无异常日志：offset negative / out-of-range / undefined jobInfo

### C. 手动finalize路径（ManualCut）

- [ ] 触发一次手动cut（或模拟`isManualCut=true`）
- [ ] 观察：
  - [ ] `finalizeHandler.handleFinalize()`被调用
  - [ ] 输出的`audioSegments`与切分策略一致（splitAudioByEnergy正常）
  - [ ] 进入`OriginalJobResultDispatcher.finalizeOriginalJob()`后Utterance聚合正常（无重复提交、无undefined reason）

### D. Timeout finalize路径（非TTL超时，而是finalize timeout）

- [ ] 模拟/等待触发timeout finalize（你们定义的finalize超时机制）
- [ ] 观察：
  - [ ] finalize后不会出现"3秒一次不断finalize"的异常复现
  - [ ] pending不会被错误合并/丢失（pendingTimeoutAudio / pendingMaxDurationAudio）

### E. MaxDuration finalize路径

- [ ] 连续输入直到触发MaxDuration（按你们阈值）
- [ ] 观察：
  - [ ] `maxDurationHandler.handleMaxDurationFinalize()`被调用
  - [ ] 切分 + batch构建正常（createStreamingBatchesWithPending）
  - [ ] 不出现"重复聚合导致CPU飙升/延迟突然增大"的尖峰（可用埋点或采样）

### F. TTL超时路径（pendingTimeoutAudio TTL）

- [ ] 构造pending状态后停顿，等待TTL超时
- [ ] 确认：
  - [ ] TTL触发时仍可正确force finalize partial（或你们的TTL行为）
  - [ ] **关键**：TTL触发路径不依赖位置1的逻辑（报告确认：TTL超时直接return）

### G. 性能/调用次数（可选，但建议）

- [ ] 对比改动前后：
  - [ ] "正常路径只push chunk"时`aggregateAudioChunks()`调用次数下降（理想：不再因offset计算而调用）
  - [ ] CPU / latency采样有改善（尤其chunk多、buffer长的session）

---

## 四、测试建议（可选）

### 4.1 测试文件位置

如果已有测试文件，在对应测试文件中添加用例；如果没有，可考虑新增。

**建议测试文件**: `main/src/pipeline-orchestrator/__tests__/audio-aggregator.spec.ts` 或现有对应测试文件

### 4.2 建议测试用例

#### 用例A：正常路径（只push chunk，不触发finalize）

**目标**: 确保offset计算不依赖聚合Buffer内容

**步骤**:
1. 构造一个buffer，有`audioChunks=[buf1, buf2, buf3]`
2. 触发一次`processAudioChunk(job)`
3. 验证：
   - offset相关字段（如`currentJobStartOffset/currentJobEndOffset`或`originalJobInfo`写入）仍正确
   - 不要求聚合音频内容，仅检查offset与chunk长度求和一致

#### 用例B：MaxDuration / 手动finalize路径（保证行为不变）

**目标**: 确保handler仍正常工作

**步骤**:
1. 让流程进入`maxDurationHandler.handleMaxDurationFinalize()`或`finalizeHandler.handleFinalize()`
2. 断言：
   - handler仍被调用（次数/分支符合预期）
   - 输出的batch/segments数量、originalJobIds等与改动前一致（或至少稳定）

**注意**: 如果目前缺少可控触发条件（比如MaxDuration依赖时间/长度阈值），就只做"正常路径 + 手动finalize"两条最稳。

---

## 五、埋点建议（可选）

### 5.1 埋点位置

**文件**: `main/src/pipeline-orchestrator/audio-aggregator-merger.ts`

**目的**: 上线前后对比性能/调用次数（不改变逻辑，只加debug计数/trace）

### 5.2 埋点内容

- 在`aggregateAudioChunks()`入口加一个轻量计数（debug level）
- 或在aggregator侧统计`aggregateAudioChunks`调用次数

**注意**: 不想加埋点就跳过；本patch的正确性不依赖埋点。

---

## 六、执行说明（一句话版）

> "仅在`audio-aggregator.ts`的offset计算处，把`aggregateAudioChunks().length`改成对chunks做reduce求和，避免不必要的Buffer聚合；不改handler、不改finalize/TTL行为；按四条路径（正常/手动/MaxDuration/TTL）回归。"

---

## 七、修改验证

### 7.1 代码检查

- [x] 修改位置正确（第283行）
- [x] 语法正确（TypeScript编译通过）
- [x] 逻辑等价（计算结果与修改前一致）

### 7.2 功能验证

- [ ] 正常路径测试通过
- [ ] 手动finalize测试通过
- [ ] MaxDuration finalize测试通过
- [ ] TTL超时测试通过

---

*Patch执行完成，等待回归测试验证。*
