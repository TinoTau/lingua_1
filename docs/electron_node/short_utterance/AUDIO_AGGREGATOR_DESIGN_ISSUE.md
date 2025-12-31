# AudioAggregator设计问题分析

**日期**: 2025-12-30  
**问题**: 调度服务器的finalize操作和节点端AudioAggregator的交互问题

---

## 一、问题描述

用户担心：**调度服务器的finalize操作会对节点端AudioAggregator产生影响吗？比如因为超时被强制finalize的句子，传递到ASR之前，是不是会保存在缓存里直到标识出现？**

---

## 二、当前架构分析

### 1. 调度服务器的finalize操作

**流程**：
1. Web端发送多个`audio_chunk`到调度服务器
2. 调度服务器累积`audio_chunk`到`audio_buffer`
3. 当触发finalize条件时（pause_ms超时、is_final=true等）：
   - 调用`take_combined()`获取所有累积的音频块
   - **拼接成完整的音频数据**
   - 设置标识（`is_pause_triggered = true`等）
   - 创建`JobAssignMessage`，包含**完整的音频数据**
   - 发送给节点端

**关键点**：
- ✅ **调度服务器已经将多个audio_chunk拼接成完整的utterance音频**
- ✅ **每个JobAssign消息包含一个完整的utterance音频**（不是单个音频块）
- ✅ **调度服务器已经做了音频聚合工作**

### 2. 节点端AudioAggregator的当前实现

**流程**：
1. 接收`JobAssignMessage`（包含完整的utterance音频）
2. 解码音频（Opus → PCM16）
3. 添加到缓冲区
4. 根据`is_manual_cut`和`is_pause_triggered`决定是否立即处理

**问题**：
- ❌ **AudioAggregator的设计假设是接收单个音频块，但实际上接收的是完整的utterance音频**
- ❌ **调度服务器已经finalize了，所以每个JobAssign消息包含的是完整的音频，不需要再次聚合单个音频块**

---

## 三、正确的设计

### 方案1：AudioAggregator应该聚合多个utterance（而不是音频块）

**理解**：
- 调度服务器finalize后，每个utterance可能还是短句
- 用户希望在节点端将这些**短句utterance聚合成长句**后再进行ASR

**正确的流程**：
```
调度服务器：
  audio_chunk1 → finalize → JobAssign1 (utterance1音频, is_pause_triggered=false)
  audio_chunk2 → finalize → JobAssign2 (utterance2音频, is_pause_triggered=false)
  audio_chunk3 → finalize → JobAssign3 (utterance3音频, is_pause_triggered=true) ← 触发标识

节点端AudioAggregator：
  接收JobAssign1 → 缓冲（等待更多utterance）
  接收JobAssign2 → 缓冲（等待更多utterance）
  接收JobAssign3 → 检测到is_pause_triggered=true → 聚合utterance1+2+3 → ASR识别完整句子
```

**关键点**：
- ✅ AudioAggregator应该聚合**多个utterance的音频**（而不是单个音频块）
- ✅ 每个JobAssign消息包含一个完整的utterance音频
- ✅ 当收到`is_manual_cut`或`is_pause_triggered`时，聚合所有缓冲的utterance

### 方案2：当前实现的问题

**当前实现的问题**：
- 当前实现假设接收的是单个音频块，但实际上接收的是完整的utterance音频
- 如果`is_pause_triggered = true`，会立即处理，但此时只包含一个utterance，没有聚合多个utterance

**修复方案**：
- AudioAggregator应该按utterance级别聚合，而不是音频块级别
- 每个JobAssign消息是一个utterance，应该缓冲多个utterance
- 当收到`is_manual_cut`或`is_pause_triggered`时，聚合所有缓冲的utterance

---

## 四、修复建议

### 1. 修改AudioAggregator的设计

**当前设计**（错误）：
- 假设接收单个音频块
- 缓冲多个音频块
- 聚合多个音频块

**正确设计**：
- 接收完整的utterance音频（每个JobAssign消息）
- 缓冲多个utterance音频
- 聚合多个utterance音频

### 2. 修改逻辑

**当前逻辑**：
```typescript
// 接收JobAssign消息
const aggregatedAudio = await this.audioAggregator.processAudioChunk(job);
// 如果is_pause_triggered=true，立即处理（但只包含一个utterance）
```

**正确逻辑**：
```typescript
// 接收JobAssign消息（包含完整的utterance音频）
const aggregatedAudio = await this.audioAggregator.processUtterance(job);
// 如果is_pause_triggered=true，聚合所有缓冲的utterance
```

### 3. 关键修改点

1. **方法名**：`processAudioChunk` → `processUtterance`
2. **缓冲单位**：音频块 → utterance音频
3. **聚合逻辑**：聚合多个音频块 → 聚合多个utterance音频

---

## 五、总结

### 问题根源

1. **调度服务器已经做了音频块聚合**：
   - 多个audio_chunk → finalize → 完整的utterance音频

2. **节点端AudioAggregator应该做utterance聚合**：
   - 多个utterance音频 → 聚合 → 完整的长句音频

3. **当前实现混淆了这两个层次**：
   - 当前实现假设接收的是音频块，但实际上接收的是utterance音频

### 修复方向

- ✅ AudioAggregator应该按utterance级别聚合
- ✅ 每个JobAssign消息是一个utterance，应该缓冲多个utterance
- ✅ 当收到`is_manual_cut`或`is_pause_triggered`时，聚合所有缓冲的utterance

---

## 六、相关文件

- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` - 需要修改
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - 需要修改调用方式
- `central_server/scheduler/src/websocket/session_actor/actor.rs` - 调度服务器finalize逻辑

