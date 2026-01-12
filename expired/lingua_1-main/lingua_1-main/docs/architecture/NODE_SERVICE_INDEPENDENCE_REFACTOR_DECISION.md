# 节点服务独立性重构方案 - 决策文档

**版本**: v1.0  
**日期**: 2025-01-XX  
**目标**: 实现节点服务的真正独立性，支持服务热插拔和开包即用

---

## 1. 执行摘要

### 1.1 改造目标

将当前节点端的**聚合服务架构**改造为**服务独立架构**，实现：
- ✅ 各服务独立运行，通过接口传递具体任务
- ✅ 服务热插拔能力完整
- ✅ 新增服务包开包即用，无需修改核心代码
- ✅ 支持服务级别的负载均衡和故障转移

### 1.2 推荐方案

**方案A：拆分 node-inference**

**核心思路**：将 `node-inference` 的功能拆分到各个服务中，保留一个轻量级的编排层。

**关键优势**：
- ✅ 性能优势：保留Rust实现，性能比TypeScript快2-3倍
- ✅ 扩展性强：新增服务包开包即用，无需修改NodeAgent
- ✅ 服务独立性：每个服务包可以独立实现所有逻辑
- ✅ 工作量适中：5-8周完成

---

## 2. 当前架构与问题

### 2.1 当前架构

当前节点端采用**聚合服务架构**：

```
调度服务器 (Scheduler)
    ↓ (WebSocket: job_assign)
节点端 NodeAgent (Electron)
    ↓ (HTTP: /v1/inference)
node-inference 服务 (Rust, 端口 5009) ← 聚合服务
    ├─ 调用 faster-whisper-vad (Python, 端口 6007) ← ASR
    ├─ 调用 nmt-m2m100 (Python, 端口 5008) ← NMT
    ├─ 调用 piper-tts (Python, 端口 5006) ← TTS
    ├─ 调用 your-tts (Python, 端口 5004) ← TTS (可选)
    └─ 调用 speaker-embedding (Python, 端口 5003) ← TONE (可选)
```

**关键依赖关系**：
- `NodeAgent` → `InferenceService` → `node-inference` (Rust)
- `node-inference` 负责：
  - 接收完整任务请求（包含音频、语言、功能特性等）
  - 协调各个 Python 服务完成整个翻译流程
  - 管理流水线上下文（PipelineContext）
  - 处理音频编解码、VAD、语言检测等中间逻辑
  - 返回最终结果（ASR文本、翻译文本、TTS音频）

### 2.2 当前问题

**重要澄清**：服务热插拔**不是**由 `node-inference` 实现的，而是由 **NodeAgent** 实现的（通过 `PythonServiceManager` 和 `RustServiceManager`）。`node-inference` 只是一个聚合服务，用于协调各个 Python 服务完成整个翻译流程。

#### 问题1：单点依赖

- 所有任务必须通过 `node-inference` 服务处理
- 如果 `node-inference` 未运行，即使所有 Python 服务都运行，节点也无法处理任务
- **注意**：服务可以独立启动/停止（热插拔能力存在），但任务处理依赖 `node-inference`

#### 问题2：架构耦合

- Python 服务虽然独立运行，但无法直接接收调度服务器的任务
- 必须通过 `node-inference` 作为中间层
- 无法实现真正的"各服务独立运行，通过接口传递具体任务"

#### 问题3：扩展性限制

- 新增服务类型需要修改 `node-inference` 代码
- 无法实现服务级别的动态路由和负载均衡
- 服务间无法直接通信

**关于热插拔的说明**：
- 服务热插拔机制在 NodeAgent 中实现，不受 `node-inference` 影响
- 拆分或移除 `node-inference` **不会影响**服务热插拔能力
- 反而会**增强**热插拔能力，因为不再依赖 `node-inference` 这个单点

---

## 3. 目标架构

### 3.1 设计目标

1. **服务独立性**：
   - 每个服务（ASR、NMT、TTS、TONE）都可以独立运行
   - 服务可以直接接收调度服务器的任务
   - 服务之间可以独立热插拔，不影响其他服务

2. **接口标准化**：
   - 每个服务类型（ServiceType）定义统一的接口规范
   - 调度服务器可以直接将任务路由到对应的服务
   - 支持服务级别的负载均衡和故障转移

3. **热插拔能力**：
   - 服务启动/停止不影响其他服务
   - 调度服务器可以实时感知服务状态变化
   - 支持服务级别的动态路由

### 3.2 目标架构图

