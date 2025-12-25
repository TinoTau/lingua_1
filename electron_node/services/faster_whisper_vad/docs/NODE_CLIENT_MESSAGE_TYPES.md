# 节点端接收的消息类型

**日期**: 2025-12-24  
**问题**: 节点端应该只会收到Utterance对吗？不应该有audio_chunk？  
**状态**: ✅ **已确认**

---

## 结论

✅ **正确**：节点端**只接收`JobAssignMessage`**（包含完整的音频数据），**不会接收`audio_chunk`消息**。

---

## 节点端消息处理

### 接收的消息类型

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

```typescript
private async handleMessage(data: string): Promise<void> {
  const message = JSON.parse(data);
  
  switch (message.type) {
    case 'node_register_ack': {
      // 节点注册确认
      break;
    }
    
    case 'job_assign': {  // ✅ 只处理 job_assign
      const job = message as JobAssignMessage;
      await this.handleJob(job);
      break;
    }
    
    case 'job_cancel': {
      // 任务取消
      break;
    }
    
    default:
      logger.warn({ messageType: message.type }, 'Unknown message type');
  }
}
```

**关键点**:
- 节点端**只处理`job_assign`消息**
- **没有处理`audio_chunk`的逻辑**
- 如果收到`audio_chunk`，会被视为"Unknown message type"

---

## JobAssignMessage结构

### 消息格式

**文件**: `shared/protocols/messages.ts`（推测）

```typescript
interface JobAssignMessage {
  type: 'job_assign';
  job_id: string;
  session_id: string;
  utterance_index: number;
  src_lang: string;
  tgt_lang: string;
  audio: string;  // ✅ base64编码的完整音频数据
  audio_format: string;  // ✅ 音频格式（如'opus', 'pcm16'）
  sample_rate: number;
  // ... 其他字段
}
```

**关键点**:
- `audio`字段包含**完整的音频数据**（base64编码）
- 不是流式的`audio_chunk`，而是**完整的utterance音频**

---

## 数据流

### Web端 → 调度服务器 → 节点端

```
Web端
  → audio_chunk消息（每100ms）
    → 调度服务器: 累积到audio_buffer
  → utterance消息（手动发送）
    → 调度服务器: 直接创建job

调度服务器
  → finalize（合并所有audio_chunk）
    → 创建JobAssignMessage
    → 包含完整的音频数据（base64编码）
    → 发送给节点端

节点端
  → 接收JobAssignMessage
    → 提取job.audio（完整的音频数据）
    → 调用ASR服务（/utterance接口）
```

---

## 节点端处理逻辑

### handleJob方法

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

```typescript
private async handleJob(job: JobAssignMessage): Promise<void> {
  // 提取音频数据
  const audioData = job.audio;  // ✅ base64编码的完整音频数据
  
  // 调用ASR服务
  const asrTask: ASRTask = {
    audio: job.audio,  // ✅ 完整的音频数据
    audio_format: job.audio_format || 'pcm16',
    sample_rate: job.sample_rate || 16000,
    src_lang: job.src_lang,
    // ...
  };
  
  // 路由到ASR服务
  await this.taskRouter.routeASRTask(asrTask);
}
```

**关键点**:
- 节点端接收的是**完整的音频数据**（不是流式的chunk）
- 直接调用ASR服务的`/utterance`接口
- **不处理流式的audio_chunk**

---

## 调度服务器创建JobAssignMessage

### create_job_assign_message函数

**文件**: `central_server/scheduler/src/websocket/mod.rs`

```rust
pub(crate) async fn create_job_assign_message(
    state: &crate::core::AppState,
    job: &crate::core::dispatcher::Job,
    // ...
) -> Option<NodeMessage> {
    use base64::{Engine as _, engine::general_purpose};
    let audio_base64 = general_purpose::STANDARD.encode(&job.audio_data);  // ✅ 完整的音频数据
    
    Some(NodeMessage::JobAssign {
        job_id: job.job_id.clone(),
        audio: audio_base64,  // ✅ base64编码的完整音频数据
        audio_format: job.audio_format.clone(),
        // ...
    })
}
```

**关键点**:
- 调度服务器在finalize时，会**合并所有audio_chunk**
- 然后创建`JobAssignMessage`，包含**完整的音频数据**
- 发送给节点端

---

## 为什么节点端不接收audio_chunk？

### 设计原因

1. **简化节点端逻辑**:
   - 节点端不需要处理流式数据
   - 只需要处理完整的utterance

2. **统一接口**:
   - 无论是Web端发送`audio_chunk`还是`utterance`，调度服务器都会finalize成完整的音频数据
   - 节点端统一接收`JobAssignMessage`

3. **减少网络开销**:
   - 调度服务器在本地合并audio_chunk，减少网络传输次数
   - 节点端只接收一次完整的音频数据

---

## 总结

### 节点端接收的消息

✅ **只接收`JobAssignMessage`**:
- 包含完整的音频数据（base64编码）
- 不是流式的`audio_chunk`
- 直接调用ASR服务的`/utterance`接口

❌ **不接收`audio_chunk`**:
- 节点端没有处理`audio_chunk`的逻辑
- 如果收到`audio_chunk`，会被视为"Unknown message type"

### 数据流

```
Web端
  → audio_chunk（流式，每100ms）
  → utterance（完整，手动发送）

调度服务器
  → 累积audio_chunk到audio_buffer
  → finalize（合并所有chunk）
  → 创建JobAssignMessage（完整音频数据）
  → 发送给节点端

节点端
  → 接收JobAssignMessage
  → 提取完整音频数据
  → 调用ASR服务
```

---

## 相关文件

- `electron_node/electron-node/main/src/agent/node-agent.ts` - 节点端消息处理
- `central_server/scheduler/src/websocket/mod.rs` - 创建JobAssignMessage
- `central_server/scheduler/src/websocket/session_actor/actor.rs` - Session Actor finalize逻辑

