# 合并触发标识实现总结

**日期**: 2025-12-30  
**状态**: ✅ 已完成

---

## 一、实现的功能

### 1. 为每个job添加了三个标识字段

- ✅ `is_manual_cut`: 是否由用户手动发送（is_final=true）
- ✅ `is_pause_triggered`: 是否由3秒静音触发（由web端赋值，当前由调度服务器根据reason="Pause"设置）
- ✅ `is_timeout_triggered`: 是否由10秒超时触发（由节点端自行判断，从NEW_STREAM开始计时）

### 2. 调度服务器端实现

**已完成的修改**:
1. ✅ 在`Job`结构体中添加了三个新字段
2. ✅ 在`JobAssign`消息中添加了三个新字段
3. ✅ 修改了`create_job`方法签名，添加三个新参数
4. ✅ 修改了`create_translation_jobs`方法签名，添加三个新参数
5. ✅ 在`do_finalize`方法中，根据`reason`参数设置这些标识：
   - `reason == "IsFinal"` 或 `reason == "Send"` → `is_manual_cut = true`
   - `reason == "Pause"` → `is_pause_triggered = true`
   - `reason == "Timeout"` → `is_timeout_triggered = true`
6. ✅ 在`create_job_assign_message`中传递这些标识到节点端

### 3. 节点端实现

**已完成的修改**:
1. ✅ 修改了`processUtterance`方法签名，添加`isPauseTriggered`和`isTimeoutTriggered`参数
2. ✅ 实现了10秒超时判断（从NEW_STREAM开始计时）
3. ✅ 实现了强制提交逻辑：
   - 如果收到`is_manual_cut`或`is_pause_triggered`标识，强制提交当前合并组
   - 标记为合并组的最后一个（`isLastInMergedGroup = true`）
   - 清空合并组状态，下一个utterance将被识别为NEW_STREAM
4. ✅ 实现了NEW_STREAM判断逻辑：
   - 如果上一个utterance有手动发送/3秒静音标识，当前utterance应该被识别为NEW_STREAM

---

## 二、关键逻辑

### 1. 合并操作根据标识判断最后一句

**实现方式**:
- 如果收到`is_manual_cut`或`is_pause_triggered`标识，当前utterance被标记为合并组的最后一个
- 强制提交当前合并组，不再等待下一个utterance

**代码位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
```typescript
// 如果收到手动发送/3秒静音标识，强制提交并标记为合并组的最后一个
if (shouldCommitByManualCut && action === 'MERGE') {
  shouldCommitNow = true;
  isLastInMergedGroup = true;
  // 清空合并组状态，下一个utterance将是NEW_STREAM
  this.mergeGroupStartUtterance = null;
  this.mergeGroupStartTimeMs = 0;
  this.accumulatedAudioDurationMs = 0;
}
```

### 2. 忽略连续点击发送造成的低质量音频或文本

**实现方式**:
- 通过重复检测逻辑过滤完全相同的文本
- 如果文本与上次提交的完全相同，返回空结果

**代码位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
```typescript
// 在更新lastCommittedText之前，先检测重复
if (commitText && this.lastCommittedText && 
    normalizeText(commitText) === normalizeText(this.lastCommittedText)) {
  return { text: '', shouldCommit: false, ... };
}
```

### 3. 节点端在收到手动发送/3秒静音标识时，将下一句设为NEW_STREAM

**实现方式**:
- 如果上一个utterance有手动发送/3秒静音标识，当前utterance被识别为NEW_STREAM
- 在提交后清空合并组状态，确保下一个utterance是NEW_STREAM

**代码位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
```typescript
// 决策：merge 还是 new_stream
// 关键逻辑：如果上一个utterance有手动发送/3秒静音标识，当前应该是NEW_STREAM
let action: StreamAction;
if (this.lastUtterance && (this.lastUtterance.isManualCut || (this.lastUtterance as any).isPauseTriggered)) {
  action = 'NEW_STREAM';
  // ...
}
```

### 4. 根据10秒超时原则或再次收到手动发送/3秒静音的标识来合并内容

**实现方式**:
- 10秒超时：从NEW_STREAM（合并组开始）开始计时，如果超过10秒，自动提交
- 再次收到手动发送/3秒静音标识：强制提交当前合并组