```
调度服务器 (Scheduler)
    ↓ (WebSocket: job_assign)
节点端 NodeAgent (Electron)
    ├─ 任务路由层 (TaskRouter)
    │   ├─ ASR 任务 → faster-whisper-vad (Python, 端口 6007)
    │   ├─ ASR 任务 → node-inference (Rust, 端口 5009) [可选]
    │   ├─ NMT 任务 → nmt-m2m100 (Python, 端口 5008)
    │   ├─ TTS 任务 → piper-tts (Python, 端口 5006)
    │   ├─ TTS 任务 → your-tts (Python, 端口 5004) [可选]
    │   └─ TONE 任务 → speaker-embedding (Python, 端口 5003) [可选]
    │
    └─ 流水线编排层 (PipelineOrchestrator)
        └─ 当需要多服务协作时，协调各个服务完成完整流程
```

---

## 4. 推荐方案：方案A - 拆分 node-inference

### 4.1 核心思路

将 `node-inference` 的功能拆分到各个服务中，保留一个轻量级的编排层。

### 4.2 改造内容

#### 1. 服务接口标准化

为每个 ServiceType 定义统一的 HTTP/WebSocket 接口：

- **ASR 服务**：`POST /v1/asr/transcribe`
- **NMT 服务**：`POST /v1/nmt/translate`
- **TTS 服务**：`POST /v1/tts/synthesize`
- **TONE 服务**：`POST /v1/tone/embed` 或 `/v1/tone/clone`

#### 2. 拆分 node-inference 功能

| 功能模块 | 迁移目标 | 说明 |
|---------|---------|------|
| **音频处理**（VAD、编解码） | NodeAgent 或独立服务 | 保留在 NodeAgent 中，或创建独立的音频处理服务（保留Rust实现） |
| **流水线编排** | NodeAgent | 在 NodeAgent 中实现轻量级的 PipelineOrchestrator |
| **语言检测** | ASR 服务或独立服务 | 作为独立服务，或集成到 ASR 服务中 |
| **上下文管理** | NodeAgent | 在 NodeAgent 中管理 PipelineContext |

#### 3. NodeAgent 改造

- **实现 `TaskRouter`**：根据任务类型路由到对应服务
- **实现 `PipelineOrchestrator`**：协调多个服务完成完整流程
- **移除对 `node-inference` 的硬依赖**：不再必须通过 `node-inference` 处理任务

### 4.3 方案优势

#### 4.3.1 性能优势

**从性能角度来说，方案A具有明显优势**：

1. **Rust实现的性能优势**：
   - VAD处理：Rust实现比TypeScript快2-3倍
   - 音频编解码：Rust实现比Node.js快2-3倍
   - 语言检测：Rust实现比TypeScript快2-3倍

2. **性能对比**（处理3秒音频）：
   | 阶段 | 方案A（Rust） | 性能优势 |
   |------|--------------|---------|
   | 音频编解码 | ~1.5-4ms | 快2-3倍 |
   | VAD处理 | ~0.1-0.5ms | 快2-3倍 |
   | 语言检测 | ~10-50ms | 快2-3倍 |
   | 服务间通信 | ~2-4ms | 可接受 |

3. **吞吐量优势**：
   - 可以水平扩展中间服务（VAD、编解码等）
   - NodeAgent负担轻，可以处理更多并发任务
   - 支持服务级别的负载均衡

#### 4.3.2 扩展性优势

**方案A的扩展性明显更好**：

1. **新增同类型服务包（标准接口）**：
   - ✅ **开包即用**：新服务包只需实现标准接口，无需修改NodeAgent
   - ✅ **自动发现**：TaskRouter通过ServiceType自动发现新服务
   - ✅ **自动路由**：任务自动路由到新服务，支持负载均衡和故障转移

2. **新增需要特殊中间处理的服务**：
   - ✅ **开包即用**：服务内部处理所有特殊逻辑（VAD、编解码等）
   - ✅ **无需修改NodeAgent**：新服务包独立实现所有逻辑

3. **扩展性对比**：
   | 扩展场景 | 方案A | 说明 |
   |---------|-------|------|
   | **新增同类型服务（标准接口）** | ✅ 开包即用 | 无需修改NodeAgent |
   | **新增同类型服务（需要特殊中间处理）** | ✅ 开包即用 | 服务内部处理 |
   | **新增新ServiceType** | ⚠️ 需要更新NodeAgent | 主要是路由和编排逻辑 |

#### 4.3.3 服务独立性优势

1. **服务完全独立**：
   - 每个服务包可以独立实现所有逻辑（包括中间处理）
   - 服务包升级不影响NodeAgent
   - 降低耦合度

2. **热插拔能力完整**：
   - 服务启动/停止不影响其他服务
   - 调度服务器可以实时感知服务状态变化
   - 支持服务级别的动态路由

3. **易于维护**：
   - 服务包可以独立升级
   - NodeAgent只负责编排和路由
   - 代码结构清晰，易于扩展

### 4.4 方案缺点

- ❌ 需要修改所有服务的接口
- ❌ NodeAgent 需要实现流水线编排逻辑
- ❌ 需要处理服务间的数据传递和错误处理

