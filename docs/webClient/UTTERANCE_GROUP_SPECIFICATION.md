# Utterance Group 功能详细规范

**版本**: v1.0  
**状态**: 📋 设计阶段  
**优先级**: ⭐⭐⭐⭐⭐ **最高优先级**  
**所属阶段**: 阶段 2.1.3  
**最后更新**: 2025-01-XX

---

## 目录

1. [功能概述](#1-功能概述)
2. [产品需求](#2-产品需求)
3. [技术架构](#3-技术架构)
4. [数据结构设计](#4-数据结构设计)
5. [协议扩展](#5-协议扩展)
6. [后端实现需求](#6-后端实现需求)
7. [前端实现需求](#7-前端实现需求)
8. [实现步骤](#8-实现步骤)
9. [测试计划](#9-测试计划)
10. [性能与扩展](#10-性能与扩展)

---

## 1. 功能概述

### 1.1 背景

在实时语音翻译场景中，用户经常需要围绕同一话题进行多轮补充发言。例如：

- **第一轮**: "我想订一张明天去奥克兰的机票。"
- **第二轮**: "最好是早上十点以前出发的。"
- **第三轮**: "如果可以的话靠窗座位更好。"

这三轮发言在语义上属于同一话题，应该作为一个整体进行翻译，以保持上下文连贯性和翻译自然度。

### 1.2 核心价值

**Utterance Group（话语组）** 功能的核心价值：

1. **语义连贯性**: 将围绕同一话题的多轮发言归为一组，翻译时使用完整上下文
2. **翻译自然度**: 翻译引擎能够理解上下文，生成更自然、更准确的目标语言表达
3. **用户体验**: 用户可以在播放结束后继续补充内容，系统自动识别并合并到同一话题组
4. **ASR 准确性**: 利用上下文信息提高语音识别的准确性，避免因断句导致的识别偏差

### 1.3 设计原则

- **文本层拼接**: 不拼接音频波形，只在文本层面进行上下文拼接
- **自动分组**: 基于时间间隔和语义相似度自动判断是否属于同一组
- **向后兼容**: 不影响现有的单轮翻译流程，可以逐步启用
- **可配置**: 支持配置超时时间等参数，适应不同场景需求

---

## 2. 产品需求

### 2.1 功能需求

#### FR-UG-01: Group 自动创建

**描述**: 系统应能够自动创建新的 Utterance Group。

**触发条件**:
- 会话首次发言
- 距离上一次 TTS 播放结束时间超过 `group_timeout_sec`（默认 30 秒）
- 用户在 UI 上点击"开始新话题"按钮
- 后端通过语义分析判断当前发言为全新话题（可选，v1 可暂不实现）

**验收标准**:
- 新 Group 创建时生成唯一的 `group_id`
- Group 创建时间戳被记录
- Group 与 Session 正确关联

#### FR-UG-02: Group 自动归属

**描述**: 系统应能够自动判断新的 utterance 是否属于现有 Group。

**判断规则**:
- 当前时间与上一次 TTS 播放结束时间的间隔 < `group_timeout_sec`（默认 30 秒）
- 当前发言在语义上是对上一轮的继续/补充（v1 可暂不实现语义分析，仅基于时间）
- 没有显式"新话题"指示

**验收标准**:
- 满足条件时，新 utterance 自动归属到上一 Group
- 不满足条件时，创建新 Group
- 归属判断逻辑可配置

#### FR-UG-03: 上下文拼接

**描述**: 翻译时应使用 Group 内所有 part 的文本作为上下文。

**拼接方式**:
- 不拼接音频波形
- 在文本层面将 Group 内所有 part 的 ASR 文本拼接
- 翻译引擎接收完整上下文进行翻译

**验收标准**:
- 翻译时能够访问 Group 内所有历史文本
- 翻译结果体现上下文连贯性
- 不影响单轮翻译的性能

#### FR-UG-04: Group 信息传递

**描述**: 系统应在消息协议中传递 Group 相关信息。

**信息包括**:
- `group_id`: Group 唯一标识
- `part_index`: 当前 utterance 在 Group 中的序号
- `is_new_group`: 是否为新建 Group

**验收标准**:
- 所有相关消息都包含 Group 信息
- Group 信息在 Web → Scheduler → Node 之间正确传递
- 前端能够显示 Group 信息（可选）

### 2.2 非功能需求

#### NFR-UG-01: 性能要求

- Group 创建和归属判断延迟 < 10ms
- 上下文拼接不影响翻译延迟（增加 < 50ms）
- 支持每个 Session 最多 100 个 Group（可配置）

#### NFR-UG-02: 可配置性

- `group_timeout_sec` 可配置（默认 30 秒）
- Group 最大 part 数量可配置（默认 10，防止无限增长）
- 支持通过配置文件或环境变量配置

#### NFR-UG-03: 向后兼容

- 不启用 Group 功能时，系统行为与现有版本完全一致
- 现有客户端无需修改即可继续使用
- 新功能通过可选字段实现，不影响现有消息解析

---

## 3. 技术架构

### 3.1 系统组件

```
┌─────────────────────────────────────────────────────────────┐
│                      Web 客户端                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  State Machine (记录 TTS 播放结束时间)                │  │
│  │  WebSocket Client (发送 group_id, is_new_group)      │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   调度服务器 (Scheduler)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Group Manager (管理 Group 生命周期)                  │  │
│  │  - create_group()                                    │  │
│  │  - get_or_create_group()                             │  │
│  │  - get_group_context()                               │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Session Manager (扩展支持 Group)                     │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket (JobAssign with context)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 节点推理服务 (Node Inference)                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  NMT Engine (支持上下文输入)                          │  │
│  │  - translate_with_context(context, current_text)     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

```
1. Web 客户端发送 Utterance
   └─> 包含: session_id, utterance_index, group_id (可选), is_new_group (可选)

2. Scheduler 接收 Utterance
   ├─> Group Manager 判断是否创建新 Group 或归属现有 Group
   ├─> 获取 Group 上下文（所有历史 part 的文本）
   └─> 创建 Job，包含上下文信息

3. Scheduler 发送 JobAssign 到 Node
   └─> 包含: job_id, session_id, utterance_index, group_id, context_texts[]

4. Node 处理 Job
   ├─> ASR: 识别当前音频
   ├─> NMT: 使用 context_texts[] + current_text 进行翻译
   └─> TTS: 合成翻译结果

5. Node 返回 JobResult
   └─> 包含: job_id, session_id, utterance_index, group_id, text_asr, text_translated

6. Scheduler 更新 Group 状态
   ├─> 保存当前 part 的 ASR 文本和翻译文本
   └─> 记录 TTS 播放结束时间（由前端通知或估算）

7. Scheduler 转发结果到 Web 客户端
   └─> 包含: session_id, utterance_index, group_id, text_asr, text_translated, tts_audio
```

---

## 4. 数据结构设计

### 4.1 Scheduler 数据结构

#### 4.1.1 UtteranceGroup

```rust
// scheduler/src/group.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UtteranceGroup {
    /// Group 唯一标识
    pub group_id: String,
    /// 所属 Session ID
    pub session_id: String,
    /// Group 创建时间
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 最后一次 TTS 播放结束时间
    pub last_tts_end_time: Option<chrono::DateTime<chrono::Utc>>,
    /// Group 内的所有 part
    pub parts: Vec<GroupPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupPart {
    /// Part 序号（从 1 开始）
    pub part_index: u32,
    /// 对应的 utterance_index
    pub utterance_index: u64,
    /// ASR 识别文本
    pub asr_text: String,
    /// 翻译文本
    pub translated_text: String,
    /// 创建时间
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl UtteranceGroup {
    /// 获取所有 part 的 ASR 文本（用于上下文拼接）
    pub fn get_context_texts(&self) -> Vec<String> {
        self.parts.iter()
            .map(|p| p.asr_text.clone())
            .collect()
    }
    
    /// 获取所有 part 的翻译文本（可选，用于某些翻译引擎）
    pub fn get_translated_texts(&self) -> Vec<String> {
        self.parts.iter()
            .map(|p| p.translated_text.clone())
            .collect()
    }
    
    /// 添加新的 part
    pub fn add_part(&mut self, utterance_index: u64, asr_text: String, translated_text: String) {
        let part_index = (self.parts.len() + 1) as u32;
        self.parts.push(GroupPart {
            part_index,
            utterance_index,
            asr_text,
            translated_text,
            created_at: chrono::Utc::now(),
        });
    }
    
    /// 更新最后 TTS 播放结束时间
    pub fn update_last_tts_end_time(&mut self, end_time: chrono::DateTime<chrono::Utc>) {
        self.last_tts_end_time = Some(end_time);
    }
    
    /// 判断是否应该创建新 Group（基于时间间隔）
    pub fn should_create_new_group(&self, timeout_sec: u64) -> bool {
        if let Some(last_end) = self.last_tts_end_time {
            let now = chrono::Utc::now();
            let elapsed = (now - last_end).num_seconds();
            elapsed > timeout_sec as i64
        } else {
            // 如果没有记录 TTS 结束时间，默认不创建新 Group
            false
        }
    }
}
```

#### 4.1.2 GroupManager

```rust
// scheduler/src/group.rs

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Clone)]
pub struct GroupManager {
    /// session_id -> group_id -> UtteranceGroup
    groups: Arc<RwLock<HashMap<String, HashMap<String, UtteranceGroup>>>>,
    /// session_id -> 当前活跃的 group_id
    active_groups: Arc<RwLock<HashMap<String, String>>>,
    /// Group 超时时间（秒）
    group_timeout_sec: u64,
    /// Group 最大 part 数量
    max_parts_per_group: u32,
}

impl GroupManager {
    pub fn new(group_timeout_sec: u64, max_parts_per_group: u32) -> Self {
        Self {
            groups: Arc::new(RwLock::new(HashMap::new())),
            active_groups: Arc::new(RwLock::new(HashMap::new())),
            group_timeout_sec,
            max_parts_per_group,
        }
    }
    
    /// 创建新 Group
    pub async fn create_group(&self, session_id: String) -> String {
        let group_id = format!("g-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        let group = UtteranceGroup {
            group_id: group_id.clone(),
            session_id: session_id.clone(),
            created_at: chrono::Utc::now(),
            last_tts_end_time: None,
            parts: Vec::new(),
        };
        
        let mut groups = self.groups.write().await;
        groups.entry(session_id.clone())
            .or_insert_with(HashMap::new)
            .insert(group_id.clone(), group);
        
        let mut active_groups = self.active_groups.write().await;
        active_groups.insert(session_id, group_id.clone());
        
        group_id
    }
    
    /// 获取或创建 Group（根据时间间隔判断）
    pub async fn get_or_create_group(&self, session_id: String, force_new: bool) -> (String, bool) {
        if force_new {
            let group_id = self.create_group(session_id).await;
            return (group_id, true);
        }
        
        let active_groups = self.active_groups.read().await;
        if let Some(current_group_id) = active_groups.get(&session_id) {
            let groups = self.groups.read().await;
            if let Some(session_groups) = groups.get(&session_id) {
                if let Some(group) = session_groups.get(current_group_id) {
                    // 检查是否应该创建新 Group
                    if !group.should_create_new_group(self.group_timeout_sec) {
                        // 检查 part 数量是否超过限制
                        if group.parts.len() < self.max_parts_per_group as usize {
                            return (current_group_id.clone(), false);
                        }
                    }
                }
            }
        }
        
        // 需要创建新 Group
        drop(active_groups);
        let group_id = self.create_group(session_id).await;
        (group_id, true)
    }
    
    /// 获取 Group 上下文文本
    pub async fn get_group_context(&self, session_id: &str, group_id: &str) -> Option<Vec<String>> {
        let groups = self.groups.read().await;
        groups.get(session_id)?
            .get(group_id)
            .map(|g| g.get_context_texts())
    }
    
    /// 添加 part 到 Group
    pub async fn add_part_to_group(
        &self,
        session_id: &str,
        group_id: &str,
        utterance_index: u64,
        asr_text: String,
        translated_text: String,
    ) -> bool {
        let mut groups = self.groups.write().await;
        if let Some(session_groups) = groups.get_mut(session_id) {
            if let Some(group) = session_groups.get_mut(group_id) {
                group.add_part(utterance_index, asr_text, translated_text);
                return true;
            }
        }
        false
    }
    
    /// 更新 Group 的最后 TTS 播放结束时间
    pub async fn update_tts_end_time(
        &self,
        session_id: &str,
        group_id: &str,
        end_time: chrono::DateTime<chrono::Utc>,
    ) -> bool {
        let mut groups = self.groups.write().await;
        if let Some(session_groups) = groups.get_mut(session_id) {
            if let Some(group) = session_groups.get_mut(group_id) {
                group.update_last_tts_end_time(end_time);
                return true;
            }
        }
        false
    }
    
    /// 清理过期的 Group（可选，用于内存管理）
    pub async fn cleanup_expired_groups(&self, max_age_hours: u64) {
        let mut groups = self.groups.write().await;
        let cutoff = chrono::Utc::now() - chrono::Duration::hours(max_age_hours as i64);
        
        for session_groups in groups.values_mut() {
            session_groups.retain(|_, group| {
                group.created_at > cutoff
            });
        }
    }
}
```

### 4.2 Session 扩展

```rust
// scheduler/src/session.rs (扩展)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    // ... 现有字段 ...
    
    /// 当前活跃的 Group ID（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_group_id: Option<String>,
}
```

### 4.3 Job 扩展

```rust
// scheduler/src/dispatcher.rs (扩展)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    // ... 现有字段 ...
    
    /// Group ID（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    
    /// Group 上下文文本（用于翻译）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_context: Option<Vec<String>>,
    
    /// 是否为新建 Group
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_new_group: Option<bool>,
}
```

---

## 5. 协议扩展

### 5.1 WebSocket 消息扩展

#### 5.1.1 Utterance 消息扩展

```typescript
// shared/protocols/messages.ts

export interface UtteranceMessage {
  type: 'utterance';
  session_id: string;
  utterance_index: number;
  // ... 现有字段 ...
  
  /** Group ID（可选，客户端提供或由 Scheduler 生成） */
  group_id?: string;
  
  /** 是否强制创建新 Group（可选，用户点击"开始新话题"时设置为 true） */
  is_new_group?: boolean;
  
  /** TTS 播放结束时间戳（可选，用于 Group 归属判断） */
  tts_end_timestamp?: number;
}
```

#### 5.1.2 JobAssign 消息扩展

```rust
// scheduler/src/messages.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobAssign {
    // ... 现有字段 ...
    
    /// Group ID（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    
    /// Group 上下文文本（用于翻译）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_context: Option<Vec<String>>,
    
    /// 是否为新建 Group
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_new_group: Option<bool>,
}
```

#### 5.1.3 TranslationResult 消息扩展

```typescript
// shared/protocols/messages.ts

export interface TranslationResultMessage {
  type: 'translation_result';
  session_id: string;
  utterance_index: number;
  // ... 现有字段 ...
  
  /** Group ID */
  group_id?: string;
  
  /** Part 序号（在 Group 中的位置，从 1 开始） */
  part_index?: number;
  
  /** 是否为新建 Group */
  is_new_group?: boolean;
}
```

#### 5.1.4 TTS 播放结束通知（新增）

```typescript
// shared/protocols/messages.ts

export interface TtsEndMessage {
  type: 'tts_end';
  session_id: string;
  utterance_index: number;
  group_id?: string;
  /** TTS 播放结束时间戳（毫秒） */
  end_timestamp: number;
}
```

### 5.2 Node 推理服务扩展

#### 5.2.1 InferenceRequest 扩展

```rust
// node-inference/src/inference.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    // ... 现有字段 ...
    
    /// Group ID（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    
    /// Group 上下文文本（用于翻译）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_context: Option<Vec<String>>,
}
```

#### 5.2.2 NMT Engine 扩展

```rust
// node-inference/src/nmt.rs

impl NMTEngine {
    /// 使用上下文进行翻译
    pub async fn translate_with_context(
        &self,
        text: &str,
        src_lang: &str,
        tgt_lang: &str,
        context: Option<&[String]>,
    ) -> Result<String> {
        if let Some(ctx) = context {
            // 拼接上下文文本
            let full_context = ctx.join(" ") + " " + text;
            // 调用翻译服务，传入完整上下文
            self.translate(&full_context, src_lang, tgt_lang).await
        } else {
            // 无上下文，使用原有逻辑
            self.translate(text, src_lang, tgt_lang).await
        }
    }
}
```

---

## 6. 后端实现需求

### 6.1 调度服务器 (Scheduler)

#### 6.1.1 新增模块

1. **Group Manager** (`scheduler/src/group.rs`)
   - 实现 `GroupManager` 结构体
   - 实现 Group 创建、归属判断、上下文获取等功能
   - 实现 Group 生命周期管理

2. **Group 配置** (`scheduler/src/config.rs` 扩展)
   - `group_timeout_sec`: Group 超时时间（默认 30 秒）
   - `max_parts_per_group`: Group 最大 part 数量（默认 10）

#### 6.1.2 修改现有模块

1. **Session Manager** (`scheduler/src/session.rs`)
   - 扩展 `Session` 结构体，添加 `current_group_id` 字段
   - 可选：添加 Group 相关查询方法

2. **Dispatcher** (`scheduler/src/dispatcher.rs`)
   - 扩展 `Job` 结构体，添加 `group_id`、`group_context`、`is_new_group` 字段
   - 修改 `create_job` 方法，集成 Group Manager 逻辑
   - 在创建 Job 时：
     - 调用 `GroupManager::get_or_create_group` 获取或创建 Group
     - 调用 `GroupManager::get_group_context` 获取上下文
     - 将 Group 信息添加到 Job

3. **Session Handler** (`scheduler/src/websocket/session_handler.rs`)
   - 处理 `Utterance` 消息时：
     - 提取 `group_id`、`is_new_group`、`tts_end_timestamp` 字段
     - 如果提供了 `tts_end_timestamp`，更新 Group 的最后 TTS 结束时间
     - 将 Group 信息传递给 `create_job`
   - 处理 `TtsEnd` 消息时：
     - 更新对应 Group 的最后 TTS 结束时间

4. **Node Handler** (`scheduler/src/websocket/node_handler.rs`)
   - 处理 `JobResult` 时：
     - 提取 `group_id`
     - 调用 `GroupManager::add_part_to_group` 保存 part 信息
   - 创建 `TranslationResult` 消息时：
     - 包含 `group_id`、`part_index`、`is_new_group` 信息

#### 6.1.3 实现步骤

1. **第一步：数据结构实现**
   - [ ] 创建 `group.rs` 模块
   - [ ] 实现 `UtteranceGroup` 和 `GroupPart` 结构体
   - [ ] 实现 `GroupManager` 结构体和方法
   - [ ] 添加单元测试

2. **第二步：协议扩展**
   - [ ] 扩展 `Utterance` 消息，添加 Group 相关字段
   - [ ] 扩展 `JobAssign` 消息，添加 Group 相关字段
   - [ ] 扩展 `TranslationResult` 消息，添加 Group 相关字段
   - [ ] 添加 `TtsEnd` 消息类型

3. **第三步：业务逻辑集成**
   - [ ] 在 `SessionHandler` 中集成 Group Manager
   - [ ] 在 `Dispatcher` 中集成 Group 上下文获取
   - [ ] 在 `NodeHandler` 中集成 Group part 保存
   - [ ] 添加集成测试

4. **第四步：配置和优化**
   - [ ] 添加 Group 相关配置项
   - [ ] 实现 Group 清理机制（可选）
   - [ ] 性能优化和压力测试

### 6.2 节点推理服务 (Node Inference)

#### 6.2.1 修改现有模块

1. **Inference Service** (`node-inference/src/inference.rs`)
   - 扩展 `InferenceRequest` 结构体，添加 `group_id` 和 `group_context` 字段
   - 修改 `process` 方法，在调用 NMT 时传递上下文

2. **NMT Engine** (`node-inference/src/nmt.rs`)
   - 添加 `translate_with_context` 方法
   - 支持接收上下文文本列表
   - 实现上下文拼接逻辑（文本拼接或 Prompt 注入）

#### 6.2.2 实现步骤

1. **第一步：协议扩展**
   - [ ] 扩展 `InferenceRequest`，添加 Group 相关字段
   - [ ] 更新消息解析逻辑

2. **第二步：NMT 引擎扩展**
   - [ ] 实现 `translate_with_context` 方法
   - [ ] 测试上下文拼接逻辑
   - [ ] 验证翻译质量提升

3. **第三步：集成测试**
   - [ ] 端到端测试 Group 功能
   - [ ] 性能测试（上下文拼接对延迟的影响）

---

## 7. 前端实现需求

### 7.1 Web 客户端

#### 7.1.1 状态机扩展

```typescript
// web-client/src/state_machine.ts

interface StateMachine {
  // ... 现有状态 ...
  
  /** 当前 Group ID */
  currentGroupId?: string;
  
  /** 最后 TTS 播放结束时间 */
  lastTtsEndTime?: number;
  
  /** 记录 TTS 播放结束时间 */
  recordTtsEnd(groupId?: string): void;
  
  /** 判断是否应该创建新 Group */
  shouldCreateNewGroup(timeoutSec: number): boolean;
}
```

#### 7.1.2 WebSocket 客户端扩展

```typescript
// web-client/src/websocket_client.ts

// 发送 Utterance 时包含 Group 信息
async sendUtterance(audioData: ArrayBuffer, isNewGroup: boolean = false) {
  const message: UtteranceMessage = {
    type: 'utterance',
    session_id: this.sessionId,
    utterance_index: this.utteranceIndex,
    // ... 其他字段 ...
    group_id: this.stateMachine.currentGroupId,
    is_new_group: isNewGroup,
    tts_end_timestamp: this.stateMachine.lastTtsEndTime,
  };
  
  this.ws.send(JSON.stringify(message));
}

// 处理 TTS 播放结束
onTtsEnd(utteranceIndex: number, groupId?: string) {
  const message: TtsEndMessage = {
    type: 'tts_end',
    session_id: this.sessionId,
    utterance_index: utteranceIndex,
    group_id: groupId,
    end_timestamp: Date.now(),
  };
  
  this.ws.send(JSON.stringify(message));
  
  // 更新状态机
  this.stateMachine.recordTtsEnd(groupId);
}
```

#### 7.1.3 UI 扩展（可选）

```typescript
// web-client/src/components/TranslationView.tsx

// 显示 Group 信息（可选）
{result.group_id && (
  <div className="group-indicator">
    {result.is_new_group ? '新话题' : `话题 ${result.group_id.slice(-4)} - 第 ${result.part_index} 部分`}
  </div>
)}

// "开始新话题" 按钮
<button onClick={() => this.handleNewTopic()}>
  开始新话题
</button>
```

#### 7.1.4 实现步骤

1. **第一步：状态管理**
   - [ ] 扩展状态机，添加 Group 相关状态
   - [ ] 实现 TTS 播放结束时间记录
   - [ ] 实现 Group 归属判断逻辑

2. **第二步：消息协议**
   - [ ] 更新 `UtteranceMessage` 类型定义
   - [ ] 更新 `TranslationResultMessage` 类型定义
   - [ ] 添加 `TtsEndMessage` 类型定义

3. **第三步：业务逻辑**
   - [ ] 在发送 Utterance 时包含 Group 信息
   - [ ] 在 TTS 播放结束时发送 `TtsEnd` 消息
   - [ ] 处理 `TranslationResult` 中的 Group 信息

4. **第四步：UI 增强（可选）**
   - [ ] 显示 Group 信息
   - [ ] 添加"开始新话题"按钮
   - [ ] 优化用户体验

---

## 8. 实现步骤

### 8.1 阶段划分

#### 阶段 1: 后端核心功能（1-2 周）

**目标**: 实现 Scheduler 的 Group 管理功能

- [ ] 创建 `group.rs` 模块，实现 `GroupManager`
- [ ] 扩展消息协议（`Utterance`、`JobAssign`、`TranslationResult`）
- [ ] 集成 Group Manager 到 Session Handler 和 Dispatcher
- [ ] 单元测试和集成测试

#### 阶段 2: 节点推理服务扩展（1 周）

**目标**: 实现 NMT 引擎的上下文支持

- [ ] 扩展 `InferenceRequest`，添加 Group 相关字段
- [ ] 实现 `NMTEngine::translate_with_context` 方法
- [ ] 测试上下文拼接对翻译质量的影响

#### 阶段 3: 前端集成（1 周）

**目标**: 前端支持 Group 功能

- [ ] 扩展状态机，记录 TTS 播放结束时间
- [ ] 更新 WebSocket 消息，包含 Group 信息
- [ ] 实现 TTS 播放结束通知
- [ ] 可选：UI 显示 Group 信息

#### 阶段 4: 端到端测试和优化（1 周）

**目标**: 验证完整流程，优化性能

- [ ] 端到端测试（Web → Scheduler → Node → Web）
- [ ] 性能测试和优化
- [ ] 文档完善

### 8.2 依赖关系

```
阶段 1 (Scheduler) 
    ↓
阶段 2 (Node Inference) ──→ 阶段 3 (Web Client)
    ↓                           ↓
阶段 4 (E2E Testing & Optimization)
```

### 8.3 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Group 归属判断不准确 | 中 | v1 仅基于时间间隔，后续可加入语义分析 |
| 上下文拼接影响翻译延迟 | 中 | 优化 NMT 引擎，支持批量上下文处理 |
| Group 数量无限增长 | 低 | 实现 Group 清理机制，限制最大 part 数量 |
| 向后兼容性问题 | 高 | 所有 Group 相关字段设为可选，现有客户端无需修改 |

---

## 9. 测试计划

### 9.1 单元测试

#### 9.1.1 Group Manager 测试

```rust
// scheduler/tests/stage2.1.3/group_manager_test.rs

#[tokio::test]
async fn test_create_group() {
    // 测试 Group 创建
}

#[tokio::test]
async fn test_get_or_create_group_timeout() {
    // 测试基于时间间隔的 Group 归属判断
}

#[tokio::test]
async fn test_get_group_context() {
    // 测试上下文获取
}

#[tokio::test]
async fn test_add_part_to_group() {
    // 测试添加 part 到 Group
}

#[tokio::test]
async fn test_max_parts_per_group() {
    // 测试 Group 最大 part 数量限制
}
```

#### 9.1.2 NMT Engine 测试

```rust
// node-inference/tests/stage2.1.3/nmt_context_test.rs

#[tokio::test]
async fn test_translate_with_context() {
    // 测试带上下文的翻译
}

#[tokio::test]
async fn test_translate_without_context() {
    // 测试无上下文的翻译（向后兼容）
}
```

### 9.2 集成测试

#### 9.2.1 Scheduler 集成测试

```rust
// scheduler/tests/stage2.1.3/integration_test.rs

#[tokio::test]
async fn test_utterance_group_flow() {
    // 测试完整的 Group 流程：
    // 1. 创建 Session
    // 2. 发送第一个 Utterance（创建新 Group）
    // 3. 发送第二个 Utterance（归属到同一 Group）
    // 4. 验证上下文正确传递
}
```

#### 9.2.2 端到端测试

```typescript
// web-client/tests/stage2.1.3/e2e_test.ts

describe('Utterance Group E2E', () => {
  it('should create new group on first utterance', async () => {
    // 测试首次发言创建新 Group
  });
  
  it('should add utterance to existing group within timeout', async () => {
    // 测试在超时时间内发言归属到现有 Group
  });
  
  it('should create new group after timeout', async () => {
    // 测试超时后创建新 Group
  });
});
```

### 9.3 性能测试

- **Group 创建延迟**: < 10ms
- **上下文获取延迟**: < 5ms
- **上下文拼接对翻译延迟的影响**: < 50ms
- **内存使用**: 每个 Group < 1KB（假设平均每个 part 100 字符）

### 9.4 兼容性测试

- **向后兼容**: 现有客户端（不发送 Group 信息）应能正常工作
- **渐进式启用**: 支持部分客户端启用 Group 功能，部分不启用

---

## 10. 性能与扩展

### 10.1 性能优化

1. **Group 存储优化**
   - 使用内存缓存，定期清理过期 Group
   - 对于长期会话，可考虑持久化到数据库

2. **上下文拼接优化**
   - 限制上下文长度（例如最多 500 字符）
   - 对于过长的上下文，只使用最近的 N 个 part

3. **NMT 引擎优化**
   - 支持批量上下文处理
   - 缓存常用上下文组合

### 10.2 未来扩展

1. **语义分析**
   - 使用 LLM 或语义相似度模型判断是否属于同一话题
   - 提高 Group 归属判断的准确性

2. **Group 可视化**
   - 前端显示 Group 结构
   - 允许用户手动合并或拆分 Group

3. **Group 持久化**
   - 支持 Group 跨会话保存
   - 支持 Group 导出和导入

4. **多语言 Group**
   - 支持多语言混合的 Group
   - 支持 Group 内语言切换

---

## 附录

### A. 配置参数

| 参数名 | 默认值 | 说明 | 可配置位置 |
|--------|--------|------|------------|
| `group_timeout_sec` | 30 | Group 超时时间（秒） | 环境变量、配置文件 |
| `max_parts_per_group` | 10 | Group 最大 part 数量 | 环境变量、配置文件 |
| `max_context_length` | 500 | 上下文最大长度（字符） | 环境变量、配置文件 |
| `group_cleanup_interval_hours` | 24 | Group 清理间隔（小时） | 环境变量、配置文件 |

### B. 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| Group 不存在 | 创建新 Group |
| Group 已满（达到最大 part 数量） | 创建新 Group |
| 上下文获取失败 | 使用空上下文，记录警告日志 |
| TTS 结束时间更新失败 | 记录警告日志，不影响主流程 |

### C. 相关文档

- [Web 端实时语音翻译统一设计方案 v3](./Web_端实时语音翻译_统一设计方案_v3.md)
- [Web 端半双工实时语音翻译交互与上下文拼接设计说明 v2](./Web_端半双工实时语音翻译交互与上下文拼接设计说明_v2.md)
- [开发计划 - 阶段 2.1.3](../project_management/DEVELOPMENT_PLAN.md#阶段-213utterance-group需要后端支持)

---

**文档版本历史**:
- v1.0 (2025-01-XX): 初始版本，完整的功能规范

