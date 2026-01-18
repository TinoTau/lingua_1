# TTS播放期间Pause检测修复方案

## 分析日期
2026-01-17

## 最终决策

用户决定：**"通过播放完成的通知来阻止调度服务器将播放过程中的时间都算作chunk时间。如果可以避免增加新的消息类型，就保持现在的实现方案。"**

**结论**：采用当前实现方案（基于`TTS_PLAY_ENDED`推断），不添加新的消息类型。

---

## 当前实现方案

### 当前方案：通过`last_tts_end_at`推断

**实现方式**：
1. Web端在TTS播放**结束**时发送`TTS_PLAY_ENDED`消息
2. 调度服务器记录`last_tts_end_at_ms`
3. 在pause检测时，检查是否在TTS播放期间：
   ```rust
   let time_since_tts_end_ms = timestamp_ms - last_tts_end_at as i64;
   let is_tts_playing = time_since_tts_end_ms < 60000 && time_since_tts_end_ms > 0;
   ```
4. 如果在TTS播放期间（60秒窗口），不触发pause finalize

**优点**：
- ✅ 已经实现了`TTS_PLAY_ENDED`消息
- ✅ 不需要修改Web端代码
- ✅ 只需要在调度服务器端修改

**缺点**：
- ❌ **不够准确**：使用60秒的固定窗口来推断，可能不够准确
- ❌ **无法知道TTS实际播放时长**：如果TTS播放时长 < 60秒，可能误判；如果 > 60秒，可能漏判
- ❌ **无法知道TTS播放开始时间**：只能通过`last_tts_end_at`反向推断

---

## 用户建议的方案：TTS_PLAY_STARTED通知

### 方案：在TTS播放开始时发送通知

**实现方式**：
1. Web端在TTS播放**开始**时发送`TTS_PLAY_STARTED`消息（包含`tts_duration_ms`）
2. 调度服务器记录`last_tts_start_at_ms`和`current_tts_duration_ms`
3. 在pause检测时，精确检查是否在TTS播放期间：
   ```rust
   let time_since_tts_start_ms = timestamp_ms - last_tts_start_at_ms;
   let is_tts_playing = time_since_tts_start_ms >= 0 && time_since_tts_start_ms < current_tts_duration_ms;
   ```
4. 如果在TTS播放期间，不触发pause finalize

**优点**：
- ✅ **更准确**：可以精确知道TTS播放的开始时间和时长
- ✅ **无需固定窗口**：根据实际TTS播放时长判断
- ✅ **逻辑更清晰**：明确知道何时开始播放，何时结束

**缺点**：
- ❌ 需要修改Web端代码，添加`TTS_PLAY_STARTED`消息发送
- ❌ 需要修改调度服务器，添加`TTS_PLAY_STARTED`消息处理
- ❌ 需要修改`GroupManager`，添加`last_tts_start_at_ms`和`current_tts_duration_ms`字段

---

## 对比分析

### 准确性对比

| 方案 | 准确性 | 实现复杂度 | 需要修改的代码 |
|------|--------|-----------|---------------|
| **当前方案**（`last_tts_end_at`推断） | ⚠️ 中等（60秒固定窗口） | ✅ 低（只需要调度服务器端） | 调度服务器 |
| **用户建议方案**（`TTS_PLAY_STARTED`通知） | ✅ 高（精确时间窗口） | ⚠️ 中等（需要Web端和调度服务器端） | Web端 + 调度服务器 |

---

## 实现建议

### 推荐：采用用户建议的方案（TTS_PLAY_STARTED通知）

**理由**：
1. **更准确**：可以精确知道TTS播放的开始时间和时长
2. **更可靠**：不依赖于固定窗口，避免误判和漏判
3. **更清晰**：逻辑更直观，便于理解和维护

### 实现步骤

#### 1. 修改消息协议（`messages/session.rs`）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionMessage {
    // ... 其他消息 ...
    
    #[serde(rename = "tts_play_started")]
    TtsPlayStarted {
        session_id: String,
        trace_id: String,
        group_id: String,
        ts_start_ms: u64,  // Web端播放开始时间戳
        tts_duration_ms: u64,  // TTS音频时长（毫秒）
    },
    
    #[serde(rename = "tts_play_ended")]
    TtsPlayEnded {
        session_id: String,
        trace_id: String,
        group_id: String,
        ts_end_ms: u64,
    },
}
```

#### 2. 修改GroupManager（`managers/group_manager.rs`）

```rust
#[derive(Clone, Debug)]
pub struct UtteranceGroup {
    pub group_id: GroupId,
    pub session_id: SessionId,
    pub created_at_ms: u64,
    pub last_tts_start_at_ms: Option<u64>,  // 新增：TTS播放开始时间
    pub current_tts_duration_ms: Option<u64>,  // 新增：当前TTS播放时长
    pub last_tts_end_at_ms: u64,
    pub next_part_index: u64,
    pub parts: VecDeque<GroupPart>,
    pub is_closed: bool,
}