### 4.5 工作量评估

- 服务接口标准化：2-3 周
- NodeAgent 改造：2-3 周
- 测试和验证：1-2 周
- **总计：5-8 周**

---

## 5. 实施计划

### 5.1 阶段1：接口标准化（2-3 周）

#### 1. 定义服务接口规范

- **ASR 服务接口**：`POST /v1/asr/transcribe`
  ```json
  {
    "audio": "base64_encoded_audio",
    "audio_format": "pcm16",
    "sample_rate": 16000,
    "src_lang": "zh",
    "enable_streaming": false,
    "context_text": "optional_context"
  }
  ```

- **NMT 服务接口**：`POST /v1/nmt/translate`
  ```json
  {
    "text": "source_text",
    "src_lang": "zh",
    "tgt_lang": "en",
    "context_text": "optional_context"
  }
  ```

- **TTS 服务接口**：`POST /v1/tts/synthesize`
  ```json
  {
    "text": "text_to_synthesize",
    "lang": "en",
    "voice_id": "optional_voice_id",
    "speaker_id": "optional_speaker_id"
  }
  ```

#### 2. 改造现有 Python 服务

- faster-whisper-vad：实现 `/v1/asr/transcribe`
- nmt-m2m100：实现 `/v1/nmt/translate`
- piper-tts：实现 `/v1/tts/synthesize`
- your-tts：实现 `/v1/tts/synthesize`（支持 `speaker_id`）
- speaker-embedding：实现 `/v1/tone/embed`

#### 3. 文档和测试

- 编写接口文档
- 编写接口测试用例

### 5.2 阶段2：NodeAgent 改造（2-3 周）

#### 1. 实现 TaskRouter

```typescript
class TaskRouter {
  async routeASRTask(task: ASRTask): Promise<ASRResult> {
    // 1. 获取可用的 ASR 服务列表
    const asrServices = this.getAvailableServices(ServiceType.ASR);
    // 2. 选择服务（负载均衡、故障转移）
    const service = this.selectService(asrServices);
    // 3. 调用服务
    return await this.callService(service, '/v1/asr/transcribe', task);
  }
  
  async routeNMTTask(task: NMTTask): Promise<NMTResult> {
    // 类似逻辑
  }
  
  async routeTTSTask(task: TTSTask): Promise<TTSResult> {
    // 类似逻辑
  }
}
```

#### 2. 实现 PipelineOrchestrator

```typescript
class PipelineOrchestrator {
  async processJob(job: JobAssignMessage): Promise<JobResult> {
    // 1. ASR 任务
    const asrResult = await this.taskRouter.routeASRTask({
      audio: job.audio,
      src_lang: job.src_lang,
      ...
    });
    
    // 2. NMT 任务
    const nmtResult = await this.taskRouter.routeNMTTask({
      text: asrResult.text,
      src_lang: job.src_lang,
      tgt_lang: job.tgt_lang,
      ...
    });
    
    // 3. TTS 任务
    const ttsResult = await this.taskRouter.routeTTSTask({
      text: nmtResult.text,
      lang: job.tgt_lang,
      ...
    });
    
    // 4. 返回结果
    return {
      text_asr: asrResult.text,
      text_translated: nmtResult.text,
      tts_audio: ttsResult.audio,
      ...
    };
  }
}
```

#### 3. 改造 InferenceService

- 移除对 `node-inference` 的硬依赖
- 使用 `TaskRouter` 和 `PipelineOrchestrator`

#### 4. 音频处理逻辑

- 将 VAD、编解码等逻辑迁移到 NodeAgent
- 或创建独立的音频处理服务（保留Rust实现）

### 5.3 阶段3：测试和验证（1-2 周）

#### 1. 单元测试

- TaskRouter 测试
- PipelineOrchestrator 测试
- 服务接口测试

#### 2. 集成测试

- 完整流程测试
- 服务热插拔测试
- 故障转移测试

#### 3. 性能测试

- 延迟对比
- 吞吐量对比
- 资源使用对比

### 5.4 时间计划

| 阶段 | 任务 | 时间 | 负责人 |
|------|------|------|--------|
| 阶段 1 | 接口标准化 | 2-3 周 | 后端团队 |
| 阶段 2 | NodeAgent 改造 | 2-3 周 | 前端团队 |
| 阶段 3 | 测试和验证 | 1-2 周 | QA 团队 |
| **总计** | | **5-8 周** | |

---

## 6. 技术细节

### 6.1 服务发现与路由

**服务注册**：
- 服务启动时向 NodeAgent 注册
- NodeAgent 维护服务状态表
- 心跳机制保持服务状态同步

**服务选择策略**：
- 负载均衡：轮询、最少连接、加权轮询
- 故障转移：自动切换到备用服务
- 健康检查：定期检查服务可用性

