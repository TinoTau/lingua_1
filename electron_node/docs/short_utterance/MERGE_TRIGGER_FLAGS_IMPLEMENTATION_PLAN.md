# 合并触发标识实现计划

**日期**: 2025-12-30  
**目标**: 为每个job添加字段，标识是否是用户手动发送、3秒静音触发、10秒超时触发，用于强制提交合并组

---

## 一、需求分析

### 1. 问题描述

当前聚合逻辑中，如果utterance被识别为`MERGE`但不是合并组的最后一个，会返回空结果，等待最后一个utterance。但如果用户停止了说话，最后一个utterance可能永远不会到来，导致文本永远不会被发送。

### 2. 解决方案

为每个job添加以下标识：
- `is_manual_cut`: 是否由用户手动发送（is_final=true）
- `is_pause_triggered`: 是否由3秒静音触发（由web端赋值）
- `is_timeout_triggered`: 是否由10秒超时触发（由节点端自行判断，从NEW_STREAM开始计时）

如果这些标识为true，即使不是合并组的最后一个，也应该强制提交合并组。

---

## 二、实现步骤

### 步骤1: 调度服务器端 - 添加字段到Job结构体 ✅

**文件**: `central_server/scheduler/src/core/dispatcher.rs`

**已完成**:
- ✅ 在Job结构体中添加了`is_manual_cut`、`is_pause_triggered`、`is_timeout_triggered`字段

### 步骤2: 调度服务器端 - 添加字段到JobAssign消息 ✅

**文件**: `central_server/scheduler/src/messages/node.rs`

**已完成**:
- ✅ 在JobAssign消息中添加了`is_manual_cut`、`is_pause_triggered`、`is_timeout_triggered`字段

### 步骤3: 调度服务器端 - 修改create_job方法签名 ⏳

**文件**: `central_server/scheduler/src/core/dispatcher.rs`

**需要完成**:
- ⏳ 修改`create_job`方法签名，添加三个新参数
- ⏳ 在所有创建Job的地方添加这三个字段的默认值（false）

**关键位置**:
1. Phase2幂等检查时的Job创建（约240行、300行）
2. 正常Job创建（约480行、750行）

### 步骤4: 调度服务器端 - 修改create_translation_jobs方法 ⏳

**文件**: `central_server/scheduler/src/websocket/job_creator.rs`

**需要完成**:
- ⏳ 修改`create_translation_jobs`方法签名，添加三个新参数
- ⏳ 在调用`create_job`时传递这些参数

### 步骤5: 调度服务器端 - 修改do_finalize方法 ⏳

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**需要完成**:
- ⏳ 在`do_finalize`方法中，根据`reason`参数设置这些标识：
  - `reason == "IsFinal"` → `is_manual_cut = true`
  - `reason == "Pause"` → `is_pause_triggered = true`
  - `reason == "Timeout"` → `is_timeout_triggered = true`
- ⏳ 在调用`create_translation_jobs`时传递这些标识

### 步骤6: 调度服务器端 - 修改create_job_assign_message ⏳

**文件**: `central_server/scheduler/src/websocket/mod.rs`

**需要完成**:
- ⏳ 在`create_job_assign_message`方法中，从Job中提取这三个字段并添加到JobAssign消息中

### 步骤7: 节点端 - 修改聚合逻辑 ⏳

**文件**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`

**需要完成**:
- ⏳ 在`processUtterance`方法中，从job参数中提取这三个标识
- ⏳ 修改提交条件判断，如果这些标识为true，强制`shouldCommitNow = true`
- ⏳ 实现10秒超时判断（从NEW_STREAM开始计时）

**关键逻辑**:
```typescript
// 1. 手动发送：用户点击发送按钮，立即处理
const shouldCommitByManualCut = isManualCut || job.is_manual_cut;

// 2. 3秒静音触发：由web端赋值
const shouldCommitByPause = job.is_pause_triggered;

// 3. 10秒超时触发：由节点端自行判断（从NEW_STREAM开始计时）
const shouldCommitByTimeout = job.is_timeout_triggered || 
  (action === 'MERGE' && this.mergeGroupStartTimeMs > 0 && 
   (nowMs - this.mergeGroupStartTimeMs) >= 10000);

// 组合所有提交条件
let shouldCommitNow = shouldCommit(/* ... */) || 
  shouldCommitByManualCut || 
  shouldCommitByPause || 
  shouldCommitByTimeout || 
  isFinal;
```

### 步骤8: 节点端 - 修改aggregation-stage.ts ⏳

**文件**: `electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`

**需要完成**:
- ⏳ 确保从job中提取这些标识并传递给`processUtterance`

### 步骤9: Web端 - 传递3秒静音标识 ⏳

**文件**: `webapp/web-client/src/app/session_manager.ts`

**需要完成**:
- ⏳ 在检测到3秒静音时，在finalize消息中添加`is_pause_triggered: true`

---

## 三、关于Utterance 5-7来源的调查

### 问题

从日志可以看到，Utterance 5-7的ASR识别结果都是"这一句话就会使用了手动发送"，但都被返回为空结果。

### 可能的原因

1. **用户多次点击发送**: 用户可能多次点击了发送按钮，导致创建了多个utterance
2. **Web端重复发送音频**: Web端可能重复发送了相同的音频chunk
3. **调度服务器重复finalize**: 虽然finalize机制正常，但可能由于某种原因重复finalize了相同的音频

### 调查方向

1. **检查Web端日志**: 查看是否发送了重复的音频chunk或finalize消息
2. **检查调度服务器日志**: 查看这些utterance的finalize原因和时间
3. **检查节点端日志**: 查看这些utterance的ASR识别结果和音频数据

### 当前发现

从之前的日志分析可以看到：
- Utterance 5-7的finalize原因都是`IsFinal`（手动发送）
- 音频大小都很小（788-824 bytes）
- ASR识别结果相同："这一句话就会使用了手动发送"
- 但都被返回为空结果，因为不是合并组的最后一个

**结论**: 这些utterance可能是用户多次点击发送按钮导致的，但由于聚合逻辑判断它们不是合并组的最后一个，所以返回了空结果。

---

## 四、实施优先级

1. **高优先级**: 步骤3-6（调度服务器端传递标识）
2. **高优先级**: 步骤7（节点端使用标识强制提交）
3. **中优先级**: 步骤8（节点端传递标识）
4. **低优先级**: 步骤9（Web端传递3秒静音标识）

---

## 五、测试计划

1. **单元测试**: 测试聚合逻辑在收到这些标识时的行为
2. **集成测试**: 测试手动发送、3秒静音、10秒超时场景
3. **回归测试**: 确保现有功能不受影响