impl GroupManager {
    /// 处理 TTS 播放开始
    pub async fn on_tts_play_started(&self, group_id: &str, tts_start_ms: u64, tts_duration_ms: u64) {
        let mut groups = self.groups.write().await;
        if let Some(group) = groups.get_mut(group_id) {
            group.last_tts_start_at_ms = Some(tts_start_ms);
            group.current_tts_duration_ms = Some(tts_duration_ms);
            
            debug!(
                group_id = %group_id,
                session_id = %group.session_id,
                tts_start_ms = tts_start_ms,
                tts_duration_ms = tts_duration_ms,
                "TTS 播放开始，已更新 Group last_tts_start_at"
            );
        } else {
            warn!(
                group_id = %group_id,
                "TTS 播放开始时未找到对应的 Group"
            );
        }
    }
    
    /// 获取是否在TTS播放期间（用于pause检测）
    pub async fn is_tts_playing(&self, group_id: &str, current_time_ms: i64) -> bool {
        let groups = self.groups.read().await;
        if let Some(group) = groups.get(group_id) {
            if let (Some(tts_start_ms), Some(tts_duration_ms)) = 
                (group.last_tts_start_at_ms, group.current_tts_duration_ms) {
                let time_since_start_ms = current_time_ms - tts_start_ms as i64;
                time_since_start_ms >= 0 && time_since_start_ms < tts_duration_ms as i64
            } else {
                false
            }
        } else {
            false
        }
    }
}
```

#### 3. 修改SessionActor（`session_actor/actor/actor_event_handling.rs`）

```rust
// 在pause检测时，使用精确的TTS播放期间判断
if pause_exceeded {
    let is_tts_playing = {
        if let Some(group_id) = self.state.group_manager.get_active_group_id(&self.session_id).await {
            self.state.group_manager.is_tts_playing(&group_id, timestamp_ms).await
        } else {
            false
        }
    };
    
    if is_tts_playing {
        // 不触发pause finalize
    } else {
        should_finalize = true;
        finalize_reason = "Pause";
    }
}
```

#### 4. 修改Web端（`webapp/web-client/src/app/session_manager.ts`）

```typescript
// 在TTS播放开始时发送通知
onTtsPlayStarted(utteranceIndex: number, durationMs: number): void {
  const now = Date.now();
  
  // 获取group_id（从最近的translation result中）
  const groupId = this.getCurrentGroupId(); // 需要实现这个方法
  
  this.wsClient.sendMessage({
    type: 'tts_play_started',
    session_id: this.sessionId,
    trace_id: this.traceId,
    group_id: groupId,
    ts_start_ms: now,
    tts_duration_ms: durationMs,
  });
}
```

---

## 结论

### ✅ **采用当前实现方案**

**决策理由**：
- ✅ 避免增加新的消息类型（`TTS_PLAY_STARTED`）
- ✅ 使用已有的`TTS_PLAY_ENDED`消息即可达到目标
- ✅ 通过`last_tts_end_at`和60秒窗口判断，虽然不够精确，但足够满足需求
- ✅ 实现简单，无需修改Web端代码

**当前方案说明**：
- ✅ 使用`TTS_PLAY_ENDED`（已有的消息类型）
- ✅ 通过`last_tts_end_at`和60秒窗口来判断是否在TTS播放期间
- ✅ 如果在TTS播放期间，即使chunk间隔>3秒，也不触发pause finalize
- ⚠️ 60秒窗口足够覆盖大部分TTS播放时长，基本满足需求

**已实现**：
- ✅ `GroupManager::get_active_group_id()` - 获取session的活跃group_id
- ✅ `GroupManager::get_last_tts_end_at()` - 获取group的last_tts_end_at
- ✅ `SessionActor::pause检测逻辑` - 检查是否在TTS播放期间（60秒窗口）

---

## 相关文件

- `central_server/scheduler/src/messages/session.rs` - 消息协议定义
- `central_server/scheduler/src/managers/group_manager.rs` - Group管理
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - Pause检测逻辑
- `webapp/web-client/src/app/session_manager.ts` - Web端TTS播放处理