### 6.2 数据传递与上下文管理

**PipelineContext**：
- 在 NodeAgent 中维护
- 服务间通过标准接口传递数据
- 支持上下文传递（如 NMT 的上下文文本）

**错误处理**：
- 服务级错误处理
- 流水线级错误处理
- 降级策略（如 TTS 服务不可用时返回文本）

### 6.3 向后兼容

**过渡期支持**：
- 保留 `node-inference` 作为可选服务
- 支持两种模式切换（通过配置）
- 逐步迁移到新架构

---

## 7. 风险评估

### 7.1 技术风险

#### 1. 接口兼容性

- **风险**：服务接口变更可能导致现有功能异常
- **缓解**：充分测试，渐进式迁移

#### 2. 性能影响

- **风险**：服务间通信可能增加延迟
- **缓解**：
  - 优化通信协议，使用 WebSocket 流式传输
  - 保留Rust实现，性能优于TypeScript
  - 本地HTTP调用延迟仅2-4ms，可接受

#### 3. 错误处理复杂度

- **风险**：多服务协作的错误处理更复杂
- **缓解**：完善的错误处理和降级策略

### 7.2 业务风险

#### 1. 功能回归

- **风险**：改造过程中可能引入功能回归
- **缓解**：充分的测试覆盖，分阶段发布

#### 2. 用户体验

- **风险**：服务切换可能影响用户体验
- **缓解**：平滑过渡，保持功能一致性

---

## 8. 成功标准

### 8.1 服务独立性

- ✅ 每个服务可以独立启动/停止
- ✅ 服务状态变化不影响其他服务
- ✅ 调度服务器可以实时感知服务状态

### 8.2 热插拔能力

- ✅ 服务启动/停止后，任务可以自动路由到可用服务
- ✅ 支持服务级别的故障转移
- ✅ 支持服务级别的负载均衡

### 8.3 性能指标

- ✅ 任务处理延迟不超过现有架构的 110%
- ✅ 服务间通信开销 < 5ms
- ✅ 系统吞吐量不低于现有架构

### 8.4 可维护性

- ✅ 代码结构清晰，易于扩展
- ✅ 接口文档完整
- ✅ 测试覆盖率达到 80% 以上

### 8.5 扩展性

- ✅ 新增同类型服务包开包即用，无需修改NodeAgent
- ✅ 新增需要特殊中间处理的服务开包即用（服务内部处理）
- ✅ 支持服务包独立升级

---

## 9. 关键优势总结

### 9.1 性能优势

- ✅ **Rust实现性能优势**：VAD、编解码等中间逻辑保留Rust实现，性能比TypeScript快2-3倍
- ✅ **吞吐量优势**：可以水平扩展中间服务，NodeAgent负担轻
- ✅ **延迟优势**：单任务处理延迟快约15-20%

### 9.2 扩展性优势

- ✅ **开包即用**：新增同类型服务包，无需修改NodeAgent
- ✅ **服务独立性**：每个服务包可以独立实现所有逻辑
- ✅ **易于维护**：服务包升级不影响NodeAgent

### 9.3 架构优势

- ✅ **服务完全独立**：可以单独启动/停止
- ✅ **热插拔能力完整**：支持服务级别的动态路由
- ✅ **解耦**：NodeAgent和服务包耦合度低

---

## 10. 决策建议

### 10.1 推荐方案

**推荐采用方案A：拆分 node-inference**

**理由**：
1. **性能优势**：保留Rust实现，性能比TypeScript快2-3倍
2. **扩展性强**：新增服务包开包即用，无需修改NodeAgent
3. **工作量适中**：5-8周完成，风险可控
4. **架构清晰**：易于维护和扩展

### 10.2 实施策略

**建议：渐进式迁移**

1. **第一阶段**：实现接口标准化，保持向后兼容
2. **第二阶段**：实现 TaskRouter，支持直接路由
3. **第三阶段**：实现 PipelineOrchestrator，逐步迁移
4. **第四阶段**：完全移除对 `node-inference` 的依赖

### 10.3 关键决策点

1. **服务接口规范**：需要与调度服务器团队协调，确保接口一致性
2. **音频处理逻辑**：决定是放在 NodeAgent 还是独立服务（推荐独立服务，保留Rust实现）
3. **向后兼容策略**：决定是否保留 `node-inference` 作为可选服务

---

## 11. 附录

### 11.1 相关文档

- [ServiceType Capability Redesign](./SERVICE_TYPE_CAPABILITY_REDESIGN.md)
- [服务热插拔机制说明](./SERVICE_HOTPLUG_MECHANISM.md)

### 11.2 参考实现

- 当前 `node-inference` 实现：`electron_node/services/node-inference/`
- 当前 Python 服务实现：`electron_node/services/`

### 11.3 联系方式

如有疑问，请联系架构团队。