**代码位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
```typescript
// 10秒超时触发：从NEW_STREAM开始计时，如果超过10秒，自动提交
const TIMEOUT_THRESHOLD_MS = 10000;  // 10秒
const shouldCommitByTimeout = isTimeoutTriggered || 
  (action === 'MERGE' && this.mergeGroupStartTimeMs > 0 && 
   (nowMs - this.mergeGroupStartTimeMs) >= TIMEOUT_THRESHOLD_MS);
```

---

## 三、工作流程

### 场景1: 用户手动发送

1. 用户点击发送按钮 → Web端发送`is_final=true`
2. 调度服务器收到`reason="IsFinal"` → 设置`is_manual_cut=true`
3. 节点端收到`is_manual_cut=true` → 强制提交当前合并组，标记为最后一个
4. 下一个utterance → 被识别为NEW_STREAM（因为上一个已提交）

### 场景2: 3秒静音触发

1. Web端检测到3秒静音 → 发送finalize（当前由调度服务器根据`reason="Pause"`设置）
2. 调度服务器收到`reason="Pause"` → 设置`is_pause_triggered=true`
3. 节点端收到`is_pause_triggered=true` → 强制提交当前合并组，标记为最后一个
4. 下一个utterance → 被识别为NEW_STREAM（因为上一个已提交）

### 场景3: 10秒超时

1. 从NEW_STREAM开始计时 → `mergeGroupStartTimeMs`记录开始时间
2. 如果超过10秒 → 自动提交当前合并组
3. 或者收到`is_timeout_triggered=true`标识 → 强制提交

### 场景4: 连续点击发送（低质量音频）

1. 用户连续点击发送 → 创建多个utterance
2. 如果ASR识别结果相同 → 重复检测逻辑过滤，返回空结果
3. 如果ASR识别结果不同但都很短 → 合并逻辑处理，根据标识判断是否提交

---

## 四、关于Utterance 5-7的来源

### 问题分析

从日志可以看到，Utterance 5-7的ASR识别结果都是"这一句话就会使用了手动发送"，但都被返回为空结果。

### 可能的原因

1. **用户多次点击发送按钮**: 用户可能多次点击了发送按钮，导致创建了多个utterance
2. **ASR识别结果相同**: 这些utterance的ASR识别结果相同，可能是重复的音频或ASR服务重复识别
3. **聚合逻辑等待最后一个**: 由于聚合逻辑判断这些utterance不是合并组的最后一个，所以返回了空结果

### 解决方案

通过本次改进：
1. ✅ 如果收到手动发送标识，强制提交当前合并组，不再等待
2. ✅ 如果ASR识别结果与上次提交的完全相同，重复检测逻辑会过滤
3. ✅ 下一个utterance会被识别为NEW_STREAM，开始新的合并组

---

## 五、相关文件

### 调度服务器端
- `central_server/scheduler/src/core/dispatcher.rs`: Job结构体和create_job方法
- `central_server/scheduler/src/messages/node.rs`: JobAssign消息定义
- `central_server/scheduler/src/websocket/job_creator.rs`: create_translation_jobs方法
- `central_server/scheduler/src/websocket/session_actor/actor.rs`: do_finalize方法
- `central_server/scheduler/src/websocket/mod.rs`: create_job_assign_message方法

### 节点端
- `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`: 核心聚合逻辑
- `electron_node/electron-node/main/src/aggregator/aggregator-manager.ts`: AggregatorManager
- `electron_node/electron-node/main/src/aggregator/aggregator-decision.ts`: UtteranceInfo接口
- `electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`: 从job中提取标识

---

## 六、测试建议

1. **手动发送测试**: 用户点击发送按钮，验证是否强制提交合并组
2. **3秒静音测试**: 用户停止说话3秒，验证是否触发提交
3. **10秒超时测试**: 用户持续说话超过10秒，验证是否自动提交
4. **连续点击测试**: 用户连续点击发送按钮，验证是否忽略低质量音频
5. **NEW_STREAM测试**: 验证在收到手动发送/3秒静音标识后，下一个utterance是否为NEW_STREAM

